"""
Mobile Sites — v58.13.132c (M3)

Endpoints:
  GET  /api/mobile/sites                         — list sites for user
  POST /api/mobile/sites/{id}/sign-in            — worker sign-in
  POST /api/mobile/sites/{id}/sign-out           — worker sign-out
  POST /api/mobile/sites/{id}/visitor-sign-in    — visitor 4-step
  POST /api/mobile/sites/{id}/visitor-sign-out   — visitor sign-out
  GET  /api/mobile/sites/{id}/current-occupancy  — who's on site
  POST /api/mobile/gps/heartbeat                 — periodic GPS ping
"""
import math
import time
import logging
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso

_log = logging.getLogger("paneltec.mobile.sites")

router = APIRouter(tags=["mobile-sites"])

PHOTO_MAX_BYTES = 200_000  # 200KB cap
GPS_HEARTBEAT_MIN_INTERVAL = 300  # 5 minutes
_heartbeat_last: dict[str, float] = {}  # user_id -> last timestamp


# ── Helpers ──────────────────────────────────────────────

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _effective_gps(site: dict) -> tuple[Optional[float], Optional[float]]:
    if site.get("gps_override_lat") is not None:
        return float(site["gps_override_lat"]), float(site["gps_override_long"])
    if site.get("manual_gps_lat") is not None:
        return float(site["manual_gps_lat"]), float(site["manual_gps_long"])
    if site.get("latitude") is not None:
        return float(site["latitude"]), float(site["longitude"])
    return None, None


def _check_photo_size(photo: Optional[str]) -> None:
    if photo and len(photo.encode("utf-8")) > PHOTO_MAX_BYTES:
        raise HTTPException(413, f"Photo exceeds {PHOTO_MAX_BYTES // 1000}KB limit")


def _site_to_mobile(site: dict, user_lat: Optional[float] = None,
                    user_lng: Optional[float] = None) -> dict:
    slat, slng = _effective_gps(site)
    distance_km = None
    if user_lat is not None and user_lng is not None and slat is not None and slng is not None:
        distance_km = round(_haversine_km(user_lat, user_lng, slat, slng), 1)
    return {
        "id": site.get("id") or site.get("simpro_site_id"),
        "simpro_site_id": site.get("simpro_site_id"),
        "name": site.get("name", ""),
        "address": site.get("address") or site.get("address_full") or "",
        "latitude": slat,
        "longitude": slng,
        "distance_km": distance_km,
        "company_ids": site.get("company_ids") or [],
        "ppe_requirements": site.get("ppe_requirements") or [],
        "induction_video_url": site.get("induction_video_url"),
        "emergency_contact": site.get("emergency_contact"),
        "active": site.get("active", True),
    }


# ── 1. GET /api/mobile/sites ────────────────────────────

@router.get("/mobile/sites")
async def list_sites(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    user: dict = Depends(get_current_user),
):
    org_id = user.get("org_id", "")
    company_id = str(user.get("active_company_id") or user.get("company_id") or "2")

    query = {"org_id": org_id, "deleted_at": None}
    sites_raw = []
    async for s in db.simpro_sites.find(query, {"_id": 0}):
        site_cids = s.get("company_ids") or []
        if site_cids and company_id not in [str(c) for c in site_cids]:
            continue
        sites_raw.append(s)

    sites = [_site_to_mobile(s, lat, lng) for s in sites_raw]

    if lat is not None and lng is not None:
        sites.sort(key=lambda s: s["distance_km"] if s["distance_km"] is not None else 9999)
    else:
        sites.sort(key=lambda s: s["name"].lower())

    for i, s in enumerate(sites):
        s["is_nearest"] = (i == 0 and s["distance_km"] is not None)

    active_signin = await db.site_sign_ins.find_one(
        {"user_id": user["id"], "signed_out_at": None, "kind": "worker"},
        {"_id": 0, "site_id": 1, "signed_in_at": 1},
    )
    for s in sites:
        sid = s["id"]
        if active_signin and active_signin.get("site_id") == sid:
            s["user_signed_in"] = True
            s["signed_in_at"] = active_signin.get("signed_in_at")
        else:
            s["user_signed_in"] = False
            s["signed_in_at"] = None

    return {"sites": sites, "user_active_sign_in_site_id": active_signin.get("site_id") if active_signin else None}


