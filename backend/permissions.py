"""Permissions matrix — resources × actions × role defaults + per-user overrides.

A permission check resolves in this order:
  1. Per-user override (stored in `user_permissions.overrides[resource][action]`)
  2. Role default (ROLE_DEFAULTS[role][resource][action])
  3. False (deny by default)
"""
from __future__ import annotations
import time
from typing import Dict, Literal, Optional

from fastapi import Depends, HTTPException, Request

from auth import get_current_user
from db import db
from models import now_iso

Action = Literal["open", "view", "edit", "delete", "email", "team_view", "use"]
ACTIONS: list[Action] = ["open", "view", "edit", "delete", "email", "team_view", "use"]

# v159.2 — Resources subject to team-scoping: workers who lack `team_view`
# on these resources only see records where `created_by == user.id`.
# Supervisors/HSEQ Leads/Admin/Auditor inherit `team_view=True` via their
# role defaults below, so their behavior is unchanged.
# v160.0 — added `inductions` (induction matrix is admin-oriented; worker
# phone sees only their own row via a dedicated endpoint).
TEAM_SCOPED_RESOURCES: set[str] = {
    "swms", "pre_starts", "site_diary", "hazards", "incidents", "inspections",
    "inductions", "workers",
}

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
    # v160.0.8 — AI features (SWMS drafter, diary structurer, hazard vision).
    # `use` action gates the paid LLM endpoints; admin/hseq/supervisor grant,
    # worker/contractor deny by default.
    "ai":              {"label": "AI features",           "email_supported": False, "delete_supported": False},
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
        # v160.0.8 — v160.0.7 audit: expand supervisor team_view.
        "workers":         _grant(open=True, view=True, edit=False, email=False, team_view=True),
        "inductions":      _grant(open=True, view=True, edit=True,  email=False, team_view=True),
        "certifications":  _grant(open=True, view=True, edit=False, email=False),
        "documents":       _grant(open=True, view=True, edit=False, email=False),
        "forms":           _grant(open=True, view=True, edit=True,  email=False, team_view=True),
        # v159.0 — Supervisor can view supplier data.
        "suppliers":       _grant(open=True, view=True, edit=False, email=False),
        # v160.0.8 — Supervisor: team_view on workers/forms, AI use ON.
        "ai":              _grant(open=True, view=True, edit=True, use=True),
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
        # v160.0.8 — Worker denied AI feature use (paid LLM endpoints).
        "ai":              _grant(),
    },
    "auditor": {
        r: _grant(open=True, view=True, edit=False,
                  email=PERMISSIONS_SCHEMA[r]["email_supported"],
                  # v159.2 — auditors need org-wide visibility on the six
                  # team-scoped resources so their evidence packs stay complete.
                  team_view=(r in TEAM_SCOPED_RESOURCES))
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


async def resolve_team_scope(
    user: dict,
    resource: str,
    requested_scope: Optional[str] = None,
) -> Optional[str]:
    """v159.2 — Decide whether a list/detail query for `resource` should be
    filtered to the caller's own records (`created_by == user.id`).

    Returns:
      • `user["id"]` — caller must be limited to their own records.
      • `None`       — caller has team_view and sees everything.

    Behaviour:
      • `?scope=me`   → always return `user["id"]` (even for admin).
      • `?scope=team` → require team_view; else raise 403.
      • no scope      → return `user["id"]` iff caller lacks team_view.

    For resources outside `TEAM_SCOPED_RESOURCES`, no filter is applied.
    """
    if resource not in TEAM_SCOPED_RESOURCES:
        return None
    if requested_scope == "me":
        return str(user["id"])
    has_team = await can(user, resource, "team_view")
    if requested_scope == "team":
        if not has_team:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied: {resource}.team_view",
            )
        return None
    return None if has_team else str(user["id"])


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


# ═══════════════════════════════════════════════════════════════════════
# v160.0.9 — Path C Cycle 2: Module-system enforcement
#
# `require_module()` verifies that the mobile-app caller's role has the
# given module enabled in their org's `mobile_modules` matrix. This
# closes the loophole where an admin toggling a module OFF only hid the
# tile on the phone — the endpoint stayed callable via direct API. Now
# the endpoint responds 403.
#
# Design notes:
#   • Only enforced when the caller sends `x-client-platform: mobile`.
#     Web calls bypass entirely (they use per-user role/permission gates
#     already; module toggles are a phone-UX construct).
#   • `admin` and `hseq_lead` always bypass (allow_privileged=True) so a
#     misconfigured toggle can't lock an operator out of their own kit.
#   • Cached in-memory for 60s per (org_id, role) to avoid a Mongo hit
#     per request. The org_settings write handler bumps a counter that
#     invalidates callers cheaply; a stale 60s window is acceptable
#     because module toggles are exceptional, not high-frequency.
# ═══════════════════════════════════════════════════════════════════════

