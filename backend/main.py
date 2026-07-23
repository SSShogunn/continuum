from contextlib import asynccontextmanager

import uvicorn
from fastapi import Depends, FastAPI

from app.config import settings
from app.db import connect, disconnect
from app.deps import get_current_user
from app.routes import admin, memory, oauth, playground, tokens


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    yield
    await disconnect()


app = FastAPI(title="Continuum Backend", version="0.1.0", lifespan=lifespan)

app.include_router(tokens.router)
app.include_router(memory.router)
app.include_router(admin.router)
app.include_router(oauth.router)
app.include_router(playground.router)


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
