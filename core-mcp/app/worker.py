import logging

from .infra import pg
from .infra import redis as redis_infra
from .memory import capture, kg

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger("continuum.worker")


async def build_graph_job(ctx, owner: str, name: str, text: str, reference_time_iso: str) -> None:
    await kg.extract(owner, name, text, reference_time_iso)


async def capture_session_job(ctx, owner: str, session_id: str, transcript: str) -> None:
    saved = await capture.extract_candidates(owner, session_id, transcript)
    logger.info("Session capture: %d candidate(s) queued for owner=%s", saved, owner)


async def startup(ctx) -> None:
    await pg.start()
    await redis_infra.start()
    logger.info("Worker started")


async def shutdown(ctx) -> None:
    await redis_infra.stop()
    await pg.stop()
    logger.info("Worker stopped")


class WorkerSettings:
    functions = [build_graph_job, capture_session_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = redis_infra.redis_settings()
