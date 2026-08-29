"""Phase 4.3 — Per-role mobile app module allocator.

Admin can enable / disable individual modules for each role
(worker / supervisor / contractor). The Expo mobile client reads
`GET /api/me/mobile-modules` on login + foreground to decide which
tabs / drawer entries to render.

API surface (admin):
  GET  /api/settings/mobile-modules        → full matrix
  PUT  /api/settings/mobile-modules        → persist full matrix, audit-logged

API surface (any authenticated user):
  GET  /api/me/mobile-modules              → flat boolean map for caller's role

Storage: `org_settings` collection, document keyed by `org_id` with a
`mobile_modules` sub-document. Seeded with sensible defaults on first read.
"""
from typing import Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import logging

from auth import get_current_user
from db import db
from models import now_iso
# v58.13.64a — Module catalogue + defaults + matrix reader moved to
# `mobile_modules_data`, and the module-cache invalidator moved to
# `permission_helpers`. Import at top level so both this module and
# `permissions.py` can read them without cycling.
from mobile_modules_data import (  # noqa: F401  (re-exported for back-compat)
    MODULE_KEYS, ROLE_KEYS, _RETIRED_MODULE_KEYS,
    DEFAULTS, DEFAULTS_VERSION, _normalise, _load_matrix,
)
from permission_helpers import invalidate_modules_cache

router = APIRouter(prefix="/api", tags=["mobile-modules"])
log = logging.getLogger("paneltec.mobile_modules")

# ──────────────────────────────────────────────────────────────────────
# Module catalogue + defaults + matrix reader now live in the leaf
# module `mobile_modules_data` (see the top-level import block above).
# They are re-exported here so external callers that historically
# reached for `MODULE_KEYS` / `DEFAULTS` / `_normalise` / `_load_matrix`
# on the `mobile_modules` module keep working.
# ──────────────────────────────────────────────────────────────────────


class MobileModulesPayload(BaseModel):
    mobile_modules: Dict[str, Dict[str, bool]] = Field(default_factory=dict)


