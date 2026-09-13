"""JWT + bcrypt auth — Bearer tokens in Authorization header."""
import logging
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from db import db
from models import LoginIn, SignupIn, TokenOut, UserOut, new_id, now_iso
# v58.13.64a — Lockout helpers extracted to a leaf module so login can
# call `is_locked` / `record_login_attempt` from a top-level import
# instead of the function-local `from auth_invite import …` that
# used to sit inside `login()`. See `backend/auth_lockout.py`.
from auth_lockout import is_locked, record_login_attempt

JWT_ALGORITHM = "HS256"
JWT_EXP_DAYS = 30

bearer_scheme = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/auth", tags=["auth"])
_log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# v160.3.9.36 (Phase 5) — Legacy role-string derivation shim.
#
# Phase 5's goal is to make `role_id` + Phase-6 token layer the
# ONLY authoritative source for authorisation, while keeping
# `user["role"]` populated so the ~65 legacy `user.role`-string
# gates scattered across the codebase (audited in
# `phase5b_bucket_a_backlog.md`) continue to work as safe
# redundancies behind `require_permission()`.
#
# `get_current_user()` calls `_derive_legacy_role(role_id)` after
# hydrating the user from Mongo and OVERWRITES `user["role"]` with
# the derived value. Any drift between the stored `role` string
# and the authoritative `role_id` is therefore corrected on every
# request. Downstream code that reads `user["role"]` reads a
# value that came from `role_id`, not the DB's raw legacy field.
#
# Mapping rules:
#   • Seeded role_ids that ARE legacy strings (admin, worker,
#     supervisor, hseq_lead, auditor, contractor_rep, …) →
#     identity mapping.
#   • DB-seeded role_ids that DO NOT have a legacy-string twin
#     (hseq_manager, responsible_manager, general_user, …) →
#     mapped to the closest legacy string (hseq_lead / manager /
#     worker) so legacy allow-lists still fire correctly.
#   • Dynamic `custom_*` role_ids → look up `legacy_role_alias`
#     from the roles doc if set, else fall back to "worker"
#     (least privilege).
#   • None role_id → return None (legacy straggler; caller must
#     leave any existing `user["role"]` untouched).
#
# TTL-cached (30s) so we don't hit Mongo for `custom_*` lookups
# on every request. Cache is cleared on any roles-catalogue
# mutation via `bust_legacy_role_cache()`.
# ─────────────────────────────────────────────────────────────

# Direct role_id → legacy-string map. Covers everything that was
# in ROLE_DEFAULTS + everything currently seeded in db.roles as
# `source="seed"` (verified 2026-08-03).
_LEGACY_SEEDED_MAP: dict[str, str] = {
    # Identity — role_id already matches a legacy allow-list string
    "admin":                     "admin",
    "worker":                    "worker",
    "supervisor":                "supervisor",
    "hseq_lead":                 "hseq_lead",
    "auditor":                   "auditor",
    "contractor_rep":            "contractor_rep",
    "contractor_rep_submit_only":"contractor_rep_submit_only",
    "manager":                   "manager",
    "hr_lead":                   "hr_lead",
    "owner":                     "owner",
    # DB-only role_ids → closest legacy string
    "hseq_manager":              "hseq_lead",
    "hseq_manager_creator":      "hseq_lead",
    "hseq_manager_readonly":     "hseq_lead",
    "responsible_manager":       "manager",
    "report_emailing_admin":     "manager",
    "training_inductions_only":  "worker",
    "general_user":              "worker",
    "mechanic":                  "worker",
}

_LEGACY_ROLE_CACHE: dict[str, tuple[float, str]] = {}
_LEGACY_ROLE_CACHE_TTL = 30.0  # seconds


def bust_legacy_role_cache(role_id: Optional[str] = None) -> None:
    """Invalidate the TTL cache. Called from roles_catalogue mutations
    so a freshly-created / updated custom_* role's legacy alias flows
    through immediately. Passing role_id=None clears the whole cache."""
    global _LEGACY_ROLE_CACHE
    if role_id is None:
        _LEGACY_ROLE_CACHE = {}
    else:
        _LEGACY_ROLE_CACHE.pop(role_id, None)


