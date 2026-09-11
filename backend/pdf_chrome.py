"""Phase 3.23 (v160.3.9.9) — Shared canvas chrome for PDF reports.

Every new PDF template uses `BrandedDocTemplate` so the header band,
accent stripe, footer rule and page counter are drawn identically —
they can't drift from template to template.

Header layout (per page):
  ┌────────────────────────────────────────────────────────────────┐
  │ [ NAVY BAND 12mm ]                                              │
  │ [ logo left ]                    [ org name        (white) ]   │
  │                                  [ street · suburb (white) ]   │
  │                                  [ phone · email · ABN ]       │
  ├────────────────────────────────────────────────────────────────┤
  │ [ ACCENT_GOLD stripe 2mm ]                                      │
  └────────────────────────────────────────────────────────────────┘

Footer layout (per page):
  ┌────────────────────────────────────────────────────────────────┐
  │ [ WARM_TAN hairline ]                                           │
  │ Paneltec · 19 Connector Park Drive     Confidential   Page N/M │
  └────────────────────────────────────────────────────────────────┘

Total-pages "N of M" uses ReportLab's two-pass render pattern:
`doc.build()` is called once with a temp Canvas that captures the total
page count, then the flowables are rebuilt onto a real canvas that
knows `_pageNumber` + `_total_pages`.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame

from pdf_brand import (
    NAVY, ACCENT_GOLD, WARM_TAN, MUTED_INK, WHITE, CREAM_PAPER,
)

HEADER_BAND_MM   = 20      # coloured band height
ACCENT_STRIPE_MM = 2       # gold stripe under header
FOOTER_MM        = 14      # footer area height
MARGIN_MM        = 18


def _fmt_address(org: dict) -> list[str]:
    """Return 1–3 lines to render in the header address block."""
    lines: list[str] = []
    name = (org.get("name") or "").strip()
    if name:
        lines.append(name.upper())

    street_bits = [org.get("address_line1"), org.get("address_line2")]
    street = ", ".join([s for s in street_bits if s])
    locality_bits = [org.get("suburb"), org.get("state"), org.get("postcode")]
    locality = " ".join([s for s in locality_bits if s])
    line2 = " · ".join([s for s in (street, locality) if s])
    if line2:
        lines.append(line2)

    contact_bits = []
    if org.get("contact_phone"): contact_bits.append(org["contact_phone"])
    if org.get("contact_email"): contact_bits.append(org["contact_email"])
    if org.get("abn"):           contact_bits.append(f"ABN {org['abn']}")
    if org.get("website"):       contact_bits.append(org["website"])
    if contact_bits:
        lines.append(" · ".join(contact_bits))

    return lines[:3]


class BrandedCanvas(Canvas):
    """Canvas that draws the shared header + footer on every page.

    Uses the two-pass pattern for "Page N of M": the first build calls
    `showPage` on each page and accumulates them; the second build
    replays each stored state on a fresh page and can therefore stamp
    the correct total count.
    """

    def __init__(self, *a, org: dict, report_title: str = "", **kw):
        super().__init__(*a, **kw)
        self._org = org or {}
        self._report_title = report_title
        self._saved_states: list[dict] = []

    def showPage(self):  # noqa: N802 — reportlab API
        self._saved_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_states)
        for state in self._saved_states:
            self.__dict__.update(state)
            self._draw_chrome(total)
            super().showPage()
        super().save()

    # ─────────── chrome ───────────
    def _draw_chrome(self, total_pages: int):
        w, h = self._pagesize
        # Header navy band
        band_h = HEADER_BAND_MM * mm
        self.setFillColor(NAVY)
        self.rect(0, h - band_h, w, band_h, stroke=0, fill=1)

        # Accent gold stripe under the band
        stripe_h = ACCENT_STRIPE_MM * mm
        self.setFillColor(ACCENT_GOLD)
        self.rect(0, h - band_h - stripe_h, w, stripe_h, stroke=0, fill=1)

        # Header left: logo (image if present) or word-mark text.
        logo_url = self._org.get("logo_url")
        logo_drawn = False
        if logo_url and os.path.isfile(logo_url):
            try:
                self.drawImage(logo_url, MARGIN_MM * mm, h - band_h + 3 * mm,
                               height=band_h - 6 * mm, preserveAspectRatio=True,
                               mask="auto", anchor="sw")
                logo_drawn = True
            except Exception:
                logo_drawn = False
        if not logo_drawn:
            self.setFillColor(WHITE)
            self.setFont("Helvetica-Bold", 18)
            self.drawString(MARGIN_MM * mm, h - band_h + 7 * mm, "PANELTEC")
            self.setFont("Helvetica", 8)
            self.drawString(MARGIN_MM * mm, h - band_h + 3 * mm, "CIVIL")

        # Header right: address block, right-aligned, white text.
        self.setFillColor(WHITE)
        addr_lines = _fmt_address(self._org)
        base_y = h - band_h + (band_h - 3 * mm - len(addr_lines) * 4.4 * mm)
        for i, line in enumerate(addr_lines):
            font = "Helvetica-Bold" if i == 0 else "Helvetica"
            size = 8.5 if i == 0 else 7.5
            self.setFont(font, size)
            self.drawRightString(w - MARGIN_MM * mm,
                                 base_y + (len(addr_lines) - 1 - i) * 4.4 * mm,
                                 line)

        # Footer hairline
        footer_top = FOOTER_MM * mm - 2 * mm
        self.setStrokeColor(WARM_TAN)
        self.setLineWidth(0.6)
        self.line(MARGIN_MM * mm, footer_top, w - MARGIN_MM * mm, footer_top)

        # Footer text
        self.setFillColor(MUTED_INK)
        self.setFont("Helvetica", 7.5)
        # left — org identity
        left_bits = []
        if self._org.get("name"): left_bits.append(self._org["name"])
        if self._org.get("address_line1"): left_bits.append(self._org["address_line1"])
        self.drawString(MARGIN_MM * mm, FOOTER_MM * mm - 6 * mm,
                        "  ·  ".join(left_bits))
        # centre
        self.drawCentredString(w / 2, FOOTER_MM * mm - 6 * mm,
                               "Confidential · Not for redistribution")
        # right — page N of M + timestamp
        self.drawRightString(w - MARGIN_MM * mm, FOOTER_MM * mm - 6 * mm,
                             f"Page {self._pageNumber} of {total_pages}")
        self.setFont("Helvetica", 6.5)
        self.drawRightString(w - MARGIN_MM * mm, FOOTER_MM * mm - 10 * mm,
                             datetime.now(timezone.utc).strftime("Generated %d %b %Y · %H:%M UTC"))
        # v58.13.132dp — Portal URL on the footer (subtle, centre-below
        # the confidentiality line). Prefer `org.portal_url` (set by
        # admins via the Org settings page); fall back to the
        # `PUBLIC_APP_URL` env or the preview-domain default so a PDF
        # rendered by a code path that doesn't load the org doc still
        # carries a valid link.
        import os as _os  # noqa: WPS433
        portal = (
            (self._org or {}).get("portal_url")
            or _os.environ.get("PUBLIC_APP_URL")
            or "https://whs-compliance.preview.emergentagent.com"
        )
        portal = portal.rstrip("/")
        if portal:
            self.setFont("Helvetica", 6.5)
            self.setFillColor(MUTED_INK)
            self.drawCentredString(w / 2, FOOTER_MM * mm - 10 * mm,
                                   f"Portal: {portal}")


class BrandedDocTemplate(BaseDocTemplate):
    """Doc template that reserves space for the header band + footer and
    delegates chrome-drawing to `BrandedCanvas`."""

    def __init__(self, filename, org: dict, report_title: str = "", **kw):
        kw.setdefault("pagesize", A4)
        kw.setdefault("leftMargin",   MARGIN_MM * mm)
        kw.setdefault("rightMargin",  MARGIN_MM * mm)
        # Reserve the top for the header band + accent stripe + 4mm gap.
        kw.setdefault("topMargin",    (HEADER_BAND_MM + ACCENT_STRIPE_MM + 8) * mm)
        kw.setdefault("bottomMargin", FOOTER_MM * mm + 4 * mm)
        super().__init__(filename, **kw)
        self._org = org
        self._report_title = report_title
        frame = Frame(self.leftMargin, self.bottomMargin,
                      self.width, self.height, id="content",
                      leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        self.addPageTemplates([PageTemplate(id="branded", frames=[frame])])

    def build(self, flowables, **kw):
        def _canvas(*a, **kk):
            return BrandedCanvas(*a, org=self._org,
                                 report_title=self._report_title, **kk)
        super().build(flowables, canvasmaker=_canvas)
