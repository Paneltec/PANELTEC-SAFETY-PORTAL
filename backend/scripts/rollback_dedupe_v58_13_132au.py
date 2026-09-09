"""v58.13.132au — Rollback for the dedupe backfill.

Un-soft-deletes every fuel_transactions row that was tagged by
`scripts/backfill_dedupe_v58_13_132au.py` with
`deleted_reason == 'dupe_backfill_.132au'`.

Kept as a safety net for at least one week post-ship in case a
"duplicate" pair was actually two legitimate fills that happened
inside the same minute on the same card (would only bite if a
driver dips twice back-to-back for a single tanker). Extremely
unlikely in the SmartFill fleet, but the option to reverse is here.

NOTE: this does NOT undo the non-destructive field merges onto the
surviving row. Since those merges only fill fields that were null,
a rollback restores every original row in place. The merge tagging
`_dedupe_backfill_merged_from` / `_dedupe_backfill_merged_at` stays
on the survivor as forensic breadcrumbs — safe to keep.

Usage:
    python scripts/rollback_dedupe_v58_13_132au.py             # dry-run
    python scripts/rollback_dedupe_v58_13_132au.py --commit    # execute
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


DELETED_REASON = "dupe_backfill_.132au"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    q = {"deleted_reason": DELETED_REASON}
    n = await db.fuel_transactions.count_documents(q)
    print(f"rows tagged '{DELETED_REASON}': {n}  commit={args.commit}")

    if not args.commit:
        # Preview: show first 10 candidates.
        print("first 10 candidates:")
        async for r in db.fuel_transactions.find(q).limit(10):
            print(f"  id={r.get('id')} reg={r.get('registration')} "
                  f"date={r.get('date_iso')} time={r.get('time_local')} "
                  f"litres={r.get('litres')} survivor={r.get('_backfill_dedupe_survivor_id')}")
        print("\n(dry-run — no writes) run with --commit to un-soft-delete")
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.fuel_transactions.update_many(
        q,
        {
            "$set": {
                "deleted_at": None,
                "_rollback_dedupe_at": now_iso,
                "updated_at": now_iso,
            },
            "$unset": {
                "deleted_reason": "",
                "deleted_by": "",
                "_backfill_dedupe_survivor_id": "",
            },
        },
    )
    print(f"restored rows: {result.modified_count}")


if __name__ == "__main__":
    asyncio.run(main())
