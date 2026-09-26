"""v58.13.132p0 — Admin batch "Issue Job" endpoints, locked to the
7-SMS-fields schema (Phase 1 of the mobile job flow rebuild).

The allocation officer's fast-flow console: one form, N workers, one
batch → N `daily_job_assignments` docs sharing a `job_batch_id`. Each
worker's doc is byte-identical (same seven SMS fields), differing
only in `id`, `worker_*`, and `is_trial_mirror`.

Endpoints (all under `/api/`):
  POST /daily-jobs/bulk-create              batch create (new schema)
  GET  /daily-jobs/today                    admin view of ALL rows for date
  GET  /daily-jobs/admin/trucks             assets kind ∈ {vehicle,plant}
  GET  /daily-jobs/admin/sites              from db.sites
  GET  /daily-jobs/admin/workers            picker feed

Auth: strict admin role only.

`.132p0` changes:
  · Input model dropped `truck_id/truck_name/truck_reg/task/site_id/
    site_freeform/customer/notes/staff_names` shape in favour of the
    seven SMS fields (single `truck` string, `staff[]`).
  · Delegates doc assembly to `mobile_daily_jobs.build_assignment_doc`
    so single-create + bulk-create produce byte-identical shapes.
  · `staff[]` snapshot is now sourced from the SMS payload itself
    (Stephen types it into the form), NOT synthesised from
    `worker_ids`. This matches the spec — the SMS staff list is the
    canonical crew roster.
  · Purged fields: `task`, `supervisor_*`, `truck_name`, `truck_reg`,
    `is_past_date_fallback`.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from db import db
from auth import get_current_user

from mobile_daily_jobs import (
    STATUS_ISSUED, TERMINAL_STATUSES,
    DailyJobCreateIn, _geocode_address, _match_site, _resolve_worker,
    build_assignment_doc,
)
from sms_parser import coerce_date, today_iso_sydney

log = logging.getLogger("paneltec.daily_jobs.batch")

router = APIRouter(tags=["daily-jobs-batch"])

SYDNEY_TZ = ZoneInfo("Australia/Sydney")


def _require_admin(user: dict) -> None:
    if (user.get("role") or "").lower() != "admin":
        raise HTTPException(403, "Admin role required")


TARGET_ROLE_IDS = ["paneltec_civil", "viatec_traffic", "external_contractor"]


# ─────────────── Models ───────────────

class BulkCreateIn(BaseModel):
    """v58.13.132p0 — Locked to the seven SMS fields + `worker_ids[]`.

    Unknown keys are IGNORED (Pydantic `extra="ignore"`). The web
    form's legacy `task`/`supervisor_*`/`truck_name`/`truck_reg`
    payload survives the wire (no 422), but nothing survives past
    this boundary.
    """
    model_config = ConfigDict(extra="ignore")

    # Locked SMS-shape fields (single-truck string, staff array).
    truck: Optional[str] = None
    date: Optional[str] = None          # YYYY-MM-DD; defaults to today (Sydney)
    site_name: Optional[str] = None
    address: Optional[str] = None
    customer: Optional[str] = None
    staff: List[str] = Field(default_factory=list)
    notes: Optional[str] = None
    # Worker set.
    worker_ids: List[str] = Field(..., min_length=1, max_length=50)
    override: bool = False
    # v58.13.132n7a-carryover — "also send a copy to my phone" for
    # the admin previewing what the crew will see.
    trial_run: bool = False


# ─────────────── POST /daily-jobs/bulk-create ───────────────

@router.post("/daily-jobs/bulk-create", status_code=201)
async def bulk_create_daily_jobs(
    body: BulkCreateIn,
    user: dict = Depends(get_current_user),
) -> dict:
    _require_admin(user)

    org_id = user["org_id"]
    the_date = coerce_date(body.date) or today_iso_sydney()

    # Geo enrichment (best-effort, one call for the whole batch).
    geocode = await _geocode_address(body.address or body.site_name or "")
    site_id = await _match_site(
        org_id=org_id,
        site_name=body.site_name,
        address=body.address,
    )

    # Trial-run: append the admin's own user_id if requested (they
    # get a mirror doc so they can preview on their phone).
    iteration_ids = list(body.worker_ids)
    trial_worker_id: Optional[str] = None
    if body.trial_run:
        trial_worker_id = user["id"]
        if trial_worker_id and trial_worker_id not in iteration_ids:
            iteration_ids.append(trial_worker_id)

    # Existing-row lookup (single query for the whole batch).
    existing_by_worker: dict = {}
    async for d in db.daily_job_assignments.find(
        {"org_id": org_id, "worker_id": {"$in": iteration_ids},
         "date": the_date},
        {"_id": 0, "id": 1, "worker_id": 1},
    ):
        existing_by_worker[d["worker_id"]] = d["id"]

    job_batch_id = str(uuid.uuid4())
    created: List[dict] = []
    replaced: List[dict] = []
    conflicts: List[dict] = []
    not_found: List[str] = []

    for wid in iteration_ids:
        worker = await _resolve_worker(
            org_id=org_id, worker_id=wid, worker_email=None,
        )
        if not worker:
            not_found.append(wid)
            continue

        prev = existing_by_worker.get(wid)
        if prev and not body.override:
            conflicts.append({"worker_id": wid, "existing_assignment_id": prev})
            continue
        if prev and body.override:
            await db.daily_job_assignments.delete_one({"id": prev})
            replaced.append({"worker_id": wid, "previous_assignment_id": prev})

        payload = DailyJobCreateIn(
            worker_id=wid,
            truck=body.truck,
            date=the_date,
            site_name=body.site_name,
            address=body.address,
            customer=body.customer,
            staff=list(body.staff or []),
            notes=body.notes,
            override=False,
        )
        is_trial_mirror = (wid == trial_worker_id)
        doc = build_assignment_doc(
            org_id=org_id,
            worker=worker,
            payload=payload,
            the_date=the_date,
            geocode=geocode,
            site_id=site_id,
            assigned_by_id=user.get("id"),
            job_batch_id=job_batch_id,
            meta={"source": "issue_job_form",
                  "is_trial_mirror": is_trial_mirror},
        )
        await db.daily_job_assignments.insert_one(doc)
        created.append({
            "worker_id": wid,
            "assignment_id": doc["id"],
            "worker_name": worker["name"],
            "is_trial_mirror": is_trial_mirror,
        })

    return {
        "job_batch_id": job_batch_id,
        "date": the_date,
        "created": created,
        "replaced": replaced,
        "conflicts": conflicts,
        "not_found": not_found,
    }


# ─────────────── GET /daily-jobs/today ───────────────

@router.get("/daily-jobs/today")
async def admin_all_today(
    date: Optional[str] = Query(None, description="YYYY-MM-DD; defaults to today (Sydney)"),
    limit: int = Query(200, ge=1, le=1000),
    user: dict = Depends(get_current_user),
) -> dict:
    """Admin listing of ad-hoc job rows for `date`.

    Sort: newest first (issued_at desc). Returns the locked
    `.132p0` doc shape. No task/supervisor/truck-split fields —
    stale docs in the collection may still carry legacy keys until
    the migration script runs, but new inserts NEVER do.
    """
    _require_admin(user)
    the_date = coerce_date(date) or today_iso_sydney()

    cursor = db.daily_job_assignments.find(
        {"org_id": user["org_id"], "date": the_date},
        {"_id": 0},
    ).sort("issued_at", -1).limit(limit)

    rows: List[dict] = []
    async for d in cursor:
        rows.append(d)
    return {"date": the_date, "total": len(rows), "rows": rows}


# ─────────────── GET /daily-jobs/admin/trucks ───────────────

@router.get("/daily-jobs/admin/trucks")
async def admin_list_trucks(
    q: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    user: dict = Depends(get_current_user),
) -> dict:
    """Vehicles + plant from `db.assets` for the truck-picker
    convenience feed. The truck FIELD on the assignment doc is a
    single string (matches SMS shape); the picker is a helper that
    lets the officer NOT type the full name.
    """
    _require_admin(user)

    match: dict = {
        "org_id": user["org_id"],
        "deleted_at": None,
        "kind": {"$in": ["vehicle", "plant"]},
    }
    if q and q.strip():
        needle = q.strip()
        match["$or"] = [
            {"name": {"$regex": needle, "$options": "i"}},
            {"rego": {"$regex": needle, "$options": "i"}},
        ]

    cursor = db.assets.find(
        match,
        {"_id": 0, "id": 1, "name": 1, "kind": 1, "asset_type": 1, "rego": 1},
    ).sort("name", 1).limit(limit)

    rows: List[dict] = []
    async for a in cursor:
        rows.append({
            "id": a.get("id"),
            "name": a.get("name"),
            "kind": a.get("kind"),
            "asset_type": a.get("asset_type"),
            "rego": a.get("rego"),
        })
    return {"rows": rows, "total": len(rows)}


# ─────────────── GET /daily-jobs/admin/sites ───────────────

@router.get("/daily-jobs/admin/sites")
async def admin_list_sites_v2(
    q: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    user: dict = Depends(get_current_user),
) -> dict:
    _require_admin(user)

    match: dict = {"org_id": user["org_id"], "deleted_at": None}
    if q and q.strip():
        needle = q.strip()
        match["$or"] = [
            {"name": {"$regex": needle, "$options": "i"}},
            {"address_full": {"$regex": needle, "$options": "i"}},
            {"suburb": {"$regex": needle, "$options": "i"}},
        ]

    cursor = db.sites.find(
        match,
        {"_id": 0, "id": 1, "name": 1, "address_full": 1,
         "suburb": 1, "state": 1, "latitude": 1, "longitude": 1},
    ).sort("name", 1).limit(limit)

    rows: List[dict] = []
    async for s in cursor:
        rows.append({
            "id": s.get("id"),
            "name": s.get("name"),
            "address_full": s.get("address_full"),
            "suburb": s.get("suburb"),
            "state": s.get("state"),
            "latitude": s.get("latitude"),
            "longitude": s.get("longitude"),
        })
    return {"rows": rows, "total": len(rows)}


# ─────────────── GET /daily-jobs/admin/workers ───────────────

@router.get("/daily-jobs/admin/workers")
async def admin_list_workers_v2(
    q: Optional[str] = None,
    role_id: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    skip: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
) -> dict:
    _require_admin(user)

    allowed = TARGET_ROLE_IDS
    if role_id and role_id in allowed:
        allowed = [role_id]

    match: dict = {"org_id": user["org_id"], "role_id": {"$in": allowed}}
    if q and q.strip():
        needle = q.strip()
        match["$or"] = [
            {"name": {"$regex": needle, "$options": "i"}},
            {"first_name": {"$regex": needle, "$options": "i"}},
            {"last_name": {"$regex": needle, "$options": "i"}},
            {"email": {"$regex": needle, "$options": "i"}},
            {"mobile": {"$regex": needle, "$options": "i"}},
            {"phone": {"$regex": needle, "$options": "i"}},
        ]

    total = await db.users.count_documents(match)
    cursor = db.users.find(
        match,
        {"_id": 0, "id": 1, "name": 1, "first_name": 1, "last_name": 1,
         "email": 1, "mobile": 1, "phone": 1, "role_id": 1},
    ).sort("last_name", 1).skip(skip).limit(limit)

    rows: List[dict] = []
    async for u in cursor:
        first = (u.get("first_name") or "").strip()
        last = (u.get("last_name") or "").strip()
        name = (u.get("name") or f"{first} {last}").strip() or u.get("email") or "(unnamed)"
        rows.append({
            "id": u.get("id"),
            "name": name,
            "first_name": first,
            "last_name": last,
            "email": u.get("email"),
            "phone": u.get("mobile") or u.get("phone"),
            "role_id": u.get("role_id"),
        })
    return {"rows": rows, "total": total, "limit": limit, "skip": skip,
            "target_role_ids": TARGET_ROLE_IDS}
