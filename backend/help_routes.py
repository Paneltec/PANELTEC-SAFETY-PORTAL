"""Phase 4.11 (paneltec-v121) — User Manual HTTP routes.

Two endpoints sharing the same markdown source at
`/app/backend/content/user_manual.md`:

  · GET /api/help/manual.md   → raw markdown (text/markdown).
  · GET /api/help/manual.pdf  → branded PDF rendering of the same
                                content via ReportLab using the
                                two-colour Paneltec palette
                                (`pdf_brand.py`).

Both responses are cached in-process for 5 minutes — the manual changes
infrequently and disk reads + ReportLab renders are not cheap.
"""
from __future__ import annotations

import io
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, PageBreak, ListFlowable, ListItem,
    Image,
)
from reportlab.pdfgen import canvas as _canvas

from pdf_brand import ORANGE, SLATE, SLATE_INK, SLATE_MUTED, SLATE_BORDER, PAPER

router = APIRouter(prefix="/help", tags=["help"])

MANUAL_PATH = Path(__file__).parent / "content" / "user_manual.md"
# Phase 4.11.5 (paneltec-v130) — colourful platform schematic + user
# journey diagrams live alongside the markdown so both the browser render
# and the PDF export can embed them.
SCHEMATICS_DIR = Path(__file__).parent / "content" / "schematics"
# Phase 4.15 (paneltec-v132) — Colourful hero-emblems that swap the flat
# Fluent icon on each Dashboard capture tile. Same serving pattern as the
# schematics — mtime-cached, 24h public cache, filename whitelist.
TILES_DIR = Path(__file__).parent / "content" / "tiles"
_TILE_ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp"}
_TILE_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
# Phase 4.11.1 (v122) — cache is keyed off the markdown file's mtime so
# both dev edits AND prod redeploys pick up new content without a backend
# restart. No TTL needed: the moment the file changes, both md+pdf are
# invalidated. Saves the 5-minute hardcoded staleness window without
# adding any env-var branching.
_CACHE: dict = {"mtime": 0.0, "md": None, "pdf": None}


def _file_mtime() -> float:
    try:
        return MANUAL_PATH.stat().st_mtime
    except OSError:
        return 0.0


def _load_markdown() -> str:
    mt = _file_mtime()
    if _CACHE["md"] is not None and _CACHE["mtime"] == mt:
        return _CACHE["md"]
    md = MANUAL_PATH.read_text(encoding="utf-8")
    _CACHE["md"] = md
    _CACHE["pdf"] = None  # invalidate PDF whenever md changes
    _CACHE["mtime"] = mt
    return md


def _styles() -> dict:
    base = getSampleStyleSheet()["Normal"]
    return {
        "h1": ParagraphStyle("h1", parent=base, fontName="Helvetica-Bold",
                             fontSize=22, leading=26, textColor=SLATE,
                             spaceBefore=18, spaceAfter=10),
        "h2": ParagraphStyle("h2", parent=base, fontName="Helvetica-Bold",
                             fontSize=15, leading=19, textColor=ORANGE,
                             spaceBefore=14, spaceAfter=6),
        "h3": ParagraphStyle("h3", parent=base, fontName="Helvetica-Bold",
                             fontSize=12, leading=15, textColor=SLATE_INK,
                             spaceBefore=10, spaceAfter=4),
        "body": ParagraphStyle("body", parent=base, fontName="Helvetica",
                               fontSize=9.5, leading=13.5, textColor=SLATE_INK,
                               spaceAfter=6, alignment=0),
        "bullet": ParagraphStyle("bullet", parent=base, fontName="Helvetica",
                                 fontSize=9.5, leading=13.5,
                                 textColor=SLATE_INK, leftIndent=12,
                                 bulletIndent=2, spaceAfter=3),
        "meta": ParagraphStyle("meta", parent=base, fontName="Helvetica-Oblique",
                               fontSize=8.5, leading=11.5,
                               textColor=SLATE_MUTED, spaceAfter=12),
        "hr": ParagraphStyle("hr", parent=base, fontSize=1, leading=1,
                             spaceBefore=8, spaceAfter=8),
    }


