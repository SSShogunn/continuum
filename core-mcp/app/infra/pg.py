import logging
import os

import asyncpg

logger = logging.getLogger("continuum.pg")

_pool: asyncpg.Pool | None = None


def _encode_vector(v: list[float]) -> str:
    return "[" + ",".join(repr(x) for x in v) + "]"


def _decode_vector(s: str) -> list[float]:
    body = s[1:-1]
    return [float(x) for x in body.split(",")] if body else []


async def _init_connection(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec(
        "vector",
        encoder=_encode_vector,
        decoder=_decode_vector,
        schema="public",
        format="text",
    )


async def start() -> None:
    global _pool
    url = os.environ.get("CONTINUUM_DATABASE_URL", "")
    if not url:
        raise RuntimeError("CONTINUUM_DATABASE_URL is not set")

    # Schema is managed entirely by Alembic (see core-mcp/alembic/) — run
    # `alembic upgrade head` before starting the app, not here.
    _pool = await asyncpg.create_pool(url, init=_init_connection)
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
