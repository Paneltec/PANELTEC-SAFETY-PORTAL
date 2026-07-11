#!/usr/bin/env python3
"""
v160.3.0-adjust-15 — Deep-parse the 162 legacy-imported PDFs and
populate `form_submissions.fields[]` with extracted values.

Universal parser — every PDF in the batch follows the same layout:
  * "Details" block at top of page 1 with Created/Completed/Respondent
  * "Vehicle Details" / site block with metadata
  * Numbered inspection items:  `N. Label ..... value` (value at ~col 54)

Approach:
  1. `pdftotext -layout` full document.
  2. Regex-scan for numbered items `^\s*(\d+)\.\s+(.+?)\s{2,}(.+)$`.
  3. Normalise the raw value against a shared dictionary.
  4. Fuzzy-match the numbered label against the template's field labels
     (case-insensitive, first 20 chars, punctuation stripped).
  5. Also extract: date, respondent, GPS `(-lat, lng)`.
  6. Update the corresponding `form_submissions` doc's `fields` array —
     keyed by the template field's `id`. Idempotent.

Photo/signature extraction is deferred (needs per-family layout
heuristics — best attempted in a follow-up).

Run:
    cd /app && set -a && source backend/.env && set +a && \
        python3 backend/scripts/deep_parse_legacy_pdfs.py
"""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
BASE = "/tmp/form_records_batch/extracted"


NORMALISE = {
    "ok": "Pass",
    "on board": "Pass",
    "all working": "Pass",
    "all working & ok": "Pass",
    "working & no wear and tear": "Pass",
    "clean": "Pass",
    "drained & satisfactory": "Pass",
    "appears ok": "Pass",
    "appears to be ok": "Pass",
    "yes": "Yes",           # kept as Yes for compliance questions
    "no": "No",
    "n/a": "N/A",
    "not applicable": "N/A",
    "not checked today": "N/A",
    "fault": "Fail",
    "not ok": "Fail",
    "missing": "Fail",
    "dirty": "Fail",
    "fail": "Fail",
    "pass": "Pass",
}

# Radios in the seeded templates that expect Pass/Fail/N-A — for these
# we map "Yes" → "Pass" (legacy Simpro exports used Yes/No for what our
# templates model as Pass/Fail).
PASS_FAIL_LABELS_HINT = (
    "glass", "tyre", "panel", "sign", "fire ext", "under cab",
    "under bonnet", "seat belt", "globe", "alarm", "dashboard",
    "clean", "swt", "vacuum system", "jet", "hose", "air tank",
    "fluid", "guard", "compliance",
)

GPS_RE = re.compile(r"\(\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\)")
NUM_ITEM_RE = re.compile(r"^\s*(\d+)\.\s+(.+?)\s{2,}(.+?)\s*$")
DATE_RE = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
BLANK_MULTIPLE_SPACES_RE = re.compile(r"\s{2,}")


def normalise_label(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())[:24]


def normalise_value(raw: str, label: str) -> str:
    key = raw.strip().lower()
    if key in NORMALISE:
        v = NORMALISE[key]
        # If this looks like a Pass/Fail radio (per label heuristics) and
        # the legacy value was "Yes" or "No", map Yes→Pass, No→Fail.
        low = label.lower()
        if any(h in low for h in PASS_FAIL_LABELS_HINT):
            if v == "Yes": return "Pass"
            if v == "No":  return "Fail"
        return v
    # Numbers (odometer, hours)
    m = re.match(r"^[\d,]+(\.\d+)?$", key.replace(" km", "").replace("km", "").strip())
    if m:
        return int(re.sub(r"[^\d]", "", key) or 0) if "." not in key else float(re.sub(r"[^\d.]", "", key))
    # Long free-text or address — keep as-is
    return raw.strip()


