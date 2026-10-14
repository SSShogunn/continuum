# Architecture

Internals of the memory pipeline and the Claude Code hooks. See the [README](../README.md) for
setup and usage.

## Memory pipeline

Saving a memory does more than store a blob:

1. `memory_save` stores the raw entry (name/type/recall/description/content) with its own
   embedding, immediately searchable via `memory_search`. Re-saving identical content is a no-op:
   no re-embedding, no graph job.
2. A `build_graph_job` is queued to the `worker` (arq on Redis). An LLM call (provider-agnostic via
   `litellm`, schema-validated with `instructor` + Pydantic, retried with `tenacity`) extracts
   **entities** (name, type from a fixed taxonomy, one-line summary) and **relationships**
   between them. Each relationship carries a one-sentence `fact`, its own embedding, and
   optional `valid_at` / `invalid_at` times.
3. **Entity resolution** (`memory/resolve.py`): each extracted entity is matched against existing
   nodes by embedding (cosine gate, then an LLM judgement on the candidates), so "Postgres" and
   "PostgreSQL" become one node rather than two.
4. **Edge resolution** (`memory/edges.py`): the memory's own previous edges are replaced. Each new
   edge is compared with existing live edges between the same entities (or semantically close
   ones). An LLM marks it as a duplicate (skipped) or as contradicting older edges, which get
   `invalid_at` / `expired_at` set instead of being deleted — a lightweight temporal history.
5. Facts are searchable via `memory_fact_search` (hybrid semantic + full-text, only live edges)
   and per entity via `memory_graph_search`. Both are more precise than whole-blob search, since a
   query only has to match one claim.
6. Deleting a memory cascades to the edges it produced (FK on `entity_edge.episode_name`).

Embeddings are computed locally in `core-mcp` with `fastembed` (`BAAI/bge-small-en-v1.5`, 384
dimensions, override with `CONTINUUM_EMBEDDING_MODEL`). Vector search runs natively in Postgres via
`pgvector`'s `<=>` operator and HNSW indexes; lexical search uses Postgres full-text indexes, and
the two are fused with reciprocal rank fusion.

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

Retrieval details:

- **Embedded once.** The query is embedded a single time and reused for the gate and for every
  owner's memory and fact search (the MCP `memory_search`/`memory_fact_search` tools do the same
  across workspaces).
- **Per-item floor.** Past the top-1 gate, each semantic hit must also clear
  `CONTINUUM_HOOK_ITEM_FLOOR` (defaults to the gate), so one strong match doesn't carry weak
  neighbours in. Lexical hits are exact-term matches and are kept.
- **Ranked across workspaces.** Results from the project workspace and `default` are deduped and
  ranked together (memories: `top_k`, facts: `CONTINUUM_HOOK_FACT_LIMIT`), not concatenated.
- **Short prompts** (under `CONTINUUM_HOOK_QUERY_EXPAND_CHARS`, usually deictic — "do the same for
  the other one") get the last 6 transcript turns folded into the query.
- **Link fan-out:** matches fan out one hop along hand-curated `[[wikilinks]]`
  (`CONTINUUM_HOOK_LINK_FANOUT`), a stronger relatedness signal than raising `top_k`.

**Per-session dedup.** Hooks send Claude Code's `session_id`. The server keeps, in Redis per
account and session (`CONTINUUM_HOOK_SESSION_TTL_SECONDS`, default 24h), the digest of the standing
rules last sent and the memories/facts already surfaced:

- `SessionStart` (startup, resume, clear, compact) calls `/hook/context` with
  `event: "session_start"`: it returns the workspace note and standing rules, and resets the
  session's record — compaction or `/clear` removed earlier injections from the model's view.
- Each prompt then gets standing rules only if they changed mid-session (marked "updated"), and
  only memories/facts this session hasn't been shown.
- Hooks that send no `session_id` (older installs) keep the inject-everything behaviour. A Redis
  failure degrades to sending, never to dropping.

### The hooks themselves

Everything the hooks need lives in `hooks/`, served by `core-mcp` via redirect to GitHub's
release CDN (`hooks-latest` / `hooks-payload`, synced by `.github/workflows/release-hooks.yml`)
rather than raw.githubusercontent.com, which rate-limits under load.

| file | served at | role |
| --- | --- | --- |
| `install_hook.js` | `GET /install_hook.js` | installer, run via `curl\|node` / `irm\|node` |
| `continuum_context_inject.js` | `GET /continuum_context_inject.js` | `UserPromptSubmit` + `SessionStart` hook |
| `continuum_session_capture.js` | `GET /continuum_session_capture.js` | `SessionEnd` + `PreCompact` hook |
| `continuum_self_update.js` | `GET /continuum_self_update.js` | background updater |
| `uninstall_hook.js` | `GET /uninstall_hook.js` | reverse install, no token needed |

Plain Node, no shell, no dependencies (built-in `fetch`, Node 18+) — one implementation covers
Linux/macOS/Windows. Every failure path (no token, dead network, timeout) exits 0 silently, so the
hook can never block a prompt.

The context hook spawns `continuum_self_update.js` detached, at most once every
`CONTINUUM_UPDATE_INTERVAL_HOURS` (default 24), after it has already written its own output — the
update check is never in the path of a prompt. The updater SHA-256s each installed hook against
the published copy and atomically replaces only what drifted; a payload that fails to parse as JS
is discarded rather than written. It also adds events introduced after an install (SessionStart,
PreCompact) to `settings.json`, reusing the command the install already registered, so existing
installs don't need a reinstall. Disable with `touch ~/.continuum/no-auto-update`.

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
same "only if it remembers" problem as retrieval. The capture hook posts transcript text to
`POST /hook/session`, which enqueues a background job that extracts durable facts (decisions,
preferences, standing rules, project state) and saves them directly.

- **Incremental.** It runs at `PreCompact` and `SessionEnd`, sending only the turns added since the
  session's last successful capture (offset in `~/.continuum/capture-state/`). Long sessions are
  captured piece by piece instead of only their last 40k chars. Injected text (`isMeta`,
  `<command-…>`/`<system-reminder>` wrappers) is skipped so the extractor isn't fed its own memories.
- **Merges instead of overwriting.** The extractor sees the existing entries most related to the
  transcript *with their content* (project workspace and `default`), and is asked for complete
  updated content when it reuses a name. A rewrite is accepted only if the model saw the entry and
  the result is at least `CONTINUUM_CAPTURE_MIN_REWRITE_RATIO` of the old size; otherwise only
  new lines are appended. An entry named in `default` is updated there, not duplicated into the
  project.
- **Near-duplicates.** A new entry within `CONTINUUM_CAPTURE_DEDUP_SIMILARITY` cosine of an existing
  one is merged into it (new lines appended) instead of competing with it on every search.
- **Unchanged saves are free.** `memory_save` with identical content skips re-embedding and the
  LLM graph extraction.

Disable capture with `~/.continuum/capture-disabled` — context injection keeps running.

## Tests

```bash
cd core-mcp && PYTHONPATH=. uv run pytest tests   # hook context assembly, capture merge rules, storage
node --test hooks/test/hooks.test.js      # hook scripts against a fake server
```
