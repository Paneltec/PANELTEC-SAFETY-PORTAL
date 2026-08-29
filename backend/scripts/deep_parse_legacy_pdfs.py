#!/usr/bin/env python3
"""
v160.3.0-adjust-15 → adjust-16f — Deep-parse the 162 legacy-imported
PDFs and populate `form_submissions.fields[]` with extracted values.

Universal parser — every PDF in the batch follows the same layout:
  * "Details" block at top of page 1 with Created/Completed/Respondent
  * "Vehicle Details" / site block with metadata
  * Numbered inspection items:  `N. Label ..... value` (value at ~col 54)

Approach:
  1. `pdftotext -layout` full document.
  2. Regex-scan for numbered items `^\\s*(\\d+)\\.\\s+(.+?)\\s{2,}(.+)$`.
  3. Normalise the raw value against a shared dictionary.
  4. Fuzzy-match the numbered label against the template's field labels
     (word-overlap on discriminative tokens).
  5. Also extract: date, respondent, GPS `(-lat, lng)`.
  6. Layer per-family alias tables (adjust-16f) —
     `parsers/ssra_aliases.py` maps template field ids to the various
     ways the same information is phrased in Simpro PDF exports.
  7. Update the corresponding `form_submissions` doc's `fields` array —
     keyed by the template field's `id`. Idempotent.

Run:
    cd /app && set -a && source backend/.env && set +a && \\
        python3 backend/scripts/deep_parse_legacy_pdfs.py
"""
from __future__ import annotations
import os
import sys
# Make `parsers` package importable regardless of how this script is
# invoked (`python3 backend/scripts/deep_parse_legacy_pdfs.py` from /app
# vs `python3 deep_parse_legacy_pdfs.py` from the scripts dir).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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
    """Return {'meta': {…}, 'items': [(n, label, value), …],
    'pairs': [(label, value), …], 'raw_lines': [str, …],
    'bullets': {section: [item_text, …]}}.

    v160.3.0-adjust-16b changes:
      * Removed the "orphan short line → I confirm" continuation heuristic
        that polluted the pair list (was assigning "pumps"→"I confirm" and
        cascading spurious fuzzy matches).
      * Accumulate raw lines so downstream template-driven extraction can
        do column-aware label lookups + multi-line value accretion.
      * Detect ALL-CAPS section headers ("TAILGATE MEETING",
        "DOCUMENT CHECK", "SITE SPECIFIC RISK ASSESMENT", …) and collect
        right-column bullet items indented under them — used by the SSRA
        family to answer `TAILGATE — Discuss X` style multi-select fields.
    """
    r = subprocess.run(["pdftotext", "-layout", pdf_path, "-"],
                       capture_output=True, timeout=30)
    txt = r.stdout.decode("utf-8", errors="replace")
    lines = txt.splitlines()
    meta: dict = {}
    items = []
    pairs: list[tuple[str, str]] = []
    bullets: dict[str, list[str]] = {}
    current_section: str | None = None
    gps = None
    respondent = None
    date_str = None

    for ln in lines:
        s = ln.rstrip()
        stripped = s.strip()

        # ── Metadata ──
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

        # ── Section header detection ──
        # ALL-CAPS lines with ≥8 chars and no digits — the SSRA / VTS PDFs
        # use these as section dividers (TAILGATE MEETING, DOCUMENT CHECK,
        # SITE SPECIFIC RISK ASSESMENT, EMERGENCY & FIRST AID, …).
        if (stripped and stripped == stripped.upper() and
                len(stripped) >= 8 and len(stripped) <= 80 and
                not any(ch.isdigit() for ch in stripped) and
                re.match(r"^[A-Z0-9 \-&()/,'.]+$", stripped)):
            current_section = stripped
            bullets.setdefault(current_section, [])
            continue

        # ── Numbered inspection items (pre-starts) ──
        m = NUM_ITEM_RE.match(s)
        if m:
            n, label, val = m.group(1), m.group(2).strip(), m.group(3).strip()
            if val.lower() in ("of 2", "of 3", "of 4", "of 5", "of 6", "of 7", "of 8"):
                continue
            items.append((n, label, val))
            continue

        # ── Noise skip ──
        if not stripped or re.match(r"^\d+ of \d+$", stripped):
            continue

        # ── Label → value pair (left col + ≥2 spaces + right col) ──
        parts = BLANK_MULTIPLE_SPACES_RE.split(stripped, maxsplit=1)
        if len(parts) == 2 and len(parts[0]) > 12 and len(parts[1]) > 0:
            lbl, val = parts[0].strip(), parts[1].strip()
            if val.lower() not in ("no data",) and len(val) < 500:
                pairs.append((lbl, val))
            continue

        # ── Right-column bullet under a section header ──
        # Indented single-column line (>= 40 chars indent OR any indented
        # line inside a known section) — collect as a bullet item.
        leading = len(s) - len(s.lstrip())
        if current_section and stripped and leading >= 40 and len(stripped) <= 160:
            bullets[current_section].append(stripped)
            continue

    if respondent: meta["respondent"] = respondent
    if date_str:
        try:
            d = datetime.strptime(date_str, "%d/%m/%Y")
            meta["date"] = d.strftime("%Y-%m-%d")
        except: pass
    if gps: meta["gps"] = gps

    # v160.3.0-adjust-16b — Merge multi-line pair labels. When the
    # pdftotext left column wraps ("Please Select the Rest of your
    # Traffic Management" / "Team from the List Below:"), consecutive
    # pairs are actually ONE field. Rebuild by concatenating the label
    # AND the values whenever the previous label ends without
    # terminating punctuation.
    merged_pairs: list[tuple[str, str]] = []
    for lbl, val in pairs:
        lbl_stripped = lbl.rstrip()
        if merged_pairs and merged_pairs[-1][0].rstrip() and \
           not merged_pairs[-1][0].rstrip()[-1] in ":?.":
            prev_lbl, prev_val = merged_pairs[-1]
            merged_pairs[-1] = (
                f"{prev_lbl} {lbl_stripped}".strip(),
                f"{prev_val}, {val}".strip(", "),
            )
        else:
            merged_pairs.append((lbl_stripped, val))

    # v160.3.0-adjust-16b — Promote right-column bullets of any pair whose
    # LEFT column matches a section-header anchor into the `bullets` map
    # for that section. This captures TAILGATE items that ended up as
    # pair values (`Please Assemble Today's Team … → Discuss The Scope
    # of Works`) rather than pure right-column indented lines.
    ANCHOR_HINTS = {
        "TAILGATE MEETING": ("assemble", "tailgate", "check each box"),
        "SITE SPECIFIC RISK ASSESMENT (SSRA) COMPONENT": ("ppe","personal protective"),
        "DOCUMENT CHECK - SWMS, PERMITS & PRE-STARTS": ("swms onsite","copy of the below","applicable swms"),
    }
    for lbl, val in merged_pairs:
        low = lbl.lower()
        for sec, hints in ANCHOR_HINTS.items():
            if any(h in low for h in hints):
                bullets.setdefault(sec, [])
                # Split multi-value strings by comma (from the merge step)
                for piece in re.split(r"\s*,\s*", val):
                    piece = piece.strip()
                    if piece and piece not in bullets[sec]:
                        bullets[sec].append(piece)

    return {"meta": meta, "items": items, "pairs": merged_pairs,
            "raw_lines": lines, "bullets": bullets, "text": txt}


