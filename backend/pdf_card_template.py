"""Phase 3.22c — Shared template for card-style Paneltec Civil PDFs.

Small-format printable artefacts (ID cards, lanyards, gate signs, label
sheets) all share the same visual grammar so a single binder of printed
material reads as one product:

  * Slate header band (top 14–22 mm) with orange chevron mark + white
    wordmark + small uppercase eyebrow (e.g. "WORKER ID", "SUPPLIER
    INDUCTION", "SITE SIGN-ON").
  * Slate body text on white card stock. NO cobalt blue, NO violet.
  * Orange (`PANELTEC_ORANGE`) used only for:
      – the chevron mark
      – call-to-action lines under the QR ("Scan to sign on", token text)
      – the brand footer "PROPERTY OF PANELTEC CIVIL".
  * Quiet dotted-orange pairing zones (NFC) — old violet zones forbidden.

Every renderer imports colours from `pdf_brand.py`; no file may call
`HexColor(...)` directly.
"""
from __future__ import annotations
import io
from typing import Optional

import qrcode
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

from pdf_brand import (ORANGE, ORANGE_DEEP, SLATE, SLATE_INK, SLATE_MUTED,
                       SLATE_BORDER, WHITE)

__all__ = [
    'header_band', 'chevron', 'qr_image', 'qr_block',
    'footer_brand', 'pairing_zone', 'cut_guide',
    'ORANGE', 'SLATE', 'SLATE_INK', 'SLATE_MUTED', 'SLATE_BORDER', 'WHITE',
]


# ──────────────────────────────────────────────────────────────────────
# Brand mark — the small isosceles chevron the wordmark sits next to.
# ──────────────────────────────────────────────────────────────────────
def chevron(c: Canvas, cx: float, cy: float, size: float = 4) -> None:
    """Draw the orange "A"-style chevron mark centred on (cx, cy).
    `size` controls the half-width in points; the height is 7/8 of size.
    """
    h = size * 0.85
    c.setFillColor(ORANGE)
    c.setStrokeColor(ORANGE)
    p = c.beginPath()
    p.moveTo(cx - size, cy - h * 0.6)
    p.lineTo(cx,        cy + h)
    p.lineTo(cx + size, cy - h * 0.6)
    p.close()
    c.drawPath(p, stroke=0, fill=1)


# ──────────────────────────────────────────────────────────────────────
# Header band — slate strip + chevron + wordmark + eyebrow.
# ──────────────────────────────────────────────────────────────────────
def header_band(c: Canvas, x: float, y: float, w: float, h: float,
                eyebrow: str, *,
                wordmark: str = 'PANELTEC CIVIL',
                rounded_top_mm: float = 0,
                eyebrow_align: str = 'left') -> None:
    """Slate header band with a tight chevron+wordmark cluster on the left.

    Args:
        x, y, w, h: band rectangle. `y` is the BOTTOM of the band.
        eyebrow: short uppercase tagline (e.g. 'WORKER ID', 'SITE SIGN-ON').
        rounded_top_mm: if >0, the band's top corners are rounded by N mm
            (used for card-shaped artefacts where the strip sits inside a
            roundRect card outline).
    """
    c.saveState()
    c.setFillColor(SLATE)
    if rounded_top_mm > 0:
        # Two-rect trick — round top, square bottom — so we can clip to
        # the underlying card outline cleanly.
        r = rounded_top_mm * mm
        c.roundRect(x, y, w, h, r, fill=1, stroke=0)
        # Mask the bottom corners back to square so the slate doesn't
        # blob outside the card.
        c.setFillColor(SLATE)
        c.rect(x, y, w, h / 2, fill=1, stroke=0)
    else:
        c.rect(x, y, w, h, fill=1, stroke=0)

    # Chevron + wordmark cluster, left-aligned.
    pad = 4 * mm
    cx = x + pad + 2.5
    cy = y + h / 2 + 1
    chevron(c, cx, cy, size=3.2)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(cx + 6, y + h / 2 + 0.5, wordmark)
    c.setFont('Helvetica', 7)
    c.setFillColor(SLATE_MUTED)
    eyebrow_y = y + h / 2 - 4.5
    if eyebrow_align == 'right':
        c.drawRightString(x + w - pad, eyebrow_y, (eyebrow or '').upper())
    else:
        c.drawString(cx + 6, eyebrow_y, (eyebrow or '').upper())
    c.restoreState()


# ──────────────────────────────────────────────────────────────────────
# QR helpers.
# ──────────────────────────────────────────────────────────────────────
def qr_image(payload: str, box_size: int = 8, border: int = 2) -> ImageReader:
    """Render a black-on-white QR PNG and return a reportlab ImageReader."""
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,
                      box_size=box_size, border=border)
    q.add_data(payload)
    q.make(fit=True)
    img = q.make_image(fill_color='black', back_color='white').convert('RGB')
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    buf.seek(0)
    return ImageReader(buf)


def qr_block(c: Canvas, x: float, y: float, size: float,
             payload: str, *, caption: Optional[str] = None,
             token: Optional[str] = None, box_size: int = 8) -> None:
    """Draw a QR + optional caption and token underneath."""
    c.drawImage(qr_image(payload, box_size=box_size),
                x, y, width=size, height=size, mask='auto')
    cap_y = y - 4 * mm
    if caption:
        c.setFillColor(SLATE_MUTED)
        c.setFont('Helvetica', 7)
        c.drawCentredString(x + size / 2, cap_y, caption)
        cap_y -= 3.5 * mm
    if token:
        c.setFillColor(ORANGE_DEEP)
        c.setFont('Courier-Bold', 7)
        c.drawCentredString(x + size / 2, cap_y, token)


def pairing_zone(c: Canvas, x: float, y: float, size: float, *,
                 label: str = 'NFC PAIRING ZONE',
                 sub: str = 'Tap phone here after scanning QR') -> None:
    """Dotted-orange roundRect — replacement for the old violet NFC zone."""
    c.saveState()
    c.setDash(3, 3)
    c.setStrokeColor(ORANGE)
    c.setLineWidth(1.2)
    c.roundRect(x, y, size, size, 4 * mm, fill=0, stroke=1)
    c.setDash()
    c.setFillColor(ORANGE_DEEP)
    c.setFont('Helvetica-Bold', 9)
    c.drawCentredString(x + size / 2, y + size / 2 + 3 * mm, label)
    c.setFillColor(SLATE_MUTED)
    c.setFont('Helvetica', 7)
    c.drawCentredString(x + size / 2, y + size / 2 - 2 * mm, sub)
    c.restoreState()


# ──────────────────────────────────────────────────────────────────────
# Footer brand line — single orange line, all caps.
# ──────────────────────────────────────────────────────────────────────
def footer_brand(c: Canvas, x: float, y: float, w: float, *,
                 line: str = 'PROPERTY OF PANELTEC CIVIL · WHS COMPLIANCE') -> None:
    c.setFillColor(ORANGE)
    c.setFont('Helvetica-Bold', 7.5)
    c.drawCentredString(x + w / 2, y, line)


def cut_guide(c: Canvas, x: float, y: float, w: float, h: float) -> None:
    """Hairline slate border for sheet-label cut guides (Avery)."""
    c.saveState()
    c.setStrokeColor(SLATE_BORDER)
    c.setLineWidth(0.3)
    c.rect(x, y, w, h, fill=0, stroke=1)
    c.restoreState()
