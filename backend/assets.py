"""Asset Register — unified Plant & Vehicles register.

Phase 1: merges live Navixy vehicles with manually-added plant (excavators,
generators, tools, containers). Each asset gets a unique scan token used for
QR labels, NFC pairing, and (future) UHF EPC pairing.
"""
from __future__ import annotations
import io
import logging
import os
import re
import secrets
import string
from typing import Literal, Optional

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from reportlab.lib.colors import black, grey, white
from reportlab.lib.pagesizes import A4, A6
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from auth import get_current_user
from permissions import require_permission
from db import db
from models import new_id, now_iso
# Phase 3.22c — every card-style PDF now goes through the shared 2-colour
# template (orange + slate). No HexColor calls in this file.
from pdf_card_template import (header_band, qr_image, qr_block, footer_brand,
                                pairing_zone, cut_guide,
                                ORANGE, SLATE, SLATE_MUTED, SLATE_BORDER)

log = logging.getLogger("paneltec.assets")
router = APIRouter(prefix="/assets", tags=["assets"])

AssetKind = Literal["vehicle", "plant", "tool", "container"]
AssetType = Literal[
    "vacuum_truck", "tipper", "dump_truck", "semi_trailer", "ute",
    "crane_truck", "service_truck", "excavator", "loader", "bulldozer",
    "grader", "compactor", "skid_steer", "backhoe", "generator",
    "pump", "compressor", "lighting_tower", "trailer", "container",
    "tool", "other",
]
AssetStatus = Literal["active", "retired"]

_ALPHABET = string.ascii_letters + string.digits  # URL-safe, 62 chars


# ────────────────────── helpers ──────────────────────

def _scan_token() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(10))


def _public_base() -> str:
    base = os.environ.get("FRONTEND_PUBLIC_URL", "").rstrip("/")
    if not base:
        base = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
    return base


def _public_scan_url(token: str) -> str:
    base = _public_base()
    return f"{base}/scan/{token}" if base else f"/scan/{token}"


def _parse_rego_from_label(label: str) -> Optional[str]:
    """Best-effort: take the last whitespace-separated token, strip trailing
    punctuation. Handles Navixy labels like 'Cap Recycler - XT96AZ',
    'VTS - BT-50 - L07QF', 'Vacvator 2 -Hino 500-XT35DO.'."""
    if not label:
        return None
    # Split on whitespace, dashes, hyphens. Keep alphanumeric tokens.
    tokens = re.findall(r"[A-Za-z0-9]+", label)
    if not tokens:
        return None
    last = tokens[-1]
    # Must contain at least one digit and at least one letter to look rego-ish.
    has_digit = any(c.isdigit() for c in last)
    has_alpha = any(c.isalpha() for c in last)
    if has_digit and has_alpha and 4 <= len(last) <= 10:
        return last.upper()
    return None


def _sanitize_public(doc: dict) -> dict:
    """Public sanitised payload — no org_id, no created_by, no internal fields."""
    last_seen = doc.get("last_known_lat") is not None and doc.get("last_known_lng") is not None
    return {
        "id": doc.get("id"),
        "name": doc.get("name"),
        "kind": doc.get("kind"),
        "asset_type": doc.get("asset_type"),
        "rego_serial": doc.get("rego_serial"),
        "navixy_device_id": doc.get("navixy_device_id"),
        "has_position": bool(last_seen),
        "last_known_lat": doc.get("last_known_lat"),
        "last_known_lng": doc.get("last_known_lng"),
        "workspace_id": doc.get("workspace_id"),
        "status": doc.get("status"),
        "hours_meter": doc.get("hours_meter"),
        "hours_meter_updated_at": doc.get("hours_meter_updated_at"),
        "hours_meter_source": doc.get("hours_meter_source"),
        "odo_km": doc.get("odo_km"),
        "odo_km_updated_at": doc.get("odo_km_updated_at"),
        "odo_km_source": doc.get("odo_km_source"),
    }


