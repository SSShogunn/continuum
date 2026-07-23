import asyncio
import logging
import os
from datetime import datetime, timezone

from pydantic import BaseModel
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from ..infra import pg
from . import graph
from .embeddings import embed
from .llm import client, is_transient_failure

logger = logging.getLogger("continuum.facts")

DEDUP_THRESHOLD = 0.9


class ExtractedFacts(BaseModel):
    facts: list[str]


_background_tasks: set[asyncio.Task] = set()


def _on_task_done(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Fact extraction task failed", exc_info=exc)


def schedule_extract(owner: str, name: str, text: str) -> None:
    task = asyncio.create_task(extract(owner, name, text))
    _background_tasks.add(task)
    task.add_done_callback(_on_task_done)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception(is_transient_failure),
    reraise=True,
)
async def _extract_facts_llm(text: str) -> list[str]:
    model = os.environ.get("CONTINUUM_FACT_EXTRACTION_MODEL", "")
    api_key = os.environ.get("CONTINUUM_FACT_EXTRACTION_API_KEY", "")
    if not model:
        raise RuntimeError("CONTINUUM_FACT_EXTRACTION_MODEL is not set")

    # instructor's own max_retries handles validation-failure re-prompting (its
    # distinctive value); the outer tenacity retry above handles transient
    # transport failures with real exponential backoff, which instructor's
    # internal retry loop doesn't apply.
    result = await client.chat.completions.create(
        model=model,
        api_key=api_key,
        messages=[{"role": "user", "content": f"Extract atomic facts from this text:\n\n{text}"}],
        response_model=ExtractedFacts,
        max_retries=2,
        reasoning_effort="none",
        _skip_mcp_handler=True,
    )
    return [f.strip() for f in result.facts if f.strip()]


async def extract(owner: str, name: str, text: str) -> None:
    facts = await _extract_facts_llm(text)
    now = datetime.now(timezone.utc)

    embedded = [(content, await embed(content)) for content in facts]
    inserted: list[tuple[int, str]] = []

    async with pg.pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE fact SET invalidated_at = $1 "
                "WHERE owner = $2 AND source_name = $3 AND invalidated_at IS NULL",
                now, owner, name,
            )

            for content, embedding in embedded:
                nearest = await conn.fetchrow(
                    """
                    SELECT 1 - (embedding <=> $2) AS score
                    FROM fact
                    WHERE owner = $1 AND invalidated_at IS NULL
                    ORDER BY embedding <=> $2
                    LIMIT 1
                    """,
                    owner, embedding,
                )
                if nearest is not None and nearest["score"] >= DEDUP_THRESHOLD:
                    continue

                fact_id = await conn.fetchval(
                    """
                    INSERT INTO fact (owner, source_name, content, embedding, valid_from, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id
                    """,
                    owner, name, content, embedding, now, now,
                )
                inserted.append((fact_id, content))

    logger.info("Extracted %d facts for %s/%s", len(facts), owner, name)
    graph.schedule_extract(owner, inserted)


async def list_by_owner(owner: str) -> list[dict]:
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT source_name, content, valid_from
            FROM fact
            WHERE owner = $1 AND invalidated_at IS NULL
            ORDER BY source_name, valid_from
            """,
            owner,
        )
    return [
        {
            "source_name": row["source_name"],
            "content": row["content"],
            "valid_from": row["valid_from"].isoformat(),
        }
        for row in rows
    ]


async def search(owner: str, query: str, top_k: int = 5) -> list[dict]:
    query_embedding = await embed(query)
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT content, source_name, valid_from,
                   1 - (embedding <=> $1) AS score
            FROM fact
            WHERE owner = $2 AND invalidated_at IS NULL
            ORDER BY embedding <=> $1
            LIMIT $3
            """,
            query_embedding, owner, top_k,
        )
    return [
        {
            "content": row["content"],
            "source_name": row["source_name"],
            "score": row["score"],
            "valid_from": row["valid_from"].isoformat(),
        }
        for row in rows
    ]
