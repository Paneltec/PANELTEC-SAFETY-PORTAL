"""v160.2.7 — Worker view-only permissions: audit + idempotent backfill.

Purpose
-------
Grant workers view-only access org-wide across every currently-enabled
worker mobile module. The audit (see `/app/memory/v160_2_7_worker_audit.md`)
established that:

  1. Every enabled worker mobile module already grants `view=True`
     via `permissions.ROLE_DEFAULTS["worker"]`. No preset change is
     required.
  2. No worker user currently carries a `view: false` per-user
     override on any of those resources.

The migration therefore becomes a **defensive assertion + idempotent
guardrail**:

  • Snapshot `user_permissions` → `user_permissions_backup_v160_2_7`.
  • For every worker-role user, strip any per-user override that
    would deny `view` on the 9 view-gated resources in the audit §3.
  • Log a JSON summary and exit 0.

Re-running the script when the invariant already holds is a no-op.

Usage
-----
    python -m scripts.migrate_v160_2_7_worker_perms
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv


SNAPSHOT = "user_permissions_backup_v160_2_7"

# Resources gated by the currently-enabled worker mobile modules.
# Kept in lock-step with `mobile_modules.DEFAULTS["worker"]` and
# `permissions.ROLE_DEFAULTS["worker"]` — see audit doc §3.
WORKER_VIEW_RESOURCES: list[str] = [
    "pre_starts", "site_diary", "hazards", "incidents", "inspections",
    "swms", "inductions", "certifications", "forms", "workers",
]


async def main() -> dict:
    load_dotenv()
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    # 1) Snapshot (idempotent).
    if await db[SNAPSHOT].estimated_document_count() == 0:
        docs = await db.user_permissions.find({}, {"_id": 0}).to_list(None)
        if docs:
            await db[SNAPSHOT].insert_many(docs)
        snap_written = len(docs)
    else:
        snap_written = 0

    # 2) Enumerate worker-role users.
    workers = await db.users.find(
        {"role": "worker", "deleted_at": None},
        {"_id": 0, "id": 1, "email": 1},
    ).to_list(None)

    # 3) Strip any view=false override on WORKER_VIEW_RESOURCES.
    cleared: list[dict] = []
    now = datetime.now(timezone.utc)
    for w in workers:
        doc = await db.user_permissions.find_one({"user_id": w["id"]}, {"_id": 0})
        if not doc:
            continue
        overrides = dict(doc.get("overrides") or {})
        changed = False
        for res in WORKER_VIEW_RESOURCES:
            r_over = dict(overrides.get(res) or {})
            if r_over.get("view") is False:
                r_over.pop("view", None)
                changed = True
                cleared.append({"user_id": w["id"], "email": w["email"], "resource": res})
                # Trim empty override buckets so we don't keep an
                # {resource: {}} placeholder hanging around.
                if r_over:
                    overrides[res] = r_over
                else:
                    overrides.pop(res, None)
            else:
                overrides[res] = r_over or overrides.get(res, {})
        if changed:
            await db.user_permissions.update_one(
                {"user_id": w["id"]},
                {"$set": {
                    "overrides": overrides,
                    "updated_at": now.isoformat(),
                    "updated_by": "migrate_v160_2_7_worker_perms",
                }},
            )

    summary = {
        "snapshot_collection": SNAPSHOT,
        "snapshot_rows_written": snap_written,
        "workers_enumerated": len(workers),
        "resources_asserted": WORKER_VIEW_RESOURCES,
        "denies_cleared": cleared,
        "denies_cleared_count": len(cleared),
    }
    print(json.dumps(summary, indent=2, default=str))
    return summary


if __name__ == "__main__":
    asyncio.run(main())