_INLINE = [
    (re.compile(r"\*\*(.+?)\*\*"), r"<b>\1</b>"),
    (re.compile(r"`([^`]+)`"),     r'<font face="Courier">\1</font>'),
    (re.compile(r"\*([^*]+)\*"),   r"<i>\1</i>"),
    (re.compile(r"_([^_]+)_"),     r"<i>\1</i>"),
]


def _md_inline(text: str) -> str:
    """Translate the tiny inline-markdown subset the manual uses
    (bold/italics/inline-code) into ReportLab's mini-HTML."""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    for rx, repl in _INLINE:
        text = rx.sub(repl, text)
    return text


_IMG_RE = re.compile(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$")


def _resolve_schematic_path(url: str) -> Path | None:
    """Map a markdown image URL like `/api/help/schematics/foo.png` back
    onto its on-disk file so ReportLab can embed it. Returns None for any
    non-schematic URL (external images are silently skipped in the PDF
    render — they still render fine in the browser)."""
    marker = "/help/schematics/"
    idx = url.find(marker)
    if idx == -1:
        return None
    fname = url[idx + len(marker):].split("?", 1)[0].split("#", 1)[0]
    if not fname or "/" in fname or ".." in fname:
        return None
    p = SCHEMATICS_DIR / fname
    return p if p.is_file() else None


def _image_flowable(url: str, alt: str) -> Image | None:
    """Full-width proportional Image flowable, or None if the URL cannot
    be resolved to a local schematic."""
    p = _resolve_schematic_path(url)
    if p is None:
        return None
    max_w = A4[0] - 36 * mm     # left+right margin = 18mm each
    from reportlab.lib.utils import ImageReader
    ir = ImageReader(str(p))
    iw, ih = ir.getSize()
    scale = min(1.0, max_w / iw)
    return Image(str(p), width=iw * scale, height=ih * scale, hAlign="CENTER")


def _md_to_flowables(md: str, styles: dict) -> list:
    """Block-level markdown → ReportLab flowables. Intentionally simple
    — headings (`#`/`##`/`###`), paragraphs, bullet lists, horizontal
    rules, italic captions, and — Phase 4.11.5 — full-width inline
    images referenced with `![alt](url)`. No tables / code blocks (the
    manual doesn't use them)."""
    flow = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        ln = lines[i].rstrip()
        if not ln.strip():
            i += 1
            continue
        m_img = _IMG_RE.match(ln)
        if m_img:
            img = _image_flowable(m_img.group(2), m_img.group(1))
            if img is not None:
                flow.append(Spacer(1, 6))
                flow.append(img)
                flow.append(Spacer(1, 4))
            i += 1
            continue
        if ln.startswith("# "):
            flow.append(Paragraph(_md_inline(ln[2:].strip()), styles["h1"]))
        elif ln.startswith("## "):
            flow.append(Paragraph(_md_inline(ln[3:].strip()), styles["h2"]))
        elif ln.startswith("### "):
            flow.append(Paragraph(_md_inline(ln[4:].strip()), styles["h3"]))
        elif ln.startswith("---"):
            flow.append(Spacer(1, 6))
        elif ln.startswith("- "):
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append(ListItem(
                    Paragraph(_md_inline(lines[i][2:].strip()), styles["bullet"]),
                    leftIndent=10, value="bullet",
                ))
                i += 1
            flow.append(ListFlowable(items, bulletType="bullet",
                                     start="•", leftIndent=14))
            continue
        elif re.match(r"^\d+\.\s", ln):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i]):
                items.append(ListItem(
                    Paragraph(_md_inline(re.sub(r"^\d+\.\s", "", lines[i])),
                              styles["bullet"]),
                    leftIndent=10, value="1",
                ))
                i += 1
            flow.append(ListFlowable(items, bulletType="1", leftIndent=14))
            continue
        elif ln.startswith("_") and ln.endswith("_"):
            flow.append(Paragraph(_md_inline(ln.strip("_")), styles["meta"]))
        else:
            # Paragraph — accumulate until blank line.
            buf = [ln]
            j = i + 1
            while j < len(lines) and lines[j].strip() and not (
                lines[j].startswith(("- ", "#", "---", "_"))
                or re.match(r"^\d+\.\s", lines[j])
            ):
                buf.append(lines[j].strip())
                j += 1
            flow.append(Paragraph(_md_inline(" ".join(buf)), styles["body"]))
            i = j
            continue
        i += 1
    return flow


