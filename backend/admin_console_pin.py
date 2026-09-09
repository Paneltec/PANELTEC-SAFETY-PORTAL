"""v58.13.132am — Admin console PIN lock (glance-shield).

Secondary UX-only shield in front of the header status pills
(Import PDFs / API health / Backup / Comms Safe Mode). Not a real
data gate — every underlying endpoint is unchanged and still
subject to the existing permission system. This module exists so
that when Stephen is showing his laptop screen to a customer, the
`Comms Safe Mode: ON 157` broadcast doesn't leak operational metadata
at a glance.

Endpoints (all `POST /api/auth/admin-console/*`, admin role only):
  · status   → { has_pin, locked_until }
  · set-pin  → first-time set OR rotate (with current_pin)
  · unlock   → verify PIN, tolerant of the 3/30s + 6/15min lockout
  · lock     → best-effort clear (client also drops sessionStorage)

Storage:
  · `users.admin_console_pin_hash` (bcrypt), `users.admin_console_pin_set_at`
  · `admin_console_pin_attempts` collection keyed on user_id, tracking
    `failed_count` + `locked_until`. Kept out of the login_attempts
    collection so the two systems don't cross-contaminate.

Deferred to .132an (per Stephen's Option B split):
  · Change-PIN / reset-PIN UI in MyProfile
  · Superadmin "Clear admin PIN" action + audit_log row
"""
from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user, hash_password, verify_password
from db import db

router = APIRouter(prefix="/auth/admin-console", tags=["admin-console-pin"])

# ── Lockout policy ────────────────────────────────────────────────
# Stephen's brief: 3 wrong → 30s. Extended to 6 wrong → 15min to
# discourage a brute-force sweep across the 10 000 keyspace.
LOCKOUT_TIERS = [
    (3, timedelta(seconds=30)),
    (6, timedelta(minutes=15)),
]

PIN_RE = re.compile(r"^\d{4}$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin console is admin-only.")
    return user


async def _get_attempts(user_id: str) -> dict:
    doc = await db.admin_console_pin_attempts.find_one({"user_id": user_id})
    return doc or {"user_id": user_id, "failed_count": 0, "locked_until": None}


async def _reset_attempts(user_id: str) -> None:
    await db.admin_console_pin_attempts.update_one(
        {"user_id": user_id},
        {"$set": {"failed_count": 0, "locked_until": None,
                  "updated_at": _now().isoformat()}},
        upsert=True,
    )


async def _record_failure(user_id: str) -> dict:
    doc = await _get_attempts(user_id)
    new_count = int(doc.get("failed_count", 0)) + 1
    locked_until: Optional[datetime] = None
    # Walk tiers from strictest (longest) to loosest so a 7th
    # failure still upgrades to the 15-min tier.
    for threshold, duration in reversed(LOCKOUT_TIERS):
        if new_count >= threshold:
            locked_until = _now() + duration
            break
    await db.admin_console_pin_attempts.update_one(
        {"user_id": user_id},
        {"$set": {
            "user_id": user_id,
            "failed_count": new_count,
            "locked_until": locked_until.isoformat() if locked_until else None,
            "updated_at": _now().isoformat(),
        }},
        upsert=True,
    )
    return {"failed_count": new_count, "locked_until": locked_until}


async def _check_lockout(user_id: str) -> None:
    doc = await _get_attempts(user_id)
    lu = doc.get("locked_until")
    if not lu:
        return
    try:
        locked_until = datetime.fromisoformat(lu)
    except Exception:
        return
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until > _now():
        # 429 with a Retry-After-friendly detail.
        remaining = int((locked_until - _now()).total_seconds())
        raise HTTPException(
            status_code=429,
            detail=f"Too many wrong PINs. Try again in {remaining}s.",
            headers={"Retry-After": str(remaining)},
        )
    # Expired lockout — clear the timestamp but keep the failed
    # counter so a subsequent burst re-triggers the 15-min tier.
    await db.admin_console_pin_attempts.update_one(
        {"user_id": user_id},
        {"$set": {"locked_until": None}},
    )


