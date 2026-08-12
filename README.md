# Continuum

A persistent, personal memory system for AI agents, exposed as an MCP server — plus a small
platform (OAuth, dashboard) around it so any MCP client (Claude.ai, Claude Code, etc.) can
connect securely and keep the same memory across sessions.

| Service | Stack | Domain |
|---|---|---|
| `core-mcp` | FastMCP, Playwright, Postgres + pgvector, Alembic | continuum-mcp.sshogunn.org |
| `backend` | FastAPI, SQLAlchemy 2.0 + Alembic, Clerk, OAuth 2.0 PKCE | continuum-api.sshogunn.org |
| `frontend` | Next.js, Clerk, dashboard + consent page | continuum.sshogunn.org |

OAuth 2.0 (register → authorize → consent → token exchange) is verified working with Claude.ai.

## Connecting a client

Continuum is hosted at `continuum-mcp.sshogunn.org` — most people don't need to run any of this
themselves, just connect a client to the hosted instance:

1. Sign up / log in at the [dashboard](https://continuum.sshogunn.org).
2. **Claude Code**: `claude mcp add --transport http continuum https://continuum-mcp.sshogunn.org/mcp`
   — opens a browser to sign in and authorize.
3. **Claude.ai**: Settings → Connectors → Add custom connector →
   `https://continuum-mcp.sshogunn.org/mcp`.
4. Optional — **auto-context for Claude Code**: the dashboard's Settings → API Tokens tab shows a
   one-line `curl | bash` install command after generating a token. It wires up a
   `UserPromptSubmit` hook that injects relevant memory into every message automatically, instead
   of relying on Claude to decide to call `memory_search` (see "Auto-injected context" below). The
   hook itself does no project-detection — it auto-scopes by reading back whatever workspace the
   model already decided on for the current directory (see below), and still merges in `default`
   so cross-project facts (identity, preferences) keep showing up everywhere. The Connections page
   also has the copy-paste connect commands above.
   - Already installed from an older version? Re-run the install command — it overwrites the hook
     script in place (idempotent) and is the only way an existing install picks up this behavior.

Both connection paths (steps 2–3) go through OAuth — no token to copy/paste. The manual token used
in step 4 exists specifically for non-interactive automation (the hook script has no browser to
complete an OAuth flow with), the same way most APIs pair OAuth for apps with a separate
long-lived key for CLI/scripts. Revoking a connection or token (Connections page) takes effect
within `CONTINUUM_REVOCATION_POLL_SECONDS` (default 30s) — `core-mcp` polls `backend` for
revocations rather than checking on every request, since the JWTs here carry no `exp` claim.

## How memory works

A saved memory isn't just a blob with an embedding — saving one triggers a background pipeline:

1. **`memory_save`** stores the raw entry (name/type/description/content) with its own
   embedding, immediately searchable via `memory_search`.
2. In the background, an LLM call (provider-agnostic via `litellm` — Anthropic, OpenAI,
   Gemini, or Grok, swappable via env var) decomposes the entry into **atomic facts** — single,
   independently-verifiable claims, each with its own embedding. Extraction output is
   schema-validated (`instructor` + Pydantic) and retried with backoff on transient failures
   (`tenacity`).
3. Facts are searchable via **`memory_fact_search`** — more precise than whole-blob search
   since a query only has to match one claim, not compete against everything else in the entry.
4. Re-saving a memory **invalidates** its previous facts rather than duplicating them
   (`invalidated_at` timestamp, not deleted) — a lightweight temporal history, and the
   foundation for a future entity/relationship graph built on facts rather than raw text.
5. Deleting a memory cascades to its facts automatically (FK constraint).

Vector search throughout runs natively in Postgres via `pgvector`'s `<=>` operator and HNSW
indexes — no in-Python similarity loop.

## MCP tools

| Tool | Description |
|---|---|
| `fetch_page` / `fetch_pages` | Render page(s) via headless Chromium (Firefox fallback), return markdown. `readability=True` strips nav/sidebars. |
| `screenshot_page` | PNG screenshot of a page. |
| `fetch_image` | Download an image with a desktop User-Agent + optional Referer. |
| `search_web` | Web search via a self-hosted SearXNG instance — no paid API. |
| `check_url` | Verify a URL actually resolves — catches dead links and hallucinated URLs. |
| `verify_quote` | Check whether a quoted string appears verbatim on a page — catches fabricated/misremembered citations, fuzzy-matches (`rapidfuzz`) the closest passage if not exact. |
| `memory_save` / `memory_search` / `memory_list` / `memory_delete` | Persistent memory CRUD, per-user (scoped by JWT `owner`). |
| `memory_set_recall` | Move an existing entry between recall tiers (`always` / `relevance` / `manual`) without rewriting it. |
| `memory_fact_search` | Semantic search over extracted atomic facts (see above). |

Plus an MCP resource (`memory://context` — full memory context; not auto-loaded by most clients,
call it explicitly) and two prompts (`session_summary`, `load_context`).

### Auto-injected context (bypassing the tool-call round trip)

Because retrieval above is entirely model-invoked — the connected LLM has to decide to call
`memory_search` — a `POST /hook/context` route offers a second path for client-side automation
that wants relevant memory injected into *every* message without relying on that decision.
Bearer-JWT-gated (same manual/OAuth tokens the MCP transport already accepts — mint one from the
dashboard's Settings page), it embeds the query once, gates on a cheap top-1 cosine check so
irrelevant messages inject nothing (`{"context": null}`), and otherwise returns a blob meant to be
dropped into a host's per-message context hook — e.g. a Claude Code `UserPromptSubmit` hook.
`GET /install-hook.sh` (`core-mcp/app/scripts/install-hook.sh`) serves a self-contained installer
for exactly that hook — idempotent, safe to re-run, merges into `~/.claude/settings.json` rather
than overwriting it.

What gets injected is decided by a memory's **recall tier**, a column independent of its subject
`type`, because the two axes fail in opposite directions:

| tier | behavior | rendered as |
| --- | --- | --- |
| `always` | Bypasses the relevance gate and the similarity ranking entirely — injected on every message. | Full rule text, newest first, under a char budget (`CONTINUUM_HOOK_DIRECTIVE_*`); anything past the budget degrades to a one-liner rather than being dropped. |
| `relevance` (default) | Gated and ranked as before. | Compact progressive disclosure — fact lines + memory names/descriptions, not full content. |
| `manual` | Never auto-injected. | — (explicit `memory_search`/`memory_list` only) |

A standing behavioral rule ("never do X unless explicitly asked") is useless if it only surfaces
when the message happens to embed near it, and equally useless if it surfaces as a bare title — so
`always` entries carry their body. Contextual facts have the opposite problem (they'd bloat every
prompt), so they stay lean and the model calls `memory_search` for detail. Only `relevance`-tier
rows can open the gate: an always-on rule that tripped it would drag unrelated memories in on every
message it embeds near. Always-on entries also skip knowledge-graph extraction — a rule isn't a
fact about an entity, and extracting one just pollutes the graph. The dashboard's Memory page flags
entries whose text reads like a rule but sits on a lower tier (imperative statements — "never …",
"unless explicitly asked") and offers one-click promotion; nothing is ever reclassified
automatically.

Project-scoping is deliberately kept out of the hook script — it stays a dumb lookup, not a second
place that has to guess what project it's in. The model owns that decision: per rule 7 in
`core-mcp/app/server.py`'s `_INSTRUCTIONS`, whenever it settles on a workspace for the project it's
working in (checking `memory_list_workspaces` first, same as any other project-scoped tool call),
it also read-modify-writes `~/.continuum/workspace-map.json` — a flat `{cwd: workspace}` object —
with an entry for the current working directory. The installed hook reads `cwd` off its own stdin
payload and looks it up in that same file; no entry means it omits `workspace` and the server falls
back to `default`, same as before. `/hook/context` queries the resolved workspace plus the
account's `default` workspace and merges the two (deduped by memory name), so a project-scoped
workspace can never hide cross-project facts that still live in `default`. Net effect: the first
message in a brand-new project session is unscoped (nothing in the map yet), and every message
after the model has acted once is scoped without the hook doing any detection of its own.

## Running it

```bash
cp .env.example .env               # fill in CF_TUNNEL_TOKEN
cp core-mcp/.env.example core-mcp/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# fill in each — see the per-file comments for what's required vs optional

docker compose up -d --build
```

One root `docker-compose.yml` runs all four containers (`frontend`, `backend`, `core-mcp`,
`cloudflared`) on a shared network. `backend` and `core-mcp` publish no host ports — reachable
only via the Docker network and, externally, through the `cloudflared` tunnel. Dev-mode hot
reload is on for all three app services.

`core-mcp`'s schema is managed by Alembic — the compose command runs `alembic upgrade head`
before starting the server, so schema changes just need a new migration file in
`core-mcp/alembic/versions/`.

### Running a service outside Docker

Each service is independently runnable:

```bash
cd core-mcp && uv sync && uv run playwright install chromium firefox
uv run alembic upgrade head
uv run python -m app.server

cd backend && uv sync && uv run alembic upgrade head && uv run python main.py

cd frontend && npm install && npm run dev
```

## Repo layout

```
core-mcp/
  app/
    server.py        # FastMCP app, tool definitions, lifespan
    auth.py           # JWT verification
    infra/            # pg.py, db.py, browser_pool.py
    memory/            # memory.py, facts.py, embeddings.py
  alembic/            # schema migrations
backend/
  app/                # FastAPI routes, OAuth, token management
  alembic/
frontend/
  src/app/            # Next.js app router — dashboard, oauth-connect, landing
docker-compose.yml     # not tracked in git — see .env.example files
```

## Environment variables

Each service has an `.env.example` with inline comments for every variable. Notably:

- `core-mcp`: `CONTINUUM_DATABASE_URL`, `CONTINUUM_JWT_PUBLIC_KEY`,
  `CONTINUUM_FACT_EXTRACTION_MODEL`/`_API_KEY` (litellm model string, e.g.
  `anthropic/claude-haiku-4-5-20251001`), `CONTINUUM_SEARXNG_URL` (optional, for `search_web` —
  defaults to the self-hosted `searxng` service in the root compose file). `CONTINUUM_INTERNAL_SECRET`
  and `CONTINUUM_BACKEND_PUBLIC_URL` are also used to poll `backend` for revoked tokens
  (`CONTINUUM_REVOCATION_POLL_SECONDS`, default 30, controls how often).
- `backend`: `DATABASE_URL`, Clerk keys, `CONTINUUM_BACKEND_JWT_PRIVATE_KEY` (paired with
  core-mcp's public key)
- `frontend`: Clerk keys, `BACKEND_INTERNAL_URL`
- root: `CF_TUNNEL_TOKEN` (Cloudflare tunnel, for `cloudflared`)
