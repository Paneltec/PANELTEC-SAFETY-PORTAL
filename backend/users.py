"""Org user management — admins only. Permissions matrix lives in permissions.py."""
from __future__ import annotations
import logging
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

log = logging.getLogger("paneltec.users")
router = APIRouter(prefix="/users", tags=["users"])


@router.get("/_workspaces", include_in_schema=False)
async def _workspaces_shim():
    raise HTTPException(404, "use /api/workspaces")


class InviteUserIn(BaseModel):
    email: EmailStr
    name: str
    role: Role
    workspace_ids: List[str] = Field(default_factory=list)


class UpdateUserIn(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
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
        "imported_from": doc.get("imported_from"),
        "simpro_employee_id": doc.get("simpro_employee_id"),
        "simpro_company_id": doc.get("simpro_company_id"),
        "simpro_company_name": doc.get("simpro_company_name"),
        "mobile": doc.get("mobile"),
        "position": doc.get("position"),
    }


async def _other_active_admins_count(org_id: str, exclude_user_id: Optional[str] = None) -> int:
    """How many active admins remain if we exclude one (or none)?"""
    q = {"org_id": org_id, "role": "admin",
         "$or": [{"status": "active"}, {"status": {"$exists": False}}]}
    if exclude_user_id:
        q["id"] = {"$ne": exclude_user_id}
    return await db.users.count_documents(q)


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
    # Email change: lowercase + collision check (against other users in same org).
    if "email" in patch:
        new_email = str(patch["email"]).lower().strip()
        clash = await db.users.find_one({
            "org_id": actor["org_id"],
            "email": new_email,
            "id": {"$ne": user_id},
        })
        if clash:
            raise HTTPException(400, "Email already in use")
        patch["email"] = new_email
    patch["updated_at"] = now_iso()
    # Status / email / role changes revoke any existing JWTs for that user.
    # Only bump token_version if the value ACTUALLY changes (not on a no-op resave).
    existing = await db.users.find_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"_id": 0, "status": 1, "email": 1, "role": 1},
    )
    update_op: dict = {"$set": patch}
    if existing:
        def _norm(key, val):
            if key == "status" and not val:
                return "active"  # missing/None defaults to active in the model
            if key == "email" and isinstance(val, str):
                return val.lower().strip()
            return val
        revocable_changed = any(
            k in patch and _norm(k, patch[k]) != _norm(k, existing.get(k))
            for k in ("status", "email", "role")
        )
        if revocable_changed:
            update_op["$inc"] = {"token_version": 1}
    result = await db.users.find_one_and_update(
        {"id": user_id, "org_id": actor["org_id"]},
        update_op,
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
        "token_version": 0,
        "invite_token": invite_token,
        "invited_by": actor["id"],
        "created_at": now_iso(),
    }
    await db.users.insert_one(dict(doc))

    # Queue invitation email via outbox (bypasses normal permission check).
    from email_outbox import queue_email_doc  # local import to avoid cycle
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


class BulkDeleteIn(BaseModel):
    user_ids: List[str] = Field(default_factory=list)


@router.post("/bulk-delete")
async def bulk_delete_users(body: BulkDeleteIn,
                             actor: dict = Depends(require_permission("users", "edit"))):
    """Soft-delete several users in one call. Defensive guards:
      * silently skip the caller's own id (UI hides their row too, but the
        backend never trusts that).
      * silently skip any user that's the last remaining active admin in the
        org (admins are gated more carefully than the single-row delete
        endpoint since callers may not realise their selection is risky).
      * skip already-disabled rows so the operation is idempotent.
    Returns counts so the UI can toast something useful."""
    if not body.user_ids:
        raise HTTPException(400, "No user_ids provided")
    deleted: list[str] = []
    skipped_self = 0
    skipped_last_admin = 0
    skipped_not_found = 0
    skipped_already = 0
    ts = now_iso()

    for uid in body.user_ids:
        if uid == actor["id"]:
            skipped_self += 1
            continue
        target = await db.users.find_one(
            {"id": uid, "org_id": actor["org_id"]},
            {"_id": 0, "id": 1, "role": 1, "status": 1, "deleted_at": 1},
        )
        if not target:
            skipped_not_found += 1
            continue
        if target.get("deleted_at"):
            skipped_already += 1
            continue
        if target.get("role") == "admin" and target.get("status", "active") == "active":
            # Count admins OTHER than this one AND not also in our pending
            # deletion list — otherwise selecting all admins at once would
            # bypass the guard because each row passes the single-row check.
            pending_admin_ids = set(deleted) | {uid}
            remaining = await db.users.count_documents({
                "org_id": actor["org_id"], "role": "admin",
                "$or": [{"status": "active"}, {"status": {"$exists": False}}],
                "id": {"$nin": list(pending_admin_ids)},
            })
            if remaining == 0:
                skipped_last_admin += 1
                continue
        res = await db.users.update_one(
            {"id": uid, "org_id": actor["org_id"]},
            {"$set": {"status": "disabled", "deleted_at": ts, "updated_at": ts},
             "$inc": {"token_version": 1}},
        )
        if res.matched_count:
            deleted.append(uid)
        else:
            skipped_not_found += 1

    log.info(
        "users.bulk_delete actor=%s deleted=%d skipped_self=%d "
        "skipped_last_admin=%d skipped_not_found=%d skipped_already=%d",
        actor["id"], len(deleted), skipped_self,
        skipped_last_admin, skipped_not_found, skipped_already,
    )
    return {
        "deleted": len(deleted),
        "deleted_ids": deleted,
        "skipped_self": skipped_self,
        "skipped_last_admin": skipped_last_admin,
        "skipped_not_found": skipped_not_found,
        "skipped_already_disabled": skipped_already,
    }


