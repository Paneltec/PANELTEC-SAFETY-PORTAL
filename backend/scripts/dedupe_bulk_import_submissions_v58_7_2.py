#!/usr/bin/env python3
"""v58.7.2 — Soft-delete duplicate bulk-import form_submissions.

Root cause of the duplicates: prior to v58.7.2, `_run_job` called
`db.form_submissions.insert_one(...)` unconditionally on every
successful extraction. When a resume replayed cache-hit PDFs, each
one produced a fresh row (same `pdf_hash`, different `_id`), inflating
`form_submissions` count. This script identifies those duplicate
groups and soft-deletes all but the OLDEST row per group, preserving
audit trail on the removed rows.

Usage:
  python -m scripts.dedupe_bulk_import_submissions_v58_7_2 --dry-run
  python -m scripts.dedupe_bulk_import_submissions_v58_7_2 --commit
  python -m scripts.dedupe_bulk_import_submissions_v58_7_2 \
      --org-id <uuid> --commit
  python -m scripts.dedupe_bulk_import_submissions_v58_7_2 \
      --job-id <uuid> --dry-run

Soft-delete semantics (never hard delete — reviewer audit trail):
  metadata.merged_into_id  = oldest_row_id (the survivor)
  metadata.merged_at        = ISO utc timestamp
  metadata.merged_by        = "system-cleanup-v58-7-2"
  deleted_at                = ISO utc timestamp

Also writes ONE consolidated `admin_actions` audit doc summarising the
sweep so admins can trace this back later.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow running via `python scripts/dedupe_...py` OR `python -m scripts...`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _find_duplicate_groups(coll, match: dict):
    """Yield `(pdf_hash, survivor_id, dup_ids, path)` for each group
    with count > 1.

    v58.7.3 — survivor selection now honours reviewer edits:
      1. If any row in the group has a non-empty `metadata.reviewer_edits`
         array, keep the row with the MOST RECENT edit (by
         `reviewer_edits[-1].at` if present, else group-position order).
         `path` = "kept-edited-by:<user>".
      2. Otherwise fall back to the original "keep oldest by
         `created_at`" heuristic. `path` = "kept-oldest".
    Path is returned for the dry-run report so ops can eyeball which
    heuristic fired per group.
    """
    pipeline = [
        {"$match": {**match, "source": "bulk_import",
                    "metadata.pdf_hash": {"$exists": True, "$ne": None},
                    "deleted_at": None}},
        {"$sort": {"created_at": 1, "_id": 1}},
        {"$group": {
            "_id": {"org_id": "$org_id", "pdf_hash": "$metadata.pdf_hash"},
            "rows": {"$push": {
                "id": "$id", "created_at": "$created_at",
                "submitted_at": "$submitted_at",
                "reviewer_edits": "$metadata.reviewer_edits",
            }},
            "n": {"$sum": 1},
        }},
        {"$match": {"n": {"$gt": 1}}},
    ]
    async for grp in coll.aggregate(pipeline, allowDiskUse=True):
        rows = grp["rows"]
        # Prefer any row with reviewer edits.
        edited = [r for r in rows
                  if r.get("reviewer_edits")
                  and len(r["reviewer_edits"]) > 0]
        if edited:
            # Most recent edit wins.
            def _last_edit_at(r):
                try:
                    return r["reviewer_edits"][-1].get("at", "")
                except Exception:
                    return ""
            edited.sort(key=_last_edit_at, reverse=True)
            survivor = edited[0]
            actor = ""
            try:
                actor = survivor["reviewer_edits"][-1].get("by", "?") or "?"
            except Exception:
                actor = "?"
            path = f"kept-edited-by:{actor}"
        else:
            # Fallback — oldest by created_at (already sorted asc).
            survivor = rows[0]
            path = "kept-oldest"
        dups = [r for r in rows if r["id"] != survivor["id"]]
        yield (grp["_id"]["pdf_hash"], survivor, dups, path)


async def _run(args):
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("MONGO_URL / DB_NAME env vars are required.")
        return 2

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    match: dict = {}
    if args.org_id:
        match["org_id"] = args.org_id
    if args.job_id:
        match["metadata.job_id"] = args.job_id

    groups_scanned = 0
    rows_to_soft_delete = 0
    survivor_ids: list = []
    per_group_summaries: list = []
    to_soft_delete_ids: list = []
    survivor_by_hash: dict = {}
    tiebreaker_counts = {"kept-oldest": 0, "kept-edited": 0}

    async for pdf_hash, survivor, dups, path in _find_duplicate_groups(
            db.form_submissions, match):
        groups_scanned += 1
        rows_to_soft_delete += len(dups)
        survivor_ids.append(survivor["id"])
        survivor_by_hash[pdf_hash] = survivor["id"]
        if path == "kept-oldest":
            tiebreaker_counts["kept-oldest"] += 1
        else:
            tiebreaker_counts["kept-edited"] += 1
        for d in dups:
            to_soft_delete_ids.append((d["id"], survivor["id"]))
        if len(per_group_summaries) < 5:
            per_group_summaries.append({
                "pdf_hash": pdf_hash[:12] + "…",
                "n": len(dups) + 1,
                "keep_id": survivor["id"],
                "path": path,
                "soft_delete_ids": [d["id"] for d in dups[:3]] +
                                    (["…"] if len(dups) > 3 else []),
            })

    print("┌─ v58.7.3 dedupe report ─" + "─" * 40)
    print(f"│ mode              : {'DRY-RUN' if args.dry_run else 'COMMIT'}")
    print(f"│ scope             : {match if match else 'all bulk_import rows'}")
    print(f"│ duplicate groups  : {groups_scanned}")
    print(f"│ rows to soft-delete: {rows_to_soft_delete}")
    print(f"│ survivors kept    : {len(survivor_ids)}")
    print(f"│ tiebreaker paths  : kept-oldest={tiebreaker_counts['kept-oldest']} "
          f"kept-edited={tiebreaker_counts['kept-edited']}")
    if per_group_summaries:
        print("│ sample groups (up to 5):")
        for g in per_group_summaries:
            print(f"│   · hash={g['pdf_hash']} n={g['n']} keep={g['keep_id'][:8]}… "
                  f"path={g['path']} "
                  f"drop={[i[:8] + '…' for i in g['soft_delete_ids'] if i != '…']}"
                  + (" +more" if any(i == '…' for i in g['soft_delete_ids']) else ""))
    print("└" + "─" * 62)

    if args.dry_run or rows_to_soft_delete == 0:
        return 0

    print(f"\n… committing {rows_to_soft_delete} soft-deletes …")
    now = _now_iso()
    marked = 0
    # Process in chunks to avoid a single monster update payload.
    CHUNK = 500
    for i in range(0, len(to_soft_delete_ids), CHUNK):
        batch = to_soft_delete_ids[i:i + CHUNK]
        # `update_many` per chunk with the survivor id encoded per row
        # via bulk ops. Motor's bulk_write is the clean primitive.
        from pymongo import UpdateOne
        ops = [
            UpdateOne(
                {"id": dup_id, "deleted_at": None},
                {"$set": {
                    "deleted_at": now,
                    "metadata.merged_into_id": survivor_id,
                    "metadata.merged_at": now,
                    "metadata.merged_by": "system-cleanup-v58-7-2",
                }},
            )
            for dup_id, survivor_id in batch
        ]
        res = await db.form_submissions.bulk_write(ops, ordered=False)
        marked += res.modified_count
        print(f"  batch {i // CHUNK + 1}: modified={res.modified_count}")

    # Audit entry — one row summarising the whole sweep.
    audit_doc = {
        "id": f"dedupe_v58_7_2_{now.replace(':', '').replace('-', '').replace('.', '')}",
        "ts": now,
        "action": "dedupe_bulk_import_submissions",
        "actor": "system-cleanup-v58-7-2",
        "scope": match if match else {"all": True},
        "groups_scanned": groups_scanned,
        "rows_soft_deleted": marked,
        "survivor_ids_sample": survivor_ids[:50],
        "notes": "v58.7.2 mid-flight duplicate cleanup after the "
                 "v58.7.1 resume race. See "
                 "scripts/dedupe_bulk_import_submissions_v58_7_2.py.",
    }
    try:
        await db.admin_actions.insert_one(audit_doc)
    except Exception as e:
        print(f"  WARN: admin_actions insert failed: {e}")

    print(f"\n✓ soft-deleted {marked} of {rows_to_soft_delete} candidate rows.")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--commit", dest="dry_run", action="store_false")
    ap.add_argument("--org-id", default=None,
                    help="Limit to a single org_id.")
    ap.add_argument("--job-id", default=None,
                    help="Limit to rows tagged with metadata.job_id.")
    args = ap.parse_args()
    sys.exit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
