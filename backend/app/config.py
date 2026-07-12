import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    CLERK_SECRET_KEY: str = os.environ["CLERK_SECRET_KEY"]
    CLERK_PUBLISHABLE_KEY: str = os.environ["CLERK_PUBLISHABLE_KEY"]

    DATABASE_URL: str = os.environ["DATABASE_URL"]

    CONTINUUM_BACKEND_JWT_PRIVATE_KEY: str = os.environ.get("CONTINUUM_BACKEND_JWT_PRIVATE_KEY", "")
    CONTINUUM_BACKEND_JWT_ALGORITHM: str = os.environ.get("CONTINUUM_BACKEND_JWT_ALGORITHM", "RS256")

    CONTINUUM_INTERNAL_SECRET: str = os.environ.get("CONTINUUM_INTERNAL_SECRET", "")
    CONTINUUM_CORE_BASE_URL: str = os.environ.get("CONTINUUM_CORE_BASE_URL", "http://localhost:8788")
    CONTINUUM_FRONTEND_URL: str = os.environ.get("CONTINUUM_FRONTEND_URL", "http://localhost:3000")
    CONTINUUM_BACKEND_PUBLIC_URL: str = os.environ.get("CONTINUUM_BACKEND_PUBLIC_URL", "http://localhost:8789")

    PORT: int = int(os.environ.get("PORT", "8789"))


settings = Settings()
