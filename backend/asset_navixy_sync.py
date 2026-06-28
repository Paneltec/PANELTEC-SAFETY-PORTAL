"""Phase 3.5 — Navixy meter ingestion (Engine hours + Odometer).

Pulls per-device counters every 15 minutes and writes them onto the asset
record. Recomputes the cached status of every active service schedule on the
updated assets so the UI reflects fresh "due / overdue" pills.

Navixy API surface used (graceful fallbacks for plan/version variance):
  • POST /v2/tracker/counter/list  {hash, trackers:[...]}  (batch, preferred)
  • POST /v2/tracker/get_states    {hash, trackers:[...]}  (some plans embed
    `counters` inside the per-tracker state — used as fallback)
"""
from __future__ import annotations
import asyncio
import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import db
from models import now_iso

log = logging.getLogger("paneltec.navixy.sync")
router = APIRouter(prefix="/assets", tags=["asset-navixy-sync"])

_LOCK = asyncio.Lock()  # prevent concurrent sync waves (scheduler + manual click)


# ─────────────────────── Navixy parsing helpers ───────────────────────

# Counter `type`/`name`/`parameter` values that Navixy uses in the wild for
# engine hours and odometer. We match case-insensitively.
HOURS_KEYS = ("engine_hours", "engine hours", "engine-hours", "enginehours",
              "ignition_hours", "ignition hours", "hours_worked")
KM_KEYS = ("odometer", "odo", "odo_km", "mileage", "distance",
           "vehicle_odometer", "obd_odometer")


def _normalize_counter_key(c: dict) -> str:
    """Return a lowered string we can match against HOURS_KEYS / KM_KEYS."""
    for k in ("type", "counter_type", "parameter", "parameter_name", "name", "label"):
        v = c.get(k)
        if isinstance(v, str) and v:
            return v.strip().lower().replace(" ", "_")
    return ""


def _coerce_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _extract_counters_from_state(state: dict) -> dict:
    """Extract hours / odo from a single `/v2/tracker/get_states` entry.
    Returns {hours, hours_at, odo_km, odo_at}. Each may be None."""
    out: dict[str, Any] = {"hours": None, "hours_at": None, "odo_km": None, "odo_at": None}
    if not isinstance(state, dict):
        return out

    # Shape 1: state.counters = [{type, value, update_time}, ...]
    counters = state.get("counters") or state.get("counter_values") or []
    if isinstance(counters, list):
        for c in counters:
            if not isinstance(c, dict):
                continue
            key = _normalize_counter_key(c)
            val = _coerce_float(c.get("value") if "value" in c else c.get("current_value"))
            upd = c.get("update_time") or c.get("updated_at") or c.get("time")
            if val is None:
                continue
            if any(h in key for h in HOURS_KEYS) and out["hours"] is None:
                out["hours"] = val
                out["hours_at"] = upd
            elif any(k in key for k in KM_KEYS) and out["odo_km"] is None:
                out["odo_km"] = val
                out["odo_at"] = upd

    # Shape 2: top-level fields seen on a few plans
    if out["hours"] is None:
        for f in ("engine_hours", "hours_worked", "ignition_hours"):
            v = _coerce_float(state.get(f))
            if v is not None:
                out["hours"] = v
                out["hours_at"] = state.get("last_update") or state.get("updated")
                break
    if out["odo_km"] is None:
        for f in ("odometer", "odo_km", "mileage", "distance"):
            v = _coerce_float(state.get(f))
            if v is not None:
                out["odo_km"] = v
                out["odo_at"] = state.get("last_update") or state.get("updated")
                break

    # Shape 3: gps-attached odometer
    gps = state.get("gps") if isinstance(state.get("gps"), dict) else {}
    if out["odo_km"] is None:
        v = _coerce_float(gps.get("odometer") or gps.get("mileage"))
        if v is not None:
            out["odo_km"] = v
            out["odo_at"] = gps.get("updated") or state.get("last_update")
    return out


