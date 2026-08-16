# Continuum

A persistent, personal memory system for AI agents, exposed as an MCP server — plus a small
platform (OAuth, dashboard) around it so any MCP client (Claude.ai, Claude Code, etc.) can
connect securely and keep the same memory across sessions.

| Service | Stack | Domain |
|---|---|---|
| `core-mcp` | FastMCP, Playwright, Postgres + pgvector, Alembic | continuum-mcp.sshogunn.org |
| `backend` | FastAPI, SQLAlchemy 2.0 + Alembic, Clerk, OAuth 2.0 PKCE | continuum-api.sshogunn.org |
| `frontend` | Vite, React 19, Clerk, dashboard + consent page | continuum.sshogunn.org |

OAuth 2.0 (register → authorize → consent → token exchange) is verified working with Claude.ai.

## Connecting a client

Continuum is hosted at `continuum-mcp.sshogunn.org` — most people don't need to run any of this
themselves, just connect a client to the hosted instance:

1. Sign up / log in at the [dashboard](https://continuum.sshogunn.org).
2. **Claude Code**: `claude mcp add --transport http continuum https://continuum-mcp.sshogunn.org/mcp`
   — opens a browser to sign in and authorize.
3. **Claude.ai**: Settings → Connectors → Add custom connector →
   `https://continuum-mcp.sshogunn.org/mcp`.
4. Optional — **auto-context for Claude Code**: the dashboard's Connections page shows a one-line
   install command after generating a token, for whichever platform you're on:

   ```bash
   # macOS / Linux / WSL / Git Bash
   curl -fsSL https://continuum-mcp.sshogunn.org/install_hook.js | CONTINUUM_TOKEN=<token> node
   ```
   ```powershell
   # Windows PowerShell
   $env:CONTINUUM_TOKEN="<token>"; irm https://continuum-mcp.sshogunn.org/install_hook.js | node -
   ```

   It wires up a `UserPromptSubmit` hook that injects relevant memory into every message
   automatically, instead of relying on Claude to decide to call `memory_search` (see
   "Auto-injected context" below). The hook itself does no project-detection — it auto-scopes by
   reading back whatever workspace the model already decided on for the current directory (see
   below), and still merges in `default` so cross-project facts (identity, preferences) keep
   showing up everywhere. The Connections page also has the copy-paste connect commands above.
   - Needs Node 18+ on `PATH` — the same runtime Claude Code itself already requires, so nothing
     extra to install for most people; the installer checks and says so if it's missing.
   - Already installed from an older version? Re-run the install command — it replaces the hook
     scripts and their `settings.json` entries in place (idempotent), including the Python-based
     hooks earlier versions shipped.

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
| `memory_append` | Add a line to an existing entry without resending its whole body — re-embeds and re-indexes like a full save. |
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

The installer for exactly that hook is idempotent, safe to re-run, and merges into
`~/.claude/settings.json` rather than overwriting it. Everything it needs lives in `hooks/`, and
`core-mcp` serves it by redirecting to GitHub's release CDN (two rolling releases, `hooks-latest`
and `hooks-payload`, kept in sync with `hooks/` by `.github/workflows/release-hooks.yml`) rather
than shipping it in the image or serving raw.githubusercontent.com directly (which rate-limits
under load), so an install never depends on what a container happens to have on disk. The URLs stay
flat at the root even though the files sit in a subdirectory — already-installed hooks fetch their
own updates through them:

| `hooks/` | served at | role |
| --- | --- | --- |
| `install_hook.js` | `GET /install_hook.js` | the installer, run directly via `curl\|node` / `irm\|node` |
| `continuum_context_inject.js` | `GET /continuum_context_inject.js` | the `UserPromptSubmit` hook |
| `continuum_session_capture.js` | `GET /continuum_session_capture.js` | the `SessionEnd` hook |
| `continuum_self_update.js` | `GET /continuum_self_update.js` | the background updater |
| `uninstall_hook.js` | `GET /uninstall_hook.js` | the reverse, no token needed |

Everything is **plain Node with no shell and no dependencies** (built-in `fetch`, so Node 18+),
which is what makes one implementation cover Linux, macOS and Windows: no bash, no `curl`, no
interpreter-name guessing (`settings.json` gets `"<abs node> <abs hook>.js"`, resolved at install
time via `process.execPath`). Every failure path — no token, dead network, unparseable stdin,
timeout — exits 0 silently, so the hook can never block a prompt. Re-running the installer also
migrates cleanly off the older Python-based hooks this project shipped before, removing the old
`.py` files and `settings.json` entries rather than running both side by side.

The hooks keep themselves current. At most once every `CONTINUUM_UPDATE_INTERVAL_HOURS` (default
24) the context hook spawns `continuum_self_update.js` **detached, after it has already written its
output**, and exits without waiting — nothing about the update is ever in the path of a prompt. The
updater SHA-256s each installed hook against the published copy and atomically replaces only what
drifted, itself included; a payload that fails to parse as JS (`vm.Script`) is discarded rather than
written, so a 404 page or a truncated download can't brick the hook. Disable with
`touch ~/.continuum/no-auto-update`, or run the updater by hand to force a check.

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

Two things sharpen what that route retrieves. **Short prompts get expanded**: a message under
`CONTINUUM_HOOK_QUERY_EXPAND_CHARS` (80) is usually deictic — "do the same for the other one" —
and embeds nowhere near anything stored, so the hook ships the tail of the conversation
(`transcript_path`, last 6 turns) and the server folds it into the retrieval query behind the
current message. Longer messages carry their own signal and are left alone, since padding them
only blurs the query. **Matches then fan out one hop along `[[wikilinks]]`**
(`CONTINUUM_HOOK_LINK_FANOUT`, 3): the link graph is hand-curated, so a link is a stronger claim
of relatedness than embedding proximity, and one hop beats raising `top_k` — which just drags in
the next-most-similar blob. Every injection is logged through the same path as a tool call, so
what the hook actually sent shows up in the Activity view instead of vanishing.

### Session capture (memory that writes itself)

Retrieval is only half the loop — memory still only got *written* when a model chose to call
`memory_save` mid-conversation, which is the same "only if it remembers to" failure the always-on
tier fixes for reads. A `SessionEnd` hook posts the finished transcript to `POST /hook/session`,
which enqueues an arq job that extracts durable facts (decisions, preferences, standing rules,
project state) and writes them to a **review queue** — never straight to memory. The dashboard's
Memory page shows them as proposals with Save/Discard. Nothing is auto-written, deliberately: an
automatic writer that is wrong is worse than one that never runs, because a bad memory then
contaminates every later retrieval. Disable it alone by creating the file
`~/.continuum/capture-disabled` (`New-Item ~\.continuum\capture-disabled` on Windows), which leaves
context injection running.

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

One root `docker-compose.yml` runs all eight containers (`frontend`, `backend`, `core-mcp`,
`worker`, `postgres`, `redis`, `searxng`, `cloudflared`) on a shared network. Only `frontend`
publishes a host port (3000) — everything else is reachable via the Docker network and,
externally, through the `cloudflared` tunnel. That includes `postgres`, so reach it with
`docker compose exec postgres psql -U continuum continuum` rather than a host-local client.
Dev-mode hot reload is on for all three app services.

Every service is `restart: unless-stopped`, and `postgres`/`redis` carry healthchecks that
`backend`, `core-mcp`, and `worker` wait on via `depends_on.condition: service_healthy` — on a
cold boot the `alembic upgrade head` that runs before each app service would otherwise race a
Postgres that isn't accepting connections yet.

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
docker-compose.yml     # all services — secrets come from the .env files, see .env.example
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
