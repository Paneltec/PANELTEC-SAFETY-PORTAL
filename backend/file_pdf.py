"""Phase 3.10 — Universal PDF preview for any Document Library file.

Endpoints (all prefixed `/api`):
    GET  /files/{id}/pdf        — stream PDF (inline or attachment via ?dl=1)
    GET  /files/{id}/pdf.pdf    — same, path-disguised variant for ad-blocker
                                  compatibility (mirrors `forms_pdf` pattern)
    POST /files/pdf-bundle      — concatenate multiple files into one PDF

Conversion pipeline (v58.13.132lc — lightweight, no LibreOffice/Poppler):
    application/pdf                         → passthrough
    image/jpeg|png|webp                     → Pillow + reportlab A4 fit-to-page
    image/heic|heif                         → pillow-heif → JPG → reportlab
    text/csv | text/plain | text/markdown   → reportlab monospace paginated
    .docx (Word)                            → python-docx paragraph/table
                                              extraction → reportlab.
    .xlsx (Excel)                           → openpyxl sheet→row extraction
                                              → reportlab tabular renderer.
    .pptx / .odt / .rtf / other             → 415 "PDF preview not available
                                              for this format"

Cache: converted PDFs live in `doc_files_pdf_cache` keyed by
       (file_id, sha1, pipeline). Cache miss writes the row; subsequent calls
       stream from cache. Invalidated when the source file is replaced
       (different sha1).

v58.13.132lc — Removed all LibreOffice / Poppler / pdftotext / pdftoppm
subprocess shellouts. Everything now runs in-process via python-docx,
openpyxl, reportlab, pymupdf, and pytesseract (lazy). This matches
Emergent's guidance to stop reinstalling heavy binaries on every pod
restart, and unlocks the same feature-set in production without any
system-package prerequisites.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import io
import json
import logging
import os
import shutil
import tempfile
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (
    Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from db import db
from models import new_id, now_iso  # noqa: E402  — Phase 3.14 OCR-index timestamp helper
from auth import get_current_user
from missing_file_response import missing_file_response  # v58.13.132fq


log = logging.getLogger("paneltec.files.pdf")
router = APIRouter(prefix="", tags=["files-pdf"])

UPLOAD_DIR = Path(__file__).parent / "uploads" / "document_library"
# v58.13.132lc — pipeline labels PRESERVED for cache-key stability. Old
# entries in doc_files_pdf_cache with pipeline="docx_libreoffice" still
# resolve; new entries are written under "docx_python" / "xlsx_openpyxl".
PIPELINES = {
    "passthrough", "image", "heic", "text",
    "docx_libreoffice", "docx_docx2pdf", "docx_text_fallback",
    "docx_python", "xlsx_openpyxl",
    "xlsx_libreoffice", "pptx_libreoffice", "odt_libreoffice", "rtf_libreoffice",
}


# ────────────────── helpers ──────────────────

def _sha1_file(p: Path) -> str:
    h = hashlib.sha1()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _sniff_kind(blob: bytes) -> str:
    """Return a short kind label from magic bytes.

    v58.13.111 — used both by `_convert` (to route around a wrong stored
    mime — e.g. a JPEG uploaded with a `.pdf` extension) AND by the
    audit script (`audit_doc_files_v58_13_111.py`). Return values are
    intentionally a small closed set so the audit report / test pins
    stay stable:

        'pdf' / 'jpeg' / 'png' / 'webp' / 'heic' / 'gif' /
        'docx' / 'xlsx' / 'pptx' / 'zip' / 'text' / 'empty' / 'unknown'
    """
    if not blob:
        return "empty"
    head = blob[:16]
    if head.startswith(b"%PDF-"):                                return "pdf"
    if head.startswith(b"\xff\xd8\xff"):                         return "jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):                    return "png"
    if head[:4] == b"RIFF" and blob[8:12] == b"WEBP":            return "webp"
    if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"): return "gif"
    if any(m in head for m in (b"ftypheic", b"ftypheix",
                                b"ftypmif1", b"ftyphevc",
                                b"ftyphevx")):                    return "heic"
    if head[:2] == b"PK":
        # ZIP container — docx / xlsx / pptx / plain zip.
        low = blob[:200].lower()
        if b"word/" in low:      return "docx"
        if b"xl/" in low:        return "xlsx"
        if b"ppt/" in low:       return "pptx"
        return "zip"
    # Text sniff — every byte in the first 512 must be a common
    # printable / whitespace character.
    sample = blob[:512]
    try:
        sample.decode("utf-8")
        if all(b == 9 or b == 10 or b == 13 or 32 <= b < 127 for b in sample):
            return "text"
    except UnicodeDecodeError:
        pass
    return "unknown"


def _is_pdf(blob: bytes) -> bool:
    return blob[:5] == b"%PDF-"


async def _resolve_file(file_id: str, user: dict) -> tuple[dict, bytes]:
    """Return `(doc, blob_bytes)`. Bytes come from the local disk if
    the pre-.132gf copy is still there, otherwise from the shared
    `upload_storage` GridFS bucket (v58.13.132hl — matches the fall-
    through the `/document-library/files/{id}/download` endpoint
    already does). Raises the standard `missing_file_response()` 410
    only when neither source has the bytes."""
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "File not found")
    path = UPLOAD_DIR / doc["folder_id"] / doc["stored_name"]
    if path.exists():
        return doc, path.read_bytes()
    # v58.13.132hl — GridFS fallback. Fixes an entire class of files
    # whose disk copy was pruned after the `.132gf` GridFS migration
    # but whose bytes remain intact in `upload_storage`.
    from uploads_storage import read_upload  # noqa: WPS433 — lazy
    hit = await read_upload("document_library",
                             [doc["folder_id"], doc["stored_name"]])
    if hit is not None:
        blob, _mime = hit
        return doc, blob
    raise missing_file_response()


def _pipeline_for(mime: str, name: str) -> str:
    m = (mime or "").lower()
    n = (name or "").lower()
    if m == "application/pdf" or n.endswith(".pdf"):              return "passthrough"
    if m in {"image/jpeg", "image/png", "image/webp"} or n.split(".")[-1] in {"jpg", "jpeg", "png", "webp"}:
        return "image"
    if m in {"image/heic", "image/heif"} or n.endswith((".heic", ".heif")):
        return "heic"
    if m in {"text/csv", "text/plain", "text/markdown"} or n.endswith((".csv", ".txt", ".md")):
        return "text"
    # Phase 3.13 — LibreOffice primary path for all office formats.
    # .docx still has a pragmatic ReportLab text fallback for ultra-defensive
    # delivery; xlsx/pptx/odt/rtf are LO-only (raises 415 on LO failure).
    if n.endswith(".docx") or m == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return "docx_python"
    if n.endswith(".xlsx") or m == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return "xlsx_openpyxl"
    if n.endswith(".pptx") or m == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return "pptx_libreoffice"
    if n.endswith(".odt") or m == "application/vnd.oasis.opendocument.text":
        return "odt_libreoffice"
    if n.endswith(".rtf") or m in {"application/rtf", "text/rtf"}:
        return "rtf_libreoffice"
    return ""  # unsupported


# ────────────────── conversion implementations ──────────────────

def _img_to_pdf(blob: bytes) -> bytes:
    """Wrap a JPG/PNG/WEBP in a single-page A4 PDF, fit-to-page with margins."""
    from PIL import Image
    img = Image.open(io.BytesIO(blob))
    if img.mode in {"RGBA", "P"}:
        img = img.convert("RGB")
    out = io.BytesIO()
    page_w, page_h = A4
    margin = 14 * mm
    avail_w, avail_h = page_w - 2 * margin, page_h - 2 * margin
    ratio = min(avail_w / img.width, avail_h / img.height)
    w, h = img.width * ratio, img.height * ratio
    x, y = (page_w - w) / 2, (page_h - h) / 2
    # Save img to a temp buffer reportlab can ingest.
    img_buf = io.BytesIO()
    img.save(img_buf, format="JPEG", quality=88)
    img_buf.seek(0)
    c = pdfcanvas.Canvas(out, pagesize=A4)
    from reportlab.lib.utils import ImageReader
    c.drawImage(ImageReader(img_buf), x, y, w, h, preserveAspectRatio=True, mask="auto")
    c.showPage(); c.save()
    return out.getvalue()


def _heic_to_pdf(blob: bytes) -> bytes:
    import pillow_heif
    pillow_heif.register_heif_opener()
    return _img_to_pdf(blob)


def _text_to_pdf(blob: bytes, name: str) -> bytes:
    text = blob.decode("utf-8", errors="replace")
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4,
                            leftMargin=14*mm, rightMargin=14*mm,
                            topMargin=14*mm, bottomMargin=14*mm)
    style = ParagraphStyle("Mono", fontName="Courier", fontSize=8.5, leading=11)
    head = ParagraphStyle("Head", fontName="Helvetica-Bold", fontSize=12, leading=14, spaceAfter=8)
    story = [Paragraph(name, head), Spacer(1, 4)]
    # Chunk into 1KB-ish blocks so reportlab can paginate.
    chunk: list[str] = []
    for line in text.splitlines():
        chunk.append(line)
        if len(chunk) >= 60:
            story.append(Preformatted("\n".join(chunk), style))
            chunk = []
    if chunk:
        story.append(Preformatted("\n".join(chunk), style))
    doc.build(story)
    return out.getvalue()


def _docx_text_fallback(blob: bytes, name: str) -> bytes:
    """v58.13.132lc — primary docx → PDF renderer (was fallback in .132kh).
    Pulls paragraphs + tables from a .docx via python-docx and renders
    them as reportlab paragraphs. Tables are flattened to
    " | "-separated lines. On a python-docx parse failure this raises;
    the caller (`_docx_to_pdf`) wraps that into a placeholder PDF."""
    from docx import Document
    d = Document(io.BytesIO(blob))
    lines: list[str] = []
    for p in d.paragraphs:
        if p.text.strip():
            lines.append(p.text)
    for tbl in d.tables:
        lines.append("")  # spacer
        for row in tbl.rows:
            lines.append(" | ".join((c.text or "").strip() for c in row.cells))
    if not lines:
        lines = ["(document contains no readable text)"]
    return _text_to_pdf(("\n".join(lines)).encode("utf-8"), name)


def _docx_to_pdf(blob: bytes, name: str) -> tuple[bytes, str]:
    """v58.13.132lc — pure-Python docx → PDF via python-docx + reportlab.

    Removed the LibreOffice / docx2pdf subprocess fallbacks — Emergent's
    root-cause analysis pinned repeat LibreOffice reinstalls as the
    cause of the pod SIGTERM cycle. The existing `_docx_text_fallback`
    was already the last-line-of-defence in .132kh; we now promote it
    to primary and drop the two subprocess paths entirely.

    Never blank: on a malformed .docx that python-docx refuses to
    parse, we still emit a one-line "unable to render" PDF so the
    caller's iframe never shows a 500."""
    try:
        pdf = _docx_text_fallback(blob, name)
        if _is_pdf(pdf) and len(pdf) >= 200:
            log.info("docx_python: ok docx=%s bytes=%d", name, len(pdf))
            return pdf, "docx_python"
        log.warning("docx_python produced suspiciously small output for %s (%d bytes)",
                     name, len(pdf))
    except Exception as e:  # noqa: BLE001
        log.info("docx_python failed for %s: %s — falling back to placeholder", name, e)
    # Last-line-of-defence: emit a placeholder PDF so the viewer doesn't 500.
    placeholder = _text_to_pdf(
        f"Could not render {name} as PDF preview.\n\n"
        "The .docx file may be malformed. Try downloading the original "
        "via the download button.".encode("utf-8"),
        name,
    )
    return placeholder, "docx_text_fallback"


