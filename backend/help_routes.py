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
import time
from pathlib import Path

from fastapi import APIRouter, Response
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph, SimpleDocTemplate, Spacer, PageBreak, ListFlowable, ListItem,
)
from reportlab.pdfgen import canvas as _canvas

from pdf_brand import ORANGE, SLATE, SLATE_INK, SLATE_MUTED, SLATE_BORDER, PAPER

router = APIRouter(prefix="/help", tags=["help"])

MANUAL_PATH = Path(__file__).parent / "content" / "user_manual.md"
_CACHE: dict = {"md": None, "pdf": None, "ts": 0.0}
_TTL_SECONDS = 300


def _load_markdown() -> str:
    now = time.time()
    if _CACHE["md"] is not None and (now - _CACHE["ts"]) < _TTL_SECONDS:
        return _CACHE["md"]
    md = MANUAL_PATH.read_text(encoding="utf-8")
    _CACHE["md"] = md
    _CACHE["pdf"] = None  # invalidate PDF when md is reloaded
    _CACHE["ts"] = now
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


def _md_to_flowables(md: str, styles: dict) -> list:
    """Block-level markdown → ReportLab flowables. Intentionally simple
    — headings (`#`/`##`/`###`), paragraphs, bullet lists, horizontal
    rules, and italic captions. No tables / code blocks (the manual
    doesn't use them)."""
    flow = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        ln = lines[i].rstrip()
        if not ln.strip():
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
    now = time.time()
    if _CACHE["pdf"] is not None and (now - _CACHE["ts"]) < _TTL_SECONDS:
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
