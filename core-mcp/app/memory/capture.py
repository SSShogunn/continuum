import logging
import os

from pydantic import BaseModel, Field

from ..infra import pg
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
    """Turn a finished session's transcript into pending memory candidates.

    Deliberately writes to a review queue rather than straight into memory: an
    automatic writer that is wrong is worse than one that never runs, because a
    bad memory then contaminates every later retrieval. The user approves from the
    dashboard."""
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

    rows = [
        (
            owner,
            session_id,
            c.name.strip(),
            (c.type or "note").strip(),
            normalize_recall(c.recall, c.type),
            c.description.strip(),
            c.content.strip(),
            c.supersedes.strip() or None,
        )
        for c in result.candidates[:CAPTURE_MAX_CANDIDATES]
        if c.name.strip() and c.content.strip()
    ]
    if not rows:
        return 0

    async with pg.pool().acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO session_candidate
                (owner, session_id, name, type, recall, description, content, supersedes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT DO NOTHING
            """,
            rows,
        )
    return len(rows)


async def list_candidates(owner: str, status: str = "pending") -> list[dict]:
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, session_id, name, type, recall, description, content, supersedes, created_at "
            "FROM session_candidate WHERE owner = $1 AND status = $2 ORDER BY created_at DESC LIMIT 100",
            owner, status,
        )
    return [
        {
            "id": r["id"],
            "session_id": r["session_id"],
            "name": r["name"],
            "type": r["type"],
            "recall": r["recall"],
            "description": r["description"],
            "content": r["content"],
            "supersedes": r["supersedes"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


async def resolve_candidate(candidate_id: int, owner: str, accept: bool) -> dict | None:
    """Approve a candidate into real memory, or discard it. Either way the row is
    marked so it stops showing up in the queue."""
    async with pg.pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM session_candidate WHERE id = $1 AND owner = $2 AND status = 'pending'",
            candidate_id, owner,
        )
        if row is None:
            return None
        await conn.execute(
            "UPDATE session_candidate SET status = $1 WHERE id = $2",
            "saved" if accept else "discarded", candidate_id,
        )

    if not accept:
        return {"id": candidate_id, "status": "discarded"}

    await memory.save(
        row["name"],
        row["type"],
        row["description"],
        row["content"],
        owner=owner,
        recall=row["recall"],
        supersedes=[row["supersedes"]] if row["supersedes"] else None,
    )
    return {"id": candidate_id, "status": "saved", "name": row["name"]}


async def pending_count(clerk_id: str) -> int:
    async with pg.pool().acquire() as conn:
        return await conn.fetchval(
            "SELECT COUNT(*) FROM session_candidate WHERE owner LIKE $1 AND status = 'pending'",
            f"{clerk_id}:%",
        )
