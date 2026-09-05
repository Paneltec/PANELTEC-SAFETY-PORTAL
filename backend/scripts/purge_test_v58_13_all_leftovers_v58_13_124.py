"""v58.13.124 — Purge TEST-v58.13.* seed rows from `assets`.

## Context
The `.116`, `.120a` and `.120g` ships all took swings at the
long-lived `TEST-v58.13.14-*` / `TEST-v58.13.16-*` seed rows that
keep re-entering the DB. This script consolidates the purge into a
single audit-marked, idempotent pass covering the 90 remaining rows
identified in the `.124` dry-run:

    filter    : kind='plant' AND name ~ /^TEST-v58\\.13\\.\\d+-/i
    dependencies : 0 plant_maintenance, 0 forms, 0 inductions,
                   0 incidents, 0 hazards, 0 pre_starts
    cascade   : asset_service_schedules (deleted with the parent)

Post-purge the fleet register kind totals collapse to:
    vehicle=98, plant=12, trailer=20   (was 98/102/20)

## Usage
    Dry-run (default):
        python /app/backend/scripts/purge_test_v58_13_all_leftovers_v58_13_124.py
    Live commit:
        python /app/backend/scripts/purge_test_v58_13_all_leftovers_v58_13_124.py --commit

## Idempotency + rollback
- A second run finds nothing and exits 0.
- Every deleted row is appended (JSON one-per-line) to
  `/app/memory/purge_v58_13_124_log.txt` with the full document
  body. Hand-restore is a `mongoimport` of the log lines.
- The `.120a` log format is preserved for continuity.

## Safety refusal
- Aborts before any writes if ANY of these collections carry a
  reference to the target set:
      plant_maintenance, form_submissions, incidents, hazards,
      pre_starts, forms.
  (The `.124` dry-run confirmed all zero. This guard survives to
  catch future drift.)
"""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime

from dotenv import load_dotenv


LOG_PATH = "/app/memory/purge_v58_13_124_log.txt"


async def main(commit: bool) -> int:
    load_dotenv("/app/backend/.env")
    sys.path.insert(0, "/app/backend")
    from db import db  # noqa: E402

    mode = "LIVE COMMIT" if commit else "DRY-RUN (read-only)"
    print("─" * 78)
    print(f"v58.13.124 · purge_test_v58_13_all_leftovers  mode={mode}")
    print("─" * 78)

    q = {
        "name": {"$regex": r"^TEST-v58\.13\.\d+-\d+", "$options": "i"},
        "kind": "plant",
    }
    docs: list[dict] = []
    async for a in db.assets.find(q):
        docs.append(a)
    docs.sort(key=lambda d: d.get("created_at") or "")

    print(f"BEFORE assets total: {await db.assets.count_documents({})}")
    print(f"Target set (TEST-v58.13.* + kind=plant): {len(docs)}")
    for a in docs[:6]:
        print(f"  · {a.get('name')}  id={a.get('id')}  created_at={a.get('created_at')}")
    if len(docs) > 6:
        print(f"  … {len(docs) - 6} more")

    if not docs:
        print("Nothing to do — idempotent.")
        return 0

    asset_ids = [a["id"] for a in docs]

    # Cascade preview.
    sched_count = await db.asset_service_schedules.count_documents(
        {"asset_id": {"$in": asset_ids}}) if asset_ids else 0
    print(f"cascade: asset_service_schedules to delete: {sched_count}")

    # Refusal-guard for surprise dependencies.
    for coll in ["plant_maintenance", "form_submissions", "incidents",
                 "hazards", "pre_starts", "forms"]:
        try:
            n = await db[coll].count_documents({"$or": [
                {"asset_id": {"$in": asset_ids}},
                {"plant_id": {"$in": asset_ids}},
                {"linked_asset_id": {"$in": asset_ids}},
            ]})
        except Exception:  # pragma: no cover
            n = 0
        if n:
            print(f"  ⚠ {coll}: {n} rows reference targets — ABORTING commit path")
            if commit:
                print("commit refused due to unexpected dependencies")
                return 3

    if not commit:
        print("─" * 78)
        print("DRY-RUN complete — no rows written. Re-run with --commit to apply.")
        return 0

    # Append audit log — full documents so hand-restore is possible.
    with open(LOG_PATH, "a") as fh:
        fh.write(f"\n=== v58.13.124 purge · {datetime.utcnow().isoformat()}Z ===\n")
        for a in docs:
            a.pop("_id", None)  # ObjectId isn't JSON-serialisable
            fh.write(json.dumps(a, default=str) + "\n")

    del_sched = await db.asset_service_schedules.delete_many(
        {"asset_id": {"$in": asset_ids}})
    del_assets = await db.assets.delete_many({"id": {"$in": asset_ids}})
    print(f"asset_service_schedules deleted: {del_sched.deleted_count}")
    print(f"assets deleted: {del_assets.deleted_count}")
    print(f"AFTER assets total: {await db.assets.count_documents({})}")
    print(f"audit log: {LOG_PATH}")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true",
                   help="Apply writes. Default is dry-run.")
    args = p.parse_args()
    sys.exit(asyncio.run(main(commit=args.commit)))
