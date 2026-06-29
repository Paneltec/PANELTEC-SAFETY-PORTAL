"""Permission Presets — one-click matrices that admins can apply to any user.

A preset is a fully-resolved (resource × action → bool) matrix. Built-in
presets live in this file (read-only). Custom presets live in the
`permission_presets` collection scoped by `org_id`.

Applying a preset to a user replaces their `user_permissions.overrides`
with the preset matrix. We deliberately store the full matrix (not just
deltas from role defaults) so the user's effective permissions match the
preset exactly regardless of any future role-default tweaks.
"""
from __future__ import annotations
import re
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from models import new_id, now_iso
from permissions import (
    ACTIONS, PERMISSIONS_SCHEMA, RESOURCES, ROLE_DEFAULTS,
    effective_for, require_permission, upsert_overrides,
)

router = APIRouter(prefix="/permission-presets", tags=["permission-presets"])
apply_router = APIRouter(prefix="/users", tags=["permission-presets"])


# ---------- Matrix helpers ----------

def _allow_action(resource: str, action: str, value: bool) -> bool:
    """Force email=False on resources that don't support email."""
    if action == "email" and not PERMISSIONS_SCHEMA[resource].get("email_supported"):
        return False
    return value


def _matrix(filler):
    """Build a complete (resource × action) matrix using `filler(resource, action) -> bool`."""
    out: Dict[str, Dict[str, bool]] = {}
    for r in RESOURCES:
        out[r] = {}
        for a in ACTIONS:
            out[r][a] = _allow_action(r, a, bool(filler(r, a)))
    return out


def _full_admin() -> Dict[str, Dict[str, bool]]:
    return _matrix(lambda r, a: True)


def _role_matrix(role: str) -> Dict[str, Dict[str, bool]]:
    """Start from a role's defaults, normalised across the full schema."""
    return _matrix(lambda r, a: bool(ROLE_DEFAULTS.get(role, {}).get(r, {}).get(a, False)))


def _site_manager() -> Dict[str, Dict[str, bool]]:
    """Manager defaults + delete on inductions/certifications.
    Cannot edit Settings (integrations/users)."""
    base = _role_matrix("hseq_lead")
    # Grant deletes on inductions/certifications.
    base["inductions"]["delete"] = True
    base["certifications"]["delete"] = True
    # Lock down settings — no integrations, no users management.
    for r in ("integrations", "users"):
        for a in ACTIONS:
            base[r][a] = False
    return base


def _hseq_officer() -> Dict[str, Dict[str, bool]]:
    """HSEQ Lead defaults + ability to edit SWMS/inspections sign-offs
    (mapped onto the existing `edit` action since `sign_off` isn't its own
    action in the matrix)."""
    base = _role_matrix("hseq_lead")
    # Make sure the safety records are fully editable.
    for r in ("swms", "inspections", "incidents", "hazards"):
        base[r]["edit"] = True
    return base


def _field_supervisor() -> Dict[str, Dict[str, bool]]:
    """Supervisor + worker invite/edit + sites sign-off authority."""
    base = _role_matrix("supervisor")
    # Supervisors at this preset can edit workers (invite/onboard).
    base["workers"]["edit"] = True
    base["workers"]["open"] = True
    base["workers"]["view"] = True
    # Sites = workspaces aren't a resource here; "sites" sign-off maps to
    # editing inspections + inductions which the supervisor preset already
    # allows. Promote inspections.edit to True explicitly to be safe.
    base["inspections"]["edit"] = True
    return base


def _read_only_auditor() -> Dict[str, Dict[str, bool]]:
    """Every open + view + (email if supported). No edit, no delete."""
    def filler(r: str, a: str) -> bool:
        if a in ("open", "view"):
            return True
        if a == "email":
            return bool(PERMISSIONS_SCHEMA[r].get("email_supported"))
        return False
    return _matrix(filler)


def _field_worker() -> Dict[str, Dict[str, bool]]:
    return _role_matrix("worker")


BUILT_IN_PRESETS: List[dict] = [
    {
        "key": "full_admin",
        "label": "Full Admin",
        "description": "All permissions across the platform. Use for owners and senior staff.",
        "icon": "Crown",
        "permissions": _full_admin(),
    },
    {
        "key": "site_manager",
        "label": "Site Manager",
        "description": "Manager defaults plus delete on inductions and certifications. Cannot edit settings.",
        "icon": "HardHat",
        "permissions": _site_manager(),
    },
    {
        "key": "hseq_officer",
        "label": "HSEQ Officer",
        "description": "HSEQ Lead role with full read/edit on safety records. Cannot hard-delete.",
        "icon": "ShieldCheck",
        "permissions": _hseq_officer(),
    },
    {
        "key": "field_supervisor",
        "label": "Field Supervisor",
        "description": "Supervisor plus edit on workers and sign-off on inspections.",
        "icon": "Users",
        "permissions": _field_supervisor(),
    },
    {
        "key": "read_only_auditor",
        "label": "Read-Only Auditor",
        "description": "Every view + email permission. Cannot edit or delete anything.",
        "icon": "Eye",
        "permissions": _read_only_auditor(),
    },
    {
        "key": "field_worker",
        "label": "Field Worker",
        "description": "Worker role defaults. View own records, fill forms, scan QR codes.",
        "icon": "Wrench",
        "permissions": _field_worker(),
    },
]

BUILT_IN_BY_KEY: Dict[str, dict] = {p["key"]: p for p in BUILT_IN_PRESETS}


def _slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (label or "").lower()).strip("_")
    return s or new_id()[:8]


