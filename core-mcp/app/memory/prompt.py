import asyncio
import hashlib
import os

from . import hook_session, links, memory, search
from .embeddings import embed
from .hook_session import HookSession

HOOK_DIRECTIVE_LIMIT = int(os.environ.get("CONTINUUM_HOOK_DIRECTIVE_LIMIT", "12"))
HOOK_DIRECTIVE_BUDGET_CHARS = int(os.environ.get("CONTINUUM_HOOK_DIRECTIVE_BUDGET_CHARS", "2400"))
HOOK_DIRECTIVE_ENTRY_CHARS = int(os.environ.get("CONTINUUM_HOOK_DIRECTIVE_ENTRY_CHARS", "600"))
HOOK_QUERY_EXPAND_CHARS = int(os.environ.get("CONTINUUM_HOOK_QUERY_EXPAND_CHARS", "80"))
HOOK_RECENT_CHARS = int(os.environ.get("CONTINUUM_HOOK_RECENT_CHARS", "600"))
HOOK_LINK_FANOUT = int(os.environ.get("CONTINUUM_HOOK_LINK_FANOUT", "3"))
HOOK_FACT_LIMIT = int(os.environ.get("CONTINUUM_HOOK_FACT_LIMIT", "6"))
HOOK_ITEM_FLOOR = float(os.environ.get("CONTINUUM_HOOK_ITEM_FLOOR", "0.55"))
HOOK_ITEM_MARGIN = float(os.environ.get("CONTINUUM_HOOK_ITEM_MARGIN", "0.05"))


def _memory_block(e: dict) -> str:
    return f"## {e['name']} [{e['type']}]\n{e['description']}\n\n{e['content']}"


def _memory_section(entries: list[dict]) -> str:
    return "\n\n---\n\n".join(_memory_block(e) for e in entries)


def _fact_lines(facts: list[dict]) -> str:
    return "\n".join(
        f"- {f['source']} {f['predicate']} {f['target']}: {f['fact']} (from {f['episode_name']})"
        for f in facts
    )


async def build_full(owner: str) -> str:
    entries = await memory.list_full(owner)
    if not entries:
        return "No memory entries found."
    return "# Continuum Memory Export\n\n" + _memory_section(entries)


async def build_search(owner: str, query: str, top_k: int = 8) -> str:
    entries, facts = await asyncio.gather(
        memory.search(query, top_k=top_k, owner=owner),
        search.fact_search(owner, query, top_k=top_k),
    )
    parts = [f"# Continuum Memory Export — topic: {query}"]
    parts.append(
        "## Relevant memories\n\n" + (_memory_section(entries) if entries else "None found.")
    )
    parts.append("## Relevant facts\n\n" + (_fact_lines(facts) if facts else "None found."))
    return "\n\n".join(parts)


async def build_selection(owner: str, names: list[str]) -> str:
    if not names:
        return "No memory entries selected."
    entries = await memory.list_by_names(names, owner=owner)
    if not entries:
        return "No memory entries found."
    return "# Continuum Memory Export — selected entries\n\n" + _memory_section(entries)


