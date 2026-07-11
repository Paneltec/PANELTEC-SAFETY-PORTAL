"""PDF renderer for Forms Library submissions.

Renders a submission with header (template, submitter, timestamp), a row per
field, embedded photos / signature / GPS map snippet.

Shares the brand tokens + frame helpers with `pdf_renderer.py`.
"""
from __future__ import annotations
import base64
import io
import re
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

UPLOADS_ROOT = Path(__file__).parent / "uploads"
FORM_PHOTOS = UPLOADS_ROOT / "form_photos"


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
        for f in fields:
            raw_label = f.get("label") or "Untitled"
            # v160.3.0-adjust-16a — Trim label to the short title. Strip
            # everything after the em-dash (fill-flow guidance like
            # "— Windscreen, mirrors & light covers") AND any trailing
            # parenthetical (e.g. "(fill in if Yes above)"). The full
            # label is still stored on the template + submission —
            # only the display is simplified. Also drop the field-type
            # debug tag next to the label — that was dev noise on a
            # user-facing report.
            label = raw_label.split("—")[0].strip()
            label = re.sub(r"\s*\([^)]*\)\s*$", "", label).strip() or raw_label
            ftype = f.get("type") or "text"
            val = f.get("value")

            # v160.3.0-adjust-16a (photo suppression) — Skip empty photo
            # fields entirely. Every SSRA / TTM / Tight-Site template
            # declares 3-6 photo slots that are usually empty on legacy
            # imports. Rendering them as "No photos captured." creates
            # long stretches of near-empty rows that dominate the
            # report. If there's no attachment, the field disappears.
            if ftype == "photo":
                has_photo = isinstance(val, list) and any(
                    isinstance(ph, dict) and (ph.get("filename") or ph.get("url") or ph.get("data_url"))
                    for ph in val
                )
                if not has_photo:
                    continue

            # v160.3.0-adjust-16a (tighten) — Reduced inter-field spacer
            # from 4pt to 2pt so scannable-checklist density replaces
            # the previous form-like whitespace.
            story += [Spacer(1, 2)]
            story += [_para(f"<b>{label}</b>", "PtBody")]

            if ftype == "photo":
                # (Only reached when has_photo was true — safe to render.)
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

            else:
                story.append(_para(_value_to_text(val)))

    story += [Spacer(1, 8), _para(
        f"Submission id {sub.get('id', '')[:8]} · Paneltec Civil", "PtSmall")]

    doc.build(story)
    return buf.getvalue()
