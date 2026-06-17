"""Org user management — admins only. Permissions matrix lives in permissions.py."""
from __future__ import annotations
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user, hash_password
from db import db
from models import Role, new_id, now_iso
from permissions import (
    PERMISSIONS_SCHEMA, ROLE_DEFAULTS, effective_for, has_any_overrides,
    require_permission, upsert_overrides,
)

router = APIRouter(prefix="/users", tags=["users"])


class InviteUserIn(BaseModel):
    email: EmailStr
    name: str
    role: Role
    workspace_ids: List[str] = Field(default_factory=list)


class UpdateUserIn(BaseModel):
    name: Optional[str] = None
    role: Optional[Role] = None
    workspace_ids: Optional[List[str]] = None
    status: Optional[Literal["active", "invited", "disabled"]] = None


class PermissionsIn(BaseModel):
    overrides: dict = Field(default_factory=dict)


def _user_out(doc: dict, has_overrides: bool = False) -> dict:
    return {
        "id": doc["id"],
        "email": doc["email"],
        "name": doc["name"],
        "role": doc["role"],
        "org_id": doc["org_id"],
        "workspace_ids": doc.get("workspace_ids", []),
        "status": doc.get("status", "active"),
        "last_login_at": doc.get("last_login_at"),
        "created_at": doc.get("created_at"),
        "has_permission_overrides": has_overrides,
    }


@router.get("")
async def list_users(user: dict = Depends(require_permission("users", "view"))):
    docs = await db.users.find(
        {"org_id": user["org_id"]},
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", 1).to_list(500)
    out = []
    for d in docs:
        out.append(_user_out(d, await has_any_overrides(d["id"])))
    return out


@router.get("/{user_id}")
async def get_user(user_id: str, actor: dict = Depends(require_permission("users", "view"))):
    doc = await db.users.find_one({"id": user_id, "org_id": actor["org_id"]}, {"_id": 0, "password_hash": 0})
    if not doc:
        raise HTTPException(404, "User not found")
    return {
        **_user_out(doc, await has_any_overrides(user_id)),
        "effective_permissions": await effective_for(doc),
    }


@router.patch("/{user_id}")
async def update_user(user_id: str, body: UpdateUserIn, actor: dict = Depends(require_permission("users", "edit"))):
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not patch:
        raise HTTPException(400, "No fields to update")
    patch["updated_at"] = now_iso()
    result = await db.users.find_one_and_update(
        {"id": user_id, "org_id": actor["org_id"]},
        {"$set": patch},
        return_document=True,
        projection={"_id": 0, "password_hash": 0},
    )
    if not result:
        raise HTTPException(404, "User not found")
    return _user_out(result, await has_any_overrides(user_id))


@router.get("/{user_id}/permissions")
async def get_permissions(user_id: str, actor: dict = Depends(require_permission("users", "view"))):
    target = await db.users.find_one({"id": user_id, "org_id": actor["org_id"]}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    override_doc = await db.user_permissions.find_one({"user_id": user_id}, {"_id": 0})
    return {
        "user_id": user_id,
        "role": target["role"],
        "role_defaults": ROLE_DEFAULTS.get(target["role"], {}),
        "overrides": (override_doc or {}).get("overrides", {}),
        "effective": await effective_for(target),
        "schema": PERMISSIONS_SCHEMA,
    }


@router.put("/{user_id}/permissions")
async def put_permissions(user_id: str, body: PermissionsIn, actor: dict = Depends(require_permission("users", "edit"))):
    target = await db.users.find_one({"id": user_id, "org_id": actor["org_id"]}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    saved = await upsert_overrides(user_id, actor["org_id"], body.overrides, actor["id"])
    return {
        "user_id": user_id,
        "overrides": saved.get("overrides", {}),
        "effective": await effective_for(target),
    }


@router.post("/{user_id}/permissions/reset")
async def reset_permissions(user_id: str, actor: dict = Depends(require_permission("users", "edit"))):
    target = await db.users.find_one({"id": user_id, "org_id": actor["org_id"]}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    await db.user_permissions.delete_one({"user_id": user_id})
    return {
        "user_id": user_id,
        "overrides": {},
        "effective": await effective_for(target),
    }


@router.post("", status_code=201)
async def invite_user(body: InviteUserIn, actor: dict = Depends(require_permission("users", "edit"))):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already in use")
    # Temporary password — user resets on first sign-in via the invite link.
    temp_pwd = new_id()[:12]
    user_id = new_id()
    invite_token = new_id()
    doc = {
        "id": user_id, "email": email, "name": body.name, "role": body.role,
        "org_id": actor["org_id"], "workspace_ids": body.workspace_ids,
        "password_hash": hash_password(temp_pwd),
        "status": "invited",
        "invite_token": invite_token,
        "invited_by": actor["id"],
        "created_at": now_iso(),
    }
    await db.users.insert_one(dict(doc))

    # Queue invitation email via outbox (bypasses normal permission check).
    from email_outbox import queue_email_doc  # local import to avoid cycle
    backend_url = ""  # filled by frontend link
    signup_path = f"/signup?invite={invite_token}"
    body_html = (
        f"<p>Hi {body.name},</p>"
        f"<p>You've been invited to <strong>Paneltec Civil</strong> as a <em>{body.role}</em>.</p>"
        f"<p>Click below to set your password and start signing in:</p>"
        f"<p><a href='{signup_path}'>Accept invitation</a></p>"
        f"<p>If you didn't expect this, you can ignore the email.</p>"
    )
    await queue_email_doc(
        org_id=actor["org_id"], to=[email], subject="You've been invited to Paneltec Civil",
        body_html=body_html, attachments=[], related_record_type="user_invite",
        related_record_id=user_id, created_by=actor["id"], resource_kind="users",
        bypass_provider_attempt=False,
    )
    return _user_out(doc, False)


@router.delete("/{user_id}")
async def disable_user(user_id: str, actor: dict = Depends(require_permission("users", "edit"))):
    if user_id == actor["id"]:
        raise HTTPException(400, "Can't disable your own account")
    result = await db.users.update_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"$set": {"status": "disabled", "updated_at": now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True, "status": "disabled"}
