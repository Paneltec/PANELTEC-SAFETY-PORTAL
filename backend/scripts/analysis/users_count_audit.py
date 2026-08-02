"""One-off diagnostic — DO NOT COMMIT. Investigation for
v160.3.9.31-4a hot-patch: "80 users in your org" appears inflated.

Prints counts across the users collection scoped to Stephen's org so
we can see which buckets inflate the visible total.

Run: python scripts/analysis/users_count_audit.py
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from db import db  # noqa: E402

ADMIN_EMAIL = "stephen@paneltec.com.au"


async def main() -> None:
    admin = await db.users.find_one({"email": ADMIN_EMAIL}, {"_id": 0, "id": 1, "org_id": 1, "email": 1})
    if not admin:
        print(f"Admin {ADMIN_EMAIL} not found.")
        return
    org_id = admin["org_id"]
    print(f"Anchor admin: {admin['email']}  org_id={org_id}\n")

    async def c(label: str, q: dict) -> None:
        n = await db.users.count_documents(q)
        print(f"  {label:<48} = {n:>4}")

    base = {"org_id": org_id}
    print("== Scoped to admin's org_id ==")
    await c("Total docs (any state)", base)
    await c("activation_status == 'active'", {**base, "activation_status": "active"})
    await c("activation_status == 'pending_activation'", {**base, "activation_status": "pending_activation"})
    await c("activation_status == 'suspended'", {**base, "activation_status": "suspended"})
    await c("activation_status missing (unset)", {**base, "activation_status": {"$exists": False}})
    await c("activation_status == null", {**base, "activation_status": None})
    await c("is_archived == True", {**base, "is_archived": True})
    await c("is_archived == False", {**base, "is_archived": False})
    await c("is_archived missing", {**base, "is_archived": {"$exists": False}})
    await c("deleted_at != null", {**base, "deleted_at": {"$ne": None}})
    await c("deleted_at missing OR null", {**base, "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]})
    await c("status == 'invited'", {**base, "status": "invited"})
    await c("status == 'active'", {**base, "status": "active"})
    await c("status == 'disabled'", {**base, "status": "disabled"})
    await c("email contains 'fixture'", {**base, "email": {"$regex": "fixture", "$options": "i"}})
    await c("email contains 'warmup'", {**base, "email": {"$regex": "warmup", "$options": "i"}})
    await c("email contains 'example.com'", {**base, "email": {"$regex": "example.com", "$options": "i"}})
    await c("email contains 'demo'", {**base, "email": {"$regex": "demo", "$options": "i"}})
    await c("role_id is set (non-null)", {**base, "role_id": {"$exists": True, "$ne": None}})
    await c("simpro_employee_id is set", {**base, "simpro_employee_id": {"$exists": True, "$ne": None}})

    # What list_users() actually returns (no hide_test filter, no other filter):
    live_count = await db.users.count_documents(base)
    print(f"\n  → What GET /api/users returns (unfiltered, org-scoped): {live_count}")

    # What it would return with hide_test=true
    from users import _TEST_ACCOUNT_OR
    hide_test_q = {**base, "$nor": _TEST_ACCOUNT_OR}
    hide_test_count = await db.users.count_documents(hide_test_q)
    print(f"  → With hide_test=true (removes seeded demo accounts): {hide_test_count}")

    # A candidate "sensible default" for admins:
    # non-archived, not deleted, not a fixture email — "real people."
    admin_default_q = {
        **base,
        "$or": [{"is_archived": {"$exists": False}}, {"is_archived": False}],
        "$and": [
            {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
            {"email": {"$not": {"$regex": "fixture|warmup", "$options": "i"}}},
        ],
    }
    admin_default_count = await db.users.count_documents(admin_default_q)
    print(f"  → Proposed 'sensible default' (non-archived, non-deleted, non-fixture): {admin_default_count}")

    # Cross-org sanity: are there other orgs in this DB?
    all_orgs = await db.users.distinct("org_id")
    print(f"\n  Distinct org_ids in `users`: {len(all_orgs)}  (admin's = {org_id})")

    # Dump a sample of fixture-flavoured emails so we see what's inflating:
    print("\n  Sample emails matching 'fixture|warmup|demo|example':")
    async for u in db.users.find(
        {**base, "email": {"$regex": "fixture|warmup|demo|example", "$options": "i"}},
        {"_id": 0, "email": 1, "activation_status": 1, "is_archived": 1, "role_id": 1},
    ).limit(30):
        print(f"    - {u.get('email'):<50} status={u.get('activation_status')} archived={u.get('is_archived')} role_id={u.get('role_id')}")


if __name__ == "__main__":
    asyncio.run(main())
