import asyncio
import json
import logging
from datetime import datetime, timezone

import pg

logger = logging.getLogger("continuum.db")

MAX_FIELD_CHARS = 8000

_queue: asyncio.Queue | None = None
_worker: asyncio.Task | None = None


def _truncate(value: str | None) -> str | None:
    if value is None:
        return None
    return value[:MAX_FIELD_CHARS]


async def _run_worker() -> None:
    assert _queue is not None
    while True:
        record = await _queue.get()
        try:
            if record is None:
                break
            async with pg.pool().acquire() as conn:
                await conn.execute(
                    "INSERT INTO requests "
                    "(timestamp, tool, arguments, status, response, error, duration_ms) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7)",
                    *record,
                )
        except Exception:
            logger.exception("Failed to write request log")
        finally:
            _queue.task_done()


def log_request(
    tool: str,
    arguments,
    status: str,
    response: str | None = None,
    error: str | None = None,
    duration_ms: float | None = None,
) -> None:
    if _queue is None:
        return
    record = (
        datetime.now(timezone.utc),
        tool,
        _truncate(json.dumps(arguments, default=str)) if arguments is not None else None,
        status,
        _truncate(response),
        _truncate(error),
        duration_ms,
    )
    try:
        _queue.put_nowait(record)
    except asyncio.QueueFull:
        logger.warning("Request log queue full; dropping record for %s", tool)


async def get_stats() -> dict:
    async with pg.pool().acquire() as conn:
        total = await conn.fetchval("SELECT COUNT(*) FROM requests")
        errors = await conn.fetchval("SELECT COUNT(*) FROM requests WHERE status = 'error'")
        per_tool = await conn.fetch(
            """
            SELECT tool,
                   COUNT(*)                                   AS calls,
                   COUNT(*) FILTER (WHERE status = 'error')  AS errors,
                   AVG(duration_ms)                           AS avg_duration_ms
            FROM requests
            GROUP BY tool
            ORDER BY calls DESC
            """
        )
    return {
        "total_requests": total,
        "total_errors": errors,
        "error_rate": round(errors / total, 4) if total else 0.0,
        "per_tool": [
            {
                "tool": row["tool"],
                "calls": row["calls"],
                "errors": row["errors"],
                "avg_duration_ms": round(row["avg_duration_ms"] or 0, 2),
            }
            for row in per_tool
        ],
    }


async def start() -> None:
    global _queue, _worker
    _queue = asyncio.Queue(maxsize=1000)
    _worker = asyncio.create_task(_run_worker())
    logger.info("Request logging started")


async def stop() -> None:
    global _queue, _worker
    if _queue is not None:
        await _queue.put(None)
    if _worker is not None:
        await _worker
    _queue = None
    _worker = None
    logger.info("Request logging stopped")
