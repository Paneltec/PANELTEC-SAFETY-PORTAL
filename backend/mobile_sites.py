"""v58.13.107 — Backend prep for the Mobile "Create Site with GPS" feature.

The Expo mobile app (Phase 4.14 handoff) needs to:
  · Let a supervisor stand on the physical site, tap "Create Site",
    capture the phone's GPS fix, hand the payload to the backend which
    dedupes against any existing site within 50 m (haversine), and
    return a `visitor_token` + `visitor_url` the app can render as a
    QR the crew can scan for the v58.13.106 public visitor sign-in
    form.
  · List "my active sites" so a supervisor can pick one to close out
    at end-of-day.
  · Close a site (soft flag, `closed_at` timestamp) so it stops
    appearing in the active list. Existing visitor sign-ins remain
    intact and the scan_token continues to resolve — closure is a
    field-management signal, not a data purge.

Endpoints (all `/api` prefixed via server include):
  · POST   /api/mobile/sites                → create-or-dedupe
  · GET    /api/mobile/sites/mine?active=…  → list this-user's sites
  · PATCH  /api/mobile/sites/{id}/close     → flag as closed

Compliance rails (per today's brief):
  · All three endpoints route through the existing auth dependency
    (`get_current_user`). No public / unauth path.
  · List + close are wrapped in `@safe_admin_endpoint` so a Cloudflare
    520 can never escape an admin surface (the wrapper turns any
    unhandled exception into a JSON 500 with an `error_ref`).
  · The create endpoint is EXPLICITLY not wrapped — pydantic 422s and
    the 200-with-`created=False` dedupe response are part of the public
    API contract the mobile app relies on.
  · NO email / SMS side-effects. NO scheduler hooks. NO comms outbox
    writes. Anything that would need Comms Safe Mode was deliberately
    left out — this ship is data-plane only.
  · Reuses `simpro_sites` collection so the site becomes visible to
    every existing web surface that queries that collection (SitesAdmin,
    SiteScanResolver, visitor sign-in resolver, etc.). Rows carry a
    `source: "mobile_create"` marker so admin dashboards can filter
    them out of Simpro-source-of-truth queries if needed.
"""
from __future__ import annotations

import logging
import math
import os
import secrets
import string
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from admin_safe_wrapper import safe_admin_endpoint
from auth import get_current_user
from db import db


logger = logging.getLogger("mobile_sites")
router = APIRouter(prefix="/mobile/sites", tags=["mobile-sites"])


# ── Constants ─────────────────────────────────────────────────────

_ALPHABET = string.ascii_letters + string.digits
DEDUPE_RADIUS_M = 50.0  # haversine radius for "same site" collapse
_EARTH_RADIUS_M = 6_371_000.0


# ── Models ────────────────────────────────────────────────────────

class MobileSiteCreate(BaseModel):
    """Payload the Expo Create-Site screen posts.

    `name` and `gps_lat` + `gps_lng` are the only required fields.
    Everything else is nice-to-have metadata the supervisor may skip in
    the field.
    """
    name: str = Field(..., min_length=1, max_length=120)
    gps_lat: float = Field(..., ge=-90.0, le=90.0)
    gps_lng: float = Field(..., ge=-180.0, le=180.0)
    gps_accuracy_m: Optional[float] = Field(None, ge=0.0, le=100_000.0)
    address: Optional[str] = Field(None, max_length=240)
    suburb: Optional[str] = Field(None, max_length=80)
    state: Optional[str] = Field(None, max_length=40)


# ── Helpers ───────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex[:24]