async def _derive_legacy_role(role_id: Optional[str]) -> Optional[str]:
    """Map a `role_id` to its legacy `role`-string equivalent.
    See module-level shim comment for the mapping rules."""
    if not role_id:
        return None
    hit = _LEGACY_SEEDED_MAP.get(role_id)
    if hit is not None:
        return hit
    # Custom or otherwise unknown role_id → check cache then DB.
    now = time.monotonic()
    cached = _LEGACY_ROLE_CACHE.get(role_id)
    if cached and (now - cached[0] < _LEGACY_ROLE_CACHE_TTL):
        return cached[1]
    try:
        doc = await db.roles.find_one(
            {"role_id": role_id, "is_active": True},
            {"_id": 0, "legacy_role_alias": 1},
        )
    except Exception:  # never break auth on a Mongo blip
        return "worker"
    alias = (doc or {}).get("legacy_role_alias") or "worker"
    _LEGACY_ROLE_CACHE[role_id] = (now, alias)
    return alias


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, token_version: int = 0,
                        jti: Optional[str] = None,
                        absolute_hours: Optional[int] = None) -> str:
    # Phase 3.16 — `jti` lets the active_sessions tracker look this token
    # up on every request; `absolute_hours` lets per-role caps override the
    # default lifetime. Caller (login flow) must pass both.
    exp_hours = absolute_hours if absolute_hours is not None else JWT_EXP_DAYS * 24
    payload = {
        "sub": user_id,
        "email": email,
        "tv": token_version,
        "exp": datetime.now(timezone.utc) + timedelta(hours=exp_hours),
        "type": "access",
    }
    if jti:
        payload["jti"] = jti
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


