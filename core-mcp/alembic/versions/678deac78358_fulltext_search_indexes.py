"""full-text search indexes for memory and entity_edge

Revision ID: 678deac78358
Revises: a1b2c3d4e5f6
Create Date: 2026-08-09 00:00:00.000000

Adds generated tsvector columns + GIN indexes so lexical search runs against
an index instead of computing to_tsvector() per row at query time, and so
memory.search can hybrid-fuse dense + lexical results the same way
search.fact_search already does.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '678deac78358'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        "ALTER TABLE memory ADD COLUMN IF NOT EXISTS content_tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('english', description || ' ' || content)) STORED"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS memory_content_tsv_idx ON memory USING GIN (content_tsv)"
    )

    op.execute(
        "ALTER TABLE entity_edge ADD COLUMN IF NOT EXISTS fact_tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('english', fact)) STORED"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS entity_edge_fact_tsv_idx ON entity_edge USING GIN (fact_tsv)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS entity_edge_fact_tsv_idx")
    op.execute("ALTER TABLE entity_edge DROP COLUMN IF EXISTS fact_tsv")
    op.execute("DROP INDEX IF EXISTS memory_content_tsv_idx")
    op.execute("ALTER TABLE memory DROP COLUMN IF EXISTS content_tsv")
