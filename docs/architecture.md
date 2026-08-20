# Architecture

Internals of the memory pipeline and the Claude Code hooks. See the [README](../README.md) for
setup and usage.

## Memory pipeline

Saving a memory does more than store a blob:

1. `memory_save` stores the raw entry (name/type/description/content) with its own embedding,
   immediately searchable via `memory_search`.
2. In the background, an LLM call (provider-agnostic via `litellm`) decomposes the entry into
   **atomic facts** — single, independently-verifiable claims, each with its own embedding.
   Extraction output is schema-validated (`instructor` + Pydantic) and retried on transient
   failures (`tenacity`).
3. Facts are searchable via `memory_fact_search` — more precise than whole-blob search, since a
   query only has to match one claim.
4. Re-saving a memory invalidates its previous facts rather than duplicating them
   (`invalidated_at`, not deleted) — a lightweight temporal history.
5. Deleting a memory cascades to its facts (FK constraint).

Vector search runs natively in Postgres via `pgvector`'s `<=>` operator and HNSW indexes.

## Auth & revocation

MCP tokens are RS256 JWTs minted by `backend` and verified by `core-mcp`, with no `exp` claim —
`core-mcp` instead polls `backend` for revocations every `CONTINUUM_REVOCATION_POLL_SECONDS`
(default 30s), via `CONTINUUM_INTERNAL_SECRET` / `CONTINUUM_BACKEND_PUBLIC_URL`. Revoking a
connection or token from the dashboard's Connections page takes effect within that window.

## Auto-injected context

Retrieval above is model-invoked — the client has to decide to call `memory_search`. `POST
/hook/context` is a second path: client-side automation (e.g. a Claude Code `UserPromptSubmit`
hook) can get relevant memory injected into *every* message without that decision. It embeds the
query once, gates on a top-1 cosine check so irrelevant messages inject nothing, and returns a
blob meant to be dropped straight into the host's context.

**Recall tiers** control what gets injected, independent of a memory's subject `type`:

| tier | behavior |
| --- | --- |
| `always` | Bypasses relevance gating — injected on every message, full text, under a char budget. |
| `relevance` (default) | Gated and ranked by similarity; renders as compact fact lines, not full content. |
| `manual` | Never auto-injected — explicit `memory_search`/`memory_list` only. |

Two things sharpen retrieval: short prompts (under `CONTINUUM_HOOK_QUERY_EXPAND_CHARS`, usually
deictic — "do the same for the other one") get the last 6 transcript turns folded into the query;
and matches fan out one hop along hand-curated `[[wikilinks]]` (`CONTINUUM_HOOK_LINK_FANOUT`),
which is a stronger relatedness signal than raising `top_k`.

### The hooks themselves

Everything the hooks need lives in `hooks/`, served by `core-mcp` via redirect to GitHub's
release CDN (`hooks-latest` / `hooks-payload`, synced by `.github/workflows/release-hooks.yml`)
rather than raw.githubusercontent.com, which rate-limits under load.

| file | served at | role |
| --- | --- | --- |
| `install_hook.js` | `GET /install_hook.js` | installer, run via `curl\|node` / `irm\|node` |
| `continuum_context_inject.js` | `GET /continuum_context_inject.js` | `UserPromptSubmit` hook |
| `continuum_session_capture.js` | `GET /continuum_session_capture.js` | `SessionEnd` hook |
| `continuum_self_update.js` | `GET /continuum_self_update.js` | background updater |
| `uninstall_hook.js` | `GET /uninstall_hook.js` | reverse install, no token needed |

Plain Node, no shell, no dependencies (built-in `fetch`, Node 18+) — one implementation covers
Linux/macOS/Windows. Every failure path (no token, dead network, timeout) exits 0 silently, so the
hook can never block a prompt.

The context hook spawns `continuum_self_update.js` detached, at most once every
`CONTINUUM_UPDATE_INTERVAL_HOURS` (default 24), after it has already written its own output — the
update check is never in the path of a prompt. The updater SHA-256s each installed hook against
the published copy and atomically replaces only what drifted; a payload that fails to parse as JS
is discarded rather than written. Disable with `touch ~/.continuum/no-auto-update`.

Project-scoping stays out of the hook script by design — it's a dumb lookup, not a second place
that guesses what project it's in. The model owns that decision: per `core-mcp/app/server.py`'s
`_INSTRUCTIONS`, whenever it settles on a workspace for the current directory, it read-modify-writes
`~/.continuum/workspace-map.json` (`{cwd: workspace}`). The hook reads `cwd` off its own stdin and
looks it up there; no entry means it omits `workspace` and the server falls back to `default`.
`/hook/context` always queries the resolved workspace *and* `default`, merged, so project-scoped
work never hides cross-project facts. Net effect: the first message in a new project is unscoped;
every message after the model acts once is scoped automatically.

## Session capture

Memory used to only get *written* when a model chose to call `memory_save` mid-conversation — the
same "only if it remembers" problem as retrieval. A `SessionEnd` hook posts the finished
transcript to `POST /hook/session`, which enqueues a background job that extracts durable facts
(decisions, preferences, standing rules, project state) into a **review queue** — never straight
to memory. The dashboard's Memory page shows them as proposals with Save/Discard: an automatic
writer that's wrong is worse than one that never runs, since a bad memory contaminates every later
retrieval. Disable with `~/.continuum/capture-disabled` — context injection keeps running.
