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

            else:
                story.append(_para(_value_to_text(val)))

        # Final flush of any trailing scalars.
        _flush()

    story += [Spacer(1, 8), _para(
        f"Submission id {sub.get('id', '')[:8]} · The Paneltec Group", "PtSmall")]

    doc.build(story)
    return buf.getvalue()
