"""TextMagic SMS integration. Real HTTP."""
from __future__ import annotations
import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_roles, get_current_user
from permissions import require_permission
from db import db
from models import now_iso
# v160.3.9.43 — SEC-003 sweep: decrypt api_key/username on read.
from integrations import hydrate_integration_config

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
    # v160.3.9.43 — SEC-003 sweep: return decrypted config (api_key,
    # username plaintext are needed for the TextMagic X-TM-* auth
    # headers). Ciphertext lives only in Mongo.
    return hydrate_integration_config(doc)


def _auth_headers(cfg: dict) -> dict:
    # v58.13.85 — Defensive strip: even if a stale row has whitespace
    # in the credential values, the httpx header build won't fail.
    # The save-time strip in `integrations.py::_encrypt_secrets_for_storage`
    # handles new writes; this is belt and braces for existing bad rows
    # that were saved before the .85 fix landed.
    return {
        "X-TM-Username": (cfg.get("username") or "").strip(),
        "X-TM-Key": (cfg.get("api_key") or "").strip(),
    }


# ─────────────────────────────────────────────────────────
# v58.13.85 — Centralised SMS boundary. All outbound SMS MUST go
# through `safe_send_sms(...)` so:
#   1. Comms Safe Mode is honoured (previously bypassed by 3 direct
#      httpx callers in asset_service, worker_certifications, and
#      form_assignment_notifier).
#   2. TextMagic API errors are logged consistently.
#   3. A future rate-limit / retry policy can be added in one place.
# Returns {ok: bool, blocked?: bool, message_id?: str, error?: str}
# in the same shape as `integrations_m365.graph_send_mail`.
# ─────────────────────────────────────────────────────────
async def safe_send_sms(
    org_id: str,
    *,
    mobiles: List[str],
    text: str,
    triggered_by_endpoint: str = "",
    actor_user_id: Optional[str] = None,
) -> dict:
    # v58.13.85 — Environment gate FIRST. On preview / dev / test,
    # system-originated SMS (cron reminders, form-assignment notifier,
    # pytest fixtures) are silent no-ops — no comms_outbox_blocked
    # row, no upstream HTTP call. User-initiated SMS (real actor id)
    # still flow through so Safe Mode's audit trail keeps them
    # visible.
    import os as _os
    is_prod = (_os.environ.get("IS_PROD", "false").strip().lower() == "true")
    pytest_running = bool(_os.environ.get("PYTEST_CURRENT_TEST"))
    is_system_source = actor_user_id is None or pytest_running
    if (not is_prod) and is_system_source:
        log.info(
            "safe_send_sms system_source_skipped env=non_prod endpoint=%r "
            "to_n=%d reason=%s",
            triggered_by_endpoint or "-", len(mobiles or []),
            "pytest" if pytest_running else "cron/system",
        )
        return {"ok": True, "skipped": True, "provider": "env_gate"}
    from comms_safe_mode import is_blocked, record_blocked
    if await is_blocked(org_id):
        await record_blocked(
            channel="sms", org_id=org_id, to=list(mobiles or []),
            subject="", body=text or "",
            triggered_by_endpoint=triggered_by_endpoint or "safe_send_sms",
            actor_user_id=actor_user_id,
        )
        return {"ok": True, "blocked": True, "provider": "safe_mode"}
    if not mobiles:
        return {"ok": False, "error": "no_recipients"}
    doc = await db.integration_configs.find_one({"org_id": org_id, "kind": "textmagic"})
    if not doc or doc.get("status") != "connected":
        return {"ok": False, "error": "textmagic_not_connected"}
    cfg = hydrate_integration_config(doc)
    if not cfg.get("username") or not cfg.get("api_key"):
        return {"ok": False, "error": "textmagic_credentials_missing"}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                f"{TM_BASE}/messages",
                headers=_auth_headers(cfg),
                data={"text": text, "phones": ",".join(mobiles)},
            )
    except Exception as e:                             # noqa: BLE001
        log.warning("safe_send_sms network error org=%s err=%s", org_id, e)
        return {"ok": False, "error": f"network: {e}"}
    if r.status_code in (200, 201):
        data = {}
        try:
            data = r.json()
        except Exception:
            pass
        log.info("safe_send_sms org=%s to=%d text_len=%d msg_id=%s endpoint=%s",
                 org_id, len(mobiles), len(text or ""), data.get("id"),
                 triggered_by_endpoint or "-")
        return {"ok": True, "message_id": data.get("id")}
    log.warning("safe_send_sms upstream_error org=%s status=%s body=%r endpoint=%s",
                org_id, r.status_code, r.text[:200], triggered_by_endpoint or "-")
    return {"ok": False, "error": f"HTTP {r.status_code} {r.text[:200]}"}


@router.post("/test-connection")
async def tm_test(user: dict = Depends(require_permission("integrations", "edit"))):
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
async def tm_send(body: SmsSendIn, user: dict = Depends(require_permission("integrations", "edit"))):
    # Phase 4.7.3 — Comms Safe Mode. Block at the boundary BEFORE the
    # TextMagic price check (which would still hit their HTTP API).
    from comms_safe_mode import is_blocked, record_blocked
    if await is_blocked(user["org_id"]):
        await record_blocked(
            channel="sms", org_id=user["org_id"], to=list(body.to),
            subject="", body=body.message,
            triggered_by_endpoint="/integrations/textmagic/send-sms",
            actor_user_id=user.get("id"),
        )
        return {
            "message_id": None, "parts": None, "cost": 0.0,
            "session_id": None, "bulk_id": None,
            "blocked": True, "reason": "comms_safe_mode_on",
        }
    doc = await db.integration_configs.find_one({"org_id": user["org_id"], "kind": "textmagic"})
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "TextMagic not connected")
    # v160.3.9.43 — SEC-003 sweep: hydrate encrypted secrets on read.
    cfg = hydrate_integration_config(doc)
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
