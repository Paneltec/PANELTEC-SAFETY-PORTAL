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
import base64
import hashlib
import hmac
import io
import json
import logging
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
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
from models import now_iso  # noqa: E402  — Phase 3.14 OCR-index timestamp helper
from auth import get_current_user


log = logging.getLogger("paneltec.files.pdf")
router = APIRouter(prefix="", tags=["files-pdf"])

UPLOAD_DIR = Path(__file__).parent / "uploads" / "document_library"
PIPELINES = {
    "passthrough", "image", "heic", "text",
    "docx_libreoffice", "docx_docx2pdf", "docx_text_fallback",
    "xlsx_libreoffice", "pptx_libreoffice", "odt_libreoffice", "rtf_libreoffice",
}

# Phase 3.13 — LibreOffice primary path. Override via env to fault-test.
LIBREOFFICE_BIN_OVERRIDE = os.environ.get("PANELTEC_LIBREOFFICE_BIN")
LIBREOFFICE_TIMEOUT_S = int(os.environ.get("PANELTEC_LIBREOFFICE_TIMEOUT_S", "60"))


def _libreoffice_binary() -> str | None:
    """Resolve the soffice/libreoffice executable, honouring an env override.
    Set PANELTEC_LIBREOFFICE_BIN to a non-existent path during fault tests to
    force the pragmatic fallback."""
    import shutil
    if LIBREOFFICE_BIN_OVERRIDE is not None:
        return LIBREOFFICE_BIN_OVERRIDE if Path(LIBREOFFICE_BIN_OVERRIDE).exists() else None
    return shutil.which("soffice") or shutil.which("libreoffice")


def _libreoffice_to_pdf(src_path: Path, out_dir: Path, timeout: int = LIBREOFFICE_TIMEOUT_S) -> Path:
    """Convert an office doc → PDF via headless LibreOffice. Returns the
    output PDF path or raises. Each call gets its own UserInstallation profile
    so concurrent requests don't clobber each other's lockfiles."""
    bin_path = _libreoffice_binary()
    if not bin_path:
        raise RuntimeError("LibreOffice not installed")
    profile = out_dir / f"_lo_profile_{os.getpid()}_{int(time.time()*1000)}"
    profile.mkdir(parents=True, exist_ok=True)
    cmd = [
        bin_path, "--headless",
        f"-env:UserInstallation=file://{profile}",
        "--convert-to", "pdf", "--outdir", str(out_dir), str(src_path),
    ]
    res = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if res.returncode != 0:
        tail = (res.stderr or res.stdout or b"").decode("utf-8", errors="replace")[-300:]
        raise RuntimeError(f"libreoffice rc={res.returncode}: {tail}")
    expected = out_dir / (src_path.stem + ".pdf")
    if not expected.exists():
        raise RuntimeError("LibreOffice produced no PDF output file")
    return expected


def _office_to_pdf_via_lo(blob: bytes, ext: str, name: str) -> bytes:
    """Pipe blob → temp file → LibreOffice → PDF bytes. Raises on any
    failure; caller decides whether to fall back."""
    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        src = td_p / f"in.{ext.lstrip('.')}"
        src.write_bytes(blob)
        out = _libreoffice_to_pdf(src, td_p)
        return out.read_bytes()


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
    # Phase 3.13 — LibreOffice primary path for all office formats.
    # .docx still has a pragmatic ReportLab text fallback for ultra-defensive
    # delivery; xlsx/pptx/odt/rtf are LO-only (raises 415 on LO failure).
    if n.endswith(".docx") or m == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return "docx_libreoffice"
    if n.endswith(".xlsx") or m == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return "xlsx_libreoffice"
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
    """Best-effort docx → PDF. Tries LibreOffice headless first (high fidelity),
    then docx2pdf (legacy Windows-on-PATH path), and finally the pragmatic
    ReportLab text fallback so we **never** return blank.

    Each fallback reason is logged at INFO so the production log shows the
    pipeline actually used (visible via `tail /var/log/supervisor/backend.out.log`)."""
    # 1. LibreOffice headless — primary path.
    try:
        pdf = _office_to_pdf_via_lo(blob, "docx", name)
        if len(pdf) >= 1024 and _is_pdf(pdf):
            log.info("libreoffice: ok docx=%s bytes=%d", name, len(pdf))
            return pdf, "docx_libreoffice"
        log.info("libreoffice fallback: docx produced %d bytes (<1KB or not PDF)", len(pdf))
    except Exception as e:
        log.info("libreoffice fallback: %s", e)

    # 2. docx2pdf — legacy path (only effective if Word/LO is on PATH, but
    # still gives us a third shot before the lossy fallback).
    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        src = td_p / "in.docx"
        src.write_bytes(blob)
        dst = td_p / "in.pdf"
        try:
            import docx2pdf
            docx2pdf.convert(str(src), str(dst))
            if dst.exists():
                data = dst.read_bytes()
                if len(data) >= 1024 and _is_pdf(data):
                    log.info("docx2pdf: ok docx=%s bytes=%d", name, len(data))
                    return data, "docx_docx2pdf"
        except Exception as e:
            log.info("docx2pdf fallback: %s", e)

    # 3. Pragmatic ReportLab text renderer — never blank.
    log.info("docx text fallback engaged for %s", name)
    return _docx_text_fallback(blob, name), "docx_text_fallback"


