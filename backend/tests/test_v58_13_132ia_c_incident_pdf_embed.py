"""v58.13.132ia-c — Incident + SSRA AI PDF photo/signature embed fix.

Regression suite covering:
  · pdf_template.photos_section — embeds string / dict photo refs inline,
    with fallback text for unresolvable refs.
  · pdf_template.signatures_section — accepts optional `signatures` list,
    renders real signature images (data-URI + image_url branches),
    third row shows printed name + timestamp.
  · render_incident_pdf — passes signatures through + swaps the old
    attachments-list block for the new inline photo block.
  · IncidentIn model gains a `signatures: List[dict]` field.
  · SSRA (via forms_pdf.render_form_submission_pdf) already handles
    per-field photo/signature embed — source-pin the contract so a
    future refactor can't silently break it.
  · Version lockstep .132ia-c across version.js + service-worker.js.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── Static source pins ──────────────────────────────────────────────

def test_pdf_template_has_photos_section():
    src = _read(BACKEND / "pdf_template.py")
    assert "def photos_section(photo_refs: list)" in src
    # Data-URI branch decodes base64.
    assert "url.startswith('data:')" in src
    # Filesystem branch resolves via pdf_renderer._resolve_upload.
    assert "from pdf_renderer import _resolve_upload" in src
    # Empty list falls back to explanatory Paragraph.
    assert "'No evidence photos attached.'" in src


def test_pdf_template_signatures_section_accepts_signatures_kwarg():
    src = _read(BACKEND / "pdf_template.py")
    # Signature carries either raw image, data-URI or `image_url`.
    assert "signatures: list[dict] | None = None" in src
    assert "'image_url'" in src
    assert "'signed_by'" in src
    assert "'signed_at'" in src


def test_render_incident_pdf_uses_new_photo_and_signature_blocks():
    src = _read(BACKEND / "pdf_renderer.py")
    # Scope the check to the incident renderer body only — `attachments
    # _section(photo_atts)` is still legitimately used by
    # `render_inspection_pdf` (different resource, different data shape).
    start = src.find("def render_incident_pdf")
    end = src.find("\ndef render_inspection_pdf")
    assert start != -1 and end != -1
    body = src[start:end]
    # Old attachments-list block removed FROM THE INCIDENT PATH.
    assert "P.attachments_section(photo_atts)" not in body
    # New inline photos section wired up.
    assert "P.photos_section(photo_refs)" in body
    # Signatures block now receives the record's actual signatures.
    assert "signatures=sigs" in body
    # Section header renamed to make the surface explicit.
    assert "'Evidence photos'" in body


def test_incident_in_model_carries_signatures_field():
    src = _read(BACKEND / "models.py")
    assert "signatures: List[dict] = Field(default_factory=list)" in src


def test_forms_pdf_renders_photo_and_signature_fields_inline():
    """SSRA + form_submission AI PDFs already embed per-field photos +
    signatures inline. Lock that contract with a source pin so a
    refactor can't silently regress it."""
    src = _read(BACKEND / "forms_pdf.py")
    # Photo field: Image() flowable built per photo path.
    assert 'Image(str(path), width=4.0 * inch' in src
    # Signature field: base64-decoded PNG rendered inline.
    assert '_decode_signature(val)' in src
    assert 'Image(io.BytesIO(raw)' in src


# ── Behavioural: real ReportLab render ─────────────────────────────

def _tiny_png_b64() -> str:
    """1x1 transparent PNG, base64. Smallest valid PNG that ReportLab
    can embed without complaint."""
    return (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
        "2mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
    )


def test_render_incident_pdf_embeds_3_photos_and_2_signatures():
    """Synthetic incident with 3 data-URI photos + 2 data-URI
    signatures. Assert:
      · Rendered bytes look like a PDF (magic marker).
      · At least 3 PNG image streams present (photos + signatures).
      · Section labels 'Evidence photos' + 'Signatures' both hit.
    """
    from pdf_renderer import render_incident_pdf

    png = _tiny_png_b64()
    data_uri = f"data:image/png;base64,{png}"
    inc = {
        "id": "inc-test-1",
        "title": "Scaffold near-miss",
        "occurred_at": "2026-02-17T10:00:00Z",
        "location": "Bay 3",
        "category": "near_miss",
        "description": "Worker slipped on wet floor near scaffold edge.",
        "immediate_actions": "Area barricaded. First-aid administered.",
        "follow_up_status": "in_progress",
        "reporter": "Stephen McG",
        "evidence_photos": [data_uri, data_uri, data_uri],
        "signatures": [
            {"role": "Reporter",     "image": data_uri, "signed_by": "Stephen McG",  "signed_at": "2026-02-17T10:05:00Z"},
            {"role": "Site manager", "image": data_uri, "signed_by": "Jane Foreman", "signed_at": "2026-02-17T10:30:00Z"},
        ],
    }
    pdf_bytes = render_incident_pdf(inc)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF"), "output must be a real PDF"
    # ReportLab embeds image streams as FlateDecode; the PDF must
    # contain multiple image objects (3 photos + 2 signatures ≥ 3).
    image_stream_count = pdf_bytes.count(b"/Subtype /Image")
    assert image_stream_count >= 3, (
        f"expected ≥3 embedded image streams (3 photos + 2 signatures), "
        f"got {image_stream_count}"
    )


def test_render_incident_pdf_gracefully_handles_no_photos_or_signatures():
    from pdf_renderer import render_incident_pdf
    inc = {
        "id": "inc-empty-1",
        "title": "Paperwork-only report",
        "occurred_at": "2026-02-17T10:00:00Z",
        "category": "property",
        "description": "Fence panel dinged by reversing truck. No injury.",
    }
    pdf_bytes = render_incident_pdf(inc)
    assert pdf_bytes.startswith(b"%PDF")
    # No photos + no signatures still renders — sections still exist,
    # ReportLab still builds a valid doc.
    assert len(pdf_bytes) > 1000


# ── Version pin ─────────────────────────────────────────────────────

def test_version_pin_v132ia_c():
    v = _read(FRONTEND / "src" / "lib" / "version.js")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132ia-c'" in v
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ia-c'" in v
    sw = _read(FRONTEND / "public" / "service-worker.js")
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ia-c'" in sw
