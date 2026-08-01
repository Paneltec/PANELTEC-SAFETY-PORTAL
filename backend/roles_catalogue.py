"""v160.3.9.26 — Roles catalogue (system roles) + admin listing endpoint.

The 11 system roles are defined here as full permission-token lists.
They are seeded (idempotent) into the `roles` collection on startup.
Two contractor-scoped roles are inserted with `is_active=False` because
the record-level scoping helper they depend on lands in Phase 3
(decision #15).

Nothing in Phase 2 *reads* `roles.permission_tokens` for enforcement —
`require_permission` still consults `ROLE_DEFAULTS` + user overrides.
Phase 4 wires the UI. Phase 5 flips the read side.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import require_roles
from db import db
from models import new_id, now_iso
from permissions import ACTIONS, PERMISSIONS_SCHEMA, RESOURCES


# ─────────────────────────────────────────────────────────────
# Token-list builders
# ─────────────────────────────────────────────────────────────

def _t(resource: str, actions: List[str]) -> List[str]:
    """Produce `resource.action` strings, silently dropping actions
    the resource can't support (`email` on email_supported=False, etc.)."""
    out: list[str] = []
    for a in actions:
        if a not in ACTIONS:
            continue
        if a == "email" and not PERMISSIONS_SCHEMA[resource].get("email_supported"):
            continue
        out.append(f"{resource}.{a}")
    return out


def _all_tokens() -> List[str]:
    tokens: list[str] = []
    for r in RESOURCES:
        for a in ACTIONS:
            if a == "email" and not PERMISSIONS_SCHEMA[r].get("email_supported"):
                continue
            tokens.append(f"{r}.{a}")
    return tokens


# Resource groupings (per doc 04)
_CAPTURE = [
    "swms", "pre_starts", "site_diary", "hazards", "incidents",
    "inspections", "risk_assessments",
]
_OPS = [
    "contractors", "renewals", "workers", "inductions",
    "certifications", "documents", "forms", "assets", "vehicles",
    "suppliers", "reference_library", "notifications", "sites",
]
_VIEW_EDIT_EMAIL_TEAM = ["open", "view", "edit", "email", "team_view"]
_VIEW_EDIT_TEAM = ["open", "view", "edit", "team_view"]
_VIEW_EMAIL = ["view", "email"]
_VIEW = ["view"]
_OPEN_VIEW = ["open", "view"]
_OPEN_VIEW_EDIT = ["open", "view", "edit"]


def _tokens_admin() -> List[str]:
    return _all_tokens()


def _tokens_hseq_manager() -> List[str]:
    out: list[str] = []
    for r in _CAPTURE + _OPS:
        out += _t(r, _VIEW_EDIT_EMAIL_TEAM)
    out += _t("audit_exports", _VIEW_EMAIL)
    out += _t("users", _VIEW)
    out += _t("ai", ["use"])
    out += _t("notifications", ["use"])
    return sorted(set(out))


def _tokens_hseq_manager_readonly() -> List[str]:
    out: list[str] = []
    for r in _CAPTURE + _OPS + ["audit_exports"]:
        out += _t(r, _OPEN_VIEW)
    return sorted(set(out))


def _tokens_hseq_manager_creator() -> List[str]:
    """Same as hseq_manager MINUS reference_library.edit MINUS forms.edit
    on template ownership. Since our matrix doesn't distinguish templates
    vs. submissions, we drop `forms.edit` entirely (Phase 4 UI reintroduces
    the distinction) and drop `reference_library.edit`."""
    tokens = set(_tokens_hseq_manager())
    tokens.discard("forms.edit")
    tokens.discard("reference_library.edit")
    return sorted(tokens)


def _tokens_report_emailing_admin() -> List[str]:
    out: list[str] = []
    for r in [
        "swms", "pre_starts", "hazards", "incidents", "inspections",
        "risk_assessments", "contractors", "renewals", "inductions",
        "certifications", "forms", "reference_library",
    ]:
        out += _t(r, _VIEW_EMAIL)
    out += _t("notifications", ["view", "use"])
    out += _t("audit_exports", _VIEW_EMAIL)
    return sorted(set(out))


