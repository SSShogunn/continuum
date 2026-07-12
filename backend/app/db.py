import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def _async_url(url: str) -> str:
    """Force the asyncpg driver regardless of how DATABASE_URL is written.

    Prisma used the plain ``postgresql://`` scheme; SQLAlchemy's async engine
    needs ``postgresql+asyncpg://``. We normalise here so existing .env files
    don't have to change.
    """
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://") :]
    return url


engine = create_async_engine(_async_url(os.environ["DATABASE_URL"]))
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def connect() -> None:
    # Verify connectivity at startup so misconfig fails fast.
    async with engine.connect():
        pass


async def disconnect() -> None:
    await engine.dispose()
