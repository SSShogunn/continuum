import logging

from .infra import pg
from .infra import redis as redis_infra
from .memory import facts, graph

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
logger = logging.getLogger("continuum.worker")


async def extract_facts_job(ctx, owner: str, name: str, text: str) -> None:
    await facts.extract(owner, name, text)


async def extract_graph_job(ctx, owner: str, facts_payload: list[tuple[int, str]]) -> None:
    await graph.extract(owner, facts_payload)


async def startup(ctx) -> None:
    await pg.start()
    await redis_infra.start()
    logger.info("Worker started")


async def shutdown(ctx) -> None:
    await redis_infra.stop()
    await pg.stop()
    logger.info("Worker stopped")


class WorkerSettings:
    functions = [extract_facts_job, extract_graph_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = redis_infra.redis_settings()
