"""Phase 4.2 — Site Induction QR.

Adds a `scan_token` to `simpro_sites` rows + four endpoints:

  • GET    /api/scan/site/{scan_token}                 PUBLIC — resolver
  • POST   /api/scan/site/{scan_token}/sign-on         AUTH   — record signon
  • GET    /api/sites/{site_id}/active-signons         ADMIN  — who's on site
  • GET    /api/sites/{site_id}/scan-pdf?layout=...    ADMIN  — printable QR

Storage:
  * `simpro_sites.scan_token` (uuid4 hex, unique, lazy-generated on first
    /sites/{id}/scan-pdf or /active-signons request).
  * New `site_signons` collection — { id, org_id, site_id, worker_id, signed_at,
    source, swms_acknowledged: [...], certifications_ack: [...] }.

Permissions:
  * Public resolver: no auth; tampered/missing token → 404 (no info leak).
  * Sign-on POST: any authed user (worker self-signon).
  * Active signons + Scan PDF: admin / manager / hseq_lead.

Out of scope (per brief): geofencing, auto-revoke, sync back to Simpro.
"""
from __future__ import annotations
import io
import secrets
import string
from datetime import datetime, timezone, timedelta
from typing import Any

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from auth import get_current_user
from db import db
from models import new_id, now_iso
from workers_qr import _public_app_url
# Phase 3.22c — site QR cards on the shared 2-colour template.
from pdf_card_template import (header_band, qr_image, ORANGE, SLATE,
                                SLATE_INK, SLATE_MUTED, WHITE)

_ALPHABET = string.ascii_letters + string.digits

scan_router = APIRouter(prefix="/scan/site", tags=["site-scan"])
sites_router = APIRouter(prefix="/sites", tags=["sites"])

EDIT_ROLES = {"admin", "manager", "hseq_lead"}
ELEVATED_ROLES = {"admin", "manager", "hseq_lead", "supervisor"}


def _gen_token(n: int = 12) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


async def _ensure_scan_token(site: dict) -> str:
    """Lazily provision a scan_token for a site if missing. Idempotent."""
    if site.get("scan_token"):
        return site["scan_token"]
    token = _gen_token(12)
    # Use Simpro id as the unique key since `id` may not exist on legacy rows.
    key = {"simpro_site_id": site["simpro_site_id"], "org_id": site["org_id"]}
    await db.simpro_sites.update_one(key, {"$set": {"scan_token": token,
                                                     "scan_token_at": now_iso()}})
    return token


def _site_scan_url(token: str) -> str:
    base = _public_app_url() or ""
    return f"{base}/scan/site/{token}"


def _make_qr_png(data: str, box: int = 8) -> bytes:
    q = qrcode.QRCode(box_size=box, border=2)
    q.add_data(data); q.make(fit=True)
    img = q.make_image()
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return buf.getvalue()


# ────────────────── PUBLIC resolver ──────────────────

