"""Per-record PDF generator with consistent Paneltec Civil branding.

Uses reportlab (already a backend dep for audit exports). Renderers return raw
PDF bytes; callers decide whether to stream or persist to disk.
"""
from __future__ import annotations
import io
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, PageTemplate, Paragraph, Spacer, Table,
    TableStyle,
)
from reportlab.pdfgen.canvas import Canvas

# Phase 3.22d — brand tokens come from `pdf_brand.py` (single source of
# truth). The legacy aliases below are kept so existing helpers keep
# compiling, but they now resolve to orange + slate. NO cobalt, NO violet.
from pdf_brand import (ORANGE, ORANGE_PALE, ORANGE_DEEP,
                       SLATE, SLATE_INK, SLATE_MUTED, SLATE_BORDER,
                       SLATE_BAND, SEV_CRITICAL, SEV_CRITICAL_BG,
                       SEV_WARNING, SEV_WARNING_BG, SEV_OK, SEV_OK_BG)

# ---- Brand tokens (aliased — old names point at the new palette) ----
BRAND_BLUE   = ORANGE          # legacy accent → orange
BRAND_INK    = SLATE_INK
BRAND_MUTED  = SLATE_MUTED
BRAND_BORDER = SLATE_BORDER
GREEN        = SEV_OK          # "approved" now reads as muted slate
MINT_BG      = SEV_OK_BG
AMBER        = ORANGE
AMBER_BG     = ORANGE_PALE
RED          = SEV_CRITICAL
RED_BG       = SEV_CRITICAL_BG
VIOLET       = ORANGE          # violet is forbidden — fall back to orange
VIOLET_BG    = ORANGE_PALE
SLATE_BG     = SLATE_BAND

UPLOADS_ROOT = Path(os.environ.get("UPLOADS_DIR", "/app/backend/uploads")).resolve()
PDFS_DIR = UPLOADS_ROOT / "pdfs"
PDFS_DIR.mkdir(parents=True, exist_ok=True)


def _styles():
    s = getSampleStyleSheet()
    s.add(ParagraphStyle("PtSection", fontName="Helvetica-Bold", fontSize=8.5,
                         textColor=BRAND_BLUE, alignment=TA_LEFT,
                         spaceBefore=12, spaceAfter=6,
                         tracking=1, leading=11))
    s.add(ParagraphStyle("PtBody", fontName="Helvetica", fontSize=10,
                         textColor=BRAND_INK, leading=14, spaceAfter=4))
    s.add(ParagraphStyle("PtMuted", fontName="Helvetica", fontSize=8.5,
                         textColor=BRAND_MUTED, leading=11))
    s.add(ParagraphStyle("PtSmall", fontName="Helvetica", fontSize=8,
                         textColor=BRAND_MUTED, leading=10))
    s.add(ParagraphStyle("PtBullet", fontName="Helvetica", fontSize=10,
                         textColor=BRAND_INK, leading=14, leftIndent=12,
                         bulletIndent=2))
    return s


STYLES = _styles()


def _status_color(status: Optional[str]):
    s = (status or "").lower()
    if s in {"approved", "closed", "complete", "resolved", "pass", "passed", "sent"}:
        return (GREEN, MINT_BG)
    if s in {"in_progress", "in-progress", "open", "pending", "submitted", "review", "in_review"}:
        return (BRAND_BLUE, ORANGE_PALE)
    if s in {"draft", "queued", "n/a", "na"}:
        return (BRAND_MUTED, SLATE_BG)
    if s in {"rejected", "fail", "failed", "high", "critical", "overdue"}:
        return (RED, RED_BG)
    if s in {"changes_requested", "watch", "medium", "warning"}:
        return (AMBER, AMBER_BG)
    return (BRAND_MUTED, SLATE_BG)


def _draw_header(canv: Canvas, title: str, status: Optional[str], crumb: str):
    w, h = A4
    # Top bar
    canv.setFillColor(BRAND_BLUE)
    canv.rect(0, h - 18 * mm, w, 18 * mm, fill=1, stroke=0)
    # Chevron mark
    canv.setFillColor(colors.white)
    canv.setStrokeColor(colors.white)
    p = canv.beginPath()
    cx, cy = 12 * mm, h - 9 * mm
    p.moveTo(cx - 3, cy - 3)
    p.lineTo(cx, cy + 3)
    p.lineTo(cx + 3, cy - 3)
    p.close()
    canv.drawPath(p, stroke=0, fill=1)
    # Wordmark
    canv.setFont("Helvetica-Bold", 12)
    # v58.13.132fx — brand sweep: "Paneltec Civil" → "The Paneltec Group".
    canv.drawString(20 * mm, h - 10 * mm, "The Paneltec Group")
    canv.setFont("Helvetica", 8)
    canv.drawString(20 * mm, h - 14 * mm, "WHS COMPLIANCE")
    # Title (right side)
    canv.setFont("Helvetica-Bold", 11)
    canv.setFillColor(colors.white)
    canv.drawRightString(w - 14 * mm, h - 10 * mm, (title or "Untitled")[:70])
    if status:
        fg, bg = _status_color(status)
        canv.setFillColor(bg)
        tw = canv.stringWidth(status.upper(), "Helvetica-Bold", 7) + 10
        canv.roundRect(w - 14 * mm - tw, h - 16 * mm, tw, 8, 4, fill=1, stroke=0)
        canv.setFillColor(fg)
        canv.setFont("Helvetica-Bold", 7)
        canv.drawRightString(w - 19 * mm, h - 14.5 * mm, status.upper())
    # Sub-header crumb
    canv.setFillColor(BRAND_MUTED)
    canv.setFont("Helvetica", 8.5)
    canv.drawString(14 * mm, h - 22 * mm, crumb)
    canv.setStrokeColor(BRAND_BORDER)
    canv.setLineWidth(0.4)
    canv.line(14 * mm, h - 24 * mm, w - 14 * mm, h - 24 * mm)