@router.delete("/{user_id}")
async def disable_user(user_id: str, actor: dict = Depends(require_permission("users", "edit"))):
    if user_id == actor["id"]:
        raise HTTPException(400, "Can't disable your own account")
    target = await db.users.find_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"_id": 0, "role": 1, "status": 1},
    )
    if not target:
        raise HTTPException(404, "User not found")
    # Last-admin guard: refuse to disable the only active admin in the org.
    if target.get("role") == "admin" and target.get("status", "active") == "active":
        remaining = await _other_active_admins_count(actor["org_id"], exclude_user_id=user_id)
        if remaining == 0:
            raise HTTPException(400, "Cannot delete the last active admin in this org")
    ts = now_iso()
    result = await db.users.update_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"$set": {"status": "disabled", "deleted_at": ts, "updated_at": ts},
         "$inc": {"token_version": 1}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "User not found")
    return {"ok": True, "status": "disabled", "deleted_at": ts}


@router.post("/{user_id}/force-signout")
async def force_signout(user_id: str, actor: dict = Depends(require_permission("users", "edit"))):
    """Bump the user's token_version which immediately invalidates every JWT
    they currently hold. The user can still sign in fresh; we don't touch
    their `status` field here."""
    target = await db.users.find_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "token_version": 1},
    )
    if not target:
        raise HTTPException(404, "User not found")
    result = await db.users.find_one_and_update(
        {"id": user_id, "org_id": actor["org_id"]},
        {"$inc": {"token_version": 1}, "$set": {"updated_at": now_iso()}},
        projection={"_id": 0, "token_version": 1},
        return_document=True,
    )
    return {"ok": True, "user_id": user_id,
            "new_token_version": (result or {}).get("token_version", 0)}


# ---------- Simpro bulk import ----------

class SimproEmployeeIn(BaseModel):
    simpro_employee_id: str
    simpro_company_id: str
    email: EmailStr
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    name: Optional[str] = None
    mobile: Optional[str] = None
    position: Optional[str] = None
    company_name: Optional[str] = None


class ImportFromSimproIn(BaseModel):
    employees: List[SimproEmployeeIn]
    default_role: Role = "worker"
    workspace_ids: List[str] = Field(default_factory=list)


@router.post("/import-from-simpro", status_code=201)
async def import_from_simpro(
    body: ImportFromSimproIn,
    actor: dict = Depends(require_permission("users", "edit")),
):
    if not body.employees:
        raise HTTPException(400, "No employees provided")
    if len(body.employees) > 500:
        raise HTTPException(400, "Too many employees in one batch (max 500)")

    existing = await db.users.find(
        {"org_id": actor["org_id"]},
        {"_id": 0, "email": 1, "simpro_employee_id": 1, "simpro_company_id": 1},
    ).to_list(2000)
    by_email = {str(u.get("email") or "").lower(): u for u in existing if u.get("email")}
    by_simpro = {(str(u["simpro_employee_id"]), str(u["simpro_company_id"]))
                 for u in existing
                 if u.get("simpro_employee_id") and u.get("simpro_company_id")}

    created = 0
    created_ids: list[str] = []
    skipped: list[dict] = []

    for emp in body.employees:
        email = emp.email.lower().strip()
        key = (str(emp.simpro_employee_id), str(emp.simpro_company_id))
        if key in by_simpro:
            skipped.append({"email": email, "reason": "Already imported (Simpro ID match)"})
            continue
        if email in by_email:
            skipped.append({"email": email, "reason": "Email already in use"})
            continue

        name = emp.name or " ".join(filter(None, [emp.first_name, emp.last_name])).strip() or email
        user_id = new_id()
        # Random throwaway password — Simpro-imported users sign in via /auth/login-with-simpro.
        throwaway_pwd = new_id() + new_id()
        doc = {
            "id": user_id, "email": email, "name": name, "role": body.default_role,
            "org_id": actor["org_id"], "workspace_ids": list(body.workspace_ids),
            "password_hash": hash_password(throwaway_pwd),
            "status": "active",
            "token_version": 0,
            "auth_provider": "simpro",
            "mobile": emp.mobile,
            "position": emp.position,
            "imported_from": "simpro",
            "simpro_employee_id": str(emp.simpro_employee_id),
            "simpro_company_id": str(emp.simpro_company_id),
            "simpro_company_name": emp.company_name,
            "created_at": now_iso(),
        }
        try:
            await db.users.insert_one(dict(doc))
            created += 1
            created_ids.append(user_id)
            by_email[email] = doc
            by_simpro.add(key)
        except Exception as e:
            skipped.append({"email": email, "reason": f"Insert failed: {e}"})
            continue

    return {
        "created": created,
        "created_ids": created_ids,
        "skipped": skipped,
    }
