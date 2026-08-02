"""Org user management — admins only. Permissions matrix lives in permissions.py."""
from __future__ import annotations
import logging
from typing import Any, Dict, List, Literal, Optional

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
    # v160.3.9.33 — Phase 4d Option C: manual override lock. When True,
    # subsequent Simpro sync-linked runs will refresh `simpro_position`
    # but WILL NOT touch `role_id` — the admin's manual assignment sticks.
    role_locked: Optional[bool] = None
    # v160.3.9.33 — Phase 4d Option C: admin can also directly re-assign
    # role_id via the drawer. This mirrors the row-level assign flow but
    # goes through PATCH instead of the bulk-assign endpoint.
    role_id: Optional[str] = None


class PermissionsIn(BaseModel):
    overrides: dict = Field(default_factory=dict)
    # v160.3.9.32-4c — Sidecar map keyed "resource.action" → reason string.
    # Enforced 3-200 chars in upsert_overrides(). Entries whose override
    # cell no longer exists are dropped automatically.
    reasons: dict = Field(default_factory=dict)


def _user_out(doc: dict, has_overrides: bool = False) -> dict:
    # Phase 4.7.2 — surface derived auth state so the Users list + Workers
    # list pills can flip to "Invite pending" / "Locked" without needing a
    # separate `/access-status` round-trip per row. The persisted `status`
    # field stays the source of truth for admin/disabled flow.
    from datetime import datetime, timezone
    def _future(iso_or_dt) -> bool:
        if not iso_or_dt: return False
        try:
            dt = iso_or_dt if hasattr(iso_or_dt, 'tzinfo') else datetime.fromisoformat(str(iso_or_dt).replace('Z','+00:00'))
            return dt > datetime.now(timezone.utc)
        except Exception:
            return False
    invite_pending = bool(doc.get("invite_token_hash")) and _future(doc.get("invite_expires_at"))
    is_locked = _future(doc.get("locked_until"))
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
        "invite_pending": invite_pending,
        "is_locked": is_locked,
        # v160.3.9.31-4a — surfaced so the Users page header can compute
        # segmented buckets (active / pending / archived / test) without
        # a second round-trip. `is_test_fixture` is the canonical flag
        # written by scripts/analysis/tag_test_fixtures.py; legacy
        # `is_test` is honoured too.
        "activation_status": doc.get("activation_status"),
        "is_archived": bool(doc.get("is_archived")),
        "is_test_fixture": bool(doc.get("is_test_fixture") or doc.get("is_test")),
        # v160.3.9.32-4b — Phase 4b surface fields.
        "photo_url": doc.get("photo_url"),
        "simpro_last_synced_at": doc.get("simpro_last_synced_at"),
        # v160.3.9.32-4c.3 — surfaced for the pending-users assign-role UI.
        "simpro_position": doc.get("simpro_position"),
        "must_set_password": bool(doc.get("must_set_password")),
        "role_assigned_at": doc.get("role_assigned_at"),
        # v160.3.9.33 — Phase 4d Option C: manual-role-override flag.
        "role_locked": bool(doc.get("role_locked")),
    }


async def _other_active_admins_count(org_id: str, exclude_user_id: Optional[str] = None) -> int:
    """How many active admins remain if we exclude one (or none)?"""
    q = {"org_id": org_id, "role": "admin",
         "$or": [{"status": "active"}, {"status": {"$exists": False}}]}
    if exclude_user_id:
        q["id"] = {"$ne": exclude_user_id}
    return await db.users.count_documents(q)


