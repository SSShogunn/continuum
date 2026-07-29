"""memory archival

Revision ID: a1b2c3d4e5f6
Revises: c2d4e6f8a1b3
Create Date: 2026-07-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'c2d4e6f8a1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE memory ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE memory DROP COLUMN IF EXISTS archived_at")
