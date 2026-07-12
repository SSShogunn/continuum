import uuid
from datetime import datetime, timezone

from sqlalchemy import ARRAY, DateTime, Index, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


def _uuid() -> str:
    return str(uuid.uuid4())


class UTCDateTime(TypeDecorator):
    """Maps to a naive ``TIMESTAMP`` column (the live Prisma schema) but keeps
    the Python side tz-aware in UTC.

    asyncpg refuses tz-aware datetimes for ``timestamp without time zone``
    columns, so we strip tzinfo on the way in (normalising to UTC first) and
    re-attach UTC on the way out — mirroring how Prisma behaved.
    """

    impl = DateTime  # timezone=False -> "timestamp without time zone"
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


class Base(DeclarativeBase):
    pass


class McpToken(Base):
    __tablename__ = "McpToken"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    clerkUserId: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    jti: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    createdAt: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, server_default=func.current_timestamp()
    )
    revokedAt: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    lastUsedAt: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (Index("McpToken_clerkUserId_idx", "clerkUserId"),)


class OAuthClient(Base):
    __tablename__ = "OAuthClient"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    clientSecret: Mapped[str] = mapped_column(Text, nullable=False)
    redirectUris: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    createdAt: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, server_default=func.current_timestamp()
    )


class OAuthCode(Base):
    __tablename__ = "OAuthCode"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    clerkUserId: Mapped[str] = mapped_column(Text, nullable=False)
    clientId: Mapped[str] = mapped_column(Text, nullable=False)
    redirectUri: Mapped[str] = mapped_column(Text, nullable=False)
    codeChallenge: Mapped[str | None] = mapped_column(Text, nullable=True)
    codeChallengeMethod: Mapped[str | None] = mapped_column(Text, nullable=True)
    expiresAt: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    createdAt: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, server_default=func.current_timestamp()
    )
