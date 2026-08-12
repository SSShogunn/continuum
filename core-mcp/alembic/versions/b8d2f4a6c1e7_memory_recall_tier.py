"""memory recall tier

Revision ID: b8d2f4a6c1e7
Revises: d3e5f7a9b1c2
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d2f4a6c1e7'
down_revision: Union[str, Sequence[str], None] = 'd3e5f7a9b1c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        "ALTER TABLE memory ADD COLUMN IF NOT EXISTS recall TEXT NOT NULL DEFAULT 'relevance'"
    )
    op.execute(
        "UPDATE memory SET recall = 'always' WHERE lower(type) IN "
        "('guideline', 'guidelines', 'rule', 'rules', 'directive', 'policy', 'instruction')"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS memory_owner_recall_idx ON memory (owner, recall) "
        "WHERE archived_at IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS memory_owner_recall_idx")
    op.execute("ALTER TABLE memory DROP COLUMN IF EXISTS recall")
