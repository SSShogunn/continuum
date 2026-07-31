import asyncio
import json
import logging
from datetime import datetime, timezone

from . import pg

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
                    "(timestamp, tool, arguments, status, response, error, duration_ms, owner) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
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
    owner: str | None = None,
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
        owner,
    )
    try:
        _queue.put_nowait(record)
    except asyncio.QueueFull:
        logger.warning("Request log queue full; dropping record for %s", tool)


async def get_stats(owner: str | None = None) -> dict:
    owner_clause = "WHERE owner = $1" if owner else ""
    owner_and_error_clause = "WHERE owner = $1 AND status = 'error'" if owner else "WHERE status = 'error'"
    args = (owner,) if owner else ()
    async with pg.pool().acquire() as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM requests {owner_clause}", *args)
        errors = await conn.fetchval(
            f"SELECT COUNT(*) FROM requests {owner_and_error_clause}", *args
        )
        per_tool = await conn.fetch(
            f"""
            SELECT tool,
                   COUNT(*)                                   AS calls,
                   COUNT(*) FILTER (WHERE status = 'error')  AS errors,
                   AVG(duration_ms)                           AS avg_duration_ms
            FROM requests
            {owner_clause}
            GROUP BY tool
            ORDER BY calls DESC
            """,
            *args,
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


async def get_timeseries(owner: str | None = None, days: int = 14) -> list[dict]:
    owner_clause = "AND owner = $2" if owner else ""
    args = (days, owner) if owner else (days,)
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT date_trunc('day', timestamp)               AS day,
                   tool                                        AS tool,
                   COUNT(*)                                   AS calls,
                   COUNT(*) FILTER (WHERE status = 'error')  AS errors
            FROM requests
            WHERE timestamp >= now() - make_interval(days => $1)
            {owner_clause}
            GROUP BY day, tool
            ORDER BY day
            """,
            *args,
        )
    return [
        {
            "day": row["day"].date().isoformat(),
            "tool": row["tool"],
            "calls": row["calls"],
            "errors": row["errors"],
        }
        for row in rows
    ]


async def get_latency_percentiles(owner: str | None = None) -> list[dict]:
    owner_clause = "WHERE owner = $1" if owner else ""
    args = (owner,) if owner else ()
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT tool,
                   percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50,
                   percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                   percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99,
                   MAX(duration_ms)                                          AS max
            FROM requests
            {owner_clause}
            GROUP BY tool
            ORDER BY tool
            """,
            *args,
        )
    return [
        {
            "tool": row["tool"],
            "p50": round(row["p50"] or 0, 2),
            "p95": round(row["p95"] or 0, 2),
            "p99": round(row["p99"] or 0, 2),
            "max": round(row["max"] or 0, 2),
        }
        for row in rows
    ]


async def get_hourly_heatmap(owner: str | None = None) -> list[dict]:
    owner_clause = "WHERE owner = $1" if owner else ""
    args = (owner,) if owner else ()
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT EXTRACT(DOW FROM timestamp)::int  AS dow,
                   EXTRACT(HOUR FROM timestamp)::int AS hour,
                   COUNT(*)                           AS calls
            FROM requests
            {owner_clause}
            GROUP BY dow, hour
            ORDER BY dow, hour
            """,
            *args,
        )
    return [
        {"dow": row["dow"], "hour": row["hour"], "calls": row["calls"]}
        for row in rows
    ]


async def get_recent_activity(
    owner: str | None = None,
    limit: int = 50,
    tool: str | None = None,
    status: str | None = None,
) -> list[dict]:
    clauses = []
    args: list = []
    if owner:
        args.append(owner)
        clauses.append(f"owner = ${len(args)}")
    if tool:
        args.append(tool)
        clauses.append(f"tool = ${len(args)}")
    if status:
        args.append(status)
        clauses.append(f"status = ${len(args)}")
    where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    args.append(limit)
    async with pg.pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT tool, status, duration_ms, timestamp, arguments, error
            FROM requests
            {where_clause}
            ORDER BY timestamp DESC
            LIMIT ${len(args)}
            """,
            *args,
        )
    return [
        {
            "tool": row["tool"],
            "status": row["status"],
            "duration_ms": round(row["duration_ms"] or 0, 2),
            "timestamp": row["timestamp"].isoformat(),
            "arguments": (row["arguments"][:200] if row["arguments"] else None),
            "error": (row["error"][:200] if row["error"] else None),
        }
        for row in rows
    ]


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
