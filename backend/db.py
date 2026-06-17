"""MongoDB connection — shared async motor client."""
import os
from motor.motor_asyncio import AsyncIOMotorClient

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]


def get_db():
    return db


def close():
    _client.close()
