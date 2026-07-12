"""baseline: mcptoken oauthclient oauthcode

Revision ID: 4786661dc14a
Revises: 
Create Date: 2026-07-12 23:59:46.729984

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4786661dc14a'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the tables originally managed by Prisma.

    Matches the two Prisma migrations (init + add_oauth_tables) exactly so a
    fresh database ends up identical to the live one. On the existing live
    database this migration is never run — it is stamped as already-applied.
    """
    op.create_table(
        "McpToken",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("clerkUserId", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("jti", sa.Text(), nullable=False),
        sa.Column(
            "createdAt",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("revokedAt", sa.DateTime(), nullable=True),
        sa.Column("lastUsedAt", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="McpToken_pkey"),
    )
    op.create_index("McpToken_jti_key", "McpToken", ["jti"], unique=True)
    op.create_index("McpToken_clerkUserId_idx", "McpToken", ["clerkUserId"])

    op.create_table(
        "OAuthClient",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("clientSecret", sa.Text(), nullable=False),
        sa.Column("redirectUris", sa.ARRAY(sa.Text()), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column(
            "createdAt",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="OAuthClient_pkey"),
    )

    op.create_table(
        "OAuthCode",
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("clerkUserId", sa.Text(), nullable=False),
        sa.Column("clientId", sa.Text(), nullable=False),
        sa.Column("redirectUri", sa.Text(), nullable=False),
        sa.Column("codeChallenge", sa.Text(), nullable=True),
        sa.Column("codeChallengeMethod", sa.Text(), nullable=True),
        sa.Column("expiresAt", sa.DateTime(), nullable=False),
        sa.Column(
            "createdAt",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("code", name="OAuthCode_pkey"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("OAuthCode")
    op.drop_index("McpToken_clerkUserId_idx", table_name="McpToken")
    op.drop_index("McpToken_jti_key", table_name="McpToken")
    op.drop_table("McpToken")
    op.drop_table("OAuthClient")
