import asyncio
import contextlib
import json
import logging
import os
import re
import signal
import time
from datetime import datetime, timezone
from typing import Any
from . import auth
from .infra import browser_pool, db, pg
from .infra import redis as redis_infra
from .memory import capture, kg, memory, prompt, search, taxonomy
import html2text
import httpx
import litellm
import trafilatura
from rapidfuzz import fuzz
from dotenv import load_dotenv
from pathlib import Path
from contextlib import asynccontextmanager
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.middleware import Middleware, MiddlewareContext
from fastmcp.utilities.types import Image
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from mcp.types import Icon
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response

load_dotenv()


ICON_PATH = Path(__file__).parent / "icons" / "logo.svg"

GITHUB_RELEASES_BASE = "https://github.com/SSShogunn/continuum/releases/download"
# The bootstraps are the only files a person is ever meant to look at (they're
# what curl|node / irm|node fetches by hand) — kept on their own release so that
# page shows just the script, not the payload it silently downloads.
SCRIPT_RELEASE_BASE = os.environ.get(
    "CONTINUUM_SCRIPT_RELEASE_BASE", f"{GITHUB_RELEASES_BASE}/hooks-latest"
).rstrip("/")
PAYLOAD_RELEASE_BASE = os.environ.get(
    "CONTINUUM_PAYLOAD_RELEASE_BASE", f"{GITHUB_RELEASES_BASE}/hooks-payload"
).rstrip("/")

# Node only, as of the rewrite off Python: install_hook.js/uninstall_hook.js
# are run directly (curl|node / irm|node), the rest are fetched silently by
# them and by the background updater.
BOOTSTRAP_SCRIPTS = (
    "install_hook.js",
    "uninstall_hook.js",
)
PAYLOAD_SCRIPTS = (
    "continuum_context_inject.js",
    "continuum_session_capture.js",
    "continuum_self_update.js",
)
PUBLIC_SCRIPTS = BOOTSTRAP_SCRIPTS + PAYLOAD_SCRIPTS

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

HTTP2_ERROR_MARKERS = ("ERR_HTTP2_PROTOCOL_ERROR", "ERR_HTTP2", "ERR_CONNECTION_RESET")

SEARXNG_URL = os.environ.get("CONTINUUM_SEARXNG_URL", "http://searxng:8080")

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger("continuum")


REVOCATION_POLL_SECONDS = int(os.environ.get("CONTINUUM_REVOCATION_POLL_SECONDS", "30"))


async def _poll_revoked_jtis() -> None:
    while True:
        await auth.refresh_revoked_jtis()
        await asyncio.sleep(REVOCATION_POLL_SECONDS)


@asynccontextmanager
async def lifespan(server: "FastMCP"):
    await browser_pool.start()
    await pg.start()
    await redis_infra.start()
    await db.start()
    await memory.start()
    await auth.refresh_revoked_jtis()
    poll_task = asyncio.create_task(_poll_revoked_jtis())
    try:
        yield {}
    finally:
        poll_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await poll_task
        await memory.stop()
        await db.stop()
        await redis_infra.stop()
        await pg.stop()
        await browser_pool.stop()


class RequestLoggingMiddleware(Middleware):
    async def on_call_tool(self, context: MiddlewareContext, call_next):
        tool = context.message.name
        arguments = context.message.arguments
        owner = auth.current_owner()
        started = time.perf_counter()
        try:
            result = await call_next(context)
        except Exception as exc:
            duration = (time.perf_counter() - started) * 1000
            db.log_request(
                tool, arguments, "error", error=repr(exc), duration_ms=duration, owner=owner
            )
            raise
        duration = (time.perf_counter() - started) * 1000
        db.log_request(
            tool,
            arguments,
            "ok",
            response=str(getattr(result, "content", result)),
            duration_ms=duration,
            owner=owner,
        )
        return result


_INSTRUCTIONS = """
CRITICAL — Memory-First Protocol: Continuum is this user's persistent, personal memory. Before
answering ANY substantive message — including the very first of a new conversation — call
`memory_search` (or `memory_list` for a broad "what do you know about me" ask). Do this unprompted;
never ask whether to check memory, never answer from assumption when a search could surface it.
Memories are scoped to the caller's account alone. Auto-saving without asking is intended here.

## Memory rules

1. **Search proactively** — every conversation, every new topic. `memory_fact_search` for narrow
   lookups; `memory_list` first for "what do you remember?".

2. **Workspace = project. Never land on `default` by omission.** Anything tied to a specific
   codebase or project (status, decisions, bugs, task context) MUST pass an explicit `workspace`:
   a kebab-cased slug from that project's repo/directory name. Call `memory_list_workspaces` first
   and reuse a close match (`continuum` vs `continuum-app`) rather than minting a near-duplicate.
   Reserve `default` for what spans projects — identity, cross-project preferences, people. If no
   workspace fits this project, ask which to create instead of silently using `default`.

   With filesystem access, keep `~/.continuum/workspace-map.json` in sync: a flat JSON object
   mapping your exact working-directory path to that slug. The UserPromptSubmit hook only reads
   this file by cwd, with no project-detection of its own — this mapping auto-scopes messages here.

3. **Set a `recall` tier, not just a `type`.** `always` = standing rule, injected every message;
   `relevance` (default) = facts surfaced on semantic match; `manual` = explicit lookup only.

4. **Save at boundaries, batched** — not mid-stream; one call per topic/entity, `content` lean.

5. **Update, don't duplicate.** Reuse a `name` to overwrite, `supersedes=["old"]` when replacing a
   differently-named entry, `memory_append` to add a line. Names: kebab-case, descriptive.
""".strip()

_jwt_verifier = auth.build_verifier()

mcp = FastMCP(
    "Continuum",
    instructions=_INSTRUCTIONS,
    lifespan=lifespan,
    icons=[
        Icon(
            src="https://continuum-mcp.sshogunn.org/icon.svg", mimeType="image/svg+xml"
        )
    ],
    auth=_jwt_verifier,
)
mcp.add_middleware(RequestLoggingMiddleware())


@mcp.custom_route("/icon.svg", methods=["GET"])
async def serve_app_icon(request: Request) -> Response:
    return Response(ICON_PATH.read_bytes(), media_type="image/svg+xml")


