import logging
import os

import httpx
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.server.auth.auth import AccessToken
from fastmcp.server.dependencies import get_access_token

logger = logging.getLogger("continuum.auth")

# Populated by refresh_revoked_jtis(), polled periodically from server.py's
# lifespan. Tokens minted here carry no `exp` claim (see backend/app/jwt.py),
# so this in-memory set is the only thing that makes Revoke/Disconnect in the
# dashboard actually take effect — plain JWT signature validation alone
# accepts a revoked token forever.
_revoked_jtis: set[str] = set()


class RevocationAwareJWTVerifier(JWTVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        access_token = await super().verify_token(token)
        if access_token is None:
            return None
        jti = access_token.claims.get("jti")
        if jti and jti in _revoked_jtis:
            return None
        return access_token


def build_verifier() -> JWTVerifier | None:
    public_key = os.environ.get("CONTINUUM_JWT_PUBLIC_KEY", "").strip()
    if not public_key:
        return None
    return RevocationAwareJWTVerifier(
        public_key=public_key,
        algorithm=os.environ.get("CONTINUUM_JWT_ALGORITHM", "RS256"),
    )


async def refresh_revoked_jtis() -> None:
    backend = os.environ.get("CONTINUUM_BACKEND_PUBLIC_URL", "").rstrip("/")
    secret = os.environ.get("CONTINUUM_INTERNAL_SECRET", "")
    if not backend or not secret:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{backend}/internal/revoked-jtis",
                headers={"X-Internal-Secret": secret},
            )
            response.raise_for_status()
            jtis = response.json().get("jtis", [])
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Failed to refresh revoked-token list: %r", exc)
        return
    _revoked_jtis.clear()
    _revoked_jtis.update(jtis)


def current_owner() -> str | None:
    token = get_access_token()
    return token.client_id if token else None


def compose_owner(clerk_id: str, workspace: str = "default") -> str:
    return f"{clerk_id}:{workspace}"


def scoped_owner(workspace: str = "default") -> str:
    return compose_owner(current_owner() or "", workspace)
