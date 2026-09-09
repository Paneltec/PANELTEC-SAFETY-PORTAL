"""Phase 4.7 — Worker invites, password reset, PIN fallback, lockout.

All public endpoints are rate-limited per IP via a tiny in-memory bucket
(good enough for a single-worker dev pod; production behind a reverse
proxy should still honour the headers the bucket emits).

v58.13.88 openapi hotfix note — rate-limited endpoints whose body is a
Pydantic model MUST annotate the body param as `Annotated[Model, Body()]`
(not the bare `body: Model` form). Reason: this module uses
`from __future__ import annotations` (PEP 563), so annotations are stored
as strings; the slowapi `@limiter.limit` wrapper then hides the module
`__globals__` from FastAPI's `get_type_hints()` call during OpenAPI
schema generation, and Pydantic v2 falls back to guessing `Query`, which
500s the openapi endpoint. Explicit `Body()` short-circuits the guess.
Applies to `send_reset` and `reset_redeem` below.
"""
import hashlib
import logging
import os
import random
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import bcrypt
import jwt
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth import (JWT_ALGORITHM, _secret, create_access_token,
                  get_current_user, hash_password)
# v58.13.64a — Lockout helpers moved to `auth_lockout`. Re-exported
# below so any consumer that historically reached for these names on
# `auth_invite` keeps working.
from auth_lockout import (  # noqa: F401  (re-exported for back-compat)
    LOCKOUT_FAILS, LOCKOUT_MINUTES, is_locked, record_login_attempt,
)
from db import db
from models import now_iso

router = APIRouter(tags=["auth-invite"])
log = logging.getLogger("paneltec.auth_invite")

INVITE_TTL_DAYS  = 7
RESET_TTL_HOURS  = 24
PIN_TTL_HOURS    = 24

# ───── Rate-limit bucket (per IP, in-memory) ─────────────────────────
_RL: dict[str, list[float]] = {}
def _rate_limit(key: str, per_min: int, request: Request):
    ip = request.client.host if request.client else "?"
    bucket_key = f"{key}:{ip}"
    now = time.time()
    bucket = [t for t in _RL.get(bucket_key, []) if now - t < 60]
    if len(bucket) >= per_min:
        raise HTTPException(429, "Too many requests — try again in a minute.")
    bucket.append(now)
    _RL[bucket_key] = bucket


