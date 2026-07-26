import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.deps import get_current_user

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.get("")
async def get_memory(workspace: str = "default", user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/memory"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"], "workspace": workspace},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch memory from core")
    return resp.json()


@router.get("/graph")
async def get_graph(workspace: str = "default", user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/graph"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"], "workspace": workspace},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch graph from core")
    return resp.json()


@router.delete("/{name}")
async def delete_memory(
    name: str, workspace: str = "default", user: dict = Depends(get_current_user)
):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/memory/delete"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={"clerk_id": user["sub"], "workspace": workspace, "name": name},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to delete memory")
    return resp.json()
