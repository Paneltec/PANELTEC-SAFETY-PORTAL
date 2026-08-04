"""One-shot purge of test-artefact roles left behind by prior pytests.

Targets any role whose `name` starts with "Fallback Test" or "CacheBust"
(the two ephemeral naming conventions used by legacy test fixtures).
Aborts if any of the matched roles is still referenced by a user via
`role_id` — no orphaned users allowed.

Usage:
    python3 /app/backend/scripts/purge_test_artefact_roles.py

Writes a single audit row into a new `admin_actions` collection so the
delete is discoverable by the compliance team:

    {
        actor: "system-cleanup-v57",
        action: "purge_test_artefact_roles",
        ids: [<role_id, ...>],
        names: [<role.name, ...>],
        deleted_count: N,
        run_at: <iso>,
        version: "paneltec-v160.3.9.57",
    }
"""
from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


_TEST_ROLE_NAME_RX = re.compile(r"^(?:Fallback Test|CacheBust)\b", re.IGNORECASE)
_VERSION_TAG = "paneltec-v160.3.9.57"


async def main() -> int:
    load_dotenv("/app/backend/.env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "paneltec")]

    # 1) Enumerate every matching role, listing whatever the compliance
    #    team cares about at review-time (id/name/source/token-count).
    print("=== Step 1: enumerating matching roles ===")
    matches: list[dict] = []
    async for r in db.roles.find({}):
        if not _TEST_ROLE_NAME_RX.match(r.get("name") or ""):
            continue
        matches.append(
            {
                "id": r.get("id") or str(r.get("_id")),
                "_id": str(r.get("_id")),
                "name": r.get("name"),
                "source": r.get("source"),
                "permission_tokens_count": len(r.get("permission_tokens") or []),
                "auto_created": bool(r.get("auto_created")),
                "is_system": bool(r.get("is_system")),
            }
        )

    if not matches:
        print("No test-artefact roles found — nothing to do.")
        return 0

    print(f"Found {len(matches)} candidate role(s):")
    for m in matches:
        print(
            f"  - id={m['id']:36s}  _id={m['_id']:24s}  "
            f"tokens={m['permission_tokens_count']:>3d}  "
            f"source={m.get('source')!r:>24s}  name={m['name']!r}"
        )

    # 2) Cross-check: no user should be pointing at any of these roles.
    print("\n=== Step 2: verifying no user references any candidate ===")
    ids_to_check = [m["id"] for m in matches] + [m["_id"] for m in matches]
    ref_cursor = db.users.find(
        {"role_id": {"$in": ids_to_check}},
        {"_id": 0, "id": 1, "email": 1, "role_id": 1},
    )
    referencing_users = await ref_cursor.to_list(50)
    if referencing_users:
        print(
            "ABORT — the following users still reference candidate roles. "
            "Reassign them first, then re-run this script:"
        )
        for u in referencing_users:
            print(f"  - {u.get('email')!r} → role_id={u.get('role_id')!r}")
        return 1
    print("Clean — no user references any of the candidates.")

    # 3) Delete.
    print("\n=== Step 3: deleting ===")
    delete_ids = [m["id"] for m in matches]
    delete_object_ids = [m["_id"] for m in matches]
    from bson import ObjectId

    or_query = [
        {"id": {"$in": delete_ids}},
        {"_id": {"$in": [ObjectId(x) for x in delete_object_ids if len(x) == 24]}},
    ]
    result = await db.roles.delete_many({"$or": or_query})
    print(f"Deleted {result.deleted_count} role document(s).")

    # 4) Audit row.
    print("\n=== Step 4: writing admin_actions audit ===")
    audit_doc = {
        "actor": "system-cleanup-v57",
        "action": "purge_test_artefact_roles",
        "ids": delete_ids,
        "names": [m["name"] for m in matches],
        "deleted_count": result.deleted_count,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "version": _VERSION_TAG,
    }
    await db.admin_actions.insert_one(audit_doc)
    print("Audit row inserted:")
    for k, v in audit_doc.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
