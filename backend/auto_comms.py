"""v58.13.86 — Automated Comms toggle.

Second kill switch, sitting alongside Comms Safe Mode. Where Safe Mode
blocks ALL outbound (manual + automatic) and queues to the blocked
outbox for audit, this switch is finer-grained: it blocks ONLY
system-originated sends (cron reminders, event-triggered notifications,
seed / test-fixture emails) and does so SILENTLY — no blocked outbox
row is written, so the audit UI doesn't fill up with routine cron
noise.

Rules:
  * Env var `AUTO_COMMS_ENABLED` is the master switch. If env == "true",
    per-org toggle is locked ON.
  * If env != "true" (or unset), the per-org
    `org_settings.auto_comms_enabled` decides. Default is False
    (disabled — fail safe). User can flip it ON per-org via the admin
    UI when they want automated flows.

Ordering (in `queue_email_doc` and `safe_send_sms`):
  1. If source == "user_action"           → BYPASS auto-comms gate.
  2. Auto-comms gate                       → skip silently if disabled.
  3. IS_PROD env gate                      → skip system+non-prod.
  4. Comms Safe Mode                       → queue to blocked outbox if ON.
  5. Provider dispatch.
"""
from __future__ import annotations
import logging, os
from db import db
from models import now_iso

log = logging.getLogger("paneltec.auto_comms")


def env_value() -> str:
    """Returns 'true' | 'false' — normalised from env var."""
    raw = (os.environ.get("AUTO_COMMS_ENABLED") or "").strip().lower()
    if raw in ("true", "1", "yes", "on"):
        return "true"
    if raw in ("false", "0", "no", "off"):
        return "false"
    return ""  # env not set — org_settings decides


def env_is_locked() -> bool:
    """When True, the env var forces a value; per-org toggle can't override."""
    return env_value() in ("true", "false")


async def org_setting(org_id: str) -> bool:
    """Returns the per-org `auto_comms_enabled` bool (default False)."""
    doc = await db.org_settings.find_one(
        {"org_id": org_id}, {"auto_comms_enabled": 1},
    ) or {}
    return bool(doc.get("auto_comms_enabled") is True)


async def is_enabled(org_id: str) -> bool:
    """Master env wins. Otherwise org setting decides."""
    ev = env_value()
    if ev == "true":
        return True
    if ev == "false":
        return False
    return await org_setting(org_id)


async def is_disabled(org_id: str) -> bool:
    """Inverse of `is_enabled` — the shape called by the gate."""
    return not await is_enabled(org_id)


# ───── Admin endpoints ───────────────────────────────────────────────
from fastapi import APIRouter, Depends, HTTPException                     # noqa: E402
from pydantic import BaseModel                                            # noqa: E402
from auth import get_current_user                                         # noqa: E402
from permissions import require_permission                                # noqa: E402

router = APIRouter(prefix="/admin", tags=["admin-auto-comms"])


class AutoCommsStatus(BaseModel):
    enabled: bool
    env_locked: bool
    env_value: str  # "true" | "false" | ""
    org_value: bool


@router.get("/auto-comms/status", response_model=AutoCommsStatus)
async def get_auto_comms_status(user: dict = Depends(get_current_user)):
    env_val = env_value()
    org_val = await org_setting(user["org_id"])
    return AutoCommsStatus(
        enabled=(await is_enabled(user["org_id"])),
        env_locked=env_is_locked(),
        env_value=env_val,
        org_value=org_val,
    )


class AutoCommsUpdate(BaseModel):
    enabled: bool


@router.patch("/auto-comms")
async def patch_auto_comms(
    body: AutoCommsUpdate,
    user: dict = Depends(require_permission("notifications", "edit")),
):
    if env_is_locked():
        raise HTTPException(
            423,
            "AUTO_COMMS_ENABLED env var is locked — contact your operator "
            "to lift the env lock before toggling.",
        )
    await db.org_settings.update_one(
        {"org_id": user["org_id"]},
        {"$set": {
            "auto_comms_enabled": bool(body.enabled),
            "updated_at": now_iso(),
        }},
        upsert=True,
    )
    log.info(
        "auto_comms.toggled org=%s actor=%s enabled=%s",
        user["org_id"], user["id"], body.enabled,
    )
    return {"ok": True, "enabled": bool(body.enabled)}
