import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.deps import delete_clerk_user, get_current_user
from app.models import McpToken, OAuthCode

router = APIRouter(prefix="/api/account", tags=["account"])


@router.get("/export")
async def export_account(user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/account/export"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"]},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=30.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to export account data")
    return resp.json()


@router.post("/purge-data")
async def purge_account_data(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    clerk_id = user["sub"]
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/account/purge"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={"clerk_id": clerk_id},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=30.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to purge memory data")

    await session.execute(delete(McpToken).where(McpToken.clerkUserId == clerk_id))
    await session.execute(delete(OAuthCode).where(OAuthCode.clerkUserId == clerk_id))
    await session.commit()

    return resp.json()


@router.post("/delete-identity")
async def delete_identity(user: dict = Depends(get_current_user)):
    await delete_clerk_user(user["sub"])
    return {"deleted": True}
