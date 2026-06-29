"""Phase 3.21 — Session history audit log.

Every time an `active_sessions` row is deleted (idle timeout, explicit
logout, admin revoke, force-logout-all), we copy the row into a
`session_history` collection with `ended_at` + `end_reason`. The history
is auto-purged after 30 days via a TTL index on `ended_at`.

Why a separate collection (not just keeping rows in active_sessions)?
* Auditors want a clean list of who-was-signed-on-when, not a mix of
  live + dead sessions.
* TTL on the live sessions collection is small (idle timeout = minutes /
  hours). The history collection runs a 30-day TTL — different policy.
* Indexes can be optimised separately (history sorts mostly by
  ended_at DESC; live sessions sorts by last_activity_at DESC).

Public API:
* `record_session_end(jti, org_id, end_reason)` — call from every place
  that deletes a row from `active_sessions`. Idempotent: silently no-ops
  if the live row is already gone.
* `GET /api/admin/users/{user_id}/session-history` — admin endpoint that
  lists the last N history rows for a given user in the org.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Iterable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth import get_current_user
from db import db
from models import now_iso

router = APIRouter(prefix="/admin/users", tags=["session-history"])

VALID_END_REASONS = {
    "idle",                # session_timeout idle window expired
    "explicit_logout",     # user clicked Sign out
    "admin_revoke",        # individual revoke from active-sessions panel
    "force_logout_all",    # the bulk danger-zone button
    "absolute_timeout",    # absolute window expired (when wired in)
    "token_version_bump",  # token_version mismatch (e.g. password change)
}


def _require_admin(user: dict) -> None:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")


def _coerce_iso(val) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, datetime):
        v = val if val.tzinfo else val.replace(tzinfo=timezone.utc)
        return v.isoformat()
    if isinstance(val, str):
        return val
    return None


async def record_session_end(
    jti: str, org_id: str, end_reason: str,
    *, fallback_user_id: Optional[str] = None,
) -> None:
    """Copy the live session row to history with ended_at = now.

    Idempotent. Safe to call from inside a request handler — failures
    are swallowed so a history-write hiccup never breaks the user-facing
    logout / revoke flow.
    """
    if not jti or end_reason not in VALID_END_REASONS:
        return
    try:
        sess = await db.active_sessions.find_one(
            {"jti": jti, "org_id": org_id}, {"_id": 0},
        )
        if not sess and not fallback_user_id:
            return
        doc = {
            "jti":               jti,
            "org_id":            org_id,
            "user_id":           (sess or {}).get("user_id") or fallback_user_id,
            "role":              (sess or {}).get("role"),
            "remember_me":       bool((sess or {}).get("remember_me")),
            "ip_address":        (sess or {}).get("ip_address"),
            "user_agent":        (sess or {}).get("user_agent"),
            "login_at":          _coerce_iso((sess or {}).get("created_at")) or now_iso(),
            "last_activity_at":  _coerce_iso((sess or {}).get("last_activity_at")),
            "ended_at":          now_iso(),
            "end_reason":        end_reason,
        }
        await db.session_history.insert_one(doc)
    except Exception:
        # Never raise — history is best-effort.
        return


async def record_session_ends_bulk(
    org_id: str, end_reason: str, jtis: Optional[Iterable[str]] = None,
) -> int:
    """Bulk variant for force-logout-all. Snapshots every live session
    in the org (or only those in `jtis`) into history before they get
    deleted. Returns how many rows were written."""
    if end_reason not in VALID_END_REASONS:
        return 0
    q: dict = {"org_id": org_id}
    if jtis is not None:
        q["jti"] = {"$in": list(jtis)}
    sessions = await db.active_sessions.find(q, {"_id": 0}).to_list(5000)
    if not sessions:
        return 0
    now = now_iso()
    rows = []
    for sess in sessions:
        rows.append({
            "jti":               sess.get("jti"),
            "org_id":            sess.get("org_id"),
            "user_id":           sess.get("user_id"),
            "role":              sess.get("role"),
            "remember_me":       bool(sess.get("remember_me")),
            "ip_address":        sess.get("ip_address"),
            "user_agent":        sess.get("user_agent"),
            "login_at":          _coerce_iso(sess.get("created_at")) or now,
            "last_activity_at":  _coerce_iso(sess.get("last_activity_at")),
            "ended_at":          now,
            "end_reason":        end_reason,
        })
    try:
        await db.session_history.insert_many(rows, ordered=False)
        return len(rows)
    except Exception:
        return 0


async def ensure_indexes() -> None:
    """Idempotent. Called once at app startup from server.py."""
    try:
        # 30-day TTL on ended_at — Mongo expects a real Date field. We
        # also store ISO strings in many places, so use an `ended_at_ts`
        # mirror written as a BSON Date for the TTL index to bite.
        await db.session_history.create_index(
            "ended_at_ts", expireAfterSeconds=30 * 24 * 60 * 60, name="ttl_30d",
        )
    except Exception:
        pass
    try:
        await db.session_history.create_index(
            [("org_id", 1), ("user_id", 1), ("ended_at", -1)],
            name="org_user_ended_desc",
        )
    except Exception:
        pass


@router.get("/{user_id}/session-history")
async def list_session_history(
    user_id: str,
    limit: int = Query(50, ge=1, le=500),
    actor: dict = Depends(get_current_user),
):
    _require_admin(actor)
    cur = db.session_history.find(
        {"org_id": actor["org_id"], "user_id": user_id},
        {"_id": 0},
    ).sort("ended_at", -1).limit(limit)
    rows = await cur.to_list(limit)
    # Find user name/email once for the header.
    u = await db.users.find_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    )
    return {
        "user": u or {"id": user_id},
        "count": len(rows),
        "history": [
            {
                "jti":              r.get("jti"),
                "user_id":          r.get("user_id"),
                "role":             r.get("role"),
                "remember_me":      bool(r.get("remember_me")),
                "ip_address":       r.get("ip_address"),
                "user_agent":       r.get("user_agent"),
                "login_at":         _coerce_iso(r.get("login_at")),
                "last_activity_at": _coerce_iso(r.get("last_activity_at")),
                "ended_at":         _coerce_iso(r.get("ended_at")),
                "end_reason":       r.get("end_reason"),
            }
            for r in rows
        ],
    }


# Helper used by auth.py to capture IP + UA into active_sessions at login
# time so the history rows get rich enough metadata for the auditor.
def extract_request_metadata(request: Optional[Request]) -> dict:
    if request is None:
        return {}
    try:
        ip = request.client.host if request.client else None
        # Honour standard proxy headers (most common in this deployment).
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            ip = fwd.split(",")[0].strip() or ip
        ua = request.headers.get("user-agent")
        return {
            "ip_address": ip,
            "user_agent": (ua or "")[:300] or None,
        }
    except Exception:
        return {}
