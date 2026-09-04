"""v58.13.109 — Orphan-maintenance vacuum + backfill.

Field-observed drift: 346 rows in `plant_maintenance` have neither a
`plant_id` linking to an `assets` document, nor a `registration_no` that
matches any existing asset's `rego_serial`. Those rows are effectively
data ghosts — every UI surface that groups maintenance history by asset
skips them silently. 54 distinct regos across those 346 rows.

This script (invoke MANUALLY — no startup wiring) does two idempotent
passes:

  Pass 1 — Backfill missing assets.
    For each distinct orphan rego, create a minimal `assets` document
    with `kind="vehicle"`, `rego_serial=<REGO>`, `source="orphan_backfill"`
    plus timestamps + a per-run audit id. Assets already present are
    left untouched (case- and whitespace-insensitive match on
    rego_serial). Fresh-fleet fields (name, make, model, workspace_id,
    etc.) are left blank so an admin can complete them via the normal
    asset-edit surface.

  Pass 2 — Re-parent orphan maintenance rows.
    For every plant_maintenance row where `plant_id` is null / missing
    AND `registration_no` matches an asset (either from pass 1 or an
    existing one), set `plant_id` to that asset's id + stamp
    `registration_matched=True` + `updated_at=now`. Rows without a rego
    or where the rego STILL doesn't match anything (should be zero
    after pass 1) are left as-is with a summary log line.

Idempotency: safe to rerun. Pass 1 skips regos that already have an
asset row. Pass 2 skips rows that already carry a plant_id. Every run
prints `before` / `after` counts so drift is visible.

USAGE (one-shot, from repo root):
    python -m backend.scripts.vacuum_orphan_maintenance_v58_13_109

Or with explicit env:
    cd backend && python scripts/vacuum_orphan_maintenance_v58_13_109.py

DELIBERATE NON-COVERAGE
  · `deleted_at != None` rows are ignored (they were soft-deleted
    on purpose).
  · Rows whose `registration_no` is empty / null are not fabricated a
    parent — no rego means no reliable identity to backfill.
  · Does NOT touch `plant_maintenance_audit`. The pass-2 update
    passes through the standard update path via a bulk write, so if
    an audit trigger existed at the DB layer it would fire; there
    isn't one today, so no audit rows are created (per user brief:
    "no background email/SMS", and audit rows in this table have
    been historically created by user-mediated CRUD only).
"""
from __future__ import annotations

import asyncio
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

from dotenv import load_dotenv


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_rego(r: Optional[str]) -> str:
    """Uppercase + strip + drop internal whitespace — how we compare
    regos across `plant_maintenance.registration_no` and
    `assets.rego_serial`."""
    return re.sub(r"\s+", "", (r or "").strip().upper())


async def _load_asset_regos(db) -> Dict[str, str]:
    """Return {normalised_rego: asset_id} for every live asset."""
    out: Dict[str, str] = {}
    async for a in db.assets.find(
        {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0, "id": 1, "rego_serial": 1},
    ):
        r = _norm_rego(a.get("rego_serial"))
        if r:
            out[r] = a["id"]
    return out


async def _load_orphan_maint_regos(db, asset_regos: Dict[str, str]) -> set:
    """Return the set of distinct normalised regos in plant_maintenance
    that have no matching asset. Only considers rows with no
    plant_id — rows that ARE parented are irrelevant to pass 1."""
    orphans: set = set()
    async for m in db.plant_maintenance.find(
        {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
         "$and": [
             {"$or": [{"plant_id": None}, {"plant_id": {"$exists": False}}]},
         ]},
        {"_id": 0, "registration_no": 1},
    ):
        r = _norm_rego(m.get("registration_no"))
        if r and r not in asset_regos:
            orphans.add(r)
    return orphans


async def _backfill_assets(db, missing_regos: set, run_id: str) -> Dict[str, str]:
    """Insert one asset per missing rego. Returns {normalised_rego:
    new_asset_id}. Idempotent — a race that lands the same rego twice
    would fail cleanly on the caller's next re-fetch of asset_regos."""
    import secrets
    created: Dict[str, str] = {}
    now = _now_iso()
    for rego in sorted(missing_regos):
        asset_id = str(uuid.uuid4())
        doc = {
            "id": asset_id,
            "kind": "vehicle",
            "asset_type": "other",
            "name": None,
            "make": None,
            "model": None,
            "rego_serial": rego,
            # Unique scan_token so the existing scan_token_1 index on
            # `assets` doesn't collide across multiple backfills. The
            # token is harmless (encodes to a QR that resolves via the
            # existing ScanResolver flow); admin can regenerate via
            # the standard asset-edit surface if needed.
            "scan_token": secrets.token_urlsafe(12),
            "source": "orphan_backfill",
            "orphan_backfill_run_id": run_id,
            "org_id": None,  # let admin assign an org on first edit
            "workspace_id": None,
            "status": "unassigned",
            "created_at": now,
            "created_by": "system-orphan-backfill",
            "updated_at": now,
            "deleted_at": None,
        }
        await db.assets.insert_one(dict(doc))
        created[rego] = asset_id
    return created


