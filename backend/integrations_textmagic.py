"""TextMagic SMS integration. Real HTTP."""
from __future__ import annotations
import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_roles, get_current_user
from db import db
from models import now_iso

log = logging.getLogger("paneltec.textmagic")
router = APIRouter(prefix="/integrations/textmagic", tags=["integrations-textmagic"])

TM_BASE = "https://rest.textmagic.com/api/v2"
MAX_COST_AUD = 5.00


class TextMagicConfig(BaseModel):
    username: Optional[str] = None
    api_key: Optional[str] = None
    default_sender_id: Optional[str] = None
    daily_budget_aud: float = Field(default=10.0, ge=0)


async def _cfg(org_id: str) -> dict:
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "textmagic"})
    if not doc or not doc.get("config"):
        raise HTTPException(400, "TextMagic not configured")
    return doc["config"]


def _auth_headers(cfg: dict) -> dict:
    return {"X-TM-Username": cfg.get("username") or "", "X-TM-Key": cfg.get("api_key") or ""}


@router.post("/test-connection")
async def tm_test(user: dict = Depends(require_roles("admin", "hseq_lead"))):
    cfg = await _cfg(user["org_id"])
    if not cfg.get("username") or not cfg.get("api_key"):
        raise HTTPException(400, "username and api_key required — save them first.")
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{TM_BASE}/user", headers=_auth_headers(cfg))
    except Exception as e:
        raise HTTPException(502, f"TextMagic unreachable: {e}")
    if r.status_code != 200:
        msg = r.text[:200]
        await db.integration_configs.update_one(
            {"org_id": user["org_id"], "kind": "textmagic"},
            {"$set": {"status": "error", "last_error": msg, "updated_at": now_iso()}},
        )
        raise HTTPException(400, f"TextMagic auth failed: HTTP {r.status_code} {msg}")
    data = {}
    try:
        data = r.json()
    except Exception:
        pass
    balance = data.get("balance") or 0
    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "textmagic"},
        {"$set": {"status": "connected", "last_tested_at": now_iso(),
                  "last_error": None, "balance": balance, "currency": data.get("currency", "USD"),
                  "account_name": f"{data.get('firstName', '')} {data.get('lastName', '')}".strip(),
                  "updated_at": now_iso()}},
    )
    return {"balance": balance, "currency": data.get("currency", "USD"),
            "account_name": f"{data.get('firstName', '')} {data.get('lastName', '')}".strip()}


class SmsSendIn(BaseModel):
    to: List[str] = Field(min_length=1)
    message: str = Field(min_length=1)


@router.post("/send-sms")
async def tm_send(body: SmsSendIn, user: dict = Depends(require_roles("admin", "hseq_lead"))):
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "textmagic"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "TextMagic not connected")
    cfg = doc["config"]
    phones = ",".join(body.to)
    sender = cfg.get("default_sender_id")
    # 1. Price-check first
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            est = await c.get(f"{TM_BASE}/messages/price",
                              headers=_auth_headers(cfg),
                              params={"text": body.message, "phones": phones})
    except Exception as e:
        raise HTTPException(502, f"TextMagic unreachable: {e}")
    est_data = {}
    try:
        est_data = est.json()
    except Exception:
        pass
    total_price = float(est_data.get("totalPrice", 0) or 0)
    if total_price > MAX_COST_AUD:
        raise HTTPException(400, f"Estimated cost ${total_price:.2f} exceeds ${MAX_COST_AUD:.2f} safety cap")
    # 2. Send
    payload = {"text": body.message, "phones": phones}
    if sender:
        payload["from"] = sender
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{TM_BASE}/messages", headers=_auth_headers(cfg), data=payload)
    except Exception as e:
        raise HTTPException(502, f"TextMagic unreachable: {e}")
    if r.status_code not in (200, 201):
        msg = r.text[:200]
        raise HTTPException(400, f"TextMagic send failed: HTTP {r.status_code} {msg}")
    data = {}
    try:
        data = r.json()
    except Exception:
        pass
    return {
        "message_id": data.get("id"),
        "parts": est_data.get("parts"),
        "cost": total_price,
        "session_id": data.get("sessionId"),
        "bulk_id": data.get("bulkId"),
    }
