"""Apps Directory — server-side PIN unlock + access log.

Before this, the per-tile PIN was a screen-only gate: a PIN-protected
tile's URL was still sent to the browser, and saved logins (username,
password, Q&A answers) could be revealed through /api/tile-credentials
by anyone using an admin's logged-in session, without the PIN.

Now:
  · A correct PIN (POST /api/org/url-tiles/{id}/verify-pin) opens a
    short unlock window for that user (UNLOCK_MINUTES).
  · Saved logins can only be read, copied, changed or cleared inside
    that window (423 otherwise).
  · PIN-protected tile links are withheld from the launcher list until
    the PIN is entered.
  · Every PIN attempt and every saved-login use is written to
    `tile_access_log`, readable by admins via GET /org/url-tiles/activity.

Collections:
  tile_pin_unlocks  {user_id, expires_at}
  tile_access_log   {id, org_id, user_id, user_name, tile_id, tile_label,
                     action, detail, at}
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from db import db
from models import new_id

log = logging.getLogger("paneltec.tile_unlock")

UNLOCK_MINUTES = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def grant(user_id: str) -> str:
    """Open (or extend) the unlock window. Returns the expiry ISO time."""
    exp = _now() + timedelta(minutes=UNLOCK_MINUTES)
    await db.tile_pin_unlocks.update_one(
        {"user_id": user_id}, {"$set": {"user_id": user_id, "expires_at": exp.isoformat()}},
        upsert=True)
    return exp.isoformat()


async def revoke(user_id: str) -> None:
    await db.tile_pin_unlocks.delete_one({"user_id": user_id})


async def unlocked_until(user_id: str) -> Optional[str]:
    doc = await db.tile_pin_unlocks.find_one({"user_id": user_id}, {"_id": 0, "expires_at": 1})
    if not doc:
        return None
    try:
        exp = datetime.fromisoformat(doc["expires_at"])
    except Exception:  # noqa: BLE001
        return None
    return doc["expires_at"] if exp > _now() else None


async def is_unlocked(user_id: str) -> bool:
    return (await unlocked_until(user_id)) is not None


async def require_unlocked(user_id: str) -> None:
    from fastapi import HTTPException
    if not await is_unlocked(user_id):
        raise HTTPException(
            status_code=423,
            detail="Enter your 4-digit PIN to use saved logins.")


async def log_access(user: dict, tile_id: Optional[str], action: str,
                     detail: Optional[str] = None) -> None:
    """Best-effort access log row. Never raises."""
    try:
        label = None
        if tile_id:
            t = await db.org_url_tiles.find_one({"id": tile_id}, {"_id": 0, "label": 1})
            label = (t or {}).get("label")
        await db.tile_access_log.insert_one({
            "id": new_id(), "org_id": user.get("org_id"), "user_id": user.get("id"),
            "user_name": user.get("name") or user.get("email") or "",
            "tile_id": tile_id, "tile_label": label,
            "action": action, "detail": detail, "at": _now().isoformat(),
        })
    except Exception as e:  # noqa: BLE001
        log.warning("tile_access_log insert failed: %s", e)
