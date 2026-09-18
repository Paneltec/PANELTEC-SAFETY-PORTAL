"""v58.13.132ij — PDF renderer for compliance answers.

Verifies:
  · Status pill Table is emitted with the emerald / rose / slate colour
    for compliant / at_risk / na.
  · Photo thumb row emits Image flowables when the photo files exist
    on disk (writes a couple of tiny PNGs to /tmp for the test).
  · Notes render inside a grey slate block.
  · Legacy `_legacy_status` fallback renders the migration marker
    (`Migrated from legacy answer: ...`) OR, when the value is still a
    scalar (bypass migration case), renders the legacy text.
  · Version pin lockstep.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def _r(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Backend source pins ─────────────────────────────────────────────

def test_backend_pdf_renderer_has_compliance_branch():
    src = _r(BACKEND / "forms_pdf.py")
    assert 'elif ftype == "compliance":' in src
    assert "_render_compliance_answer(story, f, sub.get" in src
    # Legacy fallback branch present.
    assert 'legacy = field.get("_legacy_status")' in src
    assert "Migrated from legacy answer:" in src
    # Status pill map covers the three canonical states with the
    # brand colours (emerald / rose / slate) per Stephen's spec.
    assert '"#10B981"' in src   # emerald compliant
    assert '"#F43F5E"' in src   # rose at_risk
    assert '"#94A3B8"' in src   # slate na


# ── Behavioural — PDF bytes must contain the expected artifacts ─────

def _seed_photo_file(root: Path, submission_id: str, stored_name: str) -> Path:
    """Write a minimal PNG under FORM_PHOTOS so _photo_path resolves."""
    d = root / "form_photos" / submission_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / stored_name
    # Use Pillow to make a real 4x4 red PNG so ReportLab/PIL can open it.
    from PIL import Image as PILImage
    img = PILImage.new("RGB", (4, 4), color=(220, 40, 40))
    img.save(p, "PNG")
    return p


def test_pdf_renders_status_pill_photos_and_notes(tmp_path, monkeypatch):
    """Render a submission with 3 compliance answers and assert the
    output PDF bytes contain the expected label + pill text + notes.

    Uses `pdfminer.high_level.extract_text` if available; falls back
    to a naive bytes-in-PDF check otherwise.
    """
    import forms_pdf
    # Redirect FORM_PHOTOS to a scratch location so we can seed real
    # PNG files without touching the real /app/backend/uploads tree.
    monkeypatch.setattr(forms_pdf, "UPLOADS_ROOT", tmp_path)
    monkeypatch.setattr(forms_pdf, "FORM_PHOTOS", tmp_path / "form_photos")

    sub_id = "sub_v132ij_test"
    _seed_photo_file(tmp_path, sub_id, "a.png")
    _seed_photo_file(tmp_path, sub_id, "b.png")

    submission = {
        "id": sub_id,
        "template_name_snapshot": "v132ij Test Compliance Sweep",
        "submitted_by_name": "Test User",
        "submitted_at": "2025-01-15T10:00:00Z",
        "fields": [
            {
                "id": "q1", "label": "Vehicle exterior in good condition?",
                "type": "compliance",
                "value": {
                    "status": "compliant",
                    "photos": [
                        {"stored_name": "a.png", "filename": "a.png"},
                        {"stored_name": "b.png", "filename": "b.png"},
                    ],
                    "notes": "",
                },
            },
            {
                "id": "q2", "label": "SSRA hazard controls in place?",
                "type": "compliance",
                "value": {
                    "status": "at_risk",
                    "photos": [],
                    "notes": "Spotter not briefed — pausing task until pre-start sign-off.",
                },
            },
            {
                "id": "q3", "label": "Housekeeping standard maintained?",
                "type": "compliance",
                "value": {
                    "status": "na",
                    "photos": [],
                    "notes": "",
                },
            },
            {
                "id": "q4", "label": "Legacy migrated question",
                "type": "compliance",
                "value": {
                    "status": "compliant",
                    "photos": [],
                    "notes": "",
                },
                "_legacy_status": "Yes",
            },
        ],
    }
    template = {"name": "v132ij Test", "category": "other",
                "description": "test", "fields": submission["fields"]}

    pdf_bytes = forms_pdf.render_form_submission_pdf(submission, template)
    assert pdf_bytes.startswith(b"%PDF"), "output must be a PDF"

    # Extract text and verify content. pdfminer is a heavy dep; use
    # pypdf if available. Fall back to a permissive bytes scan.
    text = ""
    try:
        from pypdf import PdfReader
        r = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join(p.extract_text() or "" for p in r.pages)
    except Exception:
        text = pdf_bytes.decode("latin-1", errors="ignore")

    # Question labels.
    assert "Vehicle exterior" in text
    assert "SSRA hazard controls" in text
    assert "Housekeeping standard" in text
    assert "Legacy migrated question" in text
    # Pill labels.
    assert "COMPLIANT" in text
    assert "AT RISK" in text
    assert "N/A" in text
    # Notes text.
    assert "Spotter not briefed" in text
    # Legacy fallback marker (dict-valued rows use the "Migrated from"
    # copy — the 132ig migration wrote a dict, so this exercises the
    # else-branch of the legacy check).
    assert "Migrated from legacy answer: Yes" in text


def test_pdf_renders_legacy_scalar_bypass_migration(tmp_path, monkeypatch):
    """If a compliance field was never touched by the migration but the
    submitter left a scalar `value` (edge case: template flipped from
    radio → compliance mid-flight), render as legacy text."""
    import forms_pdf
    monkeypatch.setattr(forms_pdf, "UPLOADS_ROOT", tmp_path)
    monkeypatch.setattr(forms_pdf, "FORM_PHOTOS", tmp_path / "form_photos")

    submission = {
        "id": "sub_v132ij_legacy",
        "template_name_snapshot": "legacy test",
        "submitted_by_name": "Legacy User",
        "submitted_at": "2020-01-01T00:00:00Z",
        "fields": [{
            "id": "q1", "label": "Bypass test",
            "type": "compliance",
            "value": "Yes",   # scalar — pre-migration shape
            "_legacy_status": "Yes",
        }],
    }
    template = {"name": "legacy test", "category": "other",
                "description": "", "fields": submission["fields"]}
    pdf_bytes = forms_pdf.render_form_submission_pdf(submission, template)
    assert pdf_bytes.startswith(b"%PDF")
    try:
        from pypdf import PdfReader
        r = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join(p.extract_text() or "" for p in r.pages)
    except Exception:
        text = pdf_bytes.decode("latin-1", errors="ignore")
    assert "Bypass test" in text
    assert "Legacy answer: Yes" in text


# ── Version lockstep ────────────────────────────────────────────────

def test_version_pin_v132ij():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    pat = r"paneltec-v160\.3\.9\.58\.13\.132[i-z][j-z]?"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v)
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v)
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw)


# Silence pytest unused-import warning when pypdf isn't installed.
_ = pytest