def parse_pdf(pdf_path: str) -> dict:
    """Return {'meta': {…}, 'items': [(label_key, value), …], 'pairs': [(label, value), …]}."""
    r = subprocess.run(["pdftotext", "-layout", pdf_path, "-"],
                       capture_output=True, timeout=30)
    txt = r.stdout.decode("utf-8", errors="replace")
    lines = txt.splitlines()
    meta: dict = {}
    items = []
    pairs: list[tuple[str, str]] = []  # (label, value) — SSRA-style rows
    gps = None
    respondent = None
    date_str = None

    # v160.3.0-adjust-16 — Also accumulate label→value pairs from lines
    # that DON'T match the numbered `N. Label ..... Value` pattern. SSRA
    # PDFs use section-based layouts: `Question label ...  Answer` split
    # at column ~55. We keep the numbered-item pass (pre-starts) AND
    # collect all 2+-space-separated pairs (SSRAs, TTM, VTS Tight Site).
    prev_label: str | None = None
    for i, ln in enumerate(lines):
        s = ln.rstrip()
        # metadata line hits
        if "Please Select your Name from the List below:" in s:
            parts = BLANK_MULTIPLE_SPACES_RE.split(s.strip(), maxsplit=1)
            if len(parts) == 2:
                respondent = parts[1].strip()
        elif "Please Select the Employee Completing this SSRA" in s or "Please Select the Employee Completing this Site" in s:
            parts = BLANK_MULTIPLE_SPACES_RE.split(s.strip(), maxsplit=1)
            if len(parts) == 2:
                respondent = parts[1].strip()
        elif s.lstrip().startswith("Date ") and not s.lstrip().startswith("Date -"):
            parts = BLANK_MULTIPLE_SPACES_RE.split(s.strip(), maxsplit=1)
            if len(parts) == 2 and DATE_RE.search(parts[1]):
                date_str = DATE_RE.search(parts[1]).group(1)
        elif s.startswith("Respondent"):
            resp = s.replace("Respondent", "").strip()
            if resp and not respondent:
                respondent = resp

        gm = GPS_RE.search(s)
        if gm and not gps:
            gps = {"lat": float(gm.group(1)), "lng": float(gm.group(2))}

        m = NUM_ITEM_RE.match(s)
        if m:
            n, label, val = m.group(1), m.group(2).strip(), m.group(3).strip()
            if val.lower() in ("of 2", "of 3", "of 4", "of 5", "of 6", "of 7", "of 8"):
                continue
            items.append((n, label, val))
            continue

        # Generic label→value pair (SSRA style). Skip footers / headers /
        # page-count noise.
        stripped = s.strip()
        if not stripped or "of " in stripped and re.match(r"^\d+ of \d+$", stripped):
            continue
        # Match a wide left column of text followed by ≥2 spaces then value.
        parts = BLANK_MULTIPLE_SPACES_RE.split(stripped, maxsplit=1)
        if len(parts) == 2 and len(parts[0]) > 12 and len(parts[1]) > 0:
            lbl, val = parts[0].strip(), parts[1].strip()
            # Filter numeric noise like "1 of 3" already handled; also
            # skip obvious template labels ending with punctuation-only
            # values (rare) and page-header repeats.
            if val.lower() not in ("no data",) and len(val) < 240:
                pairs.append((lbl, val))
                prev_label = lbl
        elif prev_label and stripped and len(stripped) < 90 and not stripped.endswith(":"):
            # Continuation of a checklist column (Tailgate items etc.).
            # Attach the item as a fresh pair keyed on itself so the
            # SSRA-style `_confirm` fields (TAILGATE — Discuss the …)
            # find a match.
            pairs.append((stripped, "I confirm"))

    if respondent: meta["respondent"] = respondent
    if date_str:
        try:
            d = datetime.strptime(date_str, "%d/%m/%Y")
            meta["date"] = d.strftime("%Y-%m-%d")
        except: pass
    if gps: meta["gps"] = gps
    return {"meta": meta, "items": items, "pairs": pairs}


def fuzzy_match_field(label: str, template_fields: list[dict]) -> dict | None:
    """Return the closest template field for a label."""
    key = normalise_label(label)
    if not key:
        return None
    for f in template_fields:
        flabel = f.get("label") or ""
        # Strip guidance suffixes and TAILGATE/PPE prefixes so the core
        # label ("Discuss The Scope of Works" vs "TAILGATE — Discuss The
        # Scope of Works") matches.
        core = flabel.split("—")[-1].split("(")[0]
        fkey = normalise_label(core)
        if not fkey:
            continue
        # bidirectional startswith on 12-char normalised keys
        if fkey.startswith(key[:14]) or key.startswith(fkey[:14]):
            return f
        # tolerant substring match on longer keys (SSRAs, TTM, VTS)
        if len(key) > 18 and len(fkey) > 18 and (key[:18] in fkey or fkey[:18] in key):
            return f
    return None


