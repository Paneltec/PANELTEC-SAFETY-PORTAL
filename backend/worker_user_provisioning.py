"""v58.13.132hs — Auto-provision workers → users.

When a worker is created (via Simpro sync or import), we want to
seed a corresponding `users` row in `status="invited"` state WITHOUT
sending any email. An admin then decides when to click "Send invite"
per user, or "Send pending invites" in bulk.

Design decisions (locked with Stephen on the .132hs plan):

  · Default role for auto-provisioned worker users: `viewer` (read
    only). Admins can upgrade later via the drawer.
  · NO email sent on worker create. `auth_invite.py::send_invite`
    (POST /users/{id}/invite) is the manual send trigger.
  · Email conflict (a `users` row with the same email already exists
    in the org): DO NOT auto-link. Flag `worker.user_link_status =
    "email_conflict"` and stash the existing user's id in
    `worker.user_conflict_user_id` for the admin to review + manually
    link via POST /workers/{worker_id}/link-user.
  · Missing email: `worker.user_link_status = "no_email"`. No user
    created. Worker profile shows a hint.
  · Workspace assignment: inherit from `worker.workspace_id` if
    present, else empty. Workers currently don't carry a
    `workspace_id` field (Simpro sync doesn't populate one) so most
    provisioned users start with `workspace_ids=[]` — the same
    convention Simpro-imported users have used since v160.3.1.
  · Idempotency: re-running the backfill is safe — only touches
    workers where `user_link_status` is missing / None (or explicitly
    `no_email` if a fresh email has since been added).

This module exposes pure service functions; routes live in
`worker_user_provisioning_routes.py`. Keeping the two split lets
`integrations_simpro_workers.py::refresh_workers` call the service
directly without pulling in a router-shaped dependency.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from auth import hash_password
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.worker_user_provisioning")

# The provisioning statuses we write to `workers.user_link_status`.
# Keep this list as the canonical set — any FE badge/filter should
# map from these keys.
STATUS_INVITED_PENDING_SEND = "invited_pending_send"  # user created, no email yet
STATUS_INVITE_SENT          = "invite_sent"           # admin has clicked send
STATUS_LINKED               = "linked"                # user activated OR admin manually linked
STATUS_EMAIL_CONFLICT       = "email_conflict"        # another user owns this email
STATUS_NO_EMAIL             = "no_email"              # worker has no email address

# The reason strings we return in service responses.
REASON_NO_EMAIL       = "worker has no email address"
REASON_EMAIL_CONFLICT = "another user already owns this email"
REASON_ALREADY_LINKED = "worker already linked to a user"


def _worker_email(worker: dict) -> Optional[str]:
    e = (worker.get("email") or "").strip().lower()
    return e or None


def _worker_full_name(worker: dict) -> str:
    parts = [worker.get("first_name"), worker.get("last_name")]
    joined = " ".join(str(p or "").strip() for p in parts if p)
    joined = " ".join(joined.split())
    return joined or (worker.get("email") or "worker")


async def _audit(actor: dict, action: str, **extra):
    await db.audit_logs.insert_one({
        "org_id":     actor.get("org_id"),
        "actor_id":   actor.get("id"),
        "actor_name": actor.get("name") or actor.get("email"),
        "action":     action,
        "at":         now_iso(),
        **extra,
    })


async def provision_user_for_worker(worker: dict, actor: dict) -> dict:
    """Provision a `status=invited` user for a worker.

    Never sends email. Idempotent — a worker that already has
    `user_id` set is left alone. Sets `worker.user_link_status`
    according to outcome.

    Returns a dict shaped:
        {"status": <STATUS_*>, "user_id": Optional[str],
         "reason": Optional[str]}
    """
    worker_id = worker.get("id")
    org_id = worker.get("org_id") or actor.get("org_id")
    if not worker_id or not org_id:
        # Defensive: refuse to write into an unknown scope.
        raise ValueError("provision_user_for_worker: worker.id + org_id required")

    # Already linked? Leave it alone. Refresh the status label
    # to `linked` in case an older ship wrote a stale one.
    if worker.get("user_id"):
        await db.workers.update_one(
            {"id": worker_id, "org_id": org_id},
            {"$set": {"user_link_status": STATUS_LINKED, "updated_at": now_iso()}},
        )
        return {"status": STATUS_LINKED, "user_id": worker["user_id"],
                "reason": REASON_ALREADY_LINKED}

    email = _worker_email(worker)
    if not email:
        await db.workers.update_one(
            {"id": worker_id, "org_id": org_id},
            {"$set": {"user_link_status": STATUS_NO_EMAIL,
                      "user_link_updated_at": now_iso(),
                      "updated_at": now_iso()}},
        )
        return {"status": STATUS_NO_EMAIL, "user_id": None, "reason": REASON_NO_EMAIL}

    # Same-org email match. v58.13.132hu — Refined the conflict
    # policy after Stephen's real-world data hit 63/70 workers
    # falsely flagged as `email_conflict`. The vast majority were
    # workers whose corresponding user rows already existed
    # (Simpro's legacy user path, admin-created accounts, pre-.132hs
    # onboarding) — the user IS the correct target, we just hadn't
    # attached the two-way link yet.
    #
    # New rules:
    #   * User with matching email + no `worker_id` set →
    #     auto-link (attach `user.worker_id = worker.id` +
    #     `worker.user_id = user.id`, status=linked).
    #   * User with matching email + `worker_id == worker.id` →
    #     idempotent no-op (status=linked).
    #   * User with matching email + `worker_id` pointing at a
    #     DIFFERENT worker → the only true `email_conflict` case;
    #     flag for admin review.
    existing = await db.users.find_one(
        {"org_id": org_id, "email": email},
        {"_id": 0, "id": 1, "status": 1, "email": 1, "worker_id": 1,
         "name": 1, "role": 1},
    )
    if existing:
        existing_wid = existing.get("worker_id")
        if existing_wid and existing_wid != worker_id:
            # Truly ambiguous — an admin has to decide.
            await db.workers.update_one(
                {"id": worker_id, "org_id": org_id},
                {"$set": {
                    "user_link_status":       STATUS_EMAIL_CONFLICT,
                    "user_conflict_user_id":  existing["id"],
                    "user_link_updated_at":   now_iso(),
                    "updated_at":             now_iso(),
                }},
            )
            await _audit(actor, "worker.user_provision_conflict",
                         worker_id=worker_id, email=email,
                         existing_user_id=existing["id"],
                         existing_worker_id=existing_wid)
            return {"status": STATUS_EMAIL_CONFLICT,
                    "user_id": existing["id"],
                    "reason": REASON_EMAIL_CONFLICT}

        # Auto-link path — user exists, worker exists, they share
        # an email inside the same org, and the user isn't already
        # tied to a different worker. Attach both sides.
        await db.workers.update_one(
            {"id": worker_id, "org_id": org_id},
            {"$set": {
                "user_id":               existing["id"],
                "user_link_status":      STATUS_LINKED,
                "user_link_updated_at":  now_iso(),
                "user_conflict_user_id": None,
                "updated_at":            now_iso(),
            }},
        )
        # Only touch user.worker_id if it wasn't already set (the
        # `worker_id == worker.id` branch already matched).
        if not existing_wid:
            await db.users.update_one(
                {"id": existing["id"], "org_id": org_id},
                {"$set": {"worker_id": worker_id, "updated_at": now_iso()}},
            )
        await _audit(actor, "worker.user_auto_linked",
                     worker_id=worker_id, user_id=existing["id"],
                     email=email)
        return {"status": STATUS_LINKED, "user_id": existing["id"],
                "reason": None}

    # Happy path: create a `status=invited` user with a throwaway
    # password_hash (unusable until the admin sends an invite and
    # the recipient sets their own). Workspace inheritance: only if
    # the worker carries an explicit `workspace_id` (rare — most
    # workers are Simpro-sourced and workspace-agnostic).
    workspace_ids: list[str] = []
    if worker.get("workspace_id"):
        workspace_ids = [worker["workspace_id"]]

    # v58.13.132hv — Default role derivation. `.132hs` shipped with
    # `role="viewer"` — a slug that was hard-removed from the platform's
    # 4-role catalogue during the .132s cleanup and doesn't exist in
    # `db.roles` any more. The FE role dropdown filtered any user on
    # a non-existent role into a placeholder "Select role" state
    # (Glen — Walker Designs reproduction on 2026-09-17), and RBAC
    # gates silently denied. Derive a real role from the worker's
    # `simpro_company_id`:
    #   · "2"   → `paneltec_civil`     (Paneltec's Simpro tenant)
    #   · "3"   → `viatec_traffic`     (Viatec's Simpro tenant)
    #   · else  → `external_contractor` (subcontractor default)
    _cid = str(worker.get("simpro_company_id") or "")
    if _cid == "2":
        default_role = "paneltec_civil"
    elif _cid == "3":
        default_role = "viatec_traffic"
    else:
        default_role = "external_contractor"

    throwaway_pwd = secrets.token_hex(32)
    user_id = new_id()
    user_doc = {
        "id":              user_id,
        "email":           email,
        "name":            _worker_full_name(worker),
        "role":            default_role,
        "org_id":          org_id,
        "workspace_ids":   workspace_ids,
        "password_hash":   hash_password(throwaway_pwd),
        "status":          "invited",
        "token_version":   0,
        "auth_provider":   "password",
        "worker_id":       worker_id,
        "mobile":          worker.get("mobile") or worker.get("phone"),
        "position":        worker.get("position"),
        "company_id":      worker.get("company_id"),
        "must_set_password": True,
        "provisioned_from": "worker_auto_provision",
        "provisioned_at":  now_iso(),
        "created_at":      now_iso(),
    }
    try:
        await db.users.insert_one(dict(user_doc))
    except Exception as e:
        # A concurrent duplicate insert (same email, same org) can
        # race past the pre-check when two provisioning calls fire
        # for two different workers that share an email. Fall
        # through to a conflict outcome — safer than dropping a row.
        log.warning("worker_user_provision insert failed for worker=%s email=%s: %s",
                    worker_id, email, e)
        raced = await db.users.find_one(
            {"org_id": org_id, "email": email}, {"_id": 0, "id": 1},
        )
        conflict_id = raced.get("id") if raced else None
        await db.workers.update_one(
            {"id": worker_id, "org_id": org_id},
            {"$set": {
                "user_link_status":       STATUS_EMAIL_CONFLICT,
                "user_conflict_user_id":  conflict_id,
                "user_link_updated_at":   now_iso(),
                "updated_at":             now_iso(),
            }},
        )
        return {"status": STATUS_EMAIL_CONFLICT, "user_id": conflict_id,
                "reason": REASON_EMAIL_CONFLICT}

    await db.workers.update_one(
        {"id": worker_id, "org_id": org_id},
        {"$set": {
            "user_id":               user_id,
            "user_link_status":      STATUS_INVITED_PENDING_SEND,
            "user_link_updated_at":  now_iso(),
            "updated_at":            now_iso(),
        }},
    )
    await _audit(actor, "worker.user_provisioned",
                 worker_id=worker_id, user_id=user_id, email=email)
    return {"status": STATUS_INVITED_PENDING_SEND, "user_id": user_id, "reason": None}


async def link_worker_to_existing_user(worker_id: str, user_id: str, actor: dict) -> dict:
    """Admin resolves an `email_conflict`: attach worker → existing user.

    Idempotent — if the worker is already linked to this user, no-op.
    Refuses to clobber a link to a *different* user (returns error dict).
    """
    org_id = actor["org_id"]
    worker = await db.workers.find_one({"id": worker_id, "org_id": org_id}, {"_id": 0})
    if not worker:
        return {"ok": False, "error": "worker_not_found"}
    user = await db.users.find_one({"id": user_id, "org_id": org_id}, {"_id": 0, "id": 1, "email": 1})
    if not user:
        return {"ok": False, "error": "user_not_found"}
    prior = worker.get("user_id")
    if prior and prior != user_id:
        return {"ok": False, "error": "worker_linked_to_different_user",
                "current_user_id": prior}

    await db.workers.update_one(
        {"id": worker_id, "org_id": org_id},
        {"$set": {
            "user_id":               user_id,
            "user_link_status":      STATUS_LINKED,
            "user_link_updated_at":  now_iso(),
            "user_conflict_user_id": None,
            "updated_at":            now_iso(),
        }},
    )
    # Also tag the user with worker_id so the reverse lookup works.
    await db.users.update_one(
        {"id": user_id, "org_id": org_id},
        {"$set": {"worker_id": worker_id, "updated_at": now_iso()}},
    )
    await _audit(actor, "worker.user_manual_link",
                 worker_id=worker_id, user_id=user_id, email=user.get("email"))
    return {"ok": True, "user_id": user_id, "status": STATUS_LINKED}


async def backfill_provisioning(actor: dict) -> dict:
    """Iterate every non-deleted worker in the org, provision users
    for those without a `user_link_status` field (or where it's
    `no_email` and an email has since been added).

    Never sends email. Returns aggregate counts:
        {"scanned":            N,
         "already_linked":     N,
         "invited_pending_send": N,
         "email_conflict":     N,
         "no_email":           N}
    """
    org_id = actor["org_id"]
    counts = {
        "scanned":              0,
        "already_linked":       0,
        "invited_pending_send": 0,
        "email_conflict":       0,
        "no_email":             0,
    }
    q = {"org_id": org_id, "deleted_at": None}
    async for w in db.workers.find(q):
        w.pop("_id", None)
        counts["scanned"] += 1
        result = await provision_user_for_worker(w, actor)
        if result["status"] == STATUS_LINKED:
            counts["already_linked"] += 1
        elif result["status"] == STATUS_INVITED_PENDING_SEND:
            counts["invited_pending_send"] += 1
        elif result["status"] == STATUS_EMAIL_CONFLICT:
            counts["email_conflict"] += 1
        elif result["status"] == STATUS_NO_EMAIL:
            counts["no_email"] += 1
    await _audit(actor, "worker.user_backfill_run", **counts)
    return counts