def _draw_footer(canv: Canvas, doc):
    w, _ = A4
    canv.setFont("Helvetica", 7.5)
    canv.setFillColor(BRAND_MUTED)
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    canv.drawString(14 * mm, 10 * mm, f"Generated {ts} · Confidential — for authorised personnel")
    canv.drawRightString(w - 14 * mm, 10 * mm, f"Page {doc.page}")


def _make_doc(buffer: io.BytesIO, title: str, status: Optional[str], crumb: str):
    """v160.3.9.11 — Every non-form-submission PDF (SWMS + pre-start +
    site-diary + incident + inspection + hazard) now uses the shared
    `BrandedDocTemplate` so it inherits the Phase 3.23 chrome (navy
    header + gold stripe + logo/address + page N of M + warm-tan
    footer). The local `_draw_header` / `_draw_footer` are retained
    below for reference but no longer wired — the branded template
    draws its own chrome on the canvas."""
    from pdf_chrome import BrandedDocTemplate
    return BrandedDocTemplate(buffer, org={}, report_title=title,
                              pagesize=A4, title=title)


def _para(text: str, style: str = "PtBody") -> Paragraph:
    safe = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(safe.replace("\n", "<br/>"), STYLES[style])


def _section(label: str):
    return _para(label.upper(), "PtSection")


def _bullets(items, fallback="None"):
    items = [i for i in (items or []) if i]
    if not items:
        return [_para(fallback, "PtMuted")]
    return [_para(f"• {it}") for it in items]


def _kv_table(rows):
    data = [[Paragraph(f"<b>{k}</b>", STYLES["PtSmall"]),
             Paragraph(str(v) if v not in (None, "") else "—", STYLES["PtBody"])] for k, v in rows]
    t = Table(data, colWidths=[40 * mm, None])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, BRAND_BORDER),
    ]))
    return t


def _data_table(header_row, body_rows, col_widths=None):
    data = [header_row] + (body_rows or [["—"] * len(header_row)])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8.5),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SLATE_BG]),
        ("GRID", (0, 0), (-1, -1), 0.3, BRAND_BORDER),
    ]))
    return t


def _resolve_upload(file_url: str) -> Optional[Path]:
    """`file_url` like /api/files/hazards/foo.jpg → /app/backend/uploads/hazards/foo.jpg"""
    if not file_url:
        return None
    if file_url.startswith("http"):
        return None  # remote — skip embed
    m = re.match(r"/?(api/)?files/(.+)", file_url.lstrip("/"))
    if not m:
        # Try direct match against uploads root
        candidate = (UPLOADS_ROOT / file_url.lstrip("/")).resolve()
    else:
        candidate = (UPLOADS_ROOT / m.group(2)).resolve()
    try:
        candidate.relative_to(UPLOADS_ROOT)
    except ValueError:
        return None
    return candidate if candidate.exists() else None


def _embed(photo_url: str, caption: Optional[str] = None, max_w_in: float = 4.5):
    path = _resolve_upload(photo_url) if photo_url else None
    out = []
    if path:
        try:
            img = Image(str(path), width=max_w_in * inch, height=max_w_in * 0.75 * inch,
                        kind="proportional")
            out.append(img)
        except Exception:
            out.append(_para("[Photo unavailable]", "PtMuted"))
    else:
        out.append(_para("[Photo unavailable]", "PtMuted"))
    if caption:
        out.append(_para(caption, "PtSmall"))
    out.append(Spacer(1, 6))
    return out


def _crumb(record: dict, kind: str) -> str:
    parts = []
    parts.append(kind)
    if record.get("workspace_id"):
        parts.append(f"workspace {record['workspace_id'][:8]}")
    parts.append(f"created {(record.get('created_at') or '')[:10]}")
    parts.append(f"id {record.get('id', '')[:8]}")
    return " · ".join(parts)


# ---------- Renderers ----------

