import logging
import math
from datetime import datetime, timezone

import pg

logger = logging.getLogger("continuum.memory")

EMBEDDING_MODEL = __import__("os").environ.get("CONTINUUM_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

_fastembed_model = None


def _fastembed_embed(text: str) -> list[float]:
    global _fastembed_model
    if _fastembed_model is None:
        from fastembed import TextEmbedding
        _fastembed_model = TextEmbedding(EMBEDDING_MODEL)
    return next(iter(_fastembed_model.embed([text]))).tolist()


async def _embed(text: str) -> list[float]:
    import asyncio
    return await asyncio.to_thread(_fastembed_embed, text)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def save(name: str, type: str, description: str, content: str, owner: str = "") -> dict:
    embedding = await _embed(f"{description}\n\n{content}")
    now = datetime.now(timezone.utc)
    async with pg.pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO memory (owner, name, type, description, content, embedding, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6::real[], $7, $8)
            ON CONFLICT (owner, name) DO UPDATE SET
                type        = EXCLUDED.type,
                description = EXCLUDED.description,
                content     = EXCLUDED.content,
                embedding   = EXCLUDED.embedding,
                updated_at  = EXCLUDED.updated_at
            """,
            owner, name, type, description, content, embedding, now, now,
        )
    return {"name": name, "type": type, "description": description, "updated_at": now.isoformat()}


async def search(query: str, top_k: int = 5, type: str | None = None, owner: str = "") -> list[dict]:
    query_embedding = await _embed(query)
    async with pg.pool().acquire() as conn:
        if type:
            rows = await conn.fetch(
                "SELECT name, type, description, content, embedding, updated_at "
                "FROM memory WHERE owner = $1 AND type = $2",
                owner, type,
            )
        else:
            rows = await conn.fetch(
                "SELECT name, type, description, content, embedding, updated_at "
                "FROM memory WHERE owner = $1",
                owner,
            )

    scored = []
    for row in rows:
        emb = row["embedding"]
        if not emb:
            continue
        score = _cosine(query_embedding, list(emb))
        scored.append({
            "name": row["name"],
            "type": row["type"],
            "description": row["description"],
            "content": row["content"],
            "score": score,
            "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else row["updated_at"],
        })
    scored.sort(key=lambda r: r["score"], reverse=True)
    return scored[:top_k]


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
    logger.info("Memory store ready (embeddings=fastembed:%s)", EMBEDDING_MODEL)


async def stop() -> None:
    logger.info("Memory store stopped")
