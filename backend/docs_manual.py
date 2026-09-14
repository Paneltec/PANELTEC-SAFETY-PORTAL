"""v58.13.132gd — Admin-only endpoint that streams the current
`docs/paneltec_group_platform_manual.docx` after a PIN unlock.

Reuses the `admin_console_pin` verification pattern:
  · Caller must have `role=="admin"` (403 otherwise).
  · Caller must send a fresh admin-console PIN in header
    `X-Admin-Console-Pin`. We verify it against
    `users.admin_console_pin_hash` with the same bcrypt +
    lockout dance the `/auth/admin-console/unlock` endpoint uses
    — so a valid PIN in this header ALSO resets the lockout counter,
    and a wrong PIN feeds the shared `admin_console_pin_attempts`
    tracker (401 or 429 as appropriate).
"""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import FileResponse

from auth import get_current_user, verify_password
from admin_console_pin import (
    _check_lockout, _record_failure, _reset_attempts, _now,
    LOCKOUT_TIERS,
)
from db import db

router = APIRouter(prefix="/docs", tags=["docs"])

APP_ROOT = Path(__file__).resolve().parent.parent
MANUAL_PATH = APP_ROOT / "docs" / "paneltec_group_platform_manual.docx"
PIN_RE = re.compile(r"^\d{4}$")


async def _require_admin_pin(user: dict, pin: str) -> None:
    """Same shape as `admin_console_pin.unlock` — but the PIN comes
    from a request header, and we short-circuit with 401 if the
    header is absent."""
    if not pin:
        raise HTTPException(
            status_code=401,
            detail="Admin console PIN required in X-Admin-Console-Pin header.",
        )
    if not PIN_RE.match(pin):
        raise HTTPException(status_code=400,
                              detail="PIN must be exactly 4 digits.")
    await _check_lockout(user["id"])
    doc = await db.users.find_one({"id": user["id"]},
                                    {"admin_console_pin_hash": 1})
    existing = (doc or {}).get("admin_console_pin_hash")
    if not existing:
        raise HTTPException(status_code=409,
                              detail="No admin PIN set on this account.")
    if not verify_password(pin, existing):
        recorded = await _record_failure(user["id"])
        lu = recorded.get("locked_until")
        if lu:
            remaining = int((lu - _now()).total_seconds())
            raise HTTPException(
                status_code=429,
                detail=f"Too many wrong PINs. Try again in {remaining}s.",
                headers={"Retry-After": str(remaining)},
            )
        raise HTTPException(status_code=401, detail="Wrong PIN.")
    await _reset_attempts(user["id"])


@router.get(
    "/manual.docx",
    summary="Download the current Paneltec Group platform manual",
    responses={
        200: {"description": "The manual .docx file",
              "content": {"application/vnd.openxmlformats-officedocument."
                          "wordprocessingml.document": {}}},
        401: {"description": "Missing or wrong admin PIN"},
        403: {"description": "Non-admin caller"},
        429: {"description": "PIN lockout tier reached"},
        404: {"description": "Manual not generated yet"},
    },
)
async def download_manual(
    x_admin_console_pin: str = Header(default=""),
    user: dict = Depends(get_current_user),
):
    """v58.13.132gd — Streams the manual to admins after PIN check."""
    if (user or {}).get("role") != "admin":
        raise HTTPException(status_code=403,
                              detail="Admin console is admin-only.")
    await _require_admin_pin(user, x_admin_console_pin.strip())
    if not MANUAL_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="Manual not generated yet. Run "
                    "`python3 scripts/regenerate_manual.py`.",
        )
    return FileResponse(
        path=str(MANUAL_PATH),
        media_type=(
            "application/vnd.openxmlformats-officedocument."
            "wordprocessingml.document"
        ),
        filename="paneltec_group_platform_manual.docx",
    )