def _render_swms_rich(swms: dict, layout: str = "civil") -> bytes:
    """Phase 4.x SWMS layout for structured documents (activity_analysis +
    environmental_risks + emergency_procedures). Honours `layout`:
      - 'civil'    → modern Paneltec orange + slate; light typography
      - 'original' → deeper slate borders for the formal Paneltec SWMS look
    Phase 3.22d — all colours now come from `pdf_brand.py` (orange + slate).
    """
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import PageBreak, Table, TableStyle, Spacer, Paragraph
    from reportlab.lib.units import mm

    is_original = (layout == "original")
    # Phase 3.22d — every accent is orange or slate. No cobalt, no mint.
    accent_col = SLATE if is_original else ORANGE
    border_col = SLATE if is_original else SLATE_BORDER

    buf = io.BytesIO()
    title = f"{swms.get('code') or 'SWMS'} · {swms.get('title', '')}"
    doc = _make_doc(buf, title, swms.get("status"), _crumb(swms, "SWMS"))
    story: list = []
    story += [_section(title)]
    story += [_kv_table([
        ("Code", swms.get("code")),
        ("Version", swms.get("version")),
        ("High-risk construction work", swms.get("high_risk_construction_work")),
        ("Scope", swms.get("scope")),
        ("Status", (swms.get("status") or "").upper()),
        ("Review date", swms.get("review_date")),
    ])]
    pb = swms.get("prepared_by") or {}
    ab = swms.get("approved_by") or {}
    if pb or ab:
        story += [_section("Prepared / Approved")]
        story += [_kv_table([
            ("Prepared by", f"{pb.get('name','')} · {pb.get('role','')} · {pb.get('organisation','')}".strip(" ·")),
            ("Date prepared", pb.get("date_prepared")),
            ("Approved by", f"{ab.get('name','')} · {ab.get('position','')}".strip(" ·")),
            ("Contact", ab.get("contact")),
            ("Date approved", ab.get("date_approved")),
        ])]

    cell_style = ParagraphStyle("PtCell",  fontName="Helvetica",      fontSize=7,   leading=9)
    hdr_style  = ParagraphStyle("PtHdr",   fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=colors.white)
    def _wrap(row, hdr=False):
        return [Paragraph(str(c).replace("\n", "<br/>"), hdr_style if hdr else cell_style) for c in row]

    aa = swms.get("activity_analysis") or []
    if aa:
        story += [_section("Activity & hazard analysis")]
        rows = [["#", "Step", "Hazards", "Before", "Controls", "Resp.", "After"]]
        for i, a in enumerate(aa, start=1):
            rows.append([
                str(i), a.get("step", ""),
                "\n".join(f"· {h}" for h in (a.get("potential_hazards") or [])),
                str(a.get("risk_class_before", "—")),
                "\n".join(f"· {c}" for c in (a.get("controls") or [])),
                ", ".join(a.get("responsible") or []),
                str(a.get("risk_class_after", "—")),
            ])
        data = [_wrap(rows[0], hdr=True)] + [_wrap(r) for r in rows[1:]]
        t = Table(data, colWidths=[8*mm, 30*mm, 38*mm, 12*mm, 60*mm, 22*mm, 12*mm], repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), accent_col),
            ("BOX",        (0,0), (-1,-1), 0.4, border_col),
            ("INNERGRID",  (0,0), (-1,-1), 0.25, border_col),
            ("VALIGN",     (0,0), (-1,-1), "TOP"),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, SLATE_BAND]),
        ]))
        story += [t]

    er = swms.get("environmental_risks") or []
    if er:
        story += [Spacer(1, 6), _section("Environmental risks")]
        rows = [["Activity", "Risk", "Before", "Controls", "Resp.", "After"]]
        for e in er:
            rows.append([
                e.get("work_activity", ""), e.get("risk", ""),
                str(e.get("risk_class_before", "—")),
                "\n".join(f"· {c}" for c in (e.get("controls") or [])),
                ", ".join(e.get("responsible") or []),
                str(e.get("risk_class_after", "—")),
            ])
        data = [_wrap(rows[0], hdr=True)] + [_wrap(r) for r in rows[1:]]
        t = Table(data, colWidths=[30*mm, 38*mm, 12*mm, 70*mm, 22*mm, 12*mm], repeatRows=1)
        t.setStyle(TableStyle([
            # Environmental section was the old mint header — now slate to
            # keep parity with the activity table; orange would be too noisy
            # for back-to-back tables.
            ("BACKGROUND", (0,0), (-1,0), SLATE),
            ("BOX",        (0,0), (-1,-1), 0.4, border_col),
            ("INNERGRID",  (0,0), (-1,-1), 0.25, border_col),
            ("VALIGN",     (0,0), (-1,-1), "TOP"),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, SLATE_BAND]),
        ]))
        story += [t]

    if swms.get("ppe"):                   story += [_section("Personal protective equipment")] + _bullets(swms.get("ppe"))
    if swms.get("training_requirements"): story += [_section("Training requirements")]         + _bullets(swms.get("training_requirements"))
    if swms.get("equipment_list"):        story += [_section("Equipment list")]                + _bullets(swms.get("equipment_list"))
    if swms.get("legislation_and_codes"): story += [_section("Legislation & codes")]           + _bullets(swms.get("legislation_and_codes"))

    ep = swms.get("emergency_procedures") or {}
    if ep:
        story += [_section("Emergency procedures")]
        for k, label in [("general","General"), ("accident_incident","Accident / Incident"),
                          ("fire","Fire"), ("spill","Spill")]:
            v = ep.get(k)
            if v: story += [_para(f"<b>{label}:</b> {v}")]

    if swms.get("attendance_sheet_template", True):
        story += [PageBreak(), _section("Attendance & sign-off")]
        story += [_para("All workers must read this SWMS and sign below, confirming they understand the controls and accept their responsibilities.", "PtMuted")]
        rows = [["Name", "Trade / Role", "Date", "Signature"]] + [["", "", "", ""] for _ in range(12)]
        t = Table(rows, colWidths=[55*mm, 45*mm, 25*mm, 55*mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), accent_col),
            ("TEXTCOLOR",  (0,0), (-1,0), colors.white),
            ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",   (0,0), (-1,0), 8),
            ("BOX",        (0,0), (-1,-1), 0.5, border_col),
            ("INNERGRID",  (0,0), (-1,-1), 0.3, border_col),
        ]))
        story += [t]

    sf = swms.get("source_file") or {}
    story += [Spacer(1, 6), _para(
        f"{swms.get('code','SWMS')} {swms.get('version','')} · Layout: {layout} · "
        f"{('Source: ' + sf.get('filename','')) if sf.get('filename') else 'Generated by The Paneltec Group'}",
        "PtSmall")]

    doc.build(story)
    return buf.getvalue()