# ── Models ────────────────────────────────────────────────────────

class SetPinIn(BaseModel):
    pin: str = Field(..., min_length=4, max_length=4)
    current_pin: Optional[str] = None


class UnlockIn(BaseModel):
    pin: str = Field(..., min_length=4, max_length=4)


# ── Endpoints ─────────────────────────────────────────────────────

@router.post("/status")
async def status(user: dict = Depends(_require_admin)):
    doc = await db.users.find_one({"id": user["id"]},
                                  {"admin_console_pin_hash": 1,
                                   "admin_console_pin_set_at": 1})
    has_pin = bool((doc or {}).get("admin_console_pin_hash"))
    attempts = await _get_attempts(user["id"])
    return {
        "has_pin": has_pin,
        "set_at": (doc or {}).get("admin_console_pin_set_at"),
        "locked_until": attempts.get("locked_until"),
        "failed_count": attempts.get("failed_count", 0),
    }


@router.post("/set-pin")
async def set_pin(body: SetPinIn, user: dict = Depends(_require_admin)):
    if not PIN_RE.match(body.pin):
        raise HTTPException(status_code=400, detail="PIN must be exactly 4 digits.")
    doc = await db.users.find_one({"id": user["id"]},
                                  {"admin_console_pin_hash": 1})
    existing_hash = (doc or {}).get("admin_console_pin_hash")
    if existing_hash:
        # Rotation path — must supply the current PIN.
        if not body.current_pin or not PIN_RE.match(body.current_pin):
            raise HTTPException(status_code=400,
                                detail="Current PIN required to rotate.")
        if not verify_password(body.current_pin, existing_hash):
            # Re-use the same rate-limit ledger — rotating with the
            # wrong current PIN counts against the same lockout tier.
            await _check_lockout(user["id"])
            await _record_failure(user["id"])
            raise HTTPException(status_code=401,
                                detail="Current PIN is incorrect.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "admin_console_pin_hash": hash_password(body.pin),
            "admin_console_pin_set_at": _now().isoformat(),
        }},
    )
    await _reset_attempts(user["id"])
    return {"ok": True, "set_at": _now().isoformat()}


@router.post("/unlock")
async def unlock(body: UnlockIn, user: dict = Depends(_require_admin)):
    if not PIN_RE.match(body.pin):
        raise HTTPException(status_code=400, detail="PIN must be exactly 4 digits.")
    # Rate-limit BEFORE we touch bcrypt so a locked-out user pays
    # a constant near-zero cost.
    await _check_lockout(user["id"])
    doc = await db.users.find_one({"id": user["id"]},
                                  {"admin_console_pin_hash": 1})
    existing_hash = (doc or {}).get("admin_console_pin_hash")
    if not existing_hash:
        raise HTTPException(status_code=409,
                            detail="No PIN set. Call set-pin first.")
    # bcrypt.checkpw is constant-time within its own comparison —
    # no timing-attack mitigation beyond that is needed for a 4-
    # digit PIN with rate-limiting in front.
    if not verify_password(body.pin, existing_hash):
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
    # Client owns the TTL via sessionStorage — we hand back a
    # 60-minute hard-cap expiry as a display hint only.
    expires_at = (_now() + timedelta(minutes=60)).isoformat()
    return {"ok": True, "expires_at": expires_at}


class ClearPinIn(BaseModel):
    acting_pin: str = Field(..., min_length=4, max_length=4)


@router.post("/lock")
async def lock(user: dict = Depends(_require_admin)):
    # No server state — this exists so the client can call it for
    # symmetry / future auditing. Always OK.
    return {"ok": True, "locked_at": _now().isoformat()}


# ── .132as — Superadmin "Clear PIN" for another user ────────────
# Requires the acting admin's OWN PIN as confirmation to prevent
# accidental clears. Writes a user_audit row so operational reviews
# can trace who cleared whose PIN and when.
from fastapi import APIRouter as _APIRouter  # noqa: E402

users_admin_router = _APIRouter(prefix="/users", tags=["admin-console-pin"])


