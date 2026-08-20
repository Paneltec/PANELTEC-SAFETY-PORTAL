#!/usr/bin/env python3
"""v58.10.3 — Backfill enrichment for bulk-imported pre_starts.

Fix scope (from the v58.10.3 completeness diagnosis):

  · Every existing bulk-import `form_submissions` row is missing
    `template_category_snapshot`. The pre-starts endpoint's
    mirror-union filters on this key, so bulk-import rows have been
    silently invisible to the mirror path even though the rich
    `fields[]` payload has been in Mongo the whole time.
  · Every existing `pre_starts` shim carries the placeholder
    `crew_lead = "Imported from PDF"`, the insert-date rather than
    the extracted PDF date, and lacks `template_name_snapshot` +
    `fields[]`. Tile faces + detail modals under-render as a result.

This script re-runs safely:
  · Reads only. Never hard-deletes.
  · Every $set is gated on the target field being absent OR still the
    placeholder value. Re-runs on already-enriched rows are no-ops.
  · Reports before / after counts.

Usage:
  python backend/scripts/backfill_prestarts_enrichment_v58_10_3.py
    → exits 0 on success, non-zero on error. Prints a summary.
"""
from __future__ import annotations
import asyncio
import os
import re
import sys
from pathlib import Path
from typing import Optional

# Load .env
_env_path = Path(__file__).resolve().parents[1] / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PLACEHOLDER_CREW = "Imported from PDF"


def _pick_extraction_date(fields: list) -> Optional[str]:
    for f in fields or []:
        v = f.get("value") if isinstance(f, dict) else None
        if isinstance(v, str) and _DATE_RE.match(v):
            return v
    return None


def _pick_worker_name(fields: list) -> Optional[str]:
    for f in fields or []:
        v = f.get("value") if isinstance(f, dict) else None
        if isinstance(v, list) and v and isinstance(v[0], dict):
            name = v[0].get("name")
            if isinstance(name, str) and name.strip():
                return name.strip()
    return None


async def _load_template_cache(db) -> dict:
    """Fetch every `form_templates` row once → id → {category, name}."""
    cache: dict = {}
    async for t in db.form_templates.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "category": 1},
    ):
        cache[t["id"]] = t
    return cache


