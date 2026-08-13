from clerk_backend_api import Clerk
from fastapi import APIRouter, Depends

from app import core_client
from app.config import settings
from app.deps import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

_clerk = Clerk(bearer_auth=settings.CLERK_SECRET_KEY)


@router.get("/users")
async def list_users(_: dict = Depends(require_admin)):
    response = await _clerk.users.list_async()
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
    return await core_client.get("/internal/stats", "Failed to fetch stats from core")
