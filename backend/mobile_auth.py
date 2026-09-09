"""
Mobile onboarding + PIN auth — v58.13.132a

New endpoints for the mobile-first PIN-based auth flow:
  POST /api/mobile/onboarding/issue-token   (admin-only)
  POST /api/mobile/onboarding/redeem        (public)
  POST /api/mobile/auth/pin-set             (temp_session)
  POST /api/mobile/auth/pin-verify          (public)
  POST /api/mobile/push/register            (JWT auth)

Mongo collections:
  mobile_onboarding_tokens  — one-shot setup codes, TTL 7d
  users                     — extended with mobile_pin_hash, mobile_devices
"""
import logging
import os
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from db import db
from auth import get_current_user, create_access_token, _secret, JWT_ALGORITHM
from models import new_id, now_iso

_log = logging.getLogger(__name__)

router = APIRouter(tags=["mobile-auth"])


# ── Pydantic models ──────────────────────────────────────

class IssueTokenIn(BaseModel):
    simpro_employee_id: str
    company_id: Optional[str] = None

class IssueTokenOut(BaseModel):
    token: str
    expires_at: str
    install_url: str

class RedeemIn(BaseModel):
    token: str
    device_id: str

class PinSetIn(BaseModel):
    pin_hash: str
    device_id: str

class PinVerifyIn(BaseModel):
    pin_hash: str
    device_id: Optional[str] = None
    simpro_employee_id: Optional[str] = None


class PinStatusIn(BaseModel):
    """v58.13.132n — Look up whether the device/worker already has a PIN.

    Used by the new pin-entry screen to branch between CREATE mode
    (first-time onboarding) and ENTER mode (returning user).
    """
    device_id: Optional[str] = None
    simpro_employee_id: Optional[str] = None

class PushRegisterIn(BaseModel):
    device_token: str
    platform: str  # "ios" | "android" | "web"


# ── Helpers ───────────────────────────────────────────────

