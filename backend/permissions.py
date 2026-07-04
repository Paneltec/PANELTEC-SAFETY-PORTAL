"""Permissions matrix — resources × actions × role defaults + per-user overrides.

A permission check resolves in this order:
  1. Per-user override (stored in `user_permissions.overrides[resource][action]`)
  2. Role default (ROLE_DEFAULTS[role][resource][action])
  3. False (deny by default)
"""
from __future__ import annotations
from typing import Dict, Literal, Optional

from fastapi import Depends, HTTPException

from auth import get_current_user
from db import db
from models import now_iso

Action = Literal["open", "view", "edit", "delete", "email"]
ACTIONS: list[Action] = ["open", "view", "edit", "delete", "email"]

# Resource catalog. `email_supported=False` hides the email column entirely
# (also force-denied server-side). `delete_supported=False` means delete
# collapses into edit semantics for legacy resources where we never wanted
# the split (integrations, audit exports, users). New 3.18 resources
# (workers, inductions, certifications, documents, forms) carry the split.
PERMISSIONS_SCHEMA: Dict[str, Dict[str, bool | str]] = {
    "swms":            {"label": "SWMS",                 "email_supported": True,  "delete_supported": True},
    "pre_starts":      {"label": "Pre-starts",           "email_supported": True,  "delete_supported": True},
    "site_diary":      {"label": "Site diary",           "email_supported": True,  "delete_supported": True},
    "hazards":         {"label": "Hazards",              "email_supported": True,  "delete_supported": True},
    "incidents":       {"label": "Incidents",            "email_supported": True,  "delete_supported": True},
    "inspections":     {"label": "Inspections",          "email_supported": True,  "delete_supported": True},
    "contractors":     {"label": "Contractors",          "email_supported": True,  "delete_supported": True},
    "renewals":        {"label": "Renewal links",        "email_supported": True,  "delete_supported": True},
    "audit_exports":   {"label": "Audit exports",        "email_supported": True,  "delete_supported": False},
    "vehicles":        {"label": "Vehicles",             "email_supported": False, "delete_supported": True},
    "assets":          {"label": "Plant & Vehicles",     "email_supported": False, "delete_supported": True},
    "integrations":    {"label": "Integrations",         "email_supported": False, "delete_supported": False},
    "users":           {"label": "Users & permissions",  "email_supported": False, "delete_supported": True},
    # Phase 3.18 — new granular resources.
    "workers":         {"label": "Workers",              "email_supported": False, "delete_supported": True},
    "inductions":      {"label": "Inductions",           "email_supported": True,  "delete_supported": True},
    "certifications":  {"label": "Certifications",       "email_supported": True,  "delete_supported": True},
    "documents":       {"label": "Documents",            "email_supported": False, "delete_supported": True},
    "forms":           {"label": "Forms",                "email_supported": False, "delete_supported": True},
    # v159.0 — new resource for supplier data (Simpro suppliers, notes,
    # tasks, folders, members). Previously the suppliers endpoints used
    # only `get_current_user`, leaking data to worker/contractor roles.
    "suppliers":       {"label": "Suppliers",             "email_supported": False, "delete_supported": True},
}

RESOURCES: list[str] = list(PERMISSIONS_SCHEMA.keys())


def _all(value: bool = True) -> Dict[str, bool]:
    return {a: value for a in ACTIONS}


def _grant(**actions: bool) -> Dict[str, bool]:
    return {a: actions.get(a, False) for a in ACTIONS}


# Role defaults — explicit and conservative. Email is only granted where the
# resource supports it AND the role would reasonably send it externally.
# Phase 3.18: `delete` is its own action. To keep backwards-compat with the
# pre-3.18 server checks (which still inline-enforce `role == "admin"` on the
# really destructive routes), the matrix grants delete=True to admin only —
# even when an HSEQ Lead row otherwise says `_all(True)` for that resource.
# This means an admin can grant delete to a specific HSEQ Lead via per-user
# overrides, and the matrix matches the actual route behaviour.
def _all_no_delete(value: bool = True) -> Dict[str, bool]:
    return {a: (value if a != "delete" else False) for a in ACTIONS}


