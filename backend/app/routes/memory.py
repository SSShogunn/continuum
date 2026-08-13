import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.deps import get_current_user

router = APIRouter(prefix="/api/memory", tags=["memory"])


class ImportRequest(BaseModel):
    memories: list[dict]


class RecallRequest(BaseModel):
    name: str
    recall: str
    workspace: str = "default"


class CandidateResolveRequest(BaseModel):
    id: int
    accept: bool
    workspace: str = "default"


class SaveRequest(BaseModel):
    name: str
    type: str = "note"
    description: str = ""
    content: str
    recall: str = "relevance"
    workspace: str = "default"


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


@router.get("/stats")
async def get_memory_stats(user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/memory/stats"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"]},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch memory stats from core")
    return resp.json()


@router.get("/graph/stats")
async def get_graph_stats(workspace: str = "default", user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/graph/stats"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"], "workspace": workspace},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch graph stats from core")
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


@router.post("")
async def save_memory(body: SaveRequest, user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/memory/save"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={**body.model_dump(), "clerk_id": user["sub"]},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=30.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Failed to save memory")
    return resp.json()


@router.get("/candidates")
async def get_session_candidates(workspace: str = "default", user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/session/candidates"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"], "workspace": workspace},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch session candidates")
    return resp.json()


@router.post("/candidates/resolve")
async def resolve_session_candidate(
    body: CandidateResolveRequest, user: dict = Depends(get_current_user)
):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/session/candidates/resolve"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={**body.model_dump(), "clerk_id": user["sub"]},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=30.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Failed to resolve candidate")
    return resp.json()


@router.get("/review")
async def get_review_candidates(workspace: str = "default", user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/memory/review"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"clerk_id": user["sub"], "workspace": workspace},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=15.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch review candidates from core")
    return resp.json()


@router.post("/recall")
async def set_recall(body: RecallRequest, user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/memory/recall"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={
                "clerk_id": user["sub"],
                "workspace": body.workspace,
                "name": body.name,
                "recall": body.recall,
            },
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Failed to update recall tier")
    return resp.json()


@router.post("/import")
async def import_memory(
    body: ImportRequest, workspace: str = "default", user: dict = Depends(get_current_user)
):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/memory/import"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={"clerk_id": user["sub"], "workspace": workspace, "memories": body.memories},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=30.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to import memory")
    return resp.json()


@router.post("/prompt")
async def generate_prompt(body: dict, user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/prompt"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={**body, "clerk_id": user["sub"]},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=15.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to generate prompt")
    return resp.json()


@router.post("/delete-workspace")
async def delete_workspace(body: dict, user: dict = Depends(get_current_user)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/memory/delete-workspace"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={**body, "clerk_id": user["sub"]},
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=15.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Failed to delete workspace")
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
