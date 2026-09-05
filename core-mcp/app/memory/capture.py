import logging
import os

from pydantic import BaseModel, Field

from . import llm, memory
from .taxonomy import normalize_recall

logger = logging.getLogger("continuum.capture")

CAPTURE_TRANSCRIPT_CHARS = int(os.environ.get("CONTINUUM_CAPTURE_TRANSCRIPT_CHARS", "24000"))
CAPTURE_MAX_CANDIDATES = int(os.environ.get("CONTINUUM_CAPTURE_MAX_CANDIDATES", "6"))


class Candidate(BaseModel):
    name: str = Field(description="kebab_case or snake_case slug, reusing an existing name to update it")
    type: str = Field(description="Subject: user, preference, project, reference, person, guideline")
    recall: str = Field(description='"always" for a standing behavioral rule, else "relevance"')
    description: str = Field(description="One line describing what this entry holds")
    content: str = Field(description="Dense facts or bullets — no conversational filler")
    supersedes: str = Field(default="", description="Existing memory name this replaces, or empty")


class CandidateList(BaseModel):
    candidates: list[Candidate]


_PROMPT = """You are reviewing a finished coding session to decide what is worth remembering
about this user long-term. Extract only durable facts: decisions made and why, stated
preferences and standing rules, project state that outlives this session, people, and
environment/config details.

Do NOT extract: what the assistant did step by step, file diffs, transient debugging state,
anything already obvious from the repository itself, or restatements of the existing memories
listed below.

Existing memory entries (reuse a name to update it, and set `supersedes` when a new entry
replaces a differently-named old one):
{existing}

Return at most {limit} candidates. Prefer zero over speculative ones — an empty list is a valid
and common answer for a session that taught you nothing durable.

A standing behavioral rule ("never do X unless asked", "always use Y") must get recall="always".
Everything else gets recall="relevance".

--- SESSION TRANSCRIPT ---
{transcript}
"""


async def extract_candidates(owner: str, session_id: str, transcript: str) -> int:
    """Turn a finished session's transcript into memory entries, saved directly."""
    text = (transcript or "").strip()
    if not text:
        return 0

    existing = await memory.list_entries(owner=owner)
    existing_block = (
        "\n".join(f"- {e['name']} [{e['type']}]: {e['description']}" for e in existing[:60])
        or "(none yet)"
    )
    prompt = _PROMPT.format(
        existing=existing_block,
        limit=CAPTURE_MAX_CANDIDATES,
        transcript=text[-CAPTURE_TRANSCRIPT_CHARS:],
    )

    try:
        result = await llm.structured(prompt, CandidateList)
    except Exception:
        logger.exception("Session capture extraction failed for owner=%s", owner)
        return 0

    saved = 0
    for c in result.candidates[:CAPTURE_MAX_CANDIDATES]:
        name = c.name.strip()
        content = c.content.strip()
        if not name or not content:
            continue
        await memory.save(
            name,
            (c.type or "note").strip(),
            c.description.strip(),
            content,
            owner=owner,
            recall=normalize_recall(c.recall, c.type),
            supersedes=[c.supersedes.strip()] if c.supersedes.strip() else None,
        )
        saved += 1
    return saved