# v160.3.7n — Central definition of "test / seed / disposable" accounts so
# every admin-facing modal that lists users can hide the demo seed pool
# (Casey Worker, Test One, Test Two, Test Outbox User, Test Worker (Stephen
# Org), the warmup smoke user, and any `test_…@example.com` disposables)
# without each caller re-implementing the same regex. Kept as a single
# `$or` Mongo condition rather than a Python filter so `.count_documents`
# and `.find` stay consistent and the index on `email` is still used.
_TEST_ACCOUNT_OR = [
    # Any address on the fake `example.com` domain (all our disposable
    # test accounts land here — Playwright, curl, delete-test seeds).
    {"email": {"$regex": r"@example\.com$", "$options": "i"}},
    # Bare `@paneltec.com` (no `.au`) — the five original demo seed
    # accounts: admin@, audit@, demo@, super@, worker@. The real org
    # email domain is `@paneltec.com.au`.
    {"email": {"$regex": r"^[^@]+@paneltec\.com$", "$options": "i"}},
    # Prefix `test_` — matches `test_outbox@…`, `test_1234@…` etc.
    {"email": {"$regex": r"^test[_\d]", "$options": "i"}},
    # Warmup smoke-test seed used by the v144 boot self-check.
    {"email": {"$regex": r"^warmup[-_]", "$options": "i"}},
    # Any account explicitly flagged as test in the DB (opt-in — we
    # don't backfill this on real users). Set by the `POST /users`
    # test-fixture helper. Safe: unset means "not a test account".
    {"is_test": True},
    # v160.3.9.31-4a — New canonical flag written by
    # `scripts/analysis/tag_test_fixtures.py`. Kept alongside legacy
    # `is_test` so both mean the same thing for _TEST_ACCOUNT_OR.
    {"is_test_fixture": True},
    # v160.3.7n — `worker_stephen@paneltec.com.au` is the seeded
    # "Test Worker (Stephen Org)" account. Match it explicitly rather
    # than pattern-matching so real Stephen family members aren't hit.
    {"email": "worker_stephen@paneltec.com.au"},
]


@router.get("")
async def list_users(
    hide_test: bool = True,
    include_deleted: bool = False,
    user: dict = Depends(require_permission("users", "view")),
):
    # v160.3.9.31-4a — Defaults tightened after "80 vs 60ish" audit:
    #   · `hide_test` defaults to True (inverted). Test fixtures /
    #     warmup / example.com / is_test / is_test_fixture rows drop
    #     from admin lists by default. Opt-out with `?hide_test=false`.
    #   · `include_deleted` defaults to False. Soft-deleted rows
    #     (`deleted_at != null`) were leaking into the count/list.
    #     Opt-in with `?include_deleted=true` for a future restore-user
    #     flow.
    # v160.3.7n — original comment retained below.
    #   `hide_test=true` filters out seeded demo accounts + fake
    #   `@example.com` disposables. Off by default so /settings/users keeps
    #   showing everything (admins need to be able to find seed rows to
    #   delete them). Modals that pick real people (Doc Library restrict,
    #   form assignees, SWMS assignees) opt in.
    q: dict = {"org_id": user["org_id"]}
    if not include_deleted:
        q["$or"] = [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]
    if hide_test:
        # $nor coexists with $or above — Mongo ANDs top-level operators.
        q["$nor"] = _TEST_ACCOUNT_OR
    docs = await db.users.find(
        q,
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
    # v160.3.9.33 — Phase 4d Option C:
    # (a) If admin PATCHes `role_id`, mirror it into legacy `role` and
    #     auto-compute `role_locked`: True iff the assigned role_id
    #     differs from what the user's simpro_position would produce.
    # (b) If admin PATCHes `role_locked` explicitly, honour their choice
    #     but validate: unlocking + no active position → stays locked.
    if "role_id" in patch:
        role_doc = await db.roles.find_one({"role_id": patch["role_id"]}, {"_id": 0})
        if not role_doc:
            raise HTTPException(404, f"role_id '{patch['role_id']}' not found")
        if not role_doc.get("is_active"):
            raise HTTPException(400, "role is not active")
        target = await db.users.find_one(
            {"id": user_id, "org_id": actor["org_id"]},
            {"_id": 0, "simpro_position": 1, "role_id": 1},
        )
        if not target:
            raise HTTPException(404, "User not found")
        position = (target.get("simpro_position") or "").strip()
        position_role_id = None
        if position:
            from roles_catalogue import _slugify
            position_role_id = "custom_" + _slugify(position)
        # If admin didn't send role_locked explicitly, derive it.
        if "role_locked" not in patch:
            patch["role_locked"] = (patch["role_id"] != position_role_id) if position_role_id else True
        # Mirror role_id → legacy role string (Phase 5 will drop this).
        patch.setdefault("role", patch["role_id"])
        patch.setdefault("role_assigned_at", now_iso())
    patch["updated_at"] = now_iso()
    # Status / email / role changes revoke any existing JWTs for that user.
    # Only bump token_version if the value ACTUALLY changes (not on a no-op resave).
    existing = await db.users.find_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"_id": 0, "status": 1, "email": 1, "role": 1, "role_id": 1, "role_locked": 1},
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
            for k in ("status", "email", "role", "role_id")
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
        # v160.3.9.32-4c — Reasons sidecar surfaced to FE.
        "reasons": (override_doc or {}).get("reasons", {}),
        "effective": await effective_for(target),
        "schema": PERMISSIONS_SCHEMA,
    }