_MODULES_CACHE: Dict[str, tuple[float, Dict[str, bool]]] = {}
_MODULES_TTL_SEC = 60.0
# Roles that always bypass the module gate. These are the operator/HSEQ
# rows that MUST be able to reach every endpoint even if a module is off
# in the mobile UI for other roles.
_MODULE_PRIVILEGED_ROLES = {"admin", "hseq_lead"}


def is_mobile_client(request: Optional[Request]) -> bool:
    """True when the caller declares itself the Expo mobile app.

    Two signals accepted (either is enough):
      1. `x-client-platform: mobile` header (preferred, set by
         `mobile/src/lib/api.ts` interceptor).
      2. `User-Agent` contains `Expo` or `okhttp` (native fetch on
         Android) — legacy fallback for older builds that predate the
         header rollout.
    """
    if request is None:
        return False
    try:
        h = request.headers
    except Exception:
        return False
    plat = (h.get("x-client-platform") or "").strip().lower()
    if plat == "mobile":
        return True
    ua = (h.get("user-agent") or "").lower()
    return "expo" in ua or "okhttp" in ua or "reactnative" in ua


async def _load_role_modules(org_id: str, role: str) -> Dict[str, bool]:
    """Cached read of the mobile_modules row for (org, role). Falls
    back to the DEFAULTS table if the org row is missing (fresh orgs
    that have never saved the matrix)."""
    cache_key = f"{org_id}:{role}"
    now = time.monotonic()
    hit = _MODULES_CACHE.get(cache_key)
    if hit and hit[0] > now:
        return hit[1]
    # Import inside the function to avoid a circular import
    # (`mobile_modules` imports from `auth` which imports from us).
    from mobile_modules import _load_matrix, DEFAULTS, ROLE_KEYS
    try:
        matrix = await _load_matrix(org_id)
    except Exception:
        matrix = {r: dict(DEFAULTS.get(r, {})) for r in ROLE_KEYS}
    row = dict(matrix.get(role) or DEFAULTS.get(role) or {})
    _MODULES_CACHE[cache_key] = (now + _MODULES_TTL_SEC, row)
    return row


def invalidate_modules_cache(org_id: Optional[str] = None) -> None:
    """Clear the in-memory module cache. Called from the PUT handler in
    `mobile_modules.py` after an admin saves a new matrix so subsequent
    calls see the change immediately (without waiting for the TTL)."""
    if org_id is None:
        _MODULES_CACHE.clear()
        return
    dead = [k for k in _MODULES_CACHE if k.startswith(f"{org_id}:")]
    for k in dead:
        _MODULES_CACHE.pop(k, None)


def require_module(module_id: str, allow_privileged: bool = True):
    """FastAPI dependency factory. Verifies the caller's role has the
    given mobile module enabled. Web callers (no mobile platform
    header) bypass. Admin/hseq_lead bypass unless `allow_privileged=False`.

    Raises 403 with `{"detail": f"Module '{module_id}' disabled for your role"}`.
    """
    async def dep(
        request: Request,
        user: dict = Depends(get_current_user),
    ) -> dict:
        # Web caller? Skip — the module gate is a phone-UX construct.
        if not is_mobile_client(request):
            return user
        role = (user.get("role") or "").lower()
        if allow_privileged and role in _MODULE_PRIVILEGED_ROLES:
            return user
        row = await _load_role_modules(user["org_id"], role)
        # Defensive default: if the module key is missing from the stored
        # doc (e.g. a new module added mid-cycle), fall back to the
        # DEFAULTS table so we never block a legitimate call because of
        # a schema drift. If STILL missing, default False (deny).
        if module_id in row:
            enabled = bool(row[module_id])
        else:
            from mobile_modules import DEFAULTS
            enabled = bool((DEFAULTS.get(role) or {}).get(module_id, False))
        if not enabled:
            raise HTTPException(
                status_code=403,
                detail=f"Module '{module_id}' disabled for your role",
            )
        return user
    return dep
