"""One-off admin script: soft-delete Newcastle Depot + Sydney Metro workspaces
in the Paneltec Civil org, unassigning users along the way.

Run: cd /app/backend && python wipe_seed_workspaces.py
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient


async def main() -> int:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    org = await db.orgs.find_one({"name": {"$regex": "Paneltec", "$options": "i"}})
    if not org:
        print("ERROR: Paneltec org not found")
        return 1
    org_id = org["id"]
    print(f"Paneltec org: {org_id} ({org['name']})")

    targets = await db.workspaces.find(
        {"deleted_at": {"$exists": False},
         "name": {"$in": ["Newcastle Depot", "Sydney Metro"]}}
    ).to_list(20)
    if not targets:
        print("No matching workspaces to delete (already gone?)")
        return 0
    ids = [w["id"] for w in targets]
    print(f"Workspaces to soft-delete: {[(w['name'], w['id']) for w in targets]}")

    # Unassign users (no token_version bump — this isn't a security-relevant change)
    now = datetime.now(timezone.utc).isoformat()
    users_touched = await db.users.update_many(
        {"workspace_ids": {"$in": ids}},
        {"$pull": {"workspace_ids": {"$in": ids}},
         "$set": {"updated_at": now}},
    )
    print(f"Users unassigned: {users_touched.modified_count}")

    # Soft-delete the workspace docs
    soft = await db.workspaces.update_many(
        {"id": {"$in": ids}},
        {"$set": {"deleted_at": now, "updated_at": now}},
    )
    print(f"Workspaces soft-deleted: {soft.modified_count}")

    remaining = await db.workspaces.count_documents(
        {"org_id": org_id, "deleted_at": {"$exists": False}}
    )
    print(f"Active workspaces remaining in Paneltec org: {remaining}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
