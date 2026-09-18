"""v58.13.132ik — Photos in imported PDFs.

Verifies:
  · `pdf_photo_extractor.extract_pdf_photos` pulls raster images out
    of a PDF, deduplicates by xref, and skips tiny UI-chrome images.
  · `pdf_photo_extractor.persist_pdf_photos` writes each blob to
    GridFS (`uploads_storage.save_upload`) and returns the
    `evidence_photos` dicts in the shape the FE + PDF renderer
    already know how to display.
  · `imports.import_pdf` wires the extractor + persist call into the
    /imports/pdf flow — stamps `evidence_photos` + `evidence_photos_count`
    onto the submission doc BEFORE insert.
  · `forms_pdf.render_form_submission_pdf` emits an "Extracted evidence
    photos" tail section listing the persisted photos as a thumbnail
    grid.
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

def test_pdf_photo_extractor_module_exists_with_public_api():
    src = _r(BACKEND / "pdf_photo_extractor.py")
    assert "def extract_pdf_photos(" in src
    assert "async def persist_pdf_photos(" in src
    assert "async def extract_and_persist(" in src
    # Skips tiny chrome via min_pixels + dedupes by xref.
    assert "min_pixels" in src
    assert "seen_xrefs" in src
    # CMYK → sRGB conversion so downstream thumbnails render.
    assert "fitz.csRGB" in src
    # form_photos subdir → shares plumbing with `photo` field uploads.
    assert '"form_photos"' in src
    # Source marker so downstream code can distinguish extracted vs
    # user-uploaded photos.
    assert '"source": "imported_pdf"' in src


def test_imports_pdf_wires_evidence_photos():
    src = _r(BACKEND / "imports.py")
    # extract_and_persist called before insert_one so the submission
    # carries the evidence array on first read.
    idx_extract = src.find("from pdf_photo_extractor import extract_and_persist")
    idx_insert = src.find("await db.form_submissions.insert_one(submission)")
    assert 0 < idx_extract < idx_insert, "extract must precede insert"
    # Stamps both the array + the count on the submission doc.
    assert 'submission["evidence_photos"] = evidence' in src
    assert 'submission["evidence_photos_count"] = len(evidence)' in src
    # Extraction failure never blocks the import.
    assert 'log.warning("evidence-photo extraction failed for %s: %s"' in src
    # Response payload advertises the count.
    assert '"evidence_photos_count":' in src


def test_forms_pdf_renders_evidence_photo_tail_section():
    src = _r(BACKEND / "forms_pdf.py")
    assert 'evidence = sub.get("evidence_photos") or []' in src
    assert 'Extracted evidence photos' in src
    assert '"Photos pulled from the original imported PDF' in src
    # Same 4-wide grid shape as the compliance widget photo row so
    # the layouts stay visually consistent.
    assert 'thumb_w = 1.5 * inch' in src
    assert 'colWidths=[thumb_w + 0.05 * inch] * 4' in src


# ── Behavioural — extract images from a synthetic PDF ──────────────

def _make_pdf_with_image() -> bytes:
    """Compose a 1-page PDF with an embedded coloured image using
    ReportLab (already a runtime dep). Returns the PDF bytes."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    from PIL import Image as PILImage
    # Two distinct images so we can assert dedupe by xref works.
    img_red = PILImage.new("RGB", (240, 200), color=(240, 40, 40))
    img_blue = PILImage.new("RGB", (300, 240), color=(20, 60, 200))
    tmp_red = io.BytesIO(); img_red.save(tmp_red, "PNG"); tmp_red.seek(0)
    tmp_blue = io.BytesIO(); img_blue.save(tmp_blue, "PNG"); tmp_blue.seek(0)

    from reportlab.lib.utils import ImageReader
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 12)
    c.drawString(72, 750, "v132ik synthetic PDF with 2 embedded images")
    c.drawImage(ImageReader(tmp_red), 72, 500, width=200, height=160)
    c.drawImage(ImageReader(tmp_blue), 72, 300, width=200, height=160)
    c.showPage()
    c.save()
    return buf.getvalue()


def test_extract_pdf_photos_dedupes_and_skips_chrome():
    from pdf_photo_extractor import extract_pdf_photos
    pdf_bytes = _make_pdf_with_image()
    photos = extract_pdf_photos(pdf_bytes)
    assert isinstance(photos, list)
    assert len(photos) >= 2, f"expected 2 images, got {len(photos)}"
    # Each entry carries the canonical shape.
    for p in photos:
        assert isinstance(p.get("bytes"), (bytes, bytearray))
        assert p["mime"] == "image/png"
        assert p["ext"] == "png"
        assert p["width"] > 0 and p["height"] > 0
        assert p["page"] == 1
    # Dedupe: xref is unique per output entry.
    xrefs = [p["xref"] for p in photos]
    assert len(xrefs) == len(set(xrefs))