def _xlsx_to_pdf(blob: bytes, name: str) -> bytes:
    """v58.13.132lc — pure-Python xlsx → PDF via openpyxl + reportlab.Table.

    Renders each sheet as a heading followed by a paginated table. Uses
    landscape A4 for wide sheets. Empty rows/cells are skipped. Text
    values are truncated to 60 chars per cell to keep the table
    printable — the original file is always available via the
    download link.

    Malformed xlsx → surfaces as a placeholder PDF (never crashes the
    iframe)."""
    from openpyxl import load_workbook
    out = io.BytesIO()
    doc = SimpleDocTemplate(
        out, pagesize=landscape(A4),
        leftMargin=10 * mm, rightMargin=10 * mm,
        topMargin=10 * mm, bottomMargin=10 * mm,
    )
    styles = getSampleStyleSheet()
    sheet_head = ParagraphStyle(
        "SheetHead", parent=styles["Heading2"],
        fontName="Helvetica-Bold", fontSize=12, spaceAfter=6,
    )
    doc_title = ParagraphStyle(
        "DocTitle", parent=styles["Heading1"],
        fontName="Helvetica-Bold", fontSize=14, spaceAfter=10,
    )
    story: list = [Paragraph(name, doc_title)]
    try:
        wb = load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001
        log.warning("openpyxl failed to open %s: %s", name, e)
        return _text_to_pdf(
            f"Could not render {name} as PDF preview.\n\n"
            "The .xlsx file may be malformed. Try downloading the "
            "original via the download button.".encode("utf-8"),
            name,
        )

    def _cell(v) -> str:
        if v is None:
            return ""
        s = str(v)
        return s if len(s) <= 60 else s[:57] + "…"

    MAX_ROWS_PER_SHEET = 400
    MAX_COLS = 16

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        story.append(Paragraph(f"Sheet: {sheet_name}", sheet_head))
        rows: list = []
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i >= MAX_ROWS_PER_SHEET:
                rows.append(["…", f"[{i}+ rows — truncated]"] + [""] * (MAX_COLS - 2))
                break
            cells = [_cell(v) for v in row[:MAX_COLS]]
            if any(c for c in cells):
                rows.append(cells + [""] * (MAX_COLS - len(cells)))
        if not rows:
            story.append(Paragraph("<i>(empty sheet)</i>", styles["BodyText"]))
            story.append(Spacer(1, 6))
            continue
        # Normalise column count so Table doesn't raise.
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        tbl = Table(rows, repeatRows=1)
        tbl.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 7),
            ("BOX", (0, 0), (-1, -1), 0.25, colors.grey),
            ("INNERGRID", (0, 0), (-1, -1), 0.15, colors.lightgrey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F5F3FF")),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 10))

    try:
        doc.build(story)
    except Exception as e:  # noqa: BLE001
        log.warning("reportlab build failed for xlsx=%s: %s", name, e)
        return _text_to_pdf(
            f"Could not render {name} as PDF preview.\n\n"
            "Table layout exceeded the printable area. Try downloading "
            "the original via the download button.".encode("utf-8"),
            name,
        )
    return out.getvalue()


def _office_to_pdf_or_415(blob: bytes, ext: str, name: str, pipeline: str) -> tuple[bytes, str]:
    """v58.13.132lc — .xlsx handled in-process. .pptx/.odt/.rtf remain
    unsupported (no lightweight in-process renderer available). Callers
    should fall through to the "download original" affordance."""
    if pipeline == "xlsx_libreoffice" or pipeline == "xlsx_openpyxl":
        pdf = _xlsx_to_pdf(blob, name)
        log.info("xlsx_openpyxl: ok %s=%s bytes=%d", ext, name, len(pdf))
        return pdf, "xlsx_openpyxl"
    # .pptx / .odt / .rtf — no lightweight in-process renderer.
    raise HTTPException(
        415,
        f"PDF preview not available for .{ext.lower()} files. "
        "Please download the original.",
    )


# ────────────────── OCR utility (opt-in) ──────────────────

def _ensure_tesseract() -> bool:
    """v58.13.132lc — lazy Tesseract check. Returns True when the
    binary is on PATH; never tries to install on the fly (that was the
    Emergent-flagged reinstall loop). Callers should degrade gracefully
    when this returns False."""
    return bool(shutil.which("tesseract"))


def ocr_pdf_to_text(pdf_path: Path | str, lang: str = "eng", timeout: int = 90) -> str:
    """v58.13.132lc — Extract plaintext from a PDF using pymupdf's
    in-process text layer, falling back to pytesseract OCR on
    rasterised pages when the PDF has no text layer.

    Removes the prior `pdftotext` / `pdftoppm` subprocess shellouts —
    both are now handled in-process by pymupdf (which is already
    installed for `pdf_photo_extractor.py`). Tesseract is still called
    via pytesseract, but the binary presence is checked lazily and
    the OCR pass is skipped (returning whatever text-layer text we
    found, or "") when Tesseract is missing.

    Never raises. Returns "" when the file is unreadable, missing, or
    the OCR fallback is unavailable."""
    src = Path(pdf_path)
    if not src.exists():
        log.info("ocr_pdf_to_text: file missing %s", src)
        return ""
    try:
        import fitz  # pymupdf
    except ImportError:
        log.warning("ocr_pdf_to_text: pymupdf not installed")
        return ""

    text_parts: list[str] = []
    pages_needing_ocr: list[int] = []
    try:
        doc = fitz.open(str(src))
    except Exception as e:  # noqa: BLE001
        log.info("ocr_pdf_to_text: pymupdf failed to open %s: %s", src, e)
        return ""
    try:
        for i, page in enumerate(doc):
            try:
                txt = page.get_text() or ""
            except Exception as e:  # noqa: BLE001
                log.debug("ocr_pdf_to_text: page %d get_text failed: %s", i, e)
                txt = ""
            if txt.strip():
                text_parts.append(txt)
            else:
                pages_needing_ocr.append(i)

        # No OCR needed — return the text-layer content.
        if not pages_needing_ocr:
            return "\n".join(text_parts).strip()

        # OCR fallback for image-only pages.
        if not _ensure_tesseract():
            log.info("ocr_pdf_to_text: tesseract missing, returning text-layer only "
                       "(%d pages needed OCR)", len(pages_needing_ocr))
            return "\n".join(text_parts).strip()
        try:
            import pytesseract
            from PIL import Image
        except ImportError as e:
            log.warning("ocr_pdf_to_text: pytesseract/PIL missing: %s", e)
            return "\n".join(text_parts).strip()

        for i in pages_needing_ocr:
            try:
                page = doc[i]
                pix = page.get_pixmap(dpi=200)
                img = Image.frombytes(
                    "RGB", (pix.width, pix.height), pix.samples,
                )
                ocr_text = pytesseract.image_to_string(img, lang=lang) or ""
                if ocr_text.strip():
                    text_parts.append(ocr_text)
            except Exception as e:  # noqa: BLE001
                log.debug("ocr_pdf_to_text: OCR page %d failed: %s", i, e)
    finally:
        try:
            doc.close()
        except Exception:
            pass
    return "\n".join(text_parts).strip()


# ────────────────── cache + dispatcher ──────────────────

async def _cache_lookup(file_id: str, sha1: str, pipeline: str) -> Optional[bytes]:
    row = await db.doc_files_pdf_cache.find_one(
        {"file_id": file_id, "sha1": sha1, "pipeline": pipeline},
        {"_id": 0, "pdf_b64": 1},
    )
    if not row:
        return None
    import base64
    return base64.b64decode(row["pdf_b64"])


async def _cache_store(file_id: str, sha1: str, pipeline: str, pdf: bytes) -> None:
    import base64
    await db.doc_files_pdf_cache.update_one(
        {"file_id": file_id, "sha1": sha1, "pipeline": pipeline},
        {"$set": {
            "file_id": file_id, "sha1": sha1, "pipeline": pipeline,
            "pdf_b64": base64.b64encode(pdf).decode("ascii"),
            "size": len(pdf),
        }},
        upsert=True,
    )


async def _convert(doc: dict, blob: bytes) -> tuple[bytes, str]:
    """v58.13.132hl — takes raw bytes (was: `Path`). Callers now
    fetch the bytes themselves (disk OR GridFS) via `_resolve_file`
    and pass them in, so the conversion pipeline is source-agnostic."""
    sha1 = _sha1_bytes(blob)
    pipeline = _pipeline_for(doc.get("mime"), doc.get("filename") or "")
    if not pipeline:
        ctype = doc.get("mime") or "application/octet-stream"
        msg = f"PDF preview not available for {ctype}"
        raise HTTPException(415, msg)
    cached = await _cache_lookup(doc["id"], sha1, pipeline)
    if cached:
        return cached, pipeline
    # v58.13.132hl — bytes are now passed in by the caller; no more
    # `path.read_bytes()` here.
    # v58.13.111 — magic-byte sniff. Trust the file's real content over
    # the stored `mime` when they disagree. Common case: a JPEG uploaded
    # with a `.pdf` extension (or vice-versa) — the pipeline picked
    # above based on filename/mime would 415 in passthrough; the sniff
    # lets us re-route to `image` and wrap it as PDF for the viewer.
    # Stubs / empty / unknown drop through to a clearer 415.
    kind = _sniff_kind(blob)
    if pipeline == "passthrough" and kind != "pdf":
        if kind in ("jpeg", "png", "webp", "gif"):
            pipeline = "image"
        elif kind == "heic":
            pipeline = "heic"
        else:
            size = len(blob)
            raise HTTPException(
                415,
                f"File is {kind} ({size} bytes), not a valid PDF. "
                "Preview unavailable — please re-upload.",
            )
    if pipeline == "passthrough": pdf = blob  # already sniffed as pdf
    elif pipeline == "image": pdf = _img_to_pdf(blob)
    elif pipeline == "heic":  pdf = _heic_to_pdf(blob)
    elif pipeline == "text":  pdf = _text_to_pdf(blob, doc.get("filename") or "Document")
    elif pipeline in {"docx_python", "docx_libreoffice"}:
        # Legacy cache entries carry "docx_libreoffice" — both route to
        # the same in-process renderer post-.132lc.
        pdf, pipeline = _docx_to_pdf(blob, doc.get("filename") or "Document")
    elif pipeline in {"xlsx_openpyxl", "xlsx_libreoffice",
                       "pptx_libreoffice", "odt_libreoffice", "rtf_libreoffice"}:
        ext = pipeline.split("_", 1)[0]
        pdf, pipeline = _office_to_pdf_or_415(blob, ext, doc.get("filename") or f"Document.{ext}", pipeline)
    else:
        raise HTTPException(500, f"Unknown pipeline: {pipeline}")
    await _cache_store(doc["id"], sha1, pipeline, pdf)
    return pdf, pipeline


def _pdf_response(pdf: bytes, original_name: str, dl: bool, pipeline: str) -> Response:
    base = original_name.rsplit(".", 1)[0] or "document"
    fname = f"{base}.pdf"
    disp = "attachment" if dl else "inline"
    # Phase 3.10 hotfix — Chrome blocks cross-origin iframe loading without
    # explicit CSP frame-ancestors + same-site CORP. Stamp them on every PDF
    # response so the PdfPreviewModal iframe loads cleanly.
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disp}; filename="{fname}"',
            "X-Pipeline": pipeline,
            "Cache-Control": "private, max-age=3600",
            "X-Frame-Options": "SAMEORIGIN",
            "Content-Security-Policy": (
                "frame-ancestors 'self' https://*.emergentagent.com "
                "https://*.preview.emergentagent.com"
            ),
            "Cross-Origin-Resource-Policy": "same-site",
            "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
        },
    )


