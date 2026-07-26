"""knowledge graph nodes and edges

Revision ID: f7a3c1b9d2e4
Revises: e4f1a2b6c9d3
Create Date: 2026-07-26 00:00:00.000000

See docs/knowledge-graph.md for design rationale.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f7a3c1b9d2e4'
down_revision: Union[str, Sequence[str], None] = 'e4f1a2b6c9d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EMBEDDING_DIM = 384


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS entity_node (
            id             BIGSERIAL   PRIMARY KEY,
            owner          TEXT        NOT NULL,
            name           TEXT        NOT NULL,
            name_norm      TEXT        NOT NULL,
            type           TEXT        NOT NULL,
            summary        TEXT        NOT NULL DEFAULT '',
            attributes     JSONB       NOT NULL DEFAULT '{{}}'::jsonb,
            name_embedding vector({EMBEDDING_DIM}),
            created_at     TIMESTAMPTZ NOT NULL,
            updated_at     TIMESTAMPTZ NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS entity_node_owner_norm_idx "
        "ON entity_node (owner, name_norm)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS entity_node_embedding_hnsw_idx ON entity_node "
        "USING hnsw (name_embedding vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS entity_node_name_trgm_idx ON entity_node "
        "USING gin (name gin_trgm_ops)"
    )

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS entity_edge (
            id             BIGSERIAL   PRIMARY KEY,
            owner          TEXT        NOT NULL,
            source_id      BIGINT      NOT NULL REFERENCES entity_node(id) ON DELETE CASCADE,
            target_id      BIGINT      NOT NULL REFERENCES entity_node(id) ON DELETE CASCADE,
            predicate      TEXT        NOT NULL,
            fact           TEXT        NOT NULL,
            fact_embedding vector({EMBEDDING_DIM}),
            attributes     JSONB       NOT NULL DEFAULT '{{}}'::jsonb,
            episode_name   TEXT        NOT NULL,
            valid_at       TIMESTAMPTZ,
            invalid_at     TIMESTAMPTZ,
            created_at     TIMESTAMPTZ NOT NULL,
            expired_at     TIMESTAMPTZ,
            FOREIGN KEY (owner, episode_name) REFERENCES memory(owner, name) ON DELETE CASCADE
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS entity_edge_owner_source_idx "
        "ON entity_edge (owner, source_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS entity_edge_owner_target_idx "
        "ON entity_edge (owner, target_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS entity_edge_embedding_hnsw_idx ON entity_edge "
        "USING hnsw (fact_embedding vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS entity_edge_owner_current_idx ON entity_edge (owner) "
        "WHERE expired_at IS NULL"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TABLE IF EXISTS entity_edge")
    op.execute("DROP INDEX IF EXISTS entity_node_name_trgm_idx")
    op.execute("DROP INDEX IF EXISTS entity_node_embedding_hnsw_idx")
    op.execute("DROP INDEX IF EXISTS entity_node_owner_norm_idx")
    op.execute("DROP TABLE IF EXISTS entity_node")
