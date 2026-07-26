import logging
import math
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel, Field

from .llm import structured

logger = logging.getLogger("continuum.edges")

WITHIN_PAIR_DUP_COSINE = 0.82
SEMANTIC_CANDIDATE_COSINE = 0.6
CANDIDATE_LIMIT = 8


@dataclass
class NewEdge:
    source_id: int
    target_id: int
    predicate: str
    fact: str
    fact_embedding: list[float]
    valid_at: datetime | None
    invalid_at: datetime | None


class EdgeResolution(BaseModel):
    edge_index: int = Field(description="Index of the new edge.")
    duplicate_of: int | None = Field(
        default=None,
        description="id of an existing edge this restates (skip inserting); else null.",
    )
    contradicts: list[int] = Field(
        default_factory=list,
        description="ids of existing live edges this new fact makes no-longer-true.",
    )


class EdgeResolutions(BaseModel):
    resolutions: list[EdgeResolution]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def _pair(e: NewEdge) -> tuple[int, int]:
    return (min(e.source_id, e.target_id), max(e.source_id, e.target_id))


def _dedup_within_batch(edges: list[NewEdge]) -> list[NewEdge]:
    kept: list[NewEdge] = []
    for e in edges:
        dup = any(
            _pair(k) == _pair(e) and _cosine(k.fact_embedding, e.fact_embedding) >= WITHIN_PAIR_DUP_COSINE
            for k in kept
        )
        if not dup:
            kept.append(e)
    return kept


def _resolve_prompt(edges: list[NewEdge], candidates: dict[int, list]) -> str:
    blocks = []
    for i in sorted(candidates):
        e = edges[i]
        cand_lines = "\n".join(f"    - id={c['id']}: {c['fact']}" for c in candidates[i])
        blocks.append(
            f"New edge [{i}]: {e.fact}\n  Existing edges between the same entities:\n{cand_lines}"
        )
    return (
        "For each new edge, compare it to the existing edges between the same two "
        "entities and decide:\n"
        "- duplicate_of: the id of an existing edge that states the SAME fact "
        "(then the new one is redundant); else null.\n"
        "- contradicts: ids of existing edges that the new fact makes no longer "
        "true (e.g. 'requirepass is configured' contradicts 'needs requirepass'; "
        "'service removed' contradicts 'service runs on host'). Empty if none.\n"
        "A fact that simply adds detail is neither a duplicate nor a contradiction.\n\n"
        + "\n\n".join(blocks)
    )


async def resolve_edges(conn, owner: str, episode_name: str, edges: list[NewEdge], now: datetime) -> int:
    edges = _dedup_within_batch(edges)

    candidates: dict[int, list] = {}
    for i, e in enumerate(edges):
        rows = await conn.fetch(
            """
            SELECT id, fact FROM entity_edge
            WHERE owner = $1 AND expired_at IS NULL
              AND (
                (source_id = $2 AND target_id = $3)
                OR (source_id = $3 AND target_id = $2)
                OR (
                    (source_id = $2 OR target_id = $2 OR source_id = $3 OR target_id = $3)
                    AND 1 - (fact_embedding <=> $4) >= $5
                )
              )
            ORDER BY fact_embedding <=> $4
            LIMIT $6
            """,
            owner, e.source_id, e.target_id, e.fact_embedding,
            SEMANTIC_CANDIDATE_COSINE, CANDIDATE_LIMIT,
        )
        if rows:
            candidates[i] = rows

    dup_of: dict[int, int] = {}
    to_invalidate: dict[int, datetime] = {}
    if candidates:
        result = await structured(_resolve_prompt(edges, candidates), EdgeResolutions)
        valid_ids = {c["id"] for cands in candidates.values() for c in cands}
        for r in result.resolutions:
            if not (0 <= r.edge_index < len(edges)):
                continue
            if r.duplicate_of in valid_ids:
                dup_of[r.edge_index] = r.duplicate_of
            for cid in r.contradicts:
                if cid in valid_ids:
                    to_invalidate[cid] = edges[r.edge_index].valid_at or now

    for cid, invalid_at in to_invalidate.items():
        await conn.execute(
            "UPDATE entity_edge SET invalid_at = COALESCE(invalid_at, $1), expired_at = $2 WHERE id = $3",
            invalid_at, now, cid,
        )

    inserted = 0
    for i, e in enumerate(edges):
        if i in dup_of:
            continue
        await conn.execute(
            """
            INSERT INTO entity_edge
                (owner, source_id, target_id, predicate, fact, fact_embedding,
                 episode_name, valid_at, invalid_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """,
            owner, e.source_id, e.target_id, e.predicate, e.fact, e.fact_embedding,
            episode_name, e.valid_at or now, e.invalid_at, now,
        )
        inserted += 1

    return inserted
