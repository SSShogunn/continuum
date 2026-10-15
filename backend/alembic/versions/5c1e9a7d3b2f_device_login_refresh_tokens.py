"""device login and refresh tokens

Revision ID: 5c1e9a7d3b2f
Revises: 8743a0a9a817
Create Date: 2026-10-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5c1e9a7d3b2f'
down_revision: Union[str, Sequence[str], None] = '8743a0a9a817'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("McpToken", sa.Column("refreshTokenHash", sa.Text(), nullable=True))
    op.add_column("McpToken", sa.Column("prevRefreshTokenHash", sa.Text(), nullable=True))
    op.add_column("McpToken", sa.Column("refreshRotatedAt", sa.DateTime(), nullable=True))
    op.add_column("McpToken", sa.Column("refreshExpiresAt", sa.DateTime(), nullable=True))
    op.create_unique_constraint(
        "McpToken_refreshTokenHash_key", "McpToken", ["refreshTokenHash"]
    )
    op.create_index("McpToken_prevRefreshTokenHash_idx", "McpToken", ["prevRefreshTokenHash"])

    op.create_table(
        "DeviceAuthorization",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("deviceCodeHash", sa.Text(), nullable=False, unique=True),
        sa.Column("userCode", sa.Text(), nullable=False, unique=True),
        sa.Column("deviceName", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("clerkUserId", sa.Text(), nullable=True),
        sa.Column("expiresAt", sa.DateTime(), nullable=False),
        sa.Column("lastPolledAt", sa.DateTime(), nullable=True),
        sa.Column(
            "createdAt", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
    )


def downgrade() -> None:
    op.drop_table("DeviceAuthorization")
    op.drop_index("McpToken_prevRefreshTokenHash_idx", table_name="McpToken")
    op.drop_constraint("McpToken_refreshTokenHash_key", "McpToken", type_="unique")
    op.drop_column("McpToken", "refreshExpiresAt")
    op.drop_column("McpToken", "refreshRotatedAt")
    op.drop_column("McpToken", "prevRefreshTokenHash")
    op.drop_column("McpToken", "refreshTokenHash")