def render_swms_pdf(swms: dict, layout: str = "civil") -> bytes:
    """Render an SWMS PDF.

    layout="civil"  → modern Paneltec Civil layout (default; also used when a
                       record lacks the structured `activity_analysis` field).
    layout="original" → traditional Paneltec SWMS layout (formal title block,
                       full hazard/control table with risk-class columns).
    Records that include `activity_analysis` get the rich Phase 4.x layout
    regardless of layout choice; the layout flag only affects styling.
    """
    if (swms.get("activity_analysis") or swms.get("environmental_risks")):
        return _render_swms_rich(swms, layout=layout)
    buf = io.BytesIO()
    doc = _make_doc(buf, swms.get("title", "SWMS"), swms.get("status"),
                    _crumb(swms, "SWMS"))
    story = []
    story += [_section("Job description"),
              _para(swms.get("job_description", ""))]
    tasks = swms.get("tasks") or []
    story += [_section("Tasks")]
    story += [_para(f"{i+1}. {t}") for i, t in enumerate(tasks)] or [_para("None", "PtMuted")]
    hazards = swms.get("hazards") or []
    story += [_section("Hazards & risk")]
    story += [_data_table(
        ["#", "Hazard", "Risk"],
        [[str(i+1),
          h.get("description") if isinstance(h, dict) else str(h),
          (h.get("risk_level") if isinstance(h, dict) else "—") or "—"]
         for i, h in enumerate(hazards)],
        col_widths=[10 * mm, None, 25 * mm])]
    story += [_section("Controls")]
    story += _bullets(swms.get("controls"))
    story += [_section("Personal protective equipment")]
    story += _bullets(swms.get("ppe"))
    if swms.get("reviewed_by") or swms.get("review_note"):
        story += [_section("Review")]
        story += [_kv_table([
            ("Status", swms.get("status")),
            ("Reviewed by", swms.get("reviewed_by")),
            ("Reviewed at", swms.get("reviewed_at")),
            ("Note", swms.get("review_note") or "—"),
        ])]
    story += [_section("Sign-offs")]
    story += [_para("Crew lead: ____________________  Date: __________", "PtMuted"),
              _para("HSE lead:  ____________________  Date: __________", "PtMuted")]
    story += [Spacer(1, 6), _para(f"Version {swms.get('version', 1)}", "PtSmall")]
    doc.build(story)
    return buf.getvalue()


def render_pre_start_pdf(ps: dict) -> bytes:
    """Phase 3.22b — migrated to shared `pdf_template`."""
    import pdf_template as P
    buf = io.BytesIO()
    doc = P.make_doc(buf, 'WHS · Daily Pre-Start',
                     ps.get('status') or 'complete', doc_id=ps.get('id'))
    story: list = []
    story += P.title_block(f"Daily Pre-Start · {ps.get('date', '')}",
                           ps.get('crew_lead') or 'Pre-start brief and crew sign-on')
    story.append(P.evidence_sufficiency_line(ps))
    story += P.section_label('Overview')
    story += [P.field_grid([
        ('Date',       ps.get('date')),
        ('Crew lead',  ps.get('crew_lead')),
        ('Status',     (ps.get('status') or '').replace('_', ' ').title() or None),
        ('Workspace',  (ps.get('workspace_id') or '')[:8] or None),
        ('Reference',  (ps.get('id') or '')[:8] or None),
    ])]
    story += P.section_label('Work summary')
    story += P.description(ps.get('work_summary'))
    linked = ps.get('linked_swms_titles') or []
    if linked:
        story += P.section_label('Linked SWMS')
        story += P.bullets(linked)
    story += P.section_label('Hazards discussed')
    story += P.bullets(ps.get('hazards_discussed'))
    story += P.section_label('Crew sign-on')
    sign_ons = ps.get('sign_ons') or []
    if sign_ons:
        story += [P.data_table(
            ['Name', 'Role', 'Signed at'],
            [[s.get('name', ''), s.get('role', ''), s.get('signed_at', '')] for s in sign_ons],
            col_widths=[None, 40 * mm, 45 * mm],
        )]
    else:
        story += [P.Paragraph('No crew sign-ons recorded.', P.BODY_MUTED)]
    if ps.get('notes'):
        story += P.section_label('Notes')
        story += P.description(ps['notes'])
    story += P.section_label('Signatures')
    story += [P.signatures_section(['Crew lead', 'Site supervisor'])]
    doc.build(story)
    return buf.getvalue()


def render_site_diary_pdf(d: dict) -> bytes:
    """Phase 3.22b — migrated to shared `pdf_template`."""
    import pdf_template as P
    buf = io.BytesIO()
    doc = P.make_doc(buf, 'WHS · Site Diary', 'logged', doc_id=d.get('id'))
    story: list = []
    story += P.title_block(f"Site Diary · {d.get('date', '')}",
                           d.get('weather') or 'Daily site activity log')
    story.append(P.evidence_sufficiency_line(d))
    story += P.section_label('Overview')
    story += [P.field_grid([
        ('Date',      d.get('date')),
        ('Workspace', (d.get('workspace_id') or '')[:8] or None),
        ('Reference', (d.get('id') or '')[:8] or None),
        ('Logged by', d.get('logged_by') or d.get('created_by_name')),
    ])]
    story += P.section_label('Raw notes')
    story += P.description(d.get('raw_notes'))
    log = d.get('structured_log') or {}
    for key, label in [('activities', 'Activities'), ('delays', 'Delays'),
                       ('deliveries', 'Deliveries'), ('visitors', 'Visitors'),
                       ('weather', 'Weather'),
                       ('safety_observations', 'Safety observations')]:
        v = log.get(key)
        story += P.section_label(label)
        if isinstance(v, list) and v:
            story += P.bullets(v)
        elif v:
            story += P.description(str(v))
        else:
            story += [P.Paragraph('—', P.BODY_MUTED)]
    story += P.section_label('Signatures')
    story += [P.signatures_section(['Author', 'Approver'])]
    doc.build(story)
    return buf.getvalue()


