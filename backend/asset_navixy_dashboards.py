"""Phase 3.6 — Native Navixy dashboards (Fleet Live Status / Trips / Technical Conditions).

All three endpoints are admin-friendly read-only aggregations over the same
Navixy API we already use for the vehicle map. Each response is cached
server-side for 60 s per (org, endpoint) to keep page-loads cheap.
"""
from __future__ import annotations
import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import db
from models import now_iso

log = logging.getLogger("paneltec.navixy.dashboards")
router = APIRouter(prefix="/assets/navixy/dashboards", tags=["asset-navixy-dashboards"])

# (org_id, endpoint) -> {payload, ts}
_CACHE: dict[tuple[str, str], dict] = {}
_CACHE_TTL = 60  # seconds


def _cache_get(org_id: str, endpoint: str) -> Optional[dict]:
    row = _CACHE.get((org_id, endpoint))
    if row and (time.time() - row["ts"]) < _CACHE_TTL:
        return row["payload"]
    return None


def _cache_set(org_id: str, endpoint: str, payload: dict):
    _CACHE[(org_id, endpoint)] = {"payload": payload, "ts": time.time()}


async def _navixy_cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "navixy"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Navixy not connected")
    return doc.get("config") or {}


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s or not isinstance(s, str):
        return None
    s = s.replace("T", " ").replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _minutes_since(dt: Optional[datetime], now: datetime) -> Optional[int]:
    if not dt:
        return None
    return int((now - dt).total_seconds() // 60)


# ─────────────────────── Tab 1 — Fleet Live Status ───────────────────────

@router.get("/fleet-status")
async def fleet_status(user: dict = Depends(get_current_user)):
    cached = _cache_get(user["org_id"], "fleet-status")
    if cached:
        return cached

    cfg = await _navixy_cfg(user["org_id"])
    base = (cfg.get("api_base_url") or "").rstrip("/")
    h = cfg.get("session_hash")
    if not base or not h:
        raise HTTPException(400, "Navixy is not configured correctly")

    async with httpx.AsyncClient(timeout=20) as c:
        tr = await c.post(f"{base}/v2/tracker/list", json={"hash": h})
        tr_data = tr.json() or {}
        if not tr_data.get("success", True):
            msg = (tr_data.get("status") or {}).get("description") or "tracker/list failed"
            raise HTTPException(400, msg)
        trackers = [t for t in (tr_data.get("list") or []) if isinstance(t, dict)]
        states: dict = {}
        if trackers:
            ids = [t["id"] for t in trackers if t.get("id")]
            rs = await c.post(f"{base}/v2/tracker/get_states",
                              json={"hash": h, "trackers": ids, "allow_not_exist": True})
            rd = rs.json() or {}
            raw = rd.get("states") if isinstance(rd, dict) else None
            if isinstance(raw, dict):
                for k, v in raw.items():
                    try:
                        states[int(k)] = v
                    except (TypeError, ValueError):
                        continue

    now = datetime.now(timezone.utc)
    total = len(trackers)
    connection = {"online": 0, "offline": 0, "idle": 0, "just_registered": 0, "other": 0}
    movement = {"moving": 0, "parked": 0, "stopped": 0, "idling": 0, "unknown": 0}
    long_unseen = []  # (label, last_updated_dt, minutes_since)

    for t in trackers:
        tid = t.get("id")
        s = states.get(tid, {}) if isinstance(states.get(tid), dict) else {}
        cs = s.get("connection_status")
        if cs in connection:
            connection[cs] += 1
        else:
            connection["other"] += 1
        ms = s.get("movement_status")
        if ms in movement:
            movement[ms] += 1
        else:
            movement["unknown"] += 1
        # Last seen calculation for the long-unseen table
        last = _parse_dt(s.get("last_update")) or _parse_dt(s.get("actual_track_update"))
        mins = _minutes_since(last, now)
        if mins is not None and mins > 60:
            long_unseen.append({
                "id": tid,
                "label": t.get("label") or "Vehicle",
                "last_updated": s.get("last_update") or s.get("actual_track_update"),
                "minutes_ago": mins,
            })

    # Top-level KPIs (matching Navixy's wording)
    online = connection["online"] + connection["idle"]
    offline = connection["offline"]
    gps_not_updated = max(0, sum(1 for t in trackers
                                if (states.get(t.get("id")) or {}).get("connection_status") == "offline"
                                and _minutes_since(_parse_dt((states.get(t.get("id")) or {}).get("last_update")), now) and
                                _minutes_since(_parse_dt((states.get(t.get("id")) or {}).get("last_update")), now) > 60))
    other = connection["just_registered"] + connection["other"]

    long_unseen.sort(key=lambda x: -(x["minutes_ago"] or 0))
    payload = {
        "total": total,
        "online": online,
        "offline": offline,
        "gps_not_updated": gps_not_updated,
        "other": other,
        "connection_breakdown": [
            {"label": "Online", "value": online, "color": "#10B981"},
            {"label": "GPS not updated", "value": gps_not_updated, "color": "#F59E0B"},
            {"label": "Offline", "value": max(0, offline - gps_not_updated), "color": "#94A3B8"},
            {"label": "Other", "value": other, "color": "#6366F1"},
        ],
        "movement_breakdown": [
            {"label": "Moving", "value": movement["moving"], "color": "#10B981"},
            {"label": "Parked", "value": movement["parked"], "color": "#3B82F6"},
            {"label": "Stopped", "value": movement["stopped"], "color": "#F59E0B"},
            {"label": "Idling", "value": movement["idling"], "color": "#A78BFA"},
            {"label": "Unknown", "value": movement["unknown"], "color": "#CBD5E1"},
        ],
        "long_unseen": long_unseen[:10],
        "updated_at": now_iso(),
    }
    _cache_set(user["org_id"], "fleet-status", payload)
    return payload


# ─────────────────────── Tab 2 — Trips (last N days) ───────────────────────

@router.get("/trips")
async def trips(days: int = 7, user: dict = Depends(get_current_user)):
    if days < 1 or days > 90:
        raise HTTPException(422, "days must be between 1 and 90")
    cache_key = f"trips-{days}"
    cached = _cache_get(user["org_id"], cache_key)
    if cached:
        return cached

    cfg = await _navixy_cfg(user["org_id"])
    base = (cfg.get("api_base_url") or "").rstrip("/")
    h = cfg.get("session_hash")

    now = datetime.now(timezone.utc)
    frm = (now - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    to = now.strftime("%Y-%m-%d %H:%M:%S")

    async with httpx.AsyncClient(timeout=30) as c:
        tr = await c.post(f"{base}/v2/tracker/list", json={"hash": h})
        trackers = [t for t in ((tr.json() or {}).get("list") or []) if isinstance(t, dict)]

        # Aggregate per tracker — concurrent with bounded fan-out
        sem = asyncio.Semaphore(8)

        async def one(t):
            async with sem:
                tid = t.get("id")
                if not tid:
                    return None
                try:
                    r = await c.post(f"{base}/v2/track/list",
                                     json={"hash": h, "tracker_id": tid, "from": frm, "to": to})
                    d = r.json() or {}
                    if not d.get("success"):
                        return {"id": tid, "label": t.get("label") or "Vehicle",
                                "trips": 0, "km": 0.0, "minutes": 0}
                    tracks = d.get("list") or []
                    km = sum(float(x.get("length") or 0) for x in tracks)
                    minutes = 0
                    for x in tracks:
                        a = _parse_dt(x.get("start_date"))
                        b = _parse_dt(x.get("end_date"))
                        if a and b:
                            minutes += max(0, int((b - a).total_seconds() // 60))
                    return {"id": tid, "label": t.get("label") or "Vehicle",
                            "trips": len(tracks), "km": round(km, 2),
                            "minutes": minutes, "tracks": tracks}
                except (httpx.HTTPError, ValueError):
                    return {"id": tid, "label": t.get("label") or "Vehicle",
                            "trips": 0, "km": 0.0, "minutes": 0, "tracks": []}

        rows = [r for r in await asyncio.gather(*[one(t) for t in trackers]) if r]

    total_trips = sum(r["trips"] for r in rows)
    total_km = round(sum(r["km"] for r in rows), 2)
    total_minutes = sum(r["minutes"] for r in rows)
    avg_km = round(total_km / total_trips, 2) if total_trips else 0.0

    # Per-day breakdown (bar chart)
    per_day_map: dict[str, dict] = {}
    for i in range(days):
        d_iso = (now - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        per_day_map[d_iso] = {"date": d_iso, "trips": 0, "km": 0.0}
    for r in rows:
        for tr in r.get("tracks") or []:
            sd = tr.get("start_date") or ""
            day = sd[:10]
            if day in per_day_map:
                per_day_map[day]["trips"] += 1
                per_day_map[day]["km"] += float(tr.get("length") or 0)
    per_day = [{"date": v["date"], "trips": v["trips"], "km": round(v["km"], 2)}
               for v in per_day_map.values()]

    top_vehicles = sorted(rows, key=lambda r: -r["km"])[:10]
    top_vehicles = [{"id": r["id"], "label": r["label"], "trips": r["trips"],
                     "km": r["km"], "minutes": r["minutes"]} for r in top_vehicles]

    payload = {
        "days": days,
        "total_trips": total_trips,
        "total_km": total_km,
        "total_drive_minutes": total_minutes,
        "avg_km": avg_km,
        "per_day": per_day,
        "top_vehicles": top_vehicles,
        "updated_at": now_iso(),
    }
    _cache_set(user["org_id"], cache_key, payload)
    return payload


# ─────────────────────── Tab 3 — Technical Conditions ───────────────────────

@router.get("/technical")
async def technical(user: dict = Depends(get_current_user)):
    cached = _cache_get(user["org_id"], "technical")
    if cached:
        return cached

    cfg = await _navixy_cfg(user["org_id"])
    base = (cfg.get("api_base_url") or "").rstrip("/")
    h = cfg.get("session_hash")

    async with httpx.AsyncClient(timeout=20) as c:
        tr = await c.post(f"{base}/v2/tracker/list", json={"hash": h})
        trackers = [t for t in ((tr.json() or {}).get("list") or []) if isinstance(t, dict)]
        states: dict = {}
        if trackers:
            ids = [t["id"] for t in trackers if t.get("id")]
            rs = await c.post(f"{base}/v2/tracker/get_states",
                              json={"hash": h, "trackers": ids, "allow_not_exist": True})
            raw = (rs.json() or {}).get("states") or {}
            if isinstance(raw, dict):
                for k, v in raw.items():
                    try:
                        states[int(k)] = v
                    except (TypeError, ValueError):
                        continue

    now = datetime.now(timezone.utc)
    per_asset = []
    online_valid_gps = 0
    recent_engine = 0
    idle_over_24h = 0

    for t in trackers:
        tid = t.get("id")
        s = states.get(tid, {}) if isinstance(states.get(tid), dict) else {}
        gps = s.get("gps") if isinstance(s.get("gps"), dict) else {}
        loc = gps.get("location") if isinstance(gps.get("location"), dict) else None
        cs = s.get("connection_status")
        has_gps = isinstance(loc, dict) and loc.get("lat") is not None and loc.get("lng") is not None
        last_pos = _parse_dt(gps.get("updated") or s.get("last_update"))
        last_eng = _parse_dt(s.get("ignition_update"))
        pos_age_min = _minutes_since(last_pos, now)
        if cs == "online" and has_gps:
            online_valid_gps += 1
        if last_eng and (now - last_eng) < timedelta(hours=24):
            recent_engine += 1
        if pos_age_min is not None and pos_age_min > 24 * 60:
            idle_over_24h += 1
        battery_level = s.get("battery_level")
        gsm = s.get("gsm") if isinstance(s.get("gsm"), dict) else {}
        per_asset.append({
            "id": tid,
            "label": t.get("label") or "Vehicle",
            "status": cs,
            "last_position_age_min": pos_age_min,
            "last_engine_event_at": s.get("ignition_update"),
            "battery": battery_level,
            "gsm": (gsm.get("signal_level") if isinstance(gsm, dict) else None),
            "network": (gsm.get("network_name") if isinstance(gsm, dict) else None),
            "has_gps": has_gps,
        })

    per_asset.sort(key=lambda r: ((r.get("last_position_age_min") is None), -(r.get("last_position_age_min") or 0)))

    payload = {
        "total": len(trackers),
        "online_valid_gps": online_valid_gps,
        "recent_engine": recent_engine,
        "idle_over_24h": idle_over_24h,
        "per_asset": per_asset[:100],
        "updated_at": now_iso(),
    }
    _cache_set(user["org_id"], "technical", payload)
    return payload