async def process_submission(db, sub, tpl_by_id: dict) -> tuple[int, int]:
    """Returns (fields_populated, fields_total_on_template)."""
    tpl = tpl_by_id.get(sub["template_id"])
    if not tpl:
        return 0, 0
    template_fields = tpl["fields"]
    pdf_rel = sub.get("imported_from_pdf")
    if not pdf_rel:
        return 0, len(template_fields)
    pdf_abs = os.path.join(BASE, pdf_rel)
    if not os.path.exists(pdf_abs):
        return 0, len(template_fields)

    parsed = parse_pdf(pdf_abs)
    meta_resp = parsed["meta"].get("respondent")
    fields_out = []
    populated = 0

    # ── 1. Standard Header prefill ──
    for f in template_fields:
        ftype = f.get("type")
        flabel = (f.get("label") or "").lower()
        v = None

        if ftype == "date" and parsed["meta"].get("date"):
            v = parsed["meta"]["date"]
        elif ftype == "worker_picker" and meta_resp and any(
            k in flabel for k in ("operator", "auditor", "assessor", "team leader", "name")
        ):
            v = [{"worker_id": None, "name": meta_resp, "company_label": None}]
        elif ftype == "gps" and parsed["meta"].get("gps"):
            v = {**parsed["meta"]["gps"], "address": None, "accuracy": None}

        # ── 2. Numbered inspection item match (pre-starts) ──
        if v is None and ftype in ("radio", "number", "text"):
            for _, item_label, item_val in parsed["items"]:
                if fuzzy_match_field(item_label, [f]):
                    v = normalise_value(item_val, item_label)
                    if ftype == "number" and isinstance(v, str):
                        m = re.search(r"[\d,]+", v)
                        if m:
                            try: v = int(m.group().replace(",", ""))
                            except: pass
                    break

        # ── 3. v160.3.0-adjust-16 — SSRA-style label→value pair match ──
        # Falls through to the pair-scan when the numbered-item pass
        # produced nothing. Handles TAILGATE checkboxes, PPE lists,
        # BYDA/TGS/customer text fields, Y/N risk questions, etc.
        if v is None and ftype in ("radio", "text", "textarea", "select", "number"):
            for lbl_pdf, val_pdf in parsed.get("pairs", []):
                if fuzzy_match_field(lbl_pdf, [f]):
                    v = normalise_value(val_pdf, lbl_pdf)
                    if ftype == "number" and isinstance(v, str):
                        m = re.search(r"[\d,]+", v)
                        if m:
                            try: v = int(m.group().replace(",", ""))
                            except: pass
                    # For radio fields, coerce the value against the
                    # template's own option list — if the extracted
                    # answer isn't in options, leave as raw string so
                    # nothing gets silently dropped.
                    if ftype == "radio":
                        opts = [o.lower() for o in (f.get("options") or [])]
                        if isinstance(v, str) and v.lower() not in opts:
                            # Best-effort mapping for Yes/No radios that
                            # got "N/A" or free-text values.
                            pass
                    break

        entry = {
            "field_id": f["id"],
            "value": v,
            # Passthrough for legacy display:
            "label": f.get("label"),
            "type": ftype,
        }
        if v is not None and v != "" and v != []:
            populated += 1
        fields_out.append(entry)

    now = datetime.now(timezone.utc).isoformat()
    await db.form_submissions.update_one(
        {"id": sub["id"]},
        {"$set": {"fields": fields_out,
                  "submitted_by_name": parsed["meta"].get("respondent") or sub.get("submitted_by_name"),
                  "deep_parsed": True,
                  "deep_parsed_at": now,
                  "deep_parse_stats": {"populated": populated, "total": len(template_fields)}}},
    )
    return populated, len(template_fields)


async def main() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    tpl_by_id: dict = {}
    async for t in db.form_templates.find(
        {"org_id": ORG_ID, "source": "paneltec", "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "fields": 1, "category": 1},
    ):
        tpl_by_id[t["id"]] = t

    subs = []
    async for s in db.form_submissions.find(
        {"org_id": ORG_ID, "imported": True, "deleted_at": None},
        {"_id": 0, "id": 1, "template_id": 1, "template_name_snapshot": 1,
         "imported_from_pdf": 1, "submitted_by_name": 1},
    ):
        subs.append(s)

    print(f"Deep-parsing {len(subs)} imported submissions …")
    per_family: dict = defaultdict(lambda: {"n": 0, "populated": 0, "total": 0})
    failed: list = []

    for i, sub in enumerate(subs):
        fam = sub.get("template_name_snapshot") or "unknown"
        try:
            p, t = await process_submission(db, sub, tpl_by_id)
            per_family[fam]["n"] += 1
            per_family[fam]["populated"] += p
            per_family[fam]["total"] += t
        except Exception as e:
            failed.append((sub.get("imported_from_pdf"), f"{type(e).__name__}: {e}"))
            # Still count it toward the family so totals reconcile
            per_family[fam]["n"] += 1
        if (i + 1) % 20 == 0:
            print(f"  … {i+1}/{len(subs)}")

    print("\n=== Deep-parse summary (per template family) ===")
    print(f"{'family':<44s} {'records':>8s} {'fields_populated':>18s} {'fields_expected':>17s} {'rate':>7s}")
    total_pop = 0; total_ex = 0
    for fam, r in sorted(per_family.items(), key=lambda kv: -kv[1]["n"]):
        rate = (100.0 * r["populated"] / max(1, r["total"]))
        print(f"{fam:<44s} {r['n']:>8d} {r['populated']:>18d} {r['total']:>17d} {rate:>6.1f}%")
        total_pop += r["populated"]; total_ex += r["total"]
    print(f"{'─'*100}")
    rate = (100.0 * total_pop / max(1, total_ex))
    print(f"{'TOTAL':<44s} {sum(x['n'] for x in per_family.values()):>8d} {total_pop:>18d} {total_ex:>17d} {rate:>6.1f}%")
    if failed:
        print(f"\nFailed: {len(failed)}")
        for pdf, why in failed[:10]:
            print(f"  - {pdf} :: {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