# ---------- CS Incident (reference_library XLSX-import) ---------- #
#
# v58.13.48 — CS Incidents are XLSX-imported reference_library rows
# with no attachments and no field-schema in common with the mobile
# `incidents` collection. They carry ~65 structured fields (issue
# meta, timeline, categorisation, free-text descriptions, immediate
# actions, environmental flags, near-miss booleans). This renderer
# lays those into an audit-style printable report using the shared
# `pdf_template` helpers so the visual language matches the rest of
# the WHS PDFs (title block, section labels, field grids, timeline).
#
# Empty/None/blank string values are dropped everywhere so the PDF
# stays lean on sparse records. Boolean False values are dropped
# from the descriptive sections but preserved in the near-miss/
# environmental flag summaries (False is informative there).

_CS_LABEL = {
    "issue_number":              "Issue #",
    "issue_type":                "Issue type",
    "business_unit":             "Business unit",
    "status":                    "Status",
    "company":                   "Company",
    "date_of_issue":             "Date of issue",
    "date_reported":             "Date reported",
    "date_of_entry":             "Date of entry",
    "date_closed":               "Date closed",
    "time_of_issue":             "Time of issue",
    "hours_into_shift":          "Hours into shift",
    "shift_length":              "Shift length",
    "entered_by":                "Entered by",
    "identified_by":             "Identified by",
    "employee_reporting":        "Employee reporting",
    "responsible_manager":       "Responsible manager",
    "closeout_manager":          "Closeout manager",
    "supervisor":                "Supervisor",
    "employment_status":         "Employment status",
    "injured_employee":          "Injured employee",
    "location_2":                "Location",
    "work_activity_performed":   "Work activity performed",
    "incident_categories":       "Incident category",
    "actual_incident_category":  "Actual severity",
    "potential_incident_category": "Potential severity",
    "primary_hazard":            "Primary hazard",
    "sources_of_hazard":         "Sources of hazard",
    "identified_hazards":        "Identified hazards",
    "hazard_report_type":        "Hazard report type",
    "injury_severity":           "Injury severity",
    "injury_agency":             "Injury agency",
    "injury_mechanism":          "Injury mechanism",
    "injury_nature":             "Injury nature",
    "was_first_aid_provided":    "First aid provided",
    "alert_generated":           "Alert generated",
}
_CS_DESCRIPTION_FIELDS = [
    ("description",                    "Description"),
    ("hazard_description",             "Hazard description"),
    ("near_miss_description",          "Near-miss description"),
    ("property_description",           "Property description"),
    ("plant_description",              "Plant description"),
    ("other_description",              "Other description"),
    ("first_aid_description",          "First aid description"),
    ("environment_report_description", "Environmental description"),
]
_CS_ACTION_FIELDS = [
    ("immediate_action",   "Immediate action"),
    ("immediate_action_2", "Immediate action (2)"),
    ("immediate_action_3", "Immediate action (3)"),
]
_CS_ENV_FLAGS = [
    ("erosion_and_sediment",           "Erosion & sediment"),
    ("receiving_environment_erosion",  "Receiving-environment erosion"),
    ("type_erosion",                   "Erosion type"),
    ("land_contamination",             "Land contamination"),
    ("water_contamination_discharge",  "Water contamination / discharge"),
    ("solid_or_other_waste_effects",   "Solid / other waste effects"),
    ("spill_recovered",                "Spill recovered"),
    ("recovered",                      "Recovered"),
    ("contaminant_remediated",         "Contaminant remediated"),
    ("contaminated_material_remediated", "Contaminated material remediated"),
    ("flora_affected",                 "Flora affected"),
    ("fauna_affected",                 "Fauna affected"),
    ("archaeological_or_cultural",     "Archaeological / cultural"),
    ("indigenous",                     "Indigenous"),
]
_CS_NEAR_MISS_FLAGS = [
    ("is_injury_near_miss",        "Injury near miss"),
    ("is_environmental_near_miss", "Environmental near miss"),
    ("is_plant_near_miss",         "Plant near miss"),
    ("is_other_near_miss",         "Other near miss"),
]


def _cs_truthy(v):
    if v is None: return False
    if isinstance(v, bool): return v
    if isinstance(v, (int, float)): return bool(v)
    return bool(str(v).strip())


def _cs_fmt(v):
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if v is None:
        return ""
    # ISO datetime → date only when time is midnight
    s = str(v)
    if len(s) >= 19 and s[10] == "T" and s.endswith(("00:00:00", "00:00:00Z")):
        return s[:10]
    return s