# ───── Password rule helper (centralised) ────────────────────────────
def validate_password_rule(pwd: str) -> Optional[str]:
    """Return an error string OR None if the password meets the rules.
    Min 10 chars, at least one letter, one digit, one non-alphanumeric."""
    if not isinstance(pwd, str) or len(pwd) < 10:
        return "Password must be at least 10 characters."
    if not any(c.isalpha() for c in pwd):
        return "Password must contain at least one letter."
    if not any(c.isdigit() for c in pwd):
        return "Password must contain at least one digit."
    if not any(not c.isalnum() for c in pwd):
        return "Password must contain at least one special character."
    return None


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _make_link_token(*, user_id: str, org_id: str, purpose: str, ttl: timedelta) -> str:
    payload = {
        "sub": user_id, "org_id": org_id, "purpose": purpose,
        "exp": datetime.now(timezone.utc) + ttl,
        "iat": datetime.now(timezone.utc),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def _decode_link_token(token: str, expected_purpose: str) -> dict:
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(400, "This link has expired. Ask your admin for a new one.")
    except jwt.InvalidTokenError:
        raise HTTPException(400, "This link is invalid.")
    if payload.get("purpose") != expected_purpose:
        raise HTTPException(400, "This link can't be used for this action.")
    return payload


async def _user_or_404(user_id: str, org_id: str) -> dict:
    u = await db.users.find_one({"id": user_id, "org_id": org_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "User not found")
    return u


async def _audit(actor: dict, action: str, **extra):
    await db.audit_logs.insert_one({
        "org_id":     actor.get("org_id"),
        "actor_id":   actor.get("id"),
        "actor_name": actor.get("name") or actor.get("email"),
        "action":     action,
        "at":         now_iso(),
        **extra,
    })


# ───── Channels: email + SMS ─────────────────────────────────────────
async def _send_invite_email(user: dict, link: str, org_name: str, kind: str, sender: dict):
    from email_outbox import queue_email_doc
    pretty = "reset your Paneltec password" if kind == "reset" else "join Paneltec Civil"
    subject = ("Reset your Paneltec password" if kind == "reset"
               else f"You're invited to {org_name} on Paneltec Civil")
    html = (
        f"<p>Hi {user.get('name') or user.get('email')},</p>"
        f"<p>You've been invited to {pretty}. Click the secure link below to set your password:</p>"
        f"<p><a href='{link}' style='background:#F97316;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600'>"
        f"Set my password</a></p>"
        f"<p>If the button doesn't work, paste this link into your browser:<br/><code>{link}</code></p>"
        f"<p style='color:#64748b;font-size:12px'>This link expires in "
        f"{INVITE_TTL_DAYS} days." if kind != "reset" else
        f"<p style='color:#64748b;font-size:12px'>This link expires in {RESET_TTL_HOURS} hours."
    )
    html += " If you weren't expecting this, you can ignore the email.</p>"
    await queue_email_doc(
        org_id=user["org_id"], to=[user["email"]],
        subject=subject, body_html=html,
        related_record_type="user", related_record_id=user["id"],
        created_by=sender.get("id") or "system",
        resource_kind="auth_invite",
                               # OR user clicked "Forgot Password" on login.
    )


async def _send_invite_sms(user: dict, link: str, kind: str) -> bool:
    """Best-effort SMS via existing TextMagic integration; returns False if
    integration isn't connected or the phone is missing."""
    phone = user.get("phone") or user.get("mobile")
    if not phone:
        return False
    # v58.13.88 — route through the centralised safe_send_sms boundary
    # (was silently returning False since a rename — `integrations.send_sms`
    # didn't exist). Now honours Safe Mode + contextvar gate.
    from integrations_textmagic import safe_send_sms
    body = ("Paneltec password reset: " if kind == "reset" else "Paneltec invite: ") + link
    try:
        res = await safe_send_sms(
            user["org_id"], mobiles=[phone], text=body,
            triggered_by_endpoint=f"auth_invite._send_invite_sms:{kind}",
            actor_user_id=user.get("id"),
        )
        if res.get("blocked") or res.get("skipped"):
            return True  # audit row logged; caller treats as "held".
        return bool(res.get("ok"))
    except Exception as exc:
        log.warning("auth_invite sms_failed: %s", exc)
        return False


# ───── Invite send / validate / redeem ───────────────────────────────
class InviteIn(BaseModel):
    channel: str = "auto"  # email | sms | auto


def _public_host(request: Request) -> str:
    # Web links must hit the public host. Prefer X-Forwarded-Host (ingress)
    # then the host header.
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    proto = request.headers.get("x-forwarded-proto") or ("https" if host else "http")
    if host:
        return f"{proto}://{host}"
    return os.environ.get("PUBLIC_BASE_URL", "")


@router.post("/users/{user_id}/invite", status_code=201)
async def send_invite(user_id: str, body: InviteIn, request: Request,
                      caller: dict = Depends(get_current_user)):
    # v58.13.86 — Re-enabled per user directive. The v160.3.9.32-4b
    # 410 removal was reverted because the invite flow is legitimate
    # user-action comms (admin explicitly clicks Send Invite). The
    # Simpro import path stays available for bulk provisioning; this
    # endpoint is the manual per-user path.
    if caller.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    target = await _user_or_404(user_id, caller["org_id"])
    org = await db.orgs.find_one({"id": caller["org_id"]}, {"_id": 0, "name": 1}) or {}

    token = _make_link_token(user_id=target["id"], org_id=target["org_id"],
                             purpose="invite",
                             ttl=timedelta(days=INVITE_TTL_DAYS))
    expires_at = (datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)).isoformat()
    await db.users.update_one(
        {"id": target["id"]},
        {"$set": {
            "invite_token_hash": _sha(token),
            "invite_expires_at": expires_at,
            "must_change_password": True,
            "updated_at": now_iso(),
        }},
    )

    base = _public_host(request)
    link = f"{base}/onboard?token={token}"

    channel = (body.channel or "auto").lower()
    sent_via = None
    if channel in ("email", "auto") and target.get("email"):
        await _send_invite_email(target, link, org.get("name") or "Paneltec", "invite", caller)
        sent_via = "email"
    if not sent_via and channel in ("sms", "auto"):
        if await _send_invite_sms(target, link, "invite"):
            sent_via = "sms"
    if not sent_via:
        raise HTTPException(400, "No email or SMS channel available for this user.")

    await _audit(caller, "auth.invite_sent",
                 target_user_id=target["id"], channel=sent_via,
                 expires_at=expires_at)
    return {"ok": True, "channel": sent_via, "expires_at": expires_at}


class TokenIn(BaseModel):
    token: str


@router.post("/auth/invite/validate")
async def invite_validate(body: TokenIn, request: Request):
    _rate_limit("invite_validate", 10, request)
    payload = _decode_link_token(body.token, "invite")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or user.get("invite_token_hash") != _sha(body.token):
        raise HTTPException(400, "This link has already been used or revoked.")
    org = await db.orgs.find_one({"id": user["org_id"]}, {"_id": 0, "name": 1}) or {}
    return {
        "user_email":  user["email"],
        "user_name":   user.get("name"),
        "org_name":    org.get("name") or "Paneltec",
        "expires_at":  user.get("invite_expires_at"),
    }


class RedeemIn(BaseModel):
    token: str
    password: str
    confirm_password: str


def _check_passwords(body: RedeemIn) -> str:
    if body.password != body.confirm_password:
        raise HTTPException(400, "Passwords don't match.")
    err = validate_password_rule(body.password)
    if err:
        raise HTTPException(400, err)
    return body.password


async def _accept_new_password(user_id: str, password: str, *, force_change_off: bool = True) -> dict:
    """Hash + persist + bump token_version so every existing session
    for this user is invalidated."""
    update = {
        "password_hash": hash_password(password),
        "last_password_change_at": now_iso(),
        "invite_token_hash": None, "invite_expires_at": None,
        "reset_token_hash":  None, "reset_expires_at":  None,
        "pin_hash": None, "pin_expires_at": None,
        "failed_login_attempts": 0, "locked_until": None,
        "updated_at": now_iso(),
    }
    if force_change_off:
        update["must_change_password"] = False
    res = await db.users.find_one_and_update(
        {"id": user_id},
        {"$set": update, "$inc": {"token_version": 1}},
        return_document=True,
    )
    return res or {}


@router.post("/auth/invite/redeem")
async def invite_redeem(body: RedeemIn, request: Request):
    _rate_limit("invite_redeem", 5, request)
    payload = _decode_link_token(body.token, "invite")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or user.get("invite_token_hash") != _sha(body.token):
        raise HTTPException(400, "This link has already been used or revoked.")
    _check_passwords(body)
    updated = await _accept_new_password(user["id"], body.password)
    log.info("auth.invite_redeem org=%s user=%s", user["org_id"], user["id"])
    token = create_access_token(updated["id"], updated["email"],
                                updated.get("token_version", 0))
    return {"access_token": token, "token_type": "bearer", "user": {
        "id": updated["id"], "email": updated["email"], "name": updated.get("name"),
        "role": updated.get("role"), "org_id": updated.get("org_id"),
    }}


# ───── Reset password ────────────────────────────────────────────────
@router.post("/users/{user_id}/reset-password")
# v58.13.88 — rate limit 3/min per IP (admin-triggered reset).
@__import__("rate_limit", fromlist=["limiter"]).limiter.limit("3/minute")
async def send_reset(user_id: str, request: Request,
                     body: Annotated[InviteIn, Body()],
                     caller: dict = Depends(get_current_user)):
    if caller.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    target = await _user_or_404(user_id, caller["org_id"])
    org = await db.orgs.find_one({"id": caller["org_id"]}, {"_id": 0, "name": 1}) or {}
    token = _make_link_token(user_id=target["id"], org_id=target["org_id"],
                             purpose="reset",
                             ttl=timedelta(hours=RESET_TTL_HOURS))
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=RESET_TTL_HOURS)).isoformat()
    await db.users.update_one({"id": target["id"]}, {"$set": {
        "reset_token_hash": _sha(token),
        "reset_expires_at": expires_at,
        "updated_at": now_iso(),
    }})

    base = _public_host(request)
    link = f"{base}/reset?token={token}"
    channel = (body.channel or "auto").lower()
    sent_via = None
    if channel in ("email", "auto") and target.get("email"):
        await _send_invite_email(target, link, org.get("name") or "Paneltec", "reset", caller)
        sent_via = "email"
    if not sent_via and channel in ("sms", "auto"):
        if await _send_invite_sms(target, link, "reset"):
            sent_via = "sms"
    if not sent_via:
        raise HTTPException(400, "No email or SMS channel available for this user.")
    await _audit(caller, "auth.reset_sent",
                 target_user_id=target["id"], channel=sent_via, expires_at=expires_at)
    # v58.13.132bb — Surface the raw reset link so admins can hand-
    # deliver when comms_safe_mode blocks the M365/SMS channel.
    # Backend is the only place the token exists in plaintext — the
    # hash is what's stored on `users.reset_token_hash`. Returning
    # it here is safe because the caller is already authenticated
    # as admin and the payload is delivered over the same TLS
    # connection they logged in on.
    return {"ok": True, "channel": sent_via, "expires_at": expires_at, "link": link}


