import asyncio
import logging
import os
import re
import signal
import time
from . import auth
from .infra import browser_pool, db, pg
from .infra import redis as redis_infra
from .memory import facts, graph, memory
import html2text
import httpx
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


@asynccontextmanager
async def lifespan(server: "FastMCP"):
    await browser_pool.start()
    await pg.start()
    await redis_infra.start()
    await db.start()
    await memory.start()
    try:
        yield {}
    finally:
        await memory.stop()
        await db.stop()
        await redis_infra.stop()
        await pg.stop()
        await browser_pool.stop()


class RequestLoggingMiddleware(Middleware):
    async def on_call_tool(self, context: MiddlewareContext, call_next):
        tool = context.message.name
        arguments = context.message.arguments
        started = time.perf_counter()
        try:
            result = await call_next(context)
        except Exception as exc:
            duration = (time.perf_counter() - started) * 1000
            db.log_request(
                tool, arguments, "error", error=repr(exc), duration_ms=duration
            )
            raise
        duration = (time.perf_counter() - started) * 1000
        db.log_request(
            tool,
            arguments,
            "ok",
            response=str(getattr(result, "content", result)),
            duration_ms=duration,
        )
        return result


_INSTRUCTIONS = """
You are connected to Continuum — a persistent, personal memory system. Continuum is multi-tenant:
each connected user authenticates via their own account, and every memory you save here is
strictly scoped to that account via the active auth token — you cannot see or affect any other
user's data through this connection. Within their own scope, every entry this user saves can be
reviewed or removed at any time via `memory_list`/`memory_delete` or their dashboard. The
auto-save-without-confirmation workflow below is the tool's intended design for its own account
owner, not a bypass of one — removing that per-item friction is the whole point of the tool.

## Memory rules

1. **At the start of every conversation**, call `memory_search` with a brief description of the
   topic to load relevant context. Do not ask the user what they want to remember — just search.

2. **During the conversation**, if the user reveals any of the following, call `memory_save`
   immediately (do not wait until the end), without pausing to confirm first:
    - A preference, habit, or opinion ("I prefer X", "I always do Y", "I hate Z")
    - A project name, goal, or deadline
    - A person, place, or organization they care about
    - A decision they've made
    - A fact they want you to remember

3. **At the end of every conversation**, call `memory_save` for any key facts learned that you
   haven't already saved. Use `type=user` for personal facts, `type=project` for work context,
   `type=preference` for stated preferences, `type=reference` for links/resources.

4. **When updating an existing memory**, use the same `name` slug — this overwrites rather than
   duplicating.

5. If the user asks "what do you know about me?" or "what do you remember?", call `memory_list`
   first, then `memory_search` with relevant terms.

## Memory naming convention
Use kebab-case slugs that describe the content: `user-role`, `project-continuum-status`, `preference-coding-style`, `person-alice-context`.
""".strip()

mcp = FastMCP(
    "Continuum",
    instructions=_INSTRUCTIONS,
    lifespan=lifespan,
    icons=[
        Icon(
            src="https://continuum-mcp.sshogunn.org/icon.svg", mimeType="image/svg+xml"
        )
    ],
    auth=auth.build_verifier(),
)
mcp.add_middleware(RequestLoggingMiddleware())


@mcp.custom_route("/icon.svg", methods=["GET"])
async def serve_app_icon(request: Request) -> Response:
    return Response(ICON_PATH.read_bytes(), media_type="image/svg+xml")


def _check_internal_secret(request: Request) -> bool:
    secret = os.environ.get("CONTINUUM_INTERNAL_SECRET", "")
    return bool(secret) and request.headers.get("X-Internal-Secret") == secret


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
    owner_facts = await facts.list_by_owner(owner)
    owner_entities = await graph.list_by_owner(owner)

    facts_by_source: dict[str, list[dict]] = {}
    for f in owner_facts:
        facts_by_source.setdefault(f["source_name"], []).append(f)
    entities_by_source: dict[str, list[dict]] = {}
    for e in owner_entities:
        entities_by_source.setdefault(e["source_name"], []).append(e)

    for entry in entries:
        entry["facts"] = facts_by_source.get(entry["name"], [])
        entry["entities"] = entities_by_source.get(entry["name"], [])

    return JSONResponse({
        "workspace": workspace,
        "workspaces": await memory.list_workspaces(clerk_id),
        "entries": entries,
    })