def _truncate(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    boundary = max(cut.rfind("\n"), cut.rfind(". "))
    if boundary > limit // 2:
        cut = cut[: boundary + 1]
    return cut.rstrip() + " […]"


def _directive_section(entries: list[dict]) -> str:
    """Render always-on entries with their actual rule text — a directive whose
    body is dropped isn't a rule, just a label. Newest first, so the most recently
    stated rules keep their full text when the budget runs out; everything past the
    budget degrades to a one-liner rather than being silently dropped, since a rule
    the model never sees is worse than one it has to look up."""
    full: list[str] = []
    brief: list[str] = []
    used = 0
    for e in entries:
        block = f"### {e['name']}\n{e['description']}\n{_truncate(e['content'], HOOK_DIRECTIVE_ENTRY_CHARS)}"
        if len(full) < HOOK_DIRECTIVE_LIMIT and used + len(block) <= HOOK_DIRECTIVE_BUDGET_CHARS:
            full.append(block)
            used += len(block)
        else:
            brief.append(f"- {e['name']}: {e['description']}")

    parts = ["## Standing rules — always apply, regardless of this message's topic"]
    parts.extend(full)
    if brief:
        kept: list[str] = []
        overflow = 0
        brief_used = 0
        for line in brief:
            if brief_used + len(line) <= HOOK_DIRECTIVE_BUDGET_CHARS:
                kept.append(line)
                brief_used += len(line)
            else:
                overflow += 1
        if kept:
            parts.append("Also in force (call memory_search for the full text):\n" + "\n".join(kept))
        if overflow:
            parts.append(f"(+{overflow} more standing rules — call memory_list to see them all)")
    return "\n\n".join(parts)


async def _linked_entries(
    entries: dict[str, dict], skip: set[str], owners: list[str]
) -> list[dict]:
    """Entries reachable by one `[[wikilink]]` hop from something that already
    matched. The link graph is hand-curated — a link is a stronger statement of
    relatedness than embedding proximity — so one hop is worth more than pushing
    top_k higher, which just drags in the next-most-similar blob."""
    wanted: dict[str, str] = {}
    for source in entries.values():
        for target in links.extract_links(source["content"]):
            if target not in entries and target not in skip and target not in wanted:
                wanted[target] = source["name"]
    if not wanted:
        return []

    names = list(wanted)[:HOOK_LINK_FANOUT]
    fetched = await asyncio.gather(*(memory.list_by_names(names, owner=o) for o in owners))
    seen: dict[str, dict] = {}
    for owner_rows in fetched:
        for row in owner_rows:
            if row["name"] not in seen:
                seen[row["name"]] = {**row, "linked_from": wanted[row["name"]]}
    return list(seen.values())


def directives_digest(directives: dict[str, dict]) -> str:
    """Changes whenever a standing rule is added, removed or edited."""
    h = hashlib.sha1()
    for name in sorted(directives):
        d = directives[name]
        h.update(f"{name}\0{d['description']}\0{d['content']}\0".encode("utf-8"))
    return h.hexdigest()


async def _directives(owners: list[str]) -> dict[str, dict]:
    results = await asyncio.gather(*(memory.list_directives(o) for o in owners))
    directives: dict[str, dict] = {}
    for owner_directives in results:
        for d in owner_directives:
            directives.setdefault(d["name"], d)
    return directives


def _scope_note(workspace: str, extra_owner: str | None) -> str:
    return f"[Continuum memory — active workspace: {workspace}" + (" (+ default)]" if extra_owner else "]")


def _fact_key(f: dict) -> str:
    return f"{f['source']}\0{f['predicate']}\0{f['target']}\0{f['fact']}"


async def build_session_start_context(
    owner: str,
    extra_owner: str | None = None,
    workspace: str = "default",
    session: "HookSession | None" = None,
) -> dict:
    """Context for a SessionStart hook (startup, resume, clear, compaction).
    Standing rules are delivered here, once, instead of on every prompt; the
    session's record of what it has seen is reset, since compaction or /clear
    removed earlier injections from the model's view."""
    owners = [owner] if not extra_owner or extra_owner == owner else [owner, extra_owner]
    directives = await _directives(owners)
    if session:
        await session.reset()
        await session.set_directives_digest(directives_digest(directives))
    parts = [_scope_note(workspace, extra_owner)]
    if directives:
        parts.append(_directive_section(list(directives.values())))
    return {"context": "\n\n".join(parts), "directives": list(directives)}


async def build_hook_context(
    owner: str,
    query: str,
    top_k: int = 3,
    extra_owner: str | None = None,
    recent: str | None = None,
    workspace: str = "default",
    session: "HookSession | None" = None,
) -> dict:
    """Context for automatic per-message injection (e.g. a UserPromptSubmit hook).
    Returns None when nothing clears the relevance gate and no standing rules
    exist, so irrelevant turns inject nothing.

    Two tiers, deliberately rendered differently, because they fail in opposite
    directions. `recall="always"` entries are standing behavioral rules ("never do
    X unless explicitly asked") — they bypass the gate and the similarity ranking
    entirely and carry their full text, since a rule that only surfaces when it
    happens to embed near the current query isn't being enforced, and one that
    surfaces as a bare title isn't actionable. `recall="relevance"` entries are
    contextual facts — gated, ranked, and listed lean (names/descriptions and fact
    lines) because they ride on every message and the model can call
    memory_search/memory_fact_search itself for detail. `recall="manual"` entries
    never appear here at all.

    With a `session` (hooks that send a session id), nothing is repeated that
    this session has already been shown: standing rules are sent once — at
    SessionStart, or on the first prompt if that hook isn't installed — and
    again only if they change; memories and facts are sent the first time they
    match. Without one, every prompt gets everything, as before.

    `extra_owner` (e.g. the account's `default` workspace when `owner` is a
    project-scoped one) is merged in so switching to a project workspace can't
    hide cross-project rules or facts like identity/preferences that still live in
    `default`. Results from both are ranked together, not concatenated.
    `workspace` is that scope's name, stated in the rendered header.

    `recent` is the tail of the conversation. A short message is usually deictic
    ("do the same for the other one", "why?") and embeds nowhere near anything
    stored, so for those the recent turns are folded into the retrieval query —
    the current message stays first so it still dominates the ranking. Long
    messages carry their own signal and are left alone, since padding them with
    prior turns only blurs the query.

    The query is embedded once and reused for the gate and for every owner's
    memory and fact search. Past the gate, each semantic hit must clear
    HOOK_ITEM_FLOOR and sit within HOOK_ITEM_MARGIN of the best match of its kind.

    Returns the rendered context plus what went into it, so the caller can log
    which memories were actually injected."""
    owners = [owner] if not extra_owner or extra_owner == owner else [owner, extra_owner]

    retrieval_query = query
    expanded = False
    if recent and len(query) < HOOK_QUERY_EXPAND_CHARS:
        retrieval_query = f"{query}\n{recent[-HOOK_RECENT_CHARS:]}"
        expanded = True

    directives = await _directives(owners)
    send_directives = bool(directives)
    directives_updated = False
    if session and directives:
        digest = directives_digest(directives)
        previous = await session.directives_digest()
        send_directives = previous != digest
        directives_updated = previous is not None and send_directives
        if send_directives:
            await session.set_directives_digest(digest)

    query_embedding = await embed(retrieval_query[:2000])
    tops = await asyncio.gather(*(search.top_similarity(o, query_embedding) for o in owners))
    relevant_owners = [o for o, (m, f) in zip(owners, tops) if max(m, f) >= search.HOOK_RELEVANCE_GATE]
    best_memory = max((m for o, (m, _) in zip(owners, tops) if o in relevant_owners), default=0.0)
    best_fact = max((f for o, (_, f) in zip(owners, tops) if o in relevant_owners), default=0.0)
    memory_floor = max(HOOK_ITEM_FLOOR, best_memory - HOOK_ITEM_MARGIN)
    fact_floor = max(HOOK_ITEM_FLOOR, best_fact - HOOK_ITEM_MARGIN)

    entries: dict[str, dict] = {}
    facts: dict[str, dict] = {}
    if relevant_owners:
        results = await asyncio.gather(*(
            asyncio.gather(
                memory.search(
                    retrieval_query, top_k=top_k, owner=o, recall_in=["relevance"],
                    query_embedding=query_embedding, min_similarity=memory_floor,
                ),
                search.fact_search(
                    o, retrieval_query, top_k=HOOK_FACT_LIMIT,
                    query_embedding=query_embedding, min_similarity=fact_floor,
                ),
            )
            for o in relevant_owners
        ))
        for owner_entries, owner_facts in results:
            for e in owner_entries:
                if e["name"] not in entries or e["score"] > entries[e["name"]]["score"]:
                    entries[e["name"]] = e
            for f in owner_facts:
                key = _fact_key(f)
                if key not in facts or f["score"] > facts[key]["score"]:
                    facts[key] = f
    for name in directives:
        entries.pop(name, None)
    entries = dict(sorted(entries.items(), key=lambda kv: kv[1]["score"], reverse=True)[:top_k])
    ranked_facts = sorted(facts.values(), key=lambda f: f["score"], reverse=True)[:HOOK_FACT_LIMIT]

    linked = await _linked_entries(entries, set(directives), owners) if entries else []

    skipped_seen = 0
    if session:
        keyed = (
            [(hook_session.item_key("m", n), ("entry", n)) for n in entries]
            + [(hook_session.item_key("m", e["name"]), ("linked", e["name"])) for e in linked]
            + [(hook_session.item_key("f", _fact_key(f)), ("fact", _fact_key(f))) for f in ranked_facts]
        )
        unseen = await session.unseen([k for k, _ in keyed])
        skipped_seen = len(keyed) - len(unseen)
        keep = {ref for k, ref in keyed if k in unseen}
        entries = {n: e for n, e in entries.items() if ("entry", n) in keep}
        linked = [e for e in linked if ("linked", e["name"]) in keep]
        ranked_facts = [f for f in ranked_facts if ("fact", _fact_key(f)) in keep]
        await session.mark_seen(list(unseen))

    injected = {
        "directives": list(directives) if send_directives else [],
        "memories": list(entries),
        "linked": [e["name"] for e in linked],
        "facts": len(ranked_facts),
        "gate_passed": bool(relevant_owners),
        "expanded": expanded,
        "skipped_seen": skipped_seen,
    }

    if not send_directives and not entries and not ranked_facts and not linked:
        return {"context": None, **injected}

    parts = [_scope_note(workspace, extra_owner)]
    if send_directives:
        section = _directive_section(list(directives.values()))
        if directives_updated:
            section = section.replace(
                "## Standing rules — always apply", "## Standing rules (updated this session) — always apply", 1
            )
        parts.append(section)
    if entries or ranked_facts or linked:
        related = ["## Possibly relevant to this message"]
        if ranked_facts:
            related.append(_fact_lines(ranked_facts))
        if entries:
            related.append(
                "\n".join(f"- {e['name']} [{e['type']}]: {e['description']}" for e in entries.values())
            )
        if linked:
            related.append(
                "\n".join(
                    f"- {e['name']} [{e['type']}] (linked from {e['linked_from']}): {e['description']}"
                    for e in linked
                )
            )
        related.append(
            f'(call memory_search / memory_fact_search with workspace="{workspace}" '
            "for full detail if needed)"
        )
        parts.append("\n\n".join(related))
    return {"context": "\n\n".join(parts), **injected}


async def build_entity(owner: str, entity: str) -> str:
    result = await search.graph_search(owner, entity)
    if result is None:
        return "No entity found matching that name."
    node = result["node"]
    lines = [f"# Continuum Memory Export — entity: {node['name']}", ""]
    lines.append(f"{node['name']} ({node['type']})" + (f": {node['summary']}" if node["summary"] else ""))
    if not result["edges"]:
        lines.append("(no current relationships)")
    for e in result["edges"]:
        if e["outgoing"]:
            lines.append(f"- {e['predicate']} → {e['target']}: {e['fact']} (from {e['episode_name']})")
        else:
            lines.append(f"- {e['source']} {e['predicate']} → (this): {e['fact']} (from {e['episode_name']})")
    return "\n".join(lines)