def _internal(doc: dict) -> dict:
    """Strip Mongo internals from a doc destined for the authed UI."""
    out = dict(doc)
    out.pop("_id", None)
    # Phase 3.15 — surface a derived Navixy health chip + canonical
    # last_seen_at so the frontend can render the green/red dot without
    # touching the live API on each render.
    out["navixy_last_seen_at"] = _navixy_last_seen_at(out)
    out["navixy_health"] = _compute_navixy_health(out)
    return out


# v159.0 — Non-admin callers (supervisor / auditor) get a thin asset row that
# omits cost, service history, insurance and GPS trail data. Admin + hseq_lead
# still see the full document. Worker access is denied outright by the
# permissions matrix (`assets.view=False`) — this projection is a defence-in-
# depth safety net in case an override ever grants a non-privileged role the
# view action.
_ASSET_SENSITIVE_FIELDS = (
    "cost", "service_cost", "purchase_price",
    "gps_last_seen_lat", "gps_last_seen_lng", "gps_history",
    "driver_id", "service_history", "insurance_details",
    # Also strip the raw lat/lng breadcrumbs on non-admin views.
    "last_known_lat", "last_known_lng",
)


def _serialise_thin_asset(doc: dict) -> dict:
    out = _internal(doc)
    for field in _ASSET_SENSITIVE_FIELDS:
        out.pop(field, None)
    return out


def _wants_full_asset(user: dict) -> bool:
    """Only admin + hseq_lead callers see the full asset row (cost / GPS /
    service history). Everyone else gets `_serialise_thin_asset`."""
    return user.get("role") in {"admin", "hseq_lead"}


# ────────────── Phase 3.15 — Navixy health chip ──────────────

# 24h freshness threshold. Tune here, not in the frontend.
NAVIXY_FRESH_THRESHOLD_HOURS = 24


def _navixy_last_seen_at(asset: dict) -> Optional[str]:
    """Canonical "last contact" timestamp for the asset.

    Phase 3.15-fix-2 — order of preference SWITCHED to the upstream
    sensor timestamp because our local poll stamp ALWAYS ticks (we always
    hit Navixy on cron) regardless of whether the tracker itself is
    phoning home. Result: unplugged trackers like Z130 looked GREEN.

    Priority now:
      1. `navixy_last_position_time` — the upstream tracker's own
         last_update timestamp, ground-truth for liveness.
      2. `hours_meter_updated_at` / `odo_km_updated_at` — counter ticks.
      3. `navixy_last_seen_at` — our local cron-poll stamp, only as a
         last-resort breadcrumb so legacy rows without any upstream
         freshness still resolve to *something* the UI can render.
    """
    candidates = [asset.get("navixy_last_position_time"),
                  asset.get("hours_meter_updated_at"),
                  asset.get("odo_km_updated_at"),
                  asset.get("navixy_last_seen_at")]
    candidates = [c for c in candidates if c]
    if not candidates:
        return None
    return max(candidates)


# Connection statuses that mean the tracker isn't talking to Navixy right
# now. `just_registered` covers devices paired in the panel but never
# powered on (the Z130 case).
_OFFLINE_STATUSES = {"offline", "just_registered", "recently_lost"}


def _compute_navixy_health(asset: dict) -> Optional[str]:
    """Returns "green" | "red" | None.
      green  → asset has navixy_device_id AND fresh upstream signal
      red    → asset has navixy_device_id AND no fresh data
      None   → asset isn't linked to Navixy at all (no dot rendered)

    Phase 3.15-fix-2 — Navixy's own `connection_status` is the
    HIGHEST-priority signal: if upstream says offline / just_registered /
    recently_lost we always render RED regardless of how recent our poll
    was. Only when connection_status is online/idle/moving do we fall
    back to the 24h freshness math on the upstream position timestamp."""
    if not asset.get("navixy_device_id"):
        return None
    cs = (asset.get("navixy_connection_status") or "").strip().lower()
    if cs in _OFFLINE_STATUSES:
        return "red"
    last = _navixy_last_seen_at(asset)
    if not last:
        return "red"
    try:
        from datetime import datetime, timezone
        # Navixy emits "YYYY-MM-DD HH:MM:SS" (UTC); fromisoformat tolerates
        # either a space or a T separator if we swap, but the timestamp is
        # naïve so we explicitly anchor to UTC.
        s = last.replace("Z", "+00:00").replace(" ", "T", 1)
        seen = datetime.fromisoformat(s)
        if seen.tzinfo is None:
            seen = seen.replace(tzinfo=timezone.utc)
        age_h = (datetime.now(timezone.utc) - seen).total_seconds() / 3600.0
    except Exception:
        return "red"
    return "green" if age_h <= NAVIXY_FRESH_THRESHOLD_HOURS else "red"


