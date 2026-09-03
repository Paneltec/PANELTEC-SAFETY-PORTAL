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
    # v58.13.85 — Retention. Keep at most 100 rows OR the last 7 days,
    # whichever is more generous. Prevents unbounded growth in preview
    # where the blocked outbox is the primary sink for held sends.
    try:
        from datetime import datetime, timezone, timedelta
        cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        # Delete rows older than 7d AND outside the newest-100 window.
        keep_ids = set()
        async for r in db.comms_outbox_blocked.find(
            {"org_id": org_id}, {"_id": 1},
        ).sort("ts", -1).limit(100):
            keep_ids.add(r["_id"])
        await db.comms_outbox_blocked.delete_many({
            "org_id": org_id,
            "ts": {"$lt": cutoff_iso},
            "_id": {"$nin": list(keep_ids)},
        })
    except Exception:                                  # noqa: BLE001
        # Retention is best-effort — do NOT crash the caller (which
        # is trying to record a blocked send) on a prune failure.
        log.exception("comms_outbox_blocked retention prune failed")
    return doc


# ───── Admin endpoints ───────────────────────────────────────────────
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from auth import get_current_user, require_roles  # noqa: E402
from permissions import require_permission  # v160.3.9.27 — guard migration

from admin_safe_wrapper import safe_admin_endpoint

router = APIRouter(prefix="/admin", tags=["admin-comms-safe-mode"])


class SafeModeStatus(BaseModel):
    effective: str
    env_locked: bool
    env_value: str
    org_value: str
    # v58.13.93 — Count of intercepted-but-not-delivered messages for
    # this org. Renders as a subtle badge on the top-bar pill so the
    # user knows how many blocked comms are waiting for review without
    # opening the admin page. `0` when the outbox is empty (frontend
    # suppresses the badge for `0`).
    blocked_count: int = 0


@router.get("/comms-safe-mode/status", response_model=SafeModeStatus)
async def get_safe_mode_status(user: dict = Depends(get_current_user)):
    env_val = env_setting()
    org_val = await org_setting(user["org_id"])
    eff = await effective_mode(user["org_id"])
    # v58.13.93 — Cheap org-scoped count. `count_documents` with an
    # indexed `org_id` filter is O(index-scan) — fast enough to run on
    # every status probe without caching. Best-effort: if the
    # collection is missing on a fresh install, treat as 0 rather
    # than 500ing the status probe.
    try:
        blocked = await db.comms_outbox_blocked.count_documents(
            {"org_id": user["org_id"]}
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("blocked_count probe failed org=%s: %s", user["org_id"], exc)
        blocked = 0
    return SafeModeStatus(
        effective=eff,
        env_locked=env_is_master_on(),
        env_value=env_val,
        org_value=org_val,
        blocked_count=blocked,
    )


class SafeModeUpdate(BaseModel):
    mode: str  # "on" | "off"


@router.patch("/comms-safe-mode")
@safe_admin_endpoint
async def patch_safe_mode(
    body: SafeModeUpdate,
    # v58.13.90 — Was `require_permission("notifications", "edit")`,
    # which granted the toggle to every admin (and every role whose
    # matrix cell inherits notifications.edit). Now uses the dedicated
    # `comms_safe_mode.edit` token, which is DENIED for every seeded
    # role by default (see permissions.py after ROLE_DEFAULTS). Admins
    # must explicitly grant the override via
    # `db.user_permissions.overrides.comms_safe_mode.edit = true` OR
    # via the Users & Permissions matrix UI. Preview seeds Stephen's
    # override on startup (see `server.py::on_startup`).
    user: dict = Depends(require_permission("comms_safe_mode", "edit")),
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


# v58.13.90 — Who currently holds the `comms_safe_mode.edit` override?
# Any authed user in the org can call this — the answer helps a
# non-permission-holder find the right person to contact. Returns
# minimal identity fields (id, name, email) — never role/perms/session
# data. Silent-empty if the collection is missing so the frontend
# doesn't 500 on a fresh install.
@router.get("/comms-safe-mode/who-can-toggle")
async def who_can_toggle(user: dict = Depends(get_current_user)):
    holders = []
    try:
        # Overrides doc shape: `{user_id, org_id, overrides: {resource: {action: bool}}}`
        cur = db.user_permissions.find(
            {"org_id": user["org_id"], "overrides.comms_safe_mode.edit": True},
            {"_id": 0, "user_id": 1},
        )
        user_ids = [d["user_id"] async for d in cur]
        if user_ids:
            u_cur = db.users.find(
                {"id": {"$in": user_ids}, "org_id": user["org_id"], "deleted_at": None},
                {"_id": 0, "id": 1, "name": 1, "email": 1},
            )
            holders = [u async for u in u_cur]
    except Exception as exc:
        log.warning("who_can_toggle probe failed: %s", exc)
    holders.sort(key=lambda h: (h.get("name") or h.get("email") or "").lower())
    return {"holders": holders, "count": len(holders)}


# v58.13.90 — Idempotent startup seed hook for Stephen's override.
# Called from `server.py::on_startup` after the role-cache bootstrap.
# Safe to call on every restart; a no-op after the first apply.
# NOT tied to `seed_all()` because prod doesn't run the dev seed on
# boot but still needs Stephen's override to exist.
STEPHEN_EMAIL = "stephen@paneltec.com.au"


async def ensure_stephen_can_toggle() -> dict:
    """Grant the `comms_safe_mode.edit` override to Stephen Guy if
    it isn't already granted. Preserves any other overrides on his
    row. Returns a summary suitable for a startup log line."""
    stephen = await db.users.find_one(
        {"email": STEPHEN_EMAIL, "deleted_at": None},
        {"_id": 0, "id": 1, "org_id": 1},
    )
    if not stephen:
        return {"granted": False, "reason": "stephen_user_not_found"}
    existing = await db.user_permissions.find_one(
        {"user_id": stephen["id"]}, {"_id": 0, "overrides": 1},
    ) or {}
    overrides = existing.get("overrides") or {}
    already = bool((overrides.get("comms_safe_mode") or {}).get("edit"))
    if already:
        return {"granted": True, "no_op": True, "user_id": stephen["id"]}
    await db.user_permissions.update_one(
        {"user_id": stephen["id"]},
        {"$set": {
            "org_id": stephen["org_id"],
            "overrides.comms_safe_mode.edit": True,
            "updated_at": now_iso(),
            "updated_by": "system:v58_13_90_seed",
        }},
        upsert=True,
    )
    log.info("comms_safe_mode.override_seeded user_id=%s (Stephen)", stephen["id"])
    return {"granted": True, "no_op": False, "user_id": stephen["id"]}


# v58.13.85 — Admin one-click purge of the blocked outbox.
# Restricted to `role == "admin"` (same pattern as v58.13.81
# `admin_purge_test_data`). Audit log line stamped on every purge
# so a future auditor can retrace who cleared the queue.
@router.delete("/comms-outbox-blocked")
@safe_admin_endpoint
async def clear_blocked(
    channel: Optional[str] = Query(None, description="email | sms"),
    user: dict = Depends(get_current_user),
):
    if (user or {}).get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    q: dict = {"org_id": user["org_id"]}
    if channel in ("email", "sms"):
        q["channel"] = channel
    res = await db.comms_outbox_blocked.delete_many(q)
    deleted = int(res.deleted_count or 0)
    log.info(
        "comms.safe_mode_outbox_cleared org=%s actor=%s channel=%s deleted=%d",
        user["org_id"], user["id"], channel or "all", deleted,
    )
    return {"ok": True, "deleted": deleted, "channel": channel or "all"}
