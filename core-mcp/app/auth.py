import os

from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.server.dependencies import get_access_token


def build_verifier() -> JWTVerifier | None:
    public_key = os.environ.get("CONTINUUM_JWT_PUBLIC_KEY", "").strip()
    if not public_key:
        return None
    return JWTVerifier(
        public_key=public_key,
        algorithm=os.environ.get("CONTINUUM_JWT_ALGORITHM", "RS256"),
    )


def current_owner() -> str | None:
    token = get_access_token()
    return token.client_id if token else None
