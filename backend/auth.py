"""JWT + bcrypt auth — Bearer tokens in Authorization header."""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from db import db
from models import LoginIn, SignupIn, TokenOut, UserOut, new_id, now_iso

JWT_ALGORITHM = "HS256"
JWT_EXP_DAYS = 30

bearer_scheme = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/auth", tags=["auth"])


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
    """Strip Mongo _id and password_hash, return JSON-safe user."""
    return {
        "id": doc["id"],
        "email": doc["email"],
        "name": doc["name"],
        "role": doc["role"],
        "org_id": doc["org_id"],
        "workspace_ids": doc.get("workspace_ids", []),
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
    return user


def require_roles(*roles: str):
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
async def login(body: LoginIn, request: Request):
    email = body.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("status") == "disabled":
        raise HTTPException(status_code=401, detail="Account disabled — contact your administrator",
                            headers={"X-Auth-Reason": "account-disabled"})
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
    cfg_doc = await db.integration_configs.find_one(
        {"org_id": user["org_id"], "kind": "simpro"},
    )
    if not cfg_doc or cfg_doc.get("status") != "connected":
        raise HTTPException(503, "Simpro is not connected for this organisation — sign in with email/password.")
    cfg = cfg_doc.get("config") or {}
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