# ────────────────────── models ──────────────────────

class AssetIn(BaseModel):
    kind: AssetKind = "plant"
    name: str = Field(min_length=1, max_length=200)
    asset_type: str = Field(min_length=1, max_length=50)
    workspace_id: Optional[str] = None
    rego_serial: Optional[str] = Field(default=None, max_length=80)
    make: Optional[str] = Field(default=None, max_length=80)
    model: Optional[str] = Field(default=None, max_length=80)
    year: Optional[int] = Field(default=None, ge=1900, le=2100)
    owner: Optional[str] = Field(default=None, max_length=120)
    photo_file_id: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    status: AssetStatus = "active"


class NfcPairIn(BaseModel):
    nfc_uid: str = Field(min_length=4, max_length=32, pattern=r"^[A-Fa-f0-9:\-]+$")


class UhfPairIn(BaseModel):
    uhf_epc: str = Field(min_length=4, max_length=64, pattern=r"^[A-Fa-f0-9]+$")


# ────────────────────── Navixy backfill ──────────────────────

async def _backfill_from_navixy(org_id: str, user: dict) -> int:
    """Upsert one `asset` per Navixy vehicle. Idempotent — reconciles on
    `navixy_device_id`. Returns count of vehicles processed (not necessarily
    inserted; existing rows are updated with the latest label/asset_type)."""
    # Pull a fresh fleet list via the existing proxy (annotated with vehicle_type).
    from forms import _classify_vehicle_type  # noqa: WPS433
    from integrations import navixy_vehicles

    try:
        raw = await navixy_vehicles(tag_ids=None, user=user)
    except HTTPException:
        return 0
    except Exception as e:  # pragma: no cover — Navixy unavailable
        log.info("Navixy backfill skipped: %s", e)
        return 0

    processed = 0
    ts = now_iso()
    for v in raw.get("vehicles", []) or []:
        device_id = v.get("id")
        if not device_id:
            continue
        label = v.get("label") or "Unnamed vehicle"
        tag_names = [t.get("name") for t in (v.get("tags") or []) if isinstance(t, dict) and t.get("name")]
        asset_type = _classify_vehicle_type(label, tag_names)
        existing = await db.assets.find_one({"org_id": org_id, "navixy_device_id": int(device_id)})
        update = {
            "name": label,
            "asset_type": asset_type,
            "rego_serial": _parse_rego_from_label(label) or v.get("plate"),
            "last_known_lat": v.get("lat") if isinstance(v.get("lat"), (int, float)) else None,
            "last_known_lng": v.get("lng") if isinstance(v.get("lng"), (int, float)) else None,
            "updated_at": ts,
        }
        if existing:
            await db.assets.update_one({"id": existing["id"]}, {"$set": update})
        else:
            doc = {
                "id": new_id(),
                "org_id": org_id,
                "workspace_id": None,            # Navixy is org-wide
                "kind": "vehicle",
                "navixy_device_id": int(device_id),
                "nfc_uid": None,
                "uhf_epc": None,
                "scan_token": _scan_token(),
                "status": "active",
                "photo_file_id": None,
                "make": None,
                "model": None,
                "year": None,
                "owner": None,
                "notes": None,
                "created_at": ts,
                "created_by": user["id"],
                "deleted_at": None,
                **update,
            }
            try:
                await db.assets.insert_one(doc)
            except Exception:
                # Race condition on duplicate scan_token — retry once.
                doc["scan_token"] = _scan_token()
                await db.assets.insert_one(doc)
        processed += 1
    return processed


# ────────────────────── CRUD ──────────────────────

