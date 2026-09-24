"""v58.13.132mh — Auth lockout + sliding window + forensic trail.

History:
  · v58.13.64a — extracted from `auth_invite.py` to break an import
    cycle. `auth.login` imports `is_locked` + `record_login_attempt`
    at top level.
  · v58.13.132mh — three enhancements after Stephen was locked out
    twice in ~24 h with no forensic trail:
      1. Sliding window — the failed-login counter now resets to 1
         if the previous fail was >30 min ago, instead of accumulating
         across days. Aligns with the auth.py comment
         "5 failures / 15 min per email" which was aspirational
         before this change.
      2. `login_attempts` collection — one row per failed attempt.
         Fields: email, user_id, ip, user_agent, timestamp, reason.
         TTL 90 days (index created on module load).
      3. IP + UA in the lockout WARNING log line — so future support
         tickets can distinguish "user typo" from "bot brute force".

`auth_invite.py` still re-exports `LOCKOUT_FAILS` / `LOCKOUT_MINUTES`
/ `is_locked` / `record_login_attempt` for back-compat with any
admin-tooling script that might reference them; new code should
import from this module directly.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from db import db
from models import now_iso

log = logging.getLogger("paneltec.auth_lockout")

LOCKOUT_FAILS = 5
LOCKOUT_MINUTES = 15
# v58.13.132mh — counter resets if last fail was >30 min ago. This
# codifies the "5 failures per 15 min per email" behaviour that the
# auth.py comment already advertised.
LOCKOUT_WINDOW_MIN = 30

# TTL index management is done lazily by callers (server.on_startup
# runs `ensure_login_attempts_index()` — see below). Kept lazy so
# importing this module doesn't touch Mongo.
_INDEX_ENSURED = False


async def ensure_login_attempts_index() -> None:
    """Create the TTL index on `login_attempts.timestamp` (90 days).
    Idempotent; safe to call every boot."""
    global _INDEX_ENSURED
    if _INDEX_ENSURED:
        return
    try:
        await db.login_attempts.create_index(
            "timestamp", expireAfterSeconds=90 * 24 * 3600,
            name="ttl_timestamp_90d",
        )
        # Support ticket workflows commonly query by email + recency.
        await db.login_attempts.create_index(
            [("email", 1), ("timestamp", -1)],
            name="email_timestamp",
        )
        _INDEX_ENSURED = True
    except Exception as e:  # noqa: BLE001
        log.warning("auth.lockout ttl-index create failed: %s", e)


async def _log_attempt(
    *, email: str, user_id: Optional[str], reason: str,
    ip: Optional[str], user_agent: Optional[str],
) -> None:
    """Persist one failed-attempt row for the forensic trail."""
    doc = {
        "email": email,
        "user_id": user_id,
        "reason": reason,
        "ip": ip,
        "user_agent": (user_agent or "")[:400],
        "timestamp": datetime.now(timezone.utc),
    }
    try:
        await db.login_attempts.insert_one(doc)
    except Exception as e:  # noqa: BLE001
        log.warning("auth.lockout insert login_attempt failed: %s", e)


async def record_login_attempt(
    email: str,
    success: bool,
    *,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    """Track failed attempts + lock after N consecutive failures with
    a sliding 30-min window. On success, reset counter."""
    user = await db.users.find_one(
        {"email": email},
        {"_id": 0, "id": 1, "failed_login_attempts": 1,
         "locked_until": 1, "last_failed_login_at": 1},
    )
    if not user:
        # Log the bad-email attempt too — bot scans look like this.
        if not success:
            await _log_attempt(
                email=email, user_id=None,
                reason=reason or "unknown-email",
                ip=ip, user_agent=user_agent,
            )
        return

    now = datetime.now(timezone.utc)

    if success:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "failed_login_attempts": 0,
                "locked_until": None,
                "last_failed_login_at": None,
            }},
        )
        return

    # Sliding-window counter.
    prev_iso = user.get("last_failed_login_at")
    if prev_iso:
        try:
            prev = datetime.fromisoformat(prev_iso)
            if (now - prev) > timedelta(minutes=LOCKOUT_WINDOW_MIN):
                fails = 1
            else:
                fails = int(user.get("failed_login_attempts") or 0) + 1
        except ValueError:
            fails = int(user.get("failed_login_attempts") or 0) + 1
    else:
        fails = int(user.get("failed_login_attempts") or 0) + 1

    update: dict = {
        "failed_login_attempts": fails,
        "last_failed_login_at": now.isoformat(),
    }
    if fails >= LOCKOUT_FAILS:
        update["locked_until"] = (
            now + timedelta(minutes=LOCKOUT_MINUTES)
        ).isoformat()
        log.warning(
            "auth.lockout user=%s email=%s fails=%d ip=%s ua=%s",
            user["id"], email, fails, ip or "-",
            (user_agent or "-")[:80],
        )
    await db.users.update_one({"id": user["id"]}, {"$set": update})

    await _log_attempt(
        email=email, user_id=user["id"],
        reason=reason or "bad-password",
        ip=ip, user_agent=user_agent,
    )


async def is_locked(email: str) -> bool:
    u = await db.users.find_one(
        {"email": email}, {"_id": 0, "locked_until": 1},
    )
    lu = (u or {}).get("locked_until")
    if not lu:
        return False
    return lu > now_iso()
