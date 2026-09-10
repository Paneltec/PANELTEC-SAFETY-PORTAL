"""v58.13.132ci — Mobile PIN → session-token login.

Endpoint: `POST /api/auth/mobile/pin-login`

The mobile app's re-designed onboarding flow: worker taps a 4-digit
PIN on the login pad and receives a session JWT + a snapshot of their
identity + effective permissions in ONE round-trip. Rewritten mobile
client (crash-fixing pass by the Expo specialist) will consume this
in the next ship.

Reuses:
  · `users.pin_hash` (bcrypt) — set by the invite flow at
    `auth_invite.py:459-467`, wiped on logout.
  · `admin_console_pin_attempts` collection — same lockout ledger the
    admin-console PIN uses, keyed on a synthetic `mobile:<device_or_ip>`
    id so mobile brute-force sweeps don't cross-contaminate the
    admin-console counters (and vice-versa).
  · `create_access_token` — same 30-day HS256 JWT everywhere else.

Response shape (200):
    {
      "user_id":      "808cb7de-…",
      "name":         "Stephen Beadle",
      "email":        "stephen@paneltec.com.au",
      "role_id":      "paneltec_civil",
      "role_label":   "Paneltec Civil",
      "org_id":       "3116f250-…",
      "org_name":     "Paneltec Pty Ltd",
      "session_token":            "<jwt>",
      "session_token_expires_at": "2026-10-09T…Z",
      "permissions_snapshot":     { … }
    }

Errors:
  · 401  {"detail": "invalid_pin"}       — PIN doesn't match any user in any org
  · 401  {"detail": "pin_expired"}       — matched user's `pin_expires_at` is past
  · 401  {"detail": "account_disabled"}  — matched user's status is `disabled`
  · 429  {"detail": "rate_limited", "retry_after_seconds": N}
                                           — 5 fails → 60s, 10 fails → 15 min
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from auth import create_access_token, verify_password
from db import db

router = APIRouter(prefix="/auth/mobile", tags=["mobile-auth"])
PIN_RE = re.compile(r"^\d{4}$")

# Lockout policy. Stricter than the admin-console PIN because a mobile
# handset can potentially brute-force overnight without being noticed;
# this is 6 fails / 60s → 11 fails / 15 min → 21 fails / 24 h.
LOCKOUT_TIERS = [
    (5,  timedelta(seconds=60)),
    (10, timedelta(minutes=15)),
    (20, timedelta(hours=24)),
]

# Cache role_id → label for a short window (roles are near-static) so
# we don't hit db.roles on every login.
_ROLE_LABEL_CACHE: dict[str, tuple[float, str]] = {}
_ROLE_LABEL_CACHE_TTL = 60.0

# Fallback labels for the four core seeded roles the mobile app cares
# about. Overridden by `db.roles.display_name` when present.
_FALLBACK_ROLE_LABELS = {
    "admin":               "Admin",
    "paneltec_civil":      "Paneltec Civil",
    "viatec_traffic":      "Viatec Traffic",
    "external_contractor": "External Contractor",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _bucket_key(device_id: Optional[str], request: Request) -> str:
    """Rate-limit bucket key. Prefer device_id (per-handset) so a shared
    NAT doesn't gate the whole crew. Fall back to peer IP."""
    if device_id and device_id.strip():
        return f"mobile:{device_id.strip()}"
    peer = request.client.host if request.client else "unknown"
    return f"mobile:ip:{peer}"


async def _check_lockout(bucket: str) -> None:
    doc = await db.admin_console_pin_attempts.find_one({"user_id": bucket})
    if not doc:
        return
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
        remaining = max(1, int((locked_until - _now()).total_seconds()))
        raise HTTPException(
            status_code=429,
            detail={"error": "rate_limited",
                    "retry_after_seconds": remaining},
            headers={"Retry-After": str(remaining)},
        )
    # Expired lockout — clear the timestamp but keep the counter so
    # a subsequent burst re-triggers the next tier faster.
    await db.admin_console_pin_attempts.update_one(
        {"user_id": bucket},
        {"$set": {"locked_until": None}},
    )


async def _record_failure(bucket: str) -> Optional[datetime]:
    doc = await db.admin_console_pin_attempts.find_one({"user_id": bucket})
    new_count = int((doc or {}).get("failed_count", 0)) + 1
    locked_until: Optional[datetime] = None
    for threshold, duration in reversed(LOCKOUT_TIERS):
        if new_count >= threshold:
            locked_until = _now() + duration
            break
    await db.admin_console_pin_attempts.update_one(
        {"user_id": bucket},
        {"$set": {
            "user_id": bucket,
            "failed_count": new_count,
            "locked_until": locked_until.isoformat() if locked_until else None,
            "updated_at": _now().isoformat(),
        }},
        upsert=True,
    )
    return locked_until


