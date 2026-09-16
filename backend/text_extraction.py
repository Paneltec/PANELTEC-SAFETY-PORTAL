"""v58.13.132hf — Text extraction pipeline for Document Library.

Layered strategy (cheapest to most expensive):
  1. Text-native  — pdfplumber / python-docx / openpyxl / plain read.
     Free, on-pod, sub-second per file. Handles ~75% of the library.
  2. Tesseract OCR — scanned PDFs (rendered via pdf2image) and image
     files. Free, on-pod, seconds per page. Handles the remaining
     ~25%.
  3. Claude Vision — on-demand admin retry only, per user directive.
     Not invoked here; a follow-up admin action ships in `.132hg`+.

Every extraction returns:
  { "text": str, "engine": str, "status": "ok" | "failed",
    "chars": int }

The extraction is designed to be safe to call from any request
handler: it never raises, always returns a status, and caps its
output so a runaway OCR pass can't blow memory.
"""
from __future__ import annotations

import io
import logging
from typing import Optional

log = logging.getLogger("paneltec.text_extraction")

# Hard caps so a 400-page SDS doesn't stall a request or blow the DB
# document limit (Mongo BSON cap is 16 MB; we're well under).
MAX_EXTRACTED_CHARS = 200_000       # ~50k words per file
OCR_MAX_PAGES = 40                  # Tesseract-scanned page cap
OCR_DPI = 200                       # Balances accuracy vs. speed

# MIME → engine dispatcher. The `text-native` engines fall through
# to Tesseract if they return a suspiciously small char count (see
# `_looks_empty`).
PDF_MIMES = {"application/pdf"}
DOCX_MIMES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}
XLSX_MIMES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
}
IMAGE_MIMES = {"image/png", "image/jpeg", "image/jpg", "image/webp",
               "image/heic", "image/heif", "image/tiff"}
TEXT_MIMES = {"text/plain", "text/csv", "application/json",
              "text/markdown", "text/html", "application/xml"}


def _cap(text: str) -> str:
    if not text:
        return ""
    if len(text) > MAX_EXTRACTED_CHARS:
        return text[:MAX_EXTRACTED_CHARS] + "…[truncated]"
    return text


def _looks_empty(text: str, expected_min: int = 20) -> bool:
    """True when text-native extraction returned so little content
    that a scanned-image fallback is warranted."""
    stripped = (text or "").strip()
    return len(stripped) < expected_min


def _extract_pdf_native(data: bytes) -> str:
    import pdfplumber
    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages):
            if i >= OCR_MAX_PAGES:
                parts.append("[truncated — page cap]")
                break
            try:
                t = page.extract_text() or ""
                if t:
                    parts.append(t)
            except Exception as e:  # per-page failures shouldn't tank the file
                log.debug("pdfplumber page %d skipped: %s", i, e)
    return "\n".join(parts).strip()


def _extract_pdf_ocr(data: bytes) -> str:
    """Rasterise the PDF then Tesseract each page. Slow — used only
    when the text-native pass yielded nothing usable."""
    import pytesseract
    from pdf2image import convert_from_bytes
    images = convert_from_bytes(
        data, dpi=OCR_DPI, first_page=1, last_page=OCR_MAX_PAGES,
        fmt="png",
    )
    parts: list[str] = []
    for img in images:
        try:
            parts.append(pytesseract.image_to_string(img) or "")
        except Exception as e:
            log.debug("tesseract page failed: %s", e)
    return "\n".join(parts).strip()


def _extract_docx(data: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(data))
    parts: list[str] = []
    for p in doc.paragraphs:
        if p.text:
            parts.append(p.text)
    for tbl in doc.tables:
        for row in tbl.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                parts.append(row_text)
    return "\n".join(parts).strip()


def _extract_xlsx(data: bytes) -> str:
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    for name in wb.sheetnames:
        ws = wb[name]
        parts.append(f"# Sheet: {name}")
        for row in ws.iter_rows(values_only=True):
            row_text = " | ".join(str(v) for v in row if v is not None)
            if row_text:
                parts.append(row_text)
        if len("\n".join(parts)) > MAX_EXTRACTED_CHARS:
            break
    return "\n".join(parts).strip()


def _extract_image(data: bytes) -> str:
    import pytesseract
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    if img.mode not in ("L", "RGB"):
        img = img.convert("RGB")
    return (pytesseract.image_to_string(img) or "").strip()


def _extract_text(data: bytes) -> str:
    # Best-effort decode; fall back through common encodings.
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def extract_text(
    data: bytes,
    *,
    mime: Optional[str] = None,
    filename: Optional[str] = None,
) -> dict:
    """Public entry point. Never raises. Returns:
      { text, engine, status, chars }
    `status` is 'ok' when we got text, 'failed' otherwise. `engine`
    labels which extractor produced the payload.
    """
    if not data:
        return {"text": "", "engine": "none", "status": "failed", "chars": 0}
    mime_l = (mime or "").lower().strip()
    fn_l = (filename or "").lower().strip()

    def _ok(text: str, engine: str) -> dict:
        capped = _cap(text)
        return {
            "text": capped,
            "engine": engine,
            "status": "ok" if capped else "failed",
            "chars": len(capped),
        }

    def _fail(engine: str) -> dict:
        return {"text": "", "engine": engine, "status": "failed", "chars": 0}

    try:
        # PDF: text-native → OCR fallback if too empty.
        if mime_l in PDF_MIMES or fn_l.endswith(".pdf"):
            try:
                native = _extract_pdf_native(data)
            except Exception as e:
                log.info("pdfplumber failed on %s: %s", filename, e)
                native = ""
            if not _looks_empty(native, expected_min=40):
                return _ok(native, "pdfplumber")
            try:
                ocr = _extract_pdf_ocr(data)
            except Exception as e:
                log.info("tesseract PDF fallback failed on %s: %s", filename, e)
                return _fail("tesseract")
            if _looks_empty(ocr):
                return _fail("tesseract")
            return _ok(ocr, "tesseract")

        if mime_l in DOCX_MIMES or fn_l.endswith((".docx", ".doc")):
            try:
                return _ok(_extract_docx(data), "python-docx")
            except Exception as e:
                log.info("python-docx failed on %s: %s", filename, e)
                return _fail("python-docx")

        if mime_l in XLSX_MIMES or fn_l.endswith((".xlsx", ".xls")):
            try:
                return _ok(_extract_xlsx(data), "openpyxl")
            except Exception as e:
                log.info("openpyxl failed on %s: %s", filename, e)
                return _fail("openpyxl")

        if mime_l in IMAGE_MIMES or fn_l.endswith(
            (".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".tiff", ".tif"),
        ):
            try:
                return _ok(_extract_image(data), "tesseract")
            except Exception as e:
                log.info("tesseract image failed on %s: %s", filename, e)
                return _fail("tesseract")

        if mime_l in TEXT_MIMES or fn_l.endswith(
            (".txt", ".csv", ".md", ".json", ".xml", ".html"),
        ):
            return _ok(_extract_text(data), "plain")

    except Exception as e:  # extra safety net
        log.warning("extract_text unexpected failure on %s: %s", filename, e)
        return _fail("unknown")

    return _fail("unsupported")
