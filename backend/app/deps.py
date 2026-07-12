from clerk_backend_api import AuthenticateRequestOptions, Clerk
from fastapi import Depends, HTTPException, Request

from app.config import settings

_clerk = Clerk(bearer_auth=settings.CLERK_SECRET_KEY)


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
