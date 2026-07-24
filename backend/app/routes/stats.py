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
