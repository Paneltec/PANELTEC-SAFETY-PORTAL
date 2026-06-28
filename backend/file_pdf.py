"""Phase 3.10 — Universal PDF preview for any Document Library file.

Endpoints (all prefixed `/api`):
    GET  /files/{id}/pdf        — stream PDF (inline or attachment via ?dl=1)
    GET  /files/{id}/pdf.pdf    — same, path-disguised variant for ad-blocker
                                  compatibility (mirrors `forms_pdf` pattern)
    POST /files/pdf-bundle      — concatenate multiple files into one PDF
    POST /admin/install-libreoffice — admin-only install hook (stub trigger)

Conversion pipeline (Pragmatic Phase A — LibreOffice **not** installed):
    application/pdf                         → passthrough
    image/jpeg|png|webp                     → Pillow + reportlab A4 fit-to-page
    image/heic|heif                         → pillow-heif → JPG → reportlab
    text/csv | text/plain | text/markdown   → reportlab monospace paginated
    .docx (Word)                            → docx2pdf (best effort) → if <1KB
                                              output fall back to python-docx
                                              + reportlab plain-text renderer
                                              (lossy but never blank)
    .xlsx / .pptx / .odt / .rtf / other     → 415 "LibreOffice not installed —
                                              PDF preview not available for
                                              this format"

Cache: converted PDFs live in `doc_files_pdf_cache` keyed by
       (file_id, sha1, pipeline). Cache miss writes the row; subsequent calls
       stream from cache. Invalidated when the source file is replaced
       (different sha1).
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (
    Paragraph, Preformatted, SimpleDocTemplate, Spacer,
)

from db import db
from auth import get_current_user


log = logging.getLogger("paneltec.files.pdf")
router = APIRouter(prefix="", tags=["files-pdf"])

UPLOAD_DIR = Path(__file__).parent / "uploads" / "document_library"
PIPELINES = {"passthrough", "image", "heic", "text", "docx_docx2pdf", "docx_text_fallback"}


# ────────────────── helpers ──────────────────

def _sha1_file(p: Path) -> str:
    h = hashlib.sha1()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _is_pdf(blob: bytes) -> bool:
    return blob[:5] == b"%PDF-"


async def _resolve_file(file_id: str, user: dict) -> tuple[dict, Path]:
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "File not found")
    path = UPLOAD_DIR / doc["folder_id"] / doc["stored_name"]
    if not path.exists():
        raise HTTPException(404, "File missing on disk")
    return doc, path


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
    if n.endswith(".docx") or m == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return "docx_docx2pdf"
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
    """Lossy but never-blank: pull paragraphs + tables from a .docx and render
    them as reportlab paragraphs. Tables are flattened to tab-separated lines."""
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
    return _text_to_pdf(("\n".join(lines)).encode("utf-8"), name)


def _docx_to_pdf(blob: bytes, name: str) -> tuple[bytes, str]:
    """Best-effort docx → PDF. Returns (pdf_bytes, pipeline_used). The
    docx2pdf module silently produces near-empty output if LibreOffice/Word
    isn't on PATH — guard with a <1 KB size check and fall back to the
    text-only renderer."""
    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        src = td_p / "in.docx"
        src.write_bytes(blob)
        dst = td_p / "in.pdf"
        try:
            import docx2pdf
            docx2pdf.convert(str(src), str(dst))
        except Exception as e:
            log.info("docx2pdf raised, using text fallback: %s", e)
            return _docx_text_fallback(blob, name), "docx_text_fallback"
        if dst.exists():
            data = dst.read_bytes()
            if len(data) >= 1024 and _is_pdf(data):
                return data, "docx_docx2pdf"
            log.info("docx2pdf produced %d bytes (<1KB or not PDF) — falling back", len(data))
        return _docx_text_fallback(blob, name), "docx_text_fallback"


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


async def _convert(doc: dict, path: Path) -> tuple[bytes, str]:
    sha1 = _sha1_file(path)
    pipeline = _pipeline_for(doc.get("mime"), doc.get("filename") or "")
    if not pipeline:
        ctype = doc.get("mime") or "application/octet-stream"
        msg = (f"LibreOffice not installed — PDF preview not available for "
               f"this format ({ctype})") if "officedocument" in ctype else \
              f"PDF preview not available for {ctype}"
        raise HTTPException(415, msg)
    cached = await _cache_lookup(doc["id"], sha1, pipeline)
    if cached:
        return cached, pipeline
    blob = path.read_bytes()
    if pipeline == "passthrough":
        pdf = blob if _is_pdf(blob) else b""
        if not pdf:
            raise HTTPException(415, "File claims PDF but is not — refusing to serve.")
    elif pipeline == "image": pdf = _img_to_pdf(blob)
    elif pipeline == "heic":  pdf = _heic_to_pdf(blob)
    elif pipeline == "text":  pdf = _text_to_pdf(blob, doc.get("filename") or "Document")
    elif pipeline == "docx_docx2pdf":
        pdf, pipeline = _docx_to_pdf(blob, doc.get("filename") or "Document")
    else:
        raise HTTPException(500, f"Unknown pipeline: {pipeline}")
    await _cache_store(doc["id"], sha1, pipeline, pdf)
    return pdf, pipeline


def _pdf_response(pdf: bytes, original_name: str, dl: bool, pipeline: str) -> Response:
    base = original_name.rsplit(".", 1)[0] or "document"
    fname = f"{base}.pdf"
    disp = "attachment" if dl else "inline"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disp}; filename="{fname}"',
            "X-Pipeline": pipeline,
            "Cache-Control": "private, max-age=3600",
        },
    )


# ────────────────── endpoints ──────────────────

@router.get("/files/{file_id}/pdf")
async def file_pdf(file_id: str, dl: int = Query(0), user: dict = Depends(get_current_user)):
    doc, path = await _resolve_file(file_id, user)
    pdf, pipeline = await _convert(doc, path)
    return _pdf_response(pdf, doc.get("filename") or file_id, bool(dl), pipeline)


@router.get("/files/{file_id}/pdf.pdf")
async def file_pdf_aliased(file_id: str, dl: int = Query(0), user: dict = Depends(get_current_user)):
    """Ad-blocker-friendly path-only variant (mirrors forms_pdf pattern)."""
    return await file_pdf(file_id, dl=dl, user=user)


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
            doc, path = await _resolve_file(fid, user)
            pdf, _ = await _convert(doc, path)
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


# ────────────────── admin install hook ──────────────────

@router.post("/admin/install-libreoffice")
async def install_libreoffice(
    include_ocr: bool = Query(True, description="Also install Tesseract + Poppler for OCR"),
    user: dict = Depends(get_current_user),
):
    """Admin-only one-click toolchain installer. Runs `apt-get install`
    synchronously and returns the install log. Does NOT auto-trigger — the
    user must explicitly call this during a maintenance window."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Only admin can install system packages")
    pkgs = [
        "libreoffice-core", "libreoffice-writer",
        "libreoffice-calc", "libreoffice-impress",
    ]
    if include_ocr:
        pkgs += ["tesseract-ocr", "poppler-utils"]
    cmd = [
        "bash", "-lc",
        f"apt-get update -qq && apt-get install -y --no-install-recommends "
        f"{' '.join(pkgs)} 2>&1 | tail -300; "
        f"echo '---'; which libreoffice || which soffice || true; "
        f"echo '---'; which tesseract || true; "
        f"echo '---'; which pdftotext || true",
    ]
    try:
        p = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        out_b, _ = await asyncio.wait_for(p.communicate(), timeout=900)
        out = out_b.decode("utf-8", errors="replace")
        rc = p.returncode
    except asyncio.TimeoutError:
        raise HTTPException(504, "Install timed out after 15 minutes")
    return {
        "rc": rc, "include_ocr": include_ocr,
        "tools": await _tool_status(),
        "log_tail": out[-6000:],
    }


