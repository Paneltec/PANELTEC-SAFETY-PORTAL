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
# v58.13.64a — cache/invalidator + module-data table moved to leaf
# modules so we can import them at top level without cycling back
# through `mobile_modules`.
from permission_helpers import (  # noqa: F401  (invalidate_modules_cache re-exported)
    _MODULES_CACHE, _MODULES_TTL_SEC, invalidate_modules_cache,
)
from mobile_modules_data import DEFAULTS, ROLE_KEYS, _load_matrix

Action = Literal["open", "view", "edit", "delete", "email", "team_view", "use", "approve",
                 # v160.3.9.48 — hr_employees-specific extended actions.
                 # Kept in the shared Action list so `_validate_tokens` and
                 # `effective_for` don't reject them. Other resources leave
                 # these cells `False` via `_grant()`'s default.
                 "reveal_pii", "archive", "reimport", "audit_view"]
ACTIONS: list[Action] = ["open", "view", "edit", "delete", "email", "team_view", "use", "approve",
                         "reveal_pii", "archive", "reimport", "audit_view"]

# v159.2 — Resources subject to team-scoping: workers who lack `team_view`
# on these resources only see records where `created_by == user.id`.
# Supervisors/HSEQ Leads/Admin/Auditor inherit `team_view=True` via their
# role defaults below, so their behavior is unchanged.
# v160.0 — added `inductions` (induction matrix is admin-oriented; worker
# phone sees only their own row via a dedicated endpoint).
# v58.13.132kn — REMOVED `swms` from the team-scoped set. SWMS visibility
# is now driven by the `applies_to` assignment matrix (roles/worker_ids/
# company_ids/asset_types) via `swms_visibility_filter()` in
# `permissions_scope.py`, matching real WHS semantics. Creator-based
# narrowing was hiding admin-uploaded SWMS from every mobile worker,
# which is a WHS Reg 39 compliance gap. See ship memo
# `memory/v58_13_132kn_swms_applies_to_scope.md`.
TEAM_SCOPED_RESOURCES: set[str] = {
    "pre_starts", "site_diary", "hazards", "incidents", "inspections",
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
    # v160.3.0-adjust-13 — new Capture bucket. Behaves exactly like
    # `inspections` (view/open/edit/email/delete). Routes read via the
    # mirror-projection on templates with category === "risk_assessment".
    "risk_assessments": {"label": "Risk Assessments",     "email_supported": True,  "delete_supported": True},
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
    # v160.3.9.26 — New resources introduced to fold Lucidity module
    # groups into the matrix. Left email_supported=False by default;
    # audit exports carry the email fan-out. Only admin picks up
    # defaults via the `admin` comprehension below; all other seeded
    # roles resolve to `False` for these until a role_id/override
    # explicitly grants them (Phase 3 work).
    "reference_library": {"label": "Reference Library",   "email_supported": False, "delete_supported": True},
    "notifications":   {"label": "Notifications",         "email_supported": False, "delete_supported": True},
    "help":            {"label": "Help / User Manual",    "email_supported": False, "delete_supported": True},
    "sites":           {"label": "Sites (QR sign-on)",    "email_supported": False, "delete_supported": True},
    # v160.3.9.48 — HR Employees register. PII-heavy resource with
    # extended actions: reveal_pii / archive / reimport / audit_view
    # gate the sensitive endpoints in `hr_employees.py`.
    "hr_employees":    {"label": "HR Employees",           "email_supported": False, "delete_supported": True},
    # v58.13.90 — Comms Safe Mode toggle. Deliberately isolated from
    # the generic `admin` role auto-grant below (see the explicit
    # `ROLE_DEFAULTS["admin"]["comms_safe_mode"]` denial after the
    # dict comprehension). Only `edit` matters — `view` is not
    # required because Safe Mode status is public to any authed user
    # via `/api/admin/comms-safe-mode/status`. Per-user override via
    # `db.user_permissions` (see startup seed in `server.py`).
    "comms_safe_mode": {"label": "Comms Safe Mode",        "email_supported": False, "delete_supported": False},
    "sites_visitors":  {"label": "Site visitors",           "email_supported": False, "delete_supported": True},
    # v58.13.132mz — Dedicated permission cell for the admin "mock phone
    # preview" iframe on Settings → Permissions Matrix → Mobile App
    # Modules. Only `view` is semantically meaningful — the other
    # cells render as toggles in the matrix but have no runtime
    # gates behind them. Previously the preview inherited from
    # `users.view`; decoupling lets admins hand out phone-preview
    # access without also granting the full user-permissions surface.
    "mobile_preview":  {"label": "Mobile phone preview",     "email_supported": False, "delete_supported": False},
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
    # v160.3.9.26 — Also block `approve` here. When we broadened the
    # action set to 8, we didn't want hseq_lead/supervisor to silently
    # inherit approve=True on every resource — approve is a permittowork-
    # specific authority and lives in the seeded roles collection, not
    # in legacy ROLE_DEFAULTS.
    return {a: (value if a not in ("delete", "approve") else False) for a in ACTIONS}


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
        # v160.3.0-adjust-13 — HSEQ Lead: same defaults as `inspections`.
        "risk_assessments": _all_no_delete(True),
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
        # v160.3.9.29-2b — Extend seed for Phase 3c decision #5.
        # hseq_lead now writes reference libraries (Companies, CS Incident,
        # Completed Training, List Roles, List Forms, Incident Root Causes,
        # Master Risks) AND site QR sign-on records. Aligns FE gates with
        # backend seeds so mechanical 2b migration doesn't narrow anyone.
        "reference_library": {**_all_no_delete(True), "email": False},
        "sites":             {**_all_no_delete(True), "email": False},
        # v160.3.9.48 — HSEQ Lead legacy role gets read-only visibility on
        # the HR Employees register. Sensitive actions (reveal_pii, edit,
        # archive, reimport, audit_view) stay admin-only.
        "hr_employees":      _grant(open=True, view=True),
    },
    # v160.3.9.30 — Phase 3d: contractor role activation. ROLE_DEFAULTS
    # entries added per Blocker-F resolution (F-i + Option B). Effective
    # enforcement of `company_id` scoping happens via permissions_scope.py
    # (Phase 3b); this dict only sets the base action matrix that
    # `require_permission()` gates against. See catalogue §7 & §8.
    "contractor_rep": {
        "contractors":     _grant(open=True, view=True, edit=True,  delete=False, email=True,  team_view=False, approve=False),
        # v160.3.9.30 drift-guard reconcile — `workers` + `documents` have
        # `email_supported=False` in PERMISSIONS_SCHEMA (email is force-denied
        # server-side + filtered out by roles_catalogue `_t()` helper).
        # Catalogue §7 draft said "email on all 5" but schema is the hard
        # rule (hseq_lead already models this — see lines 130/133). Drop
        # `email=True` here so ROLE_DEFAULTS matches published SYSTEM_ROLES.
        "workers":         _grant(open=True, view=True, edit=True,  delete=False, email=False, team_view=False),
        "certifications":  _grant(open=True, view=True, edit=True,  delete=False, email=True,  team_view=False),
        "inductions":      _grant(open=True, view=True, edit=True,  delete=False, email=True,  team_view=False),
        "documents":       _grant(open=True, view=True, edit=True,  delete=False, email=False, team_view=False),
    },
    "contractor_rep_submit_only": {
        "contractors":     _grant(open=False, view=True,  edit=False, delete=False, email=False, team_view=False),
        "documents":       _grant(open=True,  view=True,  edit=True,  delete=False, email=False, team_view=False),
        "certifications":  _grant(open=False, view=True,  edit=True,  delete=False, email=False, team_view=False),
        # v160.3.9.30 amendment to catalogue §8 — `forms.edit` added so the
        # "submit-only" persona can actually submit compliance forms
        # (upload PPE/insurance + submit renewal form). Without this the
        # role is neutered.
        "forms":           _grant(open=True,  view=True,  edit=True,  delete=False, email=False, team_view=False),
    },
    "supervisor": {
        "swms":            _all_no_delete(True),
        "pre_starts":      _all_no_delete(True),
        "site_diary":      _all_no_delete(True),
        "hazards":         _all_no_delete(True),
        "incidents":       _all_no_delete(True),
        "inspections":     _all_no_delete(True),
        # v160.3.0-adjust-13 — same defaults as `inspections`.
        "risk_assessments": _all_no_delete(True),
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
        # v160.3.0-adjust-13 — worker parity with inspections (view own).
        "risk_assessments": _grant(open=True, view=True, edit=False, email=False),
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

# v160.3.9.48 — Auditor picks up `audit_view` on `hr_employees` on top of
# the org-wide view baseline (grants `open`, `view`, and `audit_view`).
# `reveal_pii`, `edit`, `archive`, `reimport`, `delete` remain False —
# an auditor reads records + reviews the audit trail, never mutates.
ROLE_DEFAULTS["auditor"]["hr_employees"] = _grant(
    open=True, view=True, audit_view=True,
)

# v58.13.90 — Comms Safe Mode toggle is DENIED for every seeded role
# by default, including admin. The dict comprehension above grants
# admin `_all(True)` across every resource; we explicitly clobber
# `comms_safe_mode` here so an admin can only get the toggle via an
# explicit per-user override in `db.user_permissions`. Same treatment
# for the four other seeded roles that get here via `_all_no_delete`
# / `_grant()` — none of them touch Safe Mode unless an admin hands
# them the override deliberately. USER PAIN VERBATIM: "could we have
# a toggle in users permissions and give me the one that can toggle
# safe mode."
for _role in ROLE_DEFAULTS:
    ROLE_DEFAULTS[_role]["comms_safe_mode"] = _grant()  # every action False
del _role

# v58.13.106 — Public visitor sign-in flow. Admin gets view+edit by
# default so they can see the visitor register + force-signout. All
# other roles blocked (grant via user_permissions override if needed).
ROLE_DEFAULTS["admin"]["sites_visitors"] = _grant(view=True, edit=True, delete=True)
for _r in ("member", "auditor", "contractor", "worker"):
    if _r in ROLE_DEFAULTS:
        ROLE_DEFAULTS[_r]["sites_visitors"] = _grant()  # all False
del _r

# v58.13.132mz — Dedicated `mobile_preview` cell defaults.
# Admin already picked up `mobile_preview.view=True` via the
# `_all(True)` comprehension at the top of ROLE_DEFAULTS.
# Every OTHER seeded role in the hardcoded fallback is explicitly
# denied so that decoupling behaviour matches the intent: only
# admins can open the mock phone preview by default; other roles
# require an explicit token in `roles.permission_tokens[]` or a
# per-user override in `db.user_permissions`. The `auditor` role
# is built via a comprehension that grants view=True on every
# resource except `users`; we clobber it here so a read-only
# auditor doesn't silently gain preview access.
for _role in ROLE_DEFAULTS:
    if _role == "admin":
        continue
    ROLE_DEFAULTS[_role]["mobile_preview"] = _grant()  # every action False
del _role


async def _get_overrides(user_id: str) -> Dict[str, Dict[str, bool]]:
    doc = await db.user_permissions.find_one({"user_id": user_id})
    return (doc or {}).get("overrides") or {}


# ─────────────────────────────────────────────────────────────
# v160.3.9.35 — Phase 6: Token unification.
# `_role_default()` is now ALWAYS DB-first for both seeded and
# custom roles. It consults `roles.permission_tokens[]` in Mongo
# keyed on the user's `role_id` (or legacy `role` string) and only
# falls back to the hardcoded `ROLE_DEFAULTS` map when NO active
# role doc exists for that role_id (first-run/pre-seed).
#
# Previously (`v160.3.9.33` Phase 4d Option-1) `_role_default()`
# read only from the hardcoded map, which silently defeated the
# Roles Matrix UI for the 11 seeded roles — an admin could edit
# `permission_tokens[]` and the change would be ignored at runtime.
# This unification makes DB the source of truth for every role
# while preserving the hardcoded fallback for boot-strap safety.
#
# Cache semantics are unchanged: `_ROLE_TOKENS_CACHE` still holds
# per-role_id token sets and is invalidated via `_bust_role_cache()`
# on every mutation in roles_catalogue / bulk-assign-role.
# `_ROLE_TOKENS_CACHE_MISS` now serves a stronger purpose: it
# records role_ids we've verified DO NOT have an active DB doc,
# so those callers correctly fall through to ROLE_DEFAULTS on
# subsequent hits without a repeat Mongo probe.
# ─────────────────────────────────────────────────────────────

_ROLE_TOKENS_CACHE: Dict[str, set] = {}
_ROLE_TOKENS_CACHE_MISS: set = set()  # role_ids we've looked up and found empty/missing


def _bust_role_cache(role_id: Optional[str] = None) -> None:
    """Invalidate cached permission_tokens for one role or the whole table.
    Called from every mutation in roles_catalogue (create/patch/delete/sync)
    and from users bulk-assign-role when it auto-creates a role."""
    global _ROLE_TOKENS_CACHE, _ROLE_TOKENS_CACHE_MISS
    if role_id is None:
        _ROLE_TOKENS_CACHE = {}
        _ROLE_TOKENS_CACHE_MISS = set()
        return
    _ROLE_TOKENS_CACHE.pop(role_id, None)
    _ROLE_TOKENS_CACHE_MISS.discard(role_id)


async def _role_tokens(role_id: Optional[str]) -> Optional[set]:
    """Return the `permission_tokens[]` set for a role_id from Mongo.

    v160.3.9.35 (Phase 6) — signature widened to distinguish two
    outcomes so callers can decide whether to fall back:
      • `None`           → no active role doc exists for this role_id
                            (signal to fall back to ROLE_DEFAULTS).
      • `set(...)`       → an active doc exists; use these tokens
                            EVEN IF the set is empty (empty is an
                            explicit admin choice and must be
                            respected — not a fallback trigger).

    Cached per-role_id; misses recorded in `_ROLE_TOKENS_CACHE_MISS`
    so subsequent hits don't repeat the Mongo probe.
    """
    if not role_id:
        return None
    if role_id in _ROLE_TOKENS_CACHE:
        return _ROLE_TOKENS_CACHE[role_id]
    if role_id in _ROLE_TOKENS_CACHE_MISS:
        return None
    doc = await db.roles.find_one(
        {"role_id": role_id, "is_active": True},
        {"_id": 0, "permission_tokens": 1},
    )
    if not doc:
        _ROLE_TOKENS_CACHE_MISS.add(role_id)
        return None
    tokens = set(doc.get("permission_tokens") or [])
    _ROLE_TOKENS_CACHE[role_id] = tokens
    return tokens


def _role_default_hardcoded(role: Optional[str], resource: str, action: str) -> bool:
    """Sync fallback — reads the module-level `ROLE_DEFAULTS` map.
    Called by the async `_role_default()` only when no active role
    doc exists in Mongo for the caller's role_id. Kept as a helper
    so the hardcoded semantics remain independently unit-testable."""
    return bool(ROLE_DEFAULTS.get(role, {}).get(resource, {}).get(action, False))


async def _role_default(
    user_or_role,
    resource: str,
    action: str,
) -> bool:
    """v160.3.9.35 (Phase 6) — Resolve role-derived permission,
    DB-first for both seeded and custom roles.

    Accepts either:
      • a `user` dict — `role_id` (preferred) then `role` string are
        used to look up DB tokens; `role` string drives the hardcoded
        fallback if the DB lookup misses.
      • a role string — for legacy callers; used for both the DB
        lookup and the hardcoded fallback key.

    Resolution order (per-cell):
      1. `roles.permission_tokens[]` from Mongo keyed on role_id
         (or legacy `role` if role_id is absent). Doc exists →
         token membership is authoritative, including the empty-set
         case ("admin has explicitly granted no permissions").
      2. Hardcoded `ROLE_DEFAULTS[role][resource][action]` — ONLY
         when the DB has no active doc for that role_id
         (first-run / pre-seed / dev boot-strap).

    Per-user overrides (`user_permissions.overrides[resource][action]`)
    are layered on top by `can()` — not the responsibility of this
    function.
    """
    if isinstance(user_or_role, dict):
        role_str = user_or_role.get("role")
        lookup_id = user_or_role.get("role_id") or role_str
    else:
        role_str = user_or_role
        lookup_id = user_or_role
    tokens = await _role_tokens(lookup_id)
    if tokens is None:
        # DB has no active role doc — fall back to the hardcoded map.
        return _role_default_hardcoded(role_str, resource, action)
    return f"{resource}.{action}" in tokens


# Backwards-compat alias. Historically two names were used
# (`_role_default` = hardcoded map, `_role_permits` = DB-first with
# hardcoded fallback for custom roles). Phase 6 collapses them into
# `_role_default`. Keeping the old symbol exported so
# `permissions_middleware.py` and any external importer continue to
# work; both names resolve to the same coroutine.
_role_permits = _role_default


async def can(user: dict, resource: str, action: str) -> bool:
    if resource not in PERMISSIONS_SCHEMA:
        return False
    if action == "email" and not PERMISSIONS_SCHEMA[resource]["email_supported"]:
        return False
    overrides = await _get_overrides(user["id"])
    res_over = overrides.get(resource) or {}
    if action in res_over:
        return bool(res_over[action])
    # v160.3.9.35 — DB-first for every role (seeded + custom); hardcoded
    # ROLE_DEFAULTS only if no active DB doc exists for role_id.
    return await _role_default(user, resource, action)


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
    # v160.3.9.35 (Phase 6) — DB-first for every role. Load the token
    # set once so the per-cell loop stays O(resources*actions) without
    # hitting Mongo per action. When the DB has no active doc for the
    # user's role_id, `db_tokens` is `None` and each cell falls back
    # to the hardcoded ROLE_DEFAULTS map (boot-strap safety).
    role_str = user.get("role")
    lookup_id = user.get("role_id") or role_str
    db_tokens = await _role_tokens(lookup_id)
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
            elif db_tokens is not None:
                out[resource][action] = f"{resource}.{action}" in db_tokens
            else:
                out[resource][action] = _role_default_hardcoded(role_str, resource, action)
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


async def upsert_overrides(user_id: str, org_id: str, overrides: dict,
                           updated_by: str, reasons: Optional[dict] = None) -> dict:
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
    # v160.3.9.32-4c — Reasons sidecar. Keys are "resource.action" strings
    # matching entries in `clean`. Drop reasons whose override no longer
    # exists (idempotent cleanup on remove). HARD-REJECT invalid non-empty
    # reasons with 422 — silent drop was a compliance gap (audit said
    # "override applied, no reason recorded" and admin had no signal).
    # Empty string "" is treated as "explicitly no reason" and passes.
    # Whitespace-only (e.g. "   ") is rejected — admin typed something,
    # they intended to say something, and it was blank.
    clean_reasons: Dict[str, str] = {}
    for k, v in (reasons or {}).items():
        if not isinstance(k, str) or "." not in k:
            continue
        r, a = k.split(".", 1)
        if r not in clean or a not in clean[r]:
            continue  # orphan — override cell doesn't exist; drop silently.
        raw = v if isinstance(v, str) else ""
        stripped = raw.strip()
        if raw == "":
            continue  # explicit empty — no reason recorded, no error.
        if stripped == "":
            raise HTTPException(
                status_code=422,
                detail={"error": "reason_length_invalid",
                        "reason": "whitespace_only",
                        "min": 3, "max": 200, "key": k},
            )
        if len(stripped) < 3 or len(stripped) > 200:
            raise HTTPException(
                status_code=422,
                detail={"error": "reason_length_invalid",
                        "min": 3, "max": 200, "key": k,
                        "actual_length": len(stripped)},
            )
        clean_reasons[k] = stripped
    doc = {
        "user_id": user_id, "org_id": org_id, "overrides": clean,
        "reasons": clean_reasons,
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

_MODULE_PRIVILEGED_ROLES = {"admin", "hseq_lead"}
# v58.13.64a — `_MODULES_CACHE` / `_MODULES_TTL_SEC` /
# `invalidate_modules_cache` were moved to `permission_helpers.py`.
# Names remain re-exported at the top of this module for any consumer
# that imports them from `permissions`.


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
    # v58.13.64a — `_load_matrix`, `DEFAULTS`, `ROLE_KEYS` now come
    # from the leaf `mobile_modules_data` module at top-level import.
    # No function-local import needed anymore.
    try:
        matrix = await _load_matrix(org_id)
    except Exception:
        matrix = {r: dict(DEFAULTS.get(r, {})) for r in ROLE_KEYS}
    row = dict(matrix.get(role) or DEFAULTS.get(role) or {})
    _MODULES_CACHE[cache_key] = (now + _MODULES_TTL_SEC, row)
    return row


def _bypass_via_pdf_token(request: Request) -> bool:
    """v160.3.0-adjust — Signed pdf-tokens carried in `?token=` bypass
    the module gate. Router-level `require_module(...)` dependencies
    would otherwise 401 the `/api/forms/submissions/{id}/pdf` route
    because the request has no Bearer header — the JWT lives in the
    query. We accept the request if the token is a well-formed
    `pdf-token` JWT; the actual record ownership check runs inside
    the endpoint (`_resolve_user_for_pdf`)."""
    token = request.query_params.get("token")
    if not token:
        return False
    try:
        import jwt as _jwt
        from auth import JWT_ALGORITHM, _secret
        payload = _jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except Exception:
        return False
    return payload.get("type") == "pdf-token"


def require_module(module_id: str, allow_privileged: bool = True):
    """FastAPI dependency factory. Verifies the caller's role has the
    given mobile module enabled. Web callers (no mobile platform
    header) bypass. Admin/hseq_lead bypass unless `allow_privileged=False`.

    Raises 403 with `{"detail": f"Module '{module_id}' disabled for your role"}`.
    """
    async def dep(request: Request) -> dict:
        # v160.3.0-adjust — Signed pdf-token in `?token=` skips the
        # module gate; endpoint-level `_resolve_user_for_pdf` still
        # validates the token binding to the record. Returns a
        # sentinel dict so downstream deps that consume the result
        # don't break — but no endpoint on a require_module router
        # actually reads it in the pdf-token path (the endpoint
        # ignores the dep's return value and calls
        # `_resolve_user_for_pdf` itself).
        if _bypass_via_pdf_token(request):
            return {"__pdf_token_bypass__": True}
        user = await get_current_user(request, creds=None)
        # Web caller? Skip — the module gate is a phone-UX construct.
        if not is_mobile_client(request):
            return user
        role = (user.get("role") or "").lower()
        if allow_privileged and role in _MODULE_PRIVILEGED_ROLES:
            return user
        row = await _load_role_modules(user["org_id"], role)
        if module_id in row:
            enabled = bool(row[module_id])
        else:
            # v58.13.64a — DEFAULTS now imported at top level from
            # `mobile_modules_data`; no function-local import needed.
            enabled = bool((DEFAULTS.get(role) or {}).get(module_id, False))
        if not enabled:
            raise HTTPException(
                status_code=403,
                detail=f"Module '{module_id}' disabled for your role",
            )
        return user
    return dep
