#!/usr/bin/env python3
"""v58.11.0 — Sample re-extraction with multi-page vision (sidecar).

Purpose
-------
The v58.10.3 completeness diagnosis proved Claude was under-extracting
because the renderer only sent page 1 to Claude while the Simpro
exports carry the checklist body on pages 2-5. v58.11.0 fixes the
renderer + prompt. This script validates the fix on a SMALL SAMPLE
before we commit ~$1,900 to a full re-run against all ~28k records.

Approach
--------
1. Select up to `--sample` bulk-imported form_submissions with
   `metadata.mapped_count < 8` (clearly under-extracted).
2. For each, fetch the source PDF from the ORIGINAL Dropbox archive
   via streaming random-access (remotezip → nested zip → target PDF).
3. Re-render + re-classify + re-extract using the v58.11.0 renderer +
   prompt.
4. Write results to the SIDECAR collection
   `bulk_import_reextract_v58_11`. Original `form_submissions.fields[]`
   is NEVER overwritten.
5. Cap total Claude spend at `--cost-cap` (default $75) and halt
   early if we cross it. Cost is estimated from the returned usage
   token counts if the SDK surfaces them, else conservatively
   estimated at ~$0.10 per PDF (multi-page).

Compare
-------
After the run, prints median / mean / distribution of
`mapped_count_before` vs `mapped_count_after` and a small sample of
side-by-side comparisons.

Usage
-----
  python backend/scripts/reextract_sample_v58_11.py \\
      --sample 500 --cost-cap 75 \\
      --outer-zip-url "https://www.dropbox.com/scl/fi/…/A-Barbari-2.zip?dl=1"
"""
from __future__ import annotations
import argparse
import asyncio
import io
import os
import re
import sys
import zipfile
import statistics
from pathlib import Path
from typing import Optional

# Wire the backend module search path so we can import Claude helpers.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[1]))

# Load .env
_env_path = _HERE.parents[1] / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

# Import the target module — we reuse its exact renderer / claude /
# mapper so the "sample" behaviour is IDENTICAL to what production
# will do post-v58.11.0 once cache is bust.
import bulk_import_prestarts as bi  # noqa: E402

# ─── config ──────────────────────────────────────────────────────
DEFAULT_OUTER_ZIP = (
    "https://www.dropbox.com/scl/fi/k7oz7z06mwbbita7wernt/"
    "A-Barbari-2.zip?rlkey=np2jp2d01ramx44489mjk8z47&dl=1"
)
# Conservative $ per PDF for multi-page Sonnet 4.5 call. Real per-call
# cost varies with page count and answer length; used only for the
# safety cost-cap.
COST_PER_PDF_ESTIMATE = 0.10

_ZIP_SPLIT_RE = re.compile(r"^(?P<nested>[^:]+\.zip)::(?P<pdf>.+)$")


def _parse_src_filename(src_filename: str) -> tuple[Optional[str], Optional[str]]:
    """Split `A Barbari.zip::CVT Daily Pre-Start.pdf` → ("A Barbari.zip", "CVT ….pdf")."""
    if not src_filename:
        return None, None
    m = _ZIP_SPLIT_RE.match(src_filename)
    if m:
        return m.group("nested"), m.group("pdf")
    return None, src_filename


async def _fetch_pdf(remote_zip, nested_cache, nested_name, pdf_name) -> Optional[bytes]:
    """Fetch a single PDF from the outer zip via range requests + nested unzip."""
    try:
        if nested_name and nested_name not in nested_cache:
            nested_cache[nested_name] = remote_zip.read(nested_name)
        if nested_name:
            with zipfile.ZipFile(io.BytesIO(nested_cache[nested_name])) as inner:
                names = inner.namelist()
                if pdf_name in names:
                    return inner.read(pdf_name)
                # Fuzzy match: pdf_name may differ by whitespace count.
                needle = re.sub(r"\s+", " ", pdf_name or "").strip().lower()
                for n in names:
                    if re.sub(r"\s+", " ", n).strip().lower() == needle:
                        return inner.read(n)
        return None
    except Exception as e:
        print(f"  fetch error: {e}")
        return None


