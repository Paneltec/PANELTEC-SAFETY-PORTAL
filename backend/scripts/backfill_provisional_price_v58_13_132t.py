"""v58.13.132t — Provisional $3.00/L back-fill.

Fills `total_price`, `computed_price_per_litre`, `price_source`,
`price_provisional_at` on every `fuel_transactions` row missing a
real total_price. Idempotent: a second run touches 0 rows.

  · `total_price` becomes `round(litres * 3.00, 2)`
  · `computed_price_per_litre` becomes `3.00`
  · `price_source` becomes `"provisional_static_3.00"` (marker so
    UI can badge and audit can filter)
  · `price_provisional_at` becomes now (UTC iso)

Rows that already have a real `total_price` are NEVER touched. The
`.131n` upsert-on-duplicate merge path is the reverse — when a real
Total Price arrives via CSV re-upload, `total_price` +
`computed_price_per_litre` get overwritten AND `price_source` gets
cleared (see the .132t patch to `fleet_fuel.py:879-905`).

Usage:
    python scripts/backfill_provisional_price_v58_13_132t.py             # dry-run
    python scripts/backfill_provisional_price_v58_13_132t.py --commit    # execute
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402

PROVISIONAL_RATE = 2.25
PROVISIONAL_TAG = "provisional_static_2.25"
# v58.13.132de — legacy tag kept in the recognition set so historical
# rows populated by the .132t backfill are still detected + excluded
# from $/L outlier calc + surfaced on the has_provisional banner.
# v58.13.132de — PROVISIONAL_RATE is now sourced from
# `fuel_price_settings.get_org_provisional_price(org_id)` at call time
# rather than being hard-coded. This module constant remains only as
# an emergency-fallback value used if the collection is unreachable.
LEGACY_PROVISIONAL_TAGS = {"provisional_static_3.00", "provisional_static_2.25"}
PROVISIONAL_PRICE = 2.25


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    now = datetime.now(timezone.utc).isoformat()
    # Target: no real total_price, has positive litres, NOT already
    # provisionally-priced (idempotency guard).
    q = {
        "deleted_at": None,
        "litres": {"$gt": 0},
        "$and": [
            {"$or": [{"total_price": None},
                     {"total_price": {"$exists": False}}]},
            {"$or": [{"price_source": {"$ne": PROVISIONAL_TAG}},
                     {"price_source": {"$exists": False}}]},
        ],
    }
    n_matched = await db.fuel_transactions.count_documents(q)
    print(f"matched rows: {n_matched}  commit={args.commit}")

    if not args.commit:
        # Show a couple of samples
        i = 0
        async for t in db.fuel_transactions.find(q).limit(3):
            i += 1
            provisional_total = round(float(t["litres"]) * PROVISIONAL_RATE, 2)
            print(f"  sample #{i}: id={t['id']} litres={t['litres']}"
                  f" → total_price={provisional_total} @ ${PROVISIONAL_RATE:.3f}/L")
        return

    # Commit — update per-row so total_price = litres * 3.00.
    # $set with a computed expression requires the aggregation update
    # form (pipeline update). Available on MongoDB 4.2+.
    res = await db.fuel_transactions.update_many(q, [
        {"$set": {
            "total_price": {
                "$round": [
                    {"$multiply": ["$litres", PROVISIONAL_RATE]}, 2,
                ]
            },
            "computed_price_per_litre": PROVISIONAL_RATE,
            "price_source": PROVISIONAL_TAG,
            "price_provisional_at": now,
            "updated_at": now,
        }},
    ])
    print(f"modified: {res.modified_count}")


if __name__ == "__main__":
    asyncio.run(main())