# ── 2. POST /api/mobile/sites/{id}/sign-in ──────────────

class WorkerSignInBody(BaseModel):
    kind: Literal["worker"] = "worker"
    gps: Optional[dict] = None
    photo_data_uri: Optional[str] = None


@router.post("/mobile/sites/{site_id}/sign-in")
async def worker_sign_in(site_id: str, body: WorkerSignInBody,
                         user: dict = Depends(get_current_user)):
    org_id = user.get("org_id", "")
    company_id = str(user.get("active_company_id") or user.get("company_id") or "2")

    site = await db.simpro_sites.find_one(
        {"$or": [{"id": site_id}, {"simpro_site_id": site_id}],
         "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Site not found")

    site_cids = site.get("company_ids") or []
    if site_cids and company_id not in [str(c) for c in site_cids]:
        raise HTTPException(403, "Site not accessible for your company")

    _check_photo_size(body.photo_data_uri)

    existing = await db.site_sign_ins.find_one(
        {"user_id": user["id"], "signed_out_at": None, "kind": "worker"},
        {"_id": 0},
    )
    if existing:
        await db.site_sign_ins.update_one(
            {"id": existing["id"]},
            {"$set": {"signed_out_at": now_iso(), "auto_signed_out": True}},
        )

    gps_lat = body.gps.get("lat") if body.gps else None
    gps_lng = body.gps.get("lng") if body.gps else None

    doc = {
        "id": new_id(),
        "org_id": org_id,
        "site_id": site.get("id") or site.get("simpro_site_id"),
        "site_name": site.get("name"),
        "user_id": user["id"],
        "user_name": user.get("name") or user.get("email"),
        "kind": "worker",
        "signed_in_at": now_iso(),
        "signed_out_at": None,
        "gps_in": {"lat": gps_lat, "lng": gps_lng} if gps_lat else None,
        "gps_out": None,
        "gps_trail": [],
        "photo_data_uri": body.photo_data_uri,
        "auto_signed_out": False,
        "created_at": now_iso(),
    }
    await db.site_sign_ins.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


# ── 3. POST /api/mobile/sites/{id}/sign-out ─────────────

class WorkerSignOutBody(BaseModel):
    gps: Optional[dict] = None


@router.post("/mobile/sites/{site_id}/sign-out")
async def worker_sign_out(site_id: str, body: WorkerSignOutBody,
                          user: dict = Depends(get_current_user)):
    active = await db.site_sign_ins.find_one(
        {"user_id": user["id"], "site_id": site_id, "signed_out_at": None, "kind": "worker"},
        {"_id": 0},
    )
    if not active:
        raise HTTPException(404, "No active sign-in at this site")

    gps_out = None
    if body.gps:
        gps_out = {"lat": body.gps.get("lat"), "lng": body.gps.get("lng")}

    await db.site_sign_ins.update_one(
        {"id": active["id"]},
        {"$set": {"signed_out_at": now_iso(), "gps_out": gps_out}},
    )
    return {"ok": True, "signed_out_at": now_iso(), "sign_in_id": active["id"]}


# ── 4. POST /api/mobile/sites/{id}/visitor-sign-in ──────

class VisitorDetails(BaseModel):
    name: str
    company: str = ""
    phone: str = ""
    purpose: str = ""
    host_user_id: str
    escort_required: bool = False


class VisitorSignInBody(BaseModel):
    visitor_details: VisitorDetails
    ppe_ack: list[str] = []
    induction_ack: bool = False
    photo_data_uri: Optional[str] = None
    gps: Optional[dict] = None


@router.post("/mobile/sites/{site_id}/visitor-sign-in")
async def visitor_sign_in(site_id: str, body: VisitorSignInBody,
                          user: dict = Depends(get_current_user)):
    org_id = user.get("org_id", "")

    site = await db.simpro_sites.find_one(
        {"$or": [{"id": site_id}, {"simpro_site_id": site_id}],
         "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Site not found")

    host_signin = await db.site_sign_ins.find_one(
        {"user_id": body.visitor_details.host_user_id,
         "site_id": site.get("id") or site.get("simpro_site_id"),
         "signed_out_at": None, "kind": "worker"},
        {"_id": 0},
    )
    if not host_signin:
        raise HTTPException(400, "Host worker is not signed in at this site")

    site_ppe = site.get("ppe_requirements") or []
    if site_ppe and not body.induction_ack:
        raise HTTPException(400, "Induction acknowledgement required")

    _check_photo_size(body.photo_data_uri)

    gps_lat = body.gps.get("lat") if body.gps else None
    gps_lng = body.gps.get("lng") if body.gps else None

    doc = {
        "id": new_id(),
        "org_id": org_id,
        "site_id": site.get("id") or site.get("simpro_site_id"),
        "site_name": site.get("name"),
        "user_id": user["id"],
        "kind": "visitor",
        "visitor_details": body.visitor_details.model_dump(),
        "ppe_ack": body.ppe_ack,
        "induction_ack": body.induction_ack,
        "signed_in_at": now_iso(),
        "signed_out_at": None,
        "gps_in": {"lat": gps_lat, "lng": gps_lng} if gps_lat else None,
        "gps_out": None,
        "photo_data_uri": body.photo_data_uri,
        "created_at": now_iso(),
    }
    await db.site_sign_ins.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


# ── 5. POST /api/mobile/sites/{id}/visitor-sign-out ─────

class VisitorSignOutBody(BaseModel):
    sign_in_id: str
    gps: Optional[dict] = None


@router.post("/mobile/sites/{site_id}/visitor-sign-out")
async def visitor_sign_out(site_id: str, body: VisitorSignOutBody,
                           user: dict = Depends(get_current_user)):
    active = await db.site_sign_ins.find_one(
        {"id": body.sign_in_id, "site_id": site_id, "signed_out_at": None, "kind": "visitor"},
        {"_id": 0},
    )
    if not active:
        raise HTTPException(404, "No active visitor sign-in found")

    gps_out = None
    if body.gps:
        gps_out = {"lat": body.gps.get("lat"), "lng": body.gps.get("lng")}

    await db.site_sign_ins.update_one(
        {"id": body.sign_in_id},
        {"$set": {"signed_out_at": now_iso(), "gps_out": gps_out}},
    )
    return {"ok": True, "signed_out_at": now_iso()}


# ── 6. GET /api/mobile/sites/{id}/current-occupancy ─────

@router.get("/mobile/sites/{site_id}/current-occupancy")
async def current_occupancy(site_id: str,
                            user: dict = Depends(get_current_user)):
    workers = []
    visitors = []
    async for si in db.site_sign_ins.find(
        {"site_id": site_id, "signed_out_at": None},
        {"_id": 0, "id": 1, "user_id": 1, "user_name": 1, "kind": 1,
         "signed_in_at": 1, "visitor_details": 1},
    ):
        entry = {
            "sign_in_id": si["id"],
            "user_id": si.get("user_id"),
            "name": si.get("user_name") or (si.get("visitor_details") or {}).get("name", ""),
            "kind": si.get("kind"),
            "signed_in_at": si.get("signed_in_at"),
        }
        if si.get("kind") == "visitor":
            entry["visitor_company"] = (si.get("visitor_details") or {}).get("company", "")
            visitors.append(entry)
        else:
            workers.append(entry)

    return {
        "site_id": site_id,
        "workers": workers,
        "visitors": visitors,
        "total_count": len(workers) + len(visitors),
    }


# ── 7. POST /api/mobile/gps/heartbeat ───────────────────

class GpsHeartbeatBody(BaseModel):
    lat: float
    lng: float
    ts: Optional[str] = None


@router.post("/mobile/gps/heartbeat")
async def gps_heartbeat(body: GpsHeartbeatBody,
                        user: dict = Depends(get_current_user)):
    uid = user["id"]
    now = time.time()
    last = _heartbeat_last.get(uid, 0)
    if now - last < GPS_HEARTBEAT_MIN_INTERVAL:
        remaining = int(GPS_HEARTBEAT_MIN_INTERVAL - (now - last))
        raise HTTPException(429, f"Rate limited. Try again in {remaining}s")

    _heartbeat_last[uid] = now

    active = await db.site_sign_ins.find_one(
        {"user_id": uid, "signed_out_at": None},
        {"_id": 0, "id": 1},
    )
    if not active:
        return {"ok": True, "stored": False, "reason": "no_active_signin"}

    await db.site_sign_ins.update_one(
        {"id": active["id"]},
        {"$push": {"gps_trail": {"lat": body.lat, "lng": body.lng,
                                  "ts": body.ts or now_iso()}}},
    )
    return {"ok": True, "stored": True}
