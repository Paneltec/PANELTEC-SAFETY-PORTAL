"""v58.13.121 — Fleet Service Check Sheet PDF renderer.

Generates a watermark-free A4 PDF from a completed
`plant_maintenance` record (sheet_template_version="v121.1").

Design notes:
  · reportlab platypus is the only PDF library used (already ships
    with the app; no new dependencies).
  · No decorative watermark, no background text — only the flowables
    this module lays down are ever drawn. The `_assert_no_watermark_in_pdf`
    helper below is exposed for pytest coverage.
  · Signature images are embedded from `data:image/png;base64,...`
    URLs stored on the record.
  · Section palette: violet band header (#7C3AED → #4F46E5 solid
    fill; reportlab has no linear-gradient in-canvas, so we approximate
    with a stacked band of 3 rectangles for a colour-flair without
    committing to a gradient primitive).
"""
from __future__ import annotations
import base64
import io
from datetime import datetime
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as _canvas
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, Paragraph, PageTemplate, Spacer,
    Table, TableStyle,
)


_TEMPLATE_VERSION = "v121.1"


# Hard block-list of watermark strings that MUST NOT appear anywhere
# in the generated PDF byte-stream. Used by the pytest lock.
_FORBIDDEN_WATERMARK_STRINGS = (
    "PDFPrintsATwork", "pdfprintsatwork", "PDFPrintsAtWork",
    "DRAFT", "SAMPLE", "PREVIEW", "Confidential Preview",
    "Watermark", "watermark",
)


def _draw_header_band(cnv: _canvas.Canvas, doc: BaseDocTemplate) -> None:
    """Solid violet band across the top of every page. Not a
    gradient — reportlab lacks in-canvas linear-gradient without a
    workaround; a stacked 3-band fill gives the flair the user asked
    for without a heavy PDF-op detour."""
    page_w, page_h = A4
    # Three progressively-darker violet bands, top-down.
    bands = [
        (colors.HexColor("#7C3AED"), page_h - 26 * mm, page_h),
        (colors.HexColor("#6D28D9"), page_h - 30 * mm, page_h - 26 * mm),
        (colors.HexColor("#4F46E5"), page_h - 32 * mm, page_h - 30 * mm),
    ]
    for fill, y0, y1 in bands:
        cnv.setFillColor(fill)
        cnv.rect(0, y0, page_w, y1 - y0, fill=1, stroke=0)

    # Title + subtitle in the band.
    cnv.setFillColor(colors.white)
    cnv.setFont("Helvetica-Bold", 18)
    cnv.drawString(15 * mm, page_h - 15 * mm, "Service Check Sheet")
    cnv.setFont("Helvetica", 10)
    cnv.drawString(15 * mm, page_h - 22 * mm, "Vehicle Service Inspection")

    # Right-aligned rego pill.
    rego = getattr(doc, "_rego_serial", None) or "—"
    cnv.setFillColor(colors.white)
    cnv.setFont("Helvetica-Bold", 12)
    rego_w = cnv.stringWidth(rego, "Helvetica-Bold", 12)
    pill_w = rego_w + 14
    pill_x = page_w - 15 * mm - pill_w
    pill_y = page_h - 20 * mm
    cnv.setFillColor(colors.HexColor("#1E1B4B"))
    cnv.roundRect(pill_x, pill_y - 3, pill_w, 16, 6, fill=1, stroke=0)
    cnv.setFillColor(colors.white)
    cnv.drawString(pill_x + 7, pill_y + 2, rego)

    # Footer bar.
    cnv.setFillColor(colors.HexColor("#F1F5F9"))
    cnv.rect(0, 0, page_w, 8 * mm, fill=1, stroke=0)
    cnv.setFillColor(colors.HexColor("#64748B"))
    cnv.setFont("Helvetica", 8)
    cnv.drawString(15 * mm, 3 * mm,
                    f"Paneltec Civil · Fleet Service Check Sheet · {_TEMPLATE_VERSION}")
    cnv.drawRightString(page_w - 15 * mm, 3 * mm,
                          f"Page {cnv.getPageNumber()}")


