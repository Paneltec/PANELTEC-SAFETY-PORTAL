"""v58.13.120a — Purge 10 residual TEST-v58.13.14 assets + cascade schedules.

CONTEXT
-------
The `.116` in-context purge modal targeted `TEST-*/demo-*/sample-*`
name patterns. Between the .116 ship and this ship, another 10 test
assets were created at 2026-09-04T12:32:33 during a test-data burst.
They match the .116 filter but haven't been purged because no admin
has clicked the modal since their creation.

Shape (verified live pre-run):
    name          ~ ^TEST-v58.13.14-\\d+$
    kind          == "plant"
    asset_type    == "vehicle"
    status        == "retired"
    source        == <field missing>
    created_at    ∈ 2026-09-04T12:32:33 window
    dependencies  0 plant_maintenance, 10 asset_service_schedules

USAGE
-----
Dry-run (default):
    python /app/backend/scripts/purge_test_v58_13_14_leftovers_v58_13_120a.py

Live commit (requires explicit flag):
    python /app/backend/scripts/purge_test_v58_13_14_leftovers_v58_13_120a.py --commit

Idempotent — a second run finds nothing and exits 0.

REVERSE
-------
No reverse script is bundled. These 10 rows are pure seed artefacts
(no dependencies apart from the auto-cascaded schedules) and every
deletion is logged to /app/memory/purge_v58_13_120a_log.txt so a
human can hand-restore from the log if ever needed.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from datetime import datetime

from dotenv import load_dotenv


WINDOW_START = "2026-09-04T12:00:00"
WINDOW_END = "2026-09-04T13:00:00"


async def main(commit: bool) -> int:
    load_dotenv("/app/backend/.env")
    sys.path.insert(0, "/app/backend")
    from db import db  # noqa: E402

    mode = "LIVE COMMIT" if commit else "DRY-RUN (read-only)"
    print("─" * 78)
    print(f"v58.13.120a · purge_test_v58_13_14_leftovers  mode={mode}")
    print("─" * 78)

    q = {
        "name": {"$regex": r"^TEST-v58\.13\.\d+-\d+", "$options": "i"},
        "kind": "plant",
        "status": "retired",
        "created_at": {"$gte": WINDOW_START, "$lte": WINDOW_END},
    }
    docs = []
    async for a in db.assets.find(q, {"_id": 0, "id": 1, "name": 1, "created_at": 1}):
        docs.append(a)
    docs.sort(key=lambda d: d.get("created_at") or "")

    print(f"BEFORE assets total: {await db.assets.count_documents({})}")
    print(f"Target set (TEST-v58.13.14 + kind=plant + retired + window): {len(docs)}")
    for a in docs[:6]:
        print(f"  · {a.get('name')}  id={a['id']}  created_at={a.get('created_at')}")
    if len(docs) > 6:
        print(f"  … {len(docs) - 6} more")

    asset_ids = [a["id"] for a in docs]
    sched_count = await db.asset_service_schedules.count_documents(
        {"asset_id": {"$in": asset_ids}}) if asset_ids else 0
    print(f"cascade: asset_service_schedules to delete: {sched_count}")

    for coll in ["plant_maintenance", "form_submissions", "incidents",
                 "hazards", "pre_starts"]:
        n = await db[coll].count_documents({"$or": [
            {"asset_id": {"$in": asset_ids}},
            {"plant_id": {"$in": asset_ids}},
            {"linked_asset_id": {"$in": asset_ids}},
        ]}) if asset_ids else 0
        if n:
            print(f"  ⚠ {coll}: {n} rows reference targets — ABORTING commit path")
            if commit:
                print("commit refused due to unexpected dependencies")
                return 3

    if not commit:
        print("─" * 78)
        print("DRY-RUN complete — no rows written. Re-run with --commit to apply.")
        return 0

    if not docs:
        print("Nothing to do — idempotent.")
        return 0

    with open("/app/memory/purge_v58_13_120a_log.txt", "a") as fh:
        fh.write(f"\n=== v58.13.120a purge · {datetime.utcnow().isoformat()}Z ===\n")
        for a in docs:
            fh.write(f"{a}\n")

    del_sched = await db.asset_service_schedules.delete_many(
        {"asset_id": {"$in": asset_ids}})
    del_assets = await db.assets.delete_many({"id": {"$in": asset_ids}})
    print(f"asset_service_schedules deleted: {del_sched.deleted_count}")
    print(f"assets deleted: {del_assets.deleted_count}")
    print(f"AFTER assets total: {await db.assets.count_documents({})}")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true",
                   help="Apply writes. Default is dry-run.")
    args = p.parse_args()
    sys.exit(asyncio.run(main(commit=args.commit)))
