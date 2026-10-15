import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import APIRouter, Depends, Form, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.deps import get_current_user
from app.jwt import mint_mcp_token
from app.models import DeviceAuthorization, McpToken

router = APIRouter(tags=["device"])

DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
DEVICE_CODE_TTL = timedelta(minutes=10)
POLL_INTERVAL = 5
ACCESS_TOKEN_TTL = 3600
REFRESH_TOKEN_TTL = timedelta(days=60)
ROTATION_GRACE = timedelta(seconds=60)

_USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"
_USER_CODE_LENGTH = 8


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _normalize_user_code(code: str) -> str:
    return "".join(c for c in code.upper() if c in _USER_CODE_ALPHABET)


def _format_user_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _oauth_error(error: str, description: str | None = None) -> JSONResponse:
    content = {"error": error}
    if description:
        content["error_description"] = description
    return JSONResponse(status_code=400, content=content, headers={"Cache-Control": "no-store"})


def _token_response(access_token: str, refresh_token: str | None) -> JSONResponse:
    content = {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_TTL,
    }
    if refresh_token:
        content["refresh_token"] = refresh_token
    return JSONResponse(content=content, headers={"Cache-Control": "no-store"})


@router.post("/oauth/device_authorization")
async def device_authorization(
    device_name: str = Form(default="unknown device"),
    session: AsyncSession = Depends(get_session),
):
    now = datetime.now(timezone.utc)
    await session.execute(delete(DeviceAuthorization).where(DeviceAuthorization.expiresAt < now))

    device_code = secrets.token_urlsafe(32)
    while True:
        user_code = "".join(secrets.choice(_USER_CODE_ALPHABET) for _ in range(_USER_CODE_LENGTH))
        taken = await session.scalar(
            select(DeviceAuthorization.id).where(DeviceAuthorization.userCode == user_code)
        )
        if not taken:
            break

    session.add(
        DeviceAuthorization(
            deviceCodeHash=_hash(device_code),
            userCode=user_code,
            deviceName=device_name.strip()[:100] or "unknown device",
            expiresAt=now + DEVICE_CODE_TTL,
        )
    )
    await session.commit()

    verification_uri = f"{settings.CONTINUUM_FRONTEND_URL.rstrip('/')}/device"
    display_code = _format_user_code(user_code)
    return JSONResponse(
        content={
            "device_code": device_code,
            "user_code": display_code,
            "verification_uri": verification_uri,
            "verification_uri_complete": f"{verification_uri}?code={display_code}",
            "expires_in": int(DEVICE_CODE_TTL.total_seconds()),
            "interval": POLL_INTERVAL,
        },
        headers={"Cache-Control": "no-store"},
    )


async def _pending_by_user_code(session: AsyncSession, user_code: str) -> DeviceAuthorization:
    auth = await session.scalar(
        select(DeviceAuthorization).where(
            DeviceAuthorization.userCode == _normalize_user_code(user_code)
        )
    )
    if not auth or _utc(auth.expiresAt) < datetime.now(timezone.utc):
        raise HTTPException(404, "Code not found or expired — run the installer again")
    return auth