def _parse_counter_list_response(data: dict) -> dict[int, dict]:
    """Parse `/v2/tracker/counter/list` response into {tracker_id: {hours, hours_at, odo_km, odo_at}}.
    Handles two known shapes:
      A) {"counters": [{tracker_id, type, value, update_time}, ...]}
      B) {"counter_aggregates": [{tracker_id, values:[{type, value, update_time}]}, ...]}
    """
    out: dict[int, dict] = {}

    def upsert(tid_raw: Any, key: str, val: float | None, when: Any):
        try:
            tid = int(tid_raw)
        except (TypeError, ValueError):
            return
        slot = out.setdefault(tid, {"hours": None, "hours_at": None, "odo_km": None, "odo_at": None})
        if any(h in key for h in HOURS_KEYS) and slot["hours"] is None and val is not None:
            slot["hours"] = val
            slot["hours_at"] = when
        elif any(k in key for k in KM_KEYS) and slot["odo_km"] is None and val is not None:
            slot["odo_km"] = val
            slot["odo_at"] = when

    flat = data.get("counters")
    if isinstance(flat, list):
        for c in flat:
            if not isinstance(c, dict):
                continue
            key = _normalize_counter_key(c)
            val = _coerce_float(c.get("value") if "value" in c else c.get("current_value"))
            when = c.get("update_time") or c.get("updated_at") or c.get("time")
            upsert(c.get("tracker_id"), key, val, when)

    agg = data.get("counter_aggregates")
    if isinstance(agg, list):
        for row in agg:
            if not isinstance(row, dict):
                continue
            tid = row.get("tracker_id") or row.get("id")
            for v in row.get("values") or []:
                if not isinstance(v, dict):
                    continue
                key = _normalize_counter_key(v)
                val = _coerce_float(v.get("value") if "value" in v else v.get("current_value"))
                when = v.get("update_time") or v.get("updated_at") or v.get("time")
                upsert(tid, key, val, when)
    return out


# ─────────────────────── Schedule recompute ───────────────────────

async def _recompute_schedules_for_asset(asset: dict) -> int:
    from asset_service import _compute_next_due  # local import to avoid cycle
    n = 0
    async for s in db.asset_service_schedules.find(
        {"asset_id": asset["id"], "deleted_at": None, "status": "active"},
    ):
        nd = _compute_next_due(s, asset)
        await db.asset_service_schedules.update_one(
            {"id": s["id"]},
            {"$set": {
                "next_due_value": nd["next_due_value"],
                "next_due_at": nd["next_due_at"],
                "status_cached": nd["status"],
                "updated_at": now_iso(),
            }},
        )
        n += 1
    return n


# ─────────────────────── Main sync routine ───────────────────────

