import httpx
from fastapi import HTTPException

from app.config import settings

DEFAULT_TIMEOUT = 10.0

_client: httpx.AsyncClient | None = None


async def start() -> None:
    global _client
    _client = httpx.AsyncClient(
        base_url=settings.CONTINUUM_CORE_BASE_URL.rstrip("/"),
        headers={"X-Internal-Secret": settings.CONTINUUM_INTERNAL_SECRET},
        timeout=DEFAULT_TIMEOUT,
    )


async def stop() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None


def _unwrap(resp: httpx.Response, detail: str, passthrough_status: bool) -> dict:
    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code if passthrough_status else 502,
            detail=detail,
        )
    return resp.json()


async def get(
    path: str,
    detail: str,
    *,
    params: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    passthrough_status: bool = False,
) -> dict:
    if _client is None:
        raise HTTPException(status_code=503, detail="Core client not started")
    try:
        resp = await _client.get(path, params=params, timeout=timeout)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail=detail)
    return _unwrap(resp, detail, passthrough_status)


async def post(
    path: str,
    detail: str,
    *,
    json: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    passthrough_status: bool = False,
) -> dict:
    if _client is None:
        raise HTTPException(status_code=503, detail="Core client not started")
    try:
        resp = await _client.post(path, json=json, timeout=timeout)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail=detail)
    return _unwrap(resp, detail, passthrough_status)
