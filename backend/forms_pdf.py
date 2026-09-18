"""PDF renderer for Forms Library submissions.

Renders a submission with header (template, submitter, timestamp), a row per
field, embedded photos / signature / GPS map snippet.

Shares the brand tokens + frame helpers with `pdf_renderer.py`.
"""
from __future__ import annotations
import base64
import io
import logging
import re
import urllib.request
from pathlib import Path
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.platypus import Image, Paragraph, Spacer, Table, TableStyle

from pdf_renderer import (
    BRAND_BLUE, BRAND_BORDER, BRAND_INK, BRAND_MUTED, MINT_BG, SLATE_BG,
    STYLES, _bullets, _crumb, _kv_table, _make_doc, _para, _section,
)

log = logging.getLogger(__name__)


# v160.3.0-adjust-16b — Smart em-dash strip.
# The adjust-16a rule "strip everything after em-dash" was overzealous: it
# collapsed multi-item SSRA fields (`TAILGATE — Discuss Scope`,
# `TAILGATE — Designate Radio Channel`, …) to the same "TAILGATE" label,
# so the PDF/UI showed 7 identical rows. The correct rule:
#   • if the BEFORE part is a short ALL-CAPS section prefix (≤ 24 chars)
#     → keep the AFTER part as the label (that's the actual item text).
#   • otherwise (mixed-case guidance suffix) → keep BEFORE as the label
#     (adjust-16a's original intent, e.g. "Fluid Levels — Check oil…" →
#     "Fluid Levels").
# Always strip a trailing parenthetical guidance ("(fill in if …)").
def _display_label(raw_label: str) -> str:
    if not raw_label:
        return "Untitled"
    lbl = raw_label.strip()
    if "—" in lbl:
        before, _, after = lbl.partition("—")
        before, after = before.strip(), after.strip()
        # Section prefix pattern (TAILGATE, PPE, RISK, EMERGENCY, …)
        if before and before.upper() == before and len(before) <= 24 and after:
            lbl = after
        else:
            lbl = before or after
    lbl = re.sub(r"\s*\([^)]*\)\s*$", "", lbl).strip()
    return lbl or raw_label

UPLOADS_ROOT = Path(__file__).parent / "uploads"
FORM_PHOTOS = UPLOADS_ROOT / "form_photos"

# v160.3.0-adjust-16c — Static map image cache. When a GPS field is
# rendered, we fetch a static tile from OpenStreetMap's staticmap service
# (no API key, free) and cache it under `/app/backend/gps_map_cache/`
# keyed by rounded lat,lng (5 decimals ≈ 1 m precision). A location's
# rendered map doesn't change so entries are permanent. Failures degrade
# gracefully to text-only rendering.
GPS_MAP_CACHE = Path(__file__).parent / "gps_map_cache"
GPS_MAP_CACHE.mkdir(exist_ok=True)


def _fetch_static_map(lat: float, lng: float,
                       width: int = 500, height: int = 300,
                       zoom: int = 16) -> Optional[Path]:
    """Return a Path to a cached PNG static map for (lat, lng), or None
    if the composition fails. Best-effort; logs but never raises.

    v160.3.0-adjust-16e — Composes the map from raw OpenStreetMap tiles
    (via `gps_map_composer.compose_static_map`) so labels are in English
    (Latin script) rather than Yandex's Cyrillic. Cache is on-disk and
    permanent — a location's map doesn't change.
    """
    try:
        lat_f, lng_f = float(lat), float(lng)
        key = f"{round(lat_f, 5)},{round(lng_f, 5)}_{width}x{height}_z{zoom}.png"
    except (TypeError, ValueError):
        return None
    cached = GPS_MAP_CACHE / key
    if cached.exists() and cached.stat().st_size > 200:
        return cached

    try:
        from gps_map_composer import compose_static_map
        img = compose_static_map(lat_f, lng_f, width=width, height=height, zoom=zoom)
    except Exception as e:
        log.warning("staticmap composer crashed for %s,%s: %s", lat_f, lng_f, e)
        return None
    if img is None:
        return None
    try:
        img.save(cached, "PNG", optimize=True)
    except Exception as e:
        log.warning("staticmap cache write failed for %s,%s: %s", lat_f, lng_f, e)
        return None
    return cached


def _photo_path(submission_id: str, photo: dict) -> Optional[Path]:
    """Resolve a submission photo to disk."""
    stored = (photo or {}).get("stored_name")
    if not stored:
        return None
    if "/" in stored or ".." in stored:
        return None
    p = FORM_PHOTOS / submission_id / stored
    return p if p.exists() else None