async def _reset_attempts(bucket: str) -> None:
    await db.admin_console_pin_attempts.update_one(
        {"user_id": bucket},
        {"$set": {"failed_count": 0, "locked_until": None,
                  "updated_at": _now().isoformat()}},
        upsert=True,
    )


async def _role_label(role_id: Optional[str]) -> str:
    if not role_id:
        return "Worker"
    now = time.monotonic()
    hit = _ROLE_LABEL_CACHE.get(role_id)
    if hit and (now - hit[0]) < _ROLE_LABEL_CACHE_TTL:
        return hit[1]
    doc = None
    try:
        doc = await db.roles.find_one(
            {"role_id": role_id},
            {"_id": 0, "display_name": 1, "label": 1},
        )
    except Exception:
        doc = None
    label = (
        (doc or {}).get("display_name")
        or (doc or {}).get("label")
        or _FALLBACK_ROLE_LABELS.get(role_id)
        or role_id.replace("_", " ").title()
    )
    _ROLE_LABEL_CACHE[role_id] = (now, label)
    return label


class MobilePinLoginIn(BaseModel):
    pin: str = Field(..., min_length=4, max_length=4)
    device_id: Optional[str] = None


@router.post("/pin-login")
async def pin_login(body: MobilePinLoginIn, request: Request) -> dict:
    if not PIN_RE.match(body.pin):
        raise HTTPException(400, detail={"error": "invalid_pin_format"})

    bucket = _bucket_key(body.device_id, request)
    await _check_lockout(bucket)

    # v58.13.132cp / .132cx — Mobile PIN field precedence:
    #   1) Match against `users.mobile_pin_hash` FIRST (canonical
    #      mobile-app field set by admin-console PIN provisioning).
    #   2) Fall back to `users.pin_hash` (legacy invite-flow field)
    #      when the mobile hash misses, honouring `pin_expires_at`.
    # Rate-limit bucket is SHARED so cross-field brute force is
    # capped uniformly. No `_debug_pin_field` leaks to the response.
    match: Optional[dict] = None
    matched_field: Optional[str] = None

    async for u in db.users.find(
        {"mobile_pin_hash": {"$exists": True, "$ne": None}},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1,
         "role_id": 1, "org_id": 1, "mobile_pin_hash": 1,
         "status": 1, "token_version": 1, "activation_status": 1},
    ):
        try:
            if bcrypt.checkpw(body.pin.encode("utf-8"),
                              (u.get("mobile_pin_hash") or "").encode("utf-8")):
                match = u
                matched_field = "mobile_pin_hash"
                break
        except Exception:
            continue

    if not match:
        # Fallback — legacy `pin_hash` (invite-flow), with expiry.
        async for u in db.users.find(
            {"pin_hash": {"$exists": True, "$ne": None}},
            {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1,
             "role_id": 1, "org_id": 1, "pin_hash": 1, "pin_expires_at": 1,
             "status": 1, "token_version": 1, "activation_status": 1},
        ):
            try:
                if bcrypt.checkpw(body.pin.encode("utf-8"),
                                  (u.get("pin_hash") or "").encode("utf-8")):
                    match = u
                    matched_field = "pin_hash"
                    break
            except Exception:
                continue

    if not match:
        locked = await _record_failure(bucket)
        if locked:
            remaining = max(1, int((locked - _now()).total_seconds()))
            raise HTTPException(
                status_code=429,
                detail={"error": "rate_limited",
                        "retry_after_seconds": remaining},
                headers={"Retry-After": str(remaining)},
            )
        raise HTTPException(401, detail={"error": "invalid_pin"})

    # Expiry check — the invite flow sets `pin_expires_at` on the
    # legacy `pin_hash` field ONLY. `mobile_pin_hash` matches skip the
    # check (canonical mobile PINs are permanent per Stephen's
    # `.132cq` brief). A null value on the legacy field also means
    # "never expires".
    if matched_field == "pin_hash":
        exp_iso = match.get("pin_expires_at")
        if exp_iso:
            try:
                exp = datetime.fromisoformat(exp_iso)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp < _now():
                    # Counted as a hit for lockout purposes so an attacker
                    # brute-forcing expired PINs doesn't get infinite tries.
                    await _record_failure(bucket)
                    raise HTTPException(401, detail={"error": "pin_expired"})
            except HTTPException:
                raise
            except Exception:
                pass  # unparseable expiry → treat as null

    if (match.get("status") or "").lower() == "disabled":
        raise HTTPException(401, detail={"error": "account_disabled"})
    if match.get("activation_status") == "pending_activation":
        raise HTTPException(401, detail={"error": "account_pending_activation"})

    # Success — reset the bucket, mint a JWT, snapshot identity.
    await _reset_attempts(bucket)

    # Register a device_id on the user (best-effort — not enforced yet).
    if body.device_id:
        await db.users.update_one(
            {"id": match["id"]},
            {"$addToSet": {"mobile_device_ids": body.device_id.strip()},
             "$set": {"last_mobile_device_id": body.device_id.strip(),
                      "last_mobile_login_at": _now().isoformat()}},
        )
    else:
        await db.users.update_one(
            {"id": match["id"]},
            {"$set": {"last_mobile_login_at": _now().isoformat()}},
        )

    # Session token — reuse the same 30-day HS256 JWT the rest of the
    # app uses so any middleware guardrails apply uniformly.
    absolute_hours = 30 * 24
    token = create_access_token(
        match["id"],
        match["email"],
        match.get("token_version", 0),
        absolute_hours=absolute_hours,
    )
    expires_at = (_now() + timedelta(hours=absolute_hours)).isoformat()

    # Org + role labels.
    org = await db.orgs.find_one({"id": match["org_id"]},
                                 {"_id": 0, "name": 1}) or {}
    role_label = await _role_label(match.get("role_id"))

    # Permissions snapshot — same shape returned by `/api/auth/me`
    # so the mobile client can drive its role-gated affordances
    # without a second round-trip.
    try:
        from permissions import effective_for
        perms = await effective_for(match)
    except Exception:
        perms = {}

    return {
        "user_id":                  match["id"],
        "name":                     match.get("name") or match.get("email"),
        "email":                    match["email"],
        "role_id":                  match.get("role_id"),
        "role_label":               role_label,
        "org_id":                   match["org_id"],
        "org_name":                 org.get("name"),
        "session_token":            token,
        "session_token_expires_at": expires_at,
        "permissions_snapshot":     perms,
    }


