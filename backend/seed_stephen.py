"""One-off (idempotent) seed for real admin accounts.

Run from /app/backend:
    python3 seed_stephen.py

Re-running is safe: existing users get their password hash + role + status +
workspace bindings refreshed and their token_version bumped (which invalidates
any old session token that was issued before the password rotation).
"""
import asyncio
import sys

sys.path.insert(0, "/app/backend")

from auth import hash_password
from db import db
from models import new_id, now_iso

EMAIL = "stephen@paneltec.com.au"
NAME = "Stephen"
ROLE = "admin"
PASSWORD = "PaneltecCivil-2026!"


async def main():
    org = await db.orgs.find_one({"slug": "paneltec-civil"}, {"id": 1})
    if not org:
        raise SystemExit("Paneltec Civil org not found — make sure the main seed has run.")
    org_id = org["id"]

    workspaces = await db.workspaces.find({"org_id": org_id}, {"id": 1, "name": 1}).to_list(200)
    ws_ids = sorted(w["id"] for w in workspaces)
    print(f"org_id={org_id}  workspaces={[w['name'] for w in workspaces]}")

    pwd_hash = hash_password(PASSWORD)
    existing = await db.users.find_one({"email": EMAIL}, {"_id": 0})

    if existing:
        await db.users.update_one(
            {"id": existing["id"]},
            {"$set": {
                "name": NAME,
                "role": ROLE,
                "status": "active",
                "org_id": org_id,
                "workspace_ids": ws_ids,
                "password_hash": pwd_hash,
                "updated_at": now_iso(),
            }, "$inc": {"token_version": 1}},
        )
        print(f"updated existing user id={existing['id']}  (token_version bumped)")
    else:
        doc = {
            "id": new_id(),
            "email": EMAIL,
            "name": NAME,
            "role": ROLE,
            "status": "active",
            "org_id": org_id,
            "workspace_ids": ws_ids,
            "password_hash": pwd_hash,
            "token_version": 0,
            "created_at": now_iso(),
        }
        await db.users.insert_one(doc)
        print(f"inserted new user id={doc['id']}")


if __name__ == "__main__":
    asyncio.run(main())