def _to_user_out(doc: dict) -> dict:
    """Strip Mongo _id and password_hash, return JSON-safe user.
    v160.3.9.30 (G2 fix) — surface company_id + role_id + activation_status
    so FE + tests can read the scope-context of contractor_rep users."""
    return {
        "id": doc["id"],
        "email": doc["email"],
        "name": doc["name"],
        "role": doc["role"],
        "org_id": doc["org_id"],
        "workspace_ids": doc.get("workspace_ids", []),
        "company_id": doc.get("company_id"),
        "role_id": doc.get("role_id"),
        "activation_status": doc.get("activation_status"),
        "created_at": doc["created_at"],
    }


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    token = None
    if creds and creds.scheme.lower() == "bearer":
        token = creds.credentials
    else:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    # v160.3.4b — file-serving endpoints can't attach a Bearer header
    # when the URL is opened from `<a target="_blank">` or `<img src>`.
    # Accept a short-lived download-scoped JWT via `?token=` query.
    # NEVER accept the long-lived access JWT via query — that would leak
    # 30-day credentials into server logs & referer headers.
    if not token:
        qtok = request.query_params.get("token")
        if qtok:
            try:
                probe = jwt.decode(qtok, _secret(), algorithms=[JWT_ALGORITHM])
            except jwt.InvalidTokenError:
                probe = None
            if probe and probe.get("type") == "download":
                token = qtok
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated",
                            headers={"X-Auth-Reason": "jwt-missing"})
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired",
                            headers={"X-Auth-Reason": "jwt-expired"})
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token",
                            headers={"X-Auth-Reason": "jwt-invalid"})

    # v58.13.132j — Preview-mode JWT support for the Permission Presets
    # admin's Live Preview iframe. Preview tokens are minted by
    # `/api/mobile/preview-user` and:
    #   • carry `type: "preview"`, `preview: true`, short 15-min expiry
    #   • return a synthetic user (no DB row exists for these ids)
    #   • only tolerate SAFE http methods — writes are rejected as 403
    if payload.get("type") == "preview" and payload.get("preview"):
        if request.method.upper() not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(
                status_code=403,
                detail="preview_mode_read_only",
                headers={"X-Auth-Reason": "preview-readonly"},
            )
        # v58.13.132o — when the preview token carries `preview_worker_id`,
        # scope the synthetic user by the real worker's email so downstream
        # `/mobile/home` / `/mobile/daily-jobs/today` / `/forms/templates`
        # resolve that worker's actual data. Write-block still enforced
        # above.
        worker_email = payload.get("email")
        preview_worker_id = payload.get("preview_worker_id")
        preview_scope = payload.get("preview_scope")
        preview_modules = payload.get("preview_modules") or []
        synthetic = {
            "id": payload["sub"],
            "email": worker_email or f"{payload['sub']}@preview.paneltec.local",
            "name": f"Preview · {payload.get('role_id') or 'role'}",
            "role": payload.get("role") or "worker",
            "role_id": payload.get("role_id"),
            "org_id": payload["org_id"],
            "workspace_ids": [],
            "company_id": None,
            "activation_status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "preview": True,
            "preview_worker_id": preview_worker_id,
            "preview_scope": preview_scope,
            "preview_modules": preview_modules,
        }
        return synthetic

    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found",
                            headers={"X-Auth-Reason": "jwt-invalid"})

    # Token-version check — bumped on disable/reactivate to immediately revoke tokens.
    token_tv = payload.get("tv", 0)
    user_tv = user.get("token_version", 0)
    if token_tv != user_tv:
        raise HTTPException(status_code=401, detail="Token revoked",
                            headers={"X-Auth-Reason": "token-revoked"})

    user.pop("password_hash", None)

    # v160.3.7d — Attach the JWT's `jti` to the user dict so downstream
    # handlers (bulk-revoke, single-revoke) can identify the caller's own
    # current session WITHOUT re-parsing the raw token from the request
    # headers. Previously handlers did their own decode which occasionally
    # returned None and triggered a broken "drop everything owned by this
    # user" fallback (Stephen's 500 dev sessions were all his own, so
    # bulk-revoke deleted zero rows).
    jti = payload.get("jti")
    if jti:
        user["jti"] = jti

    # v58.13.87 — Populate the send-context ContextVar so outbound
    # comms boundaries (`graph_send_mail`, `safe_send_sms`,
    # `tm_send`) can refuse to fire when no live HTTP request is on
    # the stack. See `backend/send_context.py`.
    try:
        from send_context import set_send_context
        set_send_context(user)
    except Exception:  # noqa: BLE001
        # Never let a context write fail the request — worst case
        # the send boundary refuses due to missing context, which
        # is the safer failure mode.
        pass

    # Phase 3.16 — session idle enforcement. Imported lazily to avoid a
    # circular import (session_timeout imports auth.get_current_user).
    # Hard-fails open if anything weird happens (e.g. db down): the goal
    # is to enforce idle limits, not to break the app on a Mongo blip.
    jti = payload.get("jti")
    if jti:
        try:
            from session_timeout import touch_and_check_session
            reason = await touch_and_check_session(jti, user)
            if reason == "session_idle_timeout":
                raise HTTPException(
                    status_code=401, detail="session_idle_timeout",
                    headers={"X-Auth-Reason": "session-idle"},
                )
        except HTTPException:
            raise
        except Exception:
            pass  # never break auth on a tracking blip

    # v160.3.9.36 (Phase 5) — Legacy role-string derivation shim.
    # `user["role"]` is now an authoritative *derivative* of
    # `user["role_id"]`. Every legacy `user.role`-string gate in the
    # codebase thereby reads a value that was itself sourced from
    # the DB's authoritative `role_id`, eliminating drift.
    # See the shim block near the top of this file for the full
    # mapping rules. Backlog for per-site migration lives at
    # /app/memory/permissions_redesign/phase5b_bucket_a_backlog.md.
    role_id = user.get("role_id")
    if role_id:
        derived = await _derive_legacy_role(role_id)
        if derived is not None:
            if derived != user.get("role"):
                user["role"] = derived
        user["_legacy_role_derived"] = True
    else:
        # Legacy straggler: no role_id set. Leave `user["role"]`
        # untouched (backwards-compat for pre-migration accounts)
        # and log at WARN so ops can find and fix them.
        legacy = user.get("role")
        if legacy:
            _log.warning(
                "phase5.straggler user_id=%s email=%s role=%r role_id=<missing>",
                user.get("id"), user.get("email"), legacy,
            )
    return user