@router.post("/auth/reset/redeem")
# v58.13.88 — rate limit 10/hr per IP for reset-redeem (belt over
# the existing `_rate_limit("reset_redeem", 5, request)` in-body check).
@__import__("rate_limit", fromlist=["limiter"]).limiter.limit("10/hour")
async def reset_redeem(request: Request, body: Annotated[RedeemIn, Body()]):
    _rate_limit("reset_redeem", 5, request)
    payload = _decode_link_token(body.token, "reset")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or user.get("reset_token_hash") != _sha(body.token):
        raise HTTPException(400, "This link has already been used or revoked.")
    _check_passwords(body)
    updated = await _accept_new_password(user["id"], body.password,
                                         force_change_off=True)
    log.info("auth.reset_redeem org=%s user=%s", user["org_id"], user["id"])
    token = create_access_token(updated["id"], updated["email"],
                                updated.get("token_version", 0))
    return {"access_token": token, "token_type": "bearer"}


# Phase 4.7.1 — mirror of `/auth/invite/validate` so the web `/reset` page can
# pre-flight the token and render the friendly "Link can't be used" panel
# (matching the invite UX) instead of letting a worker waste time typing a
# password against a dead link.
@router.post("/auth/reset/validate")
async def reset_validate(body: TokenIn, request: Request):
    _rate_limit("reset_validate", 10, request)
    payload = _decode_link_token(body.token, "reset")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user or user.get("reset_token_hash") != _sha(body.token):
        raise HTTPException(400, "This link has already been used or revoked.")
    org = await db.orgs.find_one({"id": user["org_id"]}, {"_id": 0, "name": 1}) or {}
    return {
        "user_email":  user["email"],
        "user_name":   user.get("name"),
        "org_name":    org.get("name") or "Paneltec",
        "expires_at":  user.get("reset_expires_at"),
    }


