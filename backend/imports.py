"""Drag-drop PDF import endpoint.

v160.3.0-adjust-19 — Turns the batch-import CLI from adjust-14 into a
proper self-serve feature. Admin drops PDFs into the modal, backend
matches them against `form_templates`, extracts fields via the shared
`extract_fields_from_parsed` helper, and inserts one `form_submissions`
row per PDF flagged as `imported: true, source: "user_import"`.

Idempotency: content fingerprint (sha256 + size + first-512-byte
sha256) against existing imports. Filename plays no role in the
DEDUPE key — an admin can rename a duplicate PDF and it's still
detected. Duplicate uploads return 409 with the existing submission
id — never a new duplicate row.

v58.13.132hn — Filename-first template matchers. Four filename
patterns Stephen surfaced as "Unmatched template" get a regex-first
lookup BEFORE the token-overlap logic:

  · "drain cleaning ssra"  → template "Drain Cleaning SSRA"
  · "trailer pre-start"    → template "Trailer Pre-start"
  · "excavation permit"    → template "Excavation / Trench Permit"
  · "excavator pre-start"  → template "Excavator Pre-start"

The three missing templates (Drain Cleaning SSRA, Trailer Pre-start,
Excavator Pre-start) are seeded idempotently on startup by cloning
the field-set from a sibling template (Viatec SSRA / Tip Truck /
Plant Pre-Start Heavy respectively) and stamping a new name +
description.
"""
from __future__ import annotations
import hashlib
import logging
import os
import re
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from auth import get_current_user
from db import db
from form_routing import resolve_template_category  # v58.13.132dz

