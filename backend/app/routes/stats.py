from fastapi import APIRouter, Depends

from app import core_client
from app.deps import get_current_user

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/me")
async def get_my_stats(user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/stats",
        "Failed to fetch stats from core",
        params={"clerk_id": user["sub"]},
    )


@router.get("/heatmap")
async def get_my_heatmap(user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/stats/heatmap",
        "Failed to fetch heatmap from core",
        params={"clerk_id": user["sub"]},
    )


@router.get("/activity")
async def get_my_activity(
    limit: int = 50,
    tool: str | None = None,
    status: str | None = None,
    user: dict = Depends(get_current_user),
):
    params: dict = {"clerk_id": user["sub"], "limit": limit}
    if tool:
        params["tool"] = tool
    if status:
        params["status"] = status
    return await core_client.get(
        "/internal/activity",
        "Failed to fetch activity from core",
        params=params,
    )
