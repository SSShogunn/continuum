import os
from prisma import Prisma

db = Prisma(datasource={"url": os.environ["DATABASE_URL"]})


async def connect() -> None:
    await db.connect()


async def disconnect() -> None:
    await db.disconnect()