def _draw_brand_header(canvas: _canvas.Canvas, doc: SimpleDocTemplate) -> None:
    """Page chrome: orange chevron + wordmark top-left, page # bottom-right."""
    canvas.saveState()
    # Header band
    canvas.setFillColor(SLATE)
    canvas.rect(0, A4[1] - 18 * mm, A4[0], 18 * mm, fill=1, stroke=0)
    # Chevron
    canvas.setFillColor(ORANGE)
    cx, cy = 18 * mm, A4[1] - 10 * mm
    p = canvas.beginPath()
    p.moveTo(cx, cy + 4 * mm)
    p.lineTo(cx + 5 * mm, cy - 3 * mm)
    p.lineTo(cx + 2 * mm, cy - 3 * mm)
    p.lineTo(cx, cy - 1 * mm)
    p.lineTo(cx - 2 * mm, cy - 3 * mm)
    p.lineTo(cx - 5 * mm, cy - 3 * mm)
    p.close()
    canvas.drawPath(p, fill=1, stroke=0)
    # Wordmark
    canvas.setFillColor(PAPER)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(28 * mm, A4[1] - 11 * mm, "Paneltec Civil")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(SLATE_BORDER)
    canvas.drawString(28 * mm, A4[1] - 15 * mm, "User Manual · paneltec-v121")
    # Footer page number
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(SLATE_MUTED)
    canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, f"Page {doc.page}")
    canvas.restoreState()


def _build_pdf() -> bytes:
    mt = _file_mtime()
    if _CACHE["pdf"] is not None and _CACHE["mtime"] == mt:
        return _CACHE["pdf"]
    md = _load_markdown()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=26 * mm, bottomMargin=18 * mm,
        title="Paneltec Civil — User Manual", author="Paneltec Civil",
    )
    styles = _styles()
    flow = _md_to_flowables(md, styles)
    doc.build(flow, onFirstPage=_draw_brand_header,
              onLaterPages=_draw_brand_header)
    _CACHE["pdf"] = buf.getvalue()
    return _CACHE["pdf"]


@router.get("/manual.md")
def manual_markdown() -> Response:
    """Raw markdown source. Cached for 5 min."""
    md = _load_markdown()
    return Response(content=md, media_type="text/markdown; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=300"})


@router.get("/manual.pdf")
def manual_pdf() -> Response:
    """Branded PDF render of the manual. Cached for 5 min."""
    pdf = _build_pdf()
    return Response(content=pdf, media_type="application/pdf",
                    headers={
                        "Cache-Control": "public, max-age=300",
                        "Content-Disposition":
                            'inline; filename="paneltec-civil-user-manual.pdf"',
                    })


# Phase 4.11.5 (paneltec-v130) — Serves the schematic PNGs both to the
# browser (embedded in the manual markdown via `![]()`) and, indirectly,
# to the PDF renderer which reads them straight off disk via
# `_resolve_schematic_path`.
@router.get("/tiles/{filename}")
def get_tile(filename: str) -> Response:
    """Phase 4.15 (v132) — Colourful dashboard tile emblems. Rejects
    path-traversal, restricts to a small extension whitelist, and mirrors
    the schematics endpoint's 24h client cache."""
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=404, detail="Not found")
    ext = Path(filename).suffix.lower()
    if ext not in _TILE_ALLOWED_EXT:
        raise HTTPException(status_code=404, detail="Not found")
    p = TILES_DIR / filename
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return Response(
        content=p.read_bytes(),
        media_type=_TILE_CONTENT_TYPES.get(ext, "application/octet-stream"),
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )
def get_schematic(filename: str) -> Response:
    # Reject path-traversal attempts up front — filename must be a bare
    # name, no separators, and terminate with .png.
    if "/" in filename or ".." in filename or not filename.endswith(".png"):
        raise HTTPException(status_code=404, detail="Not found")
    p = SCHEMATICS_DIR / filename
    if not p.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    data = p.read_bytes()
    return Response(
        content=data, media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )
