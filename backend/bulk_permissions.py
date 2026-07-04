"""v159.3 — Bulk permission restrict endpoint.

Powers the "Restrict access" toolbar action on the Document Library (and
future admin surfaces that need to deny a specific action across many
users in one write). Adds a single `{resource: {action: value}}` override
to each target user's `user_permissions.overrides`, preserving existing
entries so we never accidentally over-write unrelated cells.
"""
from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from permissions import (
    ACTIONS, PERMISSIONS_SCHEMA, effective_for, require_permission,
    upsert_overrides,
)

router = APIRouter(prefix="/permissions", tags=["permissions"])


class BulkRestrictIn(BaseModel):
    user_ids: List[str] = Field(..., min_length=1, max_length=500)
    resource: str
    action: str
    value: bool = False  # v159.3 primary use-case is `deny`
    reason: Optional[str] = None  # free-form audit note


@router.post("/bulk-restrict")
async def bulk_restrict(
    body: BulkRestrictIn,
    actor: dict = Depends(require_permission("users", "edit")),
):
    if body.resource not in PERMISSIONS_SCHEMA:
        raise HTTPException(400, f"Unknown resource: {body.resource}")
    if body.action not in ACTIONS:
        raise HTTPException(400, f"Unknown action: {body.action}")

    # Verify every user id is in the actor's org — bulk writes must never
    # cross org boundaries even if a caller crafts a payload with foreign ids.
    targets = await db.users.find(
        {"id": {"$in": body.user_ids}, "org_id": actor["org_id"]},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "role": 1},
    ).to_list(len(body.user_ids))
    resolved_ids = {u["id"] for u in targets}
    missing = [uid for uid in body.user_ids if uid not in resolved_ids]

    updated = 0
    for target in targets:
        existing = await db.user_permissions.find_one(
            {"user_id": target["id"], "org_id": actor["org_id"]},
            {"_id": 0, "overrides": 1},
        )
        overrides = dict((existing or {}).get("overrides") or {})
        res_over = dict(overrides.get(body.resource) or {})
        res_over[body.action] = bool(body.value)
        overrides[body.resource] = res_over
        await upsert_overrides(
            target["id"], actor["org_id"], overrides, actor["id"],
        )
        updated += 1

    return {
        "ok": True,
        "updated": updated,
        "missing_user_ids": missing,
        "resource": body.resource,
        "action": body.action,
        "value": bool(body.value),
        "reason": body.reason,
        "sample_effective": (
            await effective_for(targets[0]) if targets else None
        ),
    }
