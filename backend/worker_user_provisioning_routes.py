"""v58.13.132hs — Routes for worker → user provisioning.

Endpoints (all admin-only via `users.edit` permission gate to
match `users.py` conventions):

  · POST /workers/{worker_id}/provision-user
        Provision a single worker's user row (idempotent). Replaces
        the deprecated Workers.jsx "Create login" call which was
        hitting the 410 `POST /users` route.
  · POST /workers/{worker_id}/link-user       (body: {user_id})
        Manually link a worker to an existing user (resolves an
        `email_conflict` state).
  · POST /workers/backfill-user-provision
        Bulk backfill: provision users for every worker in the org
        that has no `user_link_status`.

All endpoints defer to `worker_user_provisioning.py` service
functions. Audit log entries are written by the service layer.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from permissions import require_permission
from worker_user_provisioning import (
    STATUS_LINKED,
    STATUS_INVITED_PENDING_SEND,
    STATUS_EMAIL_CONFLICT,
    STATUS_NO_EMAIL,
    backfill_provisioning,
    link_worker_to_existing_user,
    provision_user_for_worker,
)

log = logging.getLogger("paneltec.worker_user_provisioning.routes")
router = APIRouter(tags=["worker-user-provisioning"])


class LinkUserIn(BaseModel):
    user_id: str


@router.post("/workers/{worker_id}/provision-user")
async def provision_single(
    worker_id: str,
    actor: dict = Depends(require_permission("users", "edit")),
):
    worker = await db.workers.find_one(
        {"id": worker_id, "org_id": actor["org_id"]}, {"_id": 0},
    )
    if not worker:
        raise HTTPException(404, "worker not found")
    result = await provision_user_for_worker(worker, actor)
    # Bubble the current linked user's email out too so the FE can
    # render a clean toast without a second round-trip.
    email = None
    if result.get("user_id"):
        u = await db.users.find_one(
            {"id": result["user_id"], "org_id": actor["org_id"]},
            {"_id": 0, "email": 1},
        )
        email = (u or {}).get("email")
    return {**result, "email": email}


@router.post("/workers/{worker_id}/link-user")
async def link_existing(
    worker_id: str,
    body: LinkUserIn,
    actor: dict = Depends(require_permission("users", "edit")),
):
    result = await link_worker_to_existing_user(worker_id, body.user_id, actor)
    if not result.get("ok"):
        raise HTTPException(400, result.get("error") or "link failed")
    return result


@router.post("/workers/backfill-user-provision")
async def backfill(
    actor: dict = Depends(require_permission("users", "edit")),
):
    counts = await backfill_provisioning(actor)
    return counts


# ── Mirror-status summary ───────────────────────────────────────────

@router.get("/worker-user-mirror-status")
async def mirror_status(
    actor: dict = Depends(require_permission("users", "edit")),
):
    """v58.13.132hu — Compact summary powering the Settings > Users
    "mirror status" toolbar pill.

    Returns:
        {
          "workers_total":    <undeleted worker count in the org>,
          "linked":           <linked or already_linked>,
          "invited_pending":  <status = invited_pending_send>,
          "invite_sent":      <status = invite_sent>,
          "email_conflict":   <ambiguous — needs admin resolve>,
          "no_email":         <worker has no email, provision skipped>,
          "unset":            <status field missing — needs backfill>,
        }
    """
    from db import db as _db
    org_id = actor["org_id"]
    q = {"org_id": org_id,
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]}
    workers_total = await _db.workers.count_documents(q)
    counts = {
        "linked":          0,
        "invited_pending": 0,
        "invite_sent":     0,
        "email_conflict":  0,
        "no_email":        0,
        "unset":           0,
    }
    async for w in _db.workers.find(q, {"_id": 0, "user_link_status": 1}):
        s = (w or {}).get("user_link_status")
        if s == "linked":
            counts["linked"] += 1
        elif s == "invited_pending_send":
            counts["invited_pending"] += 1
        elif s == "invite_sent":
            counts["invite_sent"] += 1
        elif s == "email_conflict":
            counts["email_conflict"] += 1
        elif s == "no_email":
            counts["no_email"] += 1
        else:
            counts["unset"] += 1
    return {"workers_total": workers_total, **counts}
