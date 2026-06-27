"""Simpro staff + jobs integration. Uses a static Simpro API token (Bearer)."""
from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from auth import require_roles, get_current_user
from db import db
from models import now_iso, new_id

log = logging.getLogger("paneltec.simpro")
router = APIRouter(prefix="/integrations/simpro", tags=["integrations-simpro"])

DEFAULT_BASE = "https://demo.simprosuite.com"


async def _cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "simpro"})
    if not doc or not doc.get("config"):
        raise HTTPException(400, "Simpro not configured")
    return doc["config"]


def _require(cfg: dict, *keys: str) -> None:
    missing = [k for k in keys if not cfg.get(k)]
    if missing:
        raise HTTPException(400, f"Missing required fields: {', '.join(missing)}")


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


# ---------- Companies picker ----------

@router.get("/companies")
async def simpro_companies(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    _require(cfg, "api_base_url", "api_token")
    url = f"{cfg['api_base_url'].rstrip('/')}/api/v1.0/companies/"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, headers=_auth_headers(cfg["api_token"]))
    except Exception as e:
        raise HTTPException(502, f"Simpro unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(400, f"Simpro list failed: HTTP {r.status_code} {r.text[:200]}")
    try:
        data = r.json()
    except Exception:
        data = []
    if not isinstance(data, list):
        data = data.get("data") or []
    out = []
    for c in data:
        if not isinstance(c, dict):
            continue
        out.append({
            "id": c.get("ID") or c.get("id"),
            "name": c.get("Name") or c.get("name"),
            "country": (c.get("Country") if isinstance(c.get("Country"), str)
                        else (c.get("Country") or {}).get("Name") if isinstance(c.get("Country"), dict) else None),
        })
    return {"count": len(out), "companies": out}


# ---------- Test connection ----------

@router.post("/test-connection")
async def simpro_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    _require(cfg, "api_base_url", "api_token", "company_id")
    base = cfg["api_base_url"].rstrip("/")
    url = f"{base}/api/v1.0/companies/{cfg['company_id']}/info/"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, headers=_auth_headers(cfg["api_token"]))
    except Exception as e:
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "simpro"},
            {"$set": {"status": "error", "last_error": f"Unreachable: {e}", "updated_at": now_iso()}},
        )
        raise HTTPException(502, f"Simpro unreachable: {e}")
    if r.status_code != 200:
        msg = f"HTTP {r.status_code} {r.text[:200]}"
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "simpro"},
            {"$set": {"status": "error", "last_error": msg, "updated_at": now_iso()}},
        )
        if r.status_code == 404:
            raise HTTPException(400, "Company does not exist — tap 'List' to pick a valid Company ID.")
        raise HTTPException(400, f"Simpro test failed: {msg}")
    try:
        data = r.json()
    except Exception:
        data = {}
    if isinstance(data, list) and data:
        data = data[0]
    name = data.get("Name") or data.get("name") if isinstance(data, dict) else None
    country = None
    if isinstance(data, dict):
        country_raw = data.get("Country")
        if isinstance(country_raw, str):
            country = country_raw
        elif isinstance(country_raw, dict):
            country = country_raw.get("Name")
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(),
                  "last_error": None,
                  "company_name": name, "company_country": country,
                  "updated_at": now_iso()}},
    )
    return {"ok": True, "company_name": name, "country": country, "tested_at": now_iso()}


# ---------- Staff sync ----------

def _custom_fields_map(s: dict) -> dict:
    out: dict = {}
    raw = s.get("CustomFields") or s.get("customFields") or []
    if isinstance(raw, list):
        for cf in raw:
            if not isinstance(cf, dict):
                continue
            field = cf.get("CustomField") or cf.get("customField") or {}
            name = (field.get("Name") if isinstance(field, dict) else None) or cf.get("Name") or cf.get("name")
            value = cf.get("Value") or cf.get("value")
            if name:
                out[str(name)] = value
    elif isinstance(raw, dict):
        for k, v in raw.items():
            out[str(k)] = v
    return out


def _normalise_employee(s: dict) -> dict:
    name = s.get("Name") or " ".join(filter(None, [s.get("GivenName"), s.get("FamilyName")])) or s.get("name")
    position = None
    pos_raw = s.get("Position")
    if isinstance(pos_raw, str):
        position = pos_raw
    elif isinstance(pos_raw, dict):
        position = pos_raw.get("Name")
    return {
        "id": s.get("ID") or s.get("id"),
        "name": name,
        "email": s.get("Email") or s.get("email"),
        "phone": s.get("Phone") or s.get("phone"),
        "position": position,
        "role": s.get("Type") or s.get("role"),
        "active": s.get("Active", True) if "Active" in s else s.get("active", True),
        "custom_fields": _custom_fields_map(s),
    }


