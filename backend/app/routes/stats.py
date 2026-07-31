import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.deps import get_current_user

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/me")
async def get_my_stats(user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/stats"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"]},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch stats from core")
    return resp.json()


@router.get("/heatmap")
async def get_my_heatmap(user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/stats/heatmap"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"]},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch heatmap from core")
    return resp.json()


@router.get("/activity")
async def get_my_activity(
    limit: int = 50,
    tool: str | None = None,
    status: str | None = None,
    user: dict = Depends(get_current_user),
):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/activity"
    params: dict = {"clerk_id": user["sub"], "limit": limit}
    if tool:
        params["tool"] = tool
    if status:
        params["status"] = status
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params=params,
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch activity from core")
    return resp.json()
