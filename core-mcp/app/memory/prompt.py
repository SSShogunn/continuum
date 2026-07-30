import asyncio

from . import memory, search


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
