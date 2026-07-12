import httpx
from clerk_backend_api import Clerk
from fastapi import APIRouter, Depends, HTTPException

from app.config import settings
from app.deps import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

_clerk = Clerk(bearer_auth=settings.CLERK_SECRET_KEY)


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    response = _clerk.users.list()
    return [
        {
            "id": u.id,
            "email": u.email_addresses[0].email_address if u.email_addresses else None,
            "isAdmin": (u.public_metadata or {}).get("isAdmin", False),
            "createdAt": u.created_at,
            "lastSignInAt": u.last_sign_in_at,
        }
        for u in (response.result if hasattr(response, "result") else response)
    ]


@router.get("/stats")
async def get_stats(_: dict = Depends(require_admin)):
    url = f"{settings.CONTINUUM_CORE_BASE_URL}/internal/stats"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
            timeout=10.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch stats from core")
    return resp.json()
