"""v58.13.132ed — Auto-archive rules per org × module.

Persists an admin-toggleable rule set + a nightly APScheduler job
that applies the rules across the 7 CAPTURE modules.

Collection shape (`org_archive_rules`):
    id, org_id, module, enabled, older_than_days,
    last_run_at (ISO 8601 str | null), last_affected_count (int),
    created_at, updated_at, updated_by

7 modules: pre-starts, site-diary, hazards, incidents, inspections,
risk-assessments, site-visitors. Each row is keyed by
`(org_id, module)`. Defaults on read: `enabled=False,
older_than_days=365`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso

log = logging.getLogger("paneltec.org_archive_rules")

router = APIRouter(prefix="/org/archive-rules", tags=["org-archive-rules"])

MODULES = [
    "pre-starts", "site-diary", "hazards", "incidents",
    "inspections", "risk-assessments", "site-visitors",
]

# Native collection per module (mirrors `.132ec` index migration).
_COLL: dict[str, str] = {
    "pre-starts": "pre_starts",
    "site-diary": "site_diary_entries",
    "hazards": "hazards",
    "incidents": "incidents",
    "inspections": "inspections",
    "risk-assessments": "risk_assessments",
    "site-visitors": "site_visitors",
}

# Mirror categories (5 of 7 union form_submissions).
_MIRROR_CATS: dict[str, list[str]] = {
    "pre-starts": ["pre_start", "plant_pre_start"],
    "site-diary": ["site_diary"],
    "hazards": ["hazard", "near_miss"],
    "incidents": ["incident"],
    "inspections": ["inspection"],
    "risk-assessments": ["risk_assessment"],
    # site-visitors has no form_submissions mirror.
}


class RuleIn(BaseModel):
    enabled: bool
    older_than_days: int = Field(365, ge=1, le=3650)


def _admin(user: dict) -> None:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")


@router.get("")
async def list_rules(user: dict = Depends(get_current_user)):
    _admin(user)
    org_id = user["org_id"]
    rules_by_mod: dict[str, dict] = {}
    async for r in db.org_archive_rules.find({"org_id": org_id}, {"_id": 0}):
        rules_by_mod[r["module"]] = r
    out = []
    for m in MODULES:
        r = rules_by_mod.get(m)
        out.append({
            "module": m,
            "enabled": bool(r and r.get("enabled")),
            "older_than_days": (r or {}).get("older_than_days", 365),
            "last_run_at": (r or {}).get("last_run_at"),
            "last_affected_count": (r or {}).get("last_affected_count"),
        })
    return {"rules": out}


@router.put("/{module}")
async def upsert_rule(module: str, body: RuleIn,
                       user: dict = Depends(get_current_user)):
    _admin(user)
    if module not in MODULES:
        raise HTTPException(status_code=404, detail="Unknown module")
    org_id = user["org_id"]
    now = now_iso()
    await db.org_archive_rules.update_one(
        {"org_id": org_id, "module": module},
        {"$set": {
            "enabled": body.enabled,
            "older_than_days": body.older_than_days,
            "updated_at": now,
            "updated_by": user["id"],
        },
         "$setOnInsert": {"id": new_id(), "org_id": org_id, "module": module,
                          "created_at": now,
                          "last_run_at": None, "last_affected_count": 0}},
        upsert=True,
    )
    return {"ok": True, "module": module, "enabled": body.enabled,
            "older_than_days": body.older_than_days}


async def apply_org_archive_rules() -> dict:
    """APScheduler entrypoint. Iterates every enabled rule and
    archives matching un-archived rows. Idempotent — a re-run in the
    same day finds already-archived rows and no-ops."""
    total_affected = 0
    per_module: dict[str, int] = {}
    now = datetime.now(timezone.utc)
    async for rule in db.org_archive_rules.find({"enabled": True}):
        org_id = rule["org_id"]
        module = rule["module"]
        days = int(rule.get("older_than_days") or 365)
        cutoff = (now - timedelta(days=days)).isoformat()
        coll = _COLL.get(module)
        if not coll:
            continue
        batch_id = new_id()
        reason = f"auto: older than {days} days"
        touched = 0
        # Native collection.
        q = {"org_id": org_id, "archived_at": None,
             "created_at": {"$lt": cutoff}}
        res = await db[coll].update_many(q, {"$set": {
            "archived_at": now.isoformat(), "archived_by": "system",
            "archived_reason": reason, "archive_batch_id": batch_id,
        }})
        touched += res.modified_count
        # Mirrored form_submissions slice (when applicable).
        cats = _MIRROR_CATS.get(module)
        if cats:
            mq = {"org_id": org_id, "archived_at": None,
                  "template_category_snapshot": {"$in": cats},
                  "submitted_at": {"$lt": cutoff}}
            res2 = await db.form_submissions.update_many(mq, {"$set": {
                "archived_at": now.isoformat(), "archived_by": "system",
                "archived_reason": reason, "archive_batch_id": batch_id,
            }})
            touched += res2.modified_count
        if touched > 0:
            await db.archive_audit.insert_one({
                "id": new_id(), "module": module,
                "actor_user_id": "system",
                "action": "auto_archive", "batch_id": batch_id,
                "criteria": {"older_than_days": days, "cutoff": cutoff},
                "affected_count": touched, "reason": reason,
                "timestamp": now.isoformat(),
            })
        await db.org_archive_rules.update_one(
            {"id": rule["id"]},
            {"$set": {"last_run_at": now.isoformat(),
                      "last_affected_count": touched}},
        )
        per_module[f"{org_id}:{module}"] = touched
        total_affected += touched
    log.info("apply_org_archive_rules: affected=%d per_module=%s",
             total_affected, per_module)
    return {"total_affected": total_affected, "per_module": per_module}
