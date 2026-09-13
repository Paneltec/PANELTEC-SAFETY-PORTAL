"""v58.13.132dz — Sidebar merge + auto-routing migrations.

Two independent migrations, both idempotent + audit-logged:

1. **CS Incidents → Incident Reports**
   Every doc in `cs_incident_issues` gets copied into `incidents`
   with a `migrated_from: "cs_incidents"` audit tag and a
   `_migrated_at_v58_13_132dz` timestamp. Original docs are LEFT
   IN PLACE (read-only for one release cycle per Stephen's rules,
   in case rollback is needed). CS Incidents FE surface is
   retired in this ship; the source collection sticks around
   read-only until a future ship confirms nothing regressed.

2. **Hazard Reports → Risk Assessments**
   Two parts:
     a. Any `form_submissions` row with
        `template_category_snapshot IN ["hazard", "near_miss"]`
        gets its category re-stamped to `"risk_assessment"`.
        The original category is preserved on the doc as
        `_original_category`, plus a `migrated_from:
        "hazard_reports"` audit tag and the `_migrated_at_*`
        timestamp.
     b. Every doc in the native `hazards` collection is copied
        into a new `risk_assessments` collection with the same
        audit tag. Source `hazards` collection is left in place.

Idempotency: every write is guarded by an `_migrated_at_v58_13_132dz`
check. A second run finds zero un-migrated docs and exits with a
"nothing to do" log line + zero mutations.

Usage
-----
    python -m backend.scripts.migrate_sidebar_merge_v58_13_132dz --dry-run
    python -m backend.scripts.migrate_sidebar_merge_v58_13_132dz --commit

    --dry-run  (default) — prints what WOULD change; touches nothing.
    --commit             — performs the writes.

Prints per-collection counts + a sample of migrated ids. Exit code
0 on success, non-zero on any exception.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure `backend/` is importable when run as a script from /app.
_HERE = Path(__file__).resolve()
_BACKEND = _HERE.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(_BACKEND / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

MIGRATION_STAMP_FIELD = "_migrated_at_v58_13_132dz"
CS_MIGRATION_TAG = "cs_incidents"
HAZARD_MIGRATION_TAG = "hazard_reports"
HAZARDS_NATIVE_TAG = "hazards"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# ── Part 1: CS Incidents → Incident Reports ────────────────────

async def migrate_cs_incidents(db, commit: bool) -> dict:
    """Copy every non-migrated `cs_incident_issues` doc into
    `incidents` with a `migrated_from: "cs_incidents"` audit tag.
    Source docs are left in place (read-only for one release
    cycle per user directive).
    """
    src = db.cs_incident_issues
    dst = db.incidents

    total = await src.count_documents({})
    to_migrate_query = {MIGRATION_STAMP_FIELD: {"$exists": False}}
    to_migrate_count = await src.count_documents(to_migrate_query)
    already_migrated = total - to_migrate_count

    migrated_ids: list[str] = []
    skipped_ids: list[str] = []

    if to_migrate_count == 0:
        print(f"  [cs_incidents] nothing to do "
              f"(total={total}, already_migrated={already_migrated})")
        return {"total": total, "migrated": 0,
                "already_migrated": already_migrated,
                "migrated_ids": [], "skipped_ids": []}

    async for src_doc in src.find(to_migrate_query, {"_id": 0}):
        src_id = src_doc.get("id") or src_doc.get("issue_number")
        if not src_id:
            skipped_ids.append(f"<no-id-issue-{src_doc.get('issue_number')}>")
            continue

        # Collision-safe: if the destination already has a doc with
        # the same id, we suffix. Very unlikely but defensive.
        collision_id = src_id
        existing = await dst.find_one({"id": collision_id}, {"id": 1})
        if existing:
            collision_id = f"{src_id}-cs-migrated"
            second = await dst.find_one({"id": collision_id}, {"id": 1})
            if second:
                # Truly weird — skip so we never overwrite.
                skipped_ids.append(f"{src_id} (dest collision)")
                continue

        new_doc = dict(src_doc)
        new_doc["id"] = collision_id
        new_doc["migrated_from"] = CS_MIGRATION_TAG
        new_doc["migrated_from_id"] = src_id
        new_doc[MIGRATION_STAMP_FIELD] = _now_iso()
        # Ensure `deleted_at` key exists for the incidents list filter.
        new_doc.setdefault("deleted_at", src_doc.get("deleted_at"))

        if commit:
            await dst.insert_one(new_doc)
            # Stamp the source doc so a re-run skips it. Using the
            # ORIGINAL src_id so a re-run finds this row via the
            # unique `id` key path — cs_incident_issues uses
            # `issue_number` as unique, but we key our stamp by
            # `_id` from the doc we just read.
            await src.update_one(
                {"issue_number": src_doc.get("issue_number")}
                if src_doc.get("issue_number") is not None
                else {"id": src_id},
                {"$set": {MIGRATION_STAMP_FIELD: _now_iso(),
                          "migrated_to_id": collision_id}},
            )
        migrated_ids.append(collision_id)

    print(f"  [cs_incidents] {'WOULD migrate' if not commit else 'migrated'} "
          f"{len(migrated_ids)} docs; skipped {len(skipped_ids)}; "
          f"already_migrated={already_migrated}")
    if migrated_ids[:5]:
        print(f"  [cs_incidents] sample ids: {migrated_ids[:5]}")
    if skipped_ids:
        print(f"  [cs_incidents] SKIP ids: {skipped_ids[:5]}"
              f"{' …' if len(skipped_ids) > 5 else ''}")

    return {"total": total, "migrated": len(migrated_ids),
            "already_migrated": already_migrated,
            "migrated_ids": migrated_ids, "skipped_ids": skipped_ids}


# ── Part 2a: form_submissions category rewrite ─────────────────

async def migrate_hazard_form_submissions(db, commit: bool) -> dict:
    """Rewrite `template_category_snapshot` from `hazard`/`near_miss`
    → `risk_assessment` on every un-migrated form_submissions row.
    Preserves the original value as `_original_category`.
    """
    coll = db.form_submissions
    q = {
        "template_category_snapshot": {"$in": ["hazard", "near_miss"]},
        MIGRATION_STAMP_FIELD: {"$exists": False},
    }
    total_pre = await coll.count_documents(
        {"template_category_snapshot": {"$in": ["hazard", "near_miss"]}}
    )
    to_migrate = await coll.count_documents(q)
    already_migrated = total_pre - to_migrate

    sample_ids: list[str] = []
    async for d in coll.find(q, {"_id": 0, "id": 1}).limit(10):
        sample_ids.append(d["id"])

    if to_migrate == 0:
        print(f"  [hazard→risk_assessment (form_submissions)] nothing to do "
              f"(pre_total={total_pre}, already_migrated={already_migrated})")
        return {"total_pre": total_pre, "migrated": 0,
                "already_migrated": already_migrated, "sample_ids": []}

    if commit:
        # v58.13.132dz — one write pass that stamps ALL matching rows.
        # We use `$set` + `$rename` in TWO update_many calls because
        # Mongo can't rename+set-different-value on the same field in
        # one op. Instead: (a) copy category into
        # `_original_category`, (b) overwrite category to
        # `risk_assessment`, (c) stamp audit tag.
        # Pre-fetch the docs by id so we can preserve original values.
        # Simpler: iterate.
        async for d in coll.find(q, {"_id": 0, "id": 1,
                                     "template_category_snapshot": 1}):
            await coll.update_one(
                {"id": d["id"]},
                {"$set": {
                    "template_category_snapshot": "risk_assessment",
                    "_original_category": d.get("template_category_snapshot"),
                    "migrated_from": HAZARD_MIGRATION_TAG,
                    MIGRATION_STAMP_FIELD: _now_iso(),
                }},
            )
        migrated = to_migrate
    else:
        migrated = 0

    print(f"  [hazard→risk_assessment (form_submissions)] "
          f"{'WOULD migrate' if not commit else 'migrated'} "
          f"{to_migrate} rows; already_migrated={already_migrated}")
    if sample_ids:
        print(f"  [hazard→risk_assessment (form_submissions)] sample ids: {sample_ids[:5]}")
    return {"total_pre": total_pre, "migrated": migrated,
            "already_migrated": already_migrated, "sample_ids": sample_ids}


# ── Part 2b: native `hazards` collection → `risk_assessments` ──

async def migrate_hazards_collection(db, commit: bool) -> dict:
    """Copy every non-migrated native `hazards` doc into
    `risk_assessments` with a `migrated_from: "hazards"` audit tag.
    Source docs are left in place (read-only for one release cycle).
    """
    src = db.hazards
    dst = db.risk_assessments

    if "hazards" not in await db.list_collection_names():
        print(f"  [hazards→risk_assessments (native)] source missing, skip")
        return {"total": 0, "migrated": 0, "already_migrated": 0,
                "migrated_ids": []}

    total = await src.count_documents({})
    q = {MIGRATION_STAMP_FIELD: {"$exists": False}}
    to_migrate = await src.count_documents(q)
    already_migrated = total - to_migrate

    migrated_ids: list[str] = []
    skipped_ids: list[str] = []

    if to_migrate == 0:
        print(f"  [hazards→risk_assessments (native)] nothing to do "
              f"(total={total}, already_migrated={already_migrated})")
        return {"total": total, "migrated": 0,
                "already_migrated": already_migrated,
                "migrated_ids": [], "skipped_ids": []}

    async for src_doc in src.find(q, {"_id": 0}):
        src_id = src_doc.get("id")
        if not src_id:
            skipped_ids.append("<no-id>")
            continue

        # Collision-safe (very unlikely — risk_assessments starts empty).
        collision_id = src_id
        if await dst.find_one({"id": collision_id}, {"id": 1}):
            collision_id = f"{src_id}-haz-migrated"

        new_doc = dict(src_doc)
        new_doc["id"] = collision_id
        new_doc["migrated_from"] = HAZARDS_NATIVE_TAG
        new_doc["migrated_from_id"] = src_id
        new_doc[MIGRATION_STAMP_FIELD] = _now_iso()
        new_doc.setdefault("deleted_at", src_doc.get("deleted_at"))

        if commit:
            await dst.insert_one(new_doc)
            await src.update_one(
                {"id": src_id},
                {"$set": {MIGRATION_STAMP_FIELD: _now_iso(),
                          "migrated_to_id": collision_id}},
            )
        migrated_ids.append(collision_id)

    print(f"  [hazards→risk_assessments (native)] "
          f"{'WOULD migrate' if not commit else 'migrated'} "
          f"{len(migrated_ids)} docs; skipped {len(skipped_ids)}; "
          f"already_migrated={already_migrated}")
    if migrated_ids[:5]:
        print(f"  [hazards→risk_assessments (native)] sample ids: {migrated_ids[:5]}")
    return {"total": total, "migrated": len(migrated_ids),
            "already_migrated": already_migrated,
            "migrated_ids": migrated_ids, "skipped_ids": skipped_ids}


# ── Orchestration ──────────────────────────────────────────────

async def run(commit: bool) -> int:
    db = _client()
    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"v58.13.132dz sidebar-merge migration — mode={mode}")
    print("=" * 60)

    print("Item 1: CS Incidents → Incident Reports")
    cs_result = await migrate_cs_incidents(db, commit)

    print()
    print("Item 2a: form_submissions category rewrite (hazard/near_miss → risk_assessment)")
    fs_result = await migrate_hazard_form_submissions(db, commit)

    print()
    print("Item 2b: native `hazards` collection → `risk_assessments`")
    hz_result = await migrate_hazards_collection(db, commit)

    print()
    print("=" * 60)
    print("Summary")
    print(f"  cs_incidents:     migrated={cs_result['migrated']:>6}  "
          f"already={cs_result['already_migrated']}")
    print(f"  form_submissions: migrated={fs_result['migrated']:>6}  "
          f"already={fs_result['already_migrated']}")
    print(f"  hazards:          migrated={hz_result['migrated']:>6}  "
          f"already={hz_result['already_migrated']}")

    if not commit:
        print()
        print("DRY-RUN complete. Re-run with --commit to apply.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true",
                    help="Actually perform the migration writes.")
    ap.add_argument("--dry-run", action="store_true",
                    help="(default) No writes.")
    args = ap.parse_args()
    commit = bool(args.commit) and not args.dry_run
    return asyncio.run(run(commit))


if __name__ == "__main__":
    sys.exit(main())