@router.get("")
async def list_assets(
    kind: Optional[str] = Query(None),
    asset_type: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    user: dict = Depends(require_permission("assets", "view")),
):
    org_id = user["org_id"]
    # Backfill from Navixy on every list — fast & idempotent.
    await _backfill_from_navixy(org_id, user)

    query: dict = {"org_id": org_id, "deleted_at": None}
    if kind and kind != "all":
        query["kind"] = kind
    if asset_type and asset_type != "all":
        query["asset_type"] = asset_type
    if q:
        rx = re.escape(q.strip())
        query["$or"] = [
            {"name": {"$regex": rx, "$options": "i"}},
            {"rego_serial": {"$regex": rx, "$options": "i"}},
            {"make": {"$regex": rx, "$options": "i"}},
            {"model": {"$regex": rx, "$options": "i"}},
        ]

    rows: list[dict] = []
    full = _wants_full_asset(user)
    async for row in db.assets.find(query, {"_id": 0}).sort("name", 1).limit(limit):
        rows.append(_internal(row) if full else _serialise_thin_asset(row))

    total_q = {"org_id": org_id, "deleted_at": None}
    total = await db.assets.count_documents(total_q)
    live = await db.assets.count_documents({**total_q, "navixy_device_id": {"$ne": None}})
    manual = total - live
    return {"assets": rows, "total": total, "live": live, "manual": manual, "returned": len(rows)}


@router.post("", status_code=201)
async def create_asset(body: AssetIn, user: dict = Depends(require_permission("assets", "edit"))):
    # `assets.edit` is enforced by the dep. Workers cannot reach here.
    ts = now_iso()
    workspace_id = body.workspace_id or (user.get("workspace_ids") or [None])[0]
    doc = {
        "id": new_id(),
        "org_id": user["org_id"],
        "workspace_id": workspace_id,
        "kind": body.kind,
        "name": body.name.strip(),
        "asset_type": body.asset_type.strip().lower().replace(" ", "_"),
        "rego_serial": (body.rego_serial or "").strip() or None,
        "make": (body.make or "").strip() or None,
        "model": (body.model or "").strip() or None,
        "year": body.year,
        "owner": (body.owner or "").strip() or None,
        "photo_file_id": body.photo_file_id,
        "navixy_device_id": None,
        "nfc_uid": None,
        "uhf_epc": None,
        "scan_token": _scan_token(),
        "status": body.status,
        "notes": (body.notes or "").strip() or None,
        "created_at": ts,
        "updated_at": ts,
        "created_by": user["id"],
        "deleted_at": None,
        "last_known_lat": None,
        "last_known_lng": None,
    }
    try:
        await db.assets.insert_one(doc)
    except Exception:
        doc["scan_token"] = _scan_token()
        await db.assets.insert_one(doc)
    return _internal(doc)


