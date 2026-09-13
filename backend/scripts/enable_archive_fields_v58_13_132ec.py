"""v58.13.132ec — Archive feature: index setup.

The four archive fields (`archived_at`, `archived_by`,
`archived_reason`, `archive_batch_id`) are added lazily on write by
the archive endpoints — Mongo's `{field: null}` semantics match both
`null` AND missing docs, so a legacy row without the field surfaces
correctly on the default (non-archived) list view. No data backfill
required.

This script only creates the indexes that make the new archive
filter fast at query time:

  · `archived_at`      – primary filter on every list request
  · `archive_batch_id` – bulk unarchive lookup

Idempotent — Mongo's `create_index()` is a no-op when the index
already exists with matching options.

Usage
-----
    python -m backend.scripts.enable_archive_fields_v58_13_132ec --commit
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
_BACKEND = _HERE.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(_BACKEND / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

# v58.13.132ec — 7 modules the archive feature covers.
# `form_submissions` gets indexed too because 5 of the 7 modules
# union it via `mirror_categories` in `crud.py::build_router`.
COLLECTIONS = [
    "pre_starts",
    "site_diary_entries",
    "hazards",
    "incidents",
    "inspections",
    "site_visitors",
    "risk_assessments",
    "form_submissions",   # for mirrored slices
]


def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


async def run(commit: bool) -> int:
    db = _db()
    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"v58.13.132ec archive-field index setup — mode={mode}")

    for c in COLLECTIONS:
        exists = c in await db.list_collection_names()
        if not exists:
            print(f"  · {c:<25s}  MISSING — skip")
            continue
        n = await db[c].count_documents({})
        n_arch = await db[c].count_documents({"archived_at": {"$ne": None,
                                                                "$exists": True}})
        if commit:
            await db[c].create_index("archived_at", name="idx_archived_at",
                                      sparse=True)
            await db[c].create_index("archive_batch_id",
                                      name="idx_archive_batch_id",
                                      sparse=True)
        print(f"  · {c:<25s}  total={n:>6}  archived={n_arch}  "
              f"{'indexed' if commit else 'would index'}")

    # `archive_audit` collection — one row per archive/unarchive action.
    # Indexed by (module, timestamp) for admin surface + (batch_id) for
    # bulk-unarchive lookups.
    if commit:
        await db.archive_audit.create_index([("module", 1),
                                              ("timestamp", -1)],
                                             name="idx_module_timestamp")
        await db.archive_audit.create_index("batch_id",
                                             name="idx_batch_id",
                                             sparse=True)
    print(f"  · archive_audit           indexes {'created' if commit else 'would create'}")

    if not commit:
        print()
        print("DRY-RUN — re-run with --commit to apply index changes.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    commit = bool(args.commit) and not args.dry_run
    return asyncio.run(run(commit))


if __name__ == "__main__":
    sys.exit(main())
