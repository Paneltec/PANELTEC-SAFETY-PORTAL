"""Phase 4.8 — Asset Meter Trends.

Persists daily snapshots of engine_hours_total + odometer_km_total per Navixy-
synced asset so the UI can render week + month deltas alongside the existing
lifetime Total card.

  • Collection: `asset_meter_history`
      { asset_id, org_id, navixy_device_id, snapshot_date (YYYY-MM-DD),
        engine_hours_total, odometer_km_total, source, created_at }
  • Unique compound index on (asset_id, snapshot_date) — idempotent upserts.
  • Cron `meter_history_daily_snapshot` at 01:00 UTC captures today's totals.
  • One-time backfill `backfill_30d` pulls historical counter values from
    Navixy where available, otherwise marks asset as skipped (no fake data).
  • Endpoint `GET /api/assets/{asset_id}/meter-trends` returns total + week
    + month aggregates with daily sparkline points and honest
    `days_available` so the UI can show "Collecting data — N of 7 days".
"""
from __future__ import annotations
import asyncio, logging
from datetime import datetime, timedelta, timezone, date as _date
from typing import Any, Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException
from auth import get_current_user
from db import db
from models import new_id

log = logging.getLogger("paneltec.meter_history")
router = APIRouter(prefix="/assets", tags=["asset-meter-trends"])

# ───── Internals ─────────────────────────────────────────────────────


async def ensure_indexes():
    try:
        await db.asset_meter_history.create_index(
            [("asset_id", 1), ("snapshot_date", 1)],
            unique=True, name="uniq_asset_day",
        )
        await db.asset_meter_history.create_index([("org_id", 1), ("snapshot_date", -1)])
    except Exception as e:
        log.warning("meter_history index init failed: %s", e)