# ────────────────── signed preview token (iframe auth) ──────────────────
#
# Iframes can't carry the Authorization header, so the PdfPreviewModal mints a
# short-lived signed token via POST /preview-token and passes it as `?t=` on
# the iframe src. The token is HMAC-SHA256 over {file_id, user_id, exp}, signed
# with the JWT secret. Audience is bound to file_id to prevent token reuse on
# a different file.

def _preview_secret() -> bytes:
    s = os.environ.get("JWT_SECRET") or os.environ.get("SECRET_KEY") or "paneltec-dev"
    return s.encode()


def _mint_preview_token(file_id: str, user_id: str, ttl_seconds: int = 300) -> str:
    payload = {"f": file_id, "u": user_id, "exp": int(time.time()) + ttl_seconds}
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).rstrip(b"=").decode()
    sig = hmac.new(_preview_secret(), body.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{body}.{sig_b64}"


def _verify_preview_token(token: str, file_id: str) -> Optional[str]:
    try:
        body, sig_b64 = token.split(".", 1)
        expected = hmac.new(_preview_secret(), body.encode(), hashlib.sha256).digest()
        got = base64.urlsafe_b64decode(sig_b64 + "==")
        if not hmac.compare_digest(expected, got):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "==").decode())
        if payload.get("f") != file_id:
            return None
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload.get("u")
    except Exception:
        return None


