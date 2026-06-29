"""Phase 3.22 — Shared PDF template for every Paneltec Civil report.

Single source of truth for header strip, footer, section labels, field
grid, timeline, signatures, and the BaseDocTemplate factory. Every
report generator MUST migrate to this. Reports must look like siblings,
not strangers.

Layout philosophy:
  * 14mm slate header strip + orange status chip + orange brand mark
  * 8pt UPPERCASE orange section labels with a 1pt orange rule
  * Tight 18pt field rows, 9pt body, generous use of vertical space
  * Footer at 12mm — small muted timestamp + orange page number
  * Always render every standard section (Description, Attachments,
    Timeline, Signatures) even when empty — fills the page, gives the
    auditor a consistent shape, removes the 85%-whitespace problem.
"""
from __future__ import annotations
import io
from datetime import datetime
from typing import Iterable, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle, KeepTogether)
from reportlab.pdfgen.canvas import Canvas

from pdf_brand import (ORANGE, ORANGE_DEEP, ORANGE_PALE, SLATE, SLATE_INK,
                       SLATE_MUTED, SLATE_BORDER, SLATE_BAND, WHITE,
                       severity_palette)

# ──────────────────────────────────────────────────────────────────────
# Paragraph styles — shared across every report.
# ──────────────────────────────────────────────────────────────────────
_BASE = getSampleStyleSheet()

H1 = ParagraphStyle('PtcH1', parent=_BASE['Normal'], fontName='Helvetica-Bold',
                   fontSize=18, leading=22, textColor=SLATE, spaceAfter=2)
H2 = ParagraphStyle('PtcH2', parent=_BASE['Normal'], fontName='Helvetica',
                   fontSize=11, leading=14, textColor=SLATE_MUTED, spaceAfter=10)
SECTION = ParagraphStyle('PtcSection', parent=_BASE['Normal'], fontName='Helvetica-Bold',
                         fontSize=8, leading=10, textColor=ORANGE,
                         spaceBefore=10, spaceAfter=2, tracking=1.4)
BODY = ParagraphStyle('PtcBody', parent=_BASE['Normal'], fontName='Helvetica',
                     fontSize=9, leading=12.5, textColor=SLATE_INK, spaceAfter=3)
BODY_MUTED = ParagraphStyle('PtcBodyMuted', parent=BODY, textColor=SLATE_MUTED,
                            fontSize=8.5, leading=11)
META = ParagraphStyle('PtcMeta', parent=_BASE['Normal'], fontName='Helvetica',
                     fontSize=7.5, leading=10, textColor=SLATE_MUTED)
BULLET = ParagraphStyle('PtcBullet', parent=BODY, leftIndent=10, bulletIndent=0,
                       spaceAfter=2)
TIMELINE = ParagraphStyle('PtcTimeline', parent=BODY, fontSize=8.5, leading=11.5,
                          spaceAfter=2)

# ──────────────────────────────────────────────────────────────────────
# Page chrome — header strip + footer.
# ──────────────────────────────────────────────────────────────────────
HEADER_HEIGHT = 14 * mm
FOOTER_GAP    = 12 * mm
MARGIN_LR     = 18 * mm
MARGIN_TOP    = HEADER_HEIGHT + 4 * mm   # body starts 4mm under the header
MARGIN_BOT    = FOOTER_GAP + 6 * mm