def _office_to_pdf_or_415(blob: bytes, ext: str, name: str, pipeline: str) -> tuple[bytes, str]:
    """xlsx / pptx / odt / rtf have no pragmatic fallback. Convert via LO or
    raise a 415 with a useful hint."""
    try:
        pdf = _office_to_pdf_via_lo(blob, ext, name)
        if _is_pdf(pdf) and len(pdf) >= 100:
            log.info("libreoffice: ok %s=%s bytes=%d", ext, name, len(pdf))
            return pdf, pipeline
        raise RuntimeError(f"produced invalid PDF: {len(pdf)} bytes")
    except subprocess.TimeoutExpired:
        log.info("libreoffice timeout for %s — giving up", name)
        raise HTTPException(504, f"LibreOffice timed out converting {name}. Try again or open locally.")
    except Exception as e:
        log.info("libreoffice failed for %s: %s", name, e)
        raise HTTPException(415, f"Couldn't render {ext.upper()} preview: {e}")


# ────────────────── OCR utility (opt-in) ──────────────────

def ocr_pdf_to_text(pdf_path: Path | str, lang: str = "eng", timeout: int = 90) -> str:
    """Extract plaintext from a PDF. Tries `pdftotext` first (fast — works for
    text-layer PDFs), falls back to Tesseract via Poppler's `pdftoppm` when
    the file is image-only. **Not** wired into the upload path — call this
    explicitly from a search-indexer job or admin tool.

    Raises FileNotFoundError if the binaries aren't installed."""
    import shutil
    src = Path(pdf_path)
    if not src.exists():
        raise FileNotFoundError(src)
    if not shutil.which("pdftotext"):
        raise FileNotFoundError("pdftotext (poppler-utils) not installed")
    # Fast path — pdftotext.
    res = subprocess.run(["pdftotext", "-layout", str(src), "-"],
                         capture_output=True, timeout=timeout)
    text = (res.stdout or b"").decode("utf-8", errors="replace").strip()
    if text:
        return text
    # Slow path — rasterise + tesseract OCR.
    if not shutil.which("pdftoppm") or not shutil.which("tesseract"):
        return ""
    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        subprocess.run(["pdftoppm", "-r", "200", str(src), str(td_p / "page"), "-png"],
                       capture_output=True, timeout=timeout)
        out_chunks: list[str] = []
        for img in sorted(td_p.glob("page-*.png")):
            r = subprocess.run(["tesseract", str(img), "-", "-l", lang],
                               capture_output=True, timeout=timeout)
            out_chunks.append((r.stdout or b"").decode("utf-8", errors="replace"))
        return "\n".join(out_chunks).strip()


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
    elif pipeline == "docx_libreoffice":
        pdf, pipeline = _docx_to_pdf(blob, doc.get("filename") or "Document")
    elif pipeline in {"xlsx_libreoffice", "pptx_libreoffice", "odt_libreoffice", "rtf_libreoffice"}:
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
    doc, path = await _resolve_file(file_id, user)
    pdf, pipeline = await _convert(doc, path)
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


@router.get("/admin/server-tools/health")
async def server_tools_health(user: dict = Depends(get_current_user)):
    """Phase 3.13 — health-check shape requested by the Settings page.
    Returns `{libreoffice:{ok,version,path}, tesseract:{...}, poppler:{...}}`.
    Same data as `/admin/system-tools` but normalised to the `ok` key the
    UI uses to colour the chip green/red without a key-mapping helper."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    s = await _tool_status()
    def _norm(t: dict) -> dict:
        return {"ok": bool(t.get("installed")), "version": t.get("version"), "path": t.get("path")}
    return {
        "libreoffice": _norm(s["libreoffice"]),
        "tesseract":   _norm(s["tesseract"]),
        "poppler":     _norm(s["poppler"]),
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
    Cheap when the PDF has a text layer (pdftotext fast path); slow only
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
