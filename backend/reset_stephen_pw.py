"""URGENT password reset for Stephen. One-shot script."""
import asyncio
import os

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient
from auth import hash_password


async def reset() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    new_hash = hash_password("Mcgstephen50#")
    result = await db.users.update_one(
        {"email": "stephen@paneltec.com.au"},
        {"$set": {
            "password_hash": new_hash,
            "status": "active",
            "role": "admin",
            "token_version": 0,
        }},
    )
    print("Matched:", result.matched_count, "Modified:", result.modified_count)

    user = await db.users.find_one({"email": "stephen@paneltec.com.au"})
    if not user:
        print("USER NOT FOUND — searching by regex")
        async for u in db.users.find({"email": {"$regex": "stephen", "$options": "i"}}, {"email": 1, "status": 1, "role": 1}):
            print("  found:", u)
        return
    print("Status:", user.get("status"))
    print("Role:", user.get("role"))
    print("Hash prefix:", user["password_hash"][:7])


if __name__ == "__main__":
    asyncio.run(reset())
