import logging
import os

import asyncpg

logger = logging.getLogger("continuum.pg")

_pool: asyncpg.Pool | None = None


async def start() -> None:
    global _pool
    url = os.environ.get("CONTINUUM_DATABASE_URL", "")
    if not url:
        raise RuntimeError("CONTINUUM_DATABASE_URL is not set")
    _pool = await asyncpg.create_pool(url)
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS memory (
                owner       TEXT        NOT NULL DEFAULT '',
                name        TEXT        NOT NULL,
                type        TEXT        NOT NULL,
                description TEXT        NOT NULL,
                content     TEXT        NOT NULL,
                embedding   REAL[],
                created_at  TIMESTAMPTZ NOT NULL,
                updated_at  TIMESTAMPTZ NOT NULL,
                PRIMARY KEY (owner, name)
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS requests (
                id          BIGSERIAL PRIMARY KEY,
                timestamp   TIMESTAMPTZ       NOT NULL,
                tool        TEXT              NOT NULL,
                arguments   TEXT,
                status      TEXT              NOT NULL,
                response    TEXT,
                error       TEXT,
                duration_ms DOUBLE PRECISION
            )
            """
        )
    logger.info("Postgres pool ready")


async def stop() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
    logger.info("Postgres pool closed")


def pool() -> asyncpg.Pool:
    assert _pool is not None, "Postgres pool not started"
    return _pool