def render_cs_incident_pdf(row: dict) -> bytes:
    """v58.13.48 — CS Incident (reference_library XLSX-import) PDF.

    Section-based layout that mirrors the printable audit format
    the sibling `incidents` renderer produces, but sourced from the
    XLSX-import schema (~65 fields, no attachments, no timeline
    array — synthesised from timeline dates + parties)."""
    import pdf_template as P
    import io as _io
    buf = _io.BytesIO()
    status = _cs_fmt(row.get("status")) or "open"
    title = f"WHS · CS Incident #{row.get('issue_number') or '—'}"
    doc = P.make_doc(buf, title, status, doc_id=row.get("id"))
    story: list = []

    subtitle = row.get("issue_type") or "CS Incident record"
    story += P.title_block(
        f"Issue #{row.get('issue_number') or '—'} — {row.get('issue_type') or ''}".strip(" —"),
        (row.get("business_unit") or "") + (" · " + subtitle if subtitle else ""),
    )

    # ── Overview grid ────────────────────────────────────────────
    def _row(field):
        v = row.get(field)
        return (_CS_LABEL.get(field, field), _cs_fmt(v)) if _cs_truthy(v) else None
    overview = list(filter(None, [
        _row("issue_number"), _row("issue_type"),
        _row("business_unit"), _row("status"), _row("company"),
    ]))
    if overview:
        story += P.section_label("Overview")
        story += [P.field_grid(overview)]

    # ── Timeline & parties ───────────────────────────────────────
    timeline = list(filter(None, [
        _row("date_of_issue"),  _row("date_reported"),
        _row("date_of_entry"),  _row("date_closed"),
        _row("time_of_issue"),  _row("hours_into_shift"),
        _row("shift_length"),
    ]))
    parties = list(filter(None, [
        _row("entered_by"), _row("identified_by"),
        _row("employee_reporting"), _row("responsible_manager"),
        _row("closeout_manager"), _row("supervisor"),
        _row("employment_status"), _row("injured_employee"),
    ]))
    if timeline or parties:
        story += P.section_label("Timeline & parties")
        if timeline: story += [P.field_grid(timeline)]
        if parties:  story += [P.field_grid(parties)]

    # ── Location & activity ──────────────────────────────────────
    loc = list(filter(None, [_row("location_2"), _row("work_activity_performed")]))
    if loc:
        story += P.section_label("Location & activity")
        story += [P.field_grid(loc)]

    # ── Categorisation ───────────────────────────────────────────
    cats = list(filter(None, [
        _row("incident_categories"),
        _row("actual_incident_category"),
        _row("potential_incident_category"),
        _row("primary_hazard"), _row("sources_of_hazard"),
        _row("identified_hazards"), _row("hazard_report_type"),
        _row("injury_severity"), _row("injury_agency"),
        _row("injury_mechanism"), _row("injury_nature"),
    ]))
    if cats:
        story += P.section_label("Categorisation")
        story += [P.field_grid(cats)]

    # ── Descriptions ─────────────────────────────────────────────
    desc_rows = [(lbl, str(row.get(k)).strip())
                 for k, lbl in _CS_DESCRIPTION_FIELDS
                 if _cs_truthy(row.get(k)) and not isinstance(row.get(k), bool)]
    if desc_rows:
        story += P.section_label("Descriptions")
        for lbl, txt in desc_rows:
            story += [P.Paragraph(f"<b>{lbl}</b>", P.BODY)]
            story += P.description(txt)

    # ── Immediate actions ────────────────────────────────────────
    actions = [(lbl, str(row.get(k)).strip())
               for k, lbl in _CS_ACTION_FIELDS if _cs_truthy(row.get(k))]
    if actions:
        story += P.section_label("Immediate actions")
        for lbl, txt in actions:
            story += [P.Paragraph(f"<b>{lbl}</b>", P.BODY)]
            story += P.description(txt)

    # ── Environmental impact (only show if any flag is set) ──────
    if any(_cs_truthy(row.get(k)) for k, _ in _CS_ENV_FLAGS):
        env_rows = [(lbl, _cs_fmt(row.get(k)))
                    for k, lbl in _CS_ENV_FLAGS if _cs_truthy(row.get(k))]
        story += P.section_label("Environmental impact")
        story += [P.field_grid(env_rows)]

    # ── Near-miss flags summary ──────────────────────────────────
    nm_rows = [(lbl, _cs_fmt(row.get(k))) for k, lbl in _CS_NEAR_MISS_FLAGS]
    if any(v == "Yes" for _, v in nm_rows):
        story += P.section_label("Near-miss")
        story += [P.field_grid([r for r in nm_rows if r[1] == "Yes"])]

    # ── Alerts / first aid ───────────────────────────────────────
    alerts = list(filter(None, [_row("was_first_aid_provided"),
                                _row("alert_generated")]))
    if alerts:
        story += P.section_label("Alerts & response")
        story += [P.field_grid(alerts)]

    if not story or len(story) < 3:
        # Extremely sparse record — still produce a valid PDF.
        story += [P.Paragraph("No populated fields on this record.",
                              P.BODY_MUTED)]

    doc.build(story)
    return buf.getvalue()


