"""Integrations admin — per-org config for Simpro / M365 / TextMagic / Navixy.

Phase A: Navixy is real (live HTTP). The other three are placeholders so the
existing Integrations UI keeps working.
"""
from __future__ import annotations
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user, require_roles
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.integrations")
router = APIRouter(prefix="/integrations", tags=["integrations"])

Kind = Literal["simpro", "microsoft365", "textmagic", "navixy", "google_maps"]
ALL_KINDS: list[Kind] = ["simpro", "microsoft365", "textmagic", "navixy", "google_maps"]


class NavixyConfig(BaseModel):
    api_base_url: str = Field(default="https://api.us.navixy.com")
    account_id: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    session_hash: Optional[str] = None
    poll_seconds: int = Field(default=30, ge=10, le=600)
    auto_poll: bool = True


def _last4(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return f"••••{value[-4:]}" if len(value) > 4 else "••••"


def _mask(kind: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(cfg)
    if kind == "navixy":
        if out.get("password"):
            out["password"] = _last4(out["password"])
        if out.get("session_hash"):
            out["session_hash"] = _last4(out["session_hash"])
    elif kind == "google_maps":
        if out.get("api_key"):
            out["api_key"] = _last4(out["api_key"])
    return out


async def _get_or_default(org_id: str, kind: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": kind}, {"_id": 0})
    if doc:
        return doc
    return {
        "id": None, "org_id": org_id, "kind": kind,
        "config": {} if kind != "navixy" else NavixyConfig().model_dump(),
        "status": "not_connected", "last_tested_at": None,
        "last_error": None, "created_at": None, "updated_at": None,
    }


@router.get("")
async def list_integrations(user: dict = Depends(get_current_user)):
    out = []
    for kind in ALL_KINDS:
        doc = await _get_or_default(user["org_id"], kind)
        out.append({
            "kind": kind,
            "status": doc.get("status", "not_connected"),
            "last_tested_at": doc.get("last_tested_at"),
            "last_error": doc.get("last_error"),
        })
    return out


@router.get("/{kind}")
async def get_integration(kind: Kind, user: dict = Depends(get_current_user)):
    doc = await _get_or_default(user["org_id"], kind)
    doc["config"] = _mask(kind, doc.get("config") or {})
    return doc


@router.put("/{kind}")
async def put_integration(kind: Kind, body: dict, user: dict = Depends(require_roles("admin", "hseq_lead"))):
    if kind == "navixy":
        # Merge with existing so masked secrets coming back from the UI are not wiped
        existing = (await db.integration_configs.find_one({"org_id": user["org_id"], "kind": kind})) or {}
        prev = existing.get("config") or {}
        incoming = body or {}
        for secret_key in ("password", "session_hash"):
            v = incoming.get(secret_key)
            if v is None:
                incoming[secret_key] = prev.get(secret_key)
            elif isinstance(v, str) and (v.startswith("••••") or v.startswith("****") or v.strip() == ""):
                log.info("navixy PUT: keeping stored %s (incoming was masked/empty)", secret_key)
                incoming[secret_key] = prev.get(secret_key)
            else:
                log.info("navixy PUT: updating %s (new value, len=%d)", secret_key, len(v))
        config = NavixyConfig(**{**prev, **incoming}).model_dump()
    elif kind == "google_maps":
        existing = (await db.integration_configs.find_one({"org_id": user["org_id"], "kind": kind})) or {}
        prev = existing.get("config") or {}
        incoming = body or {}
        v = incoming.get("api_key")
        if v is None or (isinstance(v, str) and (v.startswith("••••") or v.startswith("****") or v.strip() == "")):
            incoming["api_key"] = prev.get("api_key")
        config = {"api_key": incoming.get("api_key")}
    else:
        config = body or {}

    doc = {
        "org_id": user["org_id"], "kind": kind, "config": config,
        "updated_at": now_iso(),
    }
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": kind},
        {"$set": doc, "$setOnInsert": {"id": new_id(), "created_at": now_iso(), "status": "not_connected"}},
        upsert=True,
    )
    saved = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": kind}, {"_id": 0})
    saved["config"] = _mask(kind, saved.get("config") or {})
    return saved


# ---------- Navixy live endpoints ----------

async def _navixy_cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "navixy"})
    if not doc or not doc.get("config"):
        raise HTTPException(400, "Navixy not configured")
    return doc["config"]