@scan_router.get("/{scan_token}")
async def resolve_site_scan(scan_token: str):
    """Anyone holding the URL can see the site basics. We deliberately do NOT
    leak the org_id back to the caller — only the human-readable bits + a
    list of active SWMS that should be acknowledged at sign-on.

    Phase 4.12 (v127): also returns `signon_questions` so the public visitor
    flow can render dynamic questions. Soft-deleted sites are treated like a
    bad token to avoid info leak."""
    site = await db.simpro_sites.find_one(
        {"scan_token": scan_token,
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Scan token not recognised")

    # Pull active SWMS for the same org (superseded hidden by default).
    swms_rows = []
    async for s in db.swms.find(
        {"org_id": site["org_id"], "deleted_at": None,
         "status": {"$ne": "superseded"}},
        {"_id": 0, "id": 1, "title": 1, "code": 1, "version": 1, "applies_to": 1},
    ).limit(50):
        swms_rows.append({
            "id": s["id"], "title": s.get("title"),
            "code": s.get("code"), "version": s.get("version"),
        })

    # v127 — strip server-only flags off questions before exposing.
    public_questions = []
    for q in (site.get("signon_questions") or []):
        public_questions.append({
            "id": q.get("id"),
            "type": q.get("type"),
            "label": q.get("label"),
            "required": bool(q.get("required")),
            "choices": q.get("choices") if q.get("type") == "choice" else None,
        })

    return {
        "scan_token": scan_token,
        "site": {
            "simpro_site_id": site.get("simpro_site_id"),
            "name": site.get("name"),
            "address": site.get("address_full") or site.get("address"),
            "suburb": site.get("suburb"),
            "state": site.get("state"),
            "lat": site.get("latitude"), "lng": site.get("longitude"),
            "kind": site.get("kind") or "simpro",
        },
        "active_swms": swms_rows,
        "signon_questions": public_questions,
        "signon_url": f"/api/scan/site/{scan_token}/sign-on",
        "visitor_signon_url": f"/api/scan/site/{scan_token}/sign-on-visitor",
    }


class SignOnAnswerIn(BaseModel):
    question_id: str
    value: Any | None = None     # bool | str — type matches question type


class SignOnIn(BaseModel):
    worker_id: str | None = None
    swms_acknowledged: list[str] = []
    certifications_ack: list[str] = []
    # v127 extras
    gps_lat: float | None = None
    gps_long: float | None = None
    gps_accuracy_m: float | None = None
    answers: list[SignOnAnswerIn] = []


def _effective_site_gps(site: dict) -> tuple[float | None, float | None]:
    """v127 — admin gps_override wins, else manual_*, else simpro lat/long."""
    if site.get("gps_override_lat") is not None and site.get("gps_override_long") is not None:
        return float(site["gps_override_lat"]), float(site["gps_override_long"])
    if site.get("kind") == "manual":
        if site.get("manual_gps_lat") is not None and site.get("manual_gps_long") is not None:
            return float(site["manual_gps_lat"]), float(site["manual_gps_long"])
    if site.get("latitude") is not None and site.get("longitude") is not None:
        return float(site["latitude"]), float(site["longitude"])
    return None, None


def _haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    import math
    r = 6_371_000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _gps_warning(site: dict, lat: float | None, lng: float | None) -> tuple[bool, float | None, bool]:
    """Returns (warning, distance_m, gps_unavailable). Warn-only at >250m."""
    if lat is None or lng is None:
        return False, None, True
    s_lat, s_lng = _effective_site_gps(site)
    if s_lat is None or s_lng is None:
        return False, None, False
    d = round(_haversine_m(s_lat, s_lng, lat, lng), 1)
    return d > 250.0, d, False


@scan_router.post("/{scan_token}/sign-on")
async def sign_on_to_site(scan_token: str, body: SignOnIn,
                           user: dict = Depends(get_current_user)):
    site = await db.simpro_sites.find_one(
        {"scan_token": scan_token,
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Scan token not recognised")
    if site.get("org_id") != user["org_id"]:
        # Cross-org scan attempts get the same 404 as a tampered token.
        raise HTTPException(404, "Scan token not recognised")

    worker_id = body.worker_id or user.get("worker_id") or user["id"]
    warn, dist, unavail = _gps_warning(site, body.gps_lat, body.gps_long)
    doc = {
        "id": new_id(),
        "org_id": site["org_id"],
        "site_id": site["simpro_site_id"],
        "site_name": site.get("name"),
        "worker_id": worker_id,
        "signed_by_user_id": user["id"],
        "name": user.get("display_name") or user.get("email"),
        "signed_at": now_iso(),
        "signoff_at": None,
        "source": "qr",
        "swms_acknowledged": body.swms_acknowledged or [],
        "certifications_ack": body.certifications_ack or [],
        # v127
        "gps_lat": body.gps_lat,
        "gps_long": body.gps_long,
        "gps_accuracy_m": body.gps_accuracy_m,
        "gps_distance_m": dist,
        "gps_warning": warn,
        "gps_unavailable": unavail,
        "answers": [a.model_dump() for a in body.answers],
    }
    await db.site_signons.insert_one(dict(doc))
    # 24h quick-access pass — no auto-revoke beyond that, manual sign-off only.
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    doc.pop("_id", None)
    return {**doc, "pass_expires_at": expires_at}


class VisitorSignOnIn(BaseModel):
    name: str
    company: str | None = None
    phone: str | None = None
    gps_lat: float | None = None
    gps_long: float | None = None
    gps_accuracy_m: float | None = None
    swms_acknowledged: list[str] = []
    answers: list[SignOnAnswerIn] = []


@scan_router.post("/{scan_token}/sign-on-visitor")
async def sign_on_visitor(scan_token: str, body: VisitorSignOnIn):
    """v127 — Public, no-auth visitor sign-on. Inserts a sign-on row with
    `source=visitor` and `signed_by_user_id=None`. Used when a contractor
    or visitor scans the gate sign without a Paneltec account."""
    if not body.name.strip():
        raise HTTPException(400, "name is required")
    site = await db.simpro_sites.find_one(
        {"scan_token": scan_token,
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Scan token not recognised")
    warn, dist, unavail = _gps_warning(site, body.gps_lat, body.gps_long)
    doc = {
        "id": new_id(),
        "org_id": site["org_id"],
        "site_id": site["simpro_site_id"],
        "site_name": site.get("name"),
        "worker_id": None,
        "signed_by_user_id": None,
        "name": body.name.strip(),
        "company": body.company,
        "phone": body.phone,
        "signed_at": now_iso(),
        "signoff_at": None,
        "source": "visitor",
        "swms_acknowledged": body.swms_acknowledged or [],
        "certifications_ack": [],
        "gps_lat": body.gps_lat,
        "gps_long": body.gps_long,
        "gps_accuracy_m": body.gps_accuracy_m,
        "gps_distance_m": dist,
        "gps_warning": warn,
        "gps_unavailable": unavail,
        "answers": [a.model_dump() for a in body.answers],
    }
    await db.site_signons.insert_one(dict(doc))
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    doc.pop("_id", None)
    return {**doc, "pass_expires_at": expires_at}


# ────────────────── ADMIN — active sign-ons ──────────────────

def _require_site_admin(user: dict) -> None:
    if user.get("role") not in EDIT_ROLES:
        raise HTTPException(403, "Permission denied: sites.view")


@sites_router.get("")
async def list_sites(user: dict = Depends(get_current_user)):
    """List every Simpro-synced + manual site in the user's org. Soft-deleted
    rows are hidden (see /sites/recycle-bin for the bin). Phase 4.12 (v127)
    adds `kind`, `signon_questions`, `gps_override_*`, `manual_*` fields and
    a live `active_signons_count` per row (last 24h)."""
    rows: list[dict] = []
    proj = {
        "_id": 0, "simpro_site_id": 1, "name": 1, "address_full": 1, "address": 1,
        "suburb": 1, "state": 1, "scan_token": 1, "latitude": 1, "longitude": 1,
        # v127 additions
        "kind": 1, "manual_address": 1, "manual_gps_lat": 1, "manual_gps_long": 1,
        "gps_override_lat": 1, "gps_override_long": 1, "signon_questions": 1,
        "deleted_at": 1, "simpro_active_jobs": 1,
    }
    async for s in db.simpro_sites.find(
        {"org_id": user["org_id"], "$or": [
            {"deleted_at": None}, {"deleted_at": {"$exists": False}},
        ]},
        proj,
    ).sort("name", 1):
        rows.append(s)
    # Hydrate active sign-on counts (last 24h) in a single aggregation.
    if rows:
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        counts: dict[str, int] = {}
        async for grp in db.site_signons.aggregate([
            {"$match": {"org_id": user["org_id"], "signed_at": {"$gte": since},
                        "signoff_at": None}},
            {"$group": {"_id": "$site_id", "n": {"$sum": 1}}},
        ]):
            counts[grp["_id"]] = grp["n"]
        for r in rows:
            r["active_signons_count"] = counts.get(r["simpro_site_id"], 0)
            r["kind"] = r.get("kind") or "simpro"
            r["signon_questions"] = r.get("signon_questions") or []
    return rows


@sites_router.delete("/{site_id}/active-signons/{signon_id}")
async def manual_sign_off(site_id: str, signon_id: str,
                           user: dict = Depends(get_current_user)):
    """Admin manual sign-off — physically deletes the sign-on row so the
    panel refreshes empty. We don't preserve history yet (parked: 30-day
    session-history audit log)."""
    _require_site_admin(user)
    res = await db.site_signons.delete_one(
        {"id": signon_id, "org_id": user["org_id"], "site_id": site_id},
    )
    if res.deleted_count == 0:
        raise HTTPException(404, "Sign-on not found")
    return {"ok": True, "signon_id": signon_id}


@sites_router.get("/{site_id}/active-signons")
async def list_active_signons(site_id: str,
                              since: str | None = Query(None),
                              user: dict = Depends(get_current_user)):
    _require_site_admin(user)
    # Default to the last 24h — matches the quick-access pass expiry above.
    if not since:
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    rows: list[dict] = []
    async for s in db.site_signons.find(
        {"org_id": user["org_id"], "site_id": site_id,
         "signed_at": {"$gte": since}},
        {"_id": 0},
    ).sort("signed_at", -1).limit(500):
        rows.append(s)

    # Hydrate worker names in one batch (avoid N queries).
    worker_ids = list({r["worker_id"] for r in rows if r.get("worker_id")})
    name_by_id: dict[str, str] = {}
    if worker_ids:
        async for w in db.workers.find(
            {"id": {"$in": worker_ids}, "org_id": user["org_id"]},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1},
        ):
            name_by_id[w["id"]] = f"{w.get('first_name','')} {w.get('last_name','')}".strip() or w["id"]

    return {
        "site_id": site_id,
        "since": since,
        "count": len(rows),
        "signons": [{**r, "worker_name": name_by_id.get(r.get("worker_id"), "")} for r in rows],
    }


# ────────────────── ADMIN — Scan PDF ──────────────────

@sites_router.get("/{site_id}/scan-pdf")
async def site_scan_pdf(site_id: str,
                        layout: str = Query("gate_sign", regex="^(gate_sign|avery)$"),
                        user: dict = Depends(get_current_user)):
    _require_site_admin(user)
    site = await db.simpro_sites.find_one(
        {"simpro_site_id": site_id, "org_id": user["org_id"]}, {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Site not found")
    token = await _ensure_scan_token(site)
    qr_png = _make_qr_png(_site_scan_url(token), box=14 if layout == "gate_sign" else 6)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4

    if layout == "gate_sign":
        # A4 portrait gate sign — slate header band + orange chevron,
        # big QR centred. Designed to laminate + zip-tie to a fence.
        header_band(c, 0, page_h - 35 * mm, page_w, 35 * mm,
                    eyebrow='SCAN THE QR · PANELTEC CIVIL WHS',
                    eyebrow_align='right')

        # Site name
        c.setFillColor(SLATE_INK)
        c.setFont("Helvetica-Bold", 26)
        c.drawCentredString(page_w / 2, page_h - 55 * mm, (site.get("name") or "Site")[:60])
        c.setFont("Helvetica", 12)
        c.setFillColor(SLATE_MUTED)
        addr = site.get("address_full") or site.get("address") or ""
        c.drawCentredString(page_w / 2, page_h - 65 * mm, addr[:80])

        # QR block (centred, ~120mm square)
        qr_size_mm = 120
        c.drawImage(qr_image(_site_scan_url(token), box_size=14),
                    (page_w - qr_size_mm * mm) / 2, page_h - (90 + qr_size_mm) * mm,
                    qr_size_mm * mm, qr_size_mm * mm)

        c.setFillColor(SLATE_INK)
        c.setFont("Helvetica", 10)
        c.drawCentredString(page_w / 2, 30 * mm,
            "Scan with your phone camera, then sign on. All workers and visitors must sign on.")
        c.setFillColor(ORANGE)
        c.setFont("Courier-Bold", 8)
        c.drawCentredString(page_w / 2, 18 * mm, f"Token: {token} — generated {now_iso()[:10]}")
    else:
        # Avery 30-up label sheet (3 cols × 10 rows). Each label gets one QR
        # plus tiny site name. Use Avery 5160 dimensions (66.7 × 25.4 mm).
        cols, rows = 3, 10
        label_w, label_h = 66.7 * mm, 25.4 * mm
        margin_x = (page_w - cols * label_w) / 2
        margin_y = (page_h - rows * label_h) / 2
        for r in range(rows):
            for col in range(cols):
                x = margin_x + col * label_w
                y = page_h - margin_y - (r + 1) * label_h
                c.drawImage(qr_image(_site_scan_url(token), box_size=6),
                            x + 2 * mm, y + 2 * mm,
                            21 * mm, 21 * mm)
                c.setFillColor(SLATE_INK)
                c.setFont("Helvetica-Bold", 7)
                c.drawString(x + 26 * mm, y + 18 * mm, (site.get("name") or "Site")[:25])
                c.setFillColor(SLATE_MUTED)
                c.setFont("Helvetica", 6)
                c.drawString(x + 26 * mm, y + 12 * mm, "Scan to sign-on")
                c.setFillColor(ORANGE)
                c.setFont("Helvetica-Bold", 6)
                c.drawString(x + 26 * mm, y + 8 * mm, "PANELTEC CIVIL WHS")

    c.showPage(); c.save()
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="site-{site_id}-qr.pdf"'})


# ────────────────── DEV helper — seed a site for testing ──────────────────

@sites_router.post("/dev/seed-one")
async def dev_seed_site(user: dict = Depends(get_current_user)):
    """Idempotent dev seed: create exactly ONE Sample site if none exist in
    this org. Returns the site id+token. Admin only — would be removed in a
    production fork once real Simpro sync delivers sites."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    existing = await db.simpro_sites.find_one(
        {"org_id": user["org_id"]}, {"_id": 0})
    if existing:
        token = await _ensure_scan_token(existing)
        return {"created": False, "simpro_site_id": existing["simpro_site_id"], "scan_token": token}
    site = {
        "simpro_site_id": "DEV-SITE-001",
        "org_id": user["org_id"],
        "name": "Erskineville Turnout — Sample Site",
        "address_full": "12 Rail Reserve Rd, Erskineville NSW 2043",
        "suburb": "Erskineville",
        "state": "NSW",
        "latitude": -33.9018, "longitude": 151.1856,
        "scan_token": _gen_token(12),
        "created_at": now_iso(),
    }
    await db.simpro_sites.insert_one(dict(site))
    return {"created": True, "simpro_site_id": site["simpro_site_id"],
            "scan_token": site["scan_token"]}
