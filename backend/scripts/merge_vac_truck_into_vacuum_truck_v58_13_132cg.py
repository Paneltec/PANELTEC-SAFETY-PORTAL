"""v58.13.132cg — Merge legacy `vac_truck` asset_type into `Vacuum Truck`.

Rewrites `assets.asset_type` from `vac_truck` (slugged legacy import
label) to `Vacuum Truck` (canonical Title-Case). Matches the .132bd
convention: dry-run default + `--commit`, idempotent, provenance
breadcrumb `_asset_type_normalised_at`.

── Usage ──────────────────────────────────────────────────────────
  python3 backend/scripts/merge_vac_truck_into_vacuum_truck_v58_13_132cg.py            # dry-run
  python3 backend/scripts/merge_vac_truck_into_vacuum_truck_v58_13_132cg.py --commit   # apply
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
FROM_VALUE = "vac_truck"
TO_VALUE = "Vacuum Truck"


async def run(commit: bool) -> int:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    try:
        db = client[os.environ["DB_NAME"]]

        before_vac_truck = await db.assets.count_documents({"asset_type": FROM_VALUE})
        before_vacuum = await db.assets.count_documents({"asset_type": TO_VALUE})
        before_vacuum_ci = await db.assets.count_documents({
            "asset_type": {"$regex": f"^{TO_VALUE}$", "$options": "i"},
        })
        print(f"[.132cg] BEFORE:")
        print(f"  · assets.asset_type='{FROM_VALUE}'          : {before_vac_truck}")
        print(f"  · assets.asset_type='{TO_VALUE}' (exact)     : {before_vacuum}")
        print(f"  · assets.asset_type ~ /^Vacuum Truck$/i      : {before_vacuum_ci}")
        print(f"  · projected canonical bucket (all variants)  : {before_vacuum_ci + before_vac_truck}")

        if not commit:
            print(f"\n[.132cg] DRY-RUN. Re-run with --commit to apply.")
            return 0

        result = await db.assets.update_many(
            {"asset_type": FROM_VALUE},
            {
                "$set": {
                    "asset_type": TO_VALUE,
                    "_asset_type_normalised_at": NOW,
                    "_asset_type_normalised_from": FROM_VALUE,
                },
            },
        )

        after_vac_truck = await db.assets.count_documents({"asset_type": FROM_VALUE})
        after_vacuum_ci = await db.assets.count_documents({
            "asset_type": {"$regex": f"^{TO_VALUE}$", "$options": "i"},
        })
        print(f"\n[.132cg] COMMIT complete.")
        print(f"  · matched         : {result.matched_count}")
        print(f"  · modified        : {result.modified_count}")
        print(f"\n[.132cg] AFTER:")
        print(f"  · assets.asset_type='{FROM_VALUE}'          : {after_vac_truck} (target: 0)")
        print(f"  · assets.asset_type ~ /^Vacuum Truck$/i      : {after_vacuum_ci}")
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