async def _sync_org(org_id: str) -> dict:
    """Sync every Navixy-linked asset in one org. Idempotent.

    Strategy (handles plan variance gracefully):
      1) Per-tracker `POST /v2/tracker/counter/read` for type=engine_hours and
         type=odometer — this is the documented Navixy counter endpoint and
         returns either `{value:{current_value, …}}` or just the counter
         definition when telemetry hasn't populated the value yet.
      2) Fallback: `POST /v2/tracker/get_states` for any tracker whose
         counters weren't returned above, in case the plan embeds them in
         state objects.
    """
    cfg_doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "navixy"})
    if not cfg_doc or cfg_doc.get("status") != "connected":
        return {"org_id": org_id, "updated": 0, "skipped": 0, "errors": 0, "note": "navixy_not_connected"}

    cfg = cfg_doc.get("config") or {}
    base = (cfg.get("api_base_url") or "").rstrip("/")
    h = cfg.get("session_hash")
    if not base or not h:
        return {"org_id": org_id, "updated": 0, "skipped": 0, "errors": 0, "note": "missing_base_or_hash"}

    assets: list[dict] = []
    async for a in db.assets.find(
        {"org_id": org_id, "navixy_device_id": {"$ne": None}, "deleted_at": None},
        {"_id": 0, "id": 1, "navixy_device_id": 1, "hours_meter": 1, "odo_km": 1,
         "hours_meter_source": 1, "odo_km_source": 1, "workspace_id": 1, "kind": 1,
         "asset_type": 1},
    ):
        assets.append(a)
    if not assets:
        return {"org_id": org_id, "updated": 0, "skipped": 0, "errors": 0}

    def _val_from_counter(payload: dict) -> tuple[float | None, str | None]:
        """Pull (value, updated_at) from a `counter/read` response."""
        v = payload.get("value") if isinstance(payload, dict) else None
        if not isinstance(v, dict):
            return (None, None)
        for k in ("current_value", "value", "last_value", "reading"):
            if k in v:
                val = _coerce_float(v[k])
                if val is not None:
                    when = v.get("current_value_updated") or v.get("updated") or v.get("update_time")
                    return (val, when)
        return (None, None)

    counters_by_tid: dict[int, dict] = {}
    errors = 0
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            # Pass 1 — counter/read for both types per tracker.
            for a in assets:
                tid = int(a["navixy_device_id"])
                slot = counters_by_tid.setdefault(tid, {
                    "hours": None, "hours_at": None, "odo_km": None, "odo_at": None,
                })
                try:
                    rh = await c.post(f"{base}/v2/tracker/counter/read",
                                      json={"hash": h, "tracker_id": tid, "type": "engine_hours"})
                    if rh.status_code < 400:
                        v, when = _val_from_counter(rh.json() or {})
                        if v is not None:
                            slot["hours"], slot["hours_at"] = v, when
                except (httpx.HTTPError, ValueError):
                    errors += 1
                try:
                    ro = await c.post(f"{base}/v2/tracker/counter/read",
                                      json={"hash": h, "tracker_id": tid, "type": "odometer"})
                    if ro.status_code < 400:
                        v, when = _val_from_counter(ro.json() or {})
                        if v is not None:
                            slot["odo_km"], slot["odo_at"] = v, when
                except (httpx.HTTPError, ValueError):
                    errors += 1
                await asyncio.sleep(0)  # cooperative yield — be a polite client

            # Pass 2 — get_states bulk fallback for any tracker still missing both.
            missing = [int(a["navixy_device_id"]) for a in assets
                       if not counters_by_tid.get(int(a["navixy_device_id"]), {}).get("hours")
                       and not counters_by_tid.get(int(a["navixy_device_id"]), {}).get("odo_km")]
            if missing:
                try:
                    rs = await c.post(f"{base}/v2/tracker/get_states",
                                      json={"hash": h, "trackers": missing, "allow_not_exist": True})
                    if rs.status_code < 400:
                        rs_data = rs.json() or {}
                        states_raw = rs_data.get("states") if isinstance(rs_data, dict) else None
                        if isinstance(states_raw, dict):
                            for k, v in states_raw.items():
                                try:
                                    tid = int(k)
                                except (TypeError, ValueError):
                                    continue
                                extracted = _extract_counters_from_state(v)
                                slot = counters_by_tid.setdefault(tid, {
                                    "hours": None, "hours_at": None, "odo_km": None, "odo_at": None,
                                })
                                for f in ("hours", "hours_at", "odo_km", "odo_at"):
                                    if slot.get(f) is None and extracted.get(f) is not None:
                                        slot[f] = extracted[f]
                except (httpx.HTTPError, ValueError) as e:
                    log.info("get_states fallback errored (%s)", e)
    except Exception as e:
        log.warning("navixy sync transport error for org=%s: %s", org_id, e)
        return {"org_id": org_id, "updated": 0, "skipped": 0, "errors": len(assets), "note": str(e)[:200]}

    updated = 0
    skipped = 0
    ts = now_iso()
    for a in assets:
        tid = int(a["navixy_device_id"])
        c = counters_by_tid.get(tid) or {}
        patch: dict = {}
        if c.get("hours") is not None:
            patch["hours_meter"] = c["hours"]
            patch["hours_meter_updated_at"] = c.get("hours_at") or ts
            patch["hours_meter_source"] = "navixy"
        if c.get("odo_km") is not None:
            patch["odo_km"] = c["odo_km"]
            patch["odo_km_updated_at"] = c.get("odo_at") or ts
            patch["odo_km_source"] = "navixy"
        if not patch:
            skipped += 1
            continue
        patch["updated_at"] = ts
        await db.assets.update_one({"id": a["id"]}, {"$set": patch})
        a.update(patch)
        await _recompute_schedules_for_asset(a)
        updated += 1

    return {"org_id": org_id, "updated": updated, "skipped": skipped,
            "errors": errors, "devices": len(assets),
            "note": ("upstream_returned_no_counter_values"
                     if updated == 0 and skipped == len(assets) else None)}