def render_incident_pdf(inc: dict) -> bytes:
    """Phase 3.22b — migrated to shared `pdf_template`."""
    import pdf_template as P
    buf = io.BytesIO()
    status = inc.get('follow_up_status') or inc.get('category') or 'open'
    doc = P.make_doc(buf, 'WHS · Incident report', status, doc_id=inc.get('id'))
    story: list = []
    story += P.title_block(inc.get('title') or 'Untitled incident',
                           inc.get('location') or 'Recorded incident on site')
    story.append(P.evidence_sufficiency_line(inc))
    story += P.section_label('Overview')
    story += [P.field_grid([
        ('Title',             inc.get('title')),
        ('Category',          (inc.get('category') or '').replace('_', ' ').title() or None),
        ('Occurred at',       inc.get('occurred_at')),
        ('Location',          inc.get('location')),
        ('Follow-up status',  (inc.get('follow_up_status') or '').replace('_', ' ').title() or None),
        ('Reporter',          inc.get('reporter') or inc.get('reported_by')),
        ('Workspace',         (inc.get('workspace_id') or '')[:8] or None),
        ('Reference',         (inc.get('id') or '')[:8] or None),
    ])]
    story += P.section_label('Description')
    story += P.description(inc.get('description'))
    story += P.section_label('Immediate actions')
    story += P.description(inc.get('immediate_actions'))
    story += P.section_label('Follow-up actions')
    fu = inc.get('follow_up_actions') or []
    if fu:
        story += [P.data_table(
            ['Action', 'Owner', 'Status'],
            [[a.get('action', ''), a.get('owner', ''),
              (a.get('status') or '').replace('_', ' ').title()] for a in fu],
        )]
    else:
        story += [P.Paragraph('No follow-up actions recorded.', P.BODY_MUTED)]
    # v58.13.132ia-c — Embed evidence photos inline (was: filename list).
    # Falls back to the pre-.132ia-c attachments list when there are no
    # photos so the section header still renders on empty incidents.
    photo_refs = list(inc.get('evidence_photos') or inc.get('photo_urls') or [])
    story += P.section_label('Evidence photos')
    story += P.photos_section(photo_refs)
    # Timeline (synthesised if absent)
    events = list(inc.get('timeline') or [])
    if not events:
        if inc.get('occurred_at'):
            events.append({'at': inc['occurred_at'], 'label': 'Incident occurred'})
        if inc.get('created_at'):
            events.append({'at': inc['created_at'], 'label': 'Reported',
                           'by': inc.get('reporter') or inc.get('reported_by')})
        if inc.get('immediate_actions'):
            events.append({'at': inc.get('updated_at') or inc.get('created_at'),
                           'label': 'Immediate actions logged'})
    story += P.section_label('Timeline')
    story += P.timeline_section(events)
    story += P.section_label('Signatures')
    # v58.13.132ia-c — Populate real signature payloads when present.
    # `inc.signatures` shape: list of dicts { role, image | image_url,
    # signed_by?, signed_at? }. Falls back to blank Reporter / Site
    # manager / HSEQ lead boxes when the list is empty or shorter than
    # the default 3 roles.
    sigs = list(inc.get('signatures') or [])
    story += [P.signatures_section(['Reporter', 'Site manager', 'HSEQ lead'],
                                    signatures=sigs)]
    doc.build(story)
    return buf.getvalue()


def render_inspection_pdf(insp: dict) -> bytes:
    """Phase 3.22b — migrated to shared `pdf_template`."""
    import pdf_template as P
    buf = io.BytesIO()
    doc = P.make_doc(buf, 'WHS · Inspection report',
                     insp.get('status') or 'complete', doc_id=insp.get('id'))
    items = insp.get('checklist_items') or []
    story: list = []
    story += P.title_block(
        f"{insp.get('template_name', 'Inspection')} · {insp.get('date', '')}",
        insp.get('location') or 'Site inspection record',
    )
    # Build a synthetic dict for the evidence line that knows about checklist counts
    suff = dict(insp)
    suff['controls'] = items
    suff['corrective_actions'] = insp.get('corrective_actions') or []
    story.append(P.evidence_sufficiency_line(suff))
    story += P.section_label('Overview')
    story += [P.field_grid([
        ('Template',  insp.get('template_name')),
        ('Date',      insp.get('date')),
        ('Inspector', insp.get('inspector') or (insp.get('created_by') or '')[:8] or None),
        ('Status',    (insp.get('status') or '').replace('_', ' ').title() or None),
        ('Workspace', (insp.get('workspace_id') or '')[:8] or None),
        ('Reference', (insp.get('id') or '')[:8] or None),
    ])]
    story += P.section_label('Checklist')
    if items:
        rows = []
        for i, it in enumerate(items):
            rows.append([str(i + 1), it.get('item', ''),
                         (it.get('response') or '').upper() or '—',
                         it.get('notes') or '—'])
        story += [P.data_table(['#', 'Item', 'Result', 'Notes'], rows,
                              col_widths=[10 * mm, None, 22 * mm, 50 * mm])]
    else:
        story += [P.Paragraph('No checklist items recorded.', P.BODY_MUTED)]
    # Photos
    photo_atts = []
    for i, it in enumerate(items):
        if it.get('photo_url'):
            photo_atts.append({
                'name': f"item-{i+1}-{(it.get('item') or 'photo')[:40]}",
                'kind': 'inspection photo',
            })
    story += P.section_label('Attachments')
    story += P.attachments_section(photo_atts)
    # Corrective actions
    story += P.section_label('Corrective actions')
    corr = insp.get('corrective_actions') or []
    if corr:
        story += [P.data_table(
            ['Action', 'Owner', 'Due'],
            [[a.get('action', ''), a.get('owner', ''), a.get('due_date', '')] for a in corr],
        )]
    else:
        story += [P.Paragraph('No corrective actions raised.', P.BODY_MUTED)]
    # Timeline
    events = list(insp.get('timeline') or [])
    if not events:
        if insp.get('date'):
            events.append({'at': insp['date'], 'label': 'Inspection completed',
                           'by': insp.get('inspector')})
        if corr:
            events.append({'at': insp.get('updated_at') or insp.get('created_at'),
                           'label': f"{len(corr)} corrective action{'s' if len(corr) != 1 else ''} raised"})
    story += P.section_label('Timeline')
    story += P.timeline_section(events)
    story += P.section_label('Signatures')
    story += [P.signatures_section(['Inspector', 'Site supervisor'])]
    doc.build(story)
    return buf.getvalue()


