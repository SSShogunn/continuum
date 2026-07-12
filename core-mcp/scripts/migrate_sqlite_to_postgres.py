"""
One-time migration: SQLite (data/memory.db + data/continuum.db) -> Postgres (continuum_core).
Run once manually before retiring the SQLite files.

Usage:
    CONTINUUM_DATABASE_URL=postgresql://... uv run python scripts/migrate_sqlite_to_postgres.py
"""

import asyncio
import os
import sqlite3
import sys
from array import array
from pathlib import Path

import asyncpg

MEMORY_DB = Path("data/memory.db")
REQUESTS_DB = Path("data/continuum.db")


async def migrate() -> None:
    url = os.environ.get("CONTINUUM_DATABASE_URL", "")
    if not url:
        print("ERROR: CONTINUUM_DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    conn = await asyncpg.connect(url)

    # --- memory ---
    if MEMORY_DB.exists():
        src = sqlite3.connect(MEMORY_DB)
        rows = src.execute(
            "SELECT owner, name, type, description, content, embedding, created_at, updated_at FROM memory"
        ).fetchall()
        src.close()

        inserted = skipped = 0
        for owner, name, type_, description, content, blob, created_at, updated_at in rows:
            embedding = None
            if blob:
                vec = array("f")
                vec.frombytes(blob)
                embedding = list(vec)
            try:
                await conn.execute(
                    """
                    INSERT INTO memory (owner, name, type, description, content, embedding, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6::real[], $7::timestamptz, $8::timestamptz)
                    ON CONFLICT DO NOTHING
                    """,
                    owner, name, type_, description, content, embedding, created_at, updated_at,
                )
                inserted += 1
            except Exception as e:
                print(f"  SKIP memory ({owner!r}, {name!r}): {e}")
                skipped += 1
        print(f"memory: {inserted} inserted, {skipped} skipped")
    else:
        print(f"memory: {MEMORY_DB} not found, skipping")

    # --- requests ---
    if REQUESTS_DB.exists():
        src = sqlite3.connect(REQUESTS_DB)
        rows = src.execute(
            "SELECT timestamp, tool, arguments, status, response, error, duration_ms FROM requests"
        ).fetchall()
        src.close()

        inserted = 0
        for timestamp, tool, arguments, status, response, error, duration_ms in rows:
            await conn.execute(
                """
                INSERT INTO requests (timestamp, tool, arguments, status, response, error, duration_ms)
                VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7)
                """,
                timestamp, tool, arguments, status, response, error, duration_ms,
            )
            inserted += 1
        print(f"requests: {inserted} inserted")
    else:
        print(f"requests: {REQUESTS_DB} not found, skipping")

    await conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    asyncio.run(migrate())
