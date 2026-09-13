"""v58.13.132dx — One-time bulk freeze of existing fuel_transactions.

Iterates every fuel transaction across ALL orgs and stamps the frozen
snapshot fields (`frozen_price_per_litre`, `frozen_total_price`,
`frozen_price_source`, `frozen_at`, `frozen_by_price_setting_id`)
using the current-effective price + toggle state per org.

Idempotent — rows that already carry `frozen_at` are skipped.
Audit output shows per-org counts + the distribution across
`frozen_price_source` categories so the ship memo can capture the
migration state.

Usage:
    python -m backend.scripts.freeze_fuel_prices_v58_13_132dx [--dry-run]
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections import Counter, defaultdict

from motor.motor_asyncio import AsyncIOMotorClient


async def _run(dry_run: bool) -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not (mongo_url and db_name):
        print("ERR: MONGO_URL / DB_NAME env not set", file=sys.stderr)
        return 1
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from fuel_price_settings import freeze_price_snapshot   # noqa: WPS433

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Load every org's price settings once.
    price_by_org: dict = {}
    async for s in db.fuel_price_settings.find({}, {"_id": 1, "org_id": 1,
                                                     "provisional_price_per_litre": 1,
                                                     "override_smartfill_real": 1,
                                                     "override_mode": 1}):
        price_by_org[s["org_id"]] = {
            "id": str(s.get("_id")),
            "price": float(s.get("provisional_price_per_litre") or 0),
            "override": bool(s.get("override_smartfill_real")
                              or s.get("override_mode") == "provisional_all"),
        }

    per_org_counts: dict = defaultdict(Counter)
    total_frozen = 0
    total_skipped = 0
    q = {"frozen_at": {"$in": [None, ""]}} if False else {"frozen_at": {"$exists": False}}
    async for tx in db.fuel_transactions.find(
        {}, {"_id": 1, "id": 1, "org_id": 1, "litres": 1,
             "total_price": 1, "price_source": 1, "frozen_at": 1},
    ):
        if tx.get("frozen_at"):
            total_skipped += 1
            continue
        org_id = tx.get("org_id") or ""
        pcfg = price_by_org.get(org_id) or {}
        provisional = float(pcfg.get("price") or 0)
        override = bool(pcfg.get("override"))
        setting_id = pcfg.get("id")
        snap = freeze_price_snapshot(tx, provisional, override, setting_id)
        per_org_counts[org_id][snap["frozen_price_source"]] += 1
        total_frozen += 1
        if not dry_run:
            await db.fuel_transactions.update_one(
                {"_id": tx["_id"]},
                {"$set": snap},
            )

    print(f"MIGRATION: dry_run={dry_run}")
    print(f"  total frozen:  {total_frozen}")
    print(f"  total skipped: {total_skipped} (already frozen)")
    print("  distribution by org × source:")
    for org_id, counts in per_org_counts.items():
        print(f"    org={org_id[:8]}... "
              f"smartfill_real={counts['smartfill_real']} "
              f"provisional_override={counts['provisional_override']} "
              f"provisional_fallback={counts['provisional_fallback']}")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    sys.exit(asyncio.run(_run(args.dry_run)))


if __name__ == "__main__":
    main()
