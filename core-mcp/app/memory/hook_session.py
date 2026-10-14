"""Per-session memory of what the auto-context hook has already injected.

Claude Code keeps every injected block in the transcript, so repeating a
standing rule or a memory line on each prompt spends tokens to say what the
model can already see. This tracks, per Claude Code session, the digest of the
standing rules last sent and the memories/facts already surfaced. SessionStart
(startup, resume, clear, and after compaction) resets it, because compaction
summarises earlier injections away.

State lives in Redis with a TTL, keyed by account and session, so it needs no
schema and expires on its own. Every call is best effort: a Redis failure
degrades to "nothing seen yet" — injecting a repeat beats dropping context.
"""

from __future__ import annotations

import hashlib
import logging
import os

logger = logging.getLogger("continuum.hook_session")

SESSION_TTL_SECONDS = int(os.environ.get("CONTINUUM_HOOK_SESSION_TTL_SECONDS", str(24 * 3600)))
MAX_SESSION_ID_CHARS = 128


def item_key(kind: str, value: str) -> str:
    """Short stable key for a memory name or a fact's text."""
    return f"{kind}:{hashlib.sha1(value.encode('utf-8')).hexdigest()[:16]}"


class HookSession:
    def __init__(self, redis, account: str, session_id: str) -> None:
        self._redis = redis
        safe = "".join(c for c in session_id if c.isalnum() or c in "-_")[:MAX_SESSION_ID_CHARS]
        self._base = f"hooksess:{account}:{safe}"

    @classmethod
    def maybe(cls, redis, account: str, session_id: str | None) -> "HookSession | None":
        """None for callers that send no session id (hooks older than this
        feature), which keeps their inject-everything behaviour."""
        return cls(redis, account, session_id) if session_id else None

    async def reset(self) -> None:
        try:
            await self._redis.delete(f"{self._base}:dir", f"{self._base}:seen")
        except Exception:
            logger.exception("hook session reset failed")

    async def directives_digest(self) -> str | None:
        try:
            value = await self._redis.get(f"{self._base}:dir")
        except Exception:
            logger.exception("hook session read failed")
            return None
        return value.decode() if isinstance(value, bytes) else value

    async def set_directives_digest(self, digest: str) -> None:
        try:
            await self._redis.set(f"{self._base}:dir", digest, ex=SESSION_TTL_SECONDS)
        except Exception:
            logger.exception("hook session write failed")

    async def unseen(self, keys: list[str]) -> set[str]:
        if not keys:
            return set()
        try:
            flags = await self._redis.smismember(f"{self._base}:seen", keys)
        except Exception:
            logger.exception("hook session read failed")
            return set(keys)
        return {k for k, seen in zip(keys, flags) if not seen}

    async def mark_seen(self, keys: list[str]) -> None:
        if not keys:
            return
        try:
            await self._redis.sadd(f"{self._base}:seen", *keys)
            await self._redis.expire(f"{self._base}:seen", SESSION_TTL_SECONDS)
        except Exception:
            logger.exception("hook session write failed")
