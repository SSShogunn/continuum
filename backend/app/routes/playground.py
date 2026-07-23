import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastmcp import Client
from pydantic import BaseModel

from app.config import settings
from app.deps import get_current_user
from app.jwt import mint_mcp_token

router = APIRouter(prefix="/api/playground", tags=["playground"])


class RunRequest(BaseModel):
    tool: str
    arguments: dict = {}


@router.post("/run")
async def run_tool(body: RunRequest, user: dict = Depends(get_current_user)):
    token = mint_mcp_token(user["sub"], str(uuid.uuid4()))
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/mcp"

    try:
        async with Client(url, auth=token) as client:
            result = await client.call_tool(body.tool, body.arguments, raise_on_error=False)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    text = "\n".join(
        block.text for block in result.content if getattr(block, "text", None)
    )
    images = [
        f"data:{block.mimeType};base64,{block.data}"
        for block in result.content
        if getattr(block, "type", None) == "image"
    ]
    return {
        "is_error": result.is_error,
        "text": text,
        "data": result.data,
        "images": images,
    }