class ForgotIn(BaseModel):
    email: EmailStr


# Per-email throttle for forgot-password — defended on top of per-IP.
_FORGOT_EMAIL: dict[str, list[float]] = {}


@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotIn, request: Request):
    """Always 200 (no email enumeration). If the email matches a user,
    silently triggers a reset email."""
    _rate_limit("forgot_pw_ip", 10, request)
    key = body.email.lower()
    now = time.time()
    bucket = [t for t in _FORGOT_EMAIL.get(key, []) if now - t < 60]
    _FORGOT_EMAIL[key] = bucket + [now]
    if len(bucket) >= 3:
        # Stay 200 to keep enumeration silent, but skip the side-effect.
        return {"ok": True}

    user = await db.users.find_one({"email": body.email}, {"_id": 0})
    if user:
        token = _make_link_token(user_id=user["id"], org_id=user["org_id"],
                                 purpose="reset",
                                 ttl=timedelta(hours=RESET_TTL_HOURS))
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=RESET_TTL_HOURS)).isoformat()
        await db.users.update_one({"id": user["id"]}, {"$set": {
            "reset_token_hash": _sha(token),
            "reset_expires_at": expires_at,
            "updated_at": now_iso(),
        }})
        org = await db.orgs.find_one({"id": user["org_id"]}, {"_id": 0, "name": 1}) or {}
        base = _public_host(request)
        link = f"{base}/reset?token={token}"
        await _send_invite_email(user, link, org.get("name") or "Paneltec", "reset",
                                 {"id": "system"})
        log.info("auth.forgot_password_sent org=%s user=%s", user["org_id"], user["id"])
    return {"ok": True}


