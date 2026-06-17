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

Kind = Literal["simpro", "microsoft365", "textmagic", "navixy"]
ALL_KINDS: list[Kind] = ["simpro", "microsoft365", "textmagic", "navixy"]


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
                st = await c.post(f"{base}/v2/tracker/get_states", json={"hash": h, "trackers": ids})
                st_data = st.json() or {}
                states_raw = st_data.get("states") if isinstance(st_data, dict) else []
                for s in (states_raw or []):
                    if isinstance(s, dict):
                        states[s.get("source_id")] = s
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
        gps = s.get("gps") if isinstance(s.get("gps"), dict) else {}
        src = t.get("source") if isinstance(t.get("source"), dict) else {}
        out.append({
            "id": tid,
            "label": t.get("label") or t.get("clone_label") or "Vehicle",
            "plate": src.get("phone"),
            "lat": gps.get("lat"),
            "lng": gps.get("lng"),
            "speed_kph": gps.get("speed"),
            "last_seen": s.get("last_update") or s.get("connection_status"),
            "status": "online" if s.get("connection_status") == "active" else "offline",
            "address": s.get("address"),
            "tags": [tag_lookup[tid_] for tid_ in v_tag_ids if tid_ in tag_lookup],
        })
    return {"count": len(out), "total": len(trackers), "vehicles": out,
            "fetched_at": now_iso(), "filter_tag_ids": sorted(selected_tag_ids)}
