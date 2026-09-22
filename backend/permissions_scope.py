"""v160.3.9.28 — Record-level scoping helper.

Public API:
    scope_filter(user, resource) -> dict
        Returns a Mongo-filter fragment to AND into a list query so that
        non-privileged callers only see the rows they own (or that belong
        to their contractor org, once that role is activated).

        Returns `{}` for privileged callers so the caller can safely
        do `q.update(scope_filter(...))`.

    can_access_record(user, resource, record) -> bool
        Same semantics, one record at a time. For fetch-by-id → PATCH /
        DELETE routes.

    require_scoped_access(user, resource, record) -> None
        Raises HTTPException(403, "Permission denied: <resource>.scope")
        if `can_access_record` returns False.

Resource keys currently WIRED in production:
  * workers          — general_user sees own row (user_id or email); privileged sees all
  * contractors      — privileged sees all; contractor_rep would see own org (dormant)
  * documents        — general_user sees own uploads (created_by); privileged sees all
  * notifications    — general_user sees own outbound (created_by) OR inbound (to)

Resource keys RESERVED but not wired (v3b design intent — see
`/app/memory/permissions_redesign/08_phase3b_notes.md`):
  * hr              — admin-only per v3.18; a future /hr-employees/me
                      endpoint would relax without wiring this helper.
  * certifications  — cross-resource join through workers.user_id already
                      enforced by worker_certifications._require_worker;
                      the stronger local check is retained instead of
                      the generic helper here.

Design invariants:
  * Idempotent — pure function of (user, resource[, record]).
  * Side-effect-free — no DB reads.
  * Fail-closed for `contractor_rep` when `company_id` is missing —
    returns `_UNSATISFIABLE` (a filter that matches no rows) so no
    accidental privilege escalation.
  * `role_id` wins over legacy `role` string when both are present.
    v25/v26/v27 users may only have `role`; v26+ users will have both.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException


# A filter fragment that matches no documents — used to fail-closed
# on contractor_rep users who don't yet have a company_id linkage.
_UNSATISFIABLE: Dict[str, Any] = {"__scope_no_match__": True}


PRIVILEGED_LEGACY_ROLES = {"admin", "hseq_lead", "supervisor", "manager"}
PRIVILEGED_ROLE_IDS = {
    "admin", "hseq_manager", "hseq_manager_readonly",
    "hseq_manager_creator", "responsible_manager",
    "report_emailing_admin",  # read-only but privileged for visibility
}
CONTRACTOR_ROLE_IDS = {"contractor_rep", "contractor_rep_submit_only"}


def _is_privileged(user: dict) -> bool:
    if not user:
        return False
    rid = (user.get("role_id") or "").strip()
    if rid in PRIVILEGED_ROLE_IDS:
        return True
    legacy = (user.get("role") or "").strip().lower()
    return legacy in PRIVILEGED_LEGACY_ROLES


def _is_contractor_rep(user: dict) -> bool:
    """v160.3.9.28 — the two contractor roles are seeded with
    is_active=False in Phase 2. This branch is reachable ONLY when
    Phase 3d flips them on and an admin assigns the role_id.
    Deliberately never triggers on legacy `role` string alone."""
    return (user or {}).get("role_id") in CONTRACTOR_ROLE_IDS


def _company_id(user: dict) -> Optional[str]:
    # Prefer explicit `company_id` on the user doc; fall back to legacy
    # `contractor_id` if present. If neither is set, contractor_rep
    # must fail-closed rather than silently degrade to full org read.
    return (user or {}).get("company_id") or (user or {}).get("contractor_id")


def scope_filter(user: dict, resource: str) -> Dict[str, Any]:
    """Return a Mongo filter fragment. Empty dict = no narrowing."""
    if _is_privileged(user):
        return {}

    if _is_contractor_rep(user):
        cid = _company_id(user)
        if not cid:
            return _UNSATISFIABLE
        if resource == "contractors":
            # Contractor sees their own contractor record only.
            return {"id": cid}
        if resource in ("workers", "hr_employees", "certifications", "documents"):
            return {"company_id": cid}
        # Any other resource — no narrowing (their role tokens
        # already gate what they can call).
        return {}

    # From here down: general_user / worker / auditor (non-privileged,
    # non-contractor).
    uid = (user or {}).get("id")
    email = ((user or {}).get("email") or "").lower()

    if resource == "workers":
        # Preserve existing workers.py inline behaviour:
        # match by user_id link OR email fallback (Simpro-linked
        # workers may not carry user_id).
        clauses: list[dict] = []
        if uid:
            clauses.append({"user_id": uid})
        if email:
            clauses.append({"email": email})
        if not clauses:
            return _UNSATISFIABLE
        return {"$or": clauses} if len(clauses) > 1 else clauses[0]

    if resource == "documents":
        # General user sees uploads they created OR that are assigned
        # to them.
        if not uid:
            return _UNSATISFIABLE
        return {"$or": [{"created_by": uid}, {"assignee_id": uid}]}

    if resource == "notifications":
        # Preserve existing email_outbox behaviour: own outbound
        # (created_by) OR inbound (email in `to`).
        clauses = []
        if uid:
            clauses.append({"created_by": uid})
        if email:
            clauses.append({"to": email})
        if not clauses:
            return _UNSATISFIABLE
        return {"$or": clauses} if len(clauses) > 1 else clauses[0]

    if resource == "contractors":
        # Non-contractor_rep non-privileged users see the org-wide
        # register (matches pre-v28 behaviour — no narrowing).
        return {}

    if resource == "hr_employees":
        # v160.3.9.48 — HR register is admin-only via
        # `require_permission("hr_employees", ...)`. Non-privileged
        # non-contractor users MUST NOT read any PII, so this branch
        # fails-closed. Kept parallel to the fail-closed contractor_rep
        # branch above.
        return _UNSATISFIABLE

    if resource == "certifications":
        # Reserved. Wire lives in worker_certifications via
        # worker.user_id cross-resource check.
        return _UNSATISFIABLE

    # Unknown resource — safest default is no narrowing (the caller's
    # own require_permission gate is the primary defence).
    return {}


def can_access_record(user: dict, resource: str, record: Optional[dict]) -> bool:
    if not record:
        return False
    if _is_privileged(user):
        return True

    if _is_contractor_rep(user):
        cid = _company_id(user)
        if not cid:
            return False
        if resource == "contractors":
            return record.get("id") == cid
        if resource in ("workers", "hr_employees", "certifications", "documents"):
            return record.get("company_id") == cid
        return True   # generic — role tokens are the gate

    uid = (user or {}).get("id")
    email = ((user or {}).get("email") or "").lower()

    if resource == "workers":
        return (
            (uid and record.get("user_id") == uid)
            or (email and (record.get("email") or "").lower() == email)
        )
    if resource == "documents":
        return record.get("created_by") == uid or record.get("assignee_id") == uid
    if resource == "notifications":
        return record.get("created_by") == uid or (
            email and email in (record.get("to") or [])
        )
    if resource == "contractors":
        return True
    if resource in ("hr_employees", "certifications"):
        # Reserved — fail closed for non-privileged.
        return False
    return True


def require_scoped_access(user: dict, resource: str, record: Optional[dict]) -> None:
    """Raises 403 if `can_access_record` returns False. Named for
    parity with `require_permission` — both throw the same shape."""
    if not can_access_record(user, resource, record):
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: {resource}.scope",
        )


# ─────────────────────────────────────────────────────────────
# v58.13.132kn — SWMS visibility filter (async — reads worker links).
# ─────────────────────────────────────────────────────────────
#
# Why an async helper (not a `scope_filter("swms")` branch):
#   The canonical `scope_filter` is a pure sync function. Deciding
#   which SWMS a worker can see requires reading the worker's
#   own assignment records from Mongo (their `assigned_asset_ids`,
#   `assigned_asset_type_ids`, `simpro_company_id`), so it needs
#   async I/O. Making the whole `scope_filter` async would touch
#   every consumer of the sync API; instead we expose a targeted
#   async helper called only from the SWMS list endpoint.
#
# SWMS visibility contract:
#   A worker can see a SWMS when ANY of the following are true:
#     1. `applies_to` is null / missing / empty                   (legacy default → visible)
#     2. `applies_to.roles` contains the worker's role_id or role (case-insensitive)
#     3. `applies_to.worker_ids` contains the worker's user id
#     4. `applies_to.asset_types` intersects the worker's assigned asset-type slugs
#     5. `applies_to.company_ids` contains the worker's simpro_company_id (contractors)
#
# Sites are NOT currently a first-class facet of the SWMS
# assignment matrix (`_clean_applies_to` in `swms_extras.py` omits
# them). If/when site-scoping is added, extend this helper.
#
# Rationale (legal): AU WHS Regulation 39 requires that a worker
# who will perform work covered by a SWMS has access to the SWMS
# before starting the work. The v159.0 team-scoping fix hid every
# admin-created SWMS from every worker — a compliance gap. See
# `memory/v58_13_132kn_swms_applies_to_scope.md` for the audit
# distribution (13/14 of Paneltec Civil SWMS carry legacy null
# applies_to and rely on branch 1 today).


def _lower_norm(x: Any) -> str:
    return str(x or "").strip().lower()


async def swms_visibility_filter(user: dict) -> Dict[str, Any]:
    """Return a Mongo filter fragment restricting a non-privileged
    caller to the SWMS they can lawfully see. Callers MUST AND this
    into the standard `{org_id, deleted_at}` query.

    Privileged callers should short-circuit BEFORE invoking this
    helper (see `crud.py::_list_impl` for the branch). Passing a
    privileged user still returns a valid — but redundant — filter.
    """
    uid = (user or {}).get("id")
    if not uid:
        return _UNSATISFIABLE

    role_id = _lower_norm(user.get("role_id"))
    legacy_role = _lower_norm(user.get("role"))
    # Roles a SWMS might target the worker via — accept BOTH the
    # granular role_id (`worker`, `contractor_rep`) and the legacy
    # role string. Deduplicated + empty-stripped.
    role_candidates = sorted({r for r in {role_id, legacy_role} if r})

    # Best-effort worker enrichment. Read the worker record keyed by
    # `user_id` so we can pull assigned asset types + simpro company.
    # If no linked worker row exists (preview synthetic users, freshly
    # invited users), we still let them through on branches 1 + 2 —
    # the applies_to legacy-null + role match are the majority.
    asset_type_slugs: list[str] = []
    company_id: Optional[str] = None
    try:
        # Local import to avoid a circular at module load (db imports
        # config which may import permissions).
        from db import db  # noqa: WPS433
        w = await db.workers.find_one(
            {"user_id": uid, "deleted_at": None},
            {"_id": 0, "assigned_asset_type_ids": 1,
             "assigned_asset_ids": 1,
             "simpro_company_id": 1, "company_id": 1},
        )
        if w:
            asset_type_slugs = [
                _lower_norm(x)
                for x in (w.get("assigned_asset_type_ids") or [])
                if x
            ]
            company_id = w.get("simpro_company_id") or w.get("company_id")
    except Exception:  # noqa: BLE001 - defensive; visibility must not crash the list
        pass

    branches: list[Dict[str, Any]] = [
        # Branch 1 — legacy / unset applies_to.
        {"applies_to": None},
        {"applies_to": {"$exists": False}},
        {"applies_to": {}},
        # Branch 3 — worker directly enumerated.
        {"applies_to.worker_ids": uid},
    ]

    # Branch 2 — role match. Mongo doesn't offer a case-insensitive
    # array `$in` cheaply, so we send BOTH raw + lowercased tokens.
    # Callers who normalise on write (`_clean_applies_to` stringifies
    # only) will land here.
    if role_candidates:
        raw_role_set = {r for r in {user.get("role_id"), user.get("role")} if r}
        combined = sorted({*role_candidates, *raw_role_set})
        branches.append({"applies_to.roles": {"$in": combined}})

    # Branch 4 — asset-type intersection.
    if asset_type_slugs:
        branches.append({"applies_to.asset_types": {"$in": asset_type_slugs}})

    # Branch 5 — contractor company match.
    if company_id:
        branches.append({"applies_to.company_ids": company_id})

    return {"$or": branches}
