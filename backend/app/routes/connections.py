from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.models import McpToken, OAuthClient

router = APIRouter(prefix="/api/connections", tags=["connections"])


@router.get("")
async def list_connections(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    clerk_user_id = user["sub"]

    result = await session.execute(
        select(
            McpToken.clientId,
            OAuthClient.name,
            func.min(McpToken.createdAt),
            func.max(McpToken.lastUsedAt),
            func.count(McpToken.id),
        )
        .join(OAuthClient, OAuthClient.id == McpToken.clientId)
        .where(
            McpToken.clerkUserId == clerk_user_id,
            McpToken.clientId.is_not(None),
            McpToken.revokedAt.is_(None),
        )
        .group_by(McpToken.clientId, OAuthClient.name)
        .order_by(func.min(McpToken.createdAt).desc())
    )
    connections = [
        {
            "client_id": client_id,
            "name": name,
            "granted_at": granted_at,
            "last_used_at": last_used_at,
            "token_count": token_count,
        }
        for client_id, name, granted_at, last_used_at, token_count in result.all()
    ]

    manual_result = await session.execute(
        select(McpToken)
        .where(McpToken.clerkUserId == clerk_user_id, McpToken.clientId.is_(None))
        .order_by(McpToken.createdAt.desc())
    )
    manual_tokens = [
        {
            "id": t.id,
            "label": t.label,
            "createdAt": t.createdAt,
            "revokedAt": t.revokedAt,
            "lastUsedAt": t.lastUsedAt,
        }
        for t in manual_result.scalars()
    ]

    return {"connections": connections, "manual_tokens": manual_tokens}


@router.delete("/{client_id}")
async def disconnect_client(
    client_id: str,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        update(McpToken)
        .where(
            McpToken.clerkUserId == user["sub"],
            McpToken.clientId == client_id,
            McpToken.revokedAt.is_(None),
        )
        .values(revokedAt=datetime.now(timezone.utc))
        .returning(McpToken.id)
    )
    revoked = result.all()
    if not revoked:
        raise HTTPException(status_code=404, detail="Connection not found")

    await session.commit()
    return {"disconnected": True}
