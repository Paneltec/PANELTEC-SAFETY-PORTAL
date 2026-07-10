"""v160.2.6-cleanup — Idempotent dedupe of `worker_certifications`.

Problem
-------
User reported a duplicate certification card on the mobile "My
Certifications" screen. Investigation showed the mobile endpoint
`GET /api/me/worker-profile` returns exactly what the DB has, so this
is a data-layer bug: two rows share the same (org_id, worker_id, name)
tuple with `deleted_at = None`.

Root cause
----------
Two write paths land in `worker_certifications`:
  1. Manual entry via the web admin.
  2. Bulk induction-XLSX import (source == "induction_xlsx"), which
     historically appended rather than upserted on (worker_id, name).

Fix
---
For each (org_id, worker_id, name) group of live rows (>1 doc with
`deleted_at == None`), keep the row we most recently updated
(`updated_at DESC`, fallback `created_at DESC`) and soft-delete the
older siblings by stamping `deleted_at = now`. This preserves the audit
trail and is idempotent (re-running is a no-op — the group is size 1).

A snapshot collection `worker_certifications_backup_v160_2_6cleanup`
is written first so we can restore if needed.

Usage
-----
    python -m scripts.migrate_v160_2_6_cleanup_cert_dedupe

Prints a JSON summary of what changed.
"""
from __future__ import annotations

import asyncio
import os
import json
from datetime import datetime, timezone
from collections import defaultdict

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv


SNAPSHOT = "worker_certifications_backup_v160_2_6cleanup"


async def main() -> dict:
    load_dotenv()
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # 1) Snapshot (idempotent — skip if snapshot already populated).
    snap_count = await db[SNAPSHOT].estimated_document_count()
    if snap_count == 0:
        live = await db.worker_certifications.find({}, {"_id": 0}).to_list(None)
        if live:
            await db[SNAPSHOT].insert_many(live)
        snap_written = len(live)
    else:
        snap_written = 0  # already snapshotted

    # 2) Find duplicate groups.
    pipeline = [
        {"$match": {"deleted_at": None}},
        {"$group": {
            "_id": {"org_id": "$org_id", "worker_id": "$worker_id", "name": "$name"},
            "count": {"$sum": 1},
            "docs": {"$push": {
                "id": "$id",
                "updated_at": "$updated_at",
                "created_at": "$created_at",
                "source": "$source",
            }},
        }},
        {"$match": {"count": {"$gt": 1}}},
    ]
    groups = await db.worker_certifications.aggregate(pipeline).to_list(None)

    # 3) Soft-delete older siblings, keep newest updated_at.
    now = datetime.now(timezone.utc)
    kept: list[str] = []
    deleted: list[str] = []
    for g in groups:
        docs = g["docs"]
        # Sort by (updated_at desc, created_at desc). None-safe.
        def _key(d):
            return (
                d.get("updated_at") or d.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
                d.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
            )
        docs.sort(key=_key, reverse=True)
        keeper = docs[0]
        kept.append(keeper["id"])
        for d in docs[1:]:
            res = await db.worker_certifications.update_one(
                {"id": d["id"], "deleted_at": None},
                {"$set": {"deleted_at": now, "updated_at": now}},
            )
            if res.modified_count:
                deleted.append(d["id"])

    summary = {
        "snapshot_collection": SNAPSHOT,
        "snapshot_rows_written": snap_written,
        "duplicate_groups": len(groups),
        "docs_kept": kept,
        "docs_soft_deleted": deleted,
    }
    print(json.dumps(summary, indent=2, default=str))
    return summary


if __name__ == "__main__":
    asyncio.run(main())
