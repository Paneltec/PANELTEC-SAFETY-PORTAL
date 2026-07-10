"""v160.2.6-cleanup — Regression tests.

Coverage
--------
1. `worker_certifications` collection contains no live duplicates on
   the (org_id, worker_id, name) tuple.  Prevents a regression of the
   "duplicate CPR/First Aid card" issue reported by field users.
2. The dedupe script (`scripts.migrate_v160_2_6_cleanup_cert_dedupe`)
   is idempotent — a second invocation must delete 0 additional rows.

Uses the synchronous-style test convention already used across
`test_v160_2_*.py` (drive the async work via `asyncio.run`).
"""
from __future__ import annotations

import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv


def _db():
    load_dotenv()
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def test_no_live_duplicate_certifications():
    async def run():
        db = _db()
        pipeline = [
            {"$match": {"deleted_at": None}},
            {"$group": {
                "_id": {
                    "org_id": "$org_id",
                    "worker_id": "$worker_id",
                    "name": "$name",
                },
                "count": {"$sum": 1},
            }},
            {"$match": {"count": {"$gt": 1}}},
        ]
        return await db.worker_certifications.aggregate(pipeline).to_list(None)

    dupes = asyncio.run(run())
    assert dupes == [], f"Live duplicate certifications still present: {dupes}"


def test_dedupe_migration_is_idempotent():
    from scripts.migrate_v160_2_6_cleanup_cert_dedupe import main
    summary = asyncio.run(main())
    assert summary["duplicate_groups"] == 0
    assert summary["docs_soft_deleted"] == []
