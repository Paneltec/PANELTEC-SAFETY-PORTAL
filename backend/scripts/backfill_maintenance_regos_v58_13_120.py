"""v58.13.120a — Backfill 54 missing plant_maintenance regos into `assets`.

PLAN
----
For every distinct rego on `plant_maintenance` that has no matching
row in `assets` (Section E of the .120 audit), create an `assets`
row and re-link the maintenance rows.

Deduce `kind` from the most-recent maintenance row's `sub_type` per
the user-approved map:

    Trailer                              → kind="trailer"
    Vac Truck / Commercial / Passenger   → kind="vehicle"
    Excavator / Telehandler / Directional
      Drill / Road Roller / TMA          → kind="plant"
    <missing>                            → kind="vehicle"

Backfilled asset carries:

    id                = uuid4()
    rego_serial       = <rego, uppercased>
    kind              = <deduced>
    asset_type        = <sub_type from pm row>
    manufacturer      = pm.manufacturer   (if present)
    description       = pm.description[:200] + " (auto from maintenance)"
    source            = "maintenance_backfill_v58_13_120"
    backfill_run_id   = "v58_13_120a-<utc-ts>"
    status            = "active"
    org_id            = pm.org_id  (falls back to DEFAULT_ORG_ID)
    workspace_id      = null (admin edits later)
    scan_token        = secrets.token_urlsafe(12)
    created_at / updated_at = now
    deleted_at        = null

After insert, re-link every `plant_maintenance` row whose
`registration_no` normalises to the new asset's rego:

    plant_maintenance.plant_id             = <new asset id>
    plant_maintenance.registration_matched = true
    plant_maintenance.backfill_relink_v58_13_120 = true
    plant_maintenance.backfill_relink_v58_13_120_at = <iso>

USAGE
-----
Dry-run (default) — no writes:
    python /app/backend/scripts/backfill_maintenance_regos_v58_13_120.py

Live commit:
    python /app/backend/scripts/backfill_maintenance_regos_v58_13_120.py --commit

Reverse (rollback the last committed run):
    python /app/backend/scripts/backfill_maintenance_regos_v58_13_120.py --rollback

Idempotent: forward + rollback + forward + rollback all safe.

DEFAULT_ORG_ID
--------------
Per user directive Q3 (2026-09-04): null-org_id maintenance rows
default the backfilled asset's org_id to the "Paneltec" org — the
single active org in the current DB. Falls back to reading the
first-non-null org_id from any pm row so the script survives an
org rename.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import secrets
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv


BACKFILL_SOURCE = "maintenance_backfill_v58_13_120"

# Q1 (Commercial→vehicle) + Q2 (Passenger→vehicle) + user-approved
# mapping table.
SUB_TYPE_TO_KIND = {
    "trailer": "trailer",
    "vac truck": "vehicle",
    "commercial": "vehicle",
    "passenger": "vehicle",
    "excavator": "plant",
    "telehandler": "plant",
    "directional drill": "plant",
    "road roller": "plant",
    "tma": "plant",
}

DEFAULT_KIND = "vehicle"


def _normalise_rego(r: str | None) -> str | None:
    if not r:
        return None
    r = str(r).strip().upper()
    return r or None


def _kind_for(sub_type: str | None) -> str:
    key = (sub_type or "").strip().lower()
    return SUB_TYPE_TO_KIND.get(key, DEFAULT_KIND)


async def _resolve_default_org_id(db) -> str | None:
    """Pick the org_id that null-org pm rows fall back to. Prefer
    the org named "Paneltec" (case-insensitive); if not found,
    the first-non-null org_id on any pm row; else None."""
    o = await db.orgs.find_one({"name": {"$regex": "paneltec", "$options": "i"}},
                               {"_id": 0, "id": 1, "name": 1})
    if o:
        print(f"  default org_id resolved to: {o['id']}  ({o.get('name')})")
        return o["id"]
    async for m in db.plant_maintenance.find({"org_id": {"$nin": [None, ""]}},
                                              {"_id": 0, "org_id": 1}).limit(1):
        print(f"  default org_id resolved to first pm.org_id: {m['org_id']}")
        return m["org_id"]
    print("  default org_id: unresolved (backfilled assets will have org_id=null)")
    return None


async def _load_backfill_targets(db):
    """Return a list of dicts, one per distinct rego on
    plant_maintenance that has NO matching assets row.

    Each dict carries the newest-pm row for that rego so kind can
    be deduced from sub_type."""
    # 1. Every distinct rego on pm
    pm_regos: dict[str, dict] = {}   # rego → pm row (newest)
    async for m in db.plant_maintenance.find(
        {"registration_no": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "registration_no": 1, "sub_type": 1,
         "manufacturer": 1, "description": 1, "date_completed": 1,
         "org_id": 1, "workspace_id": 1},
    ):
        rego = _normalise_rego(m.get("registration_no"))
        if not rego:
            continue
        existing = pm_regos.get(rego)
        this_date = m.get("date_completed") or ""
        if not existing or this_date > (existing.get("date_completed") or ""):
            pm_regos[rego] = m

    # 2. Every rego in assets (normalised)
    asset_regos: set[str] = set()
    async for a in db.assets.find({"rego_serial": {"$nin": [None, ""]}},
                                   {"_id": 0, "rego_serial": 1}):
        r = _normalise_rego(a.get("rego_serial"))
        if r:
            asset_regos.add(r)

    # 3. Set diff
    missing = sorted(set(pm_regos.keys()) - asset_regos)
    return [pm_regos[r] for r in missing]


async def forward(db, commit: bool) -> int:
    now_iso = datetime.now(timezone.utc).isoformat()
    run_id = "v58_13_120a-" + now_iso.replace("+00:00", "Z").replace(":", "").replace("-", "")

    mode = "LIVE COMMIT" if commit else "DRY-RUN (read-only)"
    print("─" * 78)
    print(f"v58.13.120a · backfill_maintenance_regos  mode={mode}")
    print("─" * 78)
    default_org_id = await _resolve_default_org_id(db)

    targets = await _load_backfill_targets(db)
    print(f"\nBackfill targets: {len(targets)} distinct regos")

    kind_breakdown: dict[str, int] = {}
    proposals = []
    for pm in targets:
        rego = _normalise_rego(pm.get("registration_no"))
        kind = _kind_for(pm.get("sub_type"))
        kind_breakdown[kind] = kind_breakdown.get(kind, 0) + 1
        desc = pm.get("description") or ""
        proposals.append({
            "rego_serial": rego,
            "kind": kind,
            "asset_type": pm.get("sub_type"),
            "manufacturer": pm.get("manufacturer"),
            "description": (desc[:200] + " (auto from maintenance)") if desc else "(auto from maintenance)",
            "org_id": pm.get("org_id") or default_org_id,
            "workspace_id": None,
        })

    print("\nkind breakdown:")
    for k, n in sorted(kind_breakdown.items()):
        print(f"  {k:10s} = {n}")

    # Estimate re-link count
    rego_set = [p["rego_serial"] for p in proposals]
    # Use regex OR ^rego$ list. Straight $in on registration_no
    # after upper-normalisation would miss mixed-case rows, so we
    # count with a regex per rego for accuracy.
    if rego_set:
        or_terms = [{"registration_no": {"$regex": f"^{rego}$", "$options": "i"}}
                    for rego in rego_set]
        relink_estimate = await db.plant_maintenance.count_documents(
            {"$and": [{"plant_id": {"$in": [None]}},
                      {"$or": or_terms}]})
    else:
        relink_estimate = 0
    print(f"\nEstimated plant_maintenance rows to re-link: {relink_estimate}")

    print("\nSample proposals (first 6):")
    for p in proposals[:6]:
        print(f"  · rego={p['rego_serial']:8s}  kind={p['kind']:8s}  "
              f"asset_type={p['asset_type']}  org_id={p['org_id']}")
    if len(proposals) > 6:
        print(f"  … {len(proposals) - 6} more")

    if not commit:
        print("\n" + "─" * 78)
        print("DRY-RUN complete — no rows written. Re-run with --commit to apply.")
        return 0

    if not proposals:
        print("Nothing to do — idempotent.")
        return 0

    # Insert new assets
    now = datetime.now(timezone.utc).isoformat()
    to_insert = []
    for p in proposals:
        to_insert.append({
            "id": str(uuid.uuid4()),
            "rego_serial": p["rego_serial"],
            "kind": p["kind"],
            "asset_type": p["asset_type"],
            "manufacturer": p["manufacturer"],
            "description": p["description"],
            "source": BACKFILL_SOURCE,
            "backfill_run_id": run_id,
            "status": "active",
            "org_id": p["org_id"],
            "workspace_id": p["workspace_id"],
            "scan_token": secrets.token_urlsafe(12),
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
        })
    ins = await db.assets.insert_many(to_insert)
    print(f"inserted assets: {len(ins.inserted_ids)}  run_id={run_id}")

    # Re-link plant_maintenance
    relinked = 0
    for a in to_insert:
        r = await db.plant_maintenance.update_many(
            {"plant_id": {"$in": [None]},
             "registration_no": {"$regex": f"^{a['rego_serial']}$", "$options": "i"}},
            {"$set": {"plant_id": a["id"],
                       "registration_matched": True,
                       "backfill_relink_v58_13_120": True,
                       "backfill_relink_v58_13_120_at": now,
                       "backfill_relink_run_id": run_id}},
        )
        relinked += r.modified_count
    print(f"plant_maintenance rows re-linked: {relinked}")
    print(f"AFTER assets total: {await db.assets.count_documents({})}")
    print(f"AFTER pm.plant_id != null: {await db.plant_maintenance.count_documents({'plant_id': {'$ne': None}})}")
    return 0


async def rollback(db) -> int:
    """Reverse-migration. Deletes every backfilled asset for the
    most-recent run (or all runs if there's only one) and nulls
    the re-link stamps on the affected plant_maintenance rows."""
    print("─" * 78)
    print("v58.13.120a · backfill rollback")
    print("─" * 78)
    # Enumerate all backfill runs
    run_ids = sorted(set(await db.assets.distinct(
        "backfill_run_id", {"source": BACKFILL_SOURCE})))
    print(f"backfill runs found: {len(run_ids)}")
    for rid in run_ids:
        n = await db.assets.count_documents({"source": BACKFILL_SOURCE,
                                              "backfill_run_id": rid})
        print(f"  · {rid} → {n} asset(s)")
    if not run_ids:
        print("Nothing to roll back — idempotent.")
        return 0

    # Null re-links first
    r = await db.plant_maintenance.update_many(
        {"backfill_relink_run_id": {"$in": run_ids}},
        {"$set": {"plant_id": None,
                   "registration_matched": None,
                   "backfill_relink_v58_13_118_reverted": True,
                   "backfill_relink_v58_13_118_reverted_at":
                     datetime.now(timezone.utc).isoformat()}},
    )
    print(f"plant_maintenance rows unlinked: matched={r.matched_count} modified={r.modified_count}")
    # Delete backfilled assets
    d = await db.assets.delete_many({"source": BACKFILL_SOURCE,
                                       "backfill_run_id": {"$in": run_ids}})
    print(f"assets deleted: {d.deleted_count}")
    print(f"AFTER assets total: {await db.assets.count_documents({})}")
    return 0


async def main(commit: bool, do_rollback: bool) -> int:
    load_dotenv("/app/backend/.env")
    sys.path.insert(0, "/app/backend")
    from db import db  # noqa: E402
    if do_rollback:
        return await rollback(db)
    return await forward(db, commit=commit)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true",
                   help="Apply writes. Default is dry-run.")
    p.add_argument("--rollback", action="store_true",
                   help="Reverse the most-recent backfill. Ignores --commit.")
    args = p.parse_args()
    sys.exit(asyncio.run(main(commit=args.commit, do_rollback=args.rollback)))