def render_hazard_pdf(h: dict) -> bytes:
    """Phase 3.22a — migrated to the shared `pdf_template`. Same input
    contract (hazard dict, returns bytes) so every caller (`pdf_routes`,
    audit exports, email outbox) is unchanged. The on-disk filename and
    Content-Disposition stay identical."""
    import pdf_template as P
    sev = (h.get('severity') or '').strip() or None
    buf = io.BytesIO()
    doc = P.make_doc(buf, 'WHS · Hazard report', sev, doc_id=h.get('id'))
    story: list = []
    story += P.title_block(
        h.get('title') or 'Untitled hazard',
        h.get('location') or h.get('subtitle') or 'Hazard recorded on site walk',
    )
    story.append(P.evidence_sufficiency_line(h))
    # Overview field grid
    story += P.section_label('Overview')
    story += [P.field_grid([
        ('Title',     h.get('title')),
        ('Severity',  (h.get('severity') or '').upper() or None),
        ('Status',    (h.get('status') or '').replace('_', ' ').title() or None),
        ('Location',  h.get('location')),
        ('Owner',     h.get('owner') or h.get('reported_by')),
        ('Created',   (h.get('created_at') or '')[:10] or None),
        ('Workspace', (h.get('workspace_id') or '')[:8] or None),
        ('Reference', (h.get('id') or '')[:8] or None),
    ])]
    # Description
    story += P.section_label('Description')
    story += P.description(h.get('description'))
    # Controls applied
    story += P.section_label('Controls applied')
    story += P.bullets(h.get('controls'))
    # AI analysis (only if present — still rendered as a body block)
    if h.get('ai_analysis'):
        story += P.section_label('AI analysis')
        story += [P.Paragraph(
            f"<i>{str(h['ai_analysis']).replace('<', '&lt;')}</i>", P.BODY_MUTED)]
    # Attachments
    atts: list[dict] = []
    if h.get('photo_url'):
        atts.append({'name': h['photo_url'].rsplit('/', 1)[-1], 'kind': 'photo'})
    for a in (h.get('attachments') or []):
        if isinstance(a, dict):
            atts.append(a)
        elif isinstance(a, str):
            atts.append({'name': a.rsplit('/', 1)[-1], 'kind': 'file'})
    story += P.section_label('Attachments')
    story += P.attachments_section(atts)
    # Timeline — synthesise from the dict if no explicit timeline.
    events = list(h.get('timeline') or [])
    if not events:
        if h.get('created_at'):
            events.append({'at': h['created_at'], 'label': 'Hazard recorded',
                           'by': h.get('owner') or h.get('reported_by')})
        if h.get('controls'):
            events.append({'at': h.get('updated_at') or h.get('created_at'),
                           'label': 'Controls applied'})
        if (h.get('status') or '').lower() in {'closed', 'resolved'}:
            events.append({'at': h.get('updated_at') or h.get('created_at'),
                           'label': f"Marked {h['status'].lower()}"})
    story += P.section_label('Timeline')
    story += P.timeline_section(events)
    # Signatures — every hazard report gets a 2-up signature block.
    story += P.section_label('Signatures')
    story += [P.signatures_section(['Author', 'Approver'])]

    doc.build(story)
    return buf.getvalue()


# Legacy render_incident_pdf and render_inspection_pdf removed in 3.22b —
# the new versions live earlier in this file (search for "Phase 3.22b").





# ---- Persistence + slug helper ----

def _slugify(text: str, maxlen: int = 40) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "")).strip("-").lower()
    return (s or "doc")[:maxlen]


async def persist_pdf(name_hint: str, data: bytes) -> tuple[str, str]:
    """Write bytes to GridFS bucket, return (file_url, filename).

    v58.13.132gi — Migrated from `PDFS_DIR/{filename}.pdf` to GridFS
    under subdir `pdfs`. `dashboard.serve_pdf` reads via `_serve_async`
    so the response bytes come from GridFS first (disk fallback for
    pre-migration files kept by `_serve_async`). The `/api/files/pdfs/...`
    URL shape is preserved so no caller changes.

    Async because the only live caller
    (`email_outbox._pdf_attachment_for`) is already async and GridFS
    writes are I/O bound — no reason to bridge sync/async.
    """
    filename = f"{_slugify(name_hint)}.pdf"
    from uploads_storage import save_upload  # noqa: WPS433
    await save_upload(
        "pdfs", [filename], data,
        module="pdf_renderer", mime="application/pdf",
        orig_filename=filename,
    )
    return f"/api/files/pdfs/{filename}", filename


def filename_for(record: dict, kind: str) -> str:
    if kind == "swms":
        return f"SWMS-{_slugify(record.get('title', ''))}-v{record.get('version', 1)}.pdf"
    if kind == "pre_starts":
        return f"Pre-Start-{record.get('date', 'undated')}-{record.get('workspace_id', '')[:8]}.pdf"
    if kind == "site_diary":
        return f"Site-Diary-{record.get('date', 'undated')}.pdf"
    if kind == "hazards":
        return f"Hazard-{_slugify(record.get('title', ''))}.pdf"
    if kind == "incidents":
        return f"Incident-{_slugify(record.get('title', ''))}.pdf"
    if kind == "inspections":
        return f"Inspection-{_slugify(record.get('template_name', ''))}-{record.get('date', '')}.pdf"
    if kind == "cs_incidents":
        # v58.13.48 — filename mirrors the audit-report shape:
        #   `CSIncident-<issue-number>-<date-of-issue>.pdf`.
        return (
            f"CSIncident-{_slugify(str(record.get('issue_number') or 'x'))}"
            f"-{str(record.get('date_of_issue') or '')[:10]}.pdf"
        )
    return f"record-{record.get('id', 'x')[:8]}.pdf"


RENDERERS = {
    "swms":         (render_swms_pdf,         "swms"),
    "pre_starts":   (render_pre_start_pdf,    "pre_starts"),
    "site_diary":   (render_site_diary_pdf,   "site_diary_entries"),
    "hazards":      (render_hazard_pdf,       "hazards"),
    "incidents":    (render_incident_pdf,     "incidents"),
    "inspections":  (render_inspection_pdf,   "inspections"),
    # v58.13.48 — CS Incidents (reference_library XLSX-import).
    "cs_incidents": (render_cs_incident_pdf,  "cs_incident_issues"),
}