@users_admin_router.post("/{target_user_id}/admin-console/clear-pin")
async def clear_target_user_pin(
    target_user_id: str,
    body: ClearPinIn,
    user: dict = Depends(_require_admin),
):
    if not PIN_RE.match(body.acting_pin):
        raise HTTPException(status_code=400,
                            detail="Acting PIN must be exactly 4 digits.")
    # 1. Verify acting admin's own PIN — reuse the same lockout ledger
    #    so an attacker can't brute-force via this endpoint either.
    await _check_lockout(user["id"])
    acting = await db.users.find_one({"id": user["id"]},
                                     {"admin_console_pin_hash": 1})
    acting_hash = (acting or {}).get("admin_console_pin_hash")
    if not acting_hash:
        raise HTTPException(status_code=409,
                            detail="You must set your own admin PIN first.")
    if not verify_password(body.acting_pin, acting_hash):
        await _record_failure(user["id"])
        raise HTTPException(status_code=401,
                            detail="Your PIN is incorrect.")
    await _reset_attempts(user["id"])
    # 2. Clear target user's PIN + attempts.
    target = await db.users.find_one({"id": target_user_id},
                                     {"id": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found.")
    await db.users.update_one(
        {"id": target_user_id},
        {"$unset": {"admin_console_pin_hash": "",
                    "admin_console_pin_set_at": ""}},
    )
    await db.admin_console_pin_attempts.delete_many({"user_id": target_user_id})
    # 3. Audit.
    await db.user_audit.insert_one({
        "action": "admin_console_pin_cleared_by_admin",
        "target_user_id": target_user_id,
        "target_user_email": target.get("email"),
        "acting_user_id": user["id"],
        "acting_user_email": user.get("email"),
        "timestamp": _now().isoformat(),
    })
    return {"ok": True, "target_user_id": target_user_id,
            "cleared_at": _now().isoformat()}


# ── .132as — Legacy provisional backfill ────────────────────────
# One-shot admin trigger. For each row currently tagged
# `provisional_static_3.00`, look for a matching real-priced row
# using the natural fingerprint (org_id + card_number + date_iso +
# time_local + rounded litres) and flip in-place. Idempotent —
# rows without a matching real row stay provisional.

@users_admin_router.post("/admin-console/backfill-provisional-prices")
async def backfill_provisional_prices(user: dict = Depends(_require_admin)):
    org_id = user["org_id"]
    flipped = 0
    skipped = 0
    cursor = db.fuel_transactions.find(
        {"org_id": org_id, "price_source": "provisional_static_3.00",
         "deleted_at": None},
        {"_id": 1, "card_number": 1, "date_iso": 1, "time_local": 1,
         "litres": 1},
    )
    async for prov in cursor:
        litres = prov.get("litres")
        if litres is None:
            skipped += 1
            continue
        match_q = {
            "org_id": org_id,
            "card_number": prov.get("card_number"),
            "date_iso": prov.get("date_iso"),
            "time_local": prov.get("time_local"),
            "deleted_at": None,
            "price_source": {"$ne": "provisional_static_3.00"},
            "total_price": {"$gt": 0},
        }
        # Fingerprint tolerance: match on rounded litres to survive
        # trailing-zero float noise.
        try:
            match_q["litres"] = {"$gte": float(litres) - 0.01,
                                 "$lte": float(litres) + 0.01}
        except Exception:
            skipped += 1
            continue
        real = await db.fuel_transactions.find_one(match_q,
            {"total_price": 1, "computed_price_per_litre": 1})
        if not real:
            skipped += 1
            continue
        await db.fuel_transactions.update_one(
            {"_id": prov["_id"]},
            {"$set": {
                "total_price": real.get("total_price"),
                "computed_price_per_litre": real.get("computed_price_per_litre"),
                "price_source": "smartfill_actual",
                "price_source_backfilled_at": _now().isoformat(),
            }},
        )
        flipped += 1
    return {"ok": True, "flipped": flipped, "skipped": skipped}