# ────────────────── endpoints ──────────────────

@router.get("/files/{file_id}/pdf")
async def file_pdf(file_id: str, request: Request,
                   background: BackgroundTasks,
                   dl: int = Query(0),
                   t: Optional[str] = Query(None, description="signed iframe token; alternative to Bearer auth")):
    """Stream PDF. Accepts EITHER an Authorization Bearer header (curl /
    download path) OR a short-lived signed `?t=` token (iframe path, since
    iframes can't carry custom headers).

    Phase 3.14 — first time a file is converted to PDF, we kick a background
    task that runs `ocr_pdf_to_text` against the PDF bytes and persists the
    result onto `doc_files.search_text` so the Smart Search indexer (existing
    or future) can pick it up. Fire-and-forget; the response returns
    immediately as it does today."""
    if t:
        user_id = _verify_preview_token(t, file_id)
        if not user_id:
            raise HTTPException(401, "Invalid or expired preview token")
        u = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not u:
            raise HTTPException(401, "Token user not found")
        user = u
    else:
        user = await get_current_user(request, creds=None)
    doc, blob = await _resolve_file(file_id, user)
    pdf, pipeline = await _convert(doc, blob)
    # Spool the OCR + index step into the background. We persist the PDF to a
    # short-lived temp file so `ocr_pdf_to_text` (which expects a Path) can
    # read it without re-converting. The doc id keeps us idempotent — see the
    # `already_indexed` short-circuit in `_ocr_index_file`.
    try:
        tmp = Path(tempfile.gettempdir()) / f"ocr_idx_{doc['id']}.pdf"
        tmp.write_bytes(pdf)
        background.add_task(_ocr_index_file, doc["id"], tmp)
    except Exception as e:
        log.warning("ocr scheduling failed file=%s err=%s", doc.get("id"), e)
    return _pdf_response(pdf, doc.get("filename") or file_id, bool(dl), pipeline)