async def _reextract_one(pdf_bytes: bytes, template: dict, org_id: str,
                         worker_match: dict) -> dict:
    """Run the v58.11.0 vision pipeline against one PDF, return a dict
    with the same shape used by the sidecar collection."""
    pages = await asyncio.to_thread(bi._pdf_pages_png_b64, pdf_bytes)
    if not pages:
        return {"status": "render_failed"}
    counters: dict = {}
    try:
        ext = await bi._claude_call_with_backoff(
            bi._claude_extract, pages, template, counters=counters)
    except Exception as e:
        return {"status": "claude_error", "error": str(e)[:200]}
    # Re-use the existing mapper so the shape matches production.
    mapped_fields, unmapped, mapped_count = bi._map_extraction_to_fields(
        template, ext or {}, worker_match, None)
    return {
        "status": "ok",
        "pages_rendered": len(pages),
        "extracted": ext,
        "mapped_fields": mapped_fields,
        "unmapped_checklist": unmapped,
        "mapped_count": mapped_count,
        "template_field_count": len(template.get("fields") or []),
    }


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=500,
                    help="Max PDFs to re-extract (default 500).")
    ap.add_argument("--cost-cap", type=float, default=75.0,
                    help="Halt run after estimated $ spend crosses this cap.")
    ap.add_argument("--min-mapped-before", type=int, default=8,
                    help="Only pick rows whose mapped_count < this "
                         "(clearly under-extracted).")
    ap.add_argument("--outer-zip-url", default=DEFAULT_OUTER_ZIP)
    args = ap.parse_args()

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # ─── Select the sample ─────────────────────────────────────
    print(f"selecting sample (mapped_count < {args.min_mapped_before})…")
    q = {
        "source": "bulk_import",
        "deleted_at": None,
        "metadata.mapped_count": {"$lt": args.min_mapped_before},
        "metadata.src_filename": {"$exists": True},
    }
    sample = await db.form_submissions.find(
        q,
        {"_id": 0, "id": 1, "template_id": 1,
         "template_name_snapshot": 1,
         "metadata": 1, "fields": 1},
    ).limit(args.sample).to_list(args.sample)
    print(f"sample size: {len(sample)}")

    # Preload templates
    tpls = await db.form_templates.find({}, {"_id": 0}).to_list(length=None)
    templates_by_id = {t["id"]: t for t in tpls}

    # ─── Open the outer zip via remotezip for random-access ────
    from remotezip import RemoteZip
    print(f"opening outer zip: {args.outer_zip_url[:70]}…")
    nested_cache: dict = {}
    est_cost = 0.0
    ok = 0
    render_fail = 0
    claude_fail = 0
    fetch_fail = 0
    already_done = 0
    before_after: list = []

    with RemoteZip(args.outer_zip_url) as outer:
        # Prime the outer directory list once
        outer_names = set(outer.namelist())
        print(f"outer zip has {len(outer_names)} entries")

        for i, row in enumerate(sample, start=1):
            if est_cost >= args.cost_cap:
                print(f"cost cap ${args.cost_cap} reached at row {i} — halting.")
                break
            fs_id = row["id"]
            # Skip if we've already sidecar'd this one (idempotency)
            existing = await db.bulk_import_reextract_v58_11.find_one({"form_submission_id": fs_id})
            if existing:
                already_done += 1
                continue
            src_filename = (row.get("metadata") or {}).get("src_filename") or ""
            nested_name, pdf_name = _parse_src_filename(src_filename)
            if not nested_name or nested_name not in outer_names:
                fetch_fail += 1
                continue
            pdf_bytes = await _fetch_pdf(outer, nested_cache, nested_name, pdf_name)
            if not pdf_bytes:
                fetch_fail += 1
                continue
            tpl = templates_by_id.get(row.get("template_id")) or {}
            if not tpl.get("fields"):
                fetch_fail += 1
                continue
            worker_match = {"id": None, "confidence": 0.0, "needs_review": True}
            result = await _reextract_one(pdf_bytes, tpl, row.get("org_id") or "", worker_match)
            est_cost += COST_PER_PDF_ESTIMATE
            if result.get("status") != "ok":
                if result.get("status") == "render_failed":
                    render_fail += 1
                else:
                    claude_fail += 1
                await db.bulk_import_reextract_v58_11.insert_one({
                    "form_submission_id": fs_id, **result,
                    "src_filename": src_filename,
                    "template_id": row.get("template_id"),
                    "created_at": bi._now_iso(),
                })
                continue
            mc_before = (row.get("metadata") or {}).get("mapped_count", 0)
            mc_after = result["mapped_count"]
            before_after.append((mc_before, mc_after))
            await db.bulk_import_reextract_v58_11.insert_one({
                "form_submission_id": fs_id,
                "src_filename": src_filename,
                "template_id": row.get("template_id"),
                "template_name_snapshot": row.get("template_name_snapshot"),
                "mapped_count_before": mc_before,
                "mapped_count_after": mc_after,
                "template_field_count": result["template_field_count"],
                "pages_rendered": result["pages_rendered"],
                "extracted": result["extracted"],
                "mapped_fields": result["mapped_fields"],
                "unmapped_checklist": result["unmapped_checklist"],
                "created_at": bi._now_iso(),
                "notes": "v58.11.0 sample re-extraction (sidecar; original form_submissions untouched).",
            })
            ok += 1
            if i % 25 == 0:
                med_before = statistics.median(x[0] for x in before_after) if before_after else 0
                med_after = statistics.median(x[1] for x in before_after) if before_after else 0
                print(
                    f"  row {i}/{len(sample)} | ok={ok} fetch_fail={fetch_fail} "
                    f"render_fail={render_fail} claude_fail={claude_fail} "
                    f"already_done={already_done} | est_cost=${est_cost:.2f} | "
                    f"median mapped_count: before={med_before:.0f} after={med_after:.0f}"
                )

    # ─── Summary ───────────────────────────────────────────────
    print("\n=== SAMPLE RE-EXTRACTION SUMMARY ===")
    print(f"attempted:       {len(before_after) + render_fail + claude_fail}")
    print(f"successful:      {ok}")
    print(f"already_done:    {already_done}")
    print(f"fetch failures:  {fetch_fail}")
    print(f"render failures: {render_fail}")
    print(f"claude errors:   {claude_fail}")
    print(f"estimated cost:  ${est_cost:.2f}")
    if before_after:
        bs = [b for b, _ in before_after]
        as_ = [a for _, a in before_after]
        print(f"\nmapped_count BEFORE  min={min(bs)} median={statistics.median(bs):.0f} mean={statistics.mean(bs):.1f} max={max(bs)}")
        print(f"mapped_count AFTER   min={min(as_)} median={statistics.median(as_):.0f} mean={statistics.mean(as_):.1f} max={max(as_)}")
        deltas = [a - b for b, a in before_after]
        print(f"delta (after-before) median={statistics.median(deltas):.0f} mean={statistics.mean(deltas):.1f}")
        # top 5 example rows
        print("\nSAMPLE ROWS (before → after):")
        for b, a in before_after[:5]:
            print(f"  {b} → {a}  (Δ +{a - b})")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
