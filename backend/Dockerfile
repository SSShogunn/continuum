FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock prisma/ ./
RUN uv sync --frozen && uv run prisma generate

COPY . .

EXPOSE 8789
CMD ["uv", "run", "python", "main.py"]
