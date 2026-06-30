"""Phase 4.9 — Asset trip summary (Today / Week / Month).

Aggregates `tracker/track/list` calls from Navixy into a single
endpoint per asset+range. In-memory cache keyed by
(asset_id, range, org_id) with a 60-second TTL avoids hammering
Navixy when the UI refetches on tab clicks.

Idle time
─────────
Navixy's `track/list` returns drive segments (type="regular"). The
current plan does not expose a `track/stop/list` or `track/idle/list`
endpoint (probed: HTTP 400). We derive idle as the sum of inter-trip
gaps SHORTER than 30 minutes (engine likely still on between two
nearby legs). Gaps ≥ 30 min are treated as engine-off and excluded.
"""
from __future__ import annotations
import asyncio, logging, time
from datetime import datetime, timedelta, timezone
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from auth import get_current_user
from db import db

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover — py<3.9
    ZoneInfo = None

log = logging.getLogger("paneltec.navixy.trip_summary")
router = APIRouter(prefix="/assets", tags=["asset-trip-summary"])

# ───── Cache ─────────────────────────────────────────────────────────
_TRIP_CACHE: dict[tuple, tuple[float, dict]] = {}  # key → (ts, payload)
_CACHE_TTL_S = 60.0


# ───── Helpers ───────────────────────────────────────────────────────


def _org_tz(org_id: str) -> "ZoneInfo":
    # Hardcoded to Australia/Sydney per brief default; surface via
    # org_settings.timezone if the user later moves to multi-tz.
    if ZoneInfo is None:
        return timezone.utc
    return ZoneInfo("Australia/Sydney")


def _range_bounds(range_key: str, org_id: str) -> tuple[str, str, int]:
    """Returns (from_str, to_str, total_days) for the Navixy call.
    Navixy expects `YYYY-MM-DD HH:MM:SS` in tracker-local time (we pass
    org-local; Navixy plan accepts naive local strings)."""
    tz = _org_tz(org_id)
    now_local = datetime.now(tz)
    if range_key == "today":
        start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        end = now_local
        total = 1
    elif range_key == "week":
        start = (now_local - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = now_local
        total = 7
    elif range_key == "month":
        start = (now_local - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = now_local
        total = 30
    else:
        raise HTTPException(400, "range must be 'today' | 'week' | 'month'")
    fmt = "%Y-%m-%d %H:%M:%S"
    return start.strftime(fmt), end.strftime(fmt), total


def _parse_naive(s: str) -> Optional[datetime]:
    if not s: return None
    try:
        return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def _aggregate(tracks: list[dict], days: int) -> dict:
    """Reduce Navixy track/list output → 4-tile summary + per-day sparkline."""
    distance_km = 0.0
    drive_seconds = 0
    max_speed = 0
    daily: dict[str, float] = {}
    # First pass — drive metrics + per-day distance.
    sorted_tracks = sorted(
        (t for t in (tracks or []) if t.get("type") == "regular"),
        key=lambda t: t.get("start_date") or "",
    )
    for t in sorted_tracks:
        length = float(t.get("length") or 0)
        ms = int(t.get("max_speed") or 0)
        distance_km += length
        if ms > max_speed:
            max_speed = ms
        st = _parse_naive(t.get("start_date"))
        en = _parse_naive(t.get("end_date"))
        if st and en and en > st:
            drive_seconds += int((en - st).total_seconds())
        if st:
            day = st.strftime("%Y-%m-%d")
            daily[day] = daily.get(day, 0.0) + length
    # Second pass — idle = inter-trip gaps shorter than 30 minutes.
    idle_seconds = 0
    for prev, nxt in zip(sorted_tracks, sorted_tracks[1:]):
        a = _parse_naive(prev.get("end_date"))
        b = _parse_naive(nxt.get("start_date"))
        if not a or not b: continue
        gap = (b - a).total_seconds()
        if 0 < gap < 1800:  # <30 min
            idle_seconds += int(gap)
    sparkline = [
        {"date": d, "km": round(daily.get(d, 0.0), 2)}
        for d in _last_n_days(days)
    ]
    return {
        "distance_km":  round(distance_km, 2),
        "drive_seconds": drive_seconds,
        "idle_seconds":  idle_seconds,
        "max_speed_kmh": max_speed,
        "trip_count":    len(sorted_tracks),
        "days_available": len({(t.get("start_date") or "")[:10] for t in sorted_tracks if t.get("start_date")}),
        "sparkline":     sparkline,
    }


def _last_n_days(n: int) -> list[str]:
    today = datetime.utcnow().date()
    return [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n - 1, -1, -1)]


# ───── Navixy call ───────────────────────────────────────────────────


async def _fetch_tracks(org_id: str, tracker_id: int, frm: str, to: str) -> list[dict]:
    cfg_doc = await db.integration_configs.find_one(
        {"org_id": org_id, "kind": "navixy", "status": "connected"},
        {"config": 1},
    )
    if not cfg_doc:
        return []
    c = cfg_doc.get("config") or {}
    base = (c.get("api_base_url") or "").rstrip("/")
    h = c.get("session_hash")
    if not base or not h:
        return []
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.post(
            f"{base}/v2/track/list",
            json={"hash": h, "tracker_id": int(tracker_id), "from": frm, "to": to},
        )
        if r.status_code >= 400:
            log.info("track/list tid=%s %d %s", tracker_id, r.status_code, r.text[:200])
            return []
        return (r.json() or {}).get("list") or []


# ───── Endpoint ──────────────────────────────────────────────────────


@router.get("/{asset_id}/trip-summary")
async def trip_summary(
    asset_id: str,
    range: str = Query("today", regex="^(today|week|month)$"),
    user: dict = Depends(get_current_user),
):
    asset = await db.assets.find_one(
        {"id": asset_id, "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "org_id": 1, "navixy_device_id": 1, "name": 1, "rego_serial": 1},
    )
    if not asset:
        raise HTTPException(404, "Asset not found")
    if not asset.get("navixy_device_id"):
        return {
            "range": range, "navixy": False,
            "distance_km": 0, "drive_seconds": 0, "idle_seconds": 0,
            "max_speed_kmh": 0, "trip_count": 0,
            "days_available": 0, "sparkline": [],
            "as_of": None,
        }
    key = (asset_id, range, user["org_id"])
    hit = _TRIP_CACHE.get(key)
    now_ts = time.time()
    if hit and (now_ts - hit[0]) < _CACHE_TTL_S:
        return hit[1]
    frm, to, total = _range_bounds(range, user["org_id"])
    tracks = await _fetch_tracks(user["org_id"], int(asset["navixy_device_id"]), frm, to)
    agg = _aggregate(tracks, total)
    payload = {
        "range":      range,
        "navixy":     True,
        "from":       frm,
        "to":         to,
        "as_of":      datetime.now(timezone.utc).isoformat(),
        "total_days_in_range": total,
        **agg,
    }
    _TRIP_CACHE[key] = (now_ts, payload)
    log.info("navixy.trip_summary device_id=%s range=%s distance=%s trips=%s",
             asset["navixy_device_id"], range, agg["distance_km"], agg["trip_count"])
    return payload
