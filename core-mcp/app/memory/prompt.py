import asyncio
import os

from . import memory, search
from .embeddings import embed

HOOK_DIRECTIVE_LIMIT = int(os.environ.get("CONTINUUM_HOOK_DIRECTIVE_LIMIT", "12"))
HOOK_DIRECTIVE_BUDGET_CHARS = int(os.environ.get("CONTINUUM_HOOK_DIRECTIVE_BUDGET_CHARS", "2400"))
HOOK_DIRECTIVE_ENTRY_CHARS = int(os.environ.get("CONTINUUM_HOOK_DIRECTIVE_ENTRY_CHARS", "600"))


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


async def build_hook_context(
    owner: str, query: str, top_k: int = 3, extra_owner: str | None = None
) -> str | None:
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

    `extra_owner` (e.g. the account's `default` workspace when `owner` is a
    project-scoped one) is merged in so switching to a project workspace can't
    hide cross-project rules or facts like identity/preferences that still live in
    `default`."""
    owners = [owner] if not extra_owner or extra_owner == owner else [owner, extra_owner]

    directive_results = await asyncio.gather(*(memory.list_directives(o) for o in owners))
    directives: dict[str, dict] = {}
    for owner_directives in directive_results:
        for d in owner_directives:
            directives.setdefault(d["name"], d)

    query_embedding = await embed(query[:500])
    relevance = await asyncio.gather(*(search.is_relevant(o, query_embedding) for o in owners))
    relevant_owners = [o for o, ok in zip(owners, relevance) if ok]

    entries: dict[str, dict] = {}
    facts: list[dict] = []
    if relevant_owners:
        results = await asyncio.gather(*(
            asyncio.gather(
                memory.search(query, top_k=top_k, owner=o, recall_in=["relevance"]),
                search.fact_search(o, query, top_k=top_k * 2),
            )
            for o in relevant_owners
        ))
        for owner_entries, owner_facts in results:
            for e in owner_entries:
                entries.setdefault(e["name"], e)
            facts.extend(owner_facts)
    for name in directives:
        entries.pop(name, None)

    if not directives and not entries and not facts:
        return None

    parts = ["[Continuum memory]"]
    if directives:
        parts.append(_directive_section(list(directives.values())))
    if entries or facts:
        related = ["## Possibly relevant to this message"]
        if facts:
            related.append(_fact_lines(facts))
        if entries:
            related.append(
                "\n".join(f"- {e['name']} [{e['type']}]: {e['description']}" for e in entries.values())
            )
        related.append("(call memory_search / memory_fact_search for full detail if needed)")
        parts.append("\n\n".join(related))
    return "\n\n".join(parts)


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