def _decode_signature(data_url: Optional[str]) -> Optional[bytes]:
    """`data:image/png;base64,...` → raw png bytes. Returns None on
    any failure so a bad signature never breaks the PDF render."""
    if not data_url or not isinstance(data_url, str):
        return None
    if "," not in data_url:
        return None
    _, b64 = data_url.split(",", 1)
    try:
        return base64.b64decode(b64)
    except Exception:
        return None


def _kv_row(label: str, value: str, styles: dict) -> list:
    """Two-col label/value row for the vehicle-details grid."""
    return [
        Paragraph(f"<b>{label}</b>", styles["label"]),
        Paragraph(value if value not in (None, "") else "—", styles["value"]),
    ]


def render_service_sheet_pdf(*, asset: dict, record: dict,
                              org_name: Optional[str] = None) -> bytes:
    """Build and return the finished PDF bytes.

    Args:
        asset:  the assets doc (org-scoped, no _id)
        record: the plant_maintenance doc (no _id)
        org_name: optional org display name for the footer.
    """
    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=38 * mm, bottomMargin=15 * mm,
        title="Service Check Sheet",
    )
    doc._rego_serial = asset.get("rego_serial")

    frame = Frame(doc.leftMargin, doc.bottomMargin,
                    doc.width, doc.height, id="body")
    template = PageTemplate(id="main", frames=[frame],
                              onPage=_draw_header_band)
    doc.addPageTemplates([template])

    # ── Styles ────────────────────────────────────────────────────
    S = {
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11,
                              textColor=colors.HexColor("#4F46E5"),
                              spaceBefore=6, spaceAfter=4),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold",
                                  fontSize=8, textColor=colors.HexColor("#475569"),
                                  leading=10),
        "value": ParagraphStyle("value", fontName="Helvetica", fontSize=9,
                                  textColor=colors.HexColor("#0F172A"), leading=11),
        "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8,
                                 textColor=colors.HexColor("#0F172A"), leading=10),
        "notes": ParagraphStyle("notes", fontName="Helvetica", fontSize=9,
                                  textColor=colors.HexColor("#0F172A"), leading=12),
    }

    story: list = []

    # ── Vehicle details grid ──────────────────────────────────────
    story.append(Paragraph("Vehicle Details", S["h2"]))
    veh = [
        _kv_row("Registration", asset.get("rego_serial") or "", S),
        _kv_row("Make / Model",
                  (record.get("make_model_captured")
                    or f"{asset.get('make') or ''} {asset.get('model') or ''}".strip()),
                  S),
        _kv_row("VIN", record.get("vin_captured") or asset.get("vin") or "", S),
        _kv_row("Mileage at service",
                  f"{record.get('mileage_at_service'):,.0f} km" if record.get("mileage_at_service") else "—",
                  S),
        _kv_row("Engine hours at service",
                  f"{record.get('hours_at_service'):,.1f} hrs" if record.get("hours_at_service") else "—",
                  S),
        _kv_row("Date completed", record.get("date_completed") or "", S),
        _kv_row("Technician",
                  record.get("technician_name") or record.get("performed_by") or "—", S),
        _kv_row("Company", record.get("company") or "—", S),
    ]
    veh_table = Table(veh, colWidths=[35 * mm, 55 * mm], hAlign="LEFT")
    veh_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#E2E8F0")),
    ]))
    story.append(veh_table)
    story.append(Spacer(1, 8))

    # ── Service Checklist ─────────────────────────────────────────
    story.append(Paragraph("Service Checklist", S["h2"]))
    header = [
        Paragraph("<b>Item</b>", S["label"]),
        Paragraph("<b>Checked</b>", S["label"]),
        Paragraph("<b>Replaced</b>", S["label"]),
        Paragraph("<b>Notes</b>", S["label"]),
    ]
    rows = [header]
    for it in (record.get("checklist_items") or []):
        rows.append([
            Paragraph(it.get("item") or "—", S["cell"]),
            Paragraph("✓" if it.get("checked") else "", S["cell"]),
            Paragraph("✓" if it.get("replaced") else "", S["cell"]),
            Paragraph(it.get("notes") or "", S["cell"]),
        ])
    check_table = Table(rows,
        colWidths=[60 * mm, 20 * mm, 22 * mm, 76 * mm], hAlign="LEFT",
        repeatRows=1)
    check_style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E2E8F0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    # Row tints — 200ms scale change lands in DOM; here we just tint.
    for i, it in enumerate((record.get("checklist_items") or []), start=1):
        if it.get("replaced"):
            check_style.append(("BACKGROUND", (0, i), (-1, i),
                                  colors.HexColor("#FEF3C7")))  # amber-50
        elif it.get("checked"):
            check_style.append(("BACKGROUND", (0, i), (-1, i),
                                  colors.HexColor("#ECFDF5")))  # emerald-50
    check_table.setStyle(TableStyle(check_style))
    story.append(check_table)
    story.append(Spacer(1, 8))

    # ── Advisory / Comments ───────────────────────────────────────
    adv = record.get("advisory_comments") or record.get("description") or ""
    if adv:
        story.append(Paragraph("Advisory Items / Comments", S["h2"]))
        story.append(Paragraph(adv.replace("\n", "<br/>"), S["notes"]))
        story.append(Spacer(1, 6))

    # ── Next Service Due ──────────────────────────────────────────
    story.append(Paragraph("Next Service Due", S["h2"]))
    nxt = [
        _kv_row("Next service due (km)",
                  f"{record.get('next_service_due_km'):,.0f} km" if record.get("next_service_due_km") else "—",
                  S),
        _kv_row("Next service due (hrs)",
                  f"{record.get('next_service_due_hours'):,.1f} hrs" if record.get("next_service_due_hours") else "—",
                  S),
        _kv_row("Next service due date", record.get("next_due_date") or "—", S),
    ]
    nxt_table = Table(nxt, colWidths=[45 * mm, 60 * mm], hAlign="LEFT")
    nxt_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(nxt_table)
    story.append(Spacer(1, 8))

    # ── Sign-off ─────────────────────────────────────────────────
    story.append(Paragraph("Sign Off", S["h2"]))
    tech_sig = _decode_signature(record.get("technician_signature_data_url"))
    cust_sig = _decode_signature(record.get("customer_signature_data_url"))
    sig_row = [
        [
            Paragraph("<b>Technician signature</b>", S["label"]),
            Paragraph("<b>Customer signature</b>", S["label"]),
        ],
        [
            Image(io.BytesIO(tech_sig), width=80 * mm, height=25 * mm) if tech_sig
                else Paragraph("<i>Not signed</i>", S["cell"]),
            Image(io.BytesIO(cust_sig), width=80 * mm, height=25 * mm) if cust_sig
                else Paragraph("<i>Not signed</i>", S["cell"]),
        ],
        [
            Paragraph(record.get("technician_name") or "—", S["cell"]),
            Paragraph("—", S["cell"]),
        ],
    ]
    sig_table = Table(sig_row, colWidths=[85 * mm, 85 * mm], hAlign="LEFT")
    sig_table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E2E8F0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(sig_table)

    doc.build(story)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes


def assert_no_watermark_in_pdf(pdf_bytes: bytes) -> list[str]:
    """Return the list of forbidden watermark strings found in the
    raw PDF bytes. An empty list means clean. Exposed for pytests.

    Note: reportlab embeds text as a mix of literal + hex-encoded
    strings depending on font subset. We scan the raw bytes for the
    literal token as a defensive lower bound.
    """
    found: list[str] = []
    for tok in _FORBIDDEN_WATERMARK_STRINGS:
        if tok.encode("utf-8") in pdf_bytes:
            found.append(tok)
    return found