async def get_current_user_optional(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[dict]:
    """v58.13.47 — Optional-auth variant for telemetry endpoints.
    Returns the resolved user dict when a valid Bearer token is
    present; returns `None` on ANY failure (missing token, expired,
    invalid, revoked, idle timeout, unknown user). NEVER raises —
    analytics endpoints that Depends() on this stay open to
    anonymous traffic.

    Do NOT use this for anything that reads or writes user data.
    It's a pass-through capture used only to enrich telemetry rows
    with a `user_id` when we happen to have one."""
    try:
        return await get_current_user(request, creds)
    except HTTPException:
        return None
    except Exception:  # noqa: BLE001 — telemetry must never throw
        return None


def require_roles(*roles: str):
    """DEPRECATED (Phase 5 · v160.3.9.36). Prefer
    `permissions.require_permission(resource, action)` — this legacy
    dep gates on the derived `user["role"]` string, which is fine
    for backwards compat (the Phase-5 shim keeps `user["role"]` in
    sync with `role_id`) but does not participate in the token
    permission matrix. Kept live for the ~20 endpoints in
    `integrations_simpro.py` and `simpro_zip_import.py` that still
    depend on it; per-site migration is tracked in
    `phase5b_bucket_a_backlog.md`."""
    async def _checker(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user
    return _checker


# ---------- Endpoints ----------

@router.post("/signup", response_model=TokenOut)
async def signup(body: SignupIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already registered")

    # Create org + default workspace for fresh signups
    org_id = new_id()
    ws_id = new_id()
    org_name = body.org_name or f"{body.name}'s organisation"
    await db.orgs.insert_one({"id": org_id, "name": org_name, "slug": org_id[:8], "created_at": now_iso()})
    await db.workspaces.insert_one({"id": ws_id, "org_id": org_id, "name": "Default workspace", "created_at": now_iso()})

    user_id = new_id()
    user_doc = {
        "id": user_id,
        "email": email,
        "password_hash": hash_password(body.password),
        "name": body.name,
        "role": "admin",  # signups own their org
        "org_id": org_id,
        "workspace_ids": [ws_id],
        "token_version": 0,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, email, 0)
    return TokenOut(access_token=token, user=UserOut(**_to_user_out(user_doc)))


@router.post("/login", response_model=TokenOut)
# v58.13.88 — rate limit 5/min per IP. On 429 the frontend surfaces a
# toast with Retry-After. Complements the per-account lockout in
# `is_locked()` below (which is 5 failures / 15 min per email).
@__import__("rate_limit", fromlist=["limiter"]).limiter.limit("5/minute")
async def login(request: Request, body: LoginIn):
    email = body.email.lower()
    # Phase 4.7 — lockout pre-check. Locked accounts return 423 with a
    # friendly message; admins can unlock via /api/users/{id}/unlock.
    if await is_locked(email):
        raise HTTPException(status_code=423,
                            detail="Account temporarily locked after too many failed attempts. "
                                   "Try again in 15 minutes or ask your admin to unlock.",
                            headers={"X-Auth-Reason": "locked"})
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        await record_login_attempt(email, success=False)
        # v58.13.132du — When a legitimate user hasn't completed
        # first-sign-in yet (has `must_change_password=true` AND a
        # live `reset_token_hash` or `pin_hash`), the naked
        # "Invalid email or password" response leaves them
        # thrashing on the login form when they should be opening
        # the reset link in their inbox instead. We keep the
        # 401 body identical to preserve anti-enumeration, but
        # surface an `X-Auth-Reason` header so the FE can render
        # a small "Have an invite email or reset link?" nudge
        # under the form. Only fired when the user record exists
        # AND has the pending-first-signin fingerprint — the
        # header never leaks any user existence info a bad-faith
        # caller couldn't already deduce.
        extra_headers: dict = {}
        if user and user.get("must_change_password"):
            _now = now_iso()
            has_live_reset = bool(user.get("reset_token_hash")
                                   and (user.get("reset_expires_at") or "") > _now)
            has_live_pin = bool(user.get("pin_hash")
                                and (user.get("pin_expires_at") or "") > _now)
            if has_live_reset or has_live_pin:
                extra_headers["X-Auth-Reason"] = "pending-first-signin"
        raise HTTPException(status_code=401,
                            detail="Invalid email or password",
                            headers=extra_headers or None)
    if user.get("status") == "disabled":
        raise HTTPException(status_code=401, detail="Account disabled — contact your administrator",
                            headers={"X-Auth-Reason": "account-disabled"})
    # v160.3.9.26 — Simpro-created users land as `pending_activation`
    # until an admin picks a role. Block sign-in with 403 + friendly detail
    # so the UI can show a helpful message and won't silently 401.
    if user.get("activation_status") == "pending_activation":
        await record_login_attempt(email, success=False)
        raise HTTPException(status_code=403,
                            detail="Your account is being set up. Please contact your administrator to activate it.",
                            headers={"X-Auth-Reason": "activation-pending"})
    await record_login_attempt(email, success=True)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now_iso()}})
    # Phase 3.16 — embed `jti`, set absolute_hours from per-role settings,
    # register the active session row for the idle-watch middleware.
    try:
        from session_timeout import effective_for_user, new_jti, register_session
        from session_history import extract_request_metadata
        eff = await effective_for_user(user)
        jti = new_jti()
        absolute_hours = eff["absolute_hours"]
        remember_me = bool(getattr(body, "remember_me", False))
        if remember_me:
            absolute_hours = max(absolute_hours, 30 * 24)  # 30-day absolute cap
        token = create_access_token(user["id"], user["email"],
                                    user.get("token_version", 0),
                                    jti=jti, absolute_hours=absolute_hours)
        meta = extract_request_metadata(request)
        await register_session(jti, user, remember_me=remember_me)
        # Phase 3.21 — enrich the live session row with IP + UA so the
        # session history that's written when this row dies carries the
        # auditor metadata.
        if meta:
            await db.active_sessions.update_one(
                {"jti": jti}, {"$set": meta},
            )
    except Exception:
        # Fall back to legacy issuance if anything in the session-timeout
        # path explodes — auth must never go down.
        token = create_access_token(user["id"], user["email"], user.get("token_version", 0))
    return TokenOut(access_token=token, user=UserOut(**_to_user_out(user)))