def _tokens_responsible_manager() -> List[str]:
    out: list[str] = []
    for r in ["hazards", "incidents", "inspections"]:
        out += _t(r, _VIEW_EDIT_EMAIL_TEAM)
    for r in ["swms", "pre_starts", "site_diary", "risk_assessments"]:
        out += _t(r, _VIEW_EDIT_TEAM)
    for r in ["workers", "certifications", "inductions"]:
        out += _t(r, _OPEN_VIEW + ["team_view"])
    out += _t("audit_exports", _VIEW_EMAIL)
    out += _t("notifications", ["view", "use"])
    out += _t("ai", ["use"])
    return sorted(set(out))


def _tokens_contractor_rep() -> List[str]:
    """External contractor coordinator. Effective enforcement of
    company_id scoping lives in the Phase 3 scoping helper — until
    then this role is seeded with `is_active=False`."""
    out: list[str] = []
    for r in ["contractors", "workers", "certifications",
              "inductions", "documents"]:
        out += _t(r, _VIEW_EDIT_EMAIL_TEAM if r in ("contractors",) else _OPEN_VIEW_EDIT)
    return sorted(set(out))


def _tokens_contractor_rep_submit_only() -> List[str]:
    out: list[str] = []
    out += _t("contractors", ["view"])
    out += _t("documents", _OPEN_VIEW_EDIT)
    out += _t("certifications", ["view", "edit"])
    return sorted(set(out))


def _tokens_mechanic() -> List[str]:
    out: list[str] = []
    out += _t("assets", _VIEW_EDIT_TEAM)
    out += _t("vehicles", _OPEN_VIEW_EDIT)
    out += _t("documents", _OPEN_VIEW_EDIT)
    out += _t("certifications", ["view"])
    return sorted(set(out))


def _tokens_training_inductions_only() -> List[str]:
    out: list[str] = []
    for r in ["inductions", "certifications"]:
        out += _t(r, ["open", "view", "edit", "email"])
    out += _t("workers", ["view"])
    return sorted(set(out))


def _tokens_general_user() -> List[str]:
    """Default role — the 557-grant `General User` column in the
    Lucidity export."""
    out: list[str] = []
    for r in _CAPTURE + ["contractors", "documents"]:
        out += _t(r, _OPEN_VIEW_EDIT) if r not in ("swms", "inspections", "risk_assessments") else _t(r, _OPEN_VIEW)
    out += _t("workers", ["view"])
    out += _t("help", _OPEN_VIEW)
    out += _t("notifications", ["view", "use"])
    return sorted(set(out))


# ─────────────────────────────────────────────────────────────
# Seed manifest
# ─────────────────────────────────────────────────────────────

# `supersedes_role_id` here records the legacy `users.role` string that
# migrates onto the new role_id (decision #13). It is NOT a self-
# reference — it is the OLD identifier that this role replaces.

