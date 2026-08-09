from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import require_internal_secret
from app.models import McpToken

router = APIRouter(prefix="/internal", tags=["internal"])


@router.get("/revoked-jtis", dependencies=[Depends(require_internal_secret)])
async def revoked_jtis(session: AsyncSession = Depends(get_session)):
    """Polled periodically by core-mcp to invalidate revoked/disconnected tokens —
    core-mcp's JWT verification is otherwise pure signature validation with no
    knowledge of this database. Tokens here have no `exp` claim, so this list is
    the only way a revoked token stops working."""
    result = await session.execute(
        select(McpToken.jti).where(McpToken.revokedAt.is_not(None))
    )
    return {"jtis": [row[0] for row in result.all()]}