ROLE_DEFAULTS: Dict[str, Dict[str, Dict[str, bool]]] = {
    "admin": {r: _all(True) if PERMISSIONS_SCHEMA[r]["email_supported"]
              else {**_all(True), "email": False}
              for r in RESOURCES},
    "hseq_lead": {
        "swms":            _all_no_delete(True),
        "pre_starts":      _all_no_delete(True),
        "site_diary":      _all_no_delete(True),
        "hazards":         _all_no_delete(True),
        "incidents":       _all_no_delete(True),
        "inspections":     _all_no_delete(True),
        "contractors":     _all_no_delete(True),
        "renewals":        _all_no_delete(True),
        "audit_exports":   _all_no_delete(True),
        "vehicles":        {**_all_no_delete(True), "email": False},
        "assets":          {**_all_no_delete(True), "email": False},
        "integrations":    {**_all_no_delete(True), "email": False},
        "users":           {**_all_no_delete(True), "email": False},
        # Phase 3.18 — HSEQ Lead can read/edit but NOT delete these.
        "workers":         {**_all_no_delete(True), "email": False},
        "inductions":      _all_no_delete(True),
        "certifications":  _all_no_delete(True),
        "documents":       {**_all_no_delete(True), "email": False},
        "forms":           {**_all_no_delete(True), "email": False},
        # v159.0 — HSEQ Lead sees all supplier data.
        "suppliers":       {**_all_no_delete(True), "email": False},
    },
    "supervisor": {
        "swms":            _all_no_delete(True),
        "pre_starts":      _all_no_delete(True),
        "site_diary":      _all_no_delete(True),
        "hazards":         _all_no_delete(True),
        "incidents":       _all_no_delete(True),
        "inspections":     _all_no_delete(True),
        "contractors":     _all_no_delete(True),
        "renewals":        _all_no_delete(True),
        "audit_exports":   _grant(open=True, view=True, edit=False, email=True),
        "vehicles":        _grant(open=True, view=True, edit=False, email=False),
        "assets":          _grant(open=True, view=True, edit=False, email=False),
        "integrations":    _grant(open=False, view=False, edit=False, email=False),
        "users":           _grant(open=False, view=False, edit=False, email=False),
        # Phase 3.18 — Supervisor reads workers/inductions/certs, edits inductions only.
        "workers":         _grant(open=True, view=True, edit=False, email=False),
        "inductions":      _grant(open=True, view=True, edit=True,  email=False),
        "certifications":  _grant(open=True, view=True, edit=False, email=False),
        "documents":       _grant(open=True, view=True, edit=False, email=False),
        "forms":           _grant(open=True, view=True, edit=True,  email=False),
        # v159.0 — Supervisor can view supplier data.
        "suppliers":       _grant(open=True, view=True, edit=False, email=False),
    },
    "worker": {
        "swms":            _grant(open=True, view=True, edit=False, email=False),
        "pre_starts":      _grant(open=True, view=True, edit=True,  email=False),
        "site_diary":      _grant(open=True, view=True, edit=True,  email=False),
        "hazards":         _grant(open=True, view=True, edit=True,  email=False),
        "incidents":       _grant(open=True, view=True, edit=True,  email=False),
        "inspections":     _grant(open=True, view=True, edit=False, email=False),
        "contractors":     _grant(),
        "renewals":        _grant(),
        "audit_exports":   _grant(),
        "vehicles":        _grant(),
        # v159.0 hardening — workers no longer see the Plant & Vehicles
        # register (cost, GPS trail, service history, driver linkage all
        # leaked previously). Reserved for supervisor+.
        "assets":          _grant(),
        "integrations":    _grant(),
        "users":           _grant(),
        # Phase 3.18 — Workers see their own data only; routes filter by user.
        # v159.0 hardening — documents locked to open/view=false so a worker
        # can't pull the Document Library list. Own inductions still reachable
        # via the induction/certification flow. Suppliers permission denied.
        "workers":         _grant(open=True, view=True, edit=False, email=False),
        "inductions":      _grant(open=True, view=True, edit=False, email=False),
        "certifications":  _grant(open=True, view=True, edit=False, email=False),
        "documents":       _grant(),
        "forms":           _grant(open=True, view=True, edit=True,  email=False),
        "suppliers":       _grant(),
    },
    "auditor": {
        r: _grant(open=True, view=True, edit=False,
                  email=PERMISSIONS_SCHEMA[r]["email_supported"])
        for r in RESOURCES if r != "users"
    } | {"users": _grant()},
}


async def _get_overrides(user_id: str) -> Dict[str, Dict[str, bool]]:
    doc = await db.user_permissions.find_one({"user_id": user_id})
    return (doc or {}).get("overrides") or {}


def _role_default(role: str, resource: str, action: str) -> bool:
    return bool(ROLE_DEFAULTS.get(role, {}).get(resource, {}).get(action, False))


async def can(user: dict, resource: str, action: str) -> bool:
    if resource not in PERMISSIONS_SCHEMA:
        return False
    if action == "email" and not PERMISSIONS_SCHEMA[resource]["email_supported"]:
        return False
    overrides = await _get_overrides(user["id"])
    res_over = overrides.get(resource) or {}
    if action in res_over:
        return bool(res_over[action])
    return _role_default(user["role"], resource, action)


async def effective_for(user: dict) -> Dict[str, Dict[str, bool]]:
    """Resolve the full matrix for a user — role defaults merged with overrides."""
    overrides = await _get_overrides(user["id"])
    out: Dict[str, Dict[str, bool]] = {}
    for resource in RESOURCES:
        out[resource] = {}
        for action in ACTIONS:
            if action == "email" and not PERMISSIONS_SCHEMA[resource]["email_supported"]:
                out[resource][action] = False
                continue
            res_over = overrides.get(resource) or {}
            if action in res_over:
                out[resource][action] = bool(res_over[action])
            else:
                out[resource][action] = _role_default(user["role"], resource, action)
    return out


def require_permission(resource: str, action: str):
    """FastAPI dependency factory. Raises 403 with stable detail string."""
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if not await can(user, resource, action):
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied: {resource}.{action}",
            )
        return user
    return dep


async def upsert_overrides(user_id: str, org_id: str, overrides: dict, updated_by: str) -> dict:
    # Validate: only allow known resources/actions, coerce to bool.
    clean: Dict[str, Dict[str, bool]] = {}
    for resource, actions in (overrides or {}).items():
        if resource not in PERMISSIONS_SCHEMA:
            continue
        sub: Dict[str, bool] = {}
        for action, val in (actions or {}).items():
            if action in ACTIONS:
                if action == "email" and not PERMISSIONS_SCHEMA[resource]["email_supported"]:
                    continue
                sub[action] = bool(val)
        if sub:
            clean[resource] = sub
    doc = {
        "user_id": user_id, "org_id": org_id, "overrides": clean,
        "updated_at": now_iso(), "updated_by": updated_by,
    }
    await db.user_permissions.update_one({"user_id": user_id}, {"$set": doc}, upsert=True)
    saved = await db.user_permissions.find_one({"user_id": user_id}, {"_id": 0})
    return saved or doc


async def has_any_overrides(user_id: str) -> bool:
    doc = await db.user_permissions.find_one({"user_id": user_id})
    return bool(doc and doc.get("overrides"))
