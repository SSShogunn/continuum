import asyncio
import os

EMBEDDING_MODEL = os.environ.get("CONTINUUM_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

_model = None


def _embed_sync(text: str) -> list[float]:
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(EMBEDDING_MODEL)
    return next(iter(_model.embed([text]))).tolist()


async def embed(text: str) -> list[float]:
    return await asyncio.to_thread(_embed_sync, text)
