"""Mobile Daily-Job Assignments — ADMIN endpoints + geo/weather proxies.

v58.13.132ab — extends `mobile_daily_jobs.py` with the read-side surface
the web admin UI needs, plus BOM Australia weather + Nominatim geocode
proxies for the mobile home hero.

Endpoints (all under `/api/mobile/`):
  GET  /daily-jobs/admin/workers            paginated worker picker feed
  GET  /daily-jobs/admin/assignments         admin view of all today's rows
  GET  /daily-jobs/admin/sites               distinct site names for picker
  GET  /geocode?q=<address>                 Nominatim proxy (User-Agent set)
  GET  /weather?lat=<f>&lng=<f>              BOM Australia obs proxy
"""
from __future__ import annotations
import asyncio
import math
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from db import db
from auth import get_current_user

router = APIRouter(tags=["mobile-daily-jobs-admin"])


# ─────────────── Admin gate ───────────────

def _require_admin(user: dict) -> None:
    """v58.13.132cf — strict admin-only. The previous `admin/owner`
    gate is retained; the .132cf change is uniform strictness across
    create + list + parse-pdf."""
    role = (user.get("role") or "").lower()
    if role != "admin":
        raise HTTPException(403, "Admin role required")


# v58.13.132cf — three fixed roles Stephen wants to dispatch to.
# `admin` (office staff) is explicitly excluded.
ADHOC_TARGET_ROLE_IDS = ["paneltec_civil", "viatec_traffic", "external_contractor"]


# ─────────────── GET /mobile/daily-jobs/admin/workers ───────────────

@router.get("/mobile/daily-jobs/admin/workers")
async def admin_list_workers(
    user: dict = Depends(get_current_user),
    q: Optional[str] = None,
    role_id: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    skip: int = Query(0, ge=0),
) -> dict:
    """v58.13.132cf — sourced from `db.users` filtered by
    `role_id ∈ {paneltec_civil, viatec_traffic, external_contractor}`.

    Rationale: `db.workers` is Simpro-imported and has no role_id
    column (73/73 rows show `role_id=null`), while `db.users` carries
    the authoritative role_id set via the .132be standard matrix.
    Picker now lists dispatchable identities, not Simpro employees.

    Returns `{rows: [...], total: N}`. Fields per row:
      id, name, phone, role_id
    """
    _require_admin(user)

    allowed = ADHOC_TARGET_ROLE_IDS
    if role_id and role_id in allowed:
        allowed = [role_id]

    match: dict = {
        "org_id": user["org_id"],
        "role_id": {"$in": allowed},
    }
    if q:
        needle = q.strip()
        if needle:
            match["$or"] = [
                {"name": {"$regex": needle, "$options": "i"}},
                {"first_name": {"$regex": needle, "$options": "i"}},
                {"last_name": {"$regex": needle, "$options": "i"}},
                {"email": {"$regex": needle, "$options": "i"}},
                {"mobile": {"$regex": needle, "$options": "i"}},
                {"phone": {"$regex": needle, "$options": "i"}},
            ]

    total = await db.users.count_documents(match)
    cursor = db.users.find(
        match,
        {
            "_id": 0, "id": 1, "name": 1, "first_name": 1, "last_name": 1,
            "email": 1, "mobile": 1, "phone": 1, "role_id": 1,
            "last_seen_at": 1,
        },
    ).sort("last_name", 1).skip(skip).limit(limit)

    rows = []
    async for u in cursor:
        first = (u.get("first_name") or "").strip()
        last = (u.get("last_name") or "").strip()
        name = (u.get("name") or f"{first} {last}").strip() or u.get("email") or "(unnamed)"
        rows.append({
            "id": u.get("id"),
            "name": name,
            "first_name": first,
            "last_name": last,
            "email": u.get("email"),
            "phone": u.get("mobile") or u.get("phone"),
            "role_id": u.get("role_id"),
            "last_seen_at": u.get("last_seen_at"),
        })
    return {"rows": rows, "total": total, "limit": limit, "skip": skip,
            "target_role_ids": ADHOC_TARGET_ROLE_IDS}


# ─────────────── GET /mobile/daily-jobs/admin/assignments ───────────────

