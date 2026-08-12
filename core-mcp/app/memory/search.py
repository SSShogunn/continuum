import logging
import os

from ..infra import pg
from .embeddings import embed

logger = logging.getLogger("continuum.search")

RRF_K = 60
NODE_MATCH_GATE = 0.5
HOOK_RELEVANCE_GATE = float(os.environ.get("CONTINUUM_HOOK_RELEVANCE_GATE", "0.45"))


def rrf_fuse(ranked_lists, key: str) -> tuple[dict, dict]:
    """Reciprocal-rank-fuse multiple ranked result sets keyed by `key`."""
    scores: dict = {}
    rows: dict = {}
    for ranked in ranked_lists:
        for rank, r in enumerate(ranked):
            k = r[key]
            scores[k] = scores.get(k, 0.0) + 1.0 / (RRF_K + rank + 1)
            rows[k] = r
    return scores, rows


async def graph_search(owner: str, entity: str) -> dict | None:
    norm = entity.strip().lower()
    query_embedding = await embed(entity)
    async with pg.pool().acquire() as conn:
        node = await conn.fetchrow(
            "SELECT id, name, type, summary FROM entity_node WHERE owner = $1 AND name_norm = $2 LIMIT 1",
            owner, norm,
        )
        if node is None:
            node = await conn.fetchrow(
                """
                SELECT id, name, type, summary, 1 - (name_embedding <=> $2) AS score
                FROM entity_node
                WHERE owner = $1 AND name_embedding IS NOT NULL
                ORDER BY name_embedding <=> $2
                LIMIT 1
                """,
                owner, query_embedding,
            )
            if node is None or node["score"] < NODE_MATCH_GATE:
                return None

        edges = await conn.fetch(
            """
            SELECT s.name AS source, e.predicate, t.name AS target, e.fact,
                   e.episode_name, (e.source_id = $2) AS outgoing
            FROM entity_edge e
            JOIN entity_node s ON s.id = e.source_id
            JOIN entity_node t ON t.id = e.target_id
            WHERE e.owner = $1 AND e.expired_at IS NULL AND (e.source_id = $2 OR e.target_id = $2)
            ORDER BY e.created_at
            """,
            owner, node["id"],
        )
    return {
        "node": {"name": node["name"], "type": node["type"], "summary": node["summary"]},
        "edges": [
            {
                "source": r["source"],
                "predicate": r["predicate"],
                "target": r["target"],
                "fact": r["fact"],
                "episode_name": r["episode_name"],
                "outgoing": r["outgoing"],
            }
            for r in edges
        ],
    }


async def is_relevant(owner: str, query_embedding: list[float], gate: float = HOOK_RELEVANCE_GATE) -> bool:
    """Cheap top-1 cosine check used to gate auto-injected context — cuts noise on
    messages with nothing worth surfacing (small talk, unrelated topics) without
    paying for a full hybrid search first.

    Only `relevance`-tier memories can open the gate: always-on directives are
    injected regardless, so letting one of them trip the gate would drag in
    unrelated memories on every message it happens to embed near, and `manual`
    entries are explicitly opted out of auto-injection."""
    async with pg.pool().acquire() as conn:
        memory_score = await conn.fetchval(
            """
            SELECT 1 - (embedding <=> $1) FROM memory
            WHERE owner = $2 AND archived_at IS NULL AND recall = 'relevance'
            ORDER BY embedding <=> $1 LIMIT 1
            """,
            query_embedding, owner,
        )
        fact_score = await conn.fetchval(
            """
            SELECT 1 - (fact_embedding <=> $1) FROM entity_edge
            WHERE owner = $2 AND expired_at IS NULL
            ORDER BY fact_embedding <=> $1 LIMIT 1
            """,
            query_embedding, owner,
        )
    return max(memory_score or 0.0, fact_score or 0.0) >= gate


async def fact_search(owner: str, query: str, top_k: int = 5) -> list[dict]:
    query_embedding = await embed(query)
    pool_size = top_k * 3
    async with pg.pool().acquire() as conn:
        semantic = await conn.fetch(
            """
            SELECT e.id, s.name AS source, e.predicate, t.name AS target, e.fact, e.episode_name
            FROM entity_edge e
            JOIN entity_node s ON s.id = e.source_id
            JOIN entity_node t ON t.id = e.target_id
            WHERE e.owner = $1 AND e.expired_at IS NULL
            ORDER BY e.fact_embedding <=> $2
            LIMIT $3
            """,
            owner, query_embedding, pool_size,
        )
        lexical = await conn.fetch(
            """
            SELECT e.id, s.name AS source, e.predicate, t.name AS target, e.fact, e.episode_name
            FROM entity_edge e
            JOIN entity_node s ON s.id = e.source_id
            JOIN entity_node t ON t.id = e.target_id
            WHERE e.owner = $1 AND e.expired_at IS NULL
              AND e.fact_tsv @@ plainto_tsquery('english', $2)
            ORDER BY ts_rank(e.fact_tsv, plainto_tsquery('english', $2)) DESC
            LIMIT $3
            """,
            owner, query, pool_size,
        )

    scores, rows = rrf_fuse((semantic, lexical), key="id")
    top = sorted(scores, key=lambda i: scores[i], reverse=True)[:top_k]
    return [
        {
            "source": rows[i]["source"],
            "predicate": rows[i]["predicate"],
            "target": rows[i]["target"],
            "fact": rows[i]["fact"],
            "episode_name": rows[i]["episode_name"],
            "score": scores[i],
        }
        for i in top
    ]
