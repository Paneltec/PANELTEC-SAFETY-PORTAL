"""v159.2 — one-time migration: dedup `org_settings` documents.

Some orgs accumulated multiple rows in `org_settings` with the same
`org_id` (root cause: an early `_load_matrix` in mobile_modules.py used
`update_one(..., upsert=True)` without a unique index, so parallel first
reads inserted twice). This script:

  1. Groups `org_settings` by `org_id`
  2. Keeps the doc with the most-recent `updated_at` (fallback: latest
     `created_at`, then latest `_id.getTimestamp()`)
  3. Soft-copies non-overlapping keys from the losers into the winner
     (so we never lose fields like `mobile_modules`, `defaults_version`)
  4. Deletes the losers
  5. Ensures a unique index on `org_id`

Idempotent — running twice does nothing if the collection is already
clean. Reports the kept and deleted `_id`s to stdout as JSON.

Usage:
  python /app/scripts/dedup_org_settings.py
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, "/app/backend")

from db import db  # noqa: E402  — depends on backend PYTHONPATH


def _score(doc: dict) -> tuple:
    """Higher = more authoritative."""
    return (
        doc.get("updated_at") or "",
        doc.get("created_at") or "",
        str(doc.get("_id") or ""),
    )


async def main() -> None:
    all_docs = await db.org_settings.find({}, {}).to_list(10000)
    by_org: dict[str, list[dict]] = defaultdict(list)
    for d in all_docs:
        by_org[d.get("org_id", "__missing__")].append(d)

    report = {"scanned": len(all_docs), "orgs": len(by_org),
              "kept": [], "deleted": [], "merged_fields": []}

    for org_id, docs in by_org.items():
        if len(docs) <= 1:
            continue
        docs.sort(key=_score, reverse=True)
        winner = docs[0]
        losers = docs[1:]
        merged_fields: dict[str, str] = {}
        for l in losers:
            for k, v in l.items():
                if k in ("_id", "org_id"):
                    continue
                if k not in winner or winner.get(k) in (None, "", {}, []):
                    winner[k] = v
                    merged_fields[k] = str(l["_id"])
        if merged_fields:
            await db.org_settings.update_one(
                {"_id": winner["_id"]},
                {"$set": {k: winner[k] for k in merged_fields}},
            )
            report["merged_fields"].append({
                "org_id": org_id, "winner_id": str(winner["_id"]),
                "fields": merged_fields,
            })
        for l in losers:
            await db.org_settings.delete_one({"_id": l["_id"]})
            report["deleted"].append({
                "org_id": org_id, "_id": str(l["_id"]),
                "updated_at": l.get("updated_at"),
            })
        report["kept"].append({
            "org_id": org_id, "_id": str(winner["_id"]),
            "updated_at": winner.get("updated_at"),
        })

    # Ensure a unique index on org_id to prevent recurrence.
    existing = await db.org_settings.index_information()
    already_unique = any(
        idx.get("key") == [("org_id", 1)] and idx.get("unique")
        for idx in existing.values()
    )
    if not already_unique:
        await db.org_settings.create_index("org_id", unique=True, name="uniq_org_id")
        report["index_created"] = "uniq_org_id"
    else:
        report["index_created"] = "already_present"

    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())