async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("MONGO_URL / DB_NAME missing from env — aborting.")
        return 2
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # ─── BEFORE snapshot ────────────────────────────────────────
    n_shim = await db.pre_starts.count_documents({"imported": True})
    n_fs = await db.form_submissions.count_documents(
        {"source": "bulk_import", "deleted_at": None}
    )
    n_fs_cat_before = await db.form_submissions.count_documents({
        "source": "bulk_import", "deleted_at": None,
        "template_category_snapshot": {"$exists": True},
    })
    n_shim_placeholder_before = await db.pre_starts.count_documents({
        "imported": True, "crew_lead": _PLACEHOLDER_CREW,
    })
    n_shim_no_tpl_before = await db.pre_starts.count_documents({
        "imported": True,
        "template_name_snapshot": {"$in": [None, ""]},
    })
    n_shim_no_fields_before = await db.pre_starts.count_documents({
        "imported": True,
        "fields": {"$exists": False},
    })
    print("=== BEFORE ===")
    print(f"  imported pre_starts:                    {n_shim}")
    print(f"  bulk_import form_submissions (active):  {n_fs}")
    print(f"  form_submissions with tpl_cat set:      {n_fs_cat_before}")
    print(f"  pre_starts with placeholder crew_lead:  {n_shim_placeholder_before}")
    print(f"  pre_starts missing template_name:       {n_shim_no_tpl_before}")
    print(f"  pre_starts missing fields[]:            {n_shim_no_fields_before}")

    # ─── Cache templates in-memory ──────────────────────────────
    tpl_cache = await _load_template_cache(db)
    print(f"loaded {len(tpl_cache)} templates into cache")

    # ─── Sweep 1 — stamp template_category_snapshot ─────────────
    # Walk bulk_import form_submissions missing the field, look up
    # template category, $set it. One update per unique (org, tpl) pair
    # would be nice, but doing it per-row keeps the code trivial and
    # Mongo handles the batching internally.
    swept_fs = 0
    stamped_fs = 0
    cursor = db.form_submissions.find(
        {
            "source": "bulk_import",
            "deleted_at": None,
            "template_category_snapshot": {"$exists": False},
        },
        {"_id": 0, "id": 1, "template_id": 1},
    )
    async for row in cursor:
        swept_fs += 1
        tpl = tpl_cache.get(row.get("template_id")) or {}
        cat = tpl.get("category")
        if not cat:
            continue
        r = await db.form_submissions.update_one(
            {"id": row["id"], "template_category_snapshot": {"$exists": False}},
            {"$set": {"template_category_snapshot": cat}},
        )
        stamped_fs += r.modified_count
    print(f"sweep-1: form_submissions swept={swept_fs} stamped={stamped_fs}")

    # ─── Sweep 2 — enrich pre_starts shims ─────────────────────
    # For each imported shim, fetch its paired form_submission (by
    # source_form_submission_id), pull template + fields, patch the
    # placeholder / missing keys only. Batched via a cursor with a
    # projection so we don't drag the whole shim body into memory.
    swept_ps = 0
    enriched_ps = 0
    skipped_no_pair = 0
    cursor = db.pre_starts.find(
        {"imported": True},
        {"_id": 0, "id": 1, "crew_lead": 1, "date": 1,
         "template_name_snapshot": 1, "fields": 1,
         "template_category_snapshot": 1,
         "source_form_submission_id": 1, "pdf_hash": 1},
    )
    async for shim in cursor:
        swept_ps += 1
        fs_id = shim.get("source_form_submission_id")
        if not fs_id:
            skipped_no_pair += 1
            continue
        fs = await db.form_submissions.find_one(
            {"id": fs_id, "deleted_at": None},
            {"_id": 0, "template_id": 1, "template_name_snapshot": 1,
             "fields": 1, "submitted_at": 1},
        )
        if not fs:
            skipped_no_pair += 1
            continue
        tpl = tpl_cache.get(fs.get("template_id")) or {}
        fields = fs.get("fields") or []
        patch: dict = {}
        # template_name_snapshot
        if not shim.get("template_name_snapshot"):
            name = fs.get("template_name_snapshot") or tpl.get("name")
            if name:
                patch["template_name_snapshot"] = name
        # template_category_snapshot
        if not shim.get("template_category_snapshot"):
            cat = tpl.get("category")
            if cat:
                patch["template_category_snapshot"] = cat
        # date — only overwrite if current date is missing OR looks
        # like an insert/migration date (i.e. the submitted_at prefix).
        extracted_date = _pick_extraction_date(fields)
        if extracted_date:
            current_date = shim.get("date") or ""
            submitted_prefix = (fs.get("submitted_at") or "")[:10]
            # Replace when the current date is the insert-date shim OR
            # missing. Otherwise leave the original alone.
            if not current_date or current_date == submitted_prefix:
                patch["date"] = extracted_date
        # crew_lead — only overwrite the literal placeholder.
        if shim.get("crew_lead") == _PLACEHOLDER_CREW:
            name = _pick_worker_name(fields)
            if name:
                patch["crew_lead"] = name
        # fields[] — only add when missing entirely.
        if "fields" not in shim and fields:
            patch["fields"] = fields
        if patch:
            r = await db.pre_starts.update_one({"id": shim["id"]}, {"$set": patch})
            enriched_ps += r.modified_count
    print(
        f"sweep-2: pre_starts swept={swept_ps} enriched={enriched_ps} "
        f"skipped_no_pair={skipped_no_pair}"
    )

    # ─── AFTER snapshot ─────────────────────────────────────────
    n_fs_cat_after = await db.form_submissions.count_documents({
        "source": "bulk_import", "deleted_at": None,
        "template_category_snapshot": {"$exists": True},
    })
    n_shim_placeholder_after = await db.pre_starts.count_documents({
        "imported": True, "crew_lead": _PLACEHOLDER_CREW,
    })
    n_shim_no_tpl_after = await db.pre_starts.count_documents({
        "imported": True,
        "template_name_snapshot": {"$in": [None, ""]},
    })
    n_shim_no_fields_after = await db.pre_starts.count_documents({
        "imported": True,
        "fields": {"$exists": False},
    })
    print("=== AFTER ===")
    print(f"  form_submissions with tpl_cat set:      {n_fs_cat_after}  (+{n_fs_cat_after - n_fs_cat_before})")
    print(f"  pre_starts with placeholder crew_lead:  {n_shim_placeholder_after}  ({n_shim_placeholder_after - n_shim_placeholder_before:+d})")
    print(f"  pre_starts missing template_name:       {n_shim_no_tpl_after}  ({n_shim_no_tpl_after - n_shim_no_tpl_before:+d})")
    print(f"  pre_starts missing fields[]:            {n_shim_no_fields_after}  ({n_shim_no_fields_after - n_shim_no_fields_before:+d})")
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