@router.post("/navixy/get-hash")
async def navixy_get_hash(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _navixy_cfg(user["org_id"])
    if not cfg.get("email") or not cfg.get("password"):
        raise HTTPException(400, "Email and password are required — save them first.")
    url = f"{cfg['api_base_url'].rstrip('/')}/v2/user/auth"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, json={"login": cfg["email"], "password": cfg["password"]})
    except Exception as e:
        raise HTTPException(502, f"Navixy unreachable: {e}")
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if not data.get("success") or not data.get("hash"):
        msg = data.get("status", {}).get("description") or data.get("description") or r.text[:200]
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "navixy"},
            {"$set": {"status": "error", "last_error": f"Auth failed: {msg}", "updated_at": now_iso()}},
        )
        raise HTTPException(400, f"Navixy auth failed: {msg}")
    new_hash = data["hash"]
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "navixy"},
        {"$set": {"config.session_hash": new_hash, "last_error": None, "updated_at": now_iso()}},
    )
    return {"hash_last4": _last4(new_hash), "fetched_at": now_iso()}


@router.post("/navixy/test-connection")
async def navixy_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _navixy_cfg(user["org_id"])
    h = cfg.get("session_hash")
    if not h:
        raise HTTPException(400, "No session hash — click Get Hash first.")
    url = f"{cfg['api_base_url'].rstrip('/')}/v2/tracker/list"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, json={"hash": h})
    except Exception as e:
        raise HTTPException(502, f"Navixy unreachable: {e}")
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if not data.get("success"):
        msg = (data.get("status") or {}).get("description") or "Unknown error"
        if "hash" in msg.lower():
            raise HTTPException(400, "Hash invalid — click Get Hash to refresh.")
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "navixy"},
            {"$set": {"status": "error", "last_error": msg, "updated_at": now_iso()}},
        )
        raise HTTPException(400, msg)
    trackers = data.get("list") or []
    sample = [{"id": t.get("id"), "label": t.get("label"), "plate": t.get("source", {}).get("phone")} for t in trackers[:3]]
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "navixy"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(), "last_error": None,
                  "vehicle_count": len(trackers), "vehicles_cache": trackers, "updated_at": now_iso()}},
    )
    return {"vehicle_count": len(trackers), "sample": sample, "tested_at": now_iso()}


@router.get("/navixy/tags")
async def navixy_tags(user: dict = Depends(get_current_user)):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "navixy"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Navixy not connected")
    cfg = doc["config"]
    h = cfg.get("session_hash")
    base = cfg["api_base_url"].rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{base}/v2/tag/list", json={"hash": h})
            data = r.json() or {}
    except Exception as e:
        raise HTTPException(502, f"Navixy unreachable: {e}")
    if not data.get("success"):
        msg = (data.get("status") or {}).get("description") or "tag/list failed"
        if "hash" in msg.lower():
            raise HTTPException(400, "Hash invalid — refresh in Settings → Integrations → Navixy")
        raise HTTPException(400, msg)
    tags = [
        {"id": t.get("id"), "name": t.get("name"), "color": t.get("color")}
        for t in (data.get("list") or []) if t.get("id") is not None
    ]
    return {"tags": tags, "count": len(tags)}


async def _navixy_tracker_tag_map(client: httpx.AsyncClient, base: str, h: str) -> dict:
    """Return {tracker_id: [tag_id, ...]} using POST /v2/tag/tracker/list."""
    try:
        r = await client.post(f"{base}/v2/tag/tracker/list", json={"hash": h})
        data = r.json() or {}
    except Exception:
        return {}
    if not data.get("success"):
        return {}
    out: dict = {}
    # Navixy returns list of {tracker_id, tag_id}
    for row in data.get("list") or []:
        tid = row.get("tracker_id")
        if tid is None:
            continue
        out.setdefault(tid, []).append(row.get("tag_id"))
    return out


import logging
import os

_LOG = logging.getLogger("paneltec.navixy")
_NAVIXY_DEBUG = os.environ.get("NAVIXY_DEBUG", "").lower() in ("1", "true", "yes")