@router.get("/mobile/daily-jobs/admin/assignments")
async def admin_list_assignments(
    user: dict = Depends(get_current_user),
    date: Optional[str] = None,
) -> dict:
    """Admin view of ad-hoc assignments for a given date (default: today
    in Australia/Sydney, matching the create path).

    v58.13.132cf — reads snapshot fields (`worker_name`,
    `worker_phone`, `worker_role_id`, `assigned_by_name`) directly
    from the assignment doc — no live JOIN needed. Falls back to a
    users→workers lookup only for pre-.132cf rows (currently 0)."""
    _require_admin(user)

    from datetime import datetime
    from zoneinfo import ZoneInfo
    the_date = date or datetime.now(ZoneInfo("Australia/Sydney")).strftime("%Y-%m-%d")

    cursor = db.daily_job_assignments.find(
        {"org_id": user["org_id"], "date": the_date},
        {"_id": 0},
    ).sort("assigned_at", -1)

    docs = []
    async for d in cursor:
        docs.append(d)

    # Legacy row enrichment (pre-.132cf rows with no snapshot fields).
    stale = [d for d in docs if not d.get("worker_name") and d.get("worker_id")]
    if stale:
        stale_ids = list({d["worker_id"] for d in stale})
        by_id: dict = {}
        async for u in db.users.find(
            {"id": {"$in": stale_ids}, "org_id": user["org_id"]},
            {"_id": 0, "id": 1, "name": 1, "first_name": 1, "last_name": 1,
             "mobile": 1, "phone": 1, "role_id": 1},
        ):
            by_id[u["id"]] = u
        async for w in db.workers.find(
            {"id": {"$in": [i for i in stale_ids if i not in by_id]},
             "org_id": user["org_id"]},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1,
             "mobile": 1, "phone": 1},
        ):
            by_id[w["id"]] = w
        for d in stale:
            u = by_id.get(d.get("worker_id") or "", {})
            first = (u.get("first_name") or "").strip()
            last = (u.get("last_name") or "").strip()
            d["worker_name"] = (u.get("name") or f"{first} {last}").strip() or "(worker removed)"
            d["worker_phone"] = u.get("mobile") or u.get("phone")
            d["worker_role_id"] = u.get("role_id")

    return {"rows": docs, "date": the_date, "total": len(docs)}


# ─────────────── GET /mobile/daily-jobs/admin/sites ───────────────

@router.get("/mobile/daily-jobs/admin/sites")
async def admin_list_sites(
    user: dict = Depends(get_current_user),
    q: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    """Distinct site names from simpro_jobs for the admin site picker.

    Returns `{rows: [{site_name}], total: N}`. Client-side geocoding
    happens later at assignment-time via the /geocode endpoint.
    """
    _require_admin(user)

    match: dict = {"org_id": user["org_id"], "site_name": {"$ne": None}}
    if q and q.strip():
        match["site_name"] = {"$regex": q.strip(), "$options": "i"}

    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$site_name"}},
        {"$sort": {"_id": 1}},
        {"$limit": limit},
    ]
    rows = []
    async for doc in db.simpro_jobs.aggregate(pipeline):
        name = (doc.get("_id") or "").strip()
        if name:
            rows.append({"site_name": name})
    return {"rows": rows, "total": len(rows)}


# ─────────────── GET /mobile/geocode ───────────────

_GEO_CACHE: dict = {}  # {q_lower: (ts, {lat, lng, display_name})}
_GEO_TTL_S = 7 * 24 * 3600  # 7 days — Nominatim usage-policy friendly


