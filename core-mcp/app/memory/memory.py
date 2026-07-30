import logging
import os
from datetime import datetime, timezone

from ..infra import pg
from . import embeddings, kg
from .embeddings import embed

logger = logging.getLogger("continuum.memory")

HALF_LIFE_DAYS = float(os.environ.get("CONTINUUM_MEMORY_RECENCY_HALFLIFE_DAYS", "365"))
RECENCY_FLOOR = float(os.environ.get("CONTINUUM_MEMORY_RECENCY_FLOOR", "0.7"))


async def save(
    name: str,
    type: str,
    description: str,
    content: str,
    owner: str = "",
    supersedes: list[str] | None = None,
) -> dict:
    embedding = await embed(f"{description}\n\n{content}")
    now = datetime.now(timezone.utc)
    async with pg.pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO memory (owner, name, type, description, content, embedding, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (owner, name) DO UPDATE SET
                    type        = EXCLUDED.type,
                    description = EXCLUDED.description,
                    content     = EXCLUDED.content,
                    embedding   = EXCLUDED.embedding,
                    updated_at  = EXCLUDED.updated_at,
                    archived_at = NULL
                """,
                owner, name, type, description, content, embedding, now, now,
            )
            if supersedes:
                await conn.execute(
                    "UPDATE memory SET archived_at = $1 WHERE owner = $2 AND name = ANY($3::text[])",
                    now, owner, supersedes,
                )
    combined = f"{description}\n\n{content}"
    kg.schedule_extract(owner, name, combined, now.isoformat())
    return {"name": name, "type": type, "description": description, "updated_at": now.isoformat()}


async def search(query: str, top_k: int = 5, type: str | None = None, owner: str = "") -> list[dict]:
    query_embedding = await embed(query)
    pool_size = top_k * 4
    async with pg.pool().acquire() as conn:
        if type:
            rows = await conn.fetch(
                """
                SELECT name, type, description, content, updated_at,
                       1 - (embedding <=> $1) AS score
                FROM memory
                WHERE owner = $2 AND type = $3 AND archived_at IS NULL
                ORDER BY embedding <=> $1
                LIMIT $4
                """,
                query_embedding, owner, type, pool_size,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT name, type, description, content, updated_at,
                       1 - (embedding <=> $1) AS score
                FROM memory
                WHERE owner = $2 AND archived_at IS NULL
                ORDER BY embedding <=> $1
                LIMIT $3
                """,
                query_embedding, owner, pool_size,
            )

    now = datetime.now(timezone.utc)
    scored = []
    for row in rows:
        updated_at = row["updated_at"]
        age_days = max((now - updated_at).total_seconds() / 86400, 0.0)
        recency_factor = 0.5 ** (age_days / HALF_LIFE_DAYS)
        final_score = row["score"] * (RECENCY_FLOOR + (1 - RECENCY_FLOOR) * recency_factor)
        scored.append((final_score, row))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    scored = scored[:top_k]

    results = []
    for final_score, row in scored:
        updated_at = row["updated_at"]
        results.append({
            "name": row["name"],
            "type": row["type"],
            "description": row["description"],
            "content": row["content"],
            "score": final_score,
            "updated_at": updated_at.isoformat() if hasattr(updated_at, "isoformat") else updated_at,
        })
    return results


async def list_entries(type: str | None = None, owner: str = "", include_archived: bool = False) -> list[dict]:
    archived_clause = "" if include_archived else "AND archived_at IS NULL"
    async with pg.pool().acquire() as conn:
        if type:
            rows = await conn.fetch(
                f"SELECT name, type, description, updated_at, archived_at FROM memory "
                f"WHERE owner = $1 AND type = $2 {archived_clause} ORDER BY updated_at DESC",
                owner, type,
            )
        else:
            rows = await conn.fetch(
                f"SELECT name, type, description, updated_at, archived_at FROM memory "
                f"WHERE owner = $1 {archived_clause} ORDER BY updated_at DESC",
                owner,
            )
    return [
        {
            "name": row["name"],
            "type": row["type"],
            "description": row["description"],
            "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else row["updated_at"],
            "archived_at": row["archived_at"].isoformat() if row["archived_at"] else None,
        }
        for row in rows
    ]


async def archive(name: str, owner: str = "") -> bool:
    async with pg.pool().acquire() as conn:
        result = await conn.execute(
            "UPDATE memory SET archived_at = $1 WHERE owner = $2 AND name = $3 AND archived_at IS NULL",
            datetime.now(timezone.utc), owner, name,
        )
    return result != "UPDATE 0"


async def restore(name: str, owner: str = "") -> bool:
    async with pg.pool().acquire() as conn:
        result = await conn.execute(
            "UPDATE memory SET archived_at = NULL WHERE owner = $1 AND name = $2 AND archived_at IS NOT NULL",
            owner, name,
        )
    return result != "UPDATE 0"


async def list_full(owner: str = "") -> list[dict]:
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT name, type, description, content, created_at, updated_at, archived_at FROM memory "
            "WHERE owner = $1 ORDER BY updated_at DESC",
            owner,
        )
    return [
        {
            "name": row["name"],
            "type": row["type"],
            "description": row["description"],
            "content": row["content"],
            "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else row["created_at"],
            "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else row["updated_at"],
            "archived_at": row["archived_at"].isoformat() if row["archived_at"] else None,
        }
        for row in rows
    ]


async def list_by_names(names: list[str], owner: str = "") -> list[dict]:
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT name, type, description, content, updated_at FROM memory "
            "WHERE owner = $1 AND name = ANY($2::text[]) ORDER BY updated_at DESC",
            owner, names,
        )
    return [
        {
            "name": row["name"],
            "type": row["type"],
            "description": row["description"],
            "content": row["content"],
            "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else row["updated_at"],
        }
        for row in rows
    ]


async def list_workspaces(clerk_id: str) -> list[str]:
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT owner FROM memory WHERE owner LIKE $1",
            f"{clerk_id}:%",
        )
    prefix_len = len(clerk_id) + 1
    workspaces = {row["owner"][prefix_len:] for row in rows}
    workspaces.add("default")
    return sorted(workspaces)


async def delete(name: str, owner: str = "") -> bool:
    async with pg.pool().acquire() as conn:
        result = await conn.execute(
            "DELETE FROM memory WHERE owner = $1 AND name = $2",
            owner, name,
        )
    return result != "DELETE 0"


async def delete_workspace(owner: str = "") -> int:
    async with pg.pool().acquire() as conn:
        result = await conn.execute("DELETE FROM memory WHERE owner = $1", owner)
    return int(result.split()[-1])


async def start() -> None:
    logger.info("Memory store ready (embeddings=fastembed:%s)", embeddings.EMBEDDING_MODEL)


async def stop() -> None:
    logger.info("Memory store stopped")
