"""2026-06-29 — Recover Paneltec demo users from phantom org.

ROOT CAUSE: `seed.py:_ensure_org_and_workspaces` keys the org lookup on the
mutable `name` field ("Paneltec Civil Pty Ltd"). When Stephen renamed his
org via Settings → Organisation on 2026-06-27 ("Paneltec Civil Pty Ltd" →
"Paneltec Pty Ltd"), the next backend boot ran seed.py, failed to find an
org by the old name, created a brand-new phantom org `9a6e2c3d-…`, and
rebound all 5 SEED_USERS to it via the email-keyed upsert in
`_ensure_users`. Five demo personas vanished from Stephen's Settings →
Users page.

THIS MIGRATION: moves the 5 demo personas back into Stephen's org and
stamps them with `org_migrated_at` + `org_migrated_from` so the patched
seed.py knows not to touch them again.

Pairs with the seed.py slug-keyed lookup patch shipped in the same turn.

IDEMPOTENT: re-running this script reports "already migrated, skipped"
for every row that already has `org_migrated_at` set.
"""
from __future__ import annotations
import asyncio
import os
import sys
from datetime import datetime, timezone

# Allow `python migrations/2026_…py` from anywhere under /app.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from db import db  # noqa: E402

STEPHEN_ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
PHANTOM_ORG_ID = "9a6e2c3d-b887-40c8-bb88-16900b366e1f"

# Stephen's "Sydney Metro" + "Newcastle Depot" workspaces — the two
# canonical demo workspaces that match what seed.py originally granted
# the SEED_USERS access to.
TARGET_WORKSPACE_IDS = [
    "751d9aeb-60ca-476f-b8db-c387144c59b7",  # Sydney Metro
    "54f4dcaa-6a01-4861-ba84-753d19584a94",  # Newcastle Depot
]

SEED_USER_EMAILS = [
    "demo@paneltec.com",
    "worker@paneltec.com",
    "super@paneltec.com",
    "audit@paneltec.com",
    "admin@paneltec.com",
]


async def main() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    migrated, skipped, not_found = [], [], []

    for email in SEED_USER_EMAILS:
        u = await db.users.find_one({"email": email}, {"_id": 0})
        if not u:
            not_found.append(email)
            continue
        if u.get("org_migrated_at"):
            skipped.append({"email": email, "id": u["id"],
                             "migrated_at": u["org_migrated_at"]})
            continue
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {
                "org_id": STEPHEN_ORG_ID,
                "workspace_ids": TARGET_WORKSPACE_IDS,
                "workspace_id": None,
                "org_migrated_at": now,
                "org_migrated_from": u.get("org_id"),
                "updated_at": now,
            }},
        )
        migrated.append({
            "email": email, "id": u["id"], "name": u.get("name"),
            "role": u.get("role"),
            "from_org": u.get("org_id"), "to_org": STEPHEN_ORG_ID,
        })

    result = {"migrated": migrated, "skipped": skipped, "not_found": not_found}
    return result


if __name__ == "__main__":
    res = asyncio.run(main())
    print("=== Recovery migration result ===")
    print(f"migrated  : {len(res['migrated'])}")
    for r in res["migrated"]:
        print(f"  • {r['email']:30s} | {r['name']:18s} | {r['role']:10s} | {r['from_org']} → {r['to_org']}")
    print(f"skipped   : {len(res['skipped'])} (already migrated)")
    for r in res["skipped"]:
        print(f"  • {r['email']:30s} | migrated_at={r['migrated_at']}")
    print(f"not_found : {len(res['not_found'])}")
    for e in res["not_found"]:
        print(f"  • {e}")