@router.get("/staff")
async def simpro_staff(user: dict = Depends(get_current_user)):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "simpro"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Simpro not connected")
    cfg = doc.get("config") or {}
    _require(cfg, "api_base_url", "api_token", "company_id")

    cached_at = doc.get("staff_cached_at")
    is_stale = True
    if cached_at:
        try:
            ts = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
            is_stale = (datetime.now(timezone.utc) - ts) > timedelta(minutes=5)
        except Exception:
            pass

    raw_staff = doc.get("staff_cache") or []
    if is_stale:
        url = f"{cfg['api_base_url'].rstrip('/')}/api/v1.0/companies/{cfg['company_id']}/employees/"
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(url, headers=_auth_headers(cfg["api_token"]))
            if r.status_code == 200:
                fresh = r.json()
                if not isinstance(fresh, list):
                    fresh = fresh.get("data") or []
                raw_staff = fresh
                await db.integration_configs.update_one(
                    {"org_id": user["org_id"], "kind": "simpro"},
                    {"$set": {"staff_cache": fresh[:500], "staff_count": len(fresh),
                              "staff_cached_at": now_iso(), "updated_at": now_iso()}},
                )
        except Exception:
            pass  # serve stale cache

    all_staff = [_normalise_employee(s) for s in raw_staff if isinstance(s, dict)]

    # Primary filter: staff_custom_field / staff_field_value
    filter_field = (cfg.get("staff_custom_field") or "").strip()
    filter_value = (cfg.get("staff_field_value") or "").strip()
    primary = all_staff
    if filter_field and filter_value:
        ff_lc = filter_field.lower()
        fv_lc = filter_value.lower()
        primary = [m for m in all_staff
                   if any(k.lower() == ff_lc and str(v).lower() == fv_lc
                          for k, v in (m.get("custom_fields") or {}).items())]

    # Fallback filter: position_filter (only if primary returned nothing)
    used_fallback = False
    position_filter = cfg.get("position_filter") or []
    if not primary and isinstance(position_filter, list) and position_filter:
        needles = [str(p).strip().lower() for p in position_filter if str(p).strip()]
        primary = [m for m in all_staff
                   if m.get("position") and any(n in m["position"].lower() for n in needles)]
        used_fallback = bool(needles)

    return {
        "count": len(primary),
        "staff": primary,
        "cached_at": doc.get("staff_cached_at"),
        "filtered_by": ({"field": filter_field, "value": filter_value}
                        if (filter_field and filter_value and not used_fallback) else None),
        "fallback_used": used_fallback,
        "position_filter": position_filter if used_fallback else None,
    }


# ---------- Jobs sync ----------

async def _fetch_jobs_page(client: httpx.AsyncClient, url: str, token: str) -> list:
    r = await client.get(url, headers=_auth_headers(token))
    if r.status_code != 200:
        raise HTTPException(400, f"Simpro jobs fetch failed: HTTP {r.status_code} {r.text[:200]}")
    data = r.json()
    if not isinstance(data, list):
        data = data.get("data") or []
    return data


def _job_status_bucket(stage: Optional[str]) -> str:
    if not stage:
        return "unknown"
    s = stage.lower()
    if any(k in s for k in ["complete", "archive", "invoice"]):
        return "completed"
    return "active"


@router.post("/sync-jobs")
async def simpro_sync_jobs(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    _require(cfg, "api_base_url", "api_token", "company_id")
    history_days = int(cfg.get("completed_jobs_history_days") or 30)
    history_days = max(7, min(365, history_days))
    cutoff = datetime.now(timezone.utc) - timedelta(days=history_days)
    base = cfg["api_base_url"].rstrip("/")
    url = f"{base}/api/v1.0/companies/{cfg['company_id']}/jobs/"
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            jobs = await _fetch_jobs_page(c, url, cfg["api_token"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Simpro unreachable: {e}")

    synced = 0
    completed_recent = 0
    for j in jobs:
        if not isinstance(j, dict):
            continue
        jid = j.get("ID") or j.get("id")
        if jid is None:
            continue
        stage = (j.get("Stage") if isinstance(j.get("Stage"), str)
                 else (j.get("Stage") or {}).get("Name") if isinstance(j.get("Stage"), dict) else None)
        bucket = _job_status_bucket(stage)
        date_completed_raw = j.get("DateModified") or j.get("DateIssued")
        if bucket == "completed" and date_completed_raw:
            try:
                ts = datetime.fromisoformat(str(date_completed_raw).replace("Z", "+00:00"))
                if ts < cutoff:
                    continue
                completed_recent += 1
            except Exception:
                pass
        doc = {
            "org_id": user["org_id"],
            "company_id": cfg["company_id"],
            "simpro_job_id": jid,
            "name": j.get("Name") or j.get("Description"),
            "stage": stage,
            "status_bucket": bucket,
            "site_name": (j.get("Site") or {}).get("Name") if isinstance(j.get("Site"), dict) else None,
            "customer_name": (j.get("Customer") or {}).get("CompanyName") if isinstance(j.get("Customer"), dict) else None,
            "date_modified": date_completed_raw,
            "synced_at": now_iso(),
        }
        await db.simpro_jobs.update_one(
            {"org_id": user["org_id"], "simpro_job_id": jid},
            {"$set": doc, "$setOnInsert": {"id": new_id(), "created_at": now_iso()}},
            upsert=True,
        )
        synced += 1

    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"$set": {"last_sync_at": now_iso(), "last_sync_count": synced, "updated_at": now_iso()}},
    )
    return {"synced": synced, "completed_recent": completed_recent, "synced_at": now_iso()}


# ---------- Connect: save + test + first sync ----------

@router.post("/connect")
async def simpro_connect(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    # Test first; if it passes, run a job sync.
    await simpro_test(user=user)  # raises if it fails
    try:
        result = await simpro_sync_jobs(user=user)
    except HTTPException as e:
        # Connection is OK but sync failed — return partial success
        return {"ok": True, "connected": True, "sync_error": e.detail, "tested_at": now_iso()}
    return {"ok": True, "connected": True, **result}
