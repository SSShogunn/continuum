"""add mcptoken clientid

Revision ID: 8743a0a9a817
Revises: 4786661dc14a
Create Date: 2026-07-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8743a0a9a817'
down_revision: Union[str, Sequence[str], None] = '4786661dc14a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("McpToken", sa.Column("clientId", sa.Text(), nullable=True))
    op.create_index("McpToken_clientId_idx", "McpToken", ["clientId"])
    op.create_foreign_key(
        "McpToken_clientId_fkey",
        "McpToken",
        "OAuthClient",
        ["clientId"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("McpToken_clientId_fkey", "McpToken", type_="foreignkey")
    op.drop_index("McpToken_clientId_idx", table_name="McpToken")
    op.drop_column("McpToken", "clientId")
