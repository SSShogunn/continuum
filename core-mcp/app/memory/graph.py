import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..infra import pg
from .llm import client, is_transient_failure

logger = logging.getLogger("continuum.graph")


class ExtractedEntity(BaseModel):
    fact_index: int
    entity: str
    entity_type: Literal["person", "org", "place", "date", "concept", "project"]
    relation: str


class ExtractedEntities(BaseModel):
    entities: list[ExtractedEntity]


_background_tasks: set[asyncio.Task] = set()


def _on_task_done(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Graph extraction task failed", exc_info=exc)


def schedule_extract(owner: str, facts: list[tuple[int, str]]) -> None:
    if not facts:
        return
    task = asyncio.create_task(extract(owner, facts))
    _background_tasks.add(task)
    task.add_done_callback(_on_task_done)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(is_transient_failure),
    reraise=True,
)
async def _extract_entities_llm(facts: list[tuple[int, str]]) -> list[ExtractedEntity]:
    model = os.environ.get("CONTINUUM_FACT_EXTRACTION_MODEL", "")
    api_key = os.environ.get("CONTINUUM_FACT_EXTRACTION_API_KEY", "")
    if not model:
        raise RuntimeError("CONTINUUM_FACT_EXTRACTION_MODEL is not set")

    numbered = "\n".join(f"{i}. {content}" for i, (_, content) in enumerate(facts))
    result = await client.chat.completions.create(
        model=model,
        api_key=api_key,
        messages=[
            {
                "role": "user",
                "content": (
                    "Extract entities (people, orgs, places, dates, concepts, projects) "
                    "mentioned in the numbered facts below, and how each relates to the "
                    "fact it came from. Set fact_index to the number of the fact each "
                    "entity was extracted from.\n\n" + numbered
                ),
            }
        ],
        response_model=ExtractedEntities,
        max_retries=2,
        reasoning_effort="none",
        _skip_mcp_handler=True,
    )
    return result.entities


async def extract(owner: str, facts: list[tuple[int, str]]) -> None:
    entities = await _extract_entities_llm(facts)
    now = datetime.now(timezone.utc)
    fact_ids = [fact_id for fact_id, _ in facts]

    async with pg.pool().acquire() as conn:
        async with conn.transaction():
            for e in entities:
                if not (0 <= e.fact_index < len(fact_ids)):
                    logger.warning("Graph extraction: fact_index %d out of range, skipping", e.fact_index)
                    continue

                normalized = e.entity.strip().lower()
                if not normalized:
                    continue

                # Entity resolution, deliberately minimal for v1: reuse an existing
                # node's display casing if this normalized key already exists for
                # the owner, rather than creating a near-duplicate node. Fuzzy
                # matching (e.g. "PeerDrop" vs "peer drop") is an explicit
                # follow-up, not attempted here.
                existing_display = await conn.fetchval(
                    "SELECT entity_display FROM fact_entity WHERE owner = $1 AND entity = $2 LIMIT 1",
                    owner, normalized,
                )
                display = existing_display or e.entity.strip()

                await conn.execute(
                    """
                    INSERT INTO fact_entity (owner, fact_id, entity, entity_display, entity_type, relation, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """,
                    owner, fact_ids[e.fact_index], normalized, display, e.entity_type, e.relation, now,
                )

    logger.info("Extracted %d entity edges for %s (%d facts)", len(entities), owner, len(facts))


async def list_by_owner(owner: str) -> list[dict]:
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT f.source_name, fe.entity_display, fe.entity_type, fe.relation
            FROM fact_entity fe
            JOIN fact f ON f.id = fe.fact_id
            WHERE fe.owner = $1 AND f.invalidated_at IS NULL
            ORDER BY f.source_name, fe.created_at
            """,
            owner,
        )
    return [
        {
            "source_name": row["source_name"],
            "entity_display": row["entity_display"],
            "entity_type": row["entity_type"],
            "relation": row["relation"],
        }
        for row in rows
    ]


async def search(owner: str, entity: str) -> list[dict]:
    normalized = entity.strip().lower()
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT fe.entity_display, fe.entity_type, fe.relation,
                   f.source_name, f.content AS fact_content,
                   m.description AS memory_description
            FROM fact_entity fe
            JOIN fact f ON f.id = fe.fact_id
            JOIN memory m ON m.owner = f.owner AND m.name = f.source_name
            WHERE fe.owner = $1 AND fe.entity = $2 AND f.invalidated_at IS NULL
            ORDER BY f.created_at DESC
            """,
            owner, normalized,
        )
    return [
        {
            "entity_display": row["entity_display"],
            "entity_type": row["entity_type"],
            "relation": row["relation"],
            "source_name": row["source_name"],
            "fact_content": row["fact_content"],
            "memory_description": row["memory_description"],
        }
        for row in rows
    ]
