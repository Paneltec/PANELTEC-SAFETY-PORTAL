"""Phase 3.16 — Session Timeout Settings (admin-configurable).

Singleton `session_timeout_settings` per org + 5 endpoints + the idle-watch
hooks called from auth.py. Treats a missing doc as defaults so fresh boots /
new orgs never break auth.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, require_roles
from db import db

router = APIRouter(prefix="/settings", tags=["session-timeout"])
admin_router = APIRouter(prefix="/admin/settings", tags=["session-timeout-admin"])

ROLE_DEFAULTS = {
    "admin":      {"idle_minutes": 30,  "absolute_hours": 8},
    "manager":    {"idle_minutes": 30,  "absolute_hours": 8},
    "hseq_lead":  {"idle_minutes": 60,  "absolute_hours": 12},
    "auditor":    {"idle_minutes": 60,  "absolute_hours": 12},
    "supervisor": {"idle_minutes": 60,  "absolute_hours": 12},
    "worker":     {"idle_minutes": 240, "absolute_hours": 24},
}

DEFAULTS = {
    "idle_timeout_minutes": 60,
    "absolute_timeout_hours": 12,
    "warning_modal_enabled": True,
    "warning_modal_seconds": 60,
    "per_role_overrides_enabled": True,
    "per_role_overrides": ROLE_DEFAULTS,
    "remember_me_enabled": False,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalise_activity_ts(raw) -> Optional[datetime]:
    """Coerce a stored `last_activity_at` value into a tz-aware UTC datetime.

    Accepts:
      * `None`                → returns `None` (caller treats as expired).
      * `datetime` (naive)    → assumed UTC, returned tz-aware.
      * `datetime` (tz-aware) → returned unchanged.
      * `str` (ISO-8601)      → parsed; trailing `Z` accepted; naive parses
                                are stamped UTC.
      * Any other type or unparseable string → returns `None`.

    Callers MUST treat a `None` return as "session expired" — failing SAFE
    rather than fail-open prevents the BSON-Date vs ISO-string mismatch from
    silently keeping idle sessions alive (the exact regression Phase 3.16
    Part A fixes)."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    if isinstance(raw, str):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


async def get_settings(org_id: str) -> dict:
    """Returns the current settings for an org; missing doc → DEFAULTS."""
    doc = await db.session_timeout_settings.find_one({"org_id": org_id}, {"_id": 0})
    out = dict(DEFAULTS)
    if doc:
        for k, v in doc.items():
            if k in out and v is not None:
                out[k] = v
    merged = dict(ROLE_DEFAULTS)
    for role, vals in (out.get("per_role_overrides") or {}).items():
        merged[role] = {**ROLE_DEFAULTS.get(role, ROLE_DEFAULTS["worker"]), **(vals or {})}
    out["per_role_overrides"] = merged
    return out


def _effective_for_role(settings: dict, role: str) -> dict:
    if settings.get("per_role_overrides_enabled") and role in (settings.get("per_role_overrides") or {}):
        rc = settings["per_role_overrides"][role]
        idle = int(rc.get("idle_minutes") or settings["idle_timeout_minutes"])
        absolute = int(rc.get("absolute_hours") or settings["absolute_timeout_hours"])
    else:
        idle = int(settings["idle_timeout_minutes"])
        absolute = int(settings["absolute_timeout_hours"])
    return {
        "idle_minutes": idle,
        "absolute_hours": absolute,
        "warning_modal_enabled": bool(settings.get("warning_modal_enabled", True)),
        "warning_modal_seconds": int(settings.get("warning_modal_seconds", 60)),
        "remember_me_enabled": bool(settings.get("remember_me_enabled", False)),
    }


async def effective_for_user(user: dict) -> dict:
    return _effective_for_role(await get_settings(user["org_id"]),
                               user.get("role") or "worker")


# ────────────── REST surface ──────────────

class SessionTimeoutIn(BaseModel):
    idle_timeout_minutes: Optional[int] = Field(None, ge=5)
    absolute_timeout_hours: Optional[int] = Field(None, ge=1)
    warning_modal_enabled: Optional[bool] = None
    warning_modal_seconds: Optional[int] = Field(None, ge=10, le=300)
    per_role_overrides_enabled: Optional[bool] = None
    per_role_overrides: Optional[dict] = None
    remember_me_enabled: Optional[bool] = None


@admin_router.get("/session-timeout")
async def get_session_timeout(user: dict = Depends(require_roles("admin"))):
    return await get_settings(user["org_id"])