def _extract_position(state: dict) -> dict:
    """Pull lat/lng/speed/last_seen out of a Navixy /v2/tracker/get_states entry.

    Real Navixy v2 shape (verified June 2026):
        {source_id, gps: {location: {lat, lng}, speed, updated, ...},
         last_update, connection_status, movement_status, ...}

    Older / alt-plan shapes also seen in the wild:
        gps.lat/lng                   (very old / niche plans)
        location.lat/lng              (some EU resellers)
        last_position.{lat,lng}       (legacy API)
    Try each in order; use whichever has data.
    """
    if not isinstance(state, dict):
        return {"lat": None, "lng": None, "speed": None, "last_seen": None}

    lat = lng = None
    gps = state.get("gps") if isinstance(state.get("gps"), dict) else {}

    loc = gps.get("location") if isinstance(gps.get("location"), dict) else None
    if isinstance(loc, dict):
        lat, lng = loc.get("lat"), loc.get("lng")
    if lat is None or lng is None:
        # gps.lat/lng (rare flat shape)
        lat = lat if lat is not None else gps.get("lat")
        lng = lng if lng is not None else gps.get("lng")
    if lat is None or lng is None:
        # top-level location.lat/lng
        loc2 = state.get("location") if isinstance(state.get("location"), dict) else None
        if isinstance(loc2, dict):
            lat = lat if lat is not None else loc2.get("lat")
            lng = lng if lng is not None else loc2.get("lng")
    if lat is None or lng is None:
        last_pos = state.get("last_position") if isinstance(state.get("last_position"), dict) else None
        if isinstance(last_pos, dict):
            lat = lat if lat is not None else last_pos.get("lat")
            lng = lng if lng is not None else last_pos.get("lng")

    speed = gps.get("speed") if isinstance(gps, dict) else None
    if speed is None:
        speed = state.get("speed_kph") or state.get("speed")

    last_seen = (gps.get("updated") if isinstance(gps, dict) else None) \
        or state.get("last_update") \
        or state.get("connection_status")

    return {"lat": lat, "lng": lng, "speed": speed, "last_seen": last_seen}


