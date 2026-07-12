import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db import db
from app.deps import get_current_user
from app.jwt import mint_mcp_token

router = APIRouter(prefix="/api/tokens", tags=["tokens"])


class MintRequest(BaseModel):
    label: str = "default"


@router.post("")
async def mint_token(body: MintRequest, user: dict = Depends(get_current_user)):
    clerk_user_id = user["sub"]

    # Revoke any existing active token for this user
    await db.mcptoken.update_many(
        where={"clerkUserId": clerk_user_id, "revokedAt": None},
        data={"revokedAt": datetime.now(timezone.utc)},
    )

    jti = str(uuid.uuid4())
    raw_jwt = mint_mcp_token(clerk_user_id, jti)

    token = await db.mcptoken.create(
        data={
            "clerkUserId": clerk_user_id,
            "label": body.label,
            "jti": jti,
        }
    )

    return {
        "id": token.id,
        "label": token.label,
        "createdAt": token.createdAt,
        # Returned once only — never stored, never shown again
        "token": raw_jwt,
    }


@router.get("")
async def list_tokens(user: dict = Depends(get_current_user)):
    tokens = await db.mcptoken.find_many(
        where={"clerkUserId": user["sub"]},
        order={"createdAt": "desc"},
    )
    return [
        {
            "id": t.id,
            "label": t.label,
            "createdAt": t.createdAt,
            "revokedAt": t.revokedAt,
            "lastUsedAt": t.lastUsedAt,
        }
        for t in tokens
    ]


@router.delete("/{token_id}")
async def revoke_token(token_id: str, user: dict = Depends(get_current_user)):
    token = await db.mcptoken.find_first(
        where={"id": token_id, "clerkUserId": user["sub"]}
    )
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    await db.mcptoken.update(
        where={"id": token_id},
        data={"revokedAt": datetime.now(timezone.utc)},
    )
    return {"revoked": True}
