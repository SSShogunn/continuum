"""workspace owner migration

Revision ID: 3cc5914fbc75
Revises: b407737f3cb3
Create Date: 2026-07-20 12:38:05.116192

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3cc5914fbc75'
down_revision: Union[str, Sequence[str], None] = 'b407737f3cb3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Namespace owner as `{clerk_user_id}:{workspace}`, defaulting existing rows to
    the "default" workspace.

    The fact->memory FK has no ON UPDATE clause (defaults to NO ACTION in Postgres),
    so a bare UPDATE on memory.owner would violate the constraint against existing
    fact rows still pointing at the old value. Add ON UPDATE CASCADE first — a
    permanent improvement, not just a migration trick — so the single UPDATE below
    propagates automatically.
    """
    op.execute("ALTER TABLE fact DROP CONSTRAINT fact_owner_source_name_fkey")
    op.execute(
        """
        ALTER TABLE fact ADD CONSTRAINT fact_owner_source_name_fkey
        FOREIGN KEY (owner, source_name) REFERENCES memory(owner, name)
        ON DELETE CASCADE ON UPDATE CASCADE
        """
    )
    # op.execute() routes raw strings through SQLAlchemy's text(), which parses
    # `:identifier` as a named bind parameter — `:default` would be misread as one
    # and fail with "a value is required for bind parameter 'default'" (confirmed by
    # testing, not assumed). Bind the suffix/pattern explicitly instead of embedding
    # them as literal text.
    op.execute(
        sa.text("UPDATE memory SET owner = owner || :suffix WHERE owner NOT LIKE :pattern")
        .bindparams(suffix=":default", pattern="%:%")
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        sa.text("UPDATE memory SET owner = left(owner, -8) WHERE owner LIKE :pattern")
        .bindparams(pattern="%:default")
    )
    op.execute("ALTER TABLE fact DROP CONSTRAINT fact_owner_source_name_fkey")
    op.execute(
        """
        ALTER TABLE fact ADD CONSTRAINT fact_owner_source_name_fkey
        FOREIGN KEY (owner, source_name) REFERENCES memory(owner, name)
        ON DELETE CASCADE
        """
    )
