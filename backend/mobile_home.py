"""
Mobile Home Dashboard — v58.13.132f

Endpoints:
  GET  /api/mobile/home                  — aggregated dashboard data
  POST /api/mobile/user/active-company   — switch active company
  GET  /api/mobile/notifications/count   — notification badge count (stub)
"""
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from auth import get_current_user
from models import now_iso
from mobile_modules_data import MODULE_KEYS, _load_matrix

_log = logging.getLogger("paneltec.mobile.home")

router = APIRouter(tags=["mobile-home"])

# ── Weather cache (geohash → {data, ts}) ────────────────
_weather_cache: dict[str, dict] = {}
WEATHER_CACHE_TTL = 600  # 10 minutes

# ── Company ID → Name mapping ───────────────────────────
COMPANY_NAMES = {
    "2": "Paneltec Group",
    "3": "Viatec Traffic Solutions",
}

# ── Default office coordinates (Canberra region) ────────
DEFAULT_LAT = -34.79
DEFAULT_LNG = 149.13


# ── Helpers ──────────────────────────────────────────────

def _time_greeting() -> str:
    hour = datetime.now(timezone.utc).hour + 10  # AEST rough
    if hour >= 24:
        hour -= 24
    if hour < 12:
        return "Good morning"
    elif hour < 17:
        return "Good afternoon"
    return "Good evening"


def _geohash_key(lat: float, lng: float) -> str:
    """Coarse geohash for cache keying (≈11km precision)."""
    return f"{round(lat, 1)}:{round(lng, 1)}"


async def _fetch_weather(lat: float, lng: float) -> dict:
    """Fetch current weather from Open-Meteo (free, no API key)."""
    cache_key = _geohash_key(lat, lng)
    cached = _weather_cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < WEATHER_CACHE_TTL:
        return cached["data"]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lng,
                    "current_weather": "true",
                    "windspeed_unit": "kmh",
                    "timezone": "Australia/Sydney",
                },
            )
            if r.status_code == 200:
                cw = r.json().get("current_weather", {})
                data = {
                    "temperature_c": cw.get("temperature"),
                    "condition": _wmo_to_condition(cw.get("weathercode", 0)),
                    "wind_kmh": cw.get("windspeed"),
                    "wind_dir": _degrees_to_compass(cw.get("winddirection", 0)),
                    "location_source": "office",
                }
                _weather_cache[cache_key] = {"data": data, "ts": time.time()}
                return data
    except Exception as e:
        _log.warning("Weather fetch failed: %s", e)

    return {
        "temperature_c": None,
        "condition": "Unknown",
        "wind_kmh": None,
        "wind_dir": "",
        "location_source": "unavailable",
    }


def _wmo_to_condition(code: int) -> str:
    """Map WMO weather code to human-readable condition."""
    mapping = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy",
        3: "Overcast", 45: "Foggy", 48: "Rime fog",
        51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
        61: "Light rain", 63: "Rain", 65: "Heavy rain",
        71: "Light snow", 73: "Snow", 75: "Heavy snow",
        80: "Light showers", 81: "Showers", 82: "Heavy showers",
        95: "Thunderstorm", 96: "Thunderstorm + hail", 99: "Severe thunderstorm",
    }
    return mapping.get(code, "Unknown")


def _degrees_to_compass(deg: float) -> str:
    dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    idx = round(deg / 22.5) % 16
    return dirs[idx]


def _avatar_initials(name: str) -> str:
    parts = (name or "?").strip().split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    return (parts[0][0] if parts else "?").upper()


# ── Module definitions (filtered by role permissions) ────

# ── Module definitions (v58.13.132d — dynamically loaded from mobile_modules_data.py) ──
# Maps MODULE_KEYS → mobile-friendly label, icon, route.
MODULE_METADATA = {
    "pre_start":          {"label": "Pre-Start",        "icon": "clipboard",      "route": "/(tabs)/prestart"},
    "site_diary":         {"label": "Site Diary",        "icon": "book",           "route": "/(tabs)/report"},
    "hazard":             {"label": "Hazards",           "icon": "warning",        "route": "/(tabs)/report"},
    "incident":           {"label": "Incidents",         "icon": "alert-circle",   "route": "/incidents"},
    "inspection":         {"label": "Inspections",       "icon": "search",         "route": "/inspections"},
    "swms":               {"label": "SWMS",              "icon": "document",       "route": "/swms"},
    "inductions":         {"label": "Inductions",        "icon": "school",         "route": "/inductions"},
    "plant_vehicles":     {"label": "Fleet",             "icon": "car",            "route": "/fleet"},
    "certifications":     {"label": "Certifications",    "icon": "ribbon",         "route": "/certifications"},
    "ask_intel":          {"label": "Ask Intel",         "icon": "sparkles",       "route": "/ask"},
    "sign_on":            {"label": "Sites",             "icon": "location",       "route": "/(tabs)/sites"},
    "profile":            {"label": "Profile",           "icon": "person",         "route": "/(tabs)/profile"},
    "forms":              {"label": "Forms",             "icon": "document-text",  "route": "/forms"},
    "document_library":   {"label": "Documents",         "icon": "folder",         "route": "/documents"},
    "contractors":        {"label": "Contractors",       "icon": "people",         "route": "/contractors"},
    "suppliers":          {"label": "Suppliers",         "icon": "business",       "route": "/suppliers"},
    "workers":            {"label": "Workers",           "icon": "people-circle",  "route": "/workers"},
    "users_directory":    {"label": "Users",             "icon": "people",         "route": "/users"},
    "compliance_snapshot": {"label": "Compliance",       "icon": "shield-checkmark","route": "/compliance"},
}