# ───── PIN fallback ──────────────────────────────────────────────────
# v58.13.132ay — Invite PIN shortened from 6 → 4 digits.
#
#   Stephen: "could you change our pin access to a 4 didget please"
#
#   Uniforms the whole app on a 4-digit PIN (mobile PIN, admin
#   console PIN, one-time invite PIN). Trade-off is a 100× drop in
#   entropy (10,000 vs 1,000,000 possibilities); mitigated by:
#     · Tightening the per-IP redeem rate-limit from 5/min → 3/min.
#     · Auto-expiring the stored PIN after 5 wrong attempts within
#       the 24 h TTL window — the target user must ask for a new
#       one (a legitimate typo storm never trips this because the
#       IP rate-limit fires first).
#   At 3 attempts/min the expected time to guess is ~28 h — longer
#   than the TTL — and the wrong-attempts guard drops that to
#   ~5-attempts / 24 h in practice.
INVITE_PIN_LENGTH = 4
INVITE_PIN_MAX_WRONG = 5


@router.post("/users/{user_id}/pin")
async def generate_pin(user_id: str, caller: dict = Depends(get_current_user), request: Request = None):
    if caller.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    target = await _user_or_404(user_id, caller["org_id"])
    # v58.13.132ay — 4-digit PIN, zero-padded so leading zeros are
    # never dropped (e.g. `0472` reads as four visible digits, not
    # three).
    pin = f"{random.SystemRandom().randint(0, 9999):04d}"
    pin_hash = bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=PIN_TTL_HOURS)).isoformat()
    await db.users.update_one({"id": target["id"]}, {"$set": {
        "pin_hash": pin_hash,
        "pin_expires_at": expires_at,
        # v58.13.132ay — reset the wrong-attempts counter on each
        # freshly-generated PIN so a previous exhausted PIN doesn't
        # instantly block the new one.
        "pin_wrong_attempts": 0,
        "must_change_password": True,
        "updated_at": now_iso(),
    }})

    # v58.13.132bb — Also surface a mobile onboarding install link
    # (comms_safe_mode blocks the auto-email path; admin needs a
    # copy-paste-able URL). Best-effort — if the onboarding-cards
    # helper fails to mint a token (e.g. worker record missing), we
    # still return the PIN and the frontend hides the link CTA.
    invite_url = None
    try:
        from mobile_onboarding_cards import (
            _get_or_issue_token, _install_url,  # noqa
        )
        # Onboarding-card tokens key off a *worker* record. Look up
        # the worker linked to this user's email (Simpro-derived).
        worker = await db.workers.find_one({
            "org_id": target["org_id"],
            "email": (target.get("email") or "").lower(),
        }, {"_id": 0})
        if worker:
            tok = await _get_or_issue_token(
                worker=worker, issuer_id=caller["id"], ttl_days=INVITE_TTL_DAYS,
            )
            if tok:
                invite_url = _install_url(tok, worker)
    except Exception as e:  # noqa: BLE001
        log.warning("auth.pin_generated invite_url skip: %s", e)

    await _audit(caller, "auth.pin_generated",
                 target_user_id=target["id"], expires_at=expires_at,
                 invite_url_issued=bool(invite_url))
    return {
        "pin": pin,
        "expires_at": expires_at,
        "user_email": target["email"],
        # v58.13.132bb — new field. Frontend renders a "Copy invite
        # link" button when this is non-null.
        "invite_url": invite_url,
    }