def _hash_pin(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def _verify_pin(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def _create_temp_session(user_id: str) -> str:
    """Short-lived JWT for the onboarding flow (15 min)."""
    payload = {
        "sub": user_id,
        "type": "mobile_temp",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)

def _create_mobile_jwt(user_id: str, email: str) -> str:
    """Standard mobile JWT — 90 day expiry."""
    payload = {
        "sub": user_id,
        "email": email,
        "type": "mobile",
        "scope": "mobile",
        "exp": datetime.now(timezone.utc) + timedelta(days=90),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)


# ── 1. Issue onboarding token (admin-only) ────────────────

@router.post("/mobile/onboarding/issue-token")
async def issue_onboarding_token(body: IssueTokenIn, user: dict = Depends(get_current_user)):
    # Admin gate
    role = (user.get("role") or "").lower()
    if role not in ("admin", "owner", "hseq_lead", "supervisor"):
        raise HTTPException(403, "Admin or supervisor role required")

    # Find the employee in workers collection
    worker = await db.workers.find_one(
        {"simpro_employee_id": body.simpro_employee_id, "org_id": user["org_id"]},
        {"_id": 0},
    )
    if not worker:
        raise HTTPException(404, f"No worker found with Simpro ID {body.simpro_employee_id}")

    token_str = secrets.token_urlsafe(24)
    expires = datetime.now(timezone.utc) + timedelta(days=7)

    doc = {
        "id": new_id(),
        "token": token_str,
        "simpro_employee_id": body.simpro_employee_id,
        "company_id": body.company_id or worker.get("company_id"),
        "org_id": user["org_id"],
        "issued_by": user["id"],
        "used": False,
        "expires_at": expires.isoformat(),
        "created_at": now_iso(),
    }
    await db.mobile_onboarding_tokens.insert_one(doc)

    return {
        "token": token_str,
        "expires_at": expires.isoformat(),
        "install_url": f"paneltec://onboard?token={token_str}",
    }


# ── 2. Redeem onboarding token (public) ──────────────────

@router.get("/mobile/onboarding/validate/{token}")
async def validate_onboarding_token(token: str):
    """v58.13.132ae — public read-only peek used by the QR landing
    page at /m/onboard/:token. Returns validity + a first name for
    the greeting. Never consumes the token — that's `redeem`'s job.
    """
    doc = await db.mobile_onboarding_tokens.find_one(
        {"token": token},
        {"_id": 0, "used": 1, "expires_at": 1, "simpro_employee_id": 1,
         "org_id": 1, "company_id": 1},
    )
    if not doc:
        return {"valid": False, "reason": "unknown"}

    if doc.get("used"):
        return {"valid": False, "reason": "used"}

    try:
        expires = datetime.fromisoformat(doc["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires:
            return {"valid": False, "reason": "expired",
                    "expires_at": doc["expires_at"]}
    except Exception:
        return {"valid": False, "reason": "expired"}

    # Look up worker for greeting.
    first_name = None
    worker = await db.workers.find_one(
        {"simpro_employee_id": doc["simpro_employee_id"], "org_id": doc["org_id"]},
        {"_id": 0, "first_name": 1, "company": 1, "division": 1},
    )
    if worker:
        first_name = (worker.get("first_name") or "").strip() or None

    # Derive preload division from company/division field.
    preload = "civil"
    company = ((worker or {}).get("company") or (worker or {}).get("division") or "").lower()
    if "viatec" in company:
        preload = "viatec"

    return {
        "valid": True,
        "first_name": first_name,
        "preload": preload,
        "expires_at": doc["expires_at"],
    }


@router.post("/mobile/onboarding/redeem")
async def redeem_onboarding_token(body: RedeemIn):
    doc = await db.mobile_onboarding_tokens.find_one(
        {"token": body.token, "used": False},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(400, "Invalid or already-used onboarding token")

    # Check expiry
    expires = datetime.fromisoformat(doc["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(400, "Onboarding token has expired")

    # Mark used
    await db.mobile_onboarding_tokens.update_one(
        {"token": body.token},
        {"$set": {"used": True, "used_at": now_iso(), "device_id": body.device_id}},
    )

    # Find associated worker
    worker = await db.workers.find_one(
        {"simpro_employee_id": doc["simpro_employee_id"], "org_id": doc["org_id"]},
        {"_id": 0},
    )

    # Find or create a user record for this employee
    existing_user = await db.users.find_one(
        {"simpro_employee_id": doc["simpro_employee_id"], "org_id": doc["org_id"]},
        {"_id": 0},
    )

    if not existing_user:
        # Create a mobile-only user
        user_id = new_id()
        worker_name = worker["name"] if worker else "Unknown"
        user_doc = {
            "id": user_id,
            "email": f"mobile_{doc['simpro_employee_id']}@paneltec.local",
            "name": worker_name,
            "role": "worker",
            "org_id": doc["org_id"],
            "simpro_employee_id": doc["simpro_employee_id"],
            "company_id": doc.get("company_id"),
            "workspace_ids": [],
            "activation_status": "active",
            "created_at": now_iso(),
            "mobile_devices": [],
        }
        await db.users.insert_one(user_doc)
        existing_user = user_doc

    # Determine company name
    company_name = "Paneltec Group"
    if doc.get("company_id"):
        comp = await db.companies.find_one({"id": doc["company_id"]}, {"_id": 0})
        if comp:
            company_name = comp.get("name", company_name)

    temp_session = _create_temp_session(existing_user["id"])

    return {
        "user": {
            "name": existing_user.get("name", ""),
            "simpro_employee_id": doc["simpro_employee_id"],
            "company_id": doc.get("company_id", ""),
            "company_name": company_name,
        },
        "temp_session": temp_session,
    }


# ── 3. Set PIN (with temp session) ───────────────────────

@router.post("/mobile/auth/pin-set")
async def pin_set(body: PinSetIn, request: Request):
    # Verify temp session
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Temp session required")
    token = auth_header[7:]
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid or expired temp session")

    if payload.get("type") != "mobile_temp":
        raise HTTPException(401, "Invalid session type — must use onboarding temp session")

    user_id = payload["sub"]
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")

    # Hash and store PIN
    pin_hash = _hash_pin(body.pin_hash)
    device_entry = {
        "device_id": body.device_id,
        "device_token": None,
        "registered_at": now_iso(),
    }

    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {"mobile_pin_hash": pin_hash},
            "$addToSet": {"mobile_devices": device_entry},
        },
    )

    # Issue full mobile JWT
    mobile_jwt = _create_mobile_jwt(user_id, user.get("email", ""))

    return {
        "token": mobile_jwt,
        "user": {
            "id": user_id,
            "name": user.get("name", ""),
            "email": user.get("email", ""),
            "role": user.get("role", "worker"),
            "simpro_employee_id": user.get("simpro_employee_id", ""),
            "company_id": user.get("company_id", ""),
        },
    }


# ── 4. Verify PIN (public) ───────────────────────────────

@router.post("/mobile/auth/pin-verify")
async def pin_verify(body: PinVerifyIn):
    # Find user by device_id or simpro_employee_id
    query = {}
    if body.device_id:
        query = {"mobile_devices.device_id": body.device_id}
    elif body.simpro_employee_id:
        query = {"simpro_employee_id": body.simpro_employee_id}
    else:
        raise HTTPException(400, "device_id or simpro_employee_id required")

    user = await db.users.find_one(query, {"_id": 0})
    if not user:
        raise HTTPException(404, "No mobile user found for this device")

    if not user.get("mobile_pin_hash"):
        raise HTTPException(400, "PIN not set — complete onboarding first")

    # Check lockout
    lockout = user.get("mobile_pin_lockout")
    if lockout:
        lock_until = datetime.fromisoformat(lockout["until"])
        if lock_until.tzinfo is None:
            lock_until = lock_until.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) < lock_until:
            remaining = int((lock_until - datetime.now(timezone.utc)).total_seconds())
            raise HTTPException(429, f"Account locked. Try again in {remaining}s")
        # Lockout expired — clear it
        await db.users.update_one(
            {"id": user["id"]},
            {"$unset": {"mobile_pin_lockout": ""}, "$set": {"mobile_pin_attempts": 0}},
        )

    # Verify
    if not _verify_pin(body.pin_hash, user["mobile_pin_hash"]):
        attempts = user.get("mobile_pin_attempts", 0) + 1
        update: dict = {"$set": {"mobile_pin_attempts": attempts}}
        if attempts >= 5:
            lock_until_ts = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()
            update["$set"]["mobile_pin_lockout"] = {"until": lock_until_ts, "attempts": attempts}
        await db.users.update_one({"id": user["id"]}, update)
        remaining_attempts = max(0, 5 - attempts)
        raise HTTPException(
            401,
            f"Wrong PIN. {remaining_attempts} attempt{'s' if remaining_attempts != 1 else ''} remaining."
        )

    # Success — reset attempts
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"mobile_pin_attempts": 0}, "$unset": {"mobile_pin_lockout": ""}},
    )

    mobile_jwt = _create_mobile_jwt(user["id"], user.get("email", ""))
    return {
        "token": mobile_jwt,
        "user": {
            "id": user["id"],
            "name": user.get("name", ""),
            "email": user.get("email", ""),
            "role": user.get("role", "worker"),
            "simpro_employee_id": user.get("simpro_employee_id", ""),
            "company_id": user.get("company_id", ""),
        },
    }


# ── 5. Push register (JWT auth) ──────────────────────────

@router.post("/mobile/push/register")
async def push_register(body: PushRegisterIn, user: dict = Depends(get_current_user)):
    # Upsert device token on user's mobile_devices array
    # First try to update existing device
    result = await db.users.update_one(
        {"id": user["id"], "mobile_devices.device_token": body.device_token},
        {"$set": {
            "mobile_devices.$.platform": body.platform,
            "mobile_devices.$.updated_at": now_iso(),
        }},
    )
    if result.modified_count == 0:
        # Add new device entry
        await db.users.update_one(
            {"id": user["id"]},
            {"$addToSet": {
                "mobile_devices": {
                    "device_id": None,
                    "device_token": body.device_token,
                    "platform": body.platform,
                    "registered_at": now_iso(),
                },
            }},
        )
    return {"ok": True}


# ── v58.13.132n — PIN status probe ────────────────────────
#
# The mobile pin-entry screen calls this before rendering the pad so it can
# branch between CREATE mode (no PIN on file yet) and ENTER mode (returning
# user). Public — no auth required — because the caller is by definition
# pre-JWT. Return payload is intentionally minimal (`{has_pin: bool}`) so it
# leaks nothing beyond the boolean already implied by the pin-verify 400 vs
# 401 responses.

@router.post("/mobile/auth/pin-status")
async def pin_status(body: PinStatusIn) -> dict:
    query = {}
    if body.device_id:
        query = {"mobile_devices.device_id": body.device_id}
    elif body.simpro_employee_id:
        query = {"simpro_employee_id": body.simpro_employee_id}
    else:
        raise HTTPException(400, "device_id or simpro_employee_id required")

    user = await db.users.find_one(query, {"_id": 0, "mobile_pin_hash": 1})
    return {"has_pin": bool(user and user.get("mobile_pin_hash"))}