@router.put("/{user_id}/permissions")
async def put_permissions(user_id: str, body: PermissionsIn, actor: dict = Depends(require_permission("users", "edit"))):
    target = await db.users.find_one({"id": user_id, "org_id": actor["org_id"]}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    # v160.3.9.32-4c — capture before-state so the audit diff can compute
    # added/removed/changed tokens.
    before_doc = await db.user_permissions.find_one({"user_id": user_id}, {"_id": 0})
    before_overrides = (before_doc or {}).get("overrides", {}) or {}
    saved = await upsert_overrides(user_id, actor["org_id"], body.overrides,
                                   actor["id"], reasons=body.reasons)
    after_overrides = saved.get("overrides", {}) or {}
    after_reasons = saved.get("reasons", {}) or {}

    # Flatten to {resource.action: bool} sets for cheap diffing.
    def _flatten(m):
        out = {}
        for r, actions in (m or {}).items():
            for a, v in (actions or {}).items():
                out[f"{r}.{a}"] = bool(v)
        return out
    b_flat, a_flat = _flatten(before_overrides), _flatten(after_overrides)
    added = sorted(k for k in a_flat if k not in b_flat)
    removed = sorted(k for k in b_flat if k not in a_flat)
    changed = sorted(k for k in a_flat if k in b_flat and a_flat[k] != b_flat[k])
    if added or removed or changed:
        await db.user_audit.insert_one({
            "id": new_id(),
            "user_id": user_id,
            "action": "permissions_updated",
            "diff": {
                "added": [{"token": t, "grant": a_flat[t],
                           "reason": after_reasons.get(t)} for t in added],
                "removed": removed,
                "changed": [{"token": t, "before": b_flat[t], "after": a_flat[t],
                             "reason": after_reasons.get(t)} for t in changed],
            },
            "actor_user_id": actor["id"],
            "actor_email": actor.get("email"),
            "at": now_iso(),
        })
    return {
        "user_id": user_id,
        "overrides": after_overrides,
        "reasons": after_reasons,
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


@router.post("", status_code=410)
async def invite_user_deprecated(actor: dict = Depends(require_permission("users", "edit"))):
    """v160.3.9.32-4b — Phase 4b removes admin-invite flow. Only path
    into Paneltec is Simpro selective-import (`POST /admin/simpro/import-employees/selective`).
    Return 410 Gone with a stable detail string so any legacy caller
    surfaces a clean error instead of silently succeeding."""
    raise HTTPException(410, "invite disabled: use Simpro import")


class SetPasswordIn(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


@router.post("/{user_id}/set-password")
async def admin_set_password(
    user_id: str,
    body: SetPasswordIn,
    actor: dict = Depends(require_permission("users", "edit")),
):
    """v160.3.9.32-4b — Admin directly sets a user's password. Bumps
    token_version (revokes outstanding JWTs), flips activation_status
    to 'active', clears must_change_password, writes user_audit."""
    from auth_invite import validate_password_rule
    err = validate_password_rule(body.password)
    if err:
        raise HTTPException(400, err)
    target = await db.users.find_one(
        {"id": user_id, "org_id": actor["org_id"]}, {"_id": 0},
    )
    if not target:
        raise HTTPException(404, "User not found")
    new_tv = int(target.get("token_version") or 0) + 1
    now = now_iso()
    await db.users.update_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"$set": {
            "password_hash": hash_password(body.password),
            "token_version": new_tv,
            "activation_status": "active",
            "must_change_password": False,
            "status": "active",
            "updated_at": now,
        }},
    )
    await db.user_audit.insert_one({
        "id": new_id(),
        "user_id": user_id,
        "action": "admin_set_password",
        "actor_user_id": actor["id"],
        "actor_email": actor.get("email"),
        "at": now,
    })
    return {"ok": True, "user_id": user_id}


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
async def disable_user(user_id: str, hard: bool = False,
                        actor: dict = Depends(require_permission("users", "edit"))):
    if user_id == actor["id"]:
        raise HTTPException(400, "Can't disable your own account")
    target = await db.users.find_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"_id": 0, "role": 1, "status": 1, "deleted_at": 1, "email": 1},
    )
    if not target:
        raise HTTPException(404, "User not found")
    # Last-admin guard: refuse to disable the only active admin in the org.
    if target.get("role") == "admin" and target.get("status", "active") == "active":
        remaining = await _other_active_admins_count(actor["org_id"], exclude_user_id=user_id)
        if remaining == 0:
            raise HTTPException(400, "Cannot delete the last active admin in this org")
    if hard:
        # Hard-delete = physically remove the row. Only legal when the user
        # is already soft-deleted — forces the admin to make the choice in
        # two steps.
        if not target.get("deleted_at"):
            raise HTTPException(400, "User must be soft-deleted first (set deleted_at) before hard delete")
        res = await db.users.delete_one({"id": user_id, "org_id": actor["org_id"]})
        if res.deleted_count == 0:
            raise HTTPException(404, "User not found")
        log.info("users.hard_delete actor=%s target=%s email=%s",
                 actor["id"], user_id, target.get("email"))
        return {"ok": True, "hard_deleted": True}
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
    # Phase 3.21 — `default_role` and `workspace_ids` removed from the
    # import flow. Every imported user lands as role="worker" with no
    # workspace pre-assignment; the admin promotes/assigns via the Edit
    # drawer after import. Fields kept here as Optional ignored inputs
    # for backwards compatibility with older clients.
    default_role: Optional[Role] = None
    workspace_ids: Optional[List[str]] = None


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
            "id": user_id, "email": email, "name": name, "role": "worker",
            "org_id": actor["org_id"], "workspace_ids": [],
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

