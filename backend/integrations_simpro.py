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
    company_id = cfg.get("company_id")
    if not token:
        raise HTTPException(400, "No access token — click Get Token first.")
    if not company_id:
        raise HTTPException(400, "company_id required.")
    url = f"{cfg['api_base_url'].rstrip('/')}/api/v1.0/companies/{company_id}/employees/"
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    except Exception as e:
        raise HTTPException(502, f"Simpro unreachable: {e}")
    if r.status_code != 200:
        msg = r.text[:200]
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "simpro"},
            {"$set": {"status": "error", "last_error": msg, "updated_at": now_iso()}},
        )
        raise HTTPException(400, f"Simpro test failed: HTTP {r.status_code} {msg}")
    try:
        staff = r.json()
        if not isinstance(staff, list):
            staff = staff.get("data") or []
    except Exception:
        staff = []
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(),
                  "last_error": None, "staff_count": len(staff),
                  "staff_cache": staff[:200],
                  "staff_cached_at": now_iso(), "updated_at": now_iso()}},
    )
    return {"staff_count": len(staff), "tested_at": now_iso()}


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
        })
    return {"count": len(out), "staff": out, "cached_at": doc.get("staff_cached_at")}
