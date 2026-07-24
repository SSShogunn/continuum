"""requests owner

Revision ID: e4f1a2b6c9d3
Revises: 9196abc3dd70
Create Date: 2026-07-24 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4f1a2b6c9d3'
down_revision: Union[str, Sequence[str], None] = '9196abc3dd70'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE requests ADD COLUMN IF NOT EXISTS owner TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS requests_owner_timestamp_idx ON requests (owner, timestamp)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS requests_owner_timestamp_idx")
    op.execute("ALTER TABLE requests DROP COLUMN IF EXISTS owner")
