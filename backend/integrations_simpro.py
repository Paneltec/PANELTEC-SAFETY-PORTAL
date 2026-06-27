"""Simpro staff-sync integration. Real HTTP via OAuth2 client_credentials."""
from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_roles, get_current_user
from db import db
from models import now_iso

from integrations import _last4, _mask_preserve  # shared masking helpers

log = logging.getLogger("paneltec.simpro")
router = APIRouter(prefix="/integrations/simpro", tags=["integrations-simpro"])


class SimproConfig(BaseModel):
    api_base_url: str = Field(default="https://demo.simprosuite.com")
    company_id: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    access_token: Optional[str] = None
    token_expires_at: Optional[str] = None  # ISO
    poll_seconds: int = Field(default=900, ge=60, le=86400)


async def _cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "simpro"})
    if not doc or not doc.get("config"):
        raise HTTPException(400, "Simpro not configured")
    return doc["config"]


@router.post("/get-token")
async def simpro_get_token(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    cid = cfg.get("client_id")
    secret = cfg.get("client_secret")
    if not cid or not secret:
        raise HTTPException(400, "client_id and client_secret required — save them first.")
    url = f"{cfg['api_base_url'].rstrip('/')}/oauth2/token"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, data={
                "grant_type": "client_credentials",
                "client_id": cid,
                "client_secret": secret,
            })
    except Exception as e:
        raise HTTPException(502, f"Simpro unreachable: {e}")
    data = {}
    try:
        data = r.json()
    except Exception:
        pass
    if r.status_code != 200 or not data.get("access_token"):
        msg = data.get("error_description") or data.get("error") or r.text[:200]
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "simpro"},
            {"$set": {"status": "error", "last_error": f"Token failed: {msg}", "updated_at": now_iso()}},
        )
        raise HTTPException(400, f"Simpro token failed: {msg}")
    token = data["access_token"]
    expires_in = int(data.get("expires_in", 3600))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"$set": {"config.access_token": token, "config.token_expires_at": expires_at,
                  "last_error": None, "updated_at": now_iso()}},
    )
    return {"access_token_last4": _last4(token), "expires_in": expires_in}


@router.post("/test-connection")
async def simpro_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    token = cfg.get("access_token")
    if not token:
        raise HTTPException(400, "No access token — click Get Token first.")
    company_ids = [c for c in [cfg.get("company_id"), cfg.get("company_id_2")] if c]
    if not company_ids:
        raise HTTPException(400, "At least one Company ID required.")
    base = cfg["api_base_url"].rstrip("/")
    merged: list = []
    per_company: list = []
    seen_ids: set = set()
    async with httpx.AsyncClient(timeout=15) as c:
        for cid in company_ids:
            url = f"{base}/api/v1.0/companies/{cid}/employees/"
            try:
                r = await c.get(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
            except Exception as e:
                per_company.append({"id": cid, "status": "error", "error": str(e), "employee_count": 0})
                continue
            if r.status_code != 200:
                per_company.append({"id": cid, "status": "error",
                                    "error": f"HTTP {r.status_code} {r.text[:120]}",
                                    "employee_count": 0})
                continue
            try:
                staff = r.json()
                if not isinstance(staff, list):
                    staff = staff.get("data") or []
            except Exception:
                staff = []
            for s in staff:
                if isinstance(s, dict):
                    s["__company_id"] = cid
                    eid = s.get("ID") or s.get("id")
                    if eid is not None and eid in seen_ids:
                        continue
                    if eid is not None:
                        seen_ids.add(eid)
                    merged.append(s)
            per_company.append({"id": cid, "status": "ok", "employee_count": len(staff)})

    any_ok = any(p["status"] == "ok" for p in per_company)
    status = "connected" if any_ok else "error"
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"$set": {"status": status, "last_tested_at": now_iso(),
                  "last_error": None if any_ok else "All companies failed",
                  "staff_count": len(merged),
                  "staff_cache": merged[:500],
                  "staff_cached_at": now_iso(),
                  "companies_status": per_company,
                  "updated_at": now_iso()}},
    )
    if not any_ok:
        raise HTTPException(400, f"All companies failed: {per_company}")
    return {"ok": True, "companies": per_company, "merged_count": len(merged), "tested_at": now_iso()}


@router.get("/staff")
async def simpro_staff(user: dict = Depends(get_current_user)):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "simpro"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Simpro not connected")
    cached_at = doc.get("staff_cached_at")
    is_stale = True
    if cached_at:
        try:
            ts = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
            is_stale = (datetime.now(timezone.utc) - ts) > timedelta(minutes=5)
        except Exception:
            pass
    if is_stale:
        # silent re-fetch
        cfg = doc["config"]
        token = cfg.get("access_token")
        company_id = cfg.get("company_id")
        url = f"{cfg['api_base_url'].rstrip('/')}/api/v1.0/companies/{company_id}/employees/"
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
            if r.status_code == 200:
                staff = r.json()
                if not isinstance(staff, list):
                    staff = staff.get("data") or []
                await db.integration_configs.update_one(
                    {"org_id": user["org_id"], "kind": "simpro"},
                    {"$set": {"staff_cache": staff[:200], "staff_count": len(staff),
                              "staff_cached_at": now_iso(), "updated_at": now_iso()}},
                )
                doc["staff_cache"] = staff[:200]
        except Exception:
            pass  # serve stale cache
    out = []
    for s in (doc.get("staff_cache") or []):
        if not isinstance(s, dict):
            continue
        name = s.get("Name") or " ".join(filter(None, [s.get("GivenName"), s.get("FamilyName")])) or s.get("name")
        out.append({
            "id": s.get("ID") or s.get("id"),
            "name": name,
            "email": s.get("Email") or s.get("email"),
            "phone": s.get("Phone") or s.get("phone"),
            "role": s.get("Type") or s.get("role"),
            "active": s.get("Active", True) if "Active" in s else s.get("active", True),
            "company_id": s.get("__company_id") or s.get("company_id"),
            "custom_fields": _custom_fields_map(s),
        })

    cfg = doc.get("config") or {}
    companies_queried = [c for c in [cfg.get("company_id"), cfg.get("company_id_2")] if c]
    filter_field = (cfg.get("staff_custom_field") or "").strip()
    filter_value = (cfg.get("staff_field_value") or "").strip()
    if filter_field and filter_value:
        fv_lc = filter_value.lower()
        ff_lc = filter_field.lower()
        out = [m for m in out
               if any(k.lower() == ff_lc and str(v).lower() == fv_lc
                      for k, v in (m.get("custom_fields") or {}).items())]

    return {"count": len(out), "staff": out, "cached_at": doc.get("staff_cached_at"),
            "companies_queried": companies_queried,
            "filtered_by": {"field": filter_field, "value": filter_value} if (filter_field and filter_value) else None}


def _custom_fields_map(s: dict) -> dict:
    """Best-effort flatten of Simpro's `CustomFields` array into {Name: Value}."""
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
