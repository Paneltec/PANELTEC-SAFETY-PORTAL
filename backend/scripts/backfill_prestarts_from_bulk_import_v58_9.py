#!/usr/bin/env python3
"""v58.9 — Backfill `pre_starts` collection from bulk-import
`form_submissions`.

The Daily Pre-Starts page (`GET /api/pre-starts`) reads the
`pre_starts` collection — but the bulk-import pipeline writes to
`form_submissions` with `source='bulk_import'`. Result: 3,776
imported pre-start records were invisible to the user for 2 weeks.

This script creates a shim row in `pre_starts` per active
bulk-import row so the Daily Pre-Starts page can render them.
Idempotent — safe to rerun. Won't touch existing rows.

Usage:
  python -m scripts.backfill_prestarts_from_bulk_import_v58_9 --dry-run
  python -m scripts.backfill_prestarts_from_bulk_import_v58_9 --commit
"""
from __future__ import annotations
import argparse, asyncio, os, sys, uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date(iso: str) -> str:
    """Return YYYY-MM-DD from an ISO timestamp. Falls back to today."""
    try:
        return (iso or "")[:10] or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _shim(src: dict, default_workspace_id: str) -> dict:
    """Build the minimal `pre_starts` shape the UI needs. See
    `PreStarts.jsx` render loop:
      subject = `Daily Pre-Start — ${p.date} — ${p.crew_lead}`
      subtitle = p.imported ? null : (p.work_summary || sign_ons summary)
    Marking `imported=True` collapses the subtitle so we don't fake
    data we don't actually have."""
    meta = src.get("metadata") or {}
    src_filename = meta.get("src_filename") or "unknown.pdf"
    now = _now_iso()
    return {
        "id": str(uuid.uuid4()),
        "org_id": src["org_id"],
        # Fall back to a plausible workspace if the source didn't
        # attribute one — most bulk imports don't.
        "workspace_id": src.get("workspace_id") or default_workspace_id,
        "date": _parse_date(src.get("submitted_at") or src.get("created_at")),
        "crew_lead": (meta.get("worker_name") or "Imported from PDF"),
        "work_summary": f"Imported: {src_filename}",
        "linked_swms_ids": [],
        "linked_permits": [],
        "hazards_discussed": "",
        "sign_ons": [],
        "notes": (f"Auto-migrated from form_submissions "
                  f"{src['id']} on {now}. Original PDF hash: "
                  f"{meta.get('pdf_hash', '')[:16]}…"),
        "created_by": src.get("submitted_by_id"),
        "created_at": src.get("created_at") or now,
        "updated_at": now,
        "deleted_at": None,
        # v58.9 audit trail — link back to the form_submission so the
        # backfill is idempotent and reversible.
        "imported": True,
        "source_form_submission_id": src["id"],
        "bulk_import_job_id": meta.get("job_id"),
    }


async def _run(args):
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("MONGO_URL / DB_NAME required."); return 2
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Grab any workspace_id under the target org so shims land on a
    # plausible page filter.
    ws_by_org: dict = {}
    async for w in db.workspaces.find({}, {"_id": 0, "id": 1, "org_id": 1}):
        ws_by_org.setdefault(w["org_id"], w["id"])

    # Build set of already-migrated source ids.
    already = set()
    async for row in db.pre_starts.find(
            {"source_form_submission_id": {"$exists": True}},
            {"_id": 0, "source_form_submission_id": 1}):
        already.add(row["source_form_submission_id"])

    cursor = db.form_submissions.find(
        {"source": "bulk_import", "deleted_at": None},
        {"_id": 0, "id": 1, "org_id": 1, "workspace_id": 1,
         "submitted_at": 1, "created_at": 1, "submitted_by_id": 1,
         "template_name_snapshot": 1, "metadata": 1},
    )
    to_insert = []
    scanned = 0
    skipped = 0
    async for src in cursor:
        scanned += 1
        if src["id"] in already:
            skipped += 1
            continue
        default_ws = ws_by_org.get(src["org_id"], "")
        to_insert.append(_shim(src, default_ws))

    print("┌─ v58.9 pre_starts backfill ──" + "─" * 40)
    print(f"│ mode                       : {'DRY-RUN' if args.dry_run else 'COMMIT'}")
    print(f"│ bulk_import form_subs seen : {scanned}")
    print(f"│ already migrated (skipped) : {skipped}")
    print(f"│ new pre_starts to create   : {len(to_insert)}")
    if to_insert[:2]:
        print(f"│ sample new row keys        : {list(to_insert[0].keys())[:8]}...")
        print(f"│   crew_lead={to_insert[0]['crew_lead']!r} date={to_insert[0]['date']}")
        print(f"│   work_summary={to_insert[0]['work_summary']!r}")
    print("└" + "─" * 62)

    if args.dry_run or not to_insert:
        return 0

    print(f"\n… committing {len(to_insert)} inserts …")
    inserted = 0
    CHUNK = 500
    for i in range(0, len(to_insert), CHUNK):
        batch = to_insert[i:i + CHUNK]
        res = await db.pre_starts.insert_many(batch, ordered=False)
        inserted += len(res.inserted_ids)
        print(f"  batch {i // CHUNK + 1}: inserted={len(res.inserted_ids)}")

    # Audit trail.
    await db.admin_actions.insert_one({
        "id": f"backfill_v58_9_{_now_iso().replace(':', '').replace('-','').replace('.','')}",
        "ts": _now_iso(),
        "action": "backfill_prestarts_from_bulk_import",
        "actor": "system-backfill-v58-9",
        "scanned": scanned, "skipped": skipped, "inserted": inserted,
        "notes": "v58.9 shim rows in pre_starts so bulk-imported "
                 "form_submissions become visible on the Daily "
                 "Pre-Starts page.",
    })
    print(f"\n✓ inserted {inserted} pre_starts shim rows.")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--commit", dest="dry_run", action="store_false")
    args = ap.parse_args()
    sys.exit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