@router.get("/files/{file_id}/pdf.pdf")
async def file_pdf_aliased(file_id: str, request: Request,
                           background: BackgroundTasks,
                           dl: int = Query(0), t: Optional[str] = Query(None)):
    return await file_pdf(file_id, request, background, dl=dl, t=t)


@router.post("/files/{file_id}/preview-token")
async def mint_file_preview_token(file_id: str, user: dict = Depends(get_current_user)):
    """Issue a 5-minute signed token bound to (file_id, user_id) so the iframe
    can fetch the PDF without an Authorization header."""
    doc, _ = await _resolve_file(file_id, user)  # access check + 404
    token = _mint_preview_token(doc["id"], user["id"])
    return {"token": token, "expires_in": 300}


# ────────────────── inline PDF stash (Phase 3.13.1) ──────────────────
#
# Some flows generate a PDF on the fly and pass it to the universal
# PdfPreviewModal (Site QR sheet, Supplier QR sheet, Induction Print, ...).
# Originally those flows wrapped the bytes in `URL.createObjectURL` and gave
# the iframe a `blob:` URL — which ad blockers and privacy extensions
# routinely refuse to load (ERR_BLOCKED_BY_CLIENT).
#
# To make those previews behave like normal HTTPS document loads, we stash
# the PDF bytes in-process and return a same-origin signed URL the iframe
# can hit directly. The stash is org-scoped, capped, and TTL'd.
_INLINE_STASH: dict[str, dict] = {}
_INLINE_STASH_TTL_SECONDS = 600   # 10 minutes
_INLINE_STASH_MAX_BYTES = 25 * 1024 * 1024   # 25 MB cap per blob
_INLINE_STASH_MAX_ENTRIES = 200


def _stash_prune() -> None:
    now = time.time()
    expired = [k for k, v in _INLINE_STASH.items() if v["exp"] < now]
    for k in expired:
        _INLINE_STASH.pop(k, None)
    # Hard cap — drop oldest if we've blown past the limit.
    while len(_INLINE_STASH) > _INLINE_STASH_MAX_ENTRIES:
        oldest = min(_INLINE_STASH, key=lambda k: _INLINE_STASH[k]["exp"])
        _INLINE_STASH.pop(oldest, None)


def stash_inline_pdf(pdf_bytes: bytes, user_id: str, org_id: str,
                      filename: str = "document.pdf",
                      ttl_seconds: int = _INLINE_STASH_TTL_SECONDS) -> str:
    """Persist `pdf_bytes` in-memory and return a stash id callers can hand to
    the frontend so it can pull the bytes via `GET /files/inline/{id}?t=...`
    instead of feeding a `blob:` URL to the iframe."""
    if not pdf_bytes:
        raise HTTPException(400, "Empty PDF body")
    if len(pdf_bytes) > _INLINE_STASH_MAX_BYTES:
        raise HTTPException(413, f"PDF too large to stash ({len(pdf_bytes)} bytes)")
    _stash_prune()
    sid = new_id()
    _INLINE_STASH[sid] = {
        "bytes": pdf_bytes,
        "user_id": user_id,
        "org_id": org_id,
        "filename": filename,
        "exp": time.time() + ttl_seconds,
    }
    return sid