async def _get_module_badges(user: dict, company_id: str) -> dict:
    """Compute badge counts for dashboard modules."""
    org_id = user.get("org_id", "")
    badges: dict[str, Optional[int]] = {}

    try:
        # Sites: count of active sites for the company
        site_count = await db.sites.count_documents({
            "org_id": org_id, "deleted_at": None, "status": {"$ne": "archived"},
        })
        badges["sites"] = site_count if site_count > 0 else None

        # Hazards: open hazards
        hazard_count = await db.hazards.count_documents({
            "org_id": org_id, "deleted_at": None, "status": "open",
        })
        badges["hazards"] = hazard_count if hazard_count > 0 else None

        # Pre-starts: today's count
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        prestart_count = await db.pre_starts.count_documents({
            "org_id": org_id, "deleted_at": None, "date": today,
        })
        badges["prestart"] = prestart_count if prestart_count > 0 else None
    except Exception:
        pass  # Collections may not exist in test DB

    return badges


# ── GET /api/mobile/home ─────────────────────────────────

@router.get("/mobile/home")
async def mobile_home(user: dict = Depends(get_current_user)):
    user_id = user["id"]
    org_id = user.get("org_id", "")
    role = (user.get("role") or "worker").lower()
    name = user.get("name", "")

    # ── Company info ──
    company_id = user.get("company_id") or user.get("simpro_company_id") or "2"
    company_ids = user.get("company_ids") or [company_id]
    active_company_id = user.get("active_company_id") or company_id
    can_switch = len(set(company_ids)) > 1

    companies = [
        {"id": cid, "name": COMPANY_NAMES.get(str(cid), f"Company {cid}")}
        for cid in company_ids
    ]

    # ── Today info ──
    now = datetime.now(timezone.utc)
    aest = now.hour + 10
    today_iso = now.strftime("%Y-%m-%d")
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    day_name = day_names[now.weekday()]

    # ── Weather (office fallback coords) ──
    org = await db.orgs.find_one({"id": org_id}, {"_id": 0})
    lat = (org or {}).get("office_latitude") or DEFAULT_LAT
    lng = (org or {}).get("office_longitude") or DEFAULT_LNG
    weather = await _fetch_weather(lat, lng)

    # ── Site sign-in status (v58.13.132d — uses canonical site_signons collection) ──
    site_info = {"signed_in": False, "site_id": None, "site_name": None,
                 "signed_in_at": None, "nearest": None}

    try:
        active_signon = await db.site_signons.find_one(
            {"signed_by_user_id": user_id, "signoff_at": None, "org_id": org_id},
            {"_id": 0, "site_id": 1, "site_name": 1, "signed_at": 1},
            sort=[("signed_at", -1)],
        )
    except Exception:
        active_signon = None

    if active_signon:
        site_info["signed_in"] = True
        site_info["site_id"] = active_signon.get("site_id")
        site_info["site_name"] = active_signon.get("site_name")
        site_info["signed_in_at"] = active_signon.get("signed_at")
    else:
        # Find nearest site (rough — using all active sites for now)
        try:
            nearest_site = await db.simpro_sites.find_one(
                {"org_id": org_id, "deleted_at": None},
                {"_id": 0, "simpro_site_id": 1, "name": 1},
            )
            if nearest_site:
                site_info["nearest"] = {
                    "site_id": nearest_site.get("simpro_site_id"),
                    "name": nearest_site.get("name", "Unknown Site"),
                    "distance_km": None,
                }
        except Exception:
            pass

    # ── Modules (v58.13.132d — dynamic from mobile_modules_data.py, role-filtered) ──
    badges = await _get_module_badges(user, active_company_id)
    try:
        matrix = await _load_matrix(org_id)
    except Exception:
        matrix = {}

    # Determine role key for the matrix lookup
    role_key = role
    if role_key not in ("worker", "supervisor", "contractor", "admin"):
        role_key = "worker"  # fallback for custom roles

    role_modules = matrix.get(role_key, {})
    modules = []
    for mod_key in MODULE_KEYS:
        if not role_modules.get(mod_key, False):
            continue
        meta = MODULE_METADATA.get(mod_key)
        if not meta:
            continue
        modules.append({
            "key": mod_key,
            "label": meta["label"],
            "icon": meta["icon"],
            "route": meta["route"],
            "badge": badges.get(mod_key),
        })

    return {
        "user": {
            "name": name,
            "avatar_initials": _avatar_initials(name),
            "company_id": str(active_company_id),
            "company_name": COMPANY_NAMES.get(str(active_company_id), "Paneltec Group"),
            "employee_number": user.get("simpro_employee_id"),
        },
        "companies": companies,
        "active_company_id": str(active_company_id),
        "can_switch_company": can_switch,
        "today": {
            "date_iso": today_iso,
            "day_name": day_name,
            "greeting": _time_greeting(),
        },
        "site": site_info,
        "weather": weather,
        "modules": modules,
    }


# ── POST /api/mobile/user/active-company ─────────────────

class ActiveCompanyIn(BaseModel):
    company_id: str


@router.post("/mobile/user/active-company")
async def set_active_company(body: ActiveCompanyIn, user: dict = Depends(get_current_user)):
    company_ids = user.get("company_ids") or [user.get("company_id", "2")]
    if body.company_id not in [str(c) for c in company_ids]:
        raise HTTPException(400, "Company not in your allowed companies")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"active_company_id": body.company_id, "updated_at": now_iso()}},
    )
    return {"ok": True, "active_company_id": body.company_id}


# ── GET /api/mobile/notifications/count ──────────────────

@router.get("/mobile/notifications/count")
async def notification_count(user: dict = Depends(get_current_user)):
    # Stub — no notification system yet (M2 baseline)
    return {"count": 0}
