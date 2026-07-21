"""fact entity graph

Revision ID: 9196abc3dd70
Revises: 3cc5914fbc75
Create Date: 2026-07-20 15:20:45.918297

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9196abc3dd70'
down_revision: Union[str, Sequence[str], None] = '3cc5914fbc75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fact_entity (
            id             BIGSERIAL   PRIMARY KEY,
            owner          TEXT        NOT NULL,
            fact_id        BIGINT      NOT NULL REFERENCES fact(id) ON DELETE CASCADE,
            entity         TEXT        NOT NULL,
            entity_display TEXT        NOT NULL,
            entity_type    TEXT        NOT NULL,
            relation       TEXT        NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS fact_entity_owner_entity_idx ON fact_entity (owner, entity)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS fact_entity_fact_id_idx ON fact_entity (fact_id)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS fact_entity_fact_id_idx")
    op.execute("DROP INDEX IF EXISTS fact_entity_owner_entity_idx")
    op.execute("DROP TABLE IF EXISTS fact_entity")
