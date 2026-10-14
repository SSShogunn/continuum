import logging
import os
import re

from pydantic import BaseModel, Field

from .. import auth
from . import llm, memory
from .embeddings import embed
from .taxonomy import normalize_recall

logger = logging.getLogger("continuum.capture")

CAPTURE_TRANSCRIPT_CHARS = int(os.environ.get("CONTINUUM_CAPTURE_TRANSCRIPT_CHARS", "24000"))
CAPTURE_MAX_CANDIDATES = int(os.environ.get("CONTINUUM_CAPTURE_MAX_CANDIDATES", "6"))
# How many existing entries the extractor is shown, and how many of those
# (the most relevant to this transcript) with their content, so an update can
# be a real merge instead of a rewrite from the one-line description.
CAPTURE_EXISTING_LIST = int(os.environ.get("CONTINUUM_CAPTURE_EXISTING_LIST", "60"))
CAPTURE_EXISTING_WITH_CONTENT = int(os.environ.get("CONTINUUM_CAPTURE_EXISTING_WITH_CONTENT", "8"))
CAPTURE_EXISTING_CONTENT_CHARS = int(os.environ.get("CONTINUUM_CAPTURE_EXISTING_CONTENT_CHARS", "700"))
# A new entry this close to an existing one is the same memory under another
# name: its new lines are merged into the existing entry instead.
CAPTURE_DEDUP_SIMILARITY = float(os.environ.get("CONTINUUM_CAPTURE_DEDUP_SIMILARITY", "0.9"))
# An update shorter than this fraction of what it replaces is treated as a
# partial restatement, and only its new lines are appended.
CAPTURE_MIN_REWRITE_RATIO = float(os.environ.get("CONTINUUM_CAPTURE_MIN_REWRITE_RATIO", "0.6"))


class Candidate(BaseModel):
    name: str = Field(description="kebab_case or snake_case slug, reusing an existing name to update it")
    type: str = Field(description="Subject: user, preference, project, reference, person, guideline")
    recall: str = Field(description='"always" for a standing behavioral rule, else "relevance"')
    description: str = Field(description="One line describing what this entry holds")
    content: str = Field(description="Dense facts or bullets — no conversational filler")
    supersedes: str = Field(default="", description="Existing memory name this replaces, or empty")


class CandidateList(BaseModel):
    candidates: list[Candidate]


_PROMPT = """You are reviewing part of a coding session to decide what is worth remembering
about this user long-term. Extract only durable facts: decisions made and why, stated
preferences and standing rules, project state that outlives this session, people, and
environment/config details.

Do NOT extract: what the assistant did step by step, file diffs, transient debugging state,
anything already obvious from the repository itself, or restatements of the existing memories
listed below.

Existing memory entries. To update one, reuse its name. For entries shown with their content,
return the COMPLETE updated content: every still-true line kept, changed facts rewritten, new
facts added. For entries shown without content, return only the new facts. Set `supersedes`
when a new entry replaces a differently-named old one.
{existing}

Return at most {limit} candidates. Prefer zero over speculative ones — an empty list is a valid
and common answer for a session that taught you nothing durable.

A standing behavioral rule ("never do X unless asked", "always use Y") must get recall="always".
Everything else gets recall="relevance".

--- SESSION TRANSCRIPT ---
{transcript}
"""


def _norm_line(line: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^[\s\-*•\d.)]+", "", line)).strip().lower()


def new_lines(existing: str, addition: str) -> str:
    """Lines of `addition` not already present in `existing`, ignoring bullet
    markers, case and whitespace."""
    have = {_norm_line(l) for l in existing.splitlines() if _norm_line(l)}
    fresh = [l for l in addition.splitlines() if _norm_line(l) and _norm_line(l) not in have]
    return "\n".join(fresh)