def _gen_scan_token(n: int = 12) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres between two lat/lng points.

    Standard haversine, no external deps. Accurate enough for a 50 m
    dedupe check; we don't need ellipsoid precision here.
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = (math.sin(dphi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_M * c


def _resolve_public_base() -> str:
    """Same precedence chain as `qr_common.resolve_public_base()` used
    for QR-encoded URLs. Duplicated inline to sidestep a circular
    import at module-load time (qr_common → assets → …)."""
    for name in ("REACT_APP_BACKEND_URL", "PUBLIC_APP_URL", "FRONTEND_PUBLIC_URL"):
        v = (os.environ.get(name) or "").strip().rstrip("/")
        if v:
            return v
    return ""


def _visitor_url(token: str) -> str:
    """Absolute URL the mobile app should encode into the visitor QR."""
    base = _resolve_public_base()
    path = f"/scan/site/{token}/visitor"
    return f"{base}{path}" if base else path


def _serialise(site: dict, *, visitor_url: Optional[str] = None) -> dict:
    """Shape the mobile app expects. Never returns Mongo `_id`."""
    token = site.get("scan_token")
    return {
        "id": site.get("id") or site.get("simpro_site_id"),
        "simpro_site_id": site.get("simpro_site_id"),
        "name": site.get("name"),
        "address": site.get("address") or site.get("address_full"),
        "suburb": site.get("suburb"),
        "state": site.get("state"),
        "latitude": site.get("latitude"),
        "longitude": site.get("longitude"),
        "scan_token": token,
        "visitor_url": visitor_url if visitor_url is not None else (
            _visitor_url(token) if token else None
        ),
        "created_at": site.get("created_at"),
        "created_by": site.get("created_by"),
        "closed_at": site.get("closed_at"),
        "source": site.get("source"),
    }


async def _find_nearby_active(org_id: str, lat: float, lng: float, radius_m: float) -> Optional[dict]:
    """Scan active sites in this org and return the closest hit within
    the given radius. Small cursor — orgs top out at a few hundred sites.
    """
    cursor = db.simpro_sites.find(
        {"org_id": org_id,
         "$and": [
             {"$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
             {"$or": [{"closed_at": None}, {"closed_at": {"$exists": False}}]},
         ],
         "latitude": {"$ne": None},
         "longitude": {"$ne": None}},
        {"_id": 0},
    )
    best: Optional[dict] = None
    best_d = radius_m
    async for s in cursor:
        try:
            slat = float(s.get("latitude"))
            slng = float(s.get("longitude"))
        except (TypeError, ValueError):
            continue
        d = _haversine_m(lat, lng, slat, slng)
        if d < best_d:
            best_d = d
            best = s
    return best


# ── Endpoints ─────────────────────────────────────────────────────

@router.post("")
async def mobile_create_site(
    body: MobileSiteCreate,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Create a site from the mobile app or, if a site already exists
    within `DEDUPE_RADIUS_M` metres, return that one instead (idempotent
    for repeat taps of "Create Site").

    Response shape (both branches):
      {
        "created": bool,             # True on first create, False on dedupe hit
        "site":   { ...serialised site with visitor_url... },
      }

    Never sends comms. Never touches the outbox. Never schedules a job.
    """
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(400, "User has no org_id")

    # 1. Dedupe check first — cheap read, avoids hot-tap dup rows.
    hit = await _find_nearby_active(org_id, body.gps_lat, body.gps_lng, DEDUPE_RADIUS_M)
    if hit is not None:
        # Ensure the hit carries a scan_token so the response gives the
        # mobile app a usable QR immediately. Existing rows without one
        # (from pre-Phase-4.2) get lazily provisioned here.
        if not hit.get("scan_token"):
            token = _gen_scan_token(12)
            key = {"org_id": org_id}
            if hit.get("simpro_site_id"):
                key["simpro_site_id"] = hit["simpro_site_id"]
            elif hit.get("id"):
                key["id"] = hit["id"]
            await db.simpro_sites.update_one(key, {"$set": {"scan_token": token,
                                                              "scan_token_at": _now_iso()}})
            hit["scan_token"] = token
        logger.info(
            "mobile_sites.dedupe org=%s user=%s hit=%s dist_m<=%.1f",
            org_id, user.get("id"), hit.get("id") or hit.get("simpro_site_id"),
            DEDUPE_RADIUS_M,
        )
        return {"created": False, "site": _serialise(hit)}

    # 2. No hit — create fresh row.
    now = _now_iso()
    site_id = _new_id()
    scan_token = _gen_scan_token(12)
    doc = {
        "id": site_id,
        # `simpro_site_id` is the field older Simpro-sourced rows key on;
        # keep it populated with our own id so downstream queries that
        # filter on simpro_site_id (see sites_qr.py) still find us.
        "simpro_site_id": f"MOBILE-{site_id[:12]}",
        "org_id": org_id,
        "name": body.name.strip(),
        "address": (body.address or "").strip() or None,
        "address_full": (body.address or "").strip() or None,
        "suburb": (body.suburb or "").strip() or None,
        "state": (body.state or "").strip() or None,
        "latitude": body.gps_lat,
        "longitude": body.gps_lng,
        "gps_accuracy_m": body.gps_accuracy_m,
        "scan_token": scan_token,
        "scan_token_at": now,
        "source": "mobile_create",
        "created_at": now,
        "created_by": user.get("id"),
        "created_by_email": user.get("email"),
        "closed_at": None,
        "deleted_at": None,
        "updated_at": now,
    }
    await db.simpro_sites.insert_one(dict(doc))
    logger.info(
        "mobile_sites.create org=%s user=%s id=%s token=%s",
        org_id, user.get("id"), site_id, scan_token,
    )
    return {"created": True, "site": _serialise(doc)}


@router.get("/mine")
@safe_admin_endpoint
async def mobile_list_my_sites(
    request: Request,
    active: bool = True,
    user: dict = Depends(get_current_user),
):
    """Return every site this user created via the mobile app.

    `active=true` (default) filters out sites the user has already
    closed. `active=false` returns everything they've ever created,
    open or closed, for the full-history view.
    """
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(400, "User has no org_id")
    q: dict = {"org_id": org_id, "created_by": user.get("id")}
    q["$or"] = [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]
    if active:
        q["$and"] = [
            {"$or": [{"closed_at": None}, {"closed_at": {"$exists": False}}]},
        ]
    cursor = db.simpro_sites.find(q, {"_id": 0}).sort("created_at", -1).limit(500)
    rows = [_serialise(s) async for s in cursor]
    return {"sites": rows, "count": len(rows)}


@router.patch("/{site_id}/close")
@safe_admin_endpoint
async def mobile_close_site(
    site_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Flag a mobile-created site as closed (`closed_at` timestamp).

    Idempotent — a second close-call returns the same row with the
    existing `closed_at`. Only the creator (or an admin) can close a
    site; anyone else gets 403.
    """
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(400, "User has no org_id")
    site = await db.simpro_sites.find_one(
        {"$or": [{"id": site_id}, {"simpro_site_id": site_id}],
         "org_id": org_id},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Site not found")
    if site.get("created_by") and site["created_by"] != user.get("id") and user.get("role") != "admin":
        raise HTTPException(403, "Only the creator or an admin can close this site")
    if site.get("closed_at"):
        return {"site": _serialise(site), "already": True}
    now = _now_iso()
    await db.simpro_sites.update_one(
        {"id": site.get("id") or site_id, "org_id": org_id},
        {"$set": {"closed_at": now, "closed_by": user.get("id"), "updated_at": now}},
    )
    site["closed_at"] = now
    site["closed_by"] = user.get("id")
    site["updated_at"] = now
    logger.info(
        "mobile_sites.close org=%s user=%s id=%s",
        org_id, user.get("id"), site.get("id") or site_id,
    )
    return {"site": _serialise(site), "already": False}