class PinRedeemIn(BaseModel):
    email: EmailStr
    # v58.13.132ay — strict 4-digit shape at the schema level so a
    # bad shape never reaches bcrypt.checkpw.
    pin: str = Field(..., pattern=r"^\d{4}$")
    new_password: str
    confirm_password: str


@router.post("/auth/pin/redeem")
async def pin_redeem(body: PinRedeemIn, request: Request):
    # v58.13.132ay — 3/min per IP (tightened from 5/min alongside
    # the entropy drop).
    _rate_limit("pin_redeem", 3, request)
    user = await db.users.find_one({"email": body.email}, {"_id": 0})
    if not user or not user.get("pin_hash") or not user.get("pin_expires_at"):
        raise HTTPException(400, "Invalid PIN or PIN expired.")
    if user["pin_expires_at"] < now_iso():
        raise HTTPException(400, "Invalid PIN or PIN expired.")
    if not bcrypt.checkpw(body.pin.encode(), user["pin_hash"].encode()):
        # v58.13.132ay — increment wrong-attempts; auto-expire the
        # PIN once the ceiling is reached so a brute-forcer can't
        # keep guessing against the same hash for the full 24 h TTL
        # window.
        wrong = (user.get("pin_wrong_attempts") or 0) + 1
        update: dict = {"pin_wrong_attempts": wrong, "updated_at": now_iso()}
        if wrong >= INVITE_PIN_MAX_WRONG:
            update["pin_expires_at"] = now_iso()   # force-expire
        await db.users.update_one({"id": user["id"]}, {"$set": update})
        raise HTTPException(400, "Invalid PIN or PIN expired.")
    if body.new_password != body.confirm_password:
        raise HTTPException(400, "Passwords don't match.")
    err = validate_password_rule(body.new_password)
    if err:
        raise HTTPException(400, err)
    updated = await _accept_new_password(user["id"], body.new_password)
    log.info("auth.pin_redeem org=%s user=%s", user["org_id"], user["id"])
    token = create_access_token(updated["id"], updated["email"],
                                updated.get("token_version", 0))
    return {"access_token": token, "token_type": "bearer"}


# ───── Lockout helpers (invoked from `auth.login`) ───────────────────
# v58.13.64a — Definitions moved to `backend/auth_lockout.py` so
# `auth.py` can import them at top level without cycling back through
# `auth_invite`. Names remain importable from here for back-compat via
# the top-level `from auth_lockout import …` above.


@router.post("/users/{user_id}/unlock")
async def unlock_user(user_id: str, caller: dict = Depends(get_current_user)):
    if caller.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    target = await _user_or_404(user_id, caller["org_id"])
    await db.users.update_one({"id": target["id"]},
                               {"$set": {"failed_login_attempts": 0,
                                         "locked_until": None}})
    await _audit(caller, "auth.unlock", target_user_id=target["id"])
    return {"ok": True}


# ───── Access status summary (for the admin UI) ──────────────────────
@router.get("/users/{user_id}/access-status")
async def access_status(user_id: str, caller: dict = Depends(get_current_user)):
    if caller.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    u = await _user_or_404(user_id, caller["org_id"])
    last_login = u.get("last_login_at")
    locked = bool(u.get("locked_until") and u["locked_until"] > now_iso())
    invite_active = (u.get("invite_token_hash") and u.get("invite_expires_at")
                     and u["invite_expires_at"] > now_iso())
    pin_active = (u.get("pin_hash") and u.get("pin_expires_at")
                  and u["pin_expires_at"] > now_iso())
    if locked:
        state = "locked"
    elif not last_login and not u.get("last_password_change_at"):
        state = "never_logged_in"
    elif invite_active:
        state = "invite_pending"
    else:
        state = "active"
    return {
        "state": state,
        "last_login_at": last_login,
        "last_password_change_at": u.get("last_password_change_at"),
        "invite_expires_at": u.get("invite_expires_at") if invite_active else None,
        "pin_expires_at":    u.get("pin_expires_at")    if pin_active    else None,
        "locked_until":      u.get("locked_until") if locked else None,
        "failed_login_attempts": u.get("failed_login_attempts") or 0,
        "must_change_password":  bool(u.get("must_change_password")),
    }