@router.get("/me", response_model=None)
async def me(user: dict = Depends(get_current_user)):
    from permissions import effective_for  # avoid circular at import time
    return {
        **_to_user_out(user),
        "effective_permissions": await effective_for(user),
    }


@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)):
    # Phase 3.21 — record an "explicit_logout" history row before the
    # stateless JWT drops. Best-effort: if anything fails, /logout still
    # returns ok so the client can complete the sign-out flow.
    try:
        from session_history import record_session_end
        jti = user.get("jti")
        if jti:
            await record_session_end(jti, user["org_id"], "explicit_logout",
                                     fallback_user_id=user["id"])
            await db.active_sessions.delete_one(
                {"jti": jti, "org_id": user["org_id"]},
            )
    except Exception:
        pass
    return {"ok": True}


# v160.3.4b — short-lived JWT for file-serving endpoints that must be
# opened via `<a href>` or `<img src>` (which cannot attach a Bearer
# header). The frontend fetches this before rendering a file link and
# appends the returned token as `?token=<jwt>`. Token TTL is 15 minutes
# so it stays out of long-lived caches / referer headers.
DOWNLOAD_TOKEN_TTL_MINUTES = 15


@router.post("/download-token")
async def issue_download_token(user: dict = Depends(get_current_user)):
    """Return a 15-minute download-scoped JWT carrying the caller's
    identity. Accepted by any file endpoint via `?token=<jwt>`. Never
    accepted for API mutation endpoints."""
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "tv": user.get("token_version", 0),
        "type": "download",
        "exp": datetime.now(timezone.utc)
                + timedelta(minutes=DOWNLOAD_TOKEN_TTL_MINUTES),
    }
    tok = jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)
    return {
        "token": tok,
        "expires_in_seconds": DOWNLOAD_TOKEN_TTL_MINUTES * 60,
    }


# ---------- Account self-service ----------

import re as _re
_EMAIL_RE = _re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _validate_password(pwd: str) -> Optional[str]:
    if not pwd or len(pwd) < 8:
        return "Password must be at least 8 characters."
    has_letter = any(c.isalpha() for c in pwd)
    has_digit = any(c.isdigit() for c in pwd)
    has_special = any(not c.isalnum() for c in pwd)
    if not has_letter or not (has_digit or has_special):
        return "Password must contain a letter and at least one number or symbol."
    return None