@mcp.custom_route("/internal/memory/delete", methods=["POST"])
async def internal_memory_delete(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    body = await request.json()
    owner = auth.compose_owner(body.get("clerk_id", ""), body.get("workspace", "default"))
    deleted = await memory.delete(body["name"], owner=owner)
    return JSONResponse({"deleted": deleted})


@mcp.custom_route("/internal/stats", methods=["GET"])
async def internal_stats(request: Request) -> Response:
    if not _check_internal_secret(request):
        return Response("Forbidden", status_code=403)
    stats = await db.get_stats()
    return JSONResponse(stats)


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
            "snippet": r.get("content", ""),
            "published": r.get("publishedDate") or "",
        }
        for r in results[:count]
    ]


@mcp.tool
async def search_web(query: str, count: int = 10) -> str:
    """Search the web via a self-hosted SearXNG instance and return structured results (title, URL, snippet, published date)."""
    results = await _searxng_search(query, count)

    if not results:
        return "No results found."

    blocks = [
        f"## {r['title']}\n{r['url']}\n{r['snippet']}" + (f"\n({r['published']})" if r["published"] else "")
        for r in results
    ]
    return "\n\n---\n\n".join(blocks)


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


@mcp.tool
async def memory_save(name: str, type: str, description: str, content: str, workspace: str = "default") -> str:
    """Save or update a persistent memory entry (e.g. facts about the user, their preferences, or ongoing project context) so it can be recalled later across sessions via memory_search. `name` is a unique slug — saving again with the same name overwrites the existing entry. `type` categorizes the entry (e.g. user, preference, project, reference). `workspace` namespaces the entry (e.g. work, personal) — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    record = await memory.save(name, type, description, content, owner=owner)
    return f"Saved memory '{record['name']}' (type={record['type']})."


@mcp.tool
async def memory_search(query: str, top_k: int = 5, type: str | None = None, workspace: str = "default") -> str:
    """Semantically search saved memory entries and return the most relevant ones with their full content. Optionally filter by `type`. `workspace` scopes the search — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    results = await memory.search(query, top_k=top_k, type=type, owner=owner)
    if not results:
        return "No memory entries found."
    blocks = [
        f"## {r['name']} (type={r['type']}, score={r['score']:.3f})\n{r['description']}\n\n{r['content']}"
        for r in results
    ]
    return "\n\n---\n\n".join(blocks)


@mcp.tool
async def memory_fact_search(query: str, top_k: int = 5, workspace: str = "default") -> str:
    """Semantically search atomic facts extracted from saved memories — more precise than memory_search for narrow questions, since each fact is a single claim rather than a full memory blob. `workspace` scopes the search — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    results = await facts.search(owner, query, top_k=top_k)
    if not results:
        return "No facts found."
    return "\n".join(
        f"- {r['content']} (from {r['source_name']}, score={r['score']:.3f})"
        for r in results
    )


@mcp.tool
async def memory_graph_search(entity: str, workspace: str = "default") -> str:
    """Find memories connected to a named entity via the knowledge graph (people, orgs, places, dates, concepts, projects extracted from saved facts). `workspace` scopes the search — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    results = await graph.search(owner, entity)
    if not results:
        return "No graph entries found for that entity."
    return "\n".join(
        f"- {r['entity_display']} ({r['entity_type']}) {r['relation']} — from '{r['source_name']}': {r['fact_content']}"
        for r in results
    )


@mcp.tool
async def memory_list(type: str | None = None, workspace: str = "default") -> str:
    """List all saved memory entries (name, type, description, last updated) without their full content. Optionally filter by `type`. `workspace` scopes the listing — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    entries = await memory.list_entries(type=type, owner=owner)
    if not entries:
        return "No memory entries found."
    return "\n".join(
        f"- {e['name']} [{e['type']}]: {e['description']} (updated {e['updated_at']})"
        for e in entries
    )


@mcp.tool
async def memory_delete(name: str, workspace: str = "default") -> str:
    """Delete a saved memory entry by name. `workspace` scopes the lookup — defaults to "default"."""
    owner = auth.scoped_owner(workspace)
    deleted = await memory.delete(name, owner=owner)
    if not deleted:
        raise ToolError(f"No memory entry named '{name}' found.")
    return f"Deleted memory '{name}'."


@mcp.resource("memory://context")
async def memory_context() -> str:
    """Your current memory context — all saved facts about this user (default workspace only). Loaded automatically."""
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
