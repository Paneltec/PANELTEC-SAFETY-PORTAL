"""v58.13.132ev — Per-admin tile credential vault.

Each admin stores their OWN username/password/Q&A pairs against a
tile. Storage is isolated on `user_id` — admin A can never read
admin B's credentials. Passwords + Q&A answers are AES-256-GCM
encrypted at rest with a per-user key derived from the app-level
`PANELTEC_VAULT_SECRET` env var via HKDF.

Endpoints (admin-only, per-user isolated):
  GET    /api/tile-credentials/{tile_id}           → metadata only (no plaintext)
  POST   /api/tile-credentials/{tile_id}/reveal    → { password: plaintext }, audited
  PUT    /api/tile-credentials/{tile_id}           → upsert
  DELETE /api/tile-credentials/{tile_id}           → clear
  POST   /api/tile-credentials/{tile_id}/copy-field → { value: plaintext }, audited

Startup contract: `PANELTEC_VAULT_SECRET` MUST be present in env.
Refuse to import the module (and therefore refuse to mount the
router) if it is missing.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id

log = logging.getLogger("paneltec.tile_credentials")

_VAULT_SECRET_ENV = "PANELTEC_VAULT_SECRET"
_VAULT_SECRET = os.environ.get(_VAULT_SECRET_ENV, "").encode("utf-8")
if not _VAULT_SECRET:
    raise RuntimeError(
        f"{_VAULT_SECRET_ENV} is required in the backend environment. "
        f"Add it to /app/backend/.env and restart the backend.")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_key(user_id: str) -> bytes:
    """HKDF-derive a 32-byte AES-GCM key per user from the app secret."""
    hkdf = HKDF(algorithm=hashes.SHA256(), length=32,
                salt=b"paneltec.tile_credentials.v1",
                info=user_id.encode("utf-8"))
    return hkdf.derive(_VAULT_SECRET)


def _encrypt(user_id: str, plaintext: str) -> dict:
    if plaintext is None:
        return {"ct": None, "nonce": None}
    key = _user_key(user_id)
    aes = AESGCM(key)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, plaintext.encode("utf-8"), None)
    return {"ct": ct, "nonce": nonce}


def _decrypt(user_id: str, ct: bytes, nonce: bytes) -> str:
    if ct is None or nonce is None:
        return ""
    key = _user_key(user_id)
    aes = AESGCM(key)
    return aes.decrypt(nonce, ct, None).decode("utf-8")


def _admin(user: dict) -> None:
    if (user.get("role") or user.get("role_id")) != "admin":
        raise HTTPException(status_code=403,
                            detail="Tile management is admin-only.")


def _preview(user_id: str, doc: dict) -> str:
    """Show only the last 4 chars of the stored password, masked."""
    ct = doc.get("password_ct")
    nonce = doc.get("password_nonce")
    if not ct or not nonce:
        return ""
    try:
        plain = _decrypt(user_id, ct, nonce)
    except Exception:
        return ""
    if not plain:
        return ""
    tail = plain[-4:] if len(plain) >= 4 else plain
    return "••••" + tail


class QAPairIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    answer: str = Field(min_length=0, max_length=280)


class CredentialsIn(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    qa_pairs: list[QAPairIn] = Field(default_factory=list, max_length=6)


async def _audit(user_id: str, tile_id: str, action: str,
                  detail: Optional[str] = None) -> None:
    await db.tile_credential_audit.insert_one({
        "id": new_id(), "user_id": user_id, "tile_id": tile_id,
        "action": action, "detail": detail, "timestamp": _now(),
    })


router = APIRouter(prefix="/tile-credentials", tags=["tile-credentials"])


@router.get("/{tile_id}")
async def get_credentials(tile_id: str,
                           user: dict = Depends(get_current_user)):
    _admin(user)
    doc = await db.user_tile_credentials.find_one({
        "user_id": user["id"], "tile_id": tile_id,
    })
    if not doc:
        return {"has_password": False, "username": None,
                "password_preview": "", "qa_pairs": []}
    return {
        "username": doc.get("username"),
        "has_password": bool(doc.get("password_ct")),
        "password_preview": _preview(user["id"], doc),
        "qa_pairs": [{"label": qa["label"]}
                      for qa in doc.get("qa_pairs", [])],
    }


@router.put("/{tile_id}")
async def upsert_credentials(tile_id: str, body: CredentialsIn,
                              user: dict = Depends(get_current_user)):
    _admin(user)
    org_id = user["org_id"]
    now = _now()
    update: dict = {"updated_at": now, "org_id": org_id}
    if body.username is not None:
        update["username"] = body.username.strip() or None
    if body.password is not None:
        if body.password:
            enc = _encrypt(user["id"], body.password)
            update["password_ct"] = enc["ct"]
            update["password_nonce"] = enc["nonce"]
        else:
            update["password_ct"] = None
            update["password_nonce"] = None
    if body.qa_pairs is not None:
        qa_out: list[dict] = []
        for qa in body.qa_pairs:
            label = qa.label.strip()
            if not label:
                continue
            enc = _encrypt(user["id"], qa.answer or "")
            qa_out.append({"label": label,
                            "answer_ct": enc["ct"],
                            "answer_nonce": enc["nonce"]})
        update["qa_pairs"] = qa_out
    await db.user_tile_credentials.update_one(
        {"user_id": user["id"], "tile_id": tile_id},
        {"$set": update,
         "$setOnInsert": {"id": new_id(), "created_at": now,
                          "user_id": user["id"], "tile_id": tile_id}},
        upsert=True,
    )
    await _audit(user["id"], tile_id, "upsert")
    return await get_credentials(tile_id, user)  # type: ignore[misc]


@router.delete("/{tile_id}")
async def delete_credentials(tile_id: str,
                              user: dict = Depends(get_current_user)):
    _admin(user)
    res = await db.user_tile_credentials.delete_one(
        {"user_id": user["id"], "tile_id": tile_id})
    await _audit(user["id"], tile_id, "delete")
    return {"ok": True, "deleted": res.deleted_count}


@router.post("/{tile_id}/reveal")
async def reveal_password(tile_id: str,
                           user: dict = Depends(get_current_user)):
    _admin(user)
    doc = await db.user_tile_credentials.find_one({
        "user_id": user["id"], "tile_id": tile_id})
    if not doc or not doc.get("password_ct"):
        raise HTTPException(status_code=404,
                            detail="No password stored for this tile")
    plain = _decrypt(user["id"], doc["password_ct"], doc["password_nonce"])
    await _audit(user["id"], tile_id, "reveal")
    return {"password": plain}


class CopyFieldIn(BaseModel):
    field: str  # "password" or a QA label


@router.post("/{tile_id}/copy-field")
async def copy_field(tile_id: str, body: CopyFieldIn,
                      user: dict = Depends(get_current_user)):
    _admin(user)
    doc = await db.user_tile_credentials.find_one({
        "user_id": user["id"], "tile_id": tile_id})
    if not doc:
        raise HTTPException(status_code=404, detail="No credentials stored")
    field = (body.field or "").strip()
    if field == "password":
        if not doc.get("password_ct"):
            raise HTTPException(status_code=404, detail="No password stored")
        value = _decrypt(user["id"], doc["password_ct"], doc["password_nonce"])
    elif field == "username":
        value = doc.get("username") or ""
    else:
        # QA label lookup — case-insensitive, exact match.
        qa = next((q for q in doc.get("qa_pairs", [])
                    if q["label"].lower() == field.lower()), None)
        if not qa:
            raise HTTPException(status_code=404,
                                detail=f"QA field '{field}' not found")
        value = _decrypt(user["id"], qa["answer_ct"], qa["answer_nonce"])
    await _audit(user["id"], tile_id, "copy-field", detail=field)
    return {"value": value}