def test_extract_pdf_photos_min_pixels_filter():
    from pdf_photo_extractor import extract_pdf_photos
    pdf_bytes = _make_pdf_with_image()
    photos = extract_pdf_photos(pdf_bytes, min_pixels=10_000_000)
    # No image in our synthetic PDF hits 10M pixels — filter removes all.
    assert photos == []


@pytest.mark.asyncio
async def test_persist_pdf_photos_returns_expected_shape(monkeypatch):
    """Confirm the returned dicts match the shape the FE thumbnail /
    PDF renderer consume, without touching the shared motor client
    (which upstream tests can close between files)."""
    import pdf_photo_extractor as ppe

    captured: list = []

    async def _fake_save(subdir, parts, data, *, module, org_id,
                        mime=None, orig_filename=None):
        captured.append({"subdir": subdir, "parts": list(parts),
                         "module": module, "org_id": org_id,
                         "mime": mime, "size": len(data)})
        return parts[-1]

    monkeypatch.setattr(ppe, "persist_pdf_photos", ppe.persist_pdf_photos)
    monkeypatch.setattr("uploads_storage.save_upload", _fake_save)

    from PIL import Image as PILImage
    buf = io.BytesIO()
    PILImage.new("RGB", (100, 80), color=(0, 200, 0)).save(buf, "PNG")
    extracted = [{
        "page": 3, "xref": 42, "ext": "png", "mime": "image/png",
        "bytes": buf.getvalue(), "width": 100, "height": 80,
    }]
    sub_id = "sub_v132ik_persist_test"
    written = await ppe.persist_pdf_photos(sub_id, extracted, org_id="test_org")
    assert len(written) == 1
    ph = written[0]
    assert ph["stored_name"].startswith("evidence_")
    assert ph["stored_name"].endswith(".png")
    assert ph["mime"] == "image/png"
    assert ph["source"] == "imported_pdf"
    assert ph["source_page"] == 3
    assert ph["width"] == 100 and ph["height"] == 80
    assert ph["file_url"].startswith("/api/files/form_photos/")
    assert sub_id in ph["file_url"]
    # And the save_upload contract was called with the right subdir.
    assert captured, "save_upload must be invoked"
    assert captured[0]["subdir"] == "form_photos"
    assert captured[0]["parts"][0] == sub_id
    assert captured[0]["module"] == "imports"


def test_pdf_renderer_emits_evidence_thumb_grid(tmp_path, monkeypatch):
    """Feed a submission with an `evidence_photos` list to the shared
    renderer and assert the tail section renders (label + no crash)."""
    import forms_pdf
    monkeypatch.setattr(forms_pdf, "UPLOADS_ROOT", tmp_path)
    monkeypatch.setattr(forms_pdf, "FORM_PHOTOS", tmp_path / "form_photos")
    from PIL import Image as PILImage
    sub_id = "sub_v132ik_render"
    d = tmp_path / "form_photos" / sub_id
    d.mkdir(parents=True, exist_ok=True)
    for n in ("evidence_a.png", "evidence_b.png"):
        PILImage.new("RGB", (200, 150), color=(140, 200, 240)).save(d / n, "PNG")

    submission = {
        "id": sub_id,
        "template_name_snapshot": "v132ik test",
        "submitted_by_name": "T", "submitted_at": "2025-01-01T00:00:00Z",
        "fields": [],
        "evidence_photos": [
            {"stored_name": "evidence_a.png", "filename": "evidence_a.png",
             "mime": "image/png", "source": "imported_pdf"},
            {"stored_name": "evidence_b.png", "filename": "evidence_b.png",
             "mime": "image/png", "source": "imported_pdf"},
        ],
    }
    template = {"name": "v132ik test", "category": "other",
                "description": "", "fields": []}
    pdf_bytes = forms_pdf.render_form_submission_pdf(submission, template)
    assert pdf_bytes.startswith(b"%PDF")
    try:
        from pypdf import PdfReader
        r = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join(p.extract_text() or "" for p in r.pages)
    except Exception:
        text = pdf_bytes.decode("latin-1", errors="ignore")
    assert "EXTRACTED EVIDENCE PHOTOS" in text.upper()
    assert "Photos pulled from the original imported PDF" in text


# ── Version lockstep ────────────────────────────────────────────────

def test_version_pin_v132ik():
    import re as _re
    v = _r(FRONTEND / "src" / "lib" / "version.js")
    sw = _r(FRONTEND / "public" / "service-worker.js")
    pat = r"paneltec-v160\.3\.9\.58\.13\.132[i-z][k-z]?"
    assert _re.search(rf"RUNNING_VERSION = '{pat}'", v)
    assert _re.search(rf"EXPECTED_CACHE_VERSION = '{pat}'", v)
    assert _re.search(rf"CACHE_VERSION = '{pat}'", sw)


# ── Requirements pinned ─────────────────────────────────────────────

def test_requirements_pins_pymupdf():
    reqs = _r(BACKEND / "requirements.txt")
    assert "pymupdf" in reqs.lower()
