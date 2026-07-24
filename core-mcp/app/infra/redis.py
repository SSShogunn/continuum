import os

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

_redis: ArqRedis | None = None


def redis_settings() -> RedisSettings:
    url = os.environ.get("CONTINUUM_REDIS_URL", "")
    if not url:
        raise RuntimeError("CONTINUUM_REDIS_URL is not set")
    return RedisSettings.from_dsn(url)


async def start() -> None:
    global _redis
    _redis = await create_pool(redis_settings())


async def stop() -> None:
    global _redis
    if _redis:
        await _redis.close()
        _redis = None


def pool() -> ArqRedis:
    assert _redis is not None, "Redis pool not started"
    return _redis
