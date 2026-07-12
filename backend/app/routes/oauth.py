import base64
import hashlib
import secrets
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.deps import get_current_user
from app.jwt import mint_mcp_token
from app.models import McpToken, OAuthClient, OAuthCode

router = APIRouter(tags=["oauth"])


@router.get("/.well-known/oauth-authorization-server")
async def oauth_metadata():
    base = settings.CONTINUUM_BACKEND_PUBLIC_URL.rstrip("/")
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["mcp"],
    }


class RegisterRequest(BaseModel):
    client_name: str | None = None
    redirect_uris: list[str]


@router.post("/oauth/register", status_code=201)
async def register_client(
    body: RegisterRequest, session: AsyncSession = Depends(get_session)
):
    client_secret = secrets.token_urlsafe(32)
    client = OAuthClient(
        clientSecret=client_secret,
        redirectUris=body.redirect_uris,
        name=body.client_name,
    )
    session.add(client)
    await session.commit()
    return JSONResponse(
        status_code=201,
        content={
            "client_id": client.id,
            "client_secret": client_secret,
            "redirect_uris": body.redirect_uris,
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        },
    )


@router.get("/oauth/authorize")
async def authorize(
    client_id: str,
    redirect_uri: str,
    response_type: str = "code",
    state: str | None = None,
    code_challenge: str | None = None,
    code_challenge_method: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(OAuthClient, client_id)
    if not client:
        raise HTTPException(400, "Unknown client_id")
    if redirect_uri not in client.redirectUris:
        raise HTTPException(400, "redirect_uri not registered for this client")
    if response_type != "code":
        raise HTTPException(400, "Only response_type=code is supported")

    params: dict[str, str] = {"client_id": client_id, "redirect_uri": redirect_uri}
    if state:
        params["state"] = state
    if code_challenge:
        params["code_challenge"] = code_challenge
    if code_challenge_method:
        params["code_challenge_method"] = code_challenge_method

    frontend = settings.CONTINUUM_FRONTEND_URL.rstrip("/")
    return RedirectResponse(f"{frontend}/oauth-connect?{urllib.parse.urlencode(params)}")


class CompleteRequest(BaseModel):
    client_id: str
    redirect_uri: str
    state: str | None = None
    code_challenge: str | None = None
    code_challenge_method: str | None = None


@router.post("/api/oauth/complete")
async def authorize_complete(
    body: CompleteRequest,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(OAuthClient, body.client_id)
    if not client or body.redirect_uri not in client.redirectUris:
        raise HTTPException(400, "Invalid client or redirect_uri")

    code = secrets.token_urlsafe(32)
    session.add(
        OAuthCode(
            code=code,
            clerkUserId=user["sub"],
            clientId=body.client_id,
            redirectUri=body.redirect_uri,
            codeChallenge=body.code_challenge,
            codeChallengeMethod=body.code_challenge_method,
            expiresAt=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
    )
    await session.commit()

    params: dict[str, str] = {"code": code}
    if body.state:
        params["state"] = body.state
    return {"redirect_url": f"{body.redirect_uri}?{urllib.parse.urlencode(params)}"}


@router.post("/oauth/token")
async def token_exchange(
    grant_type: str = Form(),
    code: str = Form(),
    redirect_uri: str = Form(),
    client_id: str = Form(),
    code_verifier: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
):
    if grant_type != "authorization_code":
        raise HTTPException(400, detail={"error": "unsupported_grant_type"})

    oauth_code = await session.get(OAuthCode, code)
    if not oauth_code:
        raise HTTPException(400, detail={"error": "invalid_grant", "error_description": "Code not found"})
    if oauth_code.clientId != client_id:
        raise HTTPException(400, detail={"error": "invalid_grant", "error_description": "client_id mismatch"})
    if oauth_code.redirectUri != redirect_uri:
        raise HTTPException(400, detail={"error": "invalid_grant", "error_description": "redirect_uri mismatch"})

    expires = oauth_code.expiresAt
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        await session.delete(oauth_code)
        await session.commit()
        raise HTTPException(400, detail={"error": "invalid_grant", "error_description": "Code expired"})

    if oauth_code.codeChallenge:
        if not code_verifier:
            raise HTTPException(400, detail={"error": "invalid_grant", "error_description": "code_verifier required"})
        digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
        computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        if computed != oauth_code.codeChallenge:
            raise HTTPException(400, detail={"error": "invalid_grant", "error_description": "PKCE verification failed"})

    # One-time use
    clerk_user_id = oauth_code.clerkUserId
    await session.delete(oauth_code)

    now = datetime.now(timezone.utc)
    await session.execute(
        update(McpToken)
        .where(McpToken.clerkUserId == clerk_user_id, McpToken.revokedAt.is_(None))
        .values(revokedAt=now)
    )

    jti = str(uuid.uuid4())
    access_token = mint_mcp_token(clerk_user_id, jti)
    session.add(McpToken(clerkUserId=clerk_user_id, label="oauth", jti=jti))
    await session.commit()

    return JSONResponse(
        content={"access_token": access_token, "token_type": "bearer"},
        headers={"Cache-Control": "no-store"},
    )