@router.get("/api/device")
async def get_device_request(
    user_code: str,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    auth = await _pending_by_user_code(session, user_code)
    return {
        "user_code": _format_user_code(auth.userCode),
        "device_name": auth.deviceName,
        "status": auth.status,
        "expires_at": auth.expiresAt,
    }


class DeviceDecision(BaseModel):
    user_code: str
    approve: bool


@router.post("/api/device")
async def decide_device_request(
    body: DeviceDecision,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    auth = await _pending_by_user_code(session, body.user_code)
    if auth.status != "pending":
        raise HTTPException(409, f"This code was already {auth.status}")
    auth.status = "approved" if body.approve else "denied"
    auth.clerkUserId = user["sub"] if body.approve else None
    await session.commit()
    return {"status": auth.status}


async def device_code_grant(session: AsyncSession, device_code: str | None) -> JSONResponse:
    if not device_code:
        return _oauth_error("invalid_request", "device_code required")
    auth = await session.scalar(
        select(DeviceAuthorization).where(DeviceAuthorization.deviceCodeHash == _hash(device_code))
    )
    if not auth:
        return _oauth_error("invalid_grant", "Unknown device_code")

    now = datetime.now(timezone.utc)
    if _utc(auth.expiresAt) < now:
        await session.delete(auth)
        await session.commit()
        return _oauth_error("expired_token")
    if auth.status == "denied":
        await session.delete(auth)
        await session.commit()
        return _oauth_error("access_denied")
    if auth.status == "pending":
        too_fast = auth.lastPolledAt and now - _utc(auth.lastPolledAt) < timedelta(
            seconds=POLL_INTERVAL - 1
        )
        auth.lastPolledAt = now
        await session.commit()
        return _oauth_error("slow_down" if too_fast else "authorization_pending")

    clerk_user_id = auth.clerkUserId
    device_name = auth.deviceName
    await session.delete(auth)
    return await issue_session(session, clerk_user_id, f"Claude Code hook · {device_name}")


async def issue_session(
    session: AsyncSession, clerk_user_id: str, label: str, client_id: str | None = None
) -> JSONResponse:
    now = datetime.now(timezone.utc)
    jti = str(uuid.uuid4())
    refresh_token = secrets.token_urlsafe(32)
    session.add(
        McpToken(
            clerkUserId=clerk_user_id,
            label=label,
            jti=jti,
            clientId=client_id,
            refreshTokenHash=_hash(refresh_token),
            refreshRotatedAt=now,
            refreshExpiresAt=now + REFRESH_TOKEN_TTL,
        )
    )
    await session.commit()
    return _token_response(mint_mcp_token(clerk_user_id, jti, ACCESS_TOKEN_TTL), refresh_token)


async def refresh_token_grant(
    session: AsyncSession, refresh_token: str | None, client_id: str | None = None
) -> JSONResponse:
    if not refresh_token:
        return _oauth_error("invalid_request", "refresh_token required")
    presented = _hash(refresh_token)
    now = datetime.now(timezone.utc)

    token = await session.scalar(
        select(McpToken).where(McpToken.refreshTokenHash == presented).with_for_update()
    )
    if token and client_id and token.clientId and token.clientId != client_id:
        return _oauth_error("invalid_grant", "Refresh token was issued to another client")
    if token:
        if token.revokedAt or not token.refreshExpiresAt or _utc(token.refreshExpiresAt) < now:
            return _oauth_error("invalid_grant", "Session expired or revoked")
        new_refresh = secrets.token_urlsafe(32)
        token.prevRefreshTokenHash = presented
        token.refreshTokenHash = _hash(new_refresh)
        token.refreshRotatedAt = now
        token.refreshExpiresAt = now + REFRESH_TOKEN_TTL
        await session.commit()
        return _token_response(mint_mcp_token(token.clerkUserId, token.jti, ACCESS_TOKEN_TTL), new_refresh)

    token = await session.scalar(
        select(McpToken).where(McpToken.prevRefreshTokenHash == presented).with_for_update()
    )
    if not token or token.revokedAt:
        return _oauth_error("invalid_grant", "Unknown refresh token")
    if token.refreshRotatedAt and now - _utc(token.refreshRotatedAt) <= ROTATION_GRACE:
        return _token_response(mint_mcp_token(token.clerkUserId, token.jti, ACCESS_TOKEN_TTL), None)

    token.revokedAt = now
    await session.commit()
    return _oauth_error("invalid_grant", "Refresh token reuse detected — session revoked")


def _jti_of(access_token: str) -> str | None:
    try:
        public_key = load_pem_private_key(
            settings.CONTINUUM_BACKEND_JWT_PRIVATE_KEY.encode(), password=None
        ).public_key()
        claims = jwt.decode(
            access_token,
            public_key,
            algorithms=[settings.CONTINUUM_BACKEND_JWT_ALGORITHM],
            audience="continuum-core",
            options={"verify_exp": False},
        )
    except (jwt.PyJWTError, ValueError, TypeError):
        return None
    return claims.get("jti")


@router.post("/oauth/revoke")
async def revoke(token: str = Form(), session: AsyncSession = Depends(get_session)):
    presented = _hash(token)
    conditions = [McpToken.refreshTokenHash == presented, McpToken.prevRefreshTokenHash == presented]
    jti = _jti_of(token)
    if jti:
        conditions.append(McpToken.jti == jti)
    for row in (await session.scalars(select(McpToken).where(or_(*conditions)))).all():
        row.revokedAt = row.revokedAt or datetime.now(timezone.utc)
    await session.commit()
    return Response(status_code=200, headers={"Cache-Control": "no-store"})