SYSTEM_ROLES: List[Dict[str, Any]] = [
    {
        "role_id": "admin",
        "name": "Administrator",
        "description": "Full access. Owns user management, integrations, billing.",
        "permission_tokens": _tokens_admin(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": "admin",  # legacy string identical
    },
    {
        "role_id": "hseq_manager",
        "name": "HSEQ Manager",
        "description": "HSEQ lead with cross-team visibility. Cannot delete.",
        "permission_tokens": _tokens_hseq_manager(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": "hseq_lead",
    },
    {
        "role_id": "hseq_manager_readonly",
        "name": "HSEQ Manager (Read-only)",
        "description": "Cross-team read-only oversight. Lucidity Read-Only equivalent.",
        "permission_tokens": _tokens_hseq_manager_readonly(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": None,
    },
    {
        "role_id": "hseq_manager_creator",
        "name": "HSEQ Manager (Creator)",
        "description": "Create/edit records; no template ownership; no reference-library edit.",
        "permission_tokens": _tokens_hseq_manager_creator(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": None,
    },
    {
        "role_id": "report_emailing_admin",
        "name": "Report Emailing",
        "description": "View + send scheduled reports. Cannot create/edit records.",
        "permission_tokens": _tokens_report_emailing_admin(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": None,
    },
    {
        "role_id": "responsible_manager",
        "name": "Responsible Manager",
        "description": "Team supervisor; owns close-out on hazards/incidents/inspections.",
        "permission_tokens": _tokens_responsible_manager(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": "supervisor",
    },
    {
        "role_id": "contractor_rep",
        "name": "Contractor Representative",
        "description": "External contractor coordinator (org-scoped).",
        "permission_tokens": _tokens_contractor_rep(),
        "is_system": True,
        # v160.3.9.26 — Held inactive until Phase 3 ships the record-level
        # company_id scoping helper (decision #15).
        "is_active": False,
        "pending_scoping_helper": True,
        "supersedes_role_id": None,
    },
    {
        "role_id": "contractor_rep_submit_only",
        "name": "Contractor Representative (Submit-Only)",
        "description": "External submitter — only required documents.",
        "permission_tokens": _tokens_contractor_rep_submit_only(),
        "is_system": True,
        # Same reason as contractor_rep.
        "is_active": False,
        "pending_scoping_helper": True,
        "supersedes_role_id": None,
    },
    {
        "role_id": "mechanic",
        "name": "Mechanic",
        "description": "Plant maintenance role. Cannot delete assets or manage users.",
        "permission_tokens": _tokens_mechanic(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": None,
    },
    {
        "role_id": "training_inductions_only",
        "name": "Training / Inductions Only",
        "description": "Access limited to induction and certification records.",
        "permission_tokens": _tokens_training_inductions_only(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": None,
    },
    {
        "role_id": "general_user",
        "name": "General User",
        "description": "Default role — own submissions across capture modules.",
        "permission_tokens": _tokens_general_user(),
        "is_system": True,
        "is_active": True,
        "supersedes_role_id": "worker",
    },
]


# ─────────────────────────────────────────────────────────────
# Idempotent seeder — called from server.py::on_startup
# ─────────────────────────────────────────────────────────────

async def seed_system_roles() -> Dict[str, Any]:
    """Upserts each row in `SYSTEM_ROLES` into `roles` collection.
    Mutable fields (`permission_tokens`, `description`, `updated_at`,
    `is_active`) are refreshed every run; identity fields are
    `$setOnInsert`. Returns a summary dict."""
    ts = now_iso()
    counts = {"inserted": 0, "updated": 0}
    for spec in SYSTEM_ROLES:
        existing = await db.roles.find_one({"role_id": spec["role_id"]})
        set_doc = {
            "name": spec["name"],
            "description": spec["description"],
            "permission_tokens": spec["permission_tokens"],
            "is_system": spec["is_system"],
            "is_active": spec["is_active"],
            "supersedes_role_id": spec.get("supersedes_role_id"),
            "pending_scoping_helper": spec.get("pending_scoping_helper", False),
            "updated_at": ts,
        }
        setoninsert_doc = {
            "id": new_id(),
            "role_id": spec["role_id"],
            "created_at": ts,
        }
        await db.roles.update_one(
            {"role_id": spec["role_id"]},
            {"$set": set_doc, "$setOnInsert": setoninsert_doc},
            upsert=True,
        )
        if existing is None:
            counts["inserted"] += 1
        else:
            counts["updated"] += 1
    return {"ok": True, "counts": counts, "total": len(SYSTEM_ROLES)}


async def ensure_roles_indexes() -> None:
    """Idempotent."""
    try:
        await db.roles.create_index("role_id", unique=True)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
# Admin listing endpoint
# ─────────────────────────────────────────────────────────────

router = APIRouter(prefix="/admin/roles", tags=["admin-roles"])


@router.get("")
async def list_roles(user: dict = Depends(require_roles("admin"))):
    """List every role in the catalogue. Admin-only."""
    docs = await db.roles.find({}, {"_id": 0}).sort("role_id", 1).to_list(200)
    return {
        "count": len(docs),
        "roles": docs,
    }


@router.get("/{role_id}")
async def get_role(role_id: str, user: dict = Depends(require_roles("admin"))):
    doc = await db.roles.find_one({"role_id": role_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Role not found")
    return doc
