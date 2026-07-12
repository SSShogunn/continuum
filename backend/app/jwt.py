import uuid
from datetime import datetime, timezone

import jwt

from app.config import settings


def mint_mcp_token(clerk_user_id: str, jti: str) -> str:
    payload = {
        "sub": clerk_user_id,
        "jti": jti,
        "iss": "continuum-backend",
        "aud": "continuum-core",
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }
    return jwt.encode(
        payload,
        settings.CONTINUUM_BACKEND_JWT_PRIVATE_KEY,
        algorithm=settings.CONTINUUM_BACKEND_JWT_ALGORITHM,
    )