# ─────────────────────────────────────────────────────────────
# v160.3.9.32-4c.3 — Bulk assign role to pending users.
# The 48 pending_activation users left over from Phase 2's bulk
# import had role_id=None and no clear activation path except
# Delete. This endpoint gives admins a "select N pending users →
# apply role → activate" workflow. Idempotent — users that already
# have a role_id are skipped (counted in `skipped`), never
# overwritten. Every user gets a `user_audit` entry with the full
# context per spec.
# ─────────────────────────────────────────────────────────────

_ADMIN_BULK_UNSAFE_ROLE_IDS = {"admin"}  # single-row confirm only, never bulk.
_FROM_POSITION_SENTINEL = "__from_position__"  # v160.3.9.33 Phase 4d


class BulkAssignRoleIn(BaseModel):
    user_ids: List[str]
    role_id: str
    admin_confirmed: bool = False  # ignored server-side except for audit.
    hint_matched: bool = False
    # v160.3.9.33 — Phase 4d: when role_id == "__from_position__" the endpoint
    # auto-creates (if missing) a `custom_<slug(simpro_position)>` role per
    # user, then assigns it. Every user in the batch MUST have a
    # non-empty `simpro_position` — else 400.
    auto_create_from_position: bool = False


@router.post("/bulk-assign-role")
async def bulk_assign_role(
    body: BulkAssignRoleIn,
    actor: dict = Depends(require_permission("users", "edit")),
):
    if not body.user_ids:
        raise HTTPException(400, "user_ids empty")

    # v160.3.9.33 — Phase 4d "from position" branch.
    from_position = (
        body.role_id == _FROM_POSITION_SENTINEL
        or body.auto_create_from_position
    )
    if from_position:
        # Import lazily to avoid the circular users → roles_catalogue chain.
        from roles_catalogue import create_role_from_position
        now = now_iso()
        updated: List[str] = []
        skipped: List[Dict[str, str]] = []
        errors: List[Dict[str, str]] = []
        created_role_ids: List[str] = []
        per_role_updated: Dict[str, int] = {}
        for uid in body.user_ids:
            target = await db.users.find_one(
                {"id": uid, "org_id": actor["org_id"]}, {"_id": 0},
            )
            if not target:
                errors.append({"user_id": uid, "reason": "not_found_or_cross_org"})
                continue
            if target.get("role_id"):
                skipped.append({"user_id": uid, "reason": "already_has_role_id"})
                continue
            position = (target.get("simpro_position") or "").strip()
            if not position:
                errors.append({"user_id": uid, "reason": "no_simpro_position"})
                continue
            result = await create_role_from_position(position=position, actor=actor)
            role_id = result["role_id"]
            if result["created"]:
                created_role_ids.append(role_id)
            has_password = bool(target.get("password_hash"))
            set_fields: Dict[str, Any] = {
                "role_id": role_id,
                "role": role_id,
                "activation_status": "active",
                "status": "active",
                "role_assigned_at": now,
                # v160.3.9.33 — Phase 4d Option C: position-derived assignment
                # is by definition NOT a manual override → role_locked=False.
                "role_locked": False,
                "updated_at": now,
                "must_set_password": not has_password,
            }
            await db.users.update_one({"id": uid}, {"$set": set_fields})
            await db.user_audit.insert_one({
                "id": new_id(),
                "user_id": uid,
                "action": "bulk_role_assigned_from_position",
                "before": {"role_id": None},
                "after": {"role_id": role_id},
                "simpro_position": position,
                "role_source": "simpro_position_auto",
                "role_auto_created": result["created"],
                "hint_matched": True,   # position match is the strongest hint
                "admin_confirmed": bool(body.admin_confirmed),
                "actor_user_id": actor["id"],
                "actor_email": actor.get("email"),
                "at": now,
            })
            per_role_updated[role_id] = per_role_updated.get(role_id, 0) + 1
            updated.append(uid)
        return {
            "role_id": _FROM_POSITION_SENTINEL,
            "role_name": "(auto-created from Simpro positions)",
            "updated": len(updated),
            "skipped": len(skipped),
            "errors": len(errors),
            "auto_created_role_ids": sorted(set(created_role_ids)),
            "per_role_updated": per_role_updated,
            "summary": (
                f"Auto-assigned {len(updated)} users into "
                f"{len(set(per_role_updated.keys()))} position roles "
                f"({len(set(created_role_ids))} newly created). "
                f"{len(skipped)} skipped (already had roles). "
                f"{len(errors)} errors."
            ),
            "detail": {"updated": updated, "skipped": skipped, "errors": errors},
        }

    if body.role_id in _ADMIN_BULK_UNSAFE_ROLE_IDS:
        raise HTTPException(400, "admin role must be assigned one user at a time")

    role_doc = await db.roles.find_one({"role_id": body.role_id}, {"_id": 0})
    if not role_doc:
        raise HTTPException(404, f"role_id '{body.role_id}' not found")
    if not role_doc.get("is_active"):
        raise HTTPException(400, "role is not active")

    # Defence in depth: reject custom roles whose token count exceeds admin's.
    if not role_doc.get("is_system"):
        admin_doc = await db.roles.find_one({"role_id": "admin"}, {"_id": 0})
        admin_count = len((admin_doc or {}).get("permission_tokens") or [])
        role_count = len(role_doc.get("permission_tokens") or [])
        if admin_count and role_count > admin_count:
            raise HTTPException(400, "custom role exceeds admin token budget")

    # v160.3.9.33 — Phase 4d Option C: import slugify to compute the
    # user's position-role for each row. `role_locked` is True iff the
    # admin-picked role_id differs from the user's position role.
    from roles_catalogue import _slugify
    now = now_iso()
    updated: List[str] = []
    skipped: List[Dict[str, str]] = []
    errors: List[Dict[str, str]] = []
    for uid in body.user_ids:
        target = await db.users.find_one(
            {"id": uid, "org_id": actor["org_id"]}, {"_id": 0},
        )
        if not target:
            errors.append({"user_id": uid, "reason": "not_found_or_cross_org"})
            continue
        if target.get("role_id"):
            skipped.append({"user_id": uid, "reason": "already_has_role_id"})
            continue
        has_password = bool(target.get("password_hash"))
        position = (target.get("simpro_position") or "").strip()
        position_role_id = ("custom_" + _slugify(position)) if position else None
        role_locked = (body.role_id != position_role_id) if position_role_id else True
        set_fields: Dict[str, Any] = {
            "role_id": body.role_id,
            "role": role_doc.get("role_id") or body.role_id,  # legacy string mirror
            "activation_status": "active",
            "status": "active",
            "role_assigned_at": now,
            "role_locked": role_locked,
            "updated_at": now,
            "must_set_password": not has_password,
        }
        await db.users.update_one({"id": uid}, {"$set": set_fields})
        await db.user_audit.insert_one({
            "id": new_id(),
            "user_id": uid,
            "action": "bulk_role_assigned",
            "before": {"role_id": target.get("role_id")},
            "after": {"role_id": body.role_id},
            "simpro_position": target.get("simpro_position"),
            "position_role_id": position_role_id,
            "role_locked": role_locked,
            "hint_matched": bool(body.hint_matched),
            "admin_confirmed": bool(body.admin_confirmed),
            "actor_user_id": actor["id"],
            "actor_email": actor.get("email"),
            "at": now,
        })
        updated.append(uid)
    return {
        "role_id": body.role_id,
        "role_name": role_doc.get("name"),
        "updated": len(updated),
        "skipped": len(skipped),
        "errors": len(errors),
        "summary": f"Assigned {role_doc.get('name')} to {len(updated)} users. "
                   f"{len(skipped)} skipped (already had roles).",
        "detail": {"updated": updated, "skipped": skipped, "errors": errors},
    }

