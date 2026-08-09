from clerk_backend_api import AuthenticateRequestOptions, Clerk
from fastapi import Depends, HTTPException, Request

from app.config import settings

_clerk = Clerk(bearer_auth=settings.CLERK_SECRET_KEY)


def require_internal_secret(request: Request) -> None:
    """Gate for routes called by core-mcp rather than an end user — mirrors
    core-mcp's own _check_internal_secret for the reverse direction."""
    secret = request.headers.get("X-Internal-Secret", "")
    if not settings.CONTINUUM_INTERNAL_SECRET or secret != settings.CONTINUUM_INTERNAL_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


async def get_current_user(request: Request) -> dict:
    state = _clerk.authenticate_request(
        request,
        AuthenticateRequestOptions(),
    )
    if not state.is_signed_in:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return state.payload


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("public_metadata", {}).get("isAdmin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