@router.get("/files/inline/{stash_id}")
async def serve_inline_pdf(stash_id: str, request: Request,
                            t: Optional[str] = Query(None,
                                description="signed iframe token; alternative to Bearer auth")):
    """Stream a previously stashed PDF. Accepts either a Bearer header (curl /
    same-tab navigation) or a `?t=` signed token (iframe path).

    The stash entry pins (user_id, org_id) so a token bound to a different
    user can't pull it. TTL ~10 min; entry is left in place until it expires
    so the iframe can re-fetch if the page reloads."""
    _stash_prune()
    entry = _INLINE_STASH.get(stash_id)
    if not entry:
        raise HTTPException(404, "Inline preview not found or expired")
    if t:
        user_id = _verify_preview_token(t, stash_id)
        if not user_id:
            raise HTTPException(401, "Invalid or expired preview token")
    else:
        user = await get_current_user(request, creds=None)
        user_id = user["id"]
    if user_id != entry["user_id"]:
        raise HTTPException(403, "Preview belongs to a different user")
    return _pdf_response(entry["bytes"], entry["filename"], dl=False,
                         pipeline="inline_stash")


@router.post("/files/inline-pdf")
async def stash_inline_endpoint(request: Request, user: dict = Depends(get_current_user)):
    """Generic stash endpoint: POST a PDF body (binary or multipart) and get
    back `{stash_id, token, expires_in}`. The iframe then loads
    `/api/files/inline/{stash_id}?t={token}` to render the PDF as a normal
    HTTPS document — sidestepping the `blob:` URL ad-blocker block.

    Designed for callers that already have the PDF bytes locally (e.g.
    they did a normal `axios.post(..., {responseType:'blob'})` and want to
    show the result in PdfPreviewModal without a `blob:` URL)."""
    body = await request.body()
    if not body:
        raise HTTPException(400, "Empty body")
    if not _is_pdf(body):
        raise HTTPException(400, "Body is not a PDF")
    # Filename is optional, comes from X-Filename header if provided.
    filename = request.headers.get("x-filename") or "document.pdf"
    sid = stash_inline_pdf(body, user["id"], user.get("org_id") or "",
                           filename=filename)
    token = _mint_preview_token(sid, user["id"])
    return {"stash_id": sid, "token": token, "expires_in": 300}


class BundleIn(BaseModel):
    file_ids: list[str]


@router.post("/files/pdf-bundle")
async def file_pdf_bundle(body: BundleIn, user: dict = Depends(get_current_user)):
    if user.get("role") not in {"admin", "manager", "hseq_lead"}:
        raise HTTPException(403, "Bulk PDF bundles require admin/manager role")
    if not body.file_ids:
        raise HTTPException(400, "file_ids cannot be empty")
    if len(body.file_ids) > 25:
        raise HTTPException(400, "Max 25 files per bundle")
    from PyPDF2 import PdfMerger
    merger = PdfMerger()
    converted = 0; skipped: list[dict] = []
    for fid in body.file_ids:
        try:
            doc, blob = await _resolve_file(fid, user)
            pdf, _ = await _convert(doc, blob)
            merger.append(io.BytesIO(pdf))
            converted += 1
        except HTTPException as e:
            skipped.append({"file_id": fid, "reason": e.detail})
    if converted == 0:
        raise HTTPException(415, f"No files could be converted: {skipped}")
    buf = io.BytesIO()
    merger.write(buf); merger.close()
    headers = {
        "Content-Disposition": f'attachment; filename="paneltec-bundle-{converted}.pdf"',
        "X-Bundle-Converted": str(converted),
        "X-Bundle-Skipped": str(len(skipped)),
    }
    return Response(content=buf.getvalue(), media_type="application/pdf", headers=headers)


# ────────────────── admin install hook (v146 → .132lc DEPRECATED) ──────────────────
#
# v58.13.132lc — Emergent's root-cause analysis pinned repeat
# LibreOffice/Poppler/Tesseract apt reinstalls as the cause of the
# pod SIGTERM cycle. The full apt-install machinery is now retired:
#   · POST /admin/install-libreoffice → 410 Gone (with a friendly
#     hint pointing at the new lightweight pipeline).
#   · Auto-install-on-boot (`ensure_server_tools_or_install_bg`)
#     downgraded to a pure status probe — never spawns apt.
#   · GET /admin/system-tools + /admin/server-tools/health continue
#     to work but now report python-docx / openpyxl / pymupdf /
#     reportlab / tesseract-lazy as the runtime toolchain.
#
# `_INSTALL_STATE` is retained as an empty shim so any legacy poller
# still sees a well-formed response and doesn't crash on missing keys.
_INSTALL_STATE: Dict[str, Any] = {
    "install_running": False,
    "job_id": None,
    "started_at": None,
    "finished_at": None,
    "exit_code": None,
    "packages": None,
    "log_tail": deque(maxlen=1),
}


def _install_log_tail_str() -> str:
    return ""


def ensure_server_tools_or_install_bg() -> Dict[str, Any]:
    """v58.13.132lc — probe-only. Returns a status dict but NEVER
    spawns an apt subprocess. Preserves the signature so
    `server.py::on_startup` can still call it if the guard is
    ever re-enabled — it'll be a fast in-process check that
    reports the health of the lightweight Python libs."""
    ok = _lib_status()
    missing = [k for k, v in ok.items() if not v.get("installed")]
    return {
        "missing": missing,
        "action": "noop",
        "reason": "lightweight libs — no apt install needed",
        "libs": ok,
    }


