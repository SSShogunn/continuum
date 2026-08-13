from fastapi import APIRouter, Depends
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app import core_client
from app.db import get_session
from app.deps import delete_clerk_user, get_current_user
from app.models import McpToken, OAuthCode

router = APIRouter(prefix="/api/account", tags=["account"])


@router.get("/export")
async def export_account(user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/account/export",
        "Failed to export account data",
        params={"clerk_id": user["sub"]},
        timeout=30.0,
    )


@router.post("/purge-data")
async def purge_account_data(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    clerk_id = user["sub"]
    result = await core_client.post(
        "/internal/account/purge",
        "Failed to purge memory data",
        json={"clerk_id": clerk_id},
        timeout=30.0,
    )

    await session.execute(delete(McpToken).where(McpToken.clerkUserId == clerk_id))
    await session.execute(delete(OAuthCode).where(OAuthCode.clerkUserId == clerk_id))
    await session.commit()

    return result


@router.post("/delete-identity")
async def delete_identity(user: dict = Depends(get_current_user)):
    await delete_clerk_user(user["sub"])
    return {"deleted": True}


@router.get("/hook-settings")
async def get_hook_settings(user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/account/hook-settings",
        "Failed to fetch hook settings",
        params={"clerk_id": user["sub"]},
    )


@router.post("/hook-settings")
async def set_hook_settings(
    body: dict,
    user: dict = Depends(get_current_user),
):
    return await core_client.post(
        "/internal/account/hook-settings",
        "Failed to update hook settings",
        json={
            "clerk_id": user["sub"],
            "hook_context_enabled": bool(body.get("hook_context_enabled", True)),
        },
    )
