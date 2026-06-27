"""PDF renderer for Forms Library submissions.

Renders a submission with header (template, submitter, timestamp), a row per
field, embedded photos / signature / GPS map snippet.

Shares the brand tokens + frame helpers with `pdf_renderer.py`.
"""
from __future__ import annotations
import base64
import io
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
            label = f.get("label") or "Untitled"
            ftype = f.get("type") or "text"
            val = f.get("value")

            # Field header row.
            story += [Spacer(1, 4)]
            story += [_para(f"<b>{label}</b>  <font color='#94A3B8' size='7'>{ftype.upper()}</font>", "PtBody")]

            if ftype == "photo":
                if isinstance(val, list) and val:
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
                else:
                    story.append(_para("No photos captured.", "PtMuted"))

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

            else:
                story.append(_para(_value_to_text(val)))

    story += [Spacer(1, 8), _para(
        f"Submission id {sub.get('id', '')[:8]} · Paneltec Civil", "PtSmall")]

    doc.build(story)
    return buf.getvalue()
