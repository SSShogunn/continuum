import logging
from datetime import datetime, timezone

from ..infra import pg
from . import embeddings, facts
from .embeddings import embed

logger = logging.getLogger("continuum.memory")


async def save(name: str, type: str, description: str, content: str, owner: str = "") -> dict:
    embedding = await embed(f"{description}\n\n{content}")
    now = datetime.now(timezone.utc)
    async with pg.pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO memory (owner, name, type, description, content, embedding, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (owner, name) DO UPDATE SET
                type        = EXCLUDED.type,
                description = EXCLUDED.description,
                content     = EXCLUDED.content,
                embedding   = EXCLUDED.embedding,
                updated_at  = EXCLUDED.updated_at
            """,
            owner, name, type, description, content, embedding, now, now,
        )
    facts.schedule_extract(owner, name, f"{description}\n\n{content}")
    return {"name": name, "type": type, "description": description, "updated_at": now.isoformat()}


async def search(query: str, top_k: int = 5, type: str | None = None, owner: str = "") -> list[dict]:
    query_embedding = await embed(query)
    async with pg.pool().acquire() as conn:
        if type:
            rows = await conn.fetch(
                """
                SELECT name, type, description, content, updated_at,
                       1 - (embedding <=> $1) AS score
                FROM memory
                WHERE owner = $2 AND type = $3
                ORDER BY embedding <=> $1
                LIMIT $4
                """,
                query_embedding, owner, type, top_k,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT name, type, description, content, updated_at,
                       1 - (embedding <=> $1) AS score
                FROM memory
                WHERE owner = $2
                ORDER BY embedding <=> $1
                LIMIT $3
                """,
                query_embedding, owner, top_k,
            )

    return [
        {
            "name": row["name"],
            "type": row["type"],
            "description": row["description"],
            "content": row["content"],
            "score": row["score"],
            "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else row["updated_at"],
        }
        for row in rows
    ]


async def list_entries(type: str | None = None, owner: str = "") -> list[dict]:
    async with pg.pool().acquire() as conn:
        if type:
            rows = await conn.fetch(
                "SELECT name, type, description, updated_at FROM memory "
                "WHERE owner = $1 AND type = $2 ORDER BY updated_at DESC",
                owner, type,
            )
        else:
            rows = await conn.fetch(
                "SELECT name, type, description, updated_at FROM memory "
                "WHERE owner = $1 ORDER BY updated_at DESC",
                owner,
            )
    return [
        {
            "name": row["name"],
            "type": row["type"],
            "description": row["description"],
            "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else row["updated_at"],
        }
        for row in rows
    ]


async def delete(name: str, owner: str = "") -> bool:
    async with pg.pool().acquire() as conn:
        result = await conn.execute(
            "DELETE FROM memory WHERE owner = $1 AND name = $2",
            owner, name,
        )
    return result != "DELETE 0"


async def start() -> None:
    logger.info("Memory store ready (embeddings=fastembed:%s)", embeddings.EMBEDDING_MODEL)


async def stop() -> None:
    logger.info("Memory store stopped")
