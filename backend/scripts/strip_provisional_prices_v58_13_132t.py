"""v58.13.132t — EMERGENCY BACK-OUT: strip provisional $3.00/L rows.

Reverses `backfill_provisional_price_v58_13_132t.py`. Finds all rows
with `price_source == "provisional_static_3.00"` and clears
`total_price`, `computed_price_per_litre`, `price_source`,
`price_provisional_at`.

    ⚠ Normal flow does NOT need this script. When the user re-uploads
    the SmartFill CSV with the real Total Price column, the `.131n`
    upsert-merge path automatically overwrites total_price + computed
    _price_per_litre AND clears price_source. This script is for
    emergency back-out only (e.g. user changes their mind before
    the real prices land).

Usage:
    python scripts/strip_provisional_prices_v58_13_132t.py           # dry-run
    python scripts/strip_provisional_prices_v58_13_132t.py --commit  # execute
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

PROVISIONAL_TAG = "provisional_static_3.00"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    q = {"price_source": PROVISIONAL_TAG, "deleted_at": None}
    n = await db.fuel_transactions.count_documents(q)
    print(f"provisional rows: {n}  commit={args.commit}")
    if not args.commit:
        return
    now = datetime.now(timezone.utc).isoformat()
    res = await db.fuel_transactions.update_many(q, {"$set": {
        "total_price": None,
        "computed_price_per_litre": None,
        "price_source": None,
        "price_provisional_at": None,
        "updated_at": now,
    }})
    print(f"stripped: {res.modified_count}")


if __name__ == "__main__":
    asyncio.run(main())
