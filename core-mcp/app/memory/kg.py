import asyncio
import logging
from datetime import datetime, timezone

from .. import auth
from ..infra import pg
from ..infra import redis as redis_infra
from . import edges as edge_resolver
from . import resolve as resolver
from .edges import NewEdge
from .embeddings import embed
from .extract import Entity, extract_graph

logger = logging.getLogger("continuum.kg")

_background_tasks: set[asyncio.Task] = set()


def _on_task_done(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Graph build task failed", exc_info=exc)


def schedule_extract(owner: str, name: str, text: str, reference_time_iso: str) -> None:
    task = asyncio.create_task(
        redis_infra.pool().enqueue_job("build_graph_job", owner, name, text, reference_time_iso)
    )
    _background_tasks.add(task)
    task.add_done_callback(_on_task_done)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def extract(owner: str, name: str, text: str, reference_time_iso: str) -> None:
    graph = await extract_graph(text, reference_time_iso)
    now = datetime.now(timezone.utc)
    ref = _parse_dt(reference_time_iso) or now

    nodes: dict[str, Entity] = {}
    for e in graph.entities:
        norm = e.name.strip().lower()
        if norm:
            nodes[norm] = e
    for r in graph.relations:
        for endpoint in (r.source, r.target):
            norm = endpoint.strip().lower()
            if norm and norm not in nodes:
                nodes[norm] = Entity(name=endpoint.strip(), type="concept", summary="")

    items = [
        (norm, e, await embed(f"{e.name}: {e.summary}".strip(": ")))
        for norm, e in nodes.items()
    ]
    edge_embeds = [await embed(r.fact) for r in graph.relations]

    async with pg.pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM entity_edge WHERE owner = $1 AND episode_name = $2",
                owner, name,
            )

            node_ids = await resolver.resolve(conn, owner, items, now)

            new_edges: list[NewEdge] = []
            for r, fact_embedding in zip(graph.relations, edge_embeds):
                src = node_ids.get(r.source.strip().lower())
                tgt = node_ids.get(r.target.strip().lower())
                if src is None or tgt is None:
                    logger.warning("Skipping edge with unresolved endpoint: %s", r.predicate)
                    continue
                new_edges.append(
                    NewEdge(
                        source_id=src,
                        target_id=tgt,
                        predicate=r.predicate.strip().upper(),
                        fact=r.fact,
                        fact_embedding=fact_embedding,
                        valid_at=_parse_dt(r.valid_at) or ref,
                        invalid_at=_parse_dt(r.invalid_at),
                    )
                )

            edge_count = await edge_resolver.resolve_edges(conn, owner, name, new_edges, now)

    logger.info(
        "Built graph for %s/%s: %d nodes, %d edges", owner, name, len(nodes), edge_count
    )


async def get_graph_stats(owners: list[str]) -> dict:
    async with pg.pool().acquire() as conn:
        node_count = await conn.fetchval(
            "SELECT COUNT(*) FROM entity_node WHERE owner = ANY($1::text[])", owners
        )
        edge_count = await conn.fetchval(
            "SELECT COUNT(*) FROM entity_edge WHERE owner = ANY($1::text[]) AND expired_at IS NULL",
            owners,
        )
        by_type = await conn.fetch(
            """
            SELECT type, COUNT(*) AS count
            FROM entity_node
            WHERE owner = ANY($1::text[])
            GROUP BY type
            ORDER BY count DESC
            """,
            owners,
        )
        top_entities = await conn.fetch(
            """
            SELECT n.name, n.type, COUNT(*) AS degree
            FROM entity_node n
            JOIN entity_edge e
              ON e.owner = n.owner AND (e.source_id = n.id OR e.target_id = n.id)
            WHERE n.owner = ANY($1::text[]) AND e.expired_at IS NULL
            GROUP BY n.id, n.name, n.type
            ORDER BY degree DESC
            LIMIT 10
            """,
            owners,
        )
        superseded = await conn.fetch(
            """
            SELECT e.fact, e.predicate, e.episode_name, e.valid_at, e.invalid_at, e.expired_at
            FROM entity_edge e
            WHERE e.owner = ANY($1::text[]) AND e.expired_at IS NOT NULL
            ORDER BY e.expired_at DESC
            LIMIT 20
            """,
            owners,
        )
    return {
        "node_count": node_count,
        "edge_count": edge_count,
        "by_type": [{"type": r["type"], "count": r["count"]} for r in by_type],
        "top_entities": [
            {"name": r["name"], "type": r["type"], "degree": r["degree"]}
            for r in top_entities
        ],
        "superseded_facts": [
            {
                "fact": r["fact"],
                "predicate": r["predicate"],
                "episode_name": r["episode_name"],
                "valid_at": r["valid_at"].isoformat() if r["valid_at"] else None,
                "invalid_at": r["invalid_at"].isoformat() if r["invalid_at"] else None,
                "expired_at": r["expired_at"].isoformat() if r["expired_at"] else None,
            }
            for r in superseded
        ],
    }


async def delete_workspace(owner: str) -> None:
    async with pg.pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM entity_edge WHERE owner = $1", owner)
            await conn.execute("DELETE FROM entity_node WHERE owner = $1", owner)


async def delete_account(clerk_id: str) -> None:
    async with pg.pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM entity_edge WHERE split_part(owner, ':', 1) = $1", clerk_id
            )
            await conn.execute(
                "DELETE FROM entity_node WHERE split_part(owner, ':', 1) = $1", clerk_id
            )


async def graph_for_owners(owners: list[str]) -> dict:
    async with pg.pool().acquire() as conn:
        edge_rows = await conn.fetch(
            """
            SELECT e.id, e.owner, e.source_id, e.target_id, e.predicate, e.fact,
                   e.episode_name, e.valid_at
            FROM entity_edge e
            WHERE e.owner = ANY($1::text[]) AND e.expired_at IS NULL
            ORDER BY e.created_at
            """,
            owners,
        )
        node_rows = await conn.fetch(
            """
            SELECT DISTINCT n.id, n.owner, n.name, n.type, n.summary
            FROM entity_node n
            JOIN entity_edge e
              ON e.owner = n.owner AND (e.source_id = n.id OR e.target_id = n.id)
            WHERE n.owner = ANY($1::text[]) AND e.expired_at IS NULL
            """,
            owners,
        )
    return {
        "nodes": [
            {
                "id": r["id"],
                "workspace": auth.workspace_of(r["owner"]),
                "name": r["name"],
                "type": r["type"],
                "summary": r["summary"],
            }
            for r in node_rows
        ],
        "edges": [
            {
                "id": r["id"],
                "workspace": auth.workspace_of(r["owner"]),
                "source": r["source_id"],
                "target": r["target_id"],
                "predicate": r["predicate"],
                "fact": r["fact"],
                "episode_name": r["episode_name"],
                "valid_at": r["valid_at"].isoformat() if r["valid_at"] else None,
            }
            for r in edge_rows
        ],
    }