@router.get("/{asset_id}")
async def get_asset(asset_id: str, user: dict = Depends(require_permission("assets", "view"))):
    doc = await db.assets.find_one({"org_id": user["org_id"], "id": asset_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Asset not found")
    return doc if _wants_full_asset(user) else _serialise_thin_asset(doc)


@router.put("/{asset_id}")
async def update_asset(asset_id: str, body: AssetIn, user: dict = Depends(require_permission("assets", "edit"))):
    existing = await db.assets.find_one({"org_id": user["org_id"], "id": asset_id, "deleted_at": None})
    if not existing:
        raise HTTPException(404, "Asset not found")
    update = {
        "name": body.name.strip(),
        "asset_type": body.asset_type.strip().lower().replace(" ", "_"),
        "rego_serial": (body.rego_serial or "").strip() or None,
        "make": (body.make or "").strip() or None,
        "model": (body.model or "").strip() or None,
        "year": body.year,
        "owner": (body.owner or "").strip() or None,
        "photo_file_id": body.photo_file_id,
        "notes": (body.notes or "").strip() or None,
        "status": body.status,
        "updated_at": now_iso(),
    }
    # Navixy-linked vehicles: lock immutable fields back to existing values.
    if existing.get("navixy_device_id"):
        update["name"] = existing["name"]
        update["asset_type"] = existing["asset_type"]
        update["rego_serial"] = existing.get("rego_serial")
    if body.workspace_id and not existing.get("navixy_device_id"):
        update["workspace_id"] = body.workspace_id
    await db.assets.update_one({"id": asset_id}, {"$set": update})
    return await db.assets.find_one({"id": asset_id}, {"_id": 0})


@router.delete("/{asset_id}", status_code=204)
async def archive_asset(asset_id: str, user: dict = Depends(require_permission("assets", "delete"))):
    res = await db.assets.update_one(
        {"org_id": user["org_id"], "id": asset_id, "deleted_at": None},
        {"$set": {"status": "retired", "updated_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Asset not found")
    return Response(status_code=204)


# ────────────────────── QR + label PDFs ──────────────────────

def _make_qr_png(payload: str, box_size: int = 8) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=2,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


@router.get("/{asset_id}/qr.png")
async def asset_qr_png(asset_id: str, user: dict = Depends(require_permission("assets", "view"))):
    doc = await db.assets.find_one({"org_id": user["org_id"], "id": asset_id, "deleted_at": None})
    if not doc:
        raise HTTPException(404, "Asset not found")
    png = _make_qr_png(_public_scan_url(doc["scan_token"]))
    return Response(content=png, media_type="image/png", headers={
        "Cache-Control": "no-store",
        "Content-Disposition": f'inline; filename="qr-{doc.get("rego_serial") or doc["scan_token"]}.png"',
    })


def _draw_a6_label(c: canvas.Canvas, doc: dict, page_w: float, page_h: float):
    pad = 8 * mm
    # Phase 3.22c — slate header band with orange chevron, no more blue.
    header_band(c, 0, page_h - 14 * mm, page_w, 14 * mm,
                eyebrow='PROPERTY OF · SCAN TO IDENTIFY',
                eyebrow_align='right')

    # Name
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 16)
    name = (doc.get("name") or "Asset")[:32]
    c.drawString(pad, page_h - 22 * mm, name)
    # Rego / serial
    c.setFont("Helvetica-Bold", 22)
    rego = (doc.get("rego_serial") or "—")[:14]
    c.drawString(pad, page_h - 34 * mm, rego)
    c.setFont("Helvetica", 9)
    c.setFillColor(SLATE_MUTED)
    type_label = (doc.get("asset_type") or "—").replace("_", " ").title()
    c.drawString(pad, page_h - 40 * mm, f"Type: {type_label}   ·   Kind: {(doc.get('kind') or '').title()}")
    c.setFillColor(black)

    # QR (~ 50 x 50 mm) bottom-right
    qr_size = 50 * mm
    qr_x = page_w - qr_size - pad
    qr_y = pad
    c.drawImage(qr_image(_public_scan_url(doc["scan_token"]), box_size=10),
                qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")

    # Token text under QR — orange to anchor the eye
    c.setFillColor(ORANGE)
    c.setFont("Courier-Bold", 9)
    c.drawCentredString(qr_x + qr_size / 2, qr_y - 4 * mm, doc["scan_token"])

    # Left footer — muted scan URL
    c.setFont("Helvetica", 7)
    c.setFillColor(SLATE_MUTED)
    c.drawString(pad, pad + 4 * mm, _public_scan_url(doc["scan_token"])[:54])


def _draw_on_metal_label(c: canvas.Canvas, doc: dict, page_w: float, page_h: float):
    pad = 8 * mm
    # Big QR — top half
    qr_size = 70 * mm
    qr_x = (page_w - qr_size) / 2
    qr_y = page_h - qr_size - pad - 6 * mm
    c.drawImage(qr_image(_public_scan_url(doc["scan_token"]), box_size=12),
                qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")

    # Big rego
    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 28)
    c.drawCentredString(page_w / 2, qr_y - 14 * mm, (doc.get("rego_serial") or "—")[:14])

    # Name
    c.setFont("Helvetica", 11)
    c.setFillColor(SLATE)
    c.drawCentredString(page_w / 2, qr_y - 22 * mm, (doc.get("name") or "")[:40])

    # Brand footer — orange line (the only colour on the lower half).
    footer_brand(c, 0, pad + 2 * mm, page_w)


def _draw_combo_label(c: canvas.Canvas, doc: dict, page_w: float, page_h: float):
    pad = 8 * mm
    # Slate header band with orange chevron — replaces old cobalt strip.
    header_band(c, 0, page_h - 14 * mm, page_w, 14 * mm,
                eyebrow='QR + NFC PAIRING', eyebrow_align='right')

    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(pad, page_h - 22 * mm, (doc.get("name") or "Asset")[:32])
    c.setFont("Helvetica-Bold", 22)
    c.drawString(pad, page_h - 34 * mm, (doc.get("rego_serial") or "—")[:14])

    # QR on the left
    qr_size = 42 * mm
    qr_x = pad
    qr_y = pad + 6 * mm
    c.drawImage(qr_image(_public_scan_url(doc["scan_token"]), box_size=8),
                qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")

    # Phase 3.22c — Dotted ORANGE NFC pairing zone (was violet before).
    nfc_x = qr_x + qr_size + 8 * mm
    nfc_size = 42 * mm
    pairing_zone(c, nfc_x, qr_y, nfc_size)

    # Token under QR — orange anchor
    c.setFillColor(ORANGE)
    c.setFont("Courier-Bold", 9)
    c.drawCentredString(qr_x + qr_size / 2, qr_y - 4 * mm, doc["scan_token"])


def _draw_avery_sheet(c: canvas.Canvas, docs: list[dict]):
    """Avery L7160 — 21 labels (3 cols × 7 rows) per A4."""
    cols, rows = 3, 7
    page_w, page_h = A4
    label_w, label_h = 63.5 * mm, 38.1 * mm
    margin_x = (page_w - cols * label_w) / 2
    margin_y = (page_h - rows * label_h) / 2

    per_page = cols * rows
    for i, doc in enumerate(docs):
        if i and i % per_page == 0:
            c.showPage()
        idx = i % per_page
        col = idx % cols
        row = idx // cols
        x = margin_x + col * label_w
        y = page_h - margin_y - (row + 1) * label_h
        # Slate hairline cut guide (was the old #E5E7EB).
        cut_guide(c, x, y, label_w, label_h)
        # QR
        qr_size = 28 * mm
        c.drawImage(qr_image(_public_scan_url(doc["scan_token"]), box_size=6),
                    x + 2 * mm, y + 5 * mm, width=qr_size, height=qr_size, mask="auto")
        # Text — orange wordmark, slate body
        text_x = x + qr_size + 4 * mm
        c.setFillColor(ORANGE)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(text_x, y + label_h - 5 * mm, "PANELTEC CIVIL")
        c.setFillColor(SLATE)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(text_x, y + label_h - 11 * mm, (doc.get("name") or "")[:22])
        c.setFont("Helvetica-Bold", 12)
        c.drawString(text_x, y + label_h - 19 * mm, (doc.get("rego_serial") or "—")[:14])
        c.setFont("Helvetica", 7)
        c.setFillColor(SLATE_MUTED)
        c.drawString(text_x, y + 4 * mm, doc["scan_token"])
        c.setFillColor(black)


def _png_image_reader(png_bytes: bytes):
    """Kept for any callers still passing raw PNG bytes; the new flow
    uses `qr_image()` from `pdf_card_template` directly."""
    from reportlab.lib.utils import ImageReader
    return ImageReader(io.BytesIO(png_bytes))


@router.get("/{asset_id}/label.pdf")
async def asset_label_pdf(
    asset_id: str,
    layout: Literal["a6", "avery_l7160", "on_metal", "combo"] = Query("a6"),
    ids: Optional[str] = Query(None),
    user: dict = Depends(require_permission("assets", "view")),
):
    org_id = user["org_id"]
    docs: list[dict]
    if layout == "avery_l7160":
        id_list = [s.strip() for s in (ids or asset_id).split(",") if s.strip()]
        # If asset_id is in the list as a single id, include it too.
        if asset_id and asset_id not in id_list:
            id_list.insert(0, asset_id)
        cursor = db.assets.find(
            {"org_id": org_id, "id": {"$in": id_list}, "deleted_at": None},
            {"_id": 0},
        )
        docs = [d async for d in cursor]
        if not docs:
            raise HTTPException(404, "No assets found for label sheet")
    else:
        d = await db.assets.find_one({"org_id": org_id, "id": asset_id, "deleted_at": None}, {"_id": 0})
        if not d:
            raise HTTPException(404, "Asset not found")
        docs = [d]

    buf = io.BytesIO()
    if layout == "avery_l7160":
        c = canvas.Canvas(buf, pagesize=A4)
        _draw_avery_sheet(c, docs)
    elif layout == "on_metal":
        c = canvas.Canvas(buf, pagesize=A6)
        page_w, page_h = A6
        _draw_on_metal_label(c, docs[0], page_w, page_h)
    elif layout == "combo":
        c = canvas.Canvas(buf, pagesize=A6)
        page_w, page_h = A6
        _draw_combo_label(c, docs[0], page_w, page_h)
    else:  # a6
        c = canvas.Canvas(buf, pagesize=A6)
        page_w, page_h = A6
        _draw_a6_label(c, docs[0], page_w, page_h)
    c.showPage()
    c.save()
    pdf = buf.getvalue()

    fname = f"labels-{layout}-{docs[0].get('rego_serial') or docs[0]['scan_token']}.pdf"
    return Response(content=pdf, media_type="application/pdf", headers={
        "Cache-Control": "no-store",
        "Content-Disposition": f'inline; filename="{fname}"',
    })


# ────────────────────── NFC / UHF pairing ──────────────────────

@router.post("/{asset_id}/nfc-pair")
async def nfc_pair(asset_id: str, body: NfcPairIn, user: dict = Depends(require_permission("assets", "edit"))):
    org_id = user["org_id"]
    asset = await db.assets.find_one({"org_id": org_id, "id": asset_id, "deleted_at": None})
    if not asset:
        raise HTTPException(404, "Asset not found")
    uid = body.nfc_uid.strip().upper()
    # Workspace-scoped uniqueness per spec.
    workspace_id = asset.get("workspace_id")
    dup_q: dict = {"org_id": org_id, "nfc_uid": uid, "id": {"$ne": asset_id}, "deleted_at": None}
    if workspace_id is not None:
        dup_q["workspace_id"] = workspace_id
    dup = await db.assets.find_one(dup_q)
    if dup:
        raise HTTPException(409, f"NFC UID already paired to asset '{dup.get('name')}'")
    await db.assets.update_one({"id": asset_id}, {"$set": {"nfc_uid": uid, "updated_at": now_iso()}})
    return await db.assets.find_one({"id": asset_id}, {"_id": 0})


@router.delete("/{asset_id}/nfc-pair")
async def nfc_unpair(asset_id: str, user: dict = Depends(require_permission("assets", "edit"))):
    res = await db.assets.update_one(
        {"org_id": user["org_id"], "id": asset_id, "deleted_at": None},
        {"$set": {"nfc_uid": None, "updated_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Asset not found")
    return await db.assets.find_one({"id": asset_id}, {"_id": 0})


@router.post("/{asset_id}/uhf-pair")
async def uhf_pair(asset_id: str, body: UhfPairIn, user: dict = Depends(require_permission("assets", "edit"))):
    """Phase 5 stub — accept and store the EPC so labels can carry it later."""
    epc = body.uhf_epc.strip().upper()
    res = await db.assets.update_one(
        {"org_id": user["org_id"], "id": asset_id, "deleted_at": None},
        {"$set": {"uhf_epc": epc, "updated_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Asset not found")
    return await db.assets.find_one({"id": asset_id}, {"_id": 0})


# ────────────────────── Public scan resolver ──────────────────────

@router.get("/scan/{scan_token}")
async def resolve_scan(scan_token: str, request: Request):
    """Public — no JWT required. Returns sanitised asset payload for the
    frontend `/scan/:token` resolver page."""
    doc = await db.assets.find_one({"scan_token": scan_token, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Unknown scan token")
    if doc.get("status") == "retired":
        raise HTTPException(410, "Asset has been retired")
    return _sanitize_public(doc)
