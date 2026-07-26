"""drop legacy fact and fact_entity tables

Revision ID: c2d4e6f8a1b3
Revises: f7a3c1b9d2e4
Create Date: 2026-07-27 00:00:00.000000

See docs/knowledge-graph.md. Downgrade recreates the (empty) schema — not the data.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c2d4e6f8a1b3'
down_revision: Union[str, Sequence[str], None] = 'f7a3c1b9d2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EMBEDDING_DIM = 384


def upgrade() -> None:
    """Drop the legacy tables (fact_entity first — it FKs fact)."""
    op.execute("DROP INDEX IF EXISTS fact_entity_fact_id_idx")
    op.execute("DROP INDEX IF EXISTS fact_entity_owner_entity_idx")
    op.execute("DROP TABLE IF EXISTS fact_entity")

    op.execute("DROP INDEX IF EXISTS fact_owner_current_idx")
    op.execute("DROP INDEX IF EXISTS fact_owner_source_idx")
    op.execute("DROP INDEX IF EXISTS fact_embedding_hnsw_idx")
    op.execute("DROP TABLE IF EXISTS fact")


def downgrade() -> None:
    """Recreate the legacy schema (empty), matching the original baseline DDL."""
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS fact (
            id             BIGSERIAL   PRIMARY KEY,
            owner          TEXT        NOT NULL,
            source_name    TEXT        NOT NULL,
            content        TEXT        NOT NULL,
            embedding      vector({EMBEDDING_DIM}) NOT NULL,
            valid_from     TIMESTAMPTZ NOT NULL,
            invalidated_at TIMESTAMPTZ,
            superseded_by  BIGINT      REFERENCES fact(id),
            created_at     TIMESTAMPTZ NOT NULL,
            FOREIGN KEY (owner, source_name) REFERENCES memory(owner, name) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS fact_embedding_hnsw_idx ON fact "
        "USING hnsw (embedding vector_cosine_ops)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS fact_owner_source_idx ON fact (owner, source_name)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS fact_owner_current_idx ON fact (owner) "
        "WHERE invalidated_at IS NULL"
    )

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
    op.execute("CREATE INDEX IF NOT EXISTS fact_entity_fact_id_idx ON fact_entity (fact_id)")
