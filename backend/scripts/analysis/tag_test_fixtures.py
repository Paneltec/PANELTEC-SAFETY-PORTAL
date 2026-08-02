"""v160.3.9.31-4a — Idempotent test-fixture tagger.

Sets `is_test_fixture=True` on every account that shouldn't inflate
admin-facing counts. Runs a belt-and-braces match:
  · Explicit list of 4 fixture emails we ship with pytest.
  · Any email matching `%fixture%` OR `%warmup%`.
  · Every `@example.com` domain address.
  · The lone `demo@paneltec.com` seed.

Re-running is safe: the update is idempotent (only touches rows that
don't already carry the flag). Prints counts before/after.

Run:  cd /app/backend && python scripts/analysis/tag_test_fixtures.py
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from datetime import datetime, timezone
from db import db  # noqa: E402


_EXPLICIT = [
    "contractor-rep-fixture@paneltec.com.au",
    "hseq-lead-fixture@paneltec.com.au",
    "worker-fixture@paneltec.com.au",
    "pending-activation-fixture@paneltec.com.au",
]

_MATCH_QUERY = {
    "$or": [
        {"email": {"$in": _EXPLICIT}},
        {"email": {"$regex": r"fixture", "$options": "i"}},
        {"email": {"$regex": r"warmup", "$options": "i"}},
        {"email": {"$regex": r"@example\.com$", "$options": "i"}},
        {"email": "demo@paneltec.com"},
    ]
}


async def main() -> None:
    now = datetime.now(timezone.utc).isoformat()

    # Preview
    total_match = await db.users.count_documents(_MATCH_QUERY)
    already_flagged = await db.users.count_documents(
        {"$and": [_MATCH_QUERY, {"is_test_fixture": True}]},
    )
    to_flip = total_match - already_flagged
    print(f"Matched rows:      {total_match}")
    print(f"Already flagged:   {already_flagged}")
    print(f"Will be flipped:   {to_flip}")

    # v160.3.9.31-4a — Use $and to combine the match condition with the
    # not-yet-flagged predicate. Naively spreading `**_MATCH_QUERY` and
    # then setting `"$or": [...]` CLOBBERS the match's own $or, matching
    # every row in the DB. Learned the hard way — see undo script.
    result = await db.users.update_many(
        {"$and": [
            _MATCH_QUERY,
            {"$or": [
                {"is_test_fixture": {"$exists": False}},
                {"is_test_fixture": False},
                {"is_test_fixture": None},
            ]},
        ]},
        {"$set": {"is_test_fixture": True, "tagged_test_fixture_at": now}},
    )
    print(f"\nModified: {result.modified_count} / Matched: {result.matched_count}")

    # Post-run summary
    final = await db.users.count_documents({"is_test_fixture": True})
    print(f"\nTotal rows with is_test_fixture=True after run: {final}")
    print("\nAll tagged rows:")
    async for u in db.users.find(
        {"is_test_fixture": True},
        {"_id": 0, "email": 1, "org_id": 1, "activation_status": 1, "role_id": 1},
    ).sort("email", 1):
        print(f"  - {u.get('email'):<50} org={u.get('org_id')[:8]} status={u.get('activation_status')} role_id={u.get('role_id')}")


if __name__ == "__main__":
    asyncio.run(main())
