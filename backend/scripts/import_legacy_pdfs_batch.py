#!/usr/bin/env python3
"""
v160.3.0-adjust-14 — Import 162 historical PDF records from
`/tmp/form_records_batch/extracted` into `form_submissions` for the
Paneltec org.

Rules:
  * Idempotent — skips any PDF already imported (by `imported_from_pdf`).
  * source="legacy_import", imported=true, so dashboards can exclude
    them from live compliance metrics.
  * Best-effort metadata extraction (Created / Completed / Respondent
    from page-1 "Details" block). Per-answer parsing NOT attempted —
    admins open the source PDF for the original detail (stored as
    `attachments.original_pdf_path`).

Run:
    cd /app && set -a && source backend/.env && set +a && \
        python3 backend/scripts/import_legacy_pdfs_batch.py
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
BASE = "/tmp/form_records_batch/extracted"

# (filename_prefix_regex, template_name_regex, category, slug)
FAMILY_MAP = [
    (r"Viatec Traffic Utillity - Dai",         r"^Daily Pre-Start$",                            "pre_start",       "daily-pre-start"),
    (r"Combination Vacuum Truck \(CVT\)",      r"^CVT Daily Pre-Start$",                        "pre_start",       "cvt-daily-pre-start"),
    (r"Vacuum Truck \(VT\) - Daily Pre",       r"^Vacuum Truck \(VT\) Daily Pre-Start$",        "pre_start",       "vt-daily-pre-start"),
    (r"Tip Truck \(TT\) - Daily Pre",          r"^Tip Truck Daily Pre-Start$",                  "pre_start",       "tip-truck-daily-pre-start"),
    (r"Civil Utillity - Weekly Pre-Start",     r"^Weekly Pre-Start$",                           "pre_start",       "weekly-pre-start"),
    (r"Construction & Excavation - SS",        r"^Construction & Excavation SSRA$",             "hazard",          "construction-excavation-ssra"),
    (r"Viatec Traffic Solutions - SS",         r"^Viatec Traffic Solutions SSRA$",              "hazard",          "viatec-traffic-solutions-ssra"),
    (r"TTM - Risk Assessment",                 r"^TTM Risk Assessment & Treatment Register$",   "risk_assessment", "ttm-risk-assessment-treatment-register"),
    (r"VTS - Tight Site Audit",                r"^VTS Tight Site Audit$",                       "site_diary",      "vts-tight-site-audit"),
]


def now_iso() -> str: return datetime.now(timezone.utc).isoformat()
def new_id() -> str: return str(uuid.uuid4())


DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})")


def parse_dt(dmy_hms: str | None) -> str | None:
    """`02/07/2026 07:52:42` → `2026-07-02T07:52:42+00:00`. UTC assumed."""
    if not dmy_hms: return None
    m = DATE_RE.search(dmy_hms)
    if not m: return None
    try:
        d = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%d/%m/%Y %H:%M:%S")
        return d.replace(tzinfo=timezone.utc).isoformat()
    except Exception:
        return None


def extract_meta(pdf_path: str) -> dict:
    """Extract Created/Completed/Respondent from page-1 Details block."""
    r = subprocess.run(["pdftotext", "-l", "1", "-layout", pdf_path, "-"],
                       capture_output=True, timeout=15)
    txt = r.stdout.decode("utf-8", errors="replace")
    meta = {"created_at_raw": None, "completed_at_raw": None,
            "respondent": None, "business_unit": None}
    for ln in txt.splitlines():
        s = ln.strip()
        if s.startswith("Created at"):
            meta["created_at_raw"] = s.replace("Created at", "").strip()
        elif s.startswith("Completed at"):
            meta["completed_at_raw"] = s.replace("Completed at", "").strip()
        elif s.startswith("Respondent"):
            meta["respondent"] = s.replace("Respondent", "").strip()
        elif s.startswith("Business unit"):
            meta["business_unit"] = s.replace("Business unit", "").strip()
    meta["created_at"] = parse_dt(meta["created_at_raw"])
    meta["completed_at"] = parse_dt(meta["completed_at_raw"])
    return meta


def find_family(filename: str):
    for prefix_re, tpl_re, cat, slug in FAMILY_MAP:
        if re.search(prefix_re, filename):
            return tpl_re, cat, slug
    return None


async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: env not set", file=sys.stderr); return 2
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Resolve template ids for Paneltec org
    templates = {}
    for _, tpl_re, cat, slug in FAMILY_MAP:
        t = await db.form_templates.find_one(
            {"org_id": ORG_ID, "deleted_at": None,
             "name": {"$regex": tpl_re, "$options": "i"}},
            {"_id": 0, "id": 1, "name": 1, "category": 1},
        )
        if not t:
            print(f"WARN: template not found for slug={slug} regex={tpl_re}")
            continue
        templates[slug] = t

    # Collect PDFs
    pdfs = []
    for root, _, files in os.walk(BASE):
        for f in files:
            if f.lower().endswith(".pdf"):
                pdfs.append(os.path.join(root, f))
    pdfs.sort()
    print(f"Found {len(pdfs)} PDFs to consider.")

    from collections import Counter
    per_family = Counter()
    per_family_new = Counter()
    per_family_skipped = Counter()
    failed = []

    for p in pdfs:
        fn = os.path.basename(p)
        rel = os.path.relpath(p, BASE)
        fam = find_family(fn)
        if not fam:
            failed.append((rel, "no family match")); continue
        tpl_re, cat, slug = fam
        per_family[slug] += 1
        tpl = templates.get(slug)
        if not tpl:
            failed.append((rel, f"template not seeded for slug={slug}")); continue

        # Idempotency
        existing = await db.form_submissions.find_one(
            {"org_id": ORG_ID, "imported_from_pdf": rel}, {"_id": 0, "id": 1},
        )
        if existing:
            per_family_skipped[slug] += 1
            continue

        try:
            meta = extract_meta(p)
        except Exception as e:
            failed.append((rel, f"extract error: {e}")); continue

        created_at = meta.get("created_at") or now_iso()
        completed_at = meta.get("completed_at") or created_at

        doc = {
            "id": new_id(),
            "org_id": ORG_ID,
            "template_id": tpl["id"],
            "template_slug_snapshot": slug,
            "template_name_snapshot": tpl["name"],
            "template_category_snapshot": cat,
            "source": "legacy_import",
            "imported": True,
            "imported_from_pdf": rel,
            "imported_at": now_iso(),
            "created_by": None,
            "created_at": created_at,
            "submitted_at": completed_at,
            "submitted_by_name": meta.get("respondent"),
            "business_unit_snapshot": meta.get("business_unit"),
            "workspace_id": None,
            "date": (created_at or "")[:10] or None,
            "fields": [],
            "attachments": {"original_pdf_path": rel},
            "deleted_at": None,
        }
        await db.form_submissions.insert_one(doc)
        per_family_new[slug] += 1

    print("\n=== Import summary (per template family) ===")
    print(f'{"slug":<44s} {"total_pdfs":>10s} {"new":>6s} {"skipped":>8s}')
    for _, _, _, slug in FAMILY_MAP:
        print(f"{slug:<44s} {per_family[slug]:>10d} {per_family_new[slug]:>6d} {per_family_skipped[slug]:>8d}")
    print(f'{"─" * 72}')
    print(f'{"TOTAL":<44s} {sum(per_family.values()):>10d} {sum(per_family_new.values()):>6d} {sum(per_family_skipped.values()):>8d}')
    if failed:
        print(f"\nFailed: {len(failed)}")
        for rel, why in failed:
            print(f"  - {rel} :: {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
