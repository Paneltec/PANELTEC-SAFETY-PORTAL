"""v58.13.132ch — Soft-delete Vacuum Truck phantom rows.

Six phantom `assets` rows have been polluting the Vacuum Truck bucket
on the Fleet & Service Register: 5 backfill orphans + 1 legacy
`(none rego) "Other"` placeholder. Stephen picked Option (a) —
soft-delete with a full audit trail so any row can be revived later
via `deleted_at = null`.

Convention: `.132bd` idempotent migration. Dry-run default + `--commit`.
Breadcrumbs `_phantom_deleted_at` + `deleted_by='v58_13_132ch_phantom_cleanup'`
+ `deleted_reason=<one-liner>` land on every touched row.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND_DIR / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


NOW = datetime.now(timezone.utc).isoformat()
DELETED_BY = "v58_13_132ch_phantom_cleanup"
DELETED_REASON = (
    "phantom row from maintenance_backfill_v58_13_120 / duplicate / "
    "placeholder — see .132ch memo"
)

# Paneltec org — the only org affected. Scoped so a wildcard re-run
# never wipes another tenant's data even if regos collide.
PANELTEC_ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"

# The 6 phantoms — matched by `(rego_serial, name)` OR (for the
# duplicate rego row) by `(rego_serial, source)` to disambiguate from
# the Navixy-linked master row that must stay.
PHANTOMS = [
    {"label": "row-2  E77VP  Ditch Witch FX60 (backfill)",
     "match": {"rego_serial": "E77VP",
               "name": "Ditch Witch FX60 Vacuum Truck",
               "source": "maintenance_backfill_v58_13_120"}},
    {"label": "row-4  FM7193 Isuzu Ditch Witch FX30 (backfill)",
     "match": {"rego_serial": "FM7193",
               "name": "Isuzu - Ditch Witch FX30 Vacuum Truck",
               "source": "maintenance_backfill_v58_13_120"}},
    {"label": "row-6  WV1503 IZUSU Street Sweeper (mislabel)",
     "match": {"rego_serial": "WV1503",
               "name": "IZUSU Street Sweeper",
               "source": "maintenance_backfill_v58_13_120"}},
    {"label": "row-9  XT16AB Cappellotto being sold",
     "match": {"rego_serial": "XT16AB",
               "name": {"$regex": "^BEING SOLD"}}},
    {"label": "row-14 XT44DL Scania Kor 3200 duplicate (Navixy-linked row stays)",
     "match": {"rego_serial": "XT44DL",
               "name": "Scania Kor 3200",
               "source": "maintenance_backfill_v58_13_120"}},
    {"label": "row-18 (no rego) 'Other' placeholder",
     "match": {"rego_serial": None,
               "name": "Other",
               "status": "retired",
               "asset_type": "vacuum_truck"}},
]


async def run(commit: bool) -> int:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        db = client[os.environ["DB_NAME"]]

        # Snapshot before.
        before_total = await db.assets.count_documents({
            "org_id": PANELTEC_ORG_ID, "deleted_at": None,
            "asset_type": {"$regex":
                "^(vacuum_truck|vacuum truck|vac_truck|vac truck|VACUUM TRUCK|Vacuum truck)$",
                "$options": "i"},
        })
        print(f"[.132ch] BEFORE: {before_total} active vacuum-truck rows for Paneltec.")

        matched_ids: list[str] = []
        for p in PHANTOMS:
            q = {"org_id": PANELTEC_ORG_ID, **p["match"]}
            rows = await db.assets.find(q, {"_id": 0, "id": 1, "deleted_at": 1}).to_list(5)
            if not rows:
                print(f"  · {p['label']:70} → NO MATCH")
                continue
            for r in rows:
                already = bool(r.get("deleted_at"))
                marker = "already-soft-deleted" if already else "targeted"
                print(f"  · {p['label']:70} → id={r['id'][:8]} {marker}")
                matched_ids.append(r["id"])

        if not commit:
            print(f"\n[.132ch] DRY-RUN. {len(matched_ids)} rows would be affected. "
                  f"Re-run with --commit to apply.")
            return 0

        # Idempotent update — never overwrite an existing deleted_at.
        result = await db.assets.update_many(
            {"org_id": PANELTEC_ORG_ID, "id": {"$in": matched_ids},
             "deleted_at": None},
            {"$set": {
                "deleted_at": NOW,
                "deleted_by": DELETED_BY,
                "deleted_reason": DELETED_REASON,
                "_phantom_deleted_at": NOW,
            }},
        )
        after_total = await db.assets.count_documents({
            "org_id": PANELTEC_ORG_ID, "deleted_at": None,
            "asset_type": {"$regex":
                "^(vacuum_truck|vacuum truck|vac_truck|vac truck|VACUUM TRUCK|Vacuum truck)$",
                "$options": "i"},
        })

        print(f"\n[.132ch] COMMIT complete.")
        print(f"  · rows targeted        : {len(matched_ids)}")
        print(f"  · rows soft-deleted    : {result.modified_count}")
        print(f"  · ids                  : {[i[:8] for i in matched_ids]}")
        print(f"\n[.132ch] AFTER: {after_total} active vacuum-truck rows for Paneltec.")
        return 0
    finally:
        client.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    return asyncio.run(run(commit=args.commit and not args.dry_run))


if __name__ == "__main__":
    sys.exit(main())
