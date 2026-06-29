"""Phase 3.18 — Admin Active Sessions panel.

Tiny admin-only API for the Session Timeout settings card:
  * GET /api/admin/active-sessions      — list every live session
  * DELETE /api/admin/active-sessions/{jti} — revoke one specific session

Active sessions are tracked in the `active_sessions` TTL collection (added in
Phase 3.16). Revocation works by deleting the row AND bumping the owner's
`token_version` so any still-cached JWT can't be reused.

Notes
-----
* This is intentionally a thin wrapper around an existing collection — no new
  storage. The collection already has `expireAfterSeconds` set so the list
  never accumulates dead rows.
* The owner's name + email are looked up at read time. We deliberately don't
  cache them on the session row because users.name can change mid-session.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import db
from models import now_iso

router = APIRouter(prefix="/admin", tags=["admin-active-sessions"])


def _require_admin(user: dict) -> None:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")


def _normalise_dt(val: Any) -> str | None:
    """Return ISO-8601 (UTC) regardless of how Mongo stored the field."""
    if val is None:
        return None
    if isinstance(val, datetime):
        v = val if val.tzinfo else val.replace(tzinfo=timezone.utc)
        return v.isoformat()
    if isinstance(val, str):
        return val
    return None


@router.get("/active-sessions")
async def list_active_sessions(user: dict = Depends(get_current_user)):
    _require_admin(user)
    rows = await db.active_sessions.find(
        {"org_id": user["org_id"]},
        {"_id": 0},
    ).sort("last_activity_at", -1).to_list(500)

    user_ids = {r["user_id"] for r in rows if r.get("user_id")}
    users_by_id: dict[str, dict] = {}
    if user_ids:
        async for u in db.users.find(
            {"id": {"$in": list(user_ids)}, "org_id": user["org_id"]},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
        ):
            users_by_id[u["id"]] = u

    out = []
    for r in rows:
        u = users_by_id.get(r.get("user_id")) or {}
        out.append({
            "jti": r.get("jti"),
            "user_id": r.get("user_id"),
            "user_name": u.get("name") or "(unknown)",
            "user_email": u.get("email") or "",
            "role": r.get("role") or u.get("role"),
            "remember_me": bool(r.get("remember_me")),
            "is_current_session": r.get("jti") == user.get("jti"),
            "created_at":       _normalise_dt(r.get("created_at")),
            "last_activity_at": _normalise_dt(r.get("last_activity_at")),
            "expires_at":       _normalise_dt(r.get("expires_at")),
        })
    return {"sessions": out, "count": len(out)}


@router.delete("/active-sessions/{jti}", status_code=204)
async def revoke_session(jti: str, user: dict = Depends(get_current_user)):
    """Revoke ONE session. Forces that token to fail on its next request via
    the token_version mismatch path."""
    _require_admin(user)
    sess = await db.active_sessions.find_one(
        {"jti": jti, "org_id": user["org_id"]}, {"_id": 0},
    )
    if not sess:
        raise HTTPException(404, "Session not found")
    # Bump token_version so any cached JWT for this user that uses this jti
    # also fails the next /auth/me check (defence in depth).
    await db.users.update_one(
        {"id": sess["user_id"], "org_id": user["org_id"]},
        {"$inc": {"token_version": 1}, "$set": {"updated_at": now_iso()}},
    )
    # Phase 3.21 — snapshot the row into history before we delete it.
    from session_history import record_session_end
    await record_session_end(jti, user["org_id"], "admin_revoke",
                             fallback_user_id=sess.get("user_id"))
    await db.active_sessions.delete_one({"jti": jti, "org_id": user["org_id"]})
    return None