async def _tool_status() -> dict:
    """which-style status of optional server toolchains."""
    async def _which(name: str) -> str | None:
        p = await asyncio.create_subprocess_exec(
            "bash", "-lc", f"which {name} 2>/dev/null || true",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await p.communicate()
        path = out.decode().strip().splitlines()[0] if out else ""
        return path or None

    async def _version(bin_path: str, flag: str = "--version") -> str | None:
        if not bin_path:
            return None
        p = await asyncio.create_subprocess_exec(
            "bash", "-lc", f"{bin_path} {flag} 2>&1 | head -1",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await p.communicate()
        return (out.decode().strip() or None)

    lo = await _which("libreoffice") or await _which("soffice")
    ts = await _which("tesseract")
    pp = await _which("pdftotext")
    return {
        "libreoffice": {"installed": bool(lo), "path": lo, "version": await _version(lo) if lo else None},
        "tesseract":   {"installed": bool(ts), "path": ts, "version": await _version(ts) if ts else None},
        "poppler":     {"installed": bool(pp), "path": pp, "version": await _version(pp, "-v") if pp else None},
    }


@router.get("/admin/system-tools")
async def system_tools(user: dict = Depends(get_current_user)):
    """Status of optional server toolchains (admin-only). Drives the
    Settings → System page in the UI."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    return {"tools": await _tool_status()}
