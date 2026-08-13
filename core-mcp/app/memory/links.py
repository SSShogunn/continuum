import re

WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
CODE_SPAN = re.compile(r"```.*?```|`[^`\n]+`", re.DOTALL)


def extract_links(text: str) -> list[str]:
    """Every `[[target]]` in the text, deduped, in order of first appearance.

    Mirrors the dashboard's `wikilink.ts` so a link authored in the UI resolves
    identically at retrieval time. Code spans are stripped first — a memory that
    documents the wikilink syntax shouldn't pull its own example into context."""
    stripped = CODE_SPAN.sub(" ", text or "")
    seen: dict[str, None] = {}
    for match in WIKILINK.finditer(stripped):
        target = match.group(1).strip()
        if target:
            seen.setdefault(target, None)
    return list(seen)