def _draw_header(canv: Canvas, doc, title_eyebrow: str, status: Optional[str]):
    """Slate header strip with orange brand mark + optional status chip."""
    w, h = A4
    # Slate background strip
    canv.setFillColor(SLATE)
    canv.rect(0, h - HEADER_HEIGHT, w, HEADER_HEIGHT, fill=1, stroke=0)
    # Orange chevron mark (brand signature)
    canv.setFillColor(ORANGE)
    p = canv.beginPath()
    cx, cy = MARGIN_LR, h - HEADER_HEIGHT / 2
    p.moveTo(cx - 4, cy - 3)
    p.lineTo(cx, cy + 4)
    p.lineTo(cx + 4, cy - 3)
    p.close()
    canv.drawPath(p, stroke=0, fill=1)
    # Wordmark
    canv.setFillColor(WHITE)
    canv.setFont('Helvetica-Bold', 10.5)
    canv.drawString(cx + 8, h - HEADER_HEIGHT / 2 + 0.5, 'PANELTEC CIVIL')
    canv.setFont('Helvetica', 7)
    canv.setFillColor(colors.HexColor('#94A3B8'))   # muted slate-400 on slate bg
    canv.drawString(cx + 8, h - HEADER_HEIGHT / 2 - 5, (title_eyebrow or 'WHS COMPLIANCE').upper())
    # Status chip — orange pill on the right
    if status:
        fg, bg = severity_palette(status)
        label = status.upper()[:18]
        tw = canv.stringWidth(label, 'Helvetica-Bold', 7) + 12
        chip_h = 9
        cx2 = w - MARGIN_LR - tw
        cy2 = h - HEADER_HEIGHT / 2 - chip_h / 2
        canv.setFillColor(bg)
        canv.roundRect(cx2, cy2, tw, chip_h, chip_h / 2, fill=1, stroke=0)
        canv.setFillColor(fg)
        canv.setFont('Helvetica-Bold', 7)
        canv.drawCentredString(cx2 + tw / 2, cy2 + 2, label)


def _draw_footer(canv: Canvas, doc, doc_id: Optional[str]):
    w, _ = A4
    ts = datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
    canv.setFont('Helvetica', 7.5)
    canv.setFillColor(SLATE_MUTED)
    left = f'Generated {ts}'
    if doc_id:
        left += f'  ·  paneltec-civil-{doc_id[:8]}'
    canv.drawString(MARGIN_LR, FOOTER_GAP, left)
    # Orange page number — only colour on the footer line
    canv.setFillColor(ORANGE)
    canv.setFont('Helvetica-Bold', 7.5)
    canv.drawRightString(w - MARGIN_LR, FOOTER_GAP, f'Page {doc.page}')


def make_doc(buffer: io.BytesIO, eyebrow: str, status: Optional[str],
             doc_id: Optional[str] = None) -> BaseDocTemplate:
    doc = BaseDocTemplate(buffer, pagesize=A4,
                          leftMargin=MARGIN_LR, rightMargin=MARGIN_LR,
                          topMargin=MARGIN_TOP, bottomMargin=MARGIN_BOT,
                          title=eyebrow)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='body',
                  topPadding=0, bottomPadding=0, leftPadding=0, rightPadding=0)
    def _on_page(canv, d):
        _draw_header(canv, d, eyebrow, status)
        _draw_footer(canv, d, doc_id)
    doc.addPageTemplates([PageTemplate(id='ptc', frames=[frame], onPage=_on_page)])
    return doc


# ──────────────────────────────────────────────────────────────────────
# Flowable helpers.
# ──────────────────────────────────────────────────────────────────────
def title_block(title: str, subtitle: Optional[str] = None) -> list:
    """The H1 + muted subtitle + thin orange rule that introduces every report."""
    items: list = [Paragraph(title or 'Untitled report', H1)]
    if subtitle:
        items.append(Paragraph(subtitle, H2))
    # Orange rule
    rule = Table([['']], colWidths=[A4[0] - 2 * MARGIN_LR], rowHeights=[1])
    rule.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), ORANGE),
                              ('LINEBELOW', (0, 0), (-1, -1), 0, ORANGE)]))
    items.append(rule)
    items.append(Spacer(1, 4))
    return items


def section_label(text: str) -> list:
    """8pt UPPERCASE orange label + a 0.5pt orange rule underneath."""
    rule = Table([['']], colWidths=[A4[0] - 2 * MARGIN_LR], rowHeights=[0.6])
    rule.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), ORANGE)]))
    return [
        Spacer(1, 6),
        Paragraph(text.upper(), SECTION),
        rule,
        Spacer(1, 4),
    ]