def _script_route(name: str):
    """Public, and a redirect rather than a file read: the scripts live in the
    repo's `hooks/` directory and are published as assets on two rolling
    GitHub releases (via .github/workflows/release-hooks.yml) — `hooks-latest`
    for the `install-hook`/`uninstall-hook` bootstraps a person actually runs,
    `hooks-payload` for the `continuum_*`/`install_hook.py`/`uninstall_hook.py`
    Python files those bootstraps and the background updater fetch silently.
    Splitting them keeps the release page a person lands on limited to the
    script they were told to run, not its implementation. Nothing about the
    install flow depends on what this container happens to have on disk, and
    downloads go through GitHub's release CDN rather than raw.githubusercontent.com,
    which rate-limits under load. These URLs stay flat at the root even though
    the files sit in a subdirectory — already-installed hooks fetch their own
    updates through them. Only the token (from the dashboard's Connections
    page) is secret, and it never travels through here."""
    base = SCRIPT_RELEASE_BASE if name in BOOTSTRAP_SCRIPTS else PAYLOAD_RELEASE_BASE

    async def serve_script(request: Request) -> Response:
        return RedirectResponse(f"{base}/{name}", status_code=302)

    serve_script.__name__ = f"serve_{name.replace('-', '_').replace('.', '_')}"
    return serve_script


for _script_name in PUBLIC_SCRIPTS:
    mcp.custom_route(f"/{_script_name}", methods=["GET"])(_script_route(_script_name))


def _check_internal_secret(request: Request) -> bool:
    secret = os.environ.get("CONTINUUM_INTERNAL_SECRET", "")
    return bool(secret) and request.headers.get("X-Internal-Secret") == secret


async def _json_body(request: Request) -> dict | None:
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return None
    return body if isinstance(body, dict) else None


@mcp.custom_route("/.well-known/oauth-authorization-server", methods=["GET"])
async def oauth_discovery(request: Request) -> Response:
    backend = os.environ.get("CONTINUUM_BACKEND_PUBLIC_URL", "").rstrip("/")
    if not backend:
        return Response("OAuth not configured", status_code=404)
    return JSONResponse(
        {
            "issuer": backend,
            "authorization_endpoint": f"{backend}/oauth/authorize",
            "token_endpoint": f"{backend}/oauth/token",
            "registration_endpoint": f"{backend}/oauth/register",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
            "scopes_supported": ["mcp"],
        }
    )