@router.get("/navixy/vehicles")
async def navixy_vehicles(
    tag_ids: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "navixy"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Navixy not connected")
    cfg = doc["config"]
    h = cfg.get("session_hash")
    base = cfg["api_base_url"].rstrip("/")
    selected_tag_ids = set()
    if tag_ids:
        for x in tag_ids.split(","):
            x = x.strip()
            if x.isdigit():
                selected_tag_ids.add(int(x))

    try:
        async with httpx.AsyncClient(timeout=15) as c:
            tr = await c.post(f"{base}/v2/tracker/list", json={"hash": h})
            tr_data = tr.json() or {}
            if not tr_data.get("success", True):
                msg = (tr_data.get("status") or {}).get("description") or "tracker/list failed"
                if "hash" in msg.lower():
                    raise HTTPException(400, "Hash invalid — refresh in Settings → Integrations → Navixy")
                raise HTTPException(400, msg)
            trackers = tr_data.get("list") or []
            trackers = [t for t in trackers if isinstance(t, dict)]
            states = {}
            if trackers:
                ids = [t["id"] for t in trackers if t.get("id")]
                st = await c.post(f"{base}/v2/tracker/get_states",
                                  json={"hash": h, "trackers": ids, "allow_not_exist": True})
                st_data = st.json() or {}
                states_raw = st_data.get("states") if isinstance(st_data, dict) else None
                # Navixy returns `states` as a dict keyed by tracker_id (string).
                # IMPORTANT: each state's inner `source_id` is the *device* id,
                # which is different from the tracker id used in tracker/list —
                # so we MUST key off the outer dict key, not source_id.
                # Older / niche shapes return a list of state objects.
                if isinstance(states_raw, dict):
                    for k, v in states_raw.items():
                        if isinstance(v, dict):
                            try:
                                key = int(k)
                            except (TypeError, ValueError):
                                key = k
                            states[key] = v
                elif isinstance(states_raw, list):
                    for s in states_raw:
                        if isinstance(s, dict) and s.get("source_id") is not None:
                            # In list-shape, source_id IS the tracker id.
                            states[s["source_id"]] = s
                if _NAVIXY_DEBUG:
                    with_pos = sum(
                        1 for s in states.values()
                        if isinstance(s.get("gps"), dict) and isinstance(s["gps"].get("location"), dict)
                        and s["gps"]["location"].get("lat") is not None
                    )
                    _LOG.info("navixy get_states: %d trackers requested → %d states parsed, %d with gps.location",
                              len(ids), len(states), with_pos)
            # Fetch tag/name lookup + per-tracker binding map
            tag_lookup: dict = {}
            try:
                tg = await c.post(f"{base}/v2/tag/list", json={"hash": h})
                for t in (tg.json() or {}).get("list") or []:
                    if isinstance(t, dict):
                        tag_lookup[t.get("id")] = {"id": t.get("id"), "name": t.get("name"), "color": t.get("color")}
            except Exception:
                pass
            binding = await _navixy_tracker_tag_map(c, base, h)
            # Some Navixy plans also return `tag_bindings` inline on each tracker object
            for t in trackers:
                inline = t.get("tag_bindings") or t.get("tags") or []
                if inline and t.get("id") not in binding:
                    extracted = []
                    for x in inline:
                        if isinstance(x, dict):
                            v = x.get("tag_id") if "tag_id" in x else x.get("id")
                            if v is not None:
                                extracted.append(v)
                        elif isinstance(x, (int, str)):
                            extracted.append(int(x) if str(x).isdigit() else x)
                    binding[t["id"]] = extracted
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Navixy unreachable: {e}")

    out = []
    for t in trackers:
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        v_tag_ids = binding.get(tid) or []
        if selected_tag_ids and not (set(v_tag_ids) & selected_tag_ids):
            continue
        s = states.get(tid) if isinstance(states.get(tid), dict) else {}
        pos = _extract_position(s)
        src = t.get("source") if isinstance(t.get("source"), dict) else {}
        out.append({
            "id": tid,
            "label": t.get("label") or t.get("clone_label") or "Vehicle",
            "plate": src.get("phone"),
            "lat": pos["lat"],
            "lng": pos["lng"],
            "speed_kph": pos["speed"],
            "last_seen": pos["last_seen"],
            # Navixy reports connection_status as online/idle/offline/just_registered.
            # Trust it directly — don't recompute from last_seen deltas.
            # Pin colour: "online" + "idle" → green; "offline" → grey; unknown → green.
            "status": ("offline" if s.get("connection_status") == "offline"
                       else "online"),
            "connection_status": s.get("connection_status"),
            "movement_status": s.get("movement_status"),
            "address": s.get("address"),
            "tags": [tag_lookup[tid_] for tid_ in v_tag_ids if tid_ in tag_lookup],
        })
    return {"count": len(out), "total": len(out), "vehicles": out,
            "fetched_at": now_iso(), "filter_tag_ids": sorted(selected_tag_ids)}


# ---------- Google Maps endpoints ----------

@router.post("/google-maps/test-connection")
async def google_maps_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "google_maps"})
    cfg = (doc or {}).get("config") or {}
    key = cfg.get("api_key")
    if not key:
        raise HTTPException(400, "API key not configured")
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as c:
            r = await c.get(f"https://maps.googleapis.com/maps/api/js?key={key}")
    except Exception as e:
        raise HTTPException(502, f"Google Maps unreachable: {e}")
    if r.status_code != 200 or ("InvalidKeyMapError" in r.text or "ApiNotActivatedMapError" in r.text):
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "google_maps"},
            {"$set": {"status": "error",
                      "last_error": f"HTTP {r.status_code}; check key is valid and Maps JavaScript API is enabled",
                      "updated_at": now_iso()}},
        )
        raise HTTPException(400, "Key rejected by Google — make sure Maps JavaScript API is enabled and the key is unrestricted (or whitelisted to this domain).")
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "google_maps"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(),
                  "last_error": None, "updated_at": now_iso()}},
    )
    return {"ok": True, "tested_at": now_iso()}


@router.get("/google-maps/public-key")
async def google_maps_public_key(user: dict = Depends(get_current_user)):
    """Return the cleartext API key for any logged-in user (needed to load Maps JS).
    Returns 404 when not configured/connected, which the frontend treats as a soft 'not set up'.
    """
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "google_maps"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(404, "Google Maps not connected")
    key = (doc.get("config") or {}).get("api_key")
    if not key:
        raise HTTPException(404, "Google Maps key not set")
    return {"api_key": key}
