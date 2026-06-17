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

Action = Literal["open", "view", "edit", "email"]
ACTIONS: list[Action] = ["open", "view", "edit", "email"]

# 12 resources × 4 actions. `email_supported=False` means the UI hides the email
# column entirely; the `email` action is also force-denied server-side.
PERMISSIONS_SCHEMA: Dict[str, Dict[str, bool | str]] = {
    "swms":          {"label": "SWMS",                 "email_supported": True},
    "pre_starts":    {"label": "Pre-starts",           "email_supported": True},
    "site_diary":    {"label": "Site diary",           "email_supported": True},
    "hazards":       {"label": "Hazards",              "email_supported": True},
    "incidents":     {"label": "Incidents",            "email_supported": True},
    "inspections":   {"label": "Inspections",          "email_supported": True},
    "contractors":   {"label": "Contractors",          "email_supported": True},
    "renewals":      {"label": "Renewal links",        "email_supported": True},
    "audit_exports": {"label": "Audit exports",        "email_supported": True},
    "vehicles":      {"label": "Vehicles",             "email_supported": False},
    "integrations":  {"label": "Integrations",         "email_supported": False},
    "users":         {"label": "Users & permissions",  "email_supported": False},
}

RESOURCES: list[str] = list(PERMISSIONS_SCHEMA.keys())


def _all(value: bool = True) -> Dict[str, bool]:
    return {a: value for a in ACTIONS}


def _grant(**actions: bool) -> Dict[str, bool]:
    return {a: actions.get(a, False) for a in ACTIONS}


# Role defaults — explicit and conservative. Email is only granted where the
# resource supports it AND the role would reasonably send it externally.
ROLE_DEFAULTS: Dict[str, Dict[str, Dict[str, bool]]] = {
    "admin": {r: _all(True) if PERMISSIONS_SCHEMA[r]["email_supported"]
              else {**_all(True), "email": False}
              for r in RESOURCES},
    "hseq_lead": {
        "swms":          _all(True),
        "pre_starts":    _all(True),
        "site_diary":    _all(True),
        "hazards":       _all(True),
        "incidents":     _all(True),
        "inspections":   _all(True),
        "contractors":   _all(True),
        "renewals":      _all(True),
        "audit_exports": _all(True),
        "vehicles":      {**_all(True), "email": False},
        "integrations":  {**_all(True), "email": False},
        "users":         {**_all(True), "edit": False, "email": False},
    },
    "supervisor": {
        "swms":          _all(True),
        "pre_starts":    _all(True),
        "site_diary":    _all(True),
        "hazards":       _all(True),
        "incidents":     _all(True),
        "inspections":   _all(True),
        "contractors":   _all(True),
        "renewals":      _all(True),
        "audit_exports": _grant(open=True, view=True, edit=False, email=True),
        "vehicles":      _grant(open=True, view=True, edit=False, email=False),
        "integrations":  _grant(open=True, view=True, edit=False, email=False),
        "users":         _grant(open=False, view=False, edit=False, email=False),
    },
    "worker": {
        "swms":          _grant(open=True, view=True, edit=False, email=False),
        "pre_starts":    _grant(open=True, view=True, edit=True,  email=False),
        "site_diary":    _grant(open=True, view=True, edit=True,  email=False),
        "hazards":       _grant(open=True, view=True, edit=True,  email=False),
        "incidents":     _grant(open=True, view=True, edit=True,  email=False),
        "inspections":   _grant(open=True, view=True, edit=False, email=False),
        "contractors":   _grant(),
        "renewals":      _grant(),
        "audit_exports": _grant(),
        "vehicles":      _grant(),
        "integrations":  _grant(),
        "users":         _grant(),
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