async def sync_navixy_counters() -> list[dict]:
    """Top-level scheduler entry — syncs every org with a connected Navixy integration."""
    if _LOCK.locked():
        log.info("navixy_sync skipped — another run is in progress")
        return [{"note": "already_running"}]
    async with _LOCK:
        results: list[dict] = []
        async for cfg in db.integration_configs.find(
            {"kind": "navixy", "status": "connected"}, {"_id": 0, "org_id": 1},
        ):
            r = await _sync_org(cfg["org_id"])
            results.append(r)
            log.info("navixy_sync org=%s updated=%d skipped=%d errors=%d devices=%s",
                     r["org_id"], r["updated"], r["skipped"], r["errors"], r.get("devices"))
        return results


async def sync_single_asset_now(asset: dict) -> dict:
    """Eager day-one helper — pull counters for one asset without waiting for the cron."""
    org_id = asset.get("org_id")
    if not org_id or not asset.get("navixy_device_id"):
        return {"updated": 0, "skipped": 1}
    cfg_doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "navixy"})
    if not cfg_doc or cfg_doc.get("status") != "connected":
        return {"updated": 0, "skipped": 1, "note": "navixy_not_connected"}
    cfg = cfg_doc.get("config") or {}
    base = (cfg.get("api_base_url") or "").rstrip("/")
    h = cfg.get("session_hash")
    if not base or not h:
        return {"updated": 0, "skipped": 1, "note": "missing_base_or_hash"}
    tid = int(asset["navixy_device_id"])
    counters: dict = {}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            try:
                r = await c.post(f"{base}/v2/tracker/counter/list",
                                 json={"hash": h, "trackers": [tid]})
                if r.status_code < 400:
                    counters = _parse_counter_list_response(r.json() or {}).get(tid, {})
            except (httpx.HTTPError, ValueError):
                pass
            if not counters:
                rs = await c.post(f"{base}/v2/tracker/get_states",
                                  json={"hash": h, "trackers": [tid], "allow_not_exist": True})
                rs_data = rs.json() or {}
                states_raw = rs_data.get("states") if isinstance(rs_data, dict) else None
                if isinstance(states_raw, dict):
                    v = states_raw.get(str(tid)) or states_raw.get(tid)
                    if isinstance(v, dict):
                        counters = _extract_counters_from_state(v)
                elif isinstance(states_raw, list):
                    for s in states_raw:
                        if str(s.get("source_id") or s.get("tracker_id")) == str(tid):
                            counters = _extract_counters_from_state(s)
                            break
    except Exception as e:
        return {"updated": 0, "skipped": 1, "note": f"transport_error: {e}"}

    patch: dict = {}
    ts = now_iso()
    if counters.get("hours") is not None:
        patch["hours_meter"] = counters["hours"]
        patch["hours_meter_updated_at"] = counters.get("hours_at") or ts
        patch["hours_meter_source"] = "navixy"
    if counters.get("odo_km") is not None:
        patch["odo_km"] = counters["odo_km"]
        patch["odo_km_updated_at"] = counters.get("odo_at") or ts
        patch["odo_km_source"] = "navixy"
    if not patch:
        return {"updated": 0, "skipped": 1}
    patch["updated_at"] = ts
    await db.assets.update_one({"id": asset["id"]}, {"$set": patch})
    asset.update(patch)
    await _recompute_schedules_for_asset(asset)
    return {"updated": 1, "skipped": 0}


# ─────────────────────── HTTP endpoints ───────────────────────

@router.post("/navixy/sync-counters")
async def http_sync_now(user: dict = Depends(get_current_user)):
    """Admin-only on-demand sync trigger."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    r = await _sync_org(user["org_id"])
    return r
