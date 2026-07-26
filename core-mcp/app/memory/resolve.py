import logging
from datetime import datetime

from pydantic import BaseModel, Field

from .extract import Entity
from .llm import structured

logger = logging.getLogger("continuum.resolve")

CANDIDATE_LIMIT = 5
COSINE_GATE = 0.45


class NodeMatch(BaseModel):
    entity_index: int = Field(description="Index of the new entity being resolved.")
    match_id: int | None = Field(
        description="id of the existing node it refers to, or null if it is a genuinely new entity."
    )


class NodeMatches(BaseModel):
    matches: list[NodeMatch]


def _judge_prompt(items: list[tuple[str, Entity, list[float]]], candidates: dict[int, list]) -> str:
    blocks = []
    for i in sorted(candidates):
        _, e, _ = items[i]
        cand_lines = "\n".join(
            f"    - id={c['id']}: {c['name']} ({c['type']}) — {c['summary']}"
            for c in candidates[i]
        )
        blocks.append(
            f"New entity [{i}]: {e.name} ({e.type}) — {e.summary}\n"
            f"  Existing candidates:\n{cand_lines}"
        )
    return (
        "Decide, for each new entity below, whether it refers to the SAME "
        "real-world thing as one of its existing candidate nodes, or is new.\n"
        "Match only when they are genuinely the same entity (e.g. 'the freyr "
        "server' == 'freyr', 'peer drop' == 'PeerDrop'). Different things that "
        "merely share a type or context are NOT matches. When unsure, return null "
        "(new) — a wrong merge is worse than a missed one.\n"
        "Return match_id as the chosen candidate's id, or null.\n\n"
        + "\n\n".join(blocks)
    )


async def resolve(
    conn,
    owner: str,
    items: list[tuple[str, Entity, list[float]]],
    now: datetime,
) -> dict[str, int]:
    resolved: dict[str, int] = {}
    candidates: dict[int, list] = {}

    for i, (norm, _entity, embedding) in enumerate(items):
        if norm in resolved:
            continue
        exact = await conn.fetchval(
            "SELECT id FROM entity_node WHERE owner = $1 AND name_norm = $2 LIMIT 1",
            owner, norm,
        )
        if exact is not None:
            resolved[norm] = exact
            continue
        rows = await conn.fetch(
            """
            SELECT id, name, type, summary, 1 - (name_embedding <=> $2) AS score
            FROM entity_node
            WHERE owner = $1 AND name_embedding IS NOT NULL
            ORDER BY name_embedding <=> $2
            LIMIT $3
            """,
            owner, embedding, CANDIDATE_LIMIT,
        )
        near = [r for r in rows if r["score"] >= COSINE_GATE]
        if near:
            candidates[i] = near

    decisions: dict[int, int] = {}
    if candidates:
        result = await structured(_judge_prompt(items, candidates), NodeMatches)
        valid_ids = {c["id"] for cands in candidates.values() for c in cands}
        for m in result.matches:
            if m.match_id is not None and m.match_id in valid_ids:
                decisions[m.entity_index] = m.match_id

    for i, (norm, entity, embedding) in enumerate(items):
        if norm in resolved:
            continue
        match_id = decisions.get(i)
        if match_id is not None:
            await conn.execute(
                "UPDATE entity_node SET updated_at = $1 WHERE id = $2", now, match_id
            )
            resolved[norm] = match_id
        else:
            resolved[norm] = await conn.fetchval(
                """
                INSERT INTO entity_node
                    (owner, name, name_norm, type, summary, name_embedding, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
                RETURNING id
                """,
                owner, entity.name.strip(), norm, entity.type, entity.summary, embedding, now,
            )

    return resolved