@router.post("/change-password")
async def change_password(body: dict, user: dict = Depends(get_current_user)):
    current = (body or {}).get("current_password") or ""
    new = (body or {}).get("new_password") or ""
    # Re-fetch the user to get the password_hash (get_current_user strips it).
    doc = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not doc or not verify_password(current, doc.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    err = _validate_password(new)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if verify_password(new, doc["password_hash"]):
        raise HTTPException(status_code=400, detail="New password must differ from the current one")
    new_hash = hash_password(new)
    updated = await db.users.find_one_and_update(
        {"id": user["id"]},
        {"$set": {"password_hash": new_hash, "updated_at": now_iso()},
         "$inc": {"token_version": 1}},
        return_document=True,
        projection={"_id": 0},
    )
    fresh_token = create_access_token(updated["id"], updated["email"], updated.get("token_version", 0))
    return {"ok": True, "access_token": fresh_token}


@router.post("/update-profile")
async def update_profile(body: dict, user: dict = Depends(get_current_user)):
    body = body or {}
    patch: dict = {}
    if "name" in body and body["name"] is not None:
        name = str(body["name"]).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        patch["name"] = name
    if "email" in body and body["email"] is not None:
        new_email = str(body["email"]).lower().strip()
        if not _EMAIL_RE.match(new_email):
            raise HTTPException(status_code=400, detail="Enter a valid email address")
        if new_email != user["email"]:
            clash = await db.users.find_one({"email": new_email, "id": {"$ne": user["id"]}})
            if clash:
                raise HTTPException(status_code=400, detail="Email already in use")
            patch["email"] = new_email
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")

    patch["updated_at"] = now_iso()
    update_op: dict = {"$set": patch}
    # Email change → bump token_version (existing tokens carry old email claim).
    if "email" in patch:
        update_op["$inc"] = {"token_version": 1}
    updated = await db.users.find_one_and_update(
        {"id": user["id"]},
        update_op,
        return_document=True,
        projection={"_id": 0, "password_hash": 0},
    )
    fresh_token = create_access_token(updated["id"], updated["email"], updated.get("token_version", 0))
    return {"ok": True, "access_token": fresh_token, "user": _to_user_out(updated)}


@router.post("/refresh")
async def refresh_token(user: dict = Depends(get_current_user)):
    """Rolling refresh — re-issue a fresh JWT from the user's current valid one.

    JWT TTL is already 30 days; this just gives the frontend a safe way to slide
    the window on app mount and after long idle periods. Does NOT bump
    token_version. Will fail with 401 if the existing token is already expired
    or revoked (then the user must sign in again).
    """
    fresh = create_access_token(user["id"], user["email"], user.get("token_version", 0))
    return {"access_token": fresh, "user": _to_user_out(user)}


# ---------- Simpro identity-based login ----------

class LoginWithSimproIn(BaseModel):
    email: str


@router.post("/login-with-simpro")
async def login_with_simpro(body: LoginWithSimproIn) -> TokenOut:
    """Sign in a Simpro-imported user by matching their email against the live
    Simpro `/employees` list. The org's stored Simpro API token IS the trust
    boundary — if the email shows up in Simpro for this org's configured
    companies, we trust them.

    Existing email+password users are NOT affected by this endpoint.
    """
    email = (body.email or "").lower().strip()
    if not email:
        raise HTTPException(400, "Email is required")

    # Find a matching app user (must already be imported with auth_provider=simpro)
    candidates = await db.users.find(
        {"email": email, "auth_provider": "simpro"},
        {"_id": 0, "password_hash": 0},
    ).to_list(10)
    if not candidates:
        raise HTTPException(404, "Not in Simpro — contact your admin to be imported.")
    if len(candidates) > 1:
        # Multiple orgs with same email — pick the first active one, prefer most recently used.
        candidates = sorted(
            candidates,
            key=lambda u: (u.get("status") != "active", u.get("last_login_at") or "", u.get("created_at") or ""),
            reverse=True,
        )
    user = candidates[0]

    if user.get("status") not in (None, "active", "invited"):
        raise HTTPException(401, "Account disabled — contact your admin",
                            headers={"X-Auth-Reason": "account-disabled"})

    # Verify against live Simpro using the org's saved config.
    from integrations_simpro import _company_ids, _refresh_staff_cache  # local to avoid cycle
    from integrations import hydrate_integration_config  # v40 SEC-003
    cfg_doc = await db.integration_configs.find_one(
        {"org_id": user["org_id"], "kind": "simpro"},
    )
    if not cfg_doc or cfg_doc.get("status") != "connected":
        raise HTTPException(503, "Simpro is not connected for this organisation — sign in with email/password.")
    cfg = hydrate_integration_config(cfg_doc)   # decrypt secrets on read
    ids = _company_ids(cfg)
    if not ids or not cfg.get("api_token") or not cfg.get("api_base_url"):
        raise HTTPException(503, "Simpro is not fully configured — sign in with email/password.")
    try:
        _, merged = await _refresh_staff_cache(cfg, ids, cfg["api_token"])
    except Exception as e:
        raise HTTPException(502, f"Simpro unreachable: {e}")

    hit = next(
        (m for m in merged if (m.get("email") or "").lower().strip() == email),
        None,
    )
    if not hit:
        raise HTTPException(401, "Your email is not active in Simpro right now — contact your admin.",
                            headers={"X-Auth-Reason": "simpro-not-found"})

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"last_login_at": now_iso(),
                  "status": "active",
                  "simpro_employee_id": str(hit.get("id")) if hit.get("id") is not None else user.get("simpro_employee_id"),
                  "simpro_company_id": str(hit.get("company_id")) if hit.get("company_id") is not None else user.get("simpro_company_id"),
                  "updated_at": now_iso()}},
    )
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    token = create_access_token(fresh["id"], fresh["email"], fresh.get("token_version", 0))
    return TokenOut(access_token=token, user=_to_user_out(fresh))


