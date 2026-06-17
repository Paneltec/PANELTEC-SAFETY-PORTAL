"""JWT + bcrypt auth — Bearer tokens in Authorization header."""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from db import db
from models import LoginIn, SignupIn, TokenOut, UserOut, new_id, now_iso

JWT_ALGORITHM = "HS256"
JWT_EXP_DAYS = 7

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


def create_access_token(user_id: str, email: str, token_version: int = 0) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "tv": token_version,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXP_DAYS),
        "type": "access",
    }
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
async def login(body: LoginIn):
    email = body.email.lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("status") == "disabled":
        raise HTTPException(status_code=401, detail="Account disabled — contact your administrator")
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
    # Stateless JWT — client just drops the token. Endpoint exists for parity.
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