def field_grid(fields: list[tuple[str, str | None]]) -> Table:
    """Two-column field grid. Left col 32mm slate label, right col body text."""
    rows = []
    for label, value in fields:
        val = value if (value is not None and str(value).strip() != '') else '—'
        rows.append([
            Paragraph(label.upper(), ParagraphStyle('lbl', fontName='Helvetica-Bold',
                                                   fontSize=7.5, leading=10,
                                                   textColor=SLATE_MUTED, tracking=0.8)),
            Paragraph(str(val).replace('<', '&lt;'), BODY),
        ])
    t = Table(rows, colWidths=[32 * mm, None])
    t.setStyle(TableStyle([
        ('VALIGN',         (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING',     (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING',  (0, 0), (-1, -1), 4),
        ('LEFTPADDING',    (0, 0), (-1, -1), 6),
        ('RIGHTPADDING',   (0, 0), (-1, -1), 6),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [WHITE, SLATE_BAND]),
        ('LINEBELOW',      (0, 0), (-1, -1), 0.25, SLATE_BORDER),
    ]))
    return t


def bullets(items: Iterable[str] | None, fallback: str = '—') -> list:
    items = [s for s in (items or []) if s and str(s).strip()]
    if not items:
        return [Paragraph(fallback, BODY_MUTED)]
    return [Paragraph(f'•  {str(s).replace("<", "&lt;")}', BULLET) for s in items]


def description(text: str | None) -> list:
    text = (text or '').strip()
    if not text:
        return [Paragraph('No description provided.', BODY_MUTED)]
    safe = text.replace('<', '&lt;').replace('\n', '<br/>')
    return [Paragraph(safe, BODY)]


def timeline_section(events: Iterable[dict] | None) -> list:
    """Each event: {at: ISO, label: str, by: optional str}."""
    events = list(events or [])
    if not events:
        return [Paragraph('No timeline events recorded.', BODY_MUTED)]
    out = []
    for ev in events:
        at = ev.get('at') or ''
        try:
            at = datetime.fromisoformat(at.replace('Z', '+00:00')).strftime('%Y-%m-%d %H:%M')
        except Exception:
            pass
        label = (ev.get('label') or '').replace('<', '&lt;')
        by = ev.get('by')
        suffix = f"  ·  <font color='#64748B'>{by}</font>" if by else ''
        out.append(Paragraph(f"<font color='#F97316'><b>{at}</b></font>  {label}{suffix}", TIMELINE))
    return out


def signatures_section(roles: list[str] | None = None) -> Table:
    roles = roles or ['Author', 'Approver']
    cells, labels = [], []
    for r in roles:
        cells.append(Paragraph('', BODY))
        labels.append(Paragraph(r, META))
    col_w = (A4[0] - 2 * MARGIN_LR - (len(roles) - 1) * 8 * mm) / len(roles)
    t = Table([cells, labels], colWidths=[col_w] * len(roles), rowHeights=[26 * mm, 10])
    t.setStyle(TableStyle([
        ('LINEBELOW',    (0, 0), (-1, 0), 0.6, SLATE_BORDER),
        ('VALIGN',       (0, 0), (-1, -1), 'BOTTOM'),
        ('BOTTOMPADDING',(0, 0), (-1, 0), 2),
        ('TOPPADDING',   (0, 1), (-1, 1), 4),
        ('LEFTPADDING',  (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
    ]))
    return t


def attachments_section(items: list[dict] | None) -> list:
    items = list(items or [])
    if not items:
        return [Paragraph('No attachments.', BODY_MUTED)]
    rows = []
    for it in items:
        name = (it.get('name') or it.get('file_url') or 'attachment').rsplit('/', 1)[-1]
        kind = it.get('kind') or 'file'
        rows.append([
            Paragraph(f"<b>•</b> {name.replace('<', '&lt;')}", BODY),
            Paragraph(kind, BODY_MUTED),
        ])
    t = Table(rows, colWidths=[None, 32 * mm])
    t.setStyle(TableStyle([
        ('VALIGN',         (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING',     (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING',  (0, 0), (-1, -1), 3),
        ('LEFTPADDING',    (0, 0), (-1, -1), 0),
        ('RIGHTPADDING',   (0, 0), (-1, -1), 0),
        ('LINEBELOW',      (0, 0), (-1, -2), 0.25, SLATE_BORDER),
    ]))
    return [t]


__all__ = [
    'make_doc', 'title_block', 'section_label', 'field_grid', 'bullets',
    'description', 'timeline_section', 'signatures_section',
    'attachments_section', 'KeepTogether', 'Spacer', 'Paragraph',
    'H1', 'H2', 'SECTION', 'BODY', 'BODY_MUTED', 'META',
]