def _validate_permissions(perms: dict) -> Dict[str, Dict[str, bool]]:
    """Coerce / validate a posted matrix to the canonical shape."""
    if not isinstance(perms, dict):
        raise HTTPException(400, "permissions must be an object")
    clean: Dict[str, Dict[str, bool]] = {}
    for r in RESOURCES:
        clean[r] = {}
        sub = perms.get(r) or {}
        for a in ACTIONS:
            clean[r][a] = _allow_action(r, a, bool(sub.get(a, False)))
    return clean


def _builtin_out(p: dict) -> dict:
    return {
        "id": p["key"],
        "key": p["key"],
        "label": p["label"],
        "description": p["description"],
        "icon": p.get("icon"),
        "permissions": p["permissions"],
        "is_builtin": True,
    }


def _custom_out(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "key": doc["key"],
        "label": doc["label"],
        "description": doc.get("description") or "",
        "icon": doc.get("icon"),
        "permissions": doc.get("permissions") or {},
        "is_builtin": False,
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "created_by": doc.get("created_by"),
    }


# ---------- Models ----------

class PresetIn(BaseModel):
    label: str
    description: Optional[str] = ""
    icon: Optional[str] = None
    permissions: dict = Field(default_factory=dict)


class ApplyPresetIn(BaseModel):
    preset_key: Optional[str] = None
    preset_id: Optional[str] = None


# ---------- Routes ----------

@router.get("")
async def list_presets(actor: dict = Depends(require_permission("users", "view"))):
    custom_docs = await db.permission_presets.find(
        {"org_id": actor["org_id"]}, {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    return {
        "built_in": [_builtin_out(p) for p in BUILT_IN_PRESETS],
        "custom": [_custom_out(d) for d in custom_docs],
    }


@router.post("", status_code=201)
async def create_preset(body: PresetIn, actor: dict = Depends(require_permission("users", "edit"))):
    label = (body.label or "").strip()
    if not label:
        raise HTTPException(400, "Label is required")
    key = _slugify(label)
    # Avoid collision with any built-in key.
    if key in BUILT_IN_BY_KEY:
        key = f"{key}_{new_id()[:6]}"
    # Avoid collision with another custom preset in the same org (same key).
    existing = await db.permission_presets.find_one(
        {"org_id": actor["org_id"], "key": key},
    )
    if existing:
        key = f"{key}_{new_id()[:6]}"
    doc = {
        "id": new_id(),
        "org_id": actor["org_id"],
        "key": key,
        "label": label,
        "description": (body.description or "").strip(),
        "icon": body.icon or "Sparkles",
        "permissions": _validate_permissions(body.permissions),
        "created_by": actor["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "is_builtin": False,
    }
    await db.permission_presets.insert_one(dict(doc))
    return _custom_out(doc)


@router.put("/{preset_id}")
async def update_preset(preset_id: str, body: PresetIn,
                        actor: dict = Depends(require_permission("users", "edit"))):
    if preset_id in BUILT_IN_BY_KEY:
        raise HTTPException(400, "Built-in presets are read-only")
    existing = await db.permission_presets.find_one(
        {"id": preset_id, "org_id": actor["org_id"]}, {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Preset not found")
    patch = {
        "label": (body.label or existing["label"]).strip(),
        "description": (body.description or "").strip(),
        "icon": body.icon or existing.get("icon") or "Sparkles",
        "permissions": _validate_permissions(body.permissions),
        "updated_at": now_iso(),
    }
    await db.permission_presets.update_one(
        {"id": preset_id, "org_id": actor["org_id"]}, {"$set": patch},
    )
    saved = await db.permission_presets.find_one(
        {"id": preset_id, "org_id": actor["org_id"]}, {"_id": 0},
    )
    return _custom_out(saved)


@router.delete("/{preset_id}")
async def delete_preset(preset_id: str,
                        actor: dict = Depends(require_permission("users", "edit"))):
    if preset_id in BUILT_IN_BY_KEY:
        raise HTTPException(400, "Built-in presets cannot be deleted")
    res = await db.permission_presets.delete_one(
        {"id": preset_id, "org_id": actor["org_id"]},
    )
    if res.deleted_count == 0:
        raise HTTPException(404, "Preset not found")
    return {"ok": True}


# ---------- Apply preset to user ----------

async def _resolve_preset(body: ApplyPresetIn, org_id: str) -> dict:
    if body.preset_key and body.preset_key in BUILT_IN_BY_KEY:
        return BUILT_IN_BY_KEY[body.preset_key]
    pid = body.preset_id or body.preset_key
    if pid:
        # Try as a built-in key.
        if pid in BUILT_IN_BY_KEY:
            return BUILT_IN_BY_KEY[pid]
        # Then as a custom preset id (org-scoped).
        doc = await db.permission_presets.find_one(
            {"id": pid, "org_id": org_id}, {"_id": 0},
        )
        if doc:
            return doc
    raise HTTPException(404, "Preset not found")


@apply_router.post("/{user_id}/permissions/apply-preset")
async def apply_preset(user_id: str, body: ApplyPresetIn,
                       actor: dict = Depends(require_permission("users", "edit"))):
    target = await db.users.find_one(
        {"id": user_id, "org_id": actor["org_id"]},
        {"_id": 0, "password_hash": 0},
    )
    if not target:
        raise HTTPException(404, "User not found")
    preset = await _resolve_preset(body, actor["org_id"])
    perms = _validate_permissions(preset.get("permissions") or {})
    await upsert_overrides(user_id, actor["org_id"], perms, actor["id"])
    return {
        "user_id": user_id,
        "applied_preset": {
            "key": preset.get("key") or preset.get("id"),
            "label": preset.get("label"),
            "is_builtin": preset.get("key") in BUILT_IN_BY_KEY,
        },
        "overrides": perms,
        "effective": await effective_for(target),
    }
