"""Drag-drop PDF import endpoint.

v160.3.0-adjust-19 — Turns the batch-import CLI from adjust-14 into a
proper self-serve feature. Admin drops PDFs into the modal, backend
matches them against `form_templates`, extracts fields via the shared
`extract_fields_from_parsed` helper, and inserts one `form_submissions`
row per PDF flagged as `imported: true, source: "user_import"`.

Idempotency: content-hash + filename check against existing imports.
Duplicate uploads return 409 with the existing submission id — never a
new duplicate row.
"""
from __future__ import annotations
import hashlib
import logging
import os
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


def _match_template(pdf_title_norm: str, templates: list[dict]) -> dict | None:
    """Match extracted PDF title against `form_templates.name` using
    word-overlap on discriminative tokens (mirrors the batch importer's
    logic). Returns the best template or None."""
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

    # Idempotency — same filename or same content hash for this org.
    existing = await db.form_submissions.find_one(
        {"org_id": org_id, "imported": True, "deleted_at": None,
         "$or": [{"imported_from_pdf": filename}, {"import_sha256": sha}]},
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

        matched = _match_template(title_norm, templates)
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
            "deep_parsed": True,
            "deep_parsed_at": now,
            "deep_parse_stats": {"populated": populated, "total": len(matched.get("fields") or []),
                                 "method": "adjust-19-drop"},
            "source": "user_import",
        }
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
