"""Phase 3.18 — Admin Active Sessions panel.

Tiny admin-only API for the Session Timeout settings card:
  * GET /api/admin/active-sessions      — list every live session
  * DELETE /api/admin/active-sessions/{jti} — revoke one specific session
  * POST /api/admin/active-sessions/bulk-revoke — v160.3.6v: revoke many

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

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

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
async def revoke_session(jti: str, request: Request,
                          user: dict = Depends(get_current_user)):
    """Revoke ONE session. Forces that token to fail on its next request via
    the token_version mismatch path.

    v160.3.0-adjust-5 — Blocks revoking the caller's OWN current session
    (400). "Force logout everyone" (which iterates and skips the caller
    server-side) is the intended path for that. Prevents an admin from
    accidentally logging themselves out mid-review.
    """
    _require_admin(user)
    sess = await db.active_sessions.find_one(
        {"jti": jti, "org_id": user["org_id"]}, {"_id": 0},
    )
    if not sess:
        raise HTTPException(404, "Session not found")

    # v160.3.7d — Use the jti that `get_current_user` attached to the
    # user dict. Reliable and never None for a JWT-authenticated caller.
    caller_jti = user.get("jti")
    is_self = caller_jti and caller_jti == jti
    if is_self:
        raise HTTPException(
            400,
            "You can't revoke your own current session. "
            "Use 'Force logout everyone' or sign out normally.",
        )

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


# ---------- v160.3.6v — Bulk revoke ----------

class BulkRevokeIn(BaseModel):
    ids: list[str] = Field(default_factory=list, description="List of session jti values to revoke")


def _caller_jti_from_request(request: Request) -> str | None:
    # v160.3.7d — Kept as a defensive fallback ONLY (in case get_current_user
    # ever changes and stops attaching the jti). The primary source is now
    # user["jti"] set by auth.get_current_user. This helper is called from
    # nowhere critical after v7d — it's a safety net for legacy callers.
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return None
    try:
        import jwt as _jwt
        from auth import JWT_ALGORITHM, _secret
        payload = _jwt.decode(auth_header[7:], _secret(),
                              algorithms=[JWT_ALGORITHM])
        return payload.get("jti")
    except Exception:
        return None


@router.post("/active-sessions/bulk-revoke")
async def bulk_revoke_sessions(
    body: BulkRevokeIn,
    request: Request,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Revoke many sessions in one shot.

    v160.3.7d — The safety layer here USED to try to protect the caller
    from nuking themselves by cross-referencing user_id when the jti
    couldn't be parsed. In practice that filter deleted zero sessions
    when the caller happened to own most of the rows (e.g. a dev with
    500 accumulated sessions all under their own account). The fix:
      * read jti directly from `user["jti"]` (set by get_current_user)
      * skip ONLY that exact jti — never the whole user's fleet
      * if for any reason jti is still unavailable, proceed anyway;
        the admin explicitly ticked those rows.

    Response contract:
        {
          "requested": <int>,       # ids passed in
          "revoked":   <int>,       # actually revoked
          "skipped_self": <bool>,   # true if caller's own jti was in ids
          "not_found": [<jti>, ...] # ids that didn't match any live session
        }
    """
    _require_admin(user)
    ids = [i for i in (body.ids or []) if isinstance(i, str) and i]
    if not ids:
        return {"requested": 0, "revoked": 0, "skipped_self": False, "not_found": []}

    # Primary source: attached by get_current_user. Only fall back to
    # re-parsing the header if the token was minted before the v7d fix
    # (unlikely — tokens are per-request, not cached).
    caller_jti = user.get("jti") or _caller_jti_from_request(request)

    # Dedupe + drop ONLY the caller's exact current jti.
    unique_ids = list({i for i in ids})
    skipped_self = False
    revocable_ids: list[str] = []
    for jti in unique_ids:
        if caller_jti and jti == caller_jti:
            skipped_self = True
            continue
        revocable_ids.append(jti)

    if not revocable_ids:
        return {
            "requested": len(ids),
            "revoked": 0,
            "skipped_self": skipped_self,
            "not_found": [],
        }

    # Pull the matching live sessions in one round-trip.
    live = await db.active_sessions.find(
        {"jti": {"$in": revocable_ids}, "org_id": user["org_id"]},
        {"_id": 0, "jti": 1, "user_id": 1},
    ).to_list(len(revocable_ids))
    live_by_jti = {r["jti"]: r for r in live}

    not_found = [jti for jti in revocable_ids if jti not in live_by_jti]

    if not live_by_jti:
        return {
            "requested": len(ids),
            "revoked": 0,
            "skipped_self": skipped_self,
            "not_found": not_found,
        }

    # Bump token_version once per affected user so cached JWTs die on next
    # /auth/me. Some sessions may share a user_id — a single $inc is enough
    # per user, so we build a set.
    # v160.3.7d — EXCLUDE the caller's own user_id from the token_version
    # bump. Otherwise: when Stephen bulk-revokes 5 of his own duplicate dev
    # sessions, the $inc kills his own current JWT and he gets bounced to
    # login mid-cleanup. The exact self-session was already filtered out of
    # revocable_ids by the caller_jti guard, so leaving his token_version
    # alone is safe — no un-revoked stale JWT can point at a now-deleted
    # session because his session wasn't touched.
    affected_user_ids = {
        row["user_id"] for row in live_by_jti.values()
        if row.get("user_id") and row.get("user_id") != user["id"]
    }
    if affected_user_ids:
        await db.users.update_many(
            {"id": {"$in": list(affected_user_ids)}, "org_id": user["org_id"]},
            {"$inc": {"token_version": 1}, "$set": {"updated_at": now_iso()}},
        )

    # Snapshot each session into history before deleting (same as single
    # revoke). Best-effort — history is nice-to-have, revocation is critical.
    try:
        from session_history import record_session_end
        for jti, row in live_by_jti.items():
            try:
                await record_session_end(
                    jti,
                    user["org_id"],
                    "admin_revoke",
                    fallback_user_id=row.get("user_id"),
                )
            except Exception:
                pass
    except Exception:
        pass

    result = await db.active_sessions.delete_many(
        {"jti": {"$in": list(live_by_jti.keys())}, "org_id": user["org_id"]},
    )
    revoked = int(getattr(result, "deleted_count", 0) or 0)

    return {
        "requested": len(ids),
        "revoked": revoked,
        "skipped_self": skipped_self,
        "not_found": not_found,
    }
