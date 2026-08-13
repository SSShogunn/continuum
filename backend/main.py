from contextlib import asynccontextmanager

import uvicorn
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import core_client
from app.config import settings
from app.db import connect, disconnect
from app.deps import get_current_user
from app.routes import account, admin, connections, internal, memory, oauth, stats, tokens


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    await core_client.start()
    yield
    await core_client.stop()
    await disconnect()


app = FastAPI(title="Continuum Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.CONTINUUM_FRONTEND_URL],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tokens.router)
app.include_router(connections.router)
app.include_router(memory.router)
app.include_router(admin.router)
app.include_router(oauth.router)
app.include_router(stats.router)
app.include_router(internal.router)
app.include_router(account.router)


@app.get("/api/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "id": user.get("sub"),
        "email": user.get("email"),
        "isAdmin": user.get("public_metadata", {}).get("isAdmin", False),
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=True)
