from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app import core_client
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
    return await core_client.get(
        "/internal/memory",
        "Failed to fetch memory from core",
        params={"clerk_id": user["sub"], "workspace": workspace},
    )


@router.get("/stats")
async def get_memory_stats(user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/memory/stats",
        "Failed to fetch memory stats from core",
        params={"clerk_id": user["sub"]},
    )


@router.get("/graph/stats")
async def get_graph_stats(workspace: str = "default", user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/graph/stats",
        "Failed to fetch graph stats from core",
        params={"clerk_id": user["sub"], "workspace": workspace},
    )


@router.get("/graph")
async def get_graph(workspace: str = "default", user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/graph",
        "Failed to fetch graph from core",
        params={"clerk_id": user["sub"], "workspace": workspace},
    )


@router.post("")
async def save_memory(body: SaveRequest, user: dict = Depends(get_current_user)):
    return await core_client.post(
        "/internal/memory/save",
        "Failed to save memory",
        json={**body.model_dump(), "clerk_id": user["sub"]},
        timeout=30.0,
        passthrough_status=True,
    )


@router.get("/candidates")
async def get_session_candidates(workspace: str = "default", user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/session/candidates",
        "Failed to fetch session candidates",
        params={"clerk_id": user["sub"], "workspace": workspace},
    )


@router.post("/candidates/resolve")
async def resolve_session_candidate(
    body: CandidateResolveRequest, user: dict = Depends(get_current_user)
):
    return await core_client.post(
        "/internal/session/candidates/resolve",
        "Failed to resolve candidate",
        json={**body.model_dump(), "clerk_id": user["sub"]},
        timeout=30.0,
        passthrough_status=True,
    )


@router.get("/review")
async def get_review_candidates(workspace: str = "default", user: dict = Depends(get_current_user)):
    return await core_client.get(
        "/internal/memory/review",
        "Failed to fetch review candidates from core",
        params={"clerk_id": user["sub"], "workspace": workspace},
        timeout=15.0,
    )


@router.post("/recall")
async def set_recall(body: RecallRequest, user: dict = Depends(get_current_user)):
    return await core_client.post(
        "/internal/memory/recall",
        "Failed to update recall tier",
        json={
            "clerk_id": user["sub"],
            "workspace": body.workspace,
            "name": body.name,
            "recall": body.recall,
        },
        passthrough_status=True,
    )


@router.post("/import")
async def import_memory(
    body: ImportRequest, workspace: str = "default", user: dict = Depends(get_current_user)
):
    return await core_client.post(
        "/internal/memory/import",
        "Failed to import memory",
        json={"clerk_id": user["sub"], "workspace": workspace, "memories": body.memories},
        timeout=30.0,
    )


@router.post("/prompt")
async def generate_prompt(body: dict, user: dict = Depends(get_current_user)):
    return await core_client.post(
        "/internal/prompt",
        "Failed to generate prompt",
        json={**body, "clerk_id": user["sub"]},
        timeout=15.0,
    )


@router.post("/delete-workspace")
async def delete_workspace(body: dict, user: dict = Depends(get_current_user)):
    return await core_client.post(
        "/internal/memory/delete-workspace",
        "Failed to delete workspace",
        json={**body, "clerk_id": user["sub"]},
        timeout=15.0,
        passthrough_status=True,
    )


@router.delete("/{name}")
async def delete_memory(
    name: str, workspace: str = "default", user: dict = Depends(get_current_user)
):
    return await core_client.post(
        "/internal/memory/delete",
        "Failed to delete memory",
        json={"clerk_id": user["sub"], "workspace": workspace, "name": name},
    )