# Import parser from the scripts package.
sys.path.insert(0, str(Path(__file__).parent / "scripts"))
from deep_parse_legacy_pdfs import (  # noqa: E402
    parse_pdf, extract_fields_from_parsed, _norm,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/imports", tags=["imports"])

MAX_BYTES = 10 * 1024 * 1024  # 10 MB
CATEGORY_ROUTE = {
    "pre_start":       "/app/pre-starts",
    "hazard":          "/app/hazards",
    "incident":        "/app/incidents",
    "inspection":      "/app/inspections",
    "site_diary":      "/app/site-diary",
    "risk_assessment": "/app/risk-assessments",
}


# v58.13.132hn — Filename-pattern → template name. Regex tokens
# (case-insensitive) matched against the OS filename BEFORE the
# extension. First hit wins. The mapped name is looked up in
# `form_templates.name` (org-scoped) and returned as the match.
# If no template with the mapped name exists in the org, the matcher
# falls through to the existing title-token logic (safe default).
_FILENAME_MATCHERS: list[tuple[str, str]] = [
    # v58.13.132id — SSRA-family matchers FIRST so an SSRA filename
    # containing incident-family tokens (e.g. "SSRA — near miss
    # review") doesn't fall through to the incident regex below.
    # Order MATTERS: `_match_by_filename` returns on first hit.
    (r"drain[\s_-]*cleaning[\s_-]*ssra",           "Drain Cleaning SSRA"),
    (r"viatec[\s_-]*traffic[\s_-]*solutions[\s_-]*ssra",
                                                    "Viatec Traffic Solutions SSRA"),
    (r"construction[\s_-]*(?:and|&|\+)[\s_-]*excavation[\s_-]*ssra",
                                                    "Construction & Excavation SSRA"),
    # Catch-all SSRA — falls through to token match if the specific
    # SSRA template doesn't exist in the org.
    (r"\bssra\b|site[\s_-]*specific[\s_-]*risk[\s_-]*assessment",
                                                    "Construction & Excavation SSRA"),

    # v58.13.132id — SWMS-N canonical pattern. Currently /imports/pdf
    # only ingests form_submissions, so a matched SWMS filename lands
    # against the SWMS-shaped template if one exists. If not, the
    # matcher fires but falls through to token match (safe default)
    # — the file still shows up in the unmatched drawer with a hint.
    # Accepts SWMS-N, SWMS_N, `2026_SWMS-11_…`, and bare `SWMS 11`.
    # \b doesn't help here — `_` is a word char in Python regex, so
    # boundaries around `_SWMS_` fail. Match on explicit adjacency
    # to word start / non-alpha instead.
    (r"(?:^|[^a-z])swms[\s_\-]+\d+",                 "SWMS Document"),

    (r"trailer[\s_-]*pre[\s_-]*start",             "Trailer Pre-start"),
    (r"excavator[\s_-]*pre[\s_-]*start",           "Excavator Pre-start"),
    (r"excavation[\s_-]*(?:[/_-]*\s*trench[\s_-]*)?permit",
                                                    "Excavation / Trench Permit"),
    # v58.13.132hy — Legacy incident-report filename patterns.
    # Grep of live `form_submissions` + `doc_files` surfaced the
    # following recurring shapes (Simpro exports + SF-34 family):
    #   · "Incident Report (####) - <ts>.pdf"
    #   · "Incident Hazard Report ..." / "2025_SF-34 Incident Hazard Report ..."
    #   · "Incident_Hazard_Investigation_ICAM_Report ..."
    #   · "Near Miss Report ..." / "Near-Miss ..."
    #   · "Injury Report ..." / "Register of Injury ..."
    #   · "ICAM Report ..." (standalone)
    # Ordered from most-specific to least-specific so a Near-Miss
    # PDF isn't routed to Incident Report on the "incident" token.
    (r"near[\s_-]*miss(?:[\s_-]*report)?",         "Near Miss Report"),
    (r"icam(?:[\s_-]*report)?",                    "Incident Report"),
    (r"incident[\s_-]*(?:hazard[\s_-]*)?investigation",
                                                    "Incident Report"),
    (r"incident[\s_-]*(?:hazard[\s_-]*)?report",   "Incident Report"),
    (r"injury[\s_-]*(?:report|register)",          "Incident Report"),
    (r"register[\s_-]*of[\s_-]*injury",            "Incident Report"),
    (r"first[\s_-]*aid[\s_-]*(?:injury|report)",   "Incident Report"),
]


def _match_by_filename(filename: str | None, templates: list[dict]) -> dict | None:
    """v58.13.132hn — Regex-first filename lookup.
    Returns the matched template or None."""
    if not filename:
        return None
    # Strip directory + extension to keep the regex tokens tight.
    base = os.path.basename(filename)
    stem = os.path.splitext(base)[0].lower()
    for pattern, target_name in _FILENAME_MATCHERS:
        if re.search(pattern, stem, re.IGNORECASE):
            target_norm = _norm(target_name)
            for t in templates:
                if _norm(t.get("name") or "") == target_norm:
                    return t
            # Matcher fired but no template with that name in the org
            # — log so an operator notices the seed hook didn't run
            # or the template got renamed. Fall through to token match.
            log.warning(
                "filename matcher hit %r but no template named %r in org",
                pattern, target_name,
            )
            return None
    return None


def _match_template(pdf_title_norm: str, templates: list[dict], filename: str | None = None) -> dict | None:
    """Match extracted PDF title against `form_templates.name` using
    word-overlap on discriminative tokens (mirrors the batch importer's
    logic). Returns the best template or None.

    v58.13.132hn — Filename-pattern lookup runs FIRST. If the OS filename
    matches one of the `_FILENAME_MATCHERS` regexes AND a template with
    the mapped name exists in the org, that template is returned
    immediately (bypasses the token overlap). Otherwise falls back to
    the original title-token match — no behavioural regression for
    filenames outside the pattern list.
    """
    hit = _match_by_filename(filename, templates)
    if hit is not None:
        return hit
    if not pdf_title_norm:
        return None
    # Exact-normalised name equality first.
    for t in templates:
        if _norm(t.get("name") or "") == pdf_title_norm:
            return t
    # Word-overlap match: ≥ 3 shared tokens, or one contains the other.
    from deep_parse_legacy_pdfs import _words
    pdf_words = _words(pdf_title_norm)
    best, best_score = None, 0
    for t in templates:
        tname = _norm(t.get("name") or "")
        if not tname:
            continue
        overlap = pdf_words & _words(t.get("name") or "")
        score = 0
        if len(overlap) >= 3:
            score = 10 + len(overlap)
        elif len(overlap) >= 2 and len(pdf_words) <= 4:
            score = 6 + len(overlap)
        if tname in pdf_title_norm or pdf_title_norm in tname:
            score = max(score, 8)
        if score > best_score:
            best, best_score = t, score
    return best if best_score >= 6 else None


def _pdf_title(parsed: dict) -> str:
    """Read the first non-empty line of the PDF as the title. Simpro
    exports put the template name on the first content line (e.g.
    "Viatec Traffic Solutions - SSRA")."""
    for ln in parsed.get("raw_lines", [])[:20]:
        s = (ln or "").strip()
        if s and len(s) >= 3:
            return s
    return ""


@router.post("/pdf")
async def import_pdf(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    role = (user.get("role") or "").lower()
    if role not in {"admin", "hseq_lead"}:
        raise HTTPException(status_code=403, detail="Only admin / HSEQ lead can import PDFs")

    # File-type + size guards.
    filename = file.filename or "upload.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only .pdf files are accepted")
    data = await file.read()
    if not data or data[:5] != b"%PDF-":
        raise HTTPException(status_code=400, detail="File does not look like a PDF")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"File exceeds {MAX_BYTES // 1024 // 1024} MB limit")

    org_id = user["org_id"]
    sha = hashlib.sha256(data).hexdigest()
    # v58.13.132g0 — Duplicate detection tightening.
    #
    # Pre-.132g0 the dedupe key was `filename OR sha256`, which fired
    # false positives whenever an admin re-uploaded a genuinely new
    # PDF that happened to reuse an earlier filename (Simpro exports
    # collide on "Pre-Start.pdf" all day long). Now we use a proper
    # content fingerprint: `sha256(all)` PLUS `size` PLUS
    # `sha256(head_512)`. All three must agree for a row to count as
    # a duplicate — filename plays no role. The head-hash + size are
    # belt-and-braces against the astronomically-improbable sha256
    # collision on the full payload; they cost microseconds to
    # compute and make the audit story unambiguous.
    file_size = len(data)
    head_sha = hashlib.sha256(data[:512]).hexdigest()

    # Idempotency — proper content fingerprint match. Legacy rows
    # (pre-.132g0) carry `import_sha256` only; the sha check alone
    # is authoritative for those, so we deliberately keep the query
    # tolerant to missing size / head fields via `$in [value, null,
    # missing]` semantics: we look for a sha match FIRST, then
    # confirm size + head agree if the row carries them.
    existing = await db.form_submissions.find_one(
        {"org_id": org_id, "imported": True, "deleted_at": None,
         "import_sha256": sha,
         "$and": [
             {"$or": [{"import_file_size": file_size},
                      {"import_file_size": {"$exists": False}}]},
             {"$or": [{"import_head_sha256": head_sha},
                      {"import_head_sha256": {"$exists": False}}]},
         ]},
        {"_id": 0, "id": 1, "template_id": 1, "template_name_snapshot": 1},
    )
    if existing:
        raise HTTPException(status_code=409, detail={
            "message": "Already imported",
            "submission_id": existing["id"],
            "template_name": existing.get("template_name_snapshot"),
        })

    # Persist temporarily, parse, then discard.
    with tempfile.NamedTemporaryFile(prefix="import_", suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        try:
            parsed = parse_pdf(tmp_path)
        except Exception as e:
            log.exception("parse_pdf failed for %s: %s", filename, e)
            raise HTTPException(status_code=500, detail="Could not parse the PDF")

        title = _pdf_title(parsed)
        title_norm = _norm(title)

        templates = await db.form_templates.find(
            {"org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1, "name": 1, "category": 1, "fields": 1, "source": 1},
        ).to_list(500)

        matched = _match_template(title_norm, templates, filename=filename)
        if not matched:
            raise HTTPException(status_code=422, detail={
                "message": "Could not match this PDF to a known template.",
                "pdf_title": title,
            })

        fields_out, populated = extract_fields_from_parsed(
            parsed, matched.get("fields") or [], matched["id"]
        )
        now = datetime.now(timezone.utc).isoformat()
        sub_id = str(uuid.uuid4())
        submission = {
            "id": sub_id,
            "org_id": org_id,
            "template_id": matched["id"],
            "template_name_snapshot": matched.get("name"),
            # v58.13.132dz — Route category via `form_routing_rules`
            # first, then fall back to the template's declared
            # `category`. Same choke-point as `forms.py`.
            "template_category_snapshot": await resolve_template_category(matched),
            "fields": fields_out,
            "submitted_by_name": parsed["meta"].get("respondent") or "",
            "submitted_at": now,
            "created_at": now,
            "created_by": user["id"],
            "deleted_at": None,
            "imported": True,
            "imported_from_pdf": filename,
            "imported_at": now,
            "imported_by": user["id"],
            "import_sha256": sha,
            # v58.13.132g0 — content-fingerprint fields for
            # duplicate detection tightening.
            "import_file_size": file_size,
            "import_head_sha256": head_sha,
            "deep_parsed": True,
            "deep_parsed_at": now,
            "deep_parse_stats": {"populated": populated, "total": len(matched.get("fields") or []),
                                 "method": "adjust-19-drop"},
            "source": "user_import",
        }
        # v58.13.132ik — Extract raster images out of the legacy PDF
        # BEFORE we insert the submission doc, so the very first read
        # already carries the `evidence_photos` array. Best-effort:
        # a PyMuPDF failure on a corrupt PDF must NEVER block the
        # import (the text fields are the primary audit artefact).
        try:
            from pdf_photo_extractor import extract_and_persist
            evidence = await extract_and_persist(
                sub_id, data, org_id=org_id,
            )
            if evidence:
                submission["evidence_photos"] = evidence
                submission["evidence_photos_count"] = len(evidence)
                submission["deep_parse_stats"]["evidence_photos"] = len(evidence)
        except Exception as e:
            log.warning("evidence-photo extraction failed for %s: %s",
                        filename, e)
        await db.form_submissions.insert_one(submission)
    finally:
        try: os.unlink(tmp_path)
        except Exception: pass

    return {
        "status": "imported",
        "filename": filename,
        "submission_id": sub_id,
        "template_id": matched["id"],
        "template_name": matched.get("name"),
        "template_category": matched.get("category"),
        "target_route": CATEGORY_ROUTE.get(matched.get("category")) or "/app/forms",
        "fields_extracted": populated,
        "fields_total": len(matched.get("fields") or []),
        # v58.13.132ik — Client uses this to render a "N evidence
        # photos preserved" toast on the post-import redirect.
        "evidence_photos_count": submission.get("evidence_photos_count", 0),
    }


@router.get("/history")
async def import_history(
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    """Recent user imports — used for a future admin audit page."""
    org_id = user["org_id"]
    cursor = db.form_submissions.find(
        {"org_id": org_id, "imported": True, "source": "user_import",
         "deleted_at": None},
        {"_id": 0, "id": 1, "template_name_snapshot": 1,
         "template_category_snapshot": 1, "imported_from_pdf": 1,
         "imported_at": 1, "imported_by": 1,
         "deep_parse_stats": 1},
    ).sort("imported_at", -1).limit(limit)
    return await cursor.to_list(limit)


# ─────────────────────────────────────────────────────────────
# v58.13.132hn — Startup seeder for filename-matcher targets.
# ─────────────────────────────────────────────────────────────

# Each entry: target_name → (clone_from_name, category_override).
# `category_override=None` inherits from the clone source.
_SEED_TARGETS: list[tuple[str, str, str | None, str]] = [
    (
        "Drain Cleaning SSRA",
        "Viatec Traffic Solutions SSRA",
        "hazard",
        "Site Specific Risk Assessment for drain cleaning works.",
    ),
    (
        "Trailer Pre-start",
        "Tip Truck Daily Pre-Start",
        "pre_start",
        "Pre-operational daily check for trailers and towed plant.",
    ),
    (
        "Excavator Pre-start",
        "Plant Pre-Start Checklist (Heavy Equipment)",
        "pre_start",
        "Pre-operational daily check for excavators.",
    ),
    # v58.13.132hy — Incident Report legacy target for filename
    # matcher fallback. Cloned from any existing incident-category
    # template in the org (via `_seed_fallback_by_category`) so
    # orgs that already carry a canonical incident template get a
    # working target automatically. `Incident Report Form` is a
    # known sibling in some tenants; the fallback resolver picks
    # the shortest-named incident-category template as the source.
    (
        "Incident Report",
        "Incident Report Form",
        "incident",
        "Legacy Simpro incident report (Incident, Near-Miss, ICAM, Injury).",
    ),
    (
        "Near Miss Report",
        "Incident Report Form",
        "near_miss",
        "Legacy Simpro near-miss report.",
    ),
]


# v58.13.132hy — Fallback clone source resolver. When the named
# `clone_from` template is not present in the org, look for any
# template whose category matches the seed's category override.
# Returns the shortest-named match (so we prefer the canonical
# "Incident Report" over "Test Hot Work Permit" when both are
# `category=incident`). Missing → None (seed row skipped, same
# posture as before).
async def _seed_fallback_by_category(
    org_id: str, category: str | None, ignore_name: str,
) -> dict | None:
    if not category:
        return None
    rows = await db.form_templates.find(
        {"org_id": org_id, "deleted_at": None, "category": category,
         "name": {"$ne": ignore_name}},
        {"_id": 0},
    ).to_list(50)
    if not rows:
        return None
    rows.sort(key=lambda r: (len(r.get("name") or ""), (r.get("name") or "").lower()))
    return rows[0]


async def seed_import_matcher_templates_on_startup() -> None:
    """Idempotent seeder — creates the three missing templates keyed
    by `_FILENAME_MATCHERS` if they don't already exist for each
    org that has the CLONE-FROM sibling template. Runs on FastAPI
    startup. Silently skips orgs where the clone source itself is
    missing (a fresh tenant might not have the sibling; that's OK,
    it just means the filename matcher won't fire until an admin
    imports a canonical Viatec SSRA / Tip Truck / Plant Pre-Start
    once).
    """
    # Distinct orgs holding at least one form_template. Cheap query.
    org_ids: list[str] = await db.form_templates.distinct("org_id")
    for org_id in org_ids:
        # Pull the org's live template names once for the existence check.
        existing_names = {
            _norm(row["name"]) for row in await db.form_templates.find(
                {"org_id": org_id, "deleted_at": None},
                {"_id": 0, "name": 1},
            ).to_list(1000)
            if row.get("name")
        }
        for target_name, clone_from, category_override, description in _SEED_TARGETS:
            if _norm(target_name) in existing_names:
                continue
            source = await db.form_templates.find_one(
                {"org_id": org_id, "deleted_at": None,
                 "name": {"$regex": f"^{re.escape(clone_from)}$", "$options": "i"}},
                {"_id": 0},
            )
            if not source:
                # v58.13.132hy — Category fallback. Try any template
                # matching the seed's category override before giving
                # up. Lets the Incident Report seed fire in orgs that
                # already carry a different-named incident template.
                source = await _seed_fallback_by_category(
                    org_id, category_override, ignore_name=target_name,
                )
            if not source:
                log.info(
                    "seed: org=%s missing clone source %r — skipping %r",
                    org_id, clone_from, target_name,
                )
                continue
            now_iso = datetime.now(timezone.utc).isoformat()
            new_doc = {
                **{k: v for k, v in source.items() if k not in
                   {"id", "created_at", "updated_at", "deleted_at",
                    "created_by", "updated_by"}},
                "id": str(uuid.uuid4()),
                "name": target_name,
                "description": description,
                "category": category_override or source.get("category"),
                "created_at": now_iso,
                "updated_at": now_iso,
                "deleted_at": None,
                "source": "seed_v58_13_132hn",
            }
            try:
                await db.form_templates.insert_one(new_doc)
                log.info(
                    "seed: org=%s created template %r (cloned from %r)",
                    org_id, target_name, clone_from,
                )
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "seed: failed to insert %r for org=%s: %s",
                    target_name, org_id, e,
                )