@router.post("/admin/install-libreoffice", status_code=410)
async def install_libreoffice(user: dict = Depends(get_current_user)):
    """v58.13.132lc — DEPRECATED. Returns 410 Gone; the doc-conversion
    pipeline no longer needs LibreOffice / Poppler / Tesseract to be
    apt-installed. python-docx + openpyxl + reportlab + pymupdf handle
    everything in-process."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    raise HTTPException(
        410,
        "This endpoint is retired in v58.13.132lc. Document conversion "
        "runs in-process via python-docx / openpyxl / reportlab / "
        "pymupdf and no longer requires LibreOffice or Poppler to be "
        "installed on the pod.",
    )


def _lib_status() -> dict:
    """Report presence + version of the pure-Python doc toolchain."""
    def _v(mod_name: str) -> Optional[str]:
        try:
            import importlib
            m = importlib.import_module(mod_name)
            return getattr(m, "__version__", None) or "installed"
        except ImportError:
            return None

    def _one(name: str, mod: str) -> dict:
        v = _v(mod)
        return {"installed": bool(v), "path": mod, "version": v}

    return {
        # Doc conversion — python-docx replaces LibreOffice for .docx.
        "python-docx": _one("python-docx", "docx"),
        # xlsx — openpyxl replaces LibreOffice for .xlsx.
        "openpyxl":    _one("openpyxl", "openpyxl"),
        # PDF rasterisation + text extraction — pymupdf replaces poppler.
        "pymupdf":     _one("pymupdf", "fitz"),
        # PDF composition — reportlab (always installed).
        "reportlab":   _one("reportlab", "reportlab"),
        # OCR — tesseract binary (system dep) + pytesseract wrapper.
        # Kept lazy — only invoked on-demand via `_ensure_tesseract()`.
        "tesseract":   {
            "installed": bool(shutil.which("tesseract")),
            "path": shutil.which("tesseract"),
            "version": None,
        },
    }


@router.get("/admin/system-tools")
async def system_tools(user: dict = Depends(get_current_user)):
    """v58.13.132lc — reports the pure-Python doc toolchain instead of
    LibreOffice / Poppler / Tesseract binaries. Admin-only. The
    Settings → System page uses this to colour its status chips.

    Backward-compat: the legacy `libreoffice`, `tesseract`, `poppler`
    keys are ALSO surfaced under `legacy_tools` so any frontend
    version still reading them doesn't crash. New surface should read
    from the top-level `tools` map."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    libs = _lib_status()
    legacy = {
        # We no longer depend on these; report as "ok" via the pure-
        # Python replacements so the UI doesn't render a red chip.
        "libreoffice": {"installed": libs["python-docx"]["installed"],
                         "path": "python-docx (in-process)",
                         "version": libs["python-docx"]["version"]},
        "tesseract":   libs["tesseract"],
        "poppler":     {"installed": libs["pymupdf"]["installed"],
                         "path": "pymupdf (in-process)",
                         "version": libs["pymupdf"]["version"]},
    }
    return {"tools": libs, "legacy_tools": legacy}


@router.get("/admin/server-tools/health")
async def server_tools_health(user: dict = Depends(get_current_user)):
    """v58.13.132lc — health-check shape used by the Settings page.

    Legacy keys (`libreoffice`, `tesseract`, `poppler`) preserved for
    UI compatibility; each now reports the lightweight replacement's
    status. `install_*` keys are frozen — no background installer
    runs anymore. Admin-only."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    libs = _lib_status()

    def _legacy_norm(installed: bool, version: Optional[str],
                      replacement: str) -> dict:
        return {"ok": installed, "version": version, "path": replacement}

    return {
        # Legacy shape.
        "libreoffice": _legacy_norm(libs["python-docx"]["installed"],
                                       libs["python-docx"]["version"],
                                       "python-docx (in-process)"),
        "tesseract":   _legacy_norm(libs["tesseract"]["installed"],
                                       libs["tesseract"]["version"],
                                       libs["tesseract"]["path"] or "tesseract (lazy)"),
        "poppler":     _legacy_norm(libs["pymupdf"]["installed"],
                                       libs["pymupdf"]["version"],
                                       "pymupdf (in-process)"),
        # New shape — full pure-Python toolchain status.
        "libs": libs,
        # Retired installer surface (kept for frontend compat).
        "install_running":     False,
        "install_job_id":      None,
        "install_started_at":  None,
        "install_finished_at": None,
        "install_exit_code":   None,
        "install_log_tail":    None,
    }


# ────────────── Phase 3.14 — Auto-OCR-to-SmartSearch on upload ──────────────
# Fire-and-forget extractor: after a file is converted to PDF (cached on disk
# at <UPLOAD_DIR>/cache/<file_id>.pdf), we spawn a background task that runs
# the existing `ocr_pdf_to_text()` util and persists the result onto
# `doc_files.search_text`. Triggered from the /pdf endpoint so it benefits
# from the LibreOffice cache without re-converting.

# 50 MB cap — anything larger blows past the tesseract timeout and the
# search-relevance per byte falls off a cliff.
OCR_INDEX_MAX_BYTES = 50 * 1024 * 1024


async def _ocr_index_file(file_id: str, pdf_path: Path) -> None:
    """Background task: extract text and persist to doc_files.search_text.
    Cheap when the PDF has a text layer (pymupdf fast path); slow only
    when tesseract has to OCR rasterised pages."""
    try:
        existing = await db.doc_files.find_one({"id": file_id}, {"_id": 0, "search_text": 1, "size": 1})
        if not existing:
            return
        if existing.get("search_text"):
            log.info("ocr skipped file=%s reason=already_indexed", file_id)
            return
        if int(existing.get("size") or 0) > OCR_INDEX_MAX_BYTES:
            log.info("ocr skipped file=%s reason=size", file_id)
            await db.doc_files.update_one({"id": file_id},
                {"$set": {"search_text_status": "skipped_size", "search_text_at": now_iso()}})
            return
        text = ocr_pdf_to_text(pdf_path)
        await db.doc_files.update_one({"id": file_id},
            {"$set": {"search_text": text or "", "search_text_chars": len(text or ""),
                      "search_text_status": "indexed", "search_text_at": now_iso()}})
        log.info("ocr indexed file=%s chars=%d", file_id, len(text or ""))
    except Exception as e:
        log.warning("ocr failed file=%s err=%s", file_id, e)
        try:
            await db.doc_files.update_one({"id": file_id},
                {"$set": {"search_text_status": f"error: {str(e)[:120]}",
                          "search_text_at": now_iso()}})
        except Exception:
            pass


@router.get("/admin/files/{file_id}/search-text")
async def admin_file_search_text(file_id: str, user: dict = Depends(get_current_user)):
    """Debug-only — returns the OCR'd text persisted on the file doc."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"]},
        {"_id": 0, "search_text": 1, "search_text_chars": 1,
         "search_text_status": 1, "search_text_at": 1, "filename": 1, "size": 1},
    )
    if not doc:
        raise HTTPException(404, "File not found")
    return doc