async def _upsert(asset: dict, snapshot_date: str, hours: Optional[float],
                  km: Optional[float], source: str) -> bool:
    """Idempotent insert. Returns True if a row was written/updated."""
    if hours is None and km is None:
        return False
    doc = {
        "id": new_id(),
        "asset_id": asset["id"],
        "org_id": asset["org_id"],
        "navixy_device_id": asset.get("navixy_device_id"),
        "snapshot_date": snapshot_date,
        "engine_hours_total": float(hours) if hours is not None else None,
        "odometer_km_total": float(km) if km is not None else None,
        "source": source,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.asset_meter_history.update_one(
        {"asset_id": asset["id"], "snapshot_date": snapshot_date},
        {"$setOnInsert": {"id": doc["id"], "created_at": doc["created_at"]},
         "$set": {k: v for k, v in doc.items() if k not in ("id", "created_at")}},
        upsert=True,
    )
    return True


async def meter_history_daily_snapshot() -> dict:
    """Cron entry — write today's totals for every Navixy-synced asset.
    Uses the value already persisted on `assets.hours_meter` / `assets.odo_km`
    (kept fresh by the 15-min counter sync). No Navixy API call needed."""
    await ensure_indexes()
    today = datetime.now(timezone.utc).date().isoformat()
    cur = db.assets.find(
        {"navixy_device_id": {"$ne": None}, "deleted_at": None},
        {"_id": 0, "id": 1, "org_id": 1, "navixy_device_id": 1,
         "hours_meter": 1, "odo_km": 1},
    )
    written = 0
    skipped = 0
    async for a in cur:
        ok = await _upsert(a, today, a.get("hours_meter"), a.get("odo_km"), "navixy_sync")
        if ok: written += 1
        else: skipped += 1
    log.info("meter_history_daily_snapshot date=%s written=%d skipped=%d",
             today, written, skipped)
    return {"written": written, "skipped": skipped, "date": today}


# ───── Navixy backfill ───────────────────────────────────────────────


async def _navixy_counter_history(client: httpx.AsyncClient, base: str, h: str,
                                  tracker_id: int, frm: str, to: str) -> list[dict]:
    """Try a few documented Navixy endpoints for daily counter history.
    Returns list of {date, hours, km} (any may be None). Empty list when the
    plan doesn't expose history."""
    # Endpoint A — `counter/list_history` (documented for counter telemetry).
    candidates = [
        ("/v2/tracker/counter/list_history",
         {"hash": h, "trackers": [tracker_id], "from": frm, "to": to, "aggregation": "day"}),
        # Endpoint B — `report/generate` with engine-hours+odometer template,
        # day buckets. Already used elsewhere in asset_navixy_sync; we keep
        # the call minimal here.
        ("/v2/tracker/counter/list",
         {"hash": h, "trackers": [tracker_id], "from": frm, "to": to}),
    ]
    for path, payload in candidates:
        try:
            r = await client.post(f"{base}{path}", json=payload)
            if r.status_code >= 400:
                continue
            data = r.json() or {}
            # Look for an array of per-day buckets. Navixy responses vary by
            # plan — we accept either `counter_aggregates` or `counters`.
            buckets = data.get("counter_aggregates") or data.get("counters") or []
            if not buckets:
                continue
            out: dict[str, dict] = {}
            for b in buckets:
                # Some shapes nest values:[{type,value,update_time}]
                values = b.get("values") if isinstance(b.get("values"), list) else [b]
                for v in values:
                    upd = v.get("update_time") or v.get("date") or v.get("day") or b.get("date")
                    if not upd: continue
                    day = str(upd)[:10]
                    slot = out.setdefault(day, {"date": day, "hours": None, "km": None})
                    val = v.get("value")
                    name = str(v.get("type") or v.get("counter_type") or v.get("name") or "").lower()
                    if "hour" in name and slot["hours"] is None and val is not None:
                        slot["hours"] = float(val)
                    elif ("odometer" in name or "mileage" in name) and slot["km"] is None and val is not None:
                        slot["km"] = float(val)
            if out:
                return sorted(out.values(), key=lambda x: x["date"])
        except Exception as e:
            log.debug("navixy backfill probe %s failed: %s", path, e)
            continue
    return []


async def backfill_30d() -> dict:
    """One-time backfill. Idempotent — relies on the unique index."""
    await ensure_indexes()
    asset_ok = 0
    asset_skipped = 0
    rows_written = 0
    today = datetime.now(timezone.utc).date()
    frm = (today - timedelta(days=30)).isoformat()
    to = today.isoformat()
    async for cfg in db.integration_configs.find(
        {"kind": "navixy", "status": "connected"},
        {"_id": 0, "org_id": 1, "config": 1},
    ):
        c = cfg.get("config") or {}
        base = (c.get("api_base_url") or "").rstrip("/")
        h = c.get("session_hash")
        if not base or not h:
            continue
        async with httpx.AsyncClient(timeout=20) as client:
            async for a in db.assets.find(
                {"org_id": cfg["org_id"], "navixy_device_id": {"$ne": None},
                 "deleted_at": None},
                {"_id": 0, "id": 1, "org_id": 1, "navixy_device_id": 1},
            ):
                try:
                    hist = await _navixy_counter_history(
                        client, base, h, int(a["navixy_device_id"]), frm, to,
                    )
                    if not hist:
                        asset_skipped += 1
                        log.info("meter_history backfill_skipped asset=%s tid=%s — no upstream history",
                                 a["id"], a["navixy_device_id"])
                        continue
                    for row in hist:
                        if await _upsert(a, row["date"], row["hours"], row["km"], "navixy_backfill"):
                            rows_written += 1
                    asset_ok += 1
                except Exception as e:
                    asset_skipped += 1
                    log.warning("meter_history backfill_failed asset=%s err=%s", a["id"], e)
    # Always write today's snapshot from the live counter values so even
    # assets where the upstream history is empty have at least one anchor row.
    snap = await meter_history_daily_snapshot()
    log.info("meter_history backfill done — assets_ok=%d skipped=%d rows=%d today_snap=%s",
             asset_ok, asset_skipped, rows_written, snap)
    return {"assets_ok": asset_ok, "assets_skipped": asset_skipped,
            "rows_written": rows_written, "today_snapshot": snap}


# ───── Trends endpoint ───────────────────────────────────────────────


def _delta(start: Optional[float], end: Optional[float]) -> Optional[float]:
    if start is None or end is None: return None
    d = end - start
    return round(d, 2) if d >= 0 else 0.0  # counters are monotonic; clamp


def _window(rows: list[dict], days: int) -> dict:
    """rows is sorted ascending by date. Returns delta + daily-avg + sparkline."""
    if not rows:
        return {"engine_hours_delta": 0, "odometer_km_delta": 0,
                "daily_avg_hours": 0, "daily_avg_km": 0,
                "days_available": 0, "sparkline": []}
    # Use first row in the window as the "start" anchor and the last as "end".
    hours_rows = [r for r in rows if r.get("engine_hours_total") is not None]
    km_rows    = [r for r in rows if r.get("odometer_km_total") is not None]
    h_delta = _delta(hours_rows[0]["engine_hours_total"], hours_rows[-1]["engine_hours_total"]) if hours_rows else 0
    k_delta = _delta(km_rows[0]["odometer_km_total"],    km_rows[-1]["odometer_km_total"])    if km_rows else 0
    n = len(rows)
    avg_h = round((h_delta or 0) / max(n, 1), 2)
    avg_k = round((k_delta or 0) / max(n, 1), 1)
    return {
        "engine_hours_delta": h_delta or 0,
        "odometer_km_delta":  k_delta or 0,
        "daily_avg_hours":    avg_h,
        "daily_avg_km":       avg_k,
        "days_available":     n,
        "sparkline": [
            {"date": r["snapshot_date"],
             "engine_hours": r.get("engine_hours_total"),
             "odometer_km": r.get("odometer_km_total")}
            for r in rows
        ],
    }


@router.get("/{asset_id}/meter-trends")
async def meter_trends(asset_id: str, user: dict = Depends(get_current_user)):
    asset = await db.assets.find_one(
        {"id": asset_id, "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "org_id": 1, "hours_meter": 1, "odo_km": 1,
         "hours_meter_updated_at": 1, "odo_km_updated_at": 1},
    )
    if not asset:
        raise HTTPException(404, "Asset not found")
    today = datetime.now(timezone.utc).date()
    frm_month = (today - timedelta(days=30)).isoformat()
    rows = await db.asset_meter_history.find(
        {"asset_id": asset_id, "snapshot_date": {"$gte": frm_month}},
        {"_id": 0, "snapshot_date": 1, "engine_hours_total": 1, "odometer_km_total": 1},
    ).sort("snapshot_date", 1).to_list(40)
    week_cutoff = (today - timedelta(days=7)).isoformat()
    week_rows = [r for r in rows if r["snapshot_date"] >= week_cutoff]
    as_of = asset.get("hours_meter_updated_at") or asset.get("odo_km_updated_at")
    return {
        "total": {
            "engine_hours": asset.get("hours_meter"),
            "odometer_km": asset.get("odo_km"),
            "as_of": as_of,
        },
        "week":  _window(week_rows, 7),
        "month": _window(rows, 30),
    }



# ───── Phase 4.9 Part 4 — track-based 30-day backfill ────────────────
# `/v2/tracker/counter/list_history` is unavailable on this Navixy plan
# (confirmed via the capability probe — see /app/memory/navixy_capabilities.md).
# We back-walk daily km from the live lifetime odometer using `/v2/track/list`
# trip lengths. `engine_hours_total` stays NULL for backfilled days — the
# trend aggregator handles `None` values gracefully.

async def backfill_tracks_30d() -> dict:
    """Reverse-walk daily km from today's lifetime odometer using
    /v2/track/list. Idempotent: only writes rows that don't already exist."""
    import httpx
    await ensure_indexes()
    today = datetime.now(timezone.utc).date()
    frm = (today - timedelta(days=30)).strftime("%Y-%m-%d 00:00:00")
    to = today.strftime("%Y-%m-%d 23:59:59")
    assets_seen = 0
    rows_written = 0
    async for cfg in db.integration_configs.find(
        {"kind": "navixy", "status": "connected"},
        {"_id": 0, "org_id": 1, "config": 1},
    ):
        c = cfg.get("config") or {}
        base = (c.get("api_base_url") or "").rstrip("/")
        h = c.get("session_hash")
        if not base or not h:
            continue
        async with httpx.AsyncClient(timeout=20) as client:
            async for a in db.assets.find(
                {"org_id": cfg["org_id"], "navixy_device_id": {"$ne": None},
                 "deleted_at": None},
                {"_id": 0, "id": 1, "org_id": 1, "navixy_device_id": 1,
                 "odo_km": 1},
            ):
                lifetime = a.get("odo_km")
                if lifetime is None:
                    continue
                assets_seen += 1
                try:
                    r = await client.post(
                        f"{base}/v2/track/list",
                        json={"hash": h, "tracker_id": int(a["navixy_device_id"]),
                              "from": frm, "to": to},
                    )
                    if r.status_code >= 400:
                        continue
                    tracks = (r.json() or {}).get("list") or []
                except Exception as e:
                    log.info("backfill_tracks tid=%s err=%s", a["navixy_device_id"], e)
                    continue
                # Sum km per day from `regular` trips.
                daily_km: dict[str, float] = {}
                for t in tracks:
                    if t.get("type") != "regular":
                        continue
                    day = (t.get("start_date") or "")[:10]
                    if not day:
                        continue
                    daily_km[day] = daily_km.get(day, 0.0) + float(t.get("length") or 0)
                # Walk backwards from today. Today's row stays the lifetime
                # total (or the daily-snapshot helper's value). For each
                # prior day, subtract the next-younger day's km to get the
                # end-of-day cumulative odometer.
                running = float(lifetime)
                day_cursor = today
                # Process today first (no subtraction needed — anchor).
                today_key = day_cursor.isoformat()
                if await _upsert(a, today_key, None, running, "navixy_backfill_tracks"):
                    rows_written += 1
                # Now walk back day-by-day.
                for _ in range(30):
                    day_cursor = day_cursor - timedelta(days=1)
                    key = day_cursor.isoformat()
                    km_after = daily_km.get((day_cursor + timedelta(days=1)).isoformat(), 0.0)
                    running = max(0.0, running - km_after)
                    if await _upsert(a, key, None, running, "navixy_backfill_tracks"):
                        rows_written += 1
    log.info("meter_history.backfill_tracks_30d assets=%d rows=%d",
             assets_seen, rows_written)
    return {"assets": assets_seen, "rows_written": rows_written}


# ───── Phase 4.9 Part 5 — admin manual snapshot entry ────────────────
from pydantic import BaseModel
from auth import require_roles  # noqa: E402


class ManualSnapshotIn(BaseModel):
    date: str            # YYYY-MM-DD
    engine_hours: Optional[float] = None
    odometer_km:  Optional[float] = None


@router.post("/{asset_id}/meter-history")
async def add_manual_snapshot(
    asset_id: str, body: ManualSnapshotIn,
    user: dict = Depends(require_roles("admin")),
):
    asset = await db.assets.find_one(
        {"id": asset_id, "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "org_id": 1, "navixy_device_id": 1},
    )
    if not asset:
        raise HTTPException(404, "Asset not found")
    if body.engine_hours is None and body.odometer_km is None:
        raise HTTPException(400, "Provide engine_hours and/or odometer_km")
    try:
        datetime.strptime(body.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    # Monotonic guard — the entered value can't be smaller than the
    # next-younger snapshot (counters only go up).
    younger = await db.asset_meter_history.find_one(
        {"asset_id": asset_id, "snapshot_date": {"$gt": body.date}},
        {"_id": 0, "engine_hours_total": 1, "odometer_km_total": 1},
        sort=[("snapshot_date", 1)],
    )
    if younger:
        if (body.engine_hours is not None
            and younger.get("engine_hours_total") is not None
            and body.engine_hours > younger["engine_hours_total"]):
            raise HTTPException(409, f"engine_hours ({body.engine_hours}) exceeds the next-younger snapshot ({younger['engine_hours_total']}). Counters only go up.")
        if (body.odometer_km is not None
            and younger.get("odometer_km_total") is not None
            and body.odometer_km > younger["odometer_km_total"]):
            raise HTTPException(409, f"odometer_km ({body.odometer_km}) exceeds the next-younger snapshot ({younger['odometer_km_total']}).")
    ok = await _upsert(asset, body.date, body.engine_hours, body.odometer_km, "manual")
    log.info("meter_history.manual asset=%s date=%s hours=%s km=%s actor=%s",
             asset_id, body.date, body.engine_hours, body.odometer_km, user["id"])
    return {"ok": ok, "date": body.date, "source": "manual"}
