import asyncio
import os
import threading

EMBEDDING_MODEL = os.environ.get("CONTINUUM_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

_model = None
_model_lock = threading.Lock()


def _embed_sync(text: str) -> list[float]:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from fastembed import TextEmbedding
                _model = TextEmbedding(EMBEDDING_MODEL)
    return next(iter(_model.embed([text]))).tolist()


async def embed(text: str) -> list[float]:
    return await asyncio.to_thread(_embed_sync, text)
