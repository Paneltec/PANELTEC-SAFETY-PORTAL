"""v58.13.64a — Lockout helpers extracted from `auth_invite.py`.

`auth.login` needs `is_locked` + `record_login_attempt` on every login
call, but `auth_invite` also imports from `auth` at top level. That
created a logical cycle broken today by a function-local import inside
`auth.login`. Moving the two functions here — a leaf module that
depends only on `db` and `models` — lets BOTH `auth.py` and
`auth_invite.py` import at top level without cycling.

`auth_invite.py` still exposes `LOCKOUT_FAILS` / `LOCKOUT_MINUTES` /
`is_locked` / `record_login_attempt` via re-export for back-compat
with any admin-tooling script that might reference them, but new code
should import from this module directly.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional  # noqa: F401  (used by consumers importing back)

from db import db
from models import now_iso

log = logging.getLogger("paneltec.auth_lockout")

LOCKOUT_FAILS = 5
LOCKOUT_MINUTES = 15


async def record_login_attempt(email: str, success: bool) -> None:
    """Called from the existing login endpoint. Tracks failed attempts
    and locks the account after `LOCKOUT_FAILS` consecutive failures."""
    user = await db.users.find_one(
        {"email": email},
        {"_id": 0, "id": 1, "failed_login_attempts": 1, "locked_until": 1},
    )
    if not user:
        return
    if success:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"failed_login_attempts": 0, "locked_until": None}},
        )
        return
    fails = int(user.get("failed_login_attempts") or 0) + 1
    update: dict = {"failed_login_attempts": fails}
    if fails >= LOCKOUT_FAILS:
        update["locked_until"] = (
            datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)
        ).isoformat()
        log.warning("auth.lockout user=%s fails=%d", user["id"], fails)
    await db.users.update_one({"id": user["id"]}, {"$set": update})


async def is_locked(email: str) -> bool:
    u = await db.users.find_one({"email": email}, {"_id": 0, "locked_until": 1})
    lu = (u or {}).get("locked_until")
    if not lu:
        return False
    return lu > now_iso()
