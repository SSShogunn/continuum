import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.jwt import mint_mcp_token
from app.models import McpToken

router = APIRouter(prefix="/api/tokens", tags=["tokens"])


class MintRequest(BaseModel):
    label: str = "default"


@router.post("")
async def mint_token(
    body: MintRequest,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    clerk_user_id = user["sub"]

    # Revoke any existing active manual token for this user (OAuth-client
    # tokens are a separate, independently-revocable set — see connections.py)
    await session.execute(
        update(McpToken)
        .where(
            McpToken.clerkUserId == clerk_user_id,
            McpToken.clientId.is_(None),
            McpToken.revokedAt.is_(None),
        )
        .values(revokedAt=datetime.now(timezone.utc))
    )

    jti = str(uuid.uuid4())
    raw_jwt = mint_mcp_token(clerk_user_id, jti)

    token = McpToken(clerkUserId=clerk_user_id, label=body.label, jti=jti)
    session.add(token)
    await session.commit()
    await session.refresh(token)  # populate server-generated createdAt

    return {
        "id": token.id,
        "label": token.label,
        "createdAt": token.createdAt,
        # Returned once only — never stored, never shown again
        "token": raw_jwt,
    }


@router.get("")
async def list_tokens(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(McpToken)
        .where(McpToken.clerkUserId == user["sub"], McpToken.clientId.is_(None))
        .order_by(McpToken.createdAt.desc())
    )
    return [
        {
            "id": t.id,
            "label": t.label,
            "createdAt": t.createdAt,
            "revokedAt": t.revokedAt,
            "lastUsedAt": t.lastUsedAt,
        }
        for t in result.scalars()
    ]


@router.delete("/{token_id}")
async def revoke_token(
    token_id: str,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(McpToken).where(
            McpToken.id == token_id, McpToken.clerkUserId == user["sub"]
        )
    )
    token = result.scalar_one_or_none()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    token.revokedAt = datetime.now(timezone.utc)
    await session.commit()
    return {"revoked": True}