@router.get("/settings/mobile-modules")
async def get_mobile_modules(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    matrix = await _load_matrix(user["org_id"])
    doc = await db.org_settings.find_one(
        {"org_id": user["org_id"]},
        {"_id": 0, "defaults_version": 1, "mobile_modules_overrides": 1},
    )
    stored_version = (doc or {}).get("defaults_version")
    needs_review = stored_version != DEFAULTS_VERSION
    # v58.5 — per-role overrides layered on top of the legacy 4-category
    # matrix. Shape: `{role_id: {module_key: bool}}`. Absent role_id or
    # absent module_key means "inherit from the role's category bucket".
    overrides = (doc or {}).get("mobile_modules_overrides") or {}
    return {
        "mobile_modules": matrix,
        "mobile_modules_overrides": overrides,
        "module_keys": MODULE_KEYS,
        "role_keys": ROLE_KEYS,
        "defaults": DEFAULTS,
        "defaults_version": DEFAULTS_VERSION,
        "stored_defaults_version": stored_version,
        "needs_migration_review": needs_review,
    }


# ──────────────────────────────────────────────────────────────────────
# v58.5 — Per-live-role overrides.
#
# The matrix stores 4 CATEGORY buckets (worker/supervisor/contractor/admin).
# Any live role (traffic_controller, cleaner, etc.) inherits from one of
# those buckets via `_categoryForRole` on the frontend. This endpoint lets
# an admin override individual (role_id, module_key) cells so a given live
# role diverges from its parent category without editing the category bucket
# itself. Merge-safe: setting an override to the SAME value as the inherited
# value UNSETS the override (keeps the doc clean).
# ──────────────────────────────────────────────────────────────────────

LEGACY_CATEGORY_KEYS = {"worker", "supervisor", "contractor", "admin"}


class OverridePatch(BaseModel):
    role_id: str = Field(..., min_length=1, max_length=200)
    module_key: str
    enabled: bool


def _category_for_role_id(role_id: str) -> str:
    """Mirror of the frontend `_categoryForRole` classifier. Kept in sync
    with `MobileModulesSection.jsx` — both must map identically."""
    r = (role_id or "").lower()
    if r in LEGACY_CATEGORY_KEYS:
        return r
    if r in ("general_user", "training_inductions_only"):
        return "worker"
    if "admin" in r:
        return "admin"
    if "contractor" in r:
        return "contractor"
    if any(tok in r for tok in ("hseq", "manager", "director", "supervisor")):
        return "supervisor"
    return "worker"


@router.patch("/settings/mobile-modules/overrides")
async def patch_mobile_modules_override(
    body: OverridePatch,
    user: dict = Depends(get_current_user),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    if body.module_key not in MODULE_KEYS:
        raise HTTPException(400, f"unknown module_key {body.module_key!r}")
    # Guardrail: the 4 legacy categories are the SOURCE of inheritance and
    # must never carry override rows themselves — edit them via the PUT
    # matrix endpoint instead.
    if body.role_id in LEGACY_CATEGORY_KEYS:
        raise HTTPException(
            400,
            f"role_id={body.role_id!r} is a base category; edit its row "
            f"via PUT /settings/mobile-modules, not the overrides endpoint",
        )

    matrix = await _load_matrix(user["org_id"])
    category = _category_for_role_id(body.role_id)
    inherited = bool(matrix.get(category, {}).get(body.module_key, False))

    doc = await db.org_settings.find_one({"org_id": user["org_id"]}, {"_id": 0}) or {}
    current_overrides = (doc.get("mobile_modules_overrides") or {})
    old_value = (current_overrides.get(body.role_id) or {}).get(body.module_key)

    now = now_iso()
    if bool(body.enabled) == inherited:
        # Merge to the inherited value → unset the override entry so the
        # doc doesn't accumulate no-op overrides.
        await db.org_settings.update_one(
            {"org_id": user["org_id"]},
            {"$unset": {
                f"mobile_modules_overrides.{body.role_id}.{body.module_key}": "",
            },
             "$set": {"updated_at": now},
             "$setOnInsert": {"org_id": user["org_id"], "created_at": now}},
            upsert=True,
        )
        # Also nuke the role_id sub-doc if it's now empty (best-effort).
        await db.org_settings.update_one(
            {"org_id": user["org_id"],
             f"mobile_modules_overrides.{body.role_id}": {}},
            {"$unset": {f"mobile_modules_overrides.{body.role_id}": ""}},
        )
        new_value = None
    else:
        await db.org_settings.update_one(
            {"org_id": user["org_id"]},
            {"$set": {
                f"mobile_modules_overrides.{body.role_id}.{body.module_key}":
                    bool(body.enabled),
                "updated_at": now,
            },
             "$setOnInsert": {"org_id": user["org_id"], "created_at": now}},
            upsert=True,
        )
        new_value = bool(body.enabled)

    await db.admin_actions.insert_one({
        "actor": user.get("id") or user.get("email"),
        "actor_role": user.get("role"),
        "action": "mobile_modules.override.write",
        "role_id": body.role_id,
        "module_key": body.module_key,
        "old_value": old_value,
        "new_value": new_value,
        "inherited": inherited,
        "at": now,
    })

    # Flush the require_module() cache so the phone picks up the change.
    try:
        invalidate_modules_cache(user["org_id"])
    except Exception:  # noqa: BLE001
        pass

    return {"ok": True, "role_id": body.role_id, "module_key": body.module_key,
            "inherited": inherited, "override": new_value}


@router.delete("/settings/mobile-modules/overrides/{role_id}")
async def reset_role_overrides(role_id: str,
                                user: dict = Depends(get_current_user)):
    """v58.5 — Wipe all overrides for a single role, restoring pure
    inheritance from its category bucket. Called by the "Reset to
    inherited" button on the wizard."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    if role_id in LEGACY_CATEGORY_KEYS:
        raise HTTPException(400, "cannot reset a base category")
    r = await db.org_settings.update_one(
        {"org_id": user["org_id"]},
        {"$unset": {f"mobile_modules_overrides.{role_id}": ""}},
    )
    await db.admin_actions.insert_one({
        "actor": user.get("id") or user.get("email"),
        "action": "mobile_modules.override.reset_role",
        "role_id": role_id,
        "at": now_iso(),
    })
    try:
        invalidate_modules_cache(user["org_id"])
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "role_id": role_id, "modified": r.modified_count}


@router.put("/settings/mobile-modules")
async def put_mobile_modules(
    body: MobileModulesPayload,
    user: dict = Depends(get_current_user),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    before = await _load_matrix(user["org_id"])
    after = _normalise(body.mobile_modules)
    await db.org_settings.update_one(
        {"org_id": user["org_id"]},
        {"$set": {"mobile_modules": after, "defaults_version": DEFAULTS_VERSION,
                  "updated_at": now_iso()},
         "$setOnInsert": {"org_id": user["org_id"], "created_at": now_iso()}},
        upsert=True,
    )
    # Diff for the audit log — only emit what actually changed so the
    # log is grep-friendly when a worker reports "my tab disappeared".
    diff = []
    for role in ROLE_KEYS:
        if role == "admin":
            continue
        for mod in MODULE_KEYS:
            if before[role].get(mod) != after[role].get(mod):
                diff.append({"role": role, "module": mod,
                             "from": bool(before[role].get(mod)),
                             "to":   bool(after[role].get(mod))})
    if diff:
        await db.audit_logs.insert_one({
            "org_id":     user["org_id"],
            "actor_id":   user.get("id"),
            "actor_name": user.get("name") or user.get("email"),
            "action":     "mobile_modules.update",
            "at":         now_iso(),
            "diff":       diff,
        })
    # v160.0.9 — flush the require_module() in-memory cache so the phone
    # sees the new toggle on its next API call (without waiting the 60s TTL).
    try:
        invalidate_modules_cache(user["org_id"])
    except Exception:
        pass
    return {"ok": True, "mobile_modules": after, "changes": len(diff)}


@router.get("/me/mobile-modules")
async def get_my_mobile_modules(
    as_role: Optional[str] = Query(None, description="Admin-only: preview another role's module set"),
    user: dict = Depends(get_current_user),
):
    """Flat boolean map for the calling user's role. Used by the Expo
    mobile app to gate bottom-tab + drawer nav. Unknown roles fall back
    to the most-restrictive `contractor` row so a misconfigured user
    can never accidentally see everything.

    Phase 4.4 — admins can pass `?as_role=worker|supervisor|contractor|admin`
    to preview another role's module set. The param is silently ignored
    for non-admin callers (so a worker copying an admin's link can't
    escalate). Usage is logged at INFO level for auditability."""
    matrix = await _load_matrix(user["org_id"])
    # v58.5 — also fetch overrides so live-role users get their per-role
    # module set, not just their category's row.
    override_doc = await db.org_settings.find_one(
        {"org_id": user["org_id"]},
        {"_id": 0, "mobile_modules_overrides": 1},
    ) or {}
    all_overrides = override_doc.get("mobile_modules_overrides") or {}

    caller_role = (user.get("role") or "contractor").lower()
    caller_role_id = (user.get("role_id") or caller_role).lower()
    effective_role = caller_role
    effective_role_id = caller_role_id
    if as_role:
        ar = (as_role or "").lower()
        # Admin previewing another role — accept both a legacy category
        # key AND a live role_id so the UI can show per-role overrides.
        if caller_role == "admin":
            if ar in ROLE_KEYS:
                effective_role = ar
                effective_role_id = ar
            elif ar in all_overrides or ar not in ROLE_KEYS:
                # A live role_id — resolve its category for the base row.
                effective_role_id = ar
                effective_role = _category_for_role_id(ar)
            log.info("mobile_modules.preview org=%s actor=%s preview_as=%s",
                     user.get("org_id"), user.get("id") or user.get("email"), ar)
    row = dict(matrix.get(effective_role) or matrix.get("contractor") or {})
    # v58.5 — layer overrides for the effective live role_id on top of
    # the category row.
    role_overrides = all_overrides.get(effective_role_id) or {}
    for mk, v in role_overrides.items():
        if mk in MODULE_KEYS:
            row[mk] = bool(v)
    return {
        "role": effective_role,
        "role_id": effective_role_id,
        "actual_role": caller_role,
        "previewed": effective_role_id != caller_role_id,
        "modules": row,
        "override_count": len(role_overrides),
    }