def plan_write(existing: dict | None, content: str, content_was_shown: bool) -> tuple[str, str]:
    """Decide how a candidate lands on an entry: ("save", content) replaces it,
    ("append", lines) adds only what's new, ("skip", "") does nothing.

    A wholesale rewrite is trusted only when the model saw the entry's content
    and returned something close to its size — otherwise a rewrite from a one-line
    description silently deletes everything it didn't restate."""
    if existing is None:
        return "save", content
    if content_was_shown and len(content) >= CAPTURE_MIN_REWRITE_RATIO * len(existing["content"]):
        return "save", content
    lines = new_lines(existing["content"], content)
    return ("append", lines) if lines else ("skip", "")


def _existing_block(listed: list[dict], shown: dict[str, dict]) -> str:
    if not listed:
        return "(none yet)"
    out = []
    for e in listed:
        line = f"- {e['name']} [{e['type']}]: {e['description']}"
        if e["name"] in shown:
            body = shown[e["name"]]["content"].strip()
            if len(body) > CAPTURE_EXISTING_CONTENT_CHARS:
                body = body[:CAPTURE_EXISTING_CONTENT_CHARS].rsplit("\n", 1)[0] + "\n[…]"
            line += "\n  content:\n" + "\n".join(f"    {l}" for l in body.splitlines())
        out.append(line)
    return "\n".join(out)


async def extract_candidates(owner: str, session_id: str, transcript: str) -> int:
    """Turn a session transcript (or the part of it since the last capture) into
    memory entries, saved directly. Returns how many entries were written."""
    text = (transcript or "").strip()
    if not text:
        return 0
    text = text[-CAPTURE_TRANSCRIPT_CHARS:]

    clerk_id = owner.partition(":")[0]
    default_owner = auth.compose_owner(clerk_id, "default")
    owners = [owner] if owner == default_owner else [owner, default_owner]

    # The entries most related to this transcript go first and carry their
    # content; the rest of the list is recency order, names only.
    tail = text[-2000:]
    tail_embedding = await embed(tail)
    related: dict[str, dict] = {}
    for o in owners:
        for e in await memory.search(tail, top_k=CAPTURE_EXISTING_WITH_CONTENT, owner=o, query_embedding=tail_embedding):
            related.setdefault(e["name"], e)
    shown = dict(list(related.items())[:CAPTURE_EXISTING_WITH_CONTENT])
    listed = list(shown.values())
    for o in owners:
        for e in await memory.list_entries(owner=o):
            if e["name"] not in related and len(listed) < CAPTURE_EXISTING_LIST:
                listed.append(e)
                related[e["name"]] = e

    prompt = _PROMPT.format(
        existing=_existing_block(listed, shown),
        limit=CAPTURE_MAX_CANDIDATES,
        transcript=text,
    )
    try:
        result = await llm.structured(prompt, CandidateList)
    except Exception:
        logger.exception("Session capture extraction failed for owner=%s", owner)
        return 0

    written = 0
    for c in result.candidates[:CAPTURE_MAX_CANDIDATES]:
        name, content = memory.clean_name(c.name), c.content.strip()
        if name and content:
            written += await _write_candidate(c, name, content, owners, shown)
    return written


async def _write_candidate(c: Candidate, name: str, content: str, owners: list[str], shown: dict) -> int:
    # An entry the candidate names is updated where it already lives — a
    # preference stored in `default` is not duplicated into the project.
    target_owner, existing = owners[0], None
    for o in owners:
        existing = await memory.get_entry(name, owner=o)
        if existing is not None:
            target_owner = o
            break

    if existing is None:
        near = await memory.nearest(owners[0], await embed(f"{c.description}\n\n{content}"))
        if near and near[1] >= CAPTURE_DEDUP_SIMILARITY:
            logger.info("Capture: %r restates %r (cos %.2f); merging", name, near[0], near[1])
            name = near[0]
            existing = await memory.get_entry(name, owner=owners[0])

    action, payload = plan_write(existing, content, content_was_shown=name in shown)
    if action == "skip":
        return 0
    if action == "append":
        await memory.append(name, payload, owner=target_owner)
        return 1
    record = await memory.save(
        name,
        (c.type or "note").strip(),
        c.description.strip(),
        payload,
        owner=target_owner,
        recall=normalize_recall(c.recall, c.type),
        supersedes=[c.supersedes.strip()] if c.supersedes.strip() else None,
    )
    return 0 if record.get("unchanged") else 1
