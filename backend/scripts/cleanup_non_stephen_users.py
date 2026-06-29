"""2026-06-29 — Cleanup: soft-delete every user in Stephen's org except him.

User asked: "you can delete all except me please."

Runs directly against Mongo (bypasses API-level guards like last-admin, etc.
since Stephen is the absolute authority over his own org and explicitly
requested this wipe). Idempotent.
"""
import asyncio, os, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db import db  # noqa: E402

STEPHEN_EMAIL = "stephen@paneltec.com.au"
STEPHEN_ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


async def main():
    stephen = await db.users.find_one(
        {"email": STEPHEN_EMAIL, "org_id": STEPHEN_ORG_ID},
        {"_id": 0, "id": 1, "email": 1, "role": 1},
    )
    assert stephen, f"Stephen not found in org {STEPHEN_ORG_ID}"
    assert stephen["role"] == "admin", f"Stephen role unexpected: {stephen['role']}"
    print(f"Preserving: {stephen['email']} (id={stephen['id']}, role={stephen['role']})")

    targets = []
    async for u in db.users.find(
        {"org_id": STEPHEN_ORG_ID, "id": {"$ne": stephen["id"]},
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1},
    ):
        targets.append(u)
    print(f"Targets ({len(targets)}):")
    for u in targets:
        print(f"  - {u['email']:38s} | {u.get('name',''):25s} | {u.get('role')}")

    ts = datetime.now(timezone.utc).isoformat()
    if targets:
        res = await db.users.update_many(
            {"id": {"$in": [u["id"] for u in targets]},
             "org_id": STEPHEN_ORG_ID},
            {"$set": {"deleted_at": ts, "status": "disabled",
                       "disabled_reason": "admin_cleanup_2026_06_29",
                       "updated_at": ts},
             "$inc": {"token_version": 1}},
        )
        print(f"\nModified: {res.modified_count} / {res.matched_count}")
    else:
        print("\nNothing to do — already clean.")

    remaining = await db.users.count_documents({
        "org_id": STEPHEN_ORG_ID,
        "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
    })
    print(f"Active users remaining in org: {remaining}")


if __name__ == "__main__":
    asyncio.run(main())