@mcp.custom_route("/internal/memory", methods=["GET"])
async def internal_memory(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id", "")
    workspace = request.query_params.get("workspace", "default")
    owner = auth.compose_owner(clerk_id, workspace)

    entries = await memory.list_full(owner)

    return JSONResponse({
        "workspace": workspace,
        "workspaces": await memory.list_workspaces(clerk_id),
        "entries": entries,
    })


async def _graph_owners(
    clerk_id: str, workspace: str, workspaces: list[str] | None = None
) -> list[str]:
    if workspace != auth.ALL_WORKSPACES:
        return [auth.compose_owner(clerk_id, workspace)]
    names = workspaces if workspaces is not None else await memory.list_workspaces(clerk_id)
    return [auth.compose_owner(clerk_id, name) for name in names]


@mcp.custom_route("/internal/graph", methods=["GET"])
async def internal_graph(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id", "")
    workspace = request.query_params.get("workspace", "default")
    workspaces = await memory.list_workspaces(clerk_id)
    owners = await _graph_owners(clerk_id, workspace, workspaces)

    data = await kg.graph_for_owners(owners)
    return JSONResponse({
        "workspace": workspace,
        "workspaces": workspaces,
        "nodes": data["nodes"],
        "edges": data["edges"],
    })


@mcp.custom_route("/internal/prompt", methods=["POST"])
async def internal_prompt(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    owner = auth.compose_owner(body.get("clerk_id", ""), body.get("workspace", "default"))
    mode = body.get("mode")
    if mode == "all":
        text = await prompt.build_full(owner)
    elif mode == "search":
        text = await prompt.build_search(owner, body.get("query", ""))
    elif mode == "select":
        text = await prompt.build_selection(owner, body.get("names", []))
    elif mode == "entity":
        text = await prompt.build_entity(owner, body.get("entity", ""))
    else:
        return Response("Invalid mode", status_code=400)
    return JSONResponse({"prompt": text})


@mcp.custom_route("/hook/context", methods=["POST"])
async def hook_context(request: Request) -> Response:
    """Bearer-JWT-gated, low-latency context lookup for client-side automation
    (e.g. a Claude Code UserPromptSubmit hook) that wants to inject relevant
    memory into every message without going through a model-invoked tool call.
    Uses the same manual/OAuth JWTs already accepted by the MCP transport —
    mint one from the dashboard's Settings page. Returns {"context": null} when
    nothing clears the relevance gate, so irrelevant turns inject nothing."""
    if _jwt_verifier is None:
        return Response("Not configured", status_code=503)
    authz = request.headers.get("authorization", "")
    if not authz.lower().startswith("bearer "):
        return JSONResponse({"error": "Missing bearer token"}, status_code=401)
    access_token = await _jwt_verifier.verify_token(authz[7:].strip())
    if access_token is None:
        return JSONResponse({"error": "Invalid or expired token"}, status_code=401)
    if not await memory.get_hook_context_enabled(access_token.client_id):
        return JSONResponse({"context": None})

    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    query = (body.get("query") or "").strip()
    if not query:
        return JSONResponse({"context": None})
    workspace = body.get("workspace", "default")
    owner = auth.compose_owner(access_token.client_id, workspace)
    extra_owner = (
        auth.compose_owner(access_token.client_id, "default") if workspace != "default" else None
    )

    started = time.perf_counter()
    result = await prompt.build_hook_context(
        owner, query, extra_owner=extra_owner, recent=body.get("recent"), workspace=workspace
    )
    # Logged like a tool call so injections show up in the Activity view next to
    # real ones: without a record of what was auto-injected there is no way to
    # tell whether the hook is helping or just spending tokens.
    db.log_request(
        "hook/context",
        {"query": query[:200], "workspace": workspace, "expanded": result["expanded"]},
        "ok",
        response=json.dumps({
            "gate_passed": result["gate_passed"],
            "directives": result["directives"],
            "memories": result["memories"],
            "linked": result["linked"],
            "facts": result["facts"],
        }),
        duration_ms=(time.perf_counter() - started) * 1000,
        owner=owner,
    )
    return JSONResponse({"context": result["context"]})


@mcp.custom_route("/hook/session", methods=["POST"])
async def hook_session(request: Request) -> Response:
    """End-of-session capture. Takes a finished transcript and queues memory
    candidates for review, so writing to memory no longer depends on the model
    choosing to call `memory_save` mid-conversation. Returns immediately and does
    the extraction on the worker — a session-end hook must never block the client."""
    if _jwt_verifier is None:
        return Response("Not configured", status_code=503)
    authz = request.headers.get("authorization", "")
    if not authz.lower().startswith("bearer "):
        return JSONResponse({"error": "Missing bearer token"}, status_code=401)
    access_token = await _jwt_verifier.verify_token(authz[7:].strip())
    if access_token is None:
        return JSONResponse({"error": "Invalid or expired token"}, status_code=401)
    if not await memory.get_hook_context_enabled(access_token.client_id):
        return JSONResponse({"queued": False})

    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    transcript = (body.get("transcript") or "").strip()
    if not transcript:
        return JSONResponse({"queued": False})
    owner = auth.compose_owner(access_token.client_id, body.get("workspace", "default"))
    await redis_infra.pool().enqueue_job(
        "capture_session_job", owner, body.get("session_id") or "", transcript
    )
    return JSONResponse({"queued": True})


@mcp.custom_route("/internal/session/candidates", methods=["GET"])
async def internal_session_candidates(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    owner = auth.compose_owner(
        request.query_params.get("clerk_id", ""),
        request.query_params.get("workspace", "default"),
    )
    return JSONResponse({"candidates": await capture.list_candidates(owner)})


@mcp.custom_route("/internal/session/candidates/resolve", methods=["POST"])
async def internal_session_candidate_resolve(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    owner = auth.compose_owner(body.get("clerk_id", ""), body.get("workspace", "default"))
    result = await capture.resolve_candidate(
        int(body["id"]), owner, accept=bool(body.get("accept"))
    )
    if result is None:
        return Response("No such pending candidate", status_code=404)
    return JSONResponse(result)


@mcp.custom_route("/internal/memory/save", methods=["POST"])
async def internal_memory_save(request: Request) -> Response:
    """Create or update an entry from the dashboard, so memory is editable by hand
    and not only through a model's tool call. Goes through the same `memory.save`
    path as the MCP tool — re-embeds, re-schedules graph extraction, unarchives —
    so a hand-edited entry behaves identically to a model-written one."""
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    owner = auth.compose_owner(body.get("clerk_id", ""), body.get("workspace", "default"))
    name = (body.get("name") or "").strip()
    content = body.get("content") or ""
    if not name or not content:
        return Response("name and content are required", status_code=400)
    record = await memory.save(
        name,
        (body.get("type") or "note").strip(),
        (body.get("description") or content[:200]).strip(),
        content,
        owner=owner,
        recall=body.get("recall"),
    )
    return JSONResponse(record)


@mcp.custom_route("/internal/memory/recall", methods=["POST"])
async def internal_memory_set_recall(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    owner = auth.compose_owner(body.get("clerk_id", ""), body.get("workspace", "default"))
    try:
        tier = await memory.set_recall(body["name"], body.get("recall", ""), owner=owner)
    except ValueError as exc:
        return Response(str(exc), status_code=400)
    if tier is None:
        return Response("No such memory entry", status_code=404)
    return JSONResponse({"name": body["name"], "recall": tier})


@mcp.custom_route("/internal/memory/review", methods=["GET"])
async def internal_memory_review(request: Request) -> Response:
    """Entries that read like standing rules but aren't filed as ones — a
    relevance/manual-tier memory whose text contains imperative statements
    ("never …", "always …", "unless explicitly asked"). Surfaced in the dashboard
    for the user to promote by hand; deliberately never reclassified on its own,
    since promoting something into every prompt is the user's call."""
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id", "")
    workspace = request.query_params.get("workspace", "default")
    owner = auth.compose_owner(clerk_id, workspace)

    candidates = []
    for entry in await memory.list_full(owner):
        if entry.get("recall") == "always" or entry.get("archived_at"):
            continue
        statements = taxonomy.rule_like_statements(f"{entry['description']}\n{entry['content']}")
        if statements:
            candidates.append({
                "name": entry["name"],
                "type": entry["type"],
                "recall": entry.get("recall") or "relevance",
                "statements": statements,
            })
    return JSONResponse({"workspace": workspace, "candidates": candidates})


@mcp.custom_route("/internal/memory/delete", methods=["POST"])
async def internal_memory_delete(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    owner = auth.compose_owner(body.get("clerk_id", ""), body.get("workspace", "default"))
    deleted = await memory.delete(body["name"], owner=owner)
    return JSONResponse({"deleted": deleted})


@mcp.custom_route("/internal/memory/import", methods=["POST"])
async def internal_memory_import(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    owner = auth.compose_owner(body.get("clerk_id", ""), body.get("workspace", "default"))
    raw_entries = body.get("memories", [])

    imported = 0
    skipped: list[str] = []
    for i, entry in enumerate(raw_entries):
        if not isinstance(entry, dict) or not entry.get("name") or not entry.get("content"):
            skipped.append(entry.get("name") if isinstance(entry, dict) and entry.get("name") else f"#{i}")
            continue
        content = entry["content"]
        await memory.save(
            entry["name"],
            entry.get("type") or "imported",
            entry.get("description") or content[:200],
            content,
            owner=owner,
            recall=entry.get("recall"),
        )
        imported += 1

    return JSONResponse({"imported": imported, "skipped": skipped})


@mcp.custom_route("/internal/memory/delete-workspace", methods=["POST"])
async def internal_memory_delete_workspace(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    workspace = body.get("workspace", "default")
    if workspace == "default":
        return Response("Cannot delete the default workspace", status_code=400)
    owner = auth.compose_owner(body.get("clerk_id", ""), workspace)
    deleted = await memory.delete_workspace(owner)
    await kg.delete_workspace(owner)
    return JSONResponse({"deleted": deleted})


@mcp.custom_route("/internal/stats", methods=["GET"])
async def internal_stats(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id") or None
    stats = await db.get_stats(owner=clerk_id)
    stats["timeseries"] = await db.get_timeseries(owner=clerk_id)
    stats["latency_percentiles"] = await db.get_latency_percentiles(owner=clerk_id)
    return JSONResponse(stats)


@mcp.custom_route("/internal/stats/heatmap", methods=["GET"])
async def internal_stats_heatmap(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id") or None
    heatmap = await db.get_hourly_heatmap(owner=clerk_id)
    return JSONResponse({"heatmap": heatmap})


@mcp.custom_route("/internal/activity", methods=["GET"])
async def internal_activity(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id") or None
    limit = int(request.query_params.get("limit", "50"))
    tool = request.query_params.get("tool") or None
    status = request.query_params.get("status") or None
    activity = await db.get_recent_activity(owner=clerk_id, limit=limit, tool=tool, status=status)
    return JSONResponse({"activity": activity})


@mcp.custom_route("/internal/memory/stats", methods=["GET"])
async def internal_memory_stats(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id", "")
    stats = await memory.get_memory_stats(clerk_id)
    return JSONResponse(stats)


@mcp.custom_route("/internal/graph/stats", methods=["GET"])
async def internal_graph_stats(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id", "")
    workspace = request.query_params.get("workspace", "default")
    owners = await _graph_owners(clerk_id, workspace)
    stats = await kg.get_graph_stats(owners)
    return JSONResponse(stats)


@mcp.custom_route("/internal/account/export", methods=["GET"])
async def internal_account_export(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id", "")
    workspaces = await memory.list_workspaces(clerk_id)
    by_workspace = {}
    for workspace in workspaces:
        owner = auth.compose_owner(clerk_id, workspace)
        by_workspace[workspace] = {
            "memories": await memory.list_full(owner=owner),
            "graph": await kg.graph_for_owners([owner]),
        }
    return JSONResponse({
        "format": "continuum-account-export",
        "version": "1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "workspaces": by_workspace,
    })


@mcp.custom_route("/internal/account/hook-settings", methods=["GET"])
async def internal_account_get_hook_settings(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    clerk_id = request.query_params.get("clerk_id", "")
    if not clerk_id:
        return JSONResponse({"error": "clerk_id required"}, status_code=400)
    enabled = await memory.get_hook_context_enabled(clerk_id)
    return JSONResponse({"hook_context_enabled": enabled})


@mcp.custom_route("/internal/account/hook-settings", methods=["POST"])
async def internal_account_set_hook_settings(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    clerk_id = body.get("clerk_id", "")
    if not clerk_id:
        return JSONResponse({"error": "clerk_id required"}, status_code=400)
    enabled = bool(body.get("hook_context_enabled", True))
    await memory.set_hook_context_enabled(clerk_id, enabled)
    return JSONResponse({"hook_context_enabled": enabled})


@mcp.custom_route("/internal/account/purge", methods=["POST"])
async def internal_account_purge(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await _json_body(request)
    if body is None:
        return Response("Invalid JSON body", status_code=400)
    clerk_id = body.get("clerk_id", "")
    if not clerk_id:
        return JSONResponse({"error": "clerk_id required"}, status_code=400)
    memories_deleted = await memory.delete_account(clerk_id)
    await kg.delete_account(clerk_id)
    requests_deleted = await db.delete_account(clerk_id)
    return JSONResponse({
        "memories_deleted": memories_deleted,
        "requests_deleted": requests_deleted,
    })


async def _redirect(request: Request) -> Response:
    target = os.environ.get("CONTINUUM_REDIRECT_URL")
    if not target:
        return Response("Not Found", status_code=404)
    return RedirectResponse(target)


mcp.custom_route("/", methods=["GET"])(_redirect)


def _image_format_from_content_type(content_type: str) -> str:
    subtype = content_type.split(";", 1)[0].strip().lower()
    fmt = subtype.split("/", 1)[1] if "/" in subtype else subtype
    if fmt in ("jpg", "jpeg"):
        return "jpeg"
    if fmt == "svg+xml":
        return "svg+xml"
    return fmt or "png"


def _is_http2_error(exc: Exception) -> bool:
    message = str(exc)
    return any(marker in message for marker in HTTP2_ERROR_MARKERS)


def _concise_error(exc: Exception) -> str:
    text = str(exc)
    match = re.search(r"net::ERR_[A-Z0-9_]+", text)
    if match:
        return match.group(0)
    if isinstance(exc, PlaywrightTimeoutError):
        return "navigation timed out"
    first_line = next((line for line in text.splitlines() if line.strip()), "")
    return (first_line.strip() or exc.__class__.__name__)[:200]


@asynccontextmanager
async def _navigated_page(url: str, timeout_ms: int, engine: str):
    async with browser_pool.page(engine) as page:
        try:
            await page.goto(url, wait_until="networkidle", timeout=timeout_ms)
        except PlaywrightTimeoutError:
            logger.info(
                "networkidle timed out for %s on %s; using current page state",
                url,
                engine,
            )
        yield page


async def _goto_and_extract(
    url: str, wait_for_selector: str | None, timeout_ms: int, engine: str
) -> tuple[str, str]:
    async with _navigated_page(url, timeout_ms, engine) as page:
        if wait_for_selector:
            await page.wait_for_selector(wait_for_selector, timeout=timeout_ms)
        return await page.content(), await page.title()


async def _goto_and_screenshot(
    url: str, full_page: bool, timeout_ms: int, engine: str
) -> bytes:
    async with _navigated_page(url, timeout_ms, engine) as page:
        return await page.screenshot(full_page=full_page, type="png")


async def _with_engine_fallback(run):
    try:
        return await run("chromium")
    except PlaywrightError as exc:
        if not _is_http2_error(exc):
            raise
        logger.info(
            "Chromium navigation failed (%s); retrying with Firefox",
            _concise_error(exc),
        )
        return await run("firefox")


def _to_markdown(html: str) -> str:
    converter = html2text.HTML2Text()
    converter.body_width = 0
    converter.ignore_links = False
    converter.ignore_images = False
    return converter.handle(html)


@mcp.tool
async def fetch_page(
    url: str,
    wait_for_selector: str | None = None,
    timeout_ms: int = 15000,
    readability: bool = False,
) -> str:
    """Fetch a web page with a headless browser and return its content as markdown. Set readability=True to strip nav/sidebars and return only the main content."""
    try:
        html, title = await _with_engine_fallback(
            lambda engine: _goto_and_extract(url, wait_for_selector, timeout_ms, engine)
        )
    except PlaywrightError as exc:
        raise ToolError(f"Failed to load {url}: {_concise_error(exc)}")

    if readability:
        extracted = trafilatura.extract(
            html,
            url=url,
            output_format="markdown",
            include_links=True,
            include_images=True,
            favor_recall=True,
        )
        markdown = extracted or _to_markdown(html)
    else:
        markdown = _to_markdown(html)

    return f"# {title}\n\nSource: {url}\n\n{markdown}"


@mcp.tool
async def fetch_pages(
    urls: list[str],
    wait_for_selector: str | None = None,
    timeout_ms: int = 15000,
    readability: bool = False,
) -> str:
    """Fetch multiple web pages concurrently and return all results as markdown, separated by ---."""

    async def _one(url: str) -> str:
        try:
            html, title = await _with_engine_fallback(
                lambda engine: _goto_and_extract(
                    url, wait_for_selector, timeout_ms, engine
                )
            )
            if readability:
                extracted = trafilatura.extract(
                    html,
                    url=url,
                    output_format="markdown",
                    include_links=True,
                    include_images=True,
                    favor_recall=True,
                )
                markdown = extracted or _to_markdown(html)
            else:
                markdown = _to_markdown(html)
            return f"# {title}\n\nSource: {url}\n\n{markdown}"
        except Exception as exc:
            reason = (
                _concise_error(exc) if isinstance(exc, PlaywrightError) else str(exc)
            )
            return f"Source: {url}\n\nError: {reason}"

    results = await asyncio.gather(*[_one(url) for url in urls])
    return "\n\n---\n\n".join(results)


@mcp.tool
async def screenshot_page(
    url: str,
    full_page: bool = False,
    timeout_ms: int = 15000,
) -> Image:
    """Capture a PNG screenshot of a web page in a 1280x800 viewport."""
    try:
        data = await _with_engine_fallback(
            lambda engine: _goto_and_screenshot(url, full_page, timeout_ms, engine)
        )
    except PlaywrightError as exc:
        raise ToolError(f"Failed to load {url}: {_concise_error(exc)}")

    return Image(data=data, format="png")


@mcp.tool
async def fetch_image(image_url: str, referer: str | None = None) -> Image:
    """Download an image over HTTP with a desktop browser User-Agent and optional Referer."""
    headers = {"User-Agent": DEFAULT_USER_AGENT}
    if referer:
        headers["Referer"] = referer

    async with httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.get(image_url, headers=headers, timeout=15.0)
        response.raise_for_status()

    content_type = response.headers.get("content-type", "image/png")
    fmt = _image_format_from_content_type(content_type)

    return Image(data=response.content, format=fmt)


async def _searxng_search(query: str, count: int) -> list[dict]:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{SEARXNG_URL}/search",
            params={"q": query, "format": "json"},
            timeout=15.0,
        )
    response.raise_for_status()

    results = response.json().get("results", [])
    return [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": " ".join(r.get("content", "").split()),  # collapse whitespace/newlines SearXNG sometimes includes
            "published": r.get("publishedDate") or "",
        }
        for r in results[:count]
    ]


@mcp.tool
async def search_web(query: str, count: int = 5) -> str:
    """Search the web via a self-hosted SearXNG instance and return structured results (title, URL, snippet, published date). Use fetch_page on a specific URL for full content."""
    results = await _searxng_search(query, count)

    if not results:
        return "No results found."

    lines = [
        f"{i}. {r['title']}\n   {r['url']}\n   {r['snippet']}" + (f" ({r['published']})" if r["published"] else "")
        for i, r in enumerate(results, 1)
    ]
    return "\n".join(lines)


@mcp.tool
async def extract_structured(
    url: str,
    schema: str,
    timeout_ms: int = 15000,
) -> str:
    """Fetch a URL and extract structured JSON data from its content. `schema` describes the
    fields wanted — either a JSON Schema string or a plain-language description (e.g. "title,
    author, published date, and a list of section headings"). Returns the extracted JSON as a
    string. Best for turning an article, listing, or product page into structured data."""
    try:
        html, _ = await _with_engine_fallback(
            lambda engine: _goto_and_extract(url, None, timeout_ms, engine)
        )
    except PlaywrightError as exc:
        raise ToolError(f"Failed to load {url}: {_concise_error(exc)}")

    text = trafilatura.extract(
        html, url=url, output_format="markdown", favor_recall=True
    ) or _to_markdown(html)

    model = os.environ.get("CONTINUUM_EXTRACT_MODEL", "openai/gpt-5.4-mini")
    api_key = os.environ.get("CONTINUUM_EXTRACT_API_KEY", "")
    kwargs: dict[str, Any] = {"api_key": api_key} if api_key else {}

    response = await litellm.acompletion(
        model=model,
        messages=[
            {
                "role": "user",
                "content": (
                    "Extract structured data from the page content below, matching this "
                    f"schema exactly:\n\n{schema}\n\n"
                    "Respond with ONLY a JSON object — no explanation, no markdown fences.\n\n"
                    f"Page content:\n\n{text[:20000]}"
                ),
            }
        ],
        response_format={"type": "json_object"},
        **kwargs,
    )
    if not isinstance(response, litellm.ModelResponse):
        raise ToolError("Unexpected streaming response from model.")
    raw = response.choices[0].message.content
    if raw is None:
        raise ToolError("Model returned no content.")

    try:
        json.loads(raw)
    except json.JSONDecodeError:
        raise ToolError(f"Model did not return valid JSON: {raw[:500]}")
    return raw


async def _check_one_url(url: str) -> dict:
    async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
        try:
            response = await client.head(url, headers={"User-Agent": DEFAULT_USER_AGENT})
            if response.status_code in (405, 501):
                response = await client.get(url, headers={"User-Agent": DEFAULT_USER_AGENT})
        except httpx.ConnectError as exc:
            return {"url": url, "resolved": False, "error": f"connection failed: {exc}"}
        except httpx.TimeoutException:
            return {"url": url, "resolved": False, "error": "timed out"}
        except httpx.HTTPError as exc:
            return {"url": url, "resolved": False, "error": str(exc)}

    redirect_chain = [str(r.url) for r in response.history]
    return {
        "url": url,
        "resolved": True,
        "status_code": response.status_code,
        "final_url": str(response.url),
        "redirected": str(response.url) != url,
        "redirect_chain": redirect_chain,
        "content_type": response.headers.get("content-type", ""),
    }


@mcp.tool
async def check_url(url: str) -> str:
    """Verify whether a URL actually resolves (catches dead links, typos, and hallucinated URLs). Reports status code, whether it redirected, the final URL, and content type."""
    result = await _check_one_url(url)
    if not result["resolved"]:
        return f"UNRESOLVED: {url}\nError: {result['error']}"

    lines = [f"Status: {result['status_code']}", f"Content-Type: {result['content_type'] or 'unknown'}"]
    if result["redirected"]:
        lines.append(f"Redirected to: {result['final_url']}")
        if result["redirect_chain"]:
            lines.append(f"Redirect chain: {' -> '.join(result['redirect_chain'] + [result['final_url']])}")
    ok = 200 <= result["status_code"] < 400
    return f"{'RESOLVED' if ok else 'ERROR RESPONSE'}: {url}\n" + "\n".join(lines)


def _normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


@mcp.tool
async def verify_quote(url: str, quote: str, context_chars: int = 200) -> str:
    """Check whether a quoted string actually appears verbatim on a page — use this before presenting a quote/citation as fact to catch fabricated or misremembered quotes. Returns an exact match, or the closest matching passage with a similarity score if no exact match exists."""
    try:
        html, title = await _with_engine_fallback(
            lambda engine: _goto_and_extract(url, None, 15000, engine)
        )
    except PlaywrightError as exc:
        raise ToolError(f"Failed to load {url}: {_concise_error(exc)}")

    page_text = trafilatura.extract(html, url=url, output_format="txt", favor_recall=True) or _to_markdown(html)
    haystack = _normalize_text(page_text)
    needle = _normalize_text(quote)

    if not needle:
        raise ToolError("quote is empty after normalization.")

    idx = haystack.lower().find(needle.lower())
    if idx != -1:
        start = max(0, idx - context_chars)
        end = min(len(haystack), idx + len(needle) + context_chars)
        return (
            f"VERIFIED: exact match found on \"{title}\" ({url})\n\n"
            f"...{haystack[start:end]}..."
        )

    alignment = fuzz.partial_ratio_alignment(needle.lower(), haystack.lower())
    if alignment is None or alignment.score == 0:
        return f"NOT FOUND: no resemblance to this quote on \"{title}\" ({url})"

    window_start = max(0, alignment.dest_start - context_chars)
    window_end = min(len(haystack), alignment.dest_end + context_chars)
    window = haystack[window_start:window_end]
    score = alignment.score / 100

    return (
        f"NO EXACT MATCH (similarity={score:.2f}) on \"{title}\" ({url})\n\n"
        f"Closest passage:\n...{window}..."
    )


def _read_scope(workspace: str) -> list[tuple[str, str]]:
    scope = [(workspace, auth.scoped_owner(workspace))]
    if workspace != "default":
        scope.append(("default", auth.scoped_owner("default")))
    return scope


@mcp.tool
async def memory_save(
    name: str,
    type: str,
    description: str,
    content: str,
    workspace: str = "default",
    supersedes: list[str] | None = None,
    recall: str | None = None,
) -> str:
    """Save or update a persistent memory entry (e.g. facts about the user, their preferences, or ongoing project context) so it can be recalled later across sessions via memory_search. `name` is a unique slug — saving again with the same name overwrites the existing entry. `type` categorizes the subject (e.g. user, preference, project, reference). `recall` controls delivery, independently of `type`: "always" for a standing behavioral rule that must be injected into every message regardless of topic ("never do X unless asked"), "relevance" (the default) for contextual facts surfaced only when the message is semantically close, "manual" for bulky material that should never be auto-injected. `workspace` namespaces the entry. It defaults to "default", but do NOT rely on that default for project work: anything tied to a specific codebase or project (its status, decisions, bugs, task context) must pass an explicit kebab-cased slug derived from that project's repo/directory name. Call `memory_list_workspaces` first and reuse an existing close match rather than minting a near-duplicate; if no workspace fits the current project, ask the user which to create instead of silently writing to "default". Reserve "default" for what spans every project — the user's identity, cross-project preferences, people. `supersedes` is a list of existing memory names that this entry replaces — they get archived (hidden from search/list, not deleted) instead of left to compete on similarity forever."""
    owner = auth.scoped_owner(workspace)
    record = await memory.save(
        name, type, description, content, owner=owner, supersedes=supersedes, recall=recall
    )
    return f"Saved memory '{record['name']}' (type={record['type']}, recall={record['recall']})."


@mcp.tool
async def memory_search(query: str, top_k: int = 5, type: str | None = None, workspace: str = "default") -> str:
    """Semantically search saved memory entries and return the most relevant ones with their full content. Optionally filter by `type`. `workspace` scopes the search and defaults to "default"; passing a project workspace searches that workspace AND "default" together, so project-scoped work still sees identity, preferences, and standing rules. Each result is labelled with the workspace it came from.

    Call this proactively, not just at the start of a conversation — any time the current message
    references something that might already be known: a named project/machine/person, "my setup",
    "like we did before", "what did I decide about X", or any request that would benefit from prior
    context you don't already have in this conversation. When in doubt, search — it's cheap to find
    nothing, and expensive to silently re-ask the user for facts they already gave you."""
    scope = _read_scope(workspace)
    per_owner = await asyncio.gather(
        *(memory.search(query, top_k=top_k, type=type, owner=owner) for _, owner in scope)
    )
    merged: dict[str, dict] = {}
    for (name, _), entries in zip(scope, per_owner):
        for entry in entries:
            merged.setdefault(entry["name"], {**entry, "workspace": name})
    results = sorted(merged.values(), key=lambda e: e["score"], reverse=True)[:top_k]
    if not results:
        return "No memory entries found."
    blocks = [
        f"## {r['name']} (workspace={r['workspace']}, type={r['type']}, recall={r['recall']}, score={r['score']:.3f})\n{r['description']}\n\n{r['content']}"
        for r in results
    ]
    return "\n\n---\n\n".join(blocks)


@mcp.tool
async def memory_fact_search(query: str, top_k: int = 5, workspace: str = "default") -> str:
    """Semantically search facts in the knowledge graph — more precise than memory_search for narrow questions, since each fact is a single typed relationship between two entities rather than a full memory blob. Superseded (outdated) facts are excluded. `workspace` scopes the search and defaults to "default"; passing a project workspace searches that workspace AND "default" together, so project-scoped work still sees cross-project facts.

    Reach for this over memory_search when the question is narrow and factual (a specific config
    value, IP, decision, or status) rather than "tell me everything about X" — it returns just the
    matching facts instead of whole memory blobs, so it's the cheaper first call for a pointed
    question."""
    scope = _read_scope(workspace)
    per_owner = await asyncio.gather(
        *(search.fact_search(owner, query, top_k=top_k) for _, owner in scope)
    )
    merged: dict[tuple, dict] = {}
    for (name, _), facts in zip(scope, per_owner):
        for fact in facts:
            key = (fact["source"], fact["predicate"], fact["target"], fact["fact"])
            merged.setdefault(key, {**fact, "workspace": name})
    results = sorted(merged.values(), key=lambda f: f["score"], reverse=True)[:top_k]
    if not results:
        return "No facts found."
    return "\n".join(
        f"- [{r['workspace']}] {r['source']} {r['predicate']} {r['target']}: {r['fact']} (from {r['episode_name']})"
        for r in results
    )


@mcp.tool
async def memory_graph_search(entity: str, workspace: str = "default") -> str:
    """Look up an entity in the knowledge graph and return everything currently known about it — its type, a summary, and all its live relationships to other entities. Best for "what do you know about X". Superseded facts are excluded. `workspace` scopes the search — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    result = await search.graph_search(owner, entity)
    if result is None:
        return "No entity found matching that name."
    node = result["node"]
    lines = [f"{node['name']} ({node['type']})" + (f": {node['summary']}" if node["summary"] else "")]
    if not result["edges"]:
        lines.append("(no current relationships)")
    for e in result["edges"]:
        if e["outgoing"]:
            lines.append(f"- {e['predicate']} → {e['target']}: {e['fact']} (from {e['episode_name']})")
        else:
            lines.append(f"- {e['source']} {e['predicate']} → (this): {e['fact']} (from {e['episode_name']})")
    return "\n".join(lines)


@mcp.tool
async def memory_list(type: str | None = None, workspace: str = "default", include_archived: bool = False) -> str:
    """List all saved memory entries (name, type, recall tier, description, last updated) without their full content. Optionally filter by `type`. `workspace` scopes the listing and defaults to "default"; passing a project workspace lists that workspace AND "default" together, each entry labelled with the workspace it lives in. Set `include_archived=True` to also show entries archived via `supersedes` or `memory_archive`."""
    scope = _read_scope(workspace)
    per_owner = await asyncio.gather(
        *(
            memory.list_entries(type=type, owner=owner, include_archived=include_archived)
            for _, owner in scope
        )
    )
    merged: dict[str, dict] = {}
    for (name, _), entries in zip(scope, per_owner):
        for entry in entries:
            merged.setdefault(entry["name"], {**entry, "workspace": name})
    entries = sorted(merged.values(), key=lambda e: e["updated_at"], reverse=True)
    if not entries:
        return "No memory entries found."
    return "\n".join(
        f"- [{e['workspace']}] {e['name']} [{e['type']}]: {e['description']} (updated {e['updated_at']})"
        + (f" [recall={e['recall']}]" if e.get("recall") not in (None, "relevance") else "")
        + (f" (archived {e['archived_at']})" if e.get("archived_at") else "")
        for e in entries
    )


@mcp.tool
async def memory_append(name: str, text: str, workspace: str = "default") -> str:
    """Add a line or two to an existing memory entry without resending its whole body. Prefer this over `memory_save` when you are adding a fact to something that already exists — re-sending the full `content` to append one line risks silently dropping the rest of it. The entry is re-embedded and re-indexed exactly as a full save would be. `workspace` scopes the lookup — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    record = await memory.append(name, text, owner=owner)
    if record is None:
        raise ToolError(
            f"No memory entry named '{name}' in workspace '{workspace}' — use memory_save to create it."
        )
    return f"Appended to memory '{name}'."


@mcp.tool
async def memory_set_recall(name: str, recall: str, workspace: str = "default") -> str:
    """Move an existing memory between recall tiers without rewriting it — "always" (a standing rule injected into every message regardless of topic), "relevance" (the default; surfaced only when the current message is semantically close), or "manual" (never auto-injected, only returned by an explicit search). Use this when an entry was filed at the wrong tier — e.g. a standing rule saved as an ordinary preference that therefore only surfaces by luck. `workspace` scopes the lookup — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    try:
        tier = await memory.set_recall(name, recall, owner=owner)
    except ValueError as exc:
        raise ToolError(str(exc))
    if tier is None:
        raise ToolError(f"No memory entry named '{name}' in workspace '{workspace}'.")
    return f"Memory '{name}' now has recall={tier}."


@mcp.tool
async def memory_delete(name: str, workspace: str = "default") -> str:
    """Delete a saved memory entry by name. `workspace` scopes the lookup — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    deleted = await memory.delete(name, owner=owner)
    if not deleted:
        raise ToolError(f"No memory entry named '{name}' found.")
    return f"Deleted memory '{name}'."


@mcp.tool
async def memory_archive(name: str, workspace: str = "default") -> str:
    """Archive a memory entry by name — hides it from memory_search and memory_list (default), without deleting it. Use memory_restore to undo. `workspace` scopes the lookup — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    archived = await memory.archive(name, owner=owner)
    if not archived:
        raise ToolError(f"No active memory entry named '{name}' found.")
    return f"Archived memory '{name}'."


@mcp.tool
async def memory_restore(name: str, workspace: str = "default") -> str:
    """Restore a previously archived memory entry by name, making it visible again in memory_search and memory_list. `workspace` scopes the lookup — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    restored = await memory.restore(name, owner=owner)
    if not restored:
        raise ToolError(f"No archived memory entry named '{name}' found.")
    return f"Restored memory '{name}'."


@mcp.tool
async def memory_list_workspaces() -> str:
    """List all workspaces that exist for the current account."""
    clerk_id = auth.current_owner()
    workspaces = await memory.list_workspaces(clerk_id)
    return "\n".join(f"- {w}" for w in workspaces)


EXPORT_FORMAT = "continuum-memory-export"
EXPORT_VERSION = "1"


@mcp.tool
async def memory_export(workspace: str = "default") -> str:
    """Export every memory entry in a workspace (including archived ones) as a portable JSON
    document, so it can be backed up or loaded into another tool. `workspace` scopes the export —
    defaults to "default".

    Whenever the user wants to back up, migrate, or move memories between workspaces, accounts, or
    tools, reach for this plus `memory_import` — do NOT hand-re-save each entry with `memory_save`.
    Manual re-saving silently loses `recall`, `type`, and timestamps, drops archived entries
    entirely, and risks corrupting long bodies you reproduce from context. To move entries between
    workspaces: `memory_export` the source, then `memory_import` that JSON with the destination
    `workspace`, then delete the originals once you have confirmed the copies landed."""
    owner = auth.scoped_owner(workspace)
    entries = await memory.list_full(owner=owner)
    payload = {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "workspace": workspace,
        "memories": entries,
    }
    return json.dumps(payload, indent=2)


@mcp.tool
async def memory_import(data: str, workspace: str = "default") -> str:
    """Import memory entries from a JSON export into `workspace` (defaults to "default"). Accepts
    Continuum's own export format (an object with a `memories` array, as produced by
    `memory_export`) or a plain JSON array of objects with at least `name` and `content` — so
    exports from other memory tools can be adapted with minimal reshaping. Entries reuse `name` as
    the unique key, so importing overwrites an existing entry with the same name (and unarchives
    it) rather than duplicating it.

    This is the correct way to move memories into a project workspace — pair it with
    `memory_export` rather than re-saving each entry by hand, which loses metadata and archived
    entries."""
    owner = auth.scoped_owner(workspace)
    try:
        parsed = json.loads(data)
    except json.JSONDecodeError as exc:
        raise ToolError(f"Invalid JSON: {exc}")

    if isinstance(parsed, dict) and isinstance(parsed.get("memories"), list):
        raw_entries = parsed["memories"]
    elif isinstance(parsed, list):
        raw_entries = parsed
    else:
        raise ToolError("Expected a JSON array of memories, or an object with a 'memories' array.")

    imported = 0
    skipped: list[str] = []
    for i, entry in enumerate(raw_entries):
        if not isinstance(entry, dict) or not entry.get("name") or not entry.get("content"):
            skipped.append(entry.get("name") if isinstance(entry, dict) and entry.get("name") else f"#{i}")
            continue
        content = entry["content"]
        await memory.save(
            entry["name"],
            entry.get("type") or "imported",
            entry.get("description") or content[:200],
            content,
            owner=owner,
            recall=entry.get("recall"),
        )
        imported += 1

    summary = f"Imported {imported} memory entr{'y' if imported == 1 else 'ies'} into workspace '{workspace}'."
    if skipped:
        summary += f" Skipped {len(skipped)} invalid entries (missing name/content): {', '.join(skipped[:10])}"
    return summary


@mcp.resource("memory://context")
async def memory_context() -> str:
    """Your current memory context — all saved facts about this user (default workspace only). Not
    loaded automatically by most clients; read it explicitly, or prefer memory_search/memory_list for
    a query-scoped lookup instead of pulling the entire context."""
    owner = auth.scoped_owner()
    entries = await memory.list_entries(owner=owner)
    if not entries:
        return "No memories saved yet for this user."
    blocks = [
        f"### {e['name']} [{e['type']}]\n{e['description']}\n(last updated {e['updated_at']})"
        for e in entries
    ]
    return "# Continuum Memory Context\n\n" + "\n\n".join(blocks)


@mcp.prompt()
async def session_summary() -> str:
    """Call this at the end of a session to save a structured summary of what was discussed and decided."""
    owner = auth.scoped_owner()
    existing = await memory.list_entries(owner=owner)
    names = ", ".join(e["name"] for e in existing) if existing else "none yet"
    return (
        "Review this conversation and save a memory for each distinct fact, decision, preference, or project update "
        "you learned about the user. Use `memory_save` once per item — don't batch everything into one entry. "
        f"Existing memory slugs (don't duplicate): {names}. "
        "After saving, confirm to the user how many memories were saved or updated."
    )


@mcp.prompt()
async def load_context(topic: str) -> str:
    """Load relevant memories for a given topic before starting work on it."""
    return (
        f"Call `memory_search` with query='{topic}' and top_k=10, then summarize the relevant context "
        "you found in 2-3 sentences before proceeding. If nothing relevant is found, say so briefly."
    )


def _install_signal_handlers() -> None:
    def _handle(signum, _frame):
        logger.info(
            "Received %s — shutting down gracefully.", signal.Signals(signum).name
        )
        raise KeyboardInterrupt

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _handle)
        except (ValueError, OSError):
            pass


if __name__ == "__main__":
    _install_signal_handlers()
    port = int(os.environ.get("CONTINUUM_PORT", "8788"))
    logger.info("Starting Continuum MCP server on 0.0.0.0:%d", port)
    try:
        mcp.run(transport="http", host="0.0.0.0", port=port)
    except KeyboardInterrupt:
        pass
    finally:
        logger.info("Continuum MCP server stopped.")
