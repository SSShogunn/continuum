# Continuum

Persistent memory for AI agents, exposed as an MCP server. Connect Claude Code, Claude.ai, or
any MCP client, and it remembers your preferences, decisions, and project context across
sessions instead of starting from zero every time.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[![Continuum demo](frontend/src/assets/continuum-demo.gif)](frontend/src/assets/continuum-demo.mp4)

<sub>Click the GIF for the full 89-second video with sound.</sub>

## Quick start

Use the hosted instance — no setup required:

1. Sign up at [continuum.sshogunn.org](https://continuum.sshogunn.org).
2. Connect a client:
   - **Claude Code**: `claude mcp add --transport http continuum https://continuum-mcp.sshogunn.org/mcp`
   - **Claude.ai**: Settings → Connectors → Add custom connector → `https://continuum-mcp.sshogunn.org/mcp`
3. Optional — install the Claude Code hooks so memory gets injected into every prompt
   automatically (no tool call needed) and durable facts from your sessions are saved for you:
   ```bash
   # macOS / Linux / WSL / Git Bash
   curl -fsSL https://continuum-mcp.sshogunn.org/install_hook.js | CONTINUUM_TOKEN=<token> node
   ```
   ```powershell
   # Windows PowerShell
   $env:CONTINUUM_TOKEN="<token>"; irm https://continuum-mcp.sshogunn.org/install_hook.js | node -
   ```
   Get `<token>` from the dashboard's Connections page. Needs Node 18+ on `PATH` (same
   requirement as Claude Code itself).

Both connect paths go through OAuth — no token to copy/paste there. The manual token above is
just for the hook script, which has no browser to complete OAuth with.

