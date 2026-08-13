"""session capture candidates

Revision ID: c9e3a7b5d1f8
Revises: b8d2f4a6c1e7
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9e3a7b5d1f8'
down_revision: Union[str, Sequence[str], None] = 'b8d2f4a6c1e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS session_candidate (
            id          BIGSERIAL   PRIMARY KEY,
            owner       TEXT        NOT NULL,
            session_id  TEXT,
            name        TEXT        NOT NULL,
            type        TEXT        NOT NULL,
            recall      TEXT        NOT NULL DEFAULT 'relevance',
            description TEXT        NOT NULL,
            content     TEXT        NOT NULL,
            supersedes  TEXT,
            status      TEXT        NOT NULL DEFAULT 'pending',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS session_candidate_owner_status_idx "
        "ON session_candidate (owner, status, created_at DESC)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS session_candidate_pending_idx "
        "ON session_candidate (owner, session_id, name) WHERE status = 'pending'"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TABLE IF EXISTS session_candidate")
