import asyncio

from . import memory, search
from .embeddings import embed


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


async def build_hook_context(owner: str, query: str, top_k: int = 3) -> str | None:
    """Compact, gated context for automatic per-message injection (e.g. a
    UserPromptSubmit hook) — returns None when nothing clears the relevance gate,
    so irrelevant turns inject nothing. Deliberately lean (names/descriptions and
    fact lines, not full memory content) since this rides on every message;
    the model can call memory_search/memory_fact_search itself for full detail."""
    query_embedding = await embed(query[:500])
    if not await search.is_relevant(owner, query_embedding):
        return None

    entries, facts = await asyncio.gather(
        memory.search(query, top_k=top_k, owner=owner),
        search.fact_search(owner, query, top_k=top_k * 2),
    )
    if not entries and not facts:
        return None

    parts = ["[Continuum memory — relevant to this message]"]
    if facts:
        parts.append(_fact_lines(facts))
    if entries:
        parts.append(
            "\n".join(f"- {e['name']} [{e['type']}]: {e['description']}" for e in entries)
        )
    parts.append("(call memory_search / memory_fact_search for full detail if needed)")
    return "\n".join(parts)


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