def _norm(s: str) -> str:
    """Aggressive normalisation for fuzzy matching (letters+digits only)."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _words(s: str) -> set[str]:
    """Extract discriminative words (≥ 4 chars, lower, no punctuation).
    Used for word-overlap fuzzy matching between template field labels
    and PDF text — more robust than substring matching when labels are
    line-wrapped or paraphrased."""
    STOP = {
        "the","and","for","are","from","have","been","this","that","with",
        "your","onto","onsite","above","below","when","what","list","been",
        "into","also","made","site","team","name","date","time","upon",
        "please","enter","select","check","confirm","today","complete",
        "completed","using","used","other","note","state","details",
    }
    toks = re.findall(r"[A-Za-z][A-Za-z0-9]{3,}", (s or "").lower())
    return {t for t in toks if t not in STOP}


def _core_label(flabel: str) -> str:
    """Strip TAILGATE-style section prefixes and (parenthetical) guidance
    to extract the discriminative core of a template field label."""
    core = flabel
    if "—" in core:
        before, _, after = core.partition("—")
        before, after = before.strip(), after.strip()
        if before and before.upper() == before and len(before) <= 24 and after:
            core = after
        else:
            core = before or after
    core = re.sub(r"\s*\([^)]*\)\s*", " ", core)
    return core.strip(" :?.,")


def fuzzy_match_field(label: str, template_fields: list[dict]) -> dict | None:
    """Word-overlap fuzzy match between a PDF label and template fields.

    v160.3.0-adjust-16b: replaces the old prefix-substring matcher (which
    collided `Site Contact Name` with `Site Contact Phone Number`) with a
    discriminative-word count. Requires:
      * ≥ 3 shared meaningful words, OR
      * Full containment of the shorter normalised core (≥ 12 chars).
    """
    key_norm = _norm(label)
    key_words = _words(label)
    if len(key_norm) < 6 and len(key_words) < 2:
        return None
    best = None
    best_score = 0
    for f in template_fields:
        flabel = f.get("label") or ""
        core = _core_label(flabel)
        fkey_norm = _norm(core)
        fkey_words = _words(core)
        if not fkey_norm:
            continue
        # Exact core equality
        if fkey_norm == key_norm:
            return f
        overlap = key_words & fkey_words
        score = 0
        # Word-overlap
        if len(overlap) >= 3:
            score = 10 + len(overlap)
        elif len(overlap) >= 2 and (len(fkey_words) <= 3 or len(key_words) <= 3):
            score = 6 + len(overlap)
        # Substring containment (guarded by minimum length)
        shorter = min(len(fkey_norm), len(key_norm))
        if shorter >= 14:
            long_n, short_n = (key_norm, fkey_norm) if len(key_norm) >= len(fkey_norm) else (fkey_norm, key_norm)
            if short_n in long_n:
                score = max(score, 8 + shorter // 4)
        if score > best_score:
            best, best_score = f, score
    return best if best_score >= 6 else None


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
    fields_out, populated = extract_fields_from_parsed(
        parsed, template_fields, sub.get("template_id")
    )

    now = datetime.now(timezone.utc).isoformat()
    await db.form_submissions.update_one(
        {"id": sub["id"]},
        {"$set": {"fields": fields_out,
                  "submitted_by_name": parsed["meta"].get("respondent") or sub.get("submitted_by_name"),
                  "deep_parsed": True,
                  "deep_parsed_at": now,
                  "deep_parse_stats": {"populated": populated, "total": len(template_fields),
                                      "method": "adjust-16f"}}},
    )
    return populated, len(template_fields)


def extract_fields_from_parsed(parsed: dict, template_fields: list, tpl_id: str | None) -> tuple[list, int]:
    """v160.3.0-adjust-19 — Pure-function extractor callable from the
    drag-drop `POST /api/imports/pdf` endpoint. Given the output of
    `parse_pdf()` + a template's field list, returns (fields_out,
    populated_count) with the same rules as the batch orchestrator.

    Idempotent, no DB writes; caller decides where to persist.
    """
    meta_resp = parsed["meta"].get("respondent")
    all_bullets = [b for arr in parsed.get("bullets", {}).values() for b in arr]
    fields_out: list = []
    populated = 0
    worker_picker_prefilled = False

    try:
        from parsers.ssra_aliases import get_aliases as _get_aliases
    except Exception:
        def _get_aliases(_tid, _fid):
            return []

    def _meta_date_from_header() -> str | None:
        for ln in parsed.get("raw_lines", [])[:40]:
            m = re.search(r"(Created at|Completed at|Last modified)\s+(\d{2}/\d{2}/\d{4})", ln)
            if m:
                try:
                    d = datetime.strptime(m.group(2), "%d/%m/%Y")
                    return d.strftime("%Y-%m-%d")
                except Exception:
                    pass
        return None

    def _looks_like_garbage(s) -> bool:
        if not isinstance(s, str):
            return False
        low = s.lower().strip()
        if low.startswith("signature:") or low.startswith("date:"):
            return True
        if re.match(r"^\d+\s*of\s*\d+$", low):
            return True
        return False

    def _multiline_after(label_text: str) -> str | None:
        needle = _norm(label_text)
        if len(needle) < 6:
            return None
        lines = parsed.get("raw_lines", [])
        n = len(lines)
        for i, s in enumerate(lines):
            if not s.strip():
                continue
            parts = BLANK_MULTIPLE_SPACES_RE.split(s.strip(), maxsplit=1)
            if len(parts) != 2:
                continue
            lbl_norm = _norm(parts[0])
            if not (needle in lbl_norm or (len(needle) >= 16 and lbl_norm[:16] in needle)):
                continue
            m = re.search(r"\S {2,}(\S)", s)
            if not m:
                continue
            right_col = s.index(m.group(1), m.start())
            acc = [parts[1].strip()]
            for j in range(i + 1, min(i + 8, n)):
                nx = lines[j]
                if not nx.strip():
                    break
                nleft = nx[:right_col] if len(nx) >= right_col else nx
                if nleft.strip():
                    break
                cont = nx[right_col:].strip() if len(nx) >= right_col else nx.strip()
                if not cont:
                    break
                acc.append(cont)
            value = " ".join(x for x in acc if x)
            return value or None
        return None

    for f in template_fields:
        ftype = f.get("type")
        flabel = (f.get("label") or "").lower()
        raw_flabel = f.get("label") or ""
        v = None

        if ftype == "date" and (parsed["meta"].get("date") or _meta_date_from_header()):
            v = parsed["meta"].get("date") or _meta_date_from_header()
        elif ftype == "worker_picker" and meta_resp and not worker_picker_prefilled and any(
            k in flabel for k in ("operator", "auditor", "assessor", "team leader")
        ):
            v = [{"worker_id": None, "name": meta_resp, "company_label": None}]
            worker_picker_prefilled = True
        elif ftype == "gps" and parsed["meta"].get("gps"):
            v = {**parsed["meta"]["gps"], "address": None, "accuracy": None}

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

        if v is None and ftype in ("text", "textarea", "select", "number", "radio"):
            candidates = [_core_label(raw_flabel), *_get_aliases(tpl_id, f["id"])]
            for cand in candidates:
                grabbed = _multiline_after(cand)
                if grabbed:
                    v = normalise_value(grabbed, raw_flabel)
                    if ftype == "number" and isinstance(v, str):
                        m = re.search(r"[\d,]+", v)
                        if m:
                            try: v = int(m.group().replace(",", ""))
                            except: pass
                    break

        if v is None and ftype in ("radio", "select") and "—" in raw_flabel:
            before, _, after = raw_flabel.partition("—")
            section_prefix = before.strip().upper()
            item = _core_label(raw_flabel)
            item_key = _norm(item)
            if item_key and len(item_key) >= 8:
                candidate_lists = []
                for sec, arr in parsed.get("bullets", {}).items():
                    if section_prefix and section_prefix.split()[0] in sec:
                        candidate_lists.append(arr)
                if not candidate_lists:
                    candidate_lists = [all_bullets]
                found = False
                for arr in candidate_lists:
                    for b in arr:
                        bkey = _norm(b)
                        if item_key in bkey or bkey in item_key:
                            found = True
                            break
                    if found:
                        break
                if found:
                    opts = f.get("options") or []
                    v = opts[0] if opts else "I confirm"

        if v is None and ftype in ("radio", "text", "textarea", "select", "number"):
            alias_probes = [f] + [
                {"id": f["id"], "label": a, "type": ftype, "options": f.get("options")}
                for a in _get_aliases(tpl_id, f["id"])
            ]
            for lbl_pdf, val_pdf in parsed.get("pairs", []):
                matched = False
                for probe in alias_probes:
                    if fuzzy_match_field(lbl_pdf, [probe]):
                        matched = True
                        break
                if matched:
                    v = normalise_value(val_pdf, lbl_pdf)
                    if ftype == "number" and isinstance(v, str):
                        m = re.search(r"[\d,]+", v)
                        if m:
                            try: v = int(m.group().replace(",", ""))
                            except: pass
                    break

        entry = {"field_id": f["id"], "value": v, "label": f.get("label"), "type": ftype}
        if _looks_like_garbage(v):
            entry["value"] = None
            v = None
        if v is not None and v != "" and v != []:
            populated += 1
        fields_out.append(entry)

    return fields_out, populated


# --- LEGACY inline extract path (kept temporarily for backward-compat) ---
async def _process_submission_LEGACY_INLINE(db, sub, tpl_by_id: dict) -> tuple[int, int]:
    """Deprecated: kept only if an external script pins this exact name.
    New code should call `extract_fields_from_parsed` directly."""
    return await process_submission(db, sub, tpl_by_id)
    # v58.13.65 — Post-return dead block removed (was ~215 lines
    # referencing `parsed` and `template_fields` from the pre-refactor
    # inline implementation). The unconditional delegation above is
    # the entire live behaviour of this back-compat shim.


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