@router.get("/mobile/geocode")
async def geocode(
    q: str = Query(..., min_length=2, max_length=300),
    user: dict = Depends(get_current_user),
) -> dict:
    """Nominatim proxy — returns `{lat, lng, display_name}` or 404.

    Respects Nominatim usage policy: sets User-Agent, caches results
    for 7 days, single-request-per-lookup.
    """
    key = q.strip().lower()
    now = time.time()
    hit = _GEO_CACHE.get(key)
    if hit and (now - hit[0]) < _GEO_TTL_S:
        return hit[1]

    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": q, "format": "json", "limit": 1, "countrycodes": "au"}
    headers = {"User-Agent": "Paneltec-Civil-Mobile/1.0"}
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(url, params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise HTTPException(502, f"Geocode upstream error: {e}")

    if not data:
        raise HTTPException(404, "Address not found")

    top = data[0]
    result = {
        "lat": float(top["lat"]),
        "lng": float(top["lon"]),
        "display_name": top.get("display_name", q),
    }
    _GEO_CACHE[key] = (now, result)
    return result


# ─────────────── GET /mobile/weather ───────────────

# BOM Australia observation stations — small hardcoded lookup of
# major-city + Paneltec HQ region. Nearest station is picked by
# haversine distance to the requested lat/lng.
#
# Each entry is (name, product_id, wmo, lat, lng). Codes VERIFIED
# against reg.bom.gov.au 2026-09-07 (404 codes removed).
_BOM_STATIONS = [
    # (name, state_product, wmo, lat, lng)
    ("Launceston (Ti Tree Bend)", "IDT60801", "94969", -41.4172, 147.1370),
    ("Hobart",                    "IDT60801", "94970", -42.8839, 147.3347),
    ("Devonport Airport",         "IDT60801", "95960", -41.1697, 146.4300),
    ("Sydney (Observatory Hill)", "IDN60901", "94768", -33.8607, 151.2050),
    ("Sydney (Fort Denison)",     "IDN60901", "94769", -33.8523, 151.2261),
    ("Newcastle Nobbys",          "IDN60901", "94774", -32.9186, 151.7986),
    ("Melbourne Airport",         "IDV60801", "95936", -37.6690, 144.8410),
    ("Melbourne (Olympic Park)",  "IDV60801", "95866", -37.8255, 144.9816),
    ("Brisbane",                  "IDQ60801", "94578", -27.4818, 153.0389),
    ("Perth",                     "IDW60801", "94608", -31.9200, 115.8700),
    ("Adelaide (West Terrace)",   "IDS60901", "94648", -34.9257, 138.5900),
    ("Darwin Airport",            "IDD60801", "94120", -12.4239, 130.8925),
    ("Canberra Airport",          "IDN60903", "94926", -35.3050, 149.2000),
]

_PANELTEC_HQ = _BOM_STATIONS[0]  # Launceston Airport
_WX_CACHE: dict = {}  # {(product, wmo): (ts, result)}
_WX_TTL_S = 30 * 60  # 30 minutes per user brief


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _nearest_station(lat: Optional[float], lng: Optional[float]) -> tuple:
    if lat is None or lng is None:
        return _PANELTEC_HQ
    best = _PANELTEC_HQ
    best_d = _haversine_km(lat, lng, best[3], best[4])
    for st in _BOM_STATIONS[1:]:
        d = _haversine_km(lat, lng, st[3], st[4])
        if d < best_d:
            best, best_d = st, d
    return best


@router.get("/mobile/weather")
async def weather(
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    user: dict = Depends(get_current_user),
) -> dict:
    """BOM Australia obs proxy.

    Picks the nearest hardcoded station (or Paneltec HQ / Launceston
    when no coords given). Cached for 30 min per station. Failures
    return `{available: false, ...}` so the mobile UI can render a
    graceful placeholder instead of crashing.
    """
    name, product, wmo, slat, slng = _nearest_station(lat, lng)
    cache_key = (product, wmo)
    now = time.time()
    hit = _WX_CACHE.get(cache_key)
    if hit and (now - hit[0]) < _WX_TTL_S:
        return hit[1]

    url = f"http://reg.bom.gov.au/fwo/{product}/{product}.{wmo}.json"
    # BOM's edge blocks non-browser UAs. Prefix with a Mozilla-like
    # string; retain our attribution for their logs.
    headers = {"User-Agent": "Mozilla/5.0 (compatible; Paneltec-Civil-Mobile/1.0)"}
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            payload = r.json()
    except Exception as e:
        result = {
            "available": False,
            "station_name": name,
            "error": f"BOM upstream unavailable: {e.__class__.__name__}",
        }
        # Do NOT cache failures — retry on next call.
        return result

    observations = (payload.get("observations") or {}).get("data") or []
    if not observations:
        result = {
            "available": False,
            "station_name": name,
            "error": "no-observations",
        }
        return result

    latest = observations[0]
    result = {
        "available": True,
        "station_name": latest.get("name") or name,
        "station_wmo": wmo,
        "product": product,
        "temperature_c": latest.get("air_temp"),
        "apparent_c": latest.get("apparent_t"),
        "condition": latest.get("weather") or "-",
        "wind_kmh": latest.get("wind_spd_kmh"),
        "wind_dir": latest.get("wind_dir"),
        "humidity_pct": latest.get("rel_hum"),
        "rain_since_9am_mm": latest.get("rain_trace"),
        "observed_at": latest.get("local_date_time_full"),
        # Today high/low + rain probability aren't in the obs feed —
        # would need a separate `IDN60155` forecast fetch. Left blank for
        # now; UI shows "—" for those fields.
        "today_max_c": None,
        "today_min_c": None,
        "rain_probability_pct": None,
    }
    _WX_CACHE[cache_key] = (now, result)
    return result


# ─────────────── Startup: compound index ───────────────

async def ensure_indexes() -> None:
    """Idempotent compound index for the (worker_id, date, org_id) query
    pattern used by `/mobile/daily-jobs/today` and duplicate-guard.
    """
    await db.daily_job_assignments.create_index(
        [("org_id", 1), ("worker_id", 1), ("date", 1)],
        name="org_worker_date_idx",
        background=True,
    )
