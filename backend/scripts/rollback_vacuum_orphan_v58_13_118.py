"""v58.13.118 — Rollback for the accidental v58.13.109 vacuum runs.

CONTEXT
-------
`vacuum_orphan_maintenance_v58_13_109.py` shipped without an argparse
`--dry-run` guard. Between its ship and the v58.13.118 argparse fix it
was invoked LIVE three times against `test_database`:

    orphan-vac-20260904T115850
    orphan-vac-20260904T120333
    orphan-vac-20260904T120340

Result on the live DB (measured pre-rollback):
    · assets  with source=orphan_backfill                 → 60
    · plant_maintenance rows re-parented onto those      → 346
    · plant_maintenance total                             → 837
    · registration_matched=True stamped by pass 2         → 346

The user's mental model of the pre-.109 state:
    · 837 maintenance rows total
    · 491 rows already parented to a real asset  (untouched by vacuum)
    · 346 rows unparented                        (re-parented by vacuum)
    · 54 distinct regos across those 346 rows    (the "54 assets"
      user quoted — this is the DISTINCT-REGO count, not the row count
      of assets actually created. The three accidental runs each
      created a fresh asset per rego because the "already exists"
      guard keys off `rego_serial` — and the second/third run only
      inserted a NEW asset for regos where the prior run's asset had
      *already* been re-parented to some row, i.e. it saw drift.)

This rollback undoes both passes:
    Pass A: null out `plant_id` + `registration_matched` on every
            plant_maintenance row that currently points at an
            `assets` row with `source="orphan_backfill"`.
    Pass B: hard-delete every `assets` row with
            `source="orphan_backfill"`.

USER-REQUESTED PROCESS GUARD
----------------------------
Per the user's ship directive:
  1. Enumerate the target set (asset ids + maintenance ids) BEFORE
     deletion and print the counts + a sample.
  2. Execute the delete + null-out IN THE SAME script run.
  3. Print BEFORE and AFTER counts so drift is visible in the log.

USAGE
-----
    python /app/backend/scripts/rollback_vacuum_orphan_v58_13_118.py

Idempotent — a second run finds 0 backfill assets and 0 linked
maintenance rows, prints zeros, exits 0.

BELT-AND-BRACES
---------------
The user additionally asked for a created_at time-window filter as
a secondary safety guard. Every backfill asset carries `created_at`
in the ISO range 2026-09-04T11:58:50…12:03:40. The script asserts
that every asset it's about to delete falls in the window
2026-09-04T11:00:00 → 2026-09-04T13:00:00 UTC and aborts loudly if
any row falls outside — a defence against a future backfill run
that reuses `source="orphan_backfill"` on a different date.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime

from dotenv import load_dotenv


# v58.13.118 — Time window sanity check for the specific accidental
# vacuum runs on 2026-09-04. If a future vacuum re-runs on a
# different date, this window will trip and the operator can rewrite
# it deliberately.
WINDOW_START = "2026-09-04T11:00:00"
WINDOW_END = "2026-09-04T13:00:00"


async def _load_backfill_asset_ids(db) -> list[dict]:
    """Return the full list of `source=orphan_backfill` asset docs
    (id + rego_serial + created_at + run_id). Sorted by created_at
    so the log output is stable across reruns."""
    docs = []
    async for a in db.assets.find(
        {"source": "orphan_backfill"},
        {"_id": 0, "id": 1, "rego_serial": 1, "created_at": 1,
         "orphan_backfill_run_id": 1},
    ):
        docs.append(a)
    docs.sort(key=lambda d: (d.get("created_at") or "", d.get("id") or ""))
    return docs


async def _load_linked_maint_ids(db, asset_ids: list[str]) -> list[dict]:
    """Return every plant_maintenance row currently pointing at a
    backfill asset (id + maintenance_id + registration_no + plant_id).
    Sorted by maintenance_id."""
    if not asset_ids:
        return []
    rows = []
    async for m in db.plant_maintenance.find(
        {"plant_id": {"$in": asset_ids}},
        {"_id": 0, "id": 1, "maintenance_id": 1, "registration_no": 1,
         "plant_id": 1},
    ):
        rows.append(m)
    rows.sort(key=lambda d: str(d.get("maintenance_id") or ""))
    return rows


async def _snapshot_counts(db) -> dict:
    """Full count matrix for the log. Cheap — five count_documents
    calls, no scans."""
    return {
        "assets_backfill": await db.assets.count_documents({"source": "orphan_backfill"}),
        "pm_total": await db.plant_maintenance.count_documents({}),
        "pm_with_plant_id": await db.plant_maintenance.count_documents(
            {"plant_id": {"$ne": None, "$exists": True}}),
        "pm_registration_matched_true": await db.plant_maintenance.count_documents(
            {"registration_matched": True}),
    }


def _in_window(created_at: str) -> bool:
    """True when `created_at` (ISO string) falls in
    WINDOW_START..WINDOW_END inclusive. Empty / missing → False so
    the caller aborts on unknown timestamps."""
    if not created_at:
        return False
    return WINDOW_START <= created_at <= WINDOW_END


async def main() -> int:
    load_dotenv("/app/backend/.env")
    sys.path.insert(0, "/app/backend")
    from db import db  # noqa: E402

    print("─" * 78)
    print(f"v58.13.118 · rollback_vacuum_orphan  started={datetime.utcnow().isoformat()}Z")
    print("─" * 78)

    before = await _snapshot_counts(db)
    print("BEFORE:")
    for k, v in before.items():
        print(f"  {k:32s} = {v}")

    print("─" * 78)
    print("STEP 1 · ENUMERATE (no writes)")
    print("─" * 78)

    assets = await _load_backfill_asset_ids(db)
    print(f"backfill assets (source='orphan_backfill'): {len(assets)}")

    run_ids: dict[str, int] = {}
    for a in assets:
        rid = a.get("orphan_backfill_run_id") or "(no run_id)"
        run_ids[rid] = run_ids.get(rid, 0) + 1
    for rid, n in sorted(run_ids.items()):
        print(f"  · run_id {rid} → {n} asset(s)")

    if assets:
        print("  sample first 3:")
        for a in assets[:3]:
            print(f"    - {a.get('rego_serial')}  id={a['id']}  created_at={a.get('created_at')}")
        if len(assets) > 3:
            print(f"  … {len(assets) - 3} more")

    # Belt-and-braces time-window guard.
    out_of_window = [a for a in assets if not _in_window(a.get("created_at") or "")]
    if out_of_window:
        print("─" * 78)
        print(f"ABORT · {len(out_of_window)} asset(s) fall OUTSIDE the safety window "
              f"{WINDOW_START} .. {WINDOW_END}:")
        for a in out_of_window[:10]:
            print(f"  · {a.get('rego_serial')}  id={a['id']}  created_at={a.get('created_at')}")
        print("Rewrite WINDOW_START/END in this script deliberately before rerunning.")
        return 2

    asset_ids = [a["id"] for a in assets]
    maint_rows = await _load_linked_maint_ids(db, asset_ids)
    print(f"plant_maintenance rows linked to those assets: {len(maint_rows)}")
    if maint_rows:
        print("  sample first 3:")
        for m in maint_rows[:3]:
            print(f"    - maintenance_id={m.get('maintenance_id')}  "
                  f"rego={m.get('registration_no')}  plant_id={m.get('plant_id')}")
        if len(maint_rows) > 3:
            print(f"  … {len(maint_rows) - 3} more")

    if not assets and not maint_rows:
        print("─" * 78)
        print("Nothing to do — rollback is idempotent. Exiting cleanly.")
        return 0

    print("─" * 78)
    print("STEP 2 · EXECUTE (writes)")
    print("─" * 78)

    # Pass A — null out plant_id + registration_matched on affected
    # plant_maintenance rows. We deliberately DO NOT touch
    # `updated_at` — the field was stamped by the accidental run;
    # leaving it stamped preserves the audit trail so a later grep
    # for "when was this row last altered" still surfaces the vacuum
    # touch. Rollback intent is captured in the log below + the
    # v58.13.118 file marker.
    maint_result = await db.plant_maintenance.update_many(
        {"plant_id": {"$in": asset_ids}},
        {"$set": {"plant_id": None, "registration_matched": None,
                   "rollback_v58_13_118": True,
                   "rollback_v58_13_118_at": datetime.utcnow().isoformat() + "Z"}},
    )
    print(f"  pass A · plant_maintenance nulled: matched={maint_result.matched_count} "
          f"modified={maint_result.modified_count}")

    # Pass B — hard-delete the phantom assets. delete_many is safe
    # because we've already enumerated exactly what matches.
    del_result = await db.assets.delete_many({"source": "orphan_backfill"})
    print(f"  pass B · assets deleted: {del_result.deleted_count}")

    print("─" * 78)
    after = await _snapshot_counts(db)
    print("AFTER:")
    for k, v in after.items():
        delta = v - before[k]
        sign = "+" if delta > 0 else ""
        print(f"  {k:32s} = {v}   (delta {sign}{delta})")

    print("─" * 78)
    print(f"rollback_vacuum_orphan finished={datetime.utcnow().isoformat()}Z")
    print("─" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