@admin_router.put("/session-timeout")
async def put_session_timeout(body: SessionTimeoutIn, user: dict = Depends(require_roles("admin"))):
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not patch:
        return await get_settings(user["org_id"])
    pro = patch.get("per_role_overrides")
    if pro is not None:
        if not isinstance(pro, dict):
            raise HTTPException(400, "per_role_overrides must be a dict of role→{idle_minutes, absolute_hours}")
        cleaned: dict = {}
        for role, vals in pro.items():
            if not isinstance(vals, dict): continue
            row: dict = {}
            if "idle_minutes" in vals:
                idle = int(vals["idle_minutes"])
                if idle < 5: raise HTTPException(400, f"{role}.idle_minutes must be >= 5")
                row["idle_minutes"] = idle
            if "absolute_hours" in vals:
                ab = int(vals["absolute_hours"])
                if ab < 1: raise HTTPException(400, f"{role}.absolute_hours must be >= 1")
                row["absolute_hours"] = ab
            cleaned[role] = row
        patch["per_role_overrides"] = cleaned
    patch["updated_by"] = user["id"]
    patch["updated_at"] = _now_iso()
    await db.session_timeout_settings.update_one(
        {"org_id": user["org_id"]},
        {"$set": patch, "$setOnInsert": {"org_id": user["org_id"], "created_at": _now_iso()}},
        upsert=True,
    )
    return await get_settings(user["org_id"])


@admin_router.post("/force-logout-all")
async def force_logout_all(user: dict = Depends(require_roles("admin"))):
    """Bump every org user's `token_version` (immediately revokes every
    outstanding JWT including the caller's) and wipe `active_sessions`."""
    res = await db.users.update_many(
        {"org_id": user["org_id"]},
        {"$inc": {"token_version": 1}},
    )
    s = await db.active_sessions.delete_many({"org_id": user["org_id"]})
    return {"ok": True, "users_revoked": res.modified_count, "sessions_wiped": s.deleted_count}


@router.get("/session-timeout/me")
async def session_timeout_me(user: dict = Depends(get_current_user)):
    return await effective_for_user(user)


@router.get("/login-options")
async def login_options():
    """Public — drives the login page "Keep me logged in" checkbox."""
    doc = await db.session_timeout_settings.find_one(
        {"remember_me_enabled": True}, {"_id": 0, "remember_me_enabled": 1},
    )
    return {"remember_me_enabled": bool(doc.get("remember_me_enabled") if doc else False)}


# ─────────────────── Active session helpers (called from auth.py) ───────────────────

ACTIVITY_DEBOUNCE_SECONDS = 30


def new_jti() -> str:
    return uuid.uuid4().hex


async def register_session(jti: str, user: dict, remember_me: bool = False) -> None:
    await db.active_sessions.insert_one({
        "jti": jti,
        "user_id": user["id"],
        "org_id": user["org_id"],
        "role": user.get("role") or "worker",
        "remember_me": bool(remember_me),
        "last_activity_at": _now_iso(),
        "created_at": _now_iso(),
    })


async def touch_and_check_session(jti: str, user: dict) -> Optional[str]:
    """Returns None if the session is fresh, "session_idle_timeout" if not.

    Handles `last_activity_at` stored as EITHER an ISO string (current write
    path) OR a BSON Date — older code or a future migration could land
    datetime objects in the doc and we must not silently fail open.
    A genuinely-unparseable timestamp is treated as expired (safer default)."""
    if not jti:
        return None
    sess = await db.active_sessions.find_one({"jti": jti}, {"_id": 0})
    if not sess:
        await register_session(jti, user)
        return None
    eff = await effective_for_user(user)
    idle_minutes = eff["idle_minutes"]
    if sess.get("remember_me"):
        idle_minutes = max(idle_minutes, 30 * 24 * 60)
    raw = sess.get("last_activity_at")
    last = _normalise_activity_ts(raw)
    if last is None:
        # No timestamp, malformed shape, or unknown type — fail SAFE (expired),
        # not open. The next login will write a fresh well-formed row.
        await db.active_sessions.delete_one({"jti": jti})
        return "session_idle_timeout"
    age_s = (datetime.now(timezone.utc) - last).total_seconds()
    if age_s > idle_minutes * 60:
        await db.active_sessions.delete_one({"jti": jti})
        return "session_idle_timeout"
    if age_s > ACTIVITY_DEBOUNCE_SECONDS:
        await db.active_sessions.update_one(
            {"jti": jti}, {"$set": {"last_activity_at": _now_iso()}},
        )
    return None