# ─────────────────── v58.13.132hj — public helpers ───────────────────
#
# Exposes the DocLib conversion core so other modules (worker HR docs,
# equipment attachments, submission attachments, etc.) can render their
# own file bytes as PDF without re-implementing the pipeline. The
# helpers below are PARALLEL to the existing `_convert` / `_cache_*`
# flow — they use a separate cache collection (`preview_pdf_cache`) so
# the DocLib code path stays byte-for-byte identical and rollback is
# a single-file delete of `preview_sources.py`.


def _sha1_bytes(blob: bytes) -> str:
    """SHA-1 of an in-memory blob (mirrors `_sha1_file` for the disk path)."""
    h = hashlib.sha1()
    h.update(blob)
    return h.hexdigest()


async def _cache_lookup_v2(namespace: str, cache_key: str,
                            sha1: str, pipeline: str) -> Optional[bytes]:
    row = await db.preview_pdf_cache.find_one(
        {"ns": namespace, "key": cache_key, "sha1": sha1, "pipeline": pipeline},
        {"_id": 0, "pdf_b64": 1},
    )
    if not row:
        return None
    return base64.b64decode(row["pdf_b64"])


async def _cache_store_v2(namespace: str, cache_key: str,
                           sha1: str, pipeline: str, pdf: bytes) -> None:
    await db.preview_pdf_cache.update_one(
        {"ns": namespace, "key": cache_key, "sha1": sha1, "pipeline": pipeline},
        {"$set": {
            "ns": namespace, "key": cache_key, "sha1": sha1, "pipeline": pipeline,
            "pdf_b64": base64.b64encode(pdf).decode("ascii"),
            "size": len(pdf),
            "cached_at": now_iso(),
        }},
        upsert=True,
    )


async def convert_bytes_to_pdf(
    blob: bytes,
    mime: str,
    filename: str,
    *,
    cache_namespace: str,
    cache_key: str,
) -> tuple[bytes, str]:
    """Generic (blob, mime, filename) → (pdf_bytes, pipeline).

    Mirrors `_convert(doc, path)` but takes raw bytes + no DB access.
    Uses the `preview_pdf_cache` collection keyed by
    `(cache_namespace, cache_key, sha1, pipeline)` so re-conversions of
    the same source blob are ~free.

    Raises the same `HTTPException(415)` shape as the DocLib pipeline
    when the input format isn't supported.
    """
    sha1 = _sha1_bytes(blob)
    pipeline = _pipeline_for(mime, filename)
    if not pipeline:
        ctype = mime or "application/octet-stream"
        msg = (f"LibreOffice not installed — PDF preview not available for "
               f"this format ({ctype})") if "officedocument" in ctype else \
              f"PDF preview not available for {ctype}"
        raise HTTPException(415, msg)
    cached = await _cache_lookup_v2(cache_namespace, cache_key, sha1, pipeline)
    if cached:
        return cached, pipeline
    # Magic-byte sniff mirrors `_convert`.
    kind = _sniff_kind(blob)
    if pipeline == "passthrough" and kind != "pdf":
        if kind in ("jpeg", "png", "webp", "gif"):
            pipeline = "image"
        elif kind == "heic":
            pipeline = "heic"
        else:
            raise HTTPException(
                415,
                f"File is {kind} ({len(blob)} bytes), not a valid PDF. "
                "Preview unavailable — please re-upload.",
            )
    if pipeline == "passthrough":
        pdf = blob
    elif pipeline == "image":
        pdf = _img_to_pdf(blob)
    elif pipeline == "heic":
        pdf = _heic_to_pdf(blob)
    elif pipeline == "text":
        pdf = _text_to_pdf(blob, filename or "Document")
    elif pipeline == "docx_libreoffice":
        pdf, pipeline = _docx_to_pdf(blob, filename or "Document")
    elif pipeline in {"xlsx_libreoffice", "pptx_libreoffice",
                       "odt_libreoffice", "rtf_libreoffice"}:
        ext = pipeline.split("_", 1)[0]
        pdf, pipeline = _office_to_pdf_or_415(
            blob, ext, filename or f"Document.{ext}", pipeline,
        )
    else:
        raise HTTPException(500, f"Unknown pipeline: {pipeline}")
    await _cache_store_v2(cache_namespace, cache_key, sha1, pipeline, pdf)
    return pdf, pipeline


def pdf_response_bytes(pdf: bytes, filename: str, dl: bool, pipeline: str) -> Response:
    """Public alias for `_pdf_response` so callers outside this module can
    build a PDF Response with the same CSP + inline-disposition headers."""
    return _pdf_response(pdf, filename, dl, pipeline)


def preview_secret_bytes() -> bytes:
    """Public accessor for the HMAC secret used to sign preview tokens.
    Callers that need to mint / verify their own preview tokens (with a
    different subject shape) can import this."""
    return _preview_secret()