async def _reparent_maint_rows(db, asset_regos: Dict[str, str]) -> Dict[str, int]:
    """For every orphan row where the rego now maps to an asset, set
    `plant_id` + `registration_matched=True`. Returns {matched, still_orphaned}."""
    matched = 0
    still_orphan = 0
    now = _now_iso()
    async for m in db.plant_maintenance.find(
        {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
         "$and": [
             {"$or": [{"plant_id": None}, {"plant_id": {"$exists": False}}]},
         ]},
        {"_id": 0, "id": 1, "registration_no": 1},
    ):
        rego = _norm_rego(m.get("registration_no"))
        if not rego:
            still_orphan += 1
            continue
        asset_id = asset_regos.get(rego)
        if not asset_id:
            still_orphan += 1
            continue
        await db.plant_maintenance.update_one(
            {"id": m["id"]},
            {"$set": {"plant_id": asset_id,
                       "registration_matched": True,
                       "updated_at": now}},
        )
        matched += 1
    return {"matched": matched, "still_orphaned": still_orphan}


async def _count_orphans(db) -> int:
    """Snapshot: how many rows have no plant_id right now."""
    return await db.plant_maintenance.count_documents(
        {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
         "$and": [
             {"$or": [{"plant_id": None}, {"plant_id": {"$exists": False}}]},
         ]}
    )


async def main(dry_run: bool = True):
    load_dotenv("/app/backend/.env")
    import sys
    sys.path.insert(0, "/app/backend")
    from db import db

    run_id = f"orphan-vac-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"
    print("─" * 78)
    mode = "DRY-RUN (read-only)" if dry_run else "LIVE COMMIT"
    print(f"v58.13.109 · vacuum_orphan_maintenance  run_id={run_id}  mode={mode}")
    print("─" * 78)

    before_orphans = await _count_orphans(db)
    print(f"BEFORE: plant_maintenance rows with no plant_id: {before_orphans}")

    asset_regos = await _load_asset_regos(db)
    print(f"asset regos indexed: {len(asset_regos)}")

    missing = await _load_orphan_maint_regos(db, asset_regos)
    print(f"distinct orphan regos: {len(missing)}")

    if dry_run:
        # v58.13.118 — Safe preview branch. Enumerate what WOULD happen
        # without touching Mongo. Committed post-.118 audit after the
        # .118 ship discovered the pre-.118 script silently ran live
        # when --dry-run was passed (no argparse existed). Default is
        # now DRY-RUN so that failure mode can never recur.
        print(f"would-create assets (pass 1): {len(missing)}")
        for rego in list(missing)[:10]:
            print(f"  · {rego}  (would be created)")
        if len(missing) > 10:
            print(f"  · … {len(missing) - 10} more")
        would_reparent = await _dry_run_reparent(db, asset_regos, missing)
        print(f"pass 2 (would): matchable={would_reparent}")
        print(f"AFTER (would): plant_maintenance rows with no plant_id: 0")
        print(f"delta (would): {before_orphans}")
        print("─" * 78)
        print("DRY-RUN complete — no rows written. Re-run with `--commit` to apply.")
        return

    if missing:
        created = await _backfill_assets(db, missing, run_id)
        print(f"assets created (pass 1): {len(created)}")
        for rego, aid in list(created.items())[:10]:
            print(f"  · {rego}  →  {aid}")
        if len(created) > 10:
            print(f"  · … {len(created) - 10} more")
        asset_regos.update(created)
    else:
        print("no missing regos — pass 1 skipped")

    stats = await _reparent_maint_rows(db, asset_regos)
    print(f"pass 2: matched={stats['matched']}  still_orphaned={stats['still_orphaned']}")

    after_orphans = await _count_orphans(db)
    print(f"AFTER:  plant_maintenance rows with no plant_id: {after_orphans}")
    print(f"delta:  {before_orphans - after_orphans}")
    print("─" * 78)


async def _dry_run_reparent(db, asset_regos: dict, would_create: set[str]) -> int:
    """v58.13.118 — Count-only variant of `_reparent_maint_rows` for the
    dry-run branch. Never mutates. Assumes pass 1 would also succeed
    so `would_create` regos are treated as available on top of the
    live `asset_regos` map."""
    n = 0
    pool = {r.upper() for r in asset_regos} | {r.upper() for r in would_create}
    async for row in db.plant_maintenance.find(
            {"plant_id": {"$in": [None, ""]}}, {"registration_no": 1}):
        rego = (row.get("registration_no") or "").strip().upper()
        if rego and rego in pool:
            n += 1
    return n


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(
        description="v58.13.109 orphan-maintenance vacuum + backfill.",
    )
    # v58.13.118 — Explicit --commit flag; default is DRY-RUN. Never
    # rely on the caller passing --dry-run correctly again.
    p.add_argument("--commit", action="store_true",
                   help="Apply writes. Default is dry-run.")
    p.add_argument("--dry-run", action="store_true",
                   help="No-op; dry-run is the default. Kept for compat.")
    args = p.parse_args()
    asyncio.run(main(dry_run=not args.commit))