Prefer to run your own instance? See [Self-hosting](#self-hosting).

## What it does

- **Persistent memory** — save, search, list, append, archive and delete entries, scoped per
  user and per project **workspace** (every workspace is searched together with `default`).
- **Recall tiers** — `always` (standing rules, injected every message), `relevance` (surfaced on
  semantic match), `manual` (explicit lookup only).
- **Knowledge graph** — every saved memory is extracted in the background into entities and
  relationships. Each relationship is a one-sentence fact with its own embedding, searchable via
  `memory_fact_search` and `memory_graph_search`. Facts that a newer memory contradicts are
  marked no-longer-true rather than deleted.
- **Auto-injected context** — an optional Claude Code hook injects relevant memory into every
  prompt without the model deciding to call a tool, and never repeats what the session has
  already been shown.
- **Session capture** — the same hook install captures durable facts from your sessions (before
  compaction and at session end) and saves them directly, merging into existing entries instead
  of duplicating them.
- **Web tools** — `fetch_page`, `screenshot_page`, `search_web` (self-hosted SearXNG, no paid
  API), `check_url`, `verify_quote`, `extract_structured`.
- **OAuth 2.0** — PKCE flow with dynamic client registration, verified working with Claude.ai.

Full breakdown of how the memory pipeline and hooks work: [docs/architecture.md](docs/architecture.md).

## MCP tools

| Tool | Description |
|---|---|
| `fetch_page` / `fetch_pages` | Render page(s) via headless Chromium (Firefox fallback), return markdown. |
| `screenshot_page` | PNG screenshot of a page. |
| `fetch_image` | Download an image with a desktop User-Agent + optional Referer. |
| `search_web` | Web search via a self-hosted SearXNG instance. |
| `check_url` | Verify a URL actually resolves. |
| `verify_quote` | Check whether a quoted string appears verbatim on a page, fuzzy-matching the closest passage if not. |
| `extract_structured` | Fetch a page and extract JSON matching a schema or a plain-language field list (LLM). |
| `memory_save` / `memory_search` / `memory_list` / `memory_delete` | Persistent memory CRUD. |
| `memory_append` | Add a line to an existing memory without resending its whole body. |
| `memory_set_recall` | Move a memory between recall tiers (`always` / `relevance` / `manual`). |
| `memory_archive` / `memory_restore` | Hide an entry from search and listing without deleting it, and undo that. |
| `memory_fact_search` | Hybrid (semantic + full-text) search over knowledge-graph facts. |
| `memory_graph_search` | Everything currently known about one entity: type, summary, live relationships. |
| `memory_list_workspaces` | List the account's workspaces. |
| `memory_export` / `memory_import` | Portable JSON export of a workspace, and import into one. |

## Self-hosting

Continuum is a normal Docker Compose stack. It's MIT-licensed — clone it and run your own
instance instead of (or alongside) the hosted one.

**1. Create a Clerk application** — auth runs on [Clerk](https://clerk.com) (free tier is
enough). From the API Keys page, grab:
- `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` → `backend/.env`
- the same publishable key as `VITE_CLERK_PUBLISHABLE_KEY` → `frontend/.env`

**2. Generate secrets:**
```bash
openssl rand -hex 32   # → POSTGRES_PASSWORD (root .env)
openssl rand -hex 32   # → REDIS_PASSWORD (root .env)
openssl rand -hex 32   # → CONTINUUM_INTERNAL_SECRET (must match in backend/.env and core-mcp/.env)

# RS256 keypair backend mints MCP tokens with, core-mcp verifies with
openssl genrsa -out /tmp/continuum_jwt 2048
openssl rsa -in /tmp/continuum_jwt -pubout -out /tmp/continuum_jwt.pub

# each printed as one line with literal \n, ready to paste into the .env files below
awk 'NF {printf "%s\\n", $0}' /tmp/continuum_jwt      # → backend/.env CONTINUUM_BACKEND_JWT_PRIVATE_KEY
awk 'NF {printf "%s\\n", $0}' /tmp/continuum_jwt.pub  # → core-mcp/.env CONTINUUM_JWT_PUBLIC_KEY
rm /tmp/continuum_jwt /tmp/continuum_jwt.pub
```

**3. Fill in the `.env` files:**
```bash
cp core-mcp/.env.example core-mcp/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```
Fill in the Clerk keys and generated secrets/keypair above — each file's comments say what's
required vs optional. You'll also need an LLM API key for `CONTINUUM_FACT_EXTRACTION_API_KEY`
(fact extraction) and `CONTINUUM_EXTRACT_API_KEY` (structured extraction) — any
[litellm-supported provider](https://docs.litellm.ai/docs/providers) works, and they don't need
to be the same one.

**4. Run it:**
```bash
docker compose up -d --build
```
This starts `frontend` (:3000, or `FRONTEND_PORT` from the root `.env`), `backend` (:8789),
`core-mcp` (:8788), plus `worker`, `postgres`, `redis`, and `searxng` — all reachable on
localhost, no extra setup. `postgres` also publishes to `127.0.0.1:5432` for a host-local client.
Schema migrations (`alembic upgrade head`) run automatically on boot.

The frontend image is a static Vite build served by nginx, so its `VITE_*` values from
`frontend/.env` are baked in when the image is built. After changing them, rebuild with
`docker compose up -d --build frontend`.

To expose it beyond localhost, put a reverse proxy (Caddy, nginx, Traefik) in front of ports
3000/8789/8788, or set `CF_TUNNEL_TOKEN` in the root `.env` and run
`docker compose --profile tunnel up -d --build` to use the built-in Cloudflare Tunnel instead —
that container only starts when the `tunnel` profile is requested. Either way, once you have a
public URL, update `VITE_BACKEND_URL` (frontend), `CONTINUUM_FRONTEND_URL` /
`CONTINUUM_BACKEND_PUBLIC_URL` (backend), and `CONTINUUM_BACKEND_PUBLIC_URL` /
`VITE_CONTINUUM_MCP_URL` (core-mcp / frontend) to match, then rebuild.

First run: visit the frontend and sign up — that's your account — then connect a client as in
[Quick start](#quick-start), pointing at your own URLs instead of the hosted ones.

### Running a service outside Docker

```bash
cd core-mcp && uv sync && uv run playwright install chromium firefox
uv run alembic upgrade head
uv run python -m app.server

cd core-mcp && uv run arq app.worker.WorkerSettings   # background jobs: graph build, session capture

cd backend && uv sync && uv run alembic upgrade head && uv run python main.py

cd frontend && pnpm install && pnpm dev
```

### Tests

```bash
cd core-mcp && PYTHONPATH=. uv run pytest tests   # hook context assembly, capture merge rules, storage
node --test hooks/test/hooks.test.js              # hook scripts against a fake server
```

## Repo layout

```
core-mcp/
  app/
    server.py         # FastMCP app, MCP tools, /hook/* and /internal/* routes
    worker.py         # arq worker: graph build, session capture, log pruning
    auth.py           # JWT verification + revocation polling
    infra/            # pg.py, db.py, redis.py, browser_pool.py
    memory/           # memory.py, search.py, prompt.py (hook context), capture.py,
                      # kg.py / extract.py / resolve.py / edges.py (knowledge graph),
                      # hook_session.py, embeddings.py, llm.py
  alembic/            # schema migrations
  tests/
backend/
  app/                # FastAPI routes, OAuth, token management
  alembic/
frontend/
  src/pages/          # Vite SPA — dashboard, oauth-connect, landing
  nginx.conf          # static serving + SPA fallback for the Docker image
hooks/                # Claude Code hooks, installer, updater (Node, no deps) + tests
docker-compose.yml    # all services — secrets come from the .env files, see .env.example
```

## Environment variables

Each service has an `.env.example` with inline comments for every variable. Notably:

- `core-mcp`: `CONTINUUM_DATABASE_URL`, `CONTINUUM_JWT_PUBLIC_KEY`,
  `CONTINUUM_FACT_EXTRACTION_MODEL` / `_API_KEY` (litellm model string), `CONTINUUM_SEARXNG_URL`
  (optional — defaults to the self-hosted `searxng` service).
- `backend`: `DATABASE_URL`, Clerk keys, `CONTINUUM_BACKEND_JWT_PRIVATE_KEY` (paired with
  core-mcp's public key).
- `frontend`: `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_BACKEND_URL` (called cross-origin with CORS),
  `VITE_CONTINUUM_MCP_URL` (shown in the dashboard's connect/install commands). Read at build
  time.
- root: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `FRONTEND_PORT` (optional), and (optional,
  `tunnel` profile only) `CF_TUNNEL_TOKEN`.

## License

[MIT](LICENSE)
