"""Phase 4.7.3 — Comms Safe Mode.

A single kill-switch that intercepts BOTH email and SMS at the provider
boundary so previews / dev environments can't accidentally fire real
messages at real recipients.

Rules:
  • Env var `COMMS_SAFE_MODE` is the master switch. If env == "on", no
    per-org setting can flip delivery back on.
  • If env != "on" (or unset), the per-org `org_settings.comms_safe_mode`
    decides. Default is "on" (fail safe).
  • When blocked, the payload is preserved in `comms_outbox_blocked`
    so admins can audit what would have been sent.
"""
from __future__ import annotations
import logging, os
from typing import Optional
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.comms_safe_mode")


def env_setting() -> str:
    """Returns "on" | "off" — defaults to "on" when unset (fail safe)."""
    val = (os.environ.get("COMMS_SAFE_MODE") or "on").strip().lower()
    return "on" if val in ("on", "true", "1", "yes") else "off"


def env_is_master_on() -> bool:
    """When True, the env var locks delivery off regardless of per-org setting."""
    return env_setting() == "on"


async def org_setting(org_id: str) -> str:
    """Returns "on" | "off" from org_settings (default "on")."""
    doc = await db.org_settings.find_one({"org_id": org_id}, {"comms_safe_mode": 1}) or {}
    val = (doc.get("comms_safe_mode") or "on").strip().lower()
    return "on" if val in ("on", "true", "1", "yes") else "off"


async def effective_mode(org_id: str) -> str:
    """Master env wins. Otherwise org setting decides."""
    if env_is_master_on():
        return "on"
    return await org_setting(org_id)


async def is_blocked(org_id: str) -> bool:
    return (await effective_mode(org_id)) == "on"


async def record_blocked(
    *, channel: str, org_id: str, to, subject: str = "", body: str = "",
    triggered_by_endpoint: str = "", actor_user_id: Optional[str] = None,
    reason: str = "safe_mode", extra: Optional[dict] = None,
) -> dict:
    """Persist a blocked-comms entry and log it. Returns the inserted doc."""
    if not isinstance(to, list):
        to = [to] if to else []
    doc = {
        "id": new_id(),
        "ts": now_iso(),
        "org_id": org_id,
        "channel": channel,            # "email" | "sms"
        "to": to,
        "subject": subject or "",
        "body": (body or "")[:5000],   # truncate to keep collection lean
        "reason": reason,
        "triggered_by_endpoint": triggered_by_endpoint or "",
        "actor_user_id": actor_user_id,
        "extra": extra or {},
    }
    await db.comms_outbox_blocked.insert_one(dict(doc))
    log.info(
        "comms.safe_mode_blocked channel=%s to=%s subject=%r reason=%s endpoint=%s",
        channel, ",".join(to)[:120], (subject or "")[:80], reason,
        triggered_by_endpoint or "-",
    )
    return doc


# ───── Admin endpoints ───────────────────────────────────────────────
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from auth import get_current_user, require_roles  # noqa: E402

router = APIRouter(prefix="/admin", tags=["admin-comms-safe-mode"])


class SafeModeStatus(BaseModel):
    effective: str
    env_locked: bool
    env_value: str
    org_value: str


@router.get("/comms-safe-mode/status", response_model=SafeModeStatus)
async def get_safe_mode_status(user: dict = Depends(get_current_user)):
    env_val = env_setting()
    org_val = await org_setting(user["org_id"])
    eff = await effective_mode(user["org_id"])
    return SafeModeStatus(
        effective=eff,
        env_locked=env_is_master_on(),
        env_value=env_val,
        org_value=org_val,
    )


class SafeModeUpdate(BaseModel):
    mode: str  # "on" | "off"


@router.patch("/comms-safe-mode")
async def patch_safe_mode(
    body: SafeModeUpdate,
    user: dict = Depends(require_roles("admin")),
):
    if env_is_master_on():
        raise HTTPException(
            423, "COMMS_SAFE_MODE env var is locked ON — contact your operator to lift the env lock before toggling.",
        )
    mode = (body.mode or "").strip().lower()
    if mode not in ("on", "off"):
        raise HTTPException(400, "mode must be 'on' or 'off'")
    await db.org_settings.update_one(
        {"org_id": user["org_id"]},
        {"$set": {"comms_safe_mode": mode, "updated_at": now_iso()}},
        upsert=True,
    )
    log.info("comms.safe_mode_toggled org=%s actor=%s mode=%s",
             user["org_id"], user["id"], mode)
    return {"ok": True, "mode": mode}


@router.get("/comms-outbox-blocked")
async def list_blocked(
    limit: int = Query(200, ge=1, le=1000),
    channel: Optional[str] = Query(None, description="email | sms"),
    user: dict = Depends(get_current_user),
):
    q: dict = {"org_id": user["org_id"]}
    if channel in ("email", "sms"):
        q["channel"] = channel
    docs = await db.comms_outbox_blocked.find(q, {"_id": 0}).sort("ts", -1).to_list(limit)
    return {"items": docs, "count": len(docs)}
