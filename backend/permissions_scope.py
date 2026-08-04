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