def _decode_signature(b64: Optional[str]) -> Optional[bytes]:
    """react-signature-canvas exports `data:image/png;base64,XXXX`."""
    if not b64 or not isinstance(b64, str):
        return None
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        return base64.b64decode(b64, validate=False)
    except Exception:
        return None


def _value_to_text(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, list):
        return ", ".join(str(x) for x in v) if v else "—"
    if isinstance(v, bool):
        return "Yes" if v else "No"
    s = str(v).strip()
    return s or "—"


# v58.13.132ij — Compliance answer rendering helpers.

_COMPLIANCE_PILL_STYLES = {
    "compliant": {"label": "COMPLIANT",
                  "bg": colors.HexColor("#10B981"),
                  "fg": colors.white},
    "at_risk":   {"label": "AT RISK",
                  "bg": colors.HexColor("#F43F5E"),
                  "fg": colors.white},
    "na":        {"label": "N/A",
                  "bg": colors.HexColor("#94A3B8"),
                  "fg": colors.white},
}


def _compliance_pill_flowable(status: str) -> Table:
    """Return a small coloured pill Table with the status text. Used
    inline with the question label so the auditor sees the outcome
    at a glance."""
    cfg = _COMPLIANCE_PILL_STYLES.get(status) or {
        "label": "UNANSWERED",
        "bg": colors.HexColor("#E2E8F0"),
        "fg": colors.HexColor("#475569"),
    }
    cell = Paragraph(
        f"<font size='7' color='#{cfg['fg'].hexval()[2:]}'"
        f"><b>{cfg['label']}</b></font>",
        STYLES["PtSmall"],
    )
    t = Table([[cell]], colWidths=[0.9 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), cfg["bg"]),
        ("BOX", (0, 0), (-1, -1), 0.6, cfg["bg"]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return t


def _render_compliance_answer(story: list, field: dict, submission_id: str) -> None:
    """Emit the compliance answer for `field` into `story` in-place.

    Layout order:
      1. `<b>label</b>  <status pill>` header row.
      2. Photo thumbnail row (up to 4-wide).
      3. Notes paragraph in a subtle grey block.

    Legacy fallback: if the answer value is a scalar (pre-.132ig
    migration) or the migration left `_legacy_status` on the entry,
    render that text and skip the pill/photos/notes machinery.
    """
    label = _display_label(field.get("label") or "Untitled")
    val = field.get("value")
    legacy = field.get("_legacy_status")

    # 1. Legacy scalar answer OR no dict-shape value → render as text.
    if not isinstance(val, dict):
        story.append(Spacer(1, 2))
        story.append(Paragraph(f"<b>{label}</b>", STYLES["PtBody"]))
        if legacy is not None and str(legacy).strip():
            story.append(_para(f"Legacy answer: {legacy}", "PtMuted"))
        elif val not in (None, ""):
            story.append(_para(_value_to_text(val)))
        else:
            story.append(_para("Not answered.", "PtMuted"))
        return

    status = val.get("status")
    photos = val.get("photos") if isinstance(val.get("photos"), list) else []
    notes = val.get("notes") if isinstance(val.get("notes"), str) else ""

    # 1. Label + status pill in a single row so they render side-by-side.
    header = Table(
        [[Paragraph(f"<b>{label}</b>", STYLES["PtBody"]),
          _compliance_pill_flowable(status)]],
        colWidths=[4.6 * inch, 1.0 * inch],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(Spacer(1, 2))
    story.append(header)

    if legacy is not None and str(legacy).strip():
        story.append(_para(f"Migrated from legacy answer: {legacy}", "PtSmall"))

    # 2. Photo thumbnail row — up to 4 wide. Additional rows overflow
    #    naturally when there are >4 photos.
    resolved_paths: list[Path] = []
    missing: list[str] = []
    for ph in photos:
        if not isinstance(ph, dict):
            continue
        p = _photo_path(submission_id, ph)
        if p is not None:
            resolved_paths.append(p)
        else:
            missing.append(ph.get("filename") or ph.get("stored_name") or "photo")
    if resolved_paths:
        thumb_w = 1.5 * inch
        thumb_h = 1.1 * inch
        row: list = []
        rows: list[list] = [row]
        for path in resolved_paths:
            if len(row) >= 4:
                row = []
                rows.append(row)
            try:
                row.append(Image(str(path), width=thumb_w, height=thumb_h,
                                 kind="proportional"))
            except Exception:
                row.append(_para("[photo]", "PtMuted"))
        # Pad final row so the last chunk left-aligns properly.
        while len(rows[-1]) < 4:
            rows[-1].append("")
        thumb_table = Table(rows, colWidths=[thumb_w + 0.05 * inch] * 4)
        thumb_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(thumb_table)
    if missing:
        story.append(_para(
            f"[Photos referenced but missing on disk: {', '.join(missing)}]",
            "PtMuted",
        ))

    # 3. Notes in a subtle grey block.
    if notes.strip():
        notes_table = Table(
            [[_para(notes.strip(), "PtSmall")]],
            colWidths=[5.6 * inch],
        )
        notes_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SLATE_BG),
            ("BOX", (0, 0), (-1, -1), 0.4, BRAND_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(Spacer(1, 3))
        story.append(notes_table)


def render_form_submission_pdf(sub: dict, template: dict) -> bytes:
    buf = io.BytesIO()
    title = sub.get("template_name_snapshot") or template.get("name") or "Form submission"
    status = "complete"  # status decoration is best-effort
    doc = _make_doc(buf, title, status, _crumb(sub, "Form submission"))

    story = []

    # Overview block.
    story += [_section("Submission overview")]
    story += [_kv_table([
        ("Template", title),
        ("Category", (template.get("category") or sub.get("template_category_snapshot") or "general").replace("_", " ").title()),
        ("Submitted by", sub.get("submitted_by_name") or "—"),
        ("Submitted at", (sub.get("submitted_at") or "")[:19].replace("T", " ")),
        ("Description", template.get("description") or "—"),
    ])]

    # Per-field rows.
    fields = sub.get("fields") or []
    if not fields:
        story += [_section("Responses"), _para("No data captured.", "PtMuted")]
    else:
        story += [_section("Responses")]

        # v160.3.0-adjust-16b — Two-pass render:
        #   1. Group scalar rows (radio / text / number / textarea / select /
        #      worker_picker / date) into a single label|value table so each
        #      field renders as its own row, matching the CVT reference layout
        #      the user asked for:
        #          Signs, Tools & Equipment          On Board
        #          Jetting System                    OK
        #          Fire Extinguisher…                OK
        #   2. Flush the scalar table, then emit any complex row
        #      (photo / signature / gps / vehicle_navixy) inline.
        SCALAR_TYPES = {"text", "textarea", "number", "select", "radio",
                        "date", "worker_picker", "checkbox"}

        pending_rows: list = []

        def _flush():
            nonlocal pending_rows
            if pending_rows:
                story.append(_kv_table(pending_rows))
                story.append(Spacer(1, 4))
                pending_rows = []

        def _scalar_value_str(v, ftype: str) -> str:
            if v is None:
                return "—"
            if ftype == "worker_picker" and isinstance(v, list):
                names = [w.get("name") for w in v if isinstance(w, dict) and w.get("name")]
                return ", ".join(names) if names else "—"
            return _value_to_text(v)

        for f in fields:
            raw_label = f.get("label") or "Untitled"
            label = _display_label(raw_label)
            ftype = f.get("type") or "text"
            val = f.get("value")

            # v160.3.0-adjust-16a (photo suppression) — Skip empty photo
            # fields entirely.
            if ftype == "photo":
                has_photo = isinstance(val, list) and any(
                    isinstance(ph, dict) and (ph.get("filename") or ph.get("url") or ph.get("data_url"))
                    for ph in val
                )
                if not has_photo:
                    continue

            # Scalar → accumulate into two-column table.
            if ftype in SCALAR_TYPES:
                pending_rows.append((label, _scalar_value_str(val, ftype)))
                continue

            # Complex field — flush the scalar table first, then render.
            _flush()
            # v160.3.0-adjust-16b — Use Paragraph directly for the bold
            # label; `_para` HTML-escapes `<` and would render "<b>…</b>"
            # as literal text on the PDF.
            story += [Spacer(1, 2), Paragraph(f"<b>{label}</b>", STYLES["PtBody"])]

            if ftype == "photo":
                for ph in val:
                    path = _photo_path(sub.get("id", ""), ph)
                    if path:
                        try:
                            img = Image(str(path), width=4.0 * inch, height=3.0 * inch,
                                        kind="proportional")
                            story.append(img)
                            story.append(_para(ph.get("filename") or "", "PtSmall"))
                        except Exception:
                            story.append(_para("[Photo unavailable]", "PtMuted"))
                    else:
                        story.append(_para(f"[Photo missing on disk: {ph.get('filename', '')}]", "PtMuted"))

            elif ftype == "signature":
                raw = _decode_signature(val)
                if raw:
                    try:
                        img = Image(io.BytesIO(raw), width=2.6 * inch, height=1.0 * inch,
                                    kind="proportional")
                        story.append(img)
                    except Exception:
                        story.append(_para("[Signature unavailable]", "PtMuted"))
                else:
                    story.append(_para("Not signed.", "PtMuted"))

            elif ftype == "gps":
                if isinstance(val, dict) and val.get("lat") is not None and val.get("lng") is not None:
                    lat = val.get("lat")
                    lng = val.get("lng")
                    acc = val.get("accuracy")
                    captured = (val.get("captured_at") or "")[:19].replace("T", " ")

                    # v160.3.0-adjust-16c — Embed a static map image
                    # inline (OpenStreetMap staticmap, cached to disk).
                    # If fetch fails, gracefully drop back to text-only.
                    map_path = None
                    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
                        map_path = _fetch_static_map(lat, lng)
                    if map_path:
                        try:
                            story.append(Image(str(map_path), width=4.5 * inch, height=2.7 * inch,
                                               kind="proportional"))
                            story.append(Spacer(1, 4))
                        except Exception:
                            log.warning("failed to embed static map from %s", map_path)

                    story.append(_kv_table([
                        ("Latitude", f"{lat:.6f}" if isinstance(lat, (int, float)) else lat),
                        ("Longitude", f"{lng:.6f}" if isinstance(lng, (int, float)) else lng),
                        ("Accuracy (m)", f"{acc:.0f}" if isinstance(acc, (int, float)) else (acc or "—")),
                        ("Captured at", captured or "—"),
                        ("Map link", f"https://www.google.com/maps?q={lat},{lng}"),
                    ]))
                else:
                    story.append(_para("Location not captured.", "PtMuted"))

            elif ftype == "vehicle_navixy":
                if isinstance(val, dict) and (val.get("registration") or val.get("label")):
                    parts = []
                    if val.get("label"):
                        parts.append(str(val["label"]))
                    if val.get("registration"):
                        parts.append(str(val["registration"]))
                    story.append(_para(f"Vehicle: {' · '.join(parts)}"))
                else:
                    story.append(_para("No vehicle selected.", "PtMuted"))

            elif ftype == "compliance":
                # v58.13.132ij — Render compliance answers as:
                #   1. Coloured status pill inline with the label.
                #   2. Up to 4-wide photo thumbnail row.
                #   3. Notes as a subtle grey paragraph block.
                # Legacy `_legacy_status` fallback: if the answer has no
                # `status` dict but the migration left a `_legacy_status`
                # scalar, render it as text so the PDF audit trail keeps
                # showing yes/no/na for pre-migration answers.
                _render_compliance_answer(story, f, sub.get("id", ""))

            else:
                story.append(_para(_value_to_text(val)))

        # Final flush of any trailing scalars.
        _flush()

    # v58.13.132ik — Imported-legacy-PDF evidence-photo tail section.
    # When the submission was created via `/imports/pdf` and PyMuPDF
    # pulled raster images out of the source PDF, `evidence_photos`
    # carries the persisted image list. Render a labelled section so
    # the AI-generated PDF preserves the original visual evidence.
    evidence = sub.get("evidence_photos") or []
    if evidence:
        story += [Spacer(1, 6),
                  _section(f"Extracted evidence photos ({len(evidence)})")]
        story += [_para(
            "Photos pulled from the original imported PDF. Kept for audit.",
            "PtMuted",
        )]
        # 4-wide thumbnail grid. Same shape as the compliance widget's
        # photo row, so the layout stays consistent.
        thumb_w = 1.5 * inch
        thumb_h = 1.1 * inch
        row: list = []
        rows: list[list] = [row]
        missing: list[str] = []
        for ph in evidence:
            if not isinstance(ph, dict):
                continue
            path = _photo_path(sub.get("id", ""), ph)
            if path is None:
                missing.append(ph.get("filename") or ph.get("stored_name") or "photo")
                continue
            if len(row) >= 4:
                row = []
                rows.append(row)
            try:
                row.append(Image(str(path), width=thumb_w, height=thumb_h,
                                 kind="proportional"))
            except Exception:
                row.append(_para("[photo]", "PtMuted"))
        while rows[-1] and len(rows[-1]) < 4:
            rows[-1].append("")
        if rows and rows[0]:
            evidence_table = Table(rows, colWidths=[thumb_w + 0.05 * inch] * 4)
            evidence_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(evidence_table)
        if missing:
            story.append(_para(
                f"[Evidence photos missing on disk: {', '.join(missing)}]",
                "PtMuted",
            ))

    story += [Spacer(1, 8), _para(
        f"Submission id {sub.get('id', '')[:8]} · The Paneltec Group", "PtSmall")]

    doc.build(story)
    return buf.getvalue()