# ─────────────── GET /auth/mobile/device-hint ───────────────
#
# v58.13.132ck — Pre-login "Welcome back <first-name>" hint.
#
# Strategy: the newest successful `pin-login` call claims the device,
# so `users.last_mobile_device_id` is the current owner of the handset.
# This endpoint is called by the mobile PIN screen on cold boot to
# personalise the greeting BEFORE the user types their PIN. Nothing
# sensitive is returned — first name, role label, org name only.
# Enough to greet, not enough to phish.
#
# Auth: none required (this is a pre-login hint). Rate-limited to
# 60 requests/minute per peer IP so an attacker can't enumerate device
# IDs. The `@limiter.limit(...)` decorator is a no-op in tests where
# `RATE_LIMIT_ENABLED=false` — see `rate_limit.py:10`.

_limiter = __import__("rate_limit", fromlist=["limiter"]).limiter


def _first_name(user: dict) -> str:
    """Extract a safe first name from the user doc. Prefers an explicit
    `first_name` field; falls back to the first whitespace-separated
    token of `name`; falls back to the local part of the email; final
    fallback is `"there"` so the greeting always has a subject."""
    fn = (user.get("first_name") or "").strip()
    if fn:
        return fn
    name = (user.get("name") or "").strip()
    if name:
        return name.split()[0]
    email = (user.get("email") or "").strip()
    if email and "@" in email:
        return email.split("@", 1)[0].split(".")[0].capitalize()
    return "there"


@router.get("/device-hint")
@_limiter.limit("60/minute")
async def device_hint(request: Request, device_id: str = "") -> dict:
    """Return the bound user's safe greeting fields for a given device_id.

    · `bound=true`  + first_name + role_label + org_name if the device
      is the most-recent successful PIN login for a user.
    · `bound=false` otherwise (including when `device_id` is blank —
      never leaks a "there's SOMEONE bound to something" oracle).
    """
    device_id = (device_id or "").strip()
    if not device_id:
        return {"bound": False}

    user = await db.users.find_one(
        {"last_mobile_device_id": device_id},
        {"_id": 0, "id": 1, "name": 1, "first_name": 1, "email": 1,
         "role_id": 1, "org_id": 1, "status": 1},
    )
    if not user:
        return {"bound": False}
    # Disabled accounts don't get a friendly greeting — behaves like
    # unbound so the mobile client just shows the generic PIN pad.
    if (user.get("status") or "").lower() == "disabled":
        return {"bound": False}

    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, "name": 1}) or {}
    role_label = await _role_label(user.get("role_id"))
    return {
        "bound":            True,
        "user_first_name":  _first_name(user),
        "role_label":       role_label,
        "org_name":         org.get("name"),
    }

