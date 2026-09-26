"""v58.13.132n7 — Admin batch daily-job assignment ("Issue Job").

The allocation officer's fast-flow console: one form, N workers,
one batch assignment. Complements the existing per-worker PDF flow
in `mobile_daily_jobs.py`. Same target collection
(`daily_job_assignments`), same doc shape as `.132cf` + new fields.

Endpoints (all under `/api/`):
  POST /daily-jobs/bulk-create              batch create N assignments
  GET  /daily-jobs/today                    admin view of ALL rows for date
  GET  /daily-jobs/admin/trucks             assets kind ∈ {vehicle,plant}
  GET  /daily-jobs/admin/sites              from db.sites (not simpro_jobs)

Auth: strict admin role only (matches `_require_admin` in
`mobile_daily_jobs.py`).

Timezone: Australia/Sydney (matches `_today_iso()` in the sibling
module) — carries dual date fields (`date_local` / `date_utc`).

Doc shape adds (on top of `.132cf` baseline):
  · job_batch_id       str   — links siblings in one Send action
  · truck_id           str
  · truck_name         str
  · task               str   — short task line ("Trench excavation…")
  · supervisor_id      str
  · supervisor_name    str
  · supervisor_phone   str
  · customer           str
  · site_freeform      str   — free-text site when not in Sites list
  · issued_at          iso   — same as assigned_at for now, kept as
                                 an explicit alias the mobile UI reads

Sibling module (`.132cf`) already reads/writes the baseline fields;
this module's new fields are additive and don't break its endpoints.
The mobile phone tile ships (`.132n5m2`) already renders task /
supervisor / issued_at IF present, so no mobile edits needed.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import db
from auth import get_current_user
from models import now_iso

log = logging.getLogger("paneltec.daily_jobs.batch")

router = APIRouter(tags=["daily-jobs-batch"])

SYDNEY_TZ = ZoneInfo("Australia/Sydney")

# Same role gate as mobile_daily_jobs.py (`.132cf`).
def _require_admin(user: dict) -> None:
    if (user.get("role") or "").lower() != "admin":
        raise HTTPException(403, "Admin role required")


def _today_iso() -> str:
    return datetime.now(SYDNEY_TZ).strftime("%Y-%m-%d")


def _now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


# Reuse the sibling module's target role list so the picker is
# consistent across "Ad-hoc Jobs" and "Issue Job".
TARGET_ROLE_IDS = ["paneltec_civil", "viatec_traffic", "external_contractor"]


# ─────────────── Models ───────────────

class BulkCreateIn(BaseModel):
    date: Optional[str] = None                # YYYY-MM-DD; defaults to today (Sydney)
    truck_id: Optional[str] = None
    truck_name: Optional[str] = None          # snapshot for offline UX
    truck_reg: Optional[str] = None           # v58.13.132n7a — SMS "Truck: … - REG" shape
    site_id: Optional[str] = None             # from db.sites, or null when free-text
    site_freeform: Optional[str] = None       # user-typed site name
    address: Optional[str] = None
    customer: Optional[str] = None
    task: Optional[str] = None
    notes: Optional[str] = None
    worker_ids: List[str] = Field(..., min_length=1, max_length=50)
    override: bool = False                    # replace any existing for same (worker,date)
    trial_run: bool = False                   # v58.13.132n7a — also seed a mirror doc
                                              # for the calling admin (for the "send a
                                              # copy to my own phone" checkbox).
    # v58.13.132n7a — Paneltec has no supervisors. Any legacy fields
    # (`supervisor_id`, `supervisor_name`, `supervisor_phone`) sent
    # by an older FE are silently dropped by Pydantic's default
    # `extra="ignore"`. Nothing to enforce.


# ─────────────── POST /daily-jobs/bulk-create ───────────────

@router.post("/daily-jobs/bulk-create", status_code=201)
async def bulk_create_daily_jobs(
    body: BulkCreateIn,
    user: dict = Depends(get_current_user),
) -> dict:
    """Create N `daily_job_assignments` docs — one per worker_id in
    `body.worker_ids` — sharing a single `job_batch_id`.

    Response:
        {
          "job_batch_id": "…",
          "date": "2026-09-26",
          "created": [{worker_id, assignment_id, worker_name}, …],
          "replaced": [{worker_id, previous_assignment_id}, …],
          "conflicts": [{worker_id, existing_assignment_id}, …],
          "not_found": ["<bad_id>", …]
        }

    Conflict handling:
      · If a worker already has an assignment for `date` and
        `body.override=false`, they land in `conflicts` and NO doc
        is created for them.
      · If `override=true`, the previous row is soft-superseded
        (deleted; matches the sibling `.132ab` override behaviour).

    Batching is best-effort — a single bad worker id doesn't blow up
    the whole batch. Response's four buckets tell the FE exactly
    what shipped.
    """
    _require_admin(user)

    the_date = (body.date or _today_iso()).strip()
    org_id = user["org_id"]

    # Site resolution — pull address/name/coords from db.sites if
    # site_id present, otherwise use whatever the form supplied.
    site_snapshot: dict = {}
    if body.site_id:
        site = await db.sites.find_one(
            {"id": body.site_id, "org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1, "name": 1, "address_full": 1,
             "suburb": 1, "state": 1, "latitude": 1, "longitude": 1},
        )
        if not site:
            raise HTTPException(404, f"Site {body.site_id} not found in your org")
        site_snapshot = {
            "site_id": site["id"],
            "site_name": site.get("name"),
            "site_address": body.address or site.get("address_full") or "",
            "site_coords": (
                {"lat": site["latitude"], "lng": site["longitude"]}
                if site.get("latitude") is not None and site.get("longitude") is not None
                else None
            ),
        }
    else:
        # Free-text site path.
        if not (body.site_freeform or "").strip():
            raise HTTPException(400, "Provide either site_id or site_freeform")
        site_snapshot = {
            "site_id": None,
            "site_name": body.site_freeform.strip(),
            "site_address": (body.address or "").strip(),
            "site_coords": None,
        }

    # Truck snapshot — optional; snapshot the name AND rego so the
    # mobile tile can render "Cappellotto 2 - Volvo · XT48AK" offline.
    # v58.13.132n7a — added `truck_reg` per SMS shape.
    truck_snapshot: dict = {"truck_id": None, "truck_name": None, "truck_reg": None}
    if body.truck_id:
        truck = await db.assets.find_one(
            {"id": body.truck_id, "org_id": org_id, "deleted_at": None,
             "kind": {"$in": ["vehicle", "plant"]}},
            {"_id": 0, "id": 1, "name": 1, "kind": 1, "rego": 1},
        )
        if not truck:
            raise HTTPException(404, f"Truck {body.truck_id} not found in your org")
        truck_snapshot = {
            "truck_id": truck["id"],
            "truck_name": body.truck_name or truck.get("name"),
            "truck_reg": body.truck_reg or truck.get("rego"),
        }

    # v58.13.132n7a — supervisor removed. Paneltec has no supervisors,
    # so we don't resolve one, don't snapshot one, don't write one.
    # (Doc-shape stays uniform without the supervisor_* keys.)

    # Assigner snapshot (matches `.132cf`).
    assigner_name = (
        user.get("name")
        or f"{(user.get('first_name') or '').strip()} {(user.get('last_name') or '').strip()}".strip()
        or user.get("email")
        or "(unknown admin)"
    )

    # Look up all worker candidates in ONE query so we don't fan
    # out N lookups for the common 3-8 workers case.
    workers_by_id: dict = {}
    async for u in db.users.find(
        {"id": {"$in": body.worker_ids}, "org_id": org_id},
        {"_id": 0, "id": 1, "name": 1, "first_name": 1, "last_name": 1,
         "email": 1, "mobile": 1, "phone": 1, "role_id": 1},
    ):
        first = (u.get("first_name") or "").strip()
        last = (u.get("last_name") or "").strip()
        full = (u.get("name") or f"{first} {last}").strip() or (u.get("email") or "(unnamed)")
        workers_by_id[u["id"]] = {
            "id": u["id"], "name": full,
            "phone": u.get("mobile") or u.get("phone"),
            "role_id": u.get("role_id"),
            "email": u.get("email"),
            "kind": "user",
        }
    # Fallback to workers collection for any IDs missing from users.
    remaining = [wid for wid in body.worker_ids if wid not in workers_by_id]
    if remaining:
        async for w in db.workers.find(
            {"id": {"$in": remaining}, "org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1,
             "email": 1, "mobile": 1, "phone": 1},
        ):
            first = (w.get("first_name") or "").strip()
            last = (w.get("last_name") or "").strip()
            full = f"{first} {last}".strip() or "(unnamed)"
            workers_by_id[w["id"]] = {
                "id": w["id"], "name": full,
                "phone": w.get("mobile") or w.get("phone"),
                "role_id": None,
                "email": w.get("email"),
                "kind": "worker",
            }

    not_found = [wid for wid in body.worker_ids if wid not in workers_by_id]

    # v58.13.132n7a — trial_run: append the calling admin's own user
    # id to the batch so a mirror doc lands on their phone. The
    # existing resolve chain (`db.users` first) will find them by id.
    # `trial_worker_id` is tracked separately so we can guarantee
    # they always appear in the batch (even if the admin's id was
    # already in `body.worker_ids`, that's fine — the doc will just
    # be built once).
    trial_worker_id: Optional[str] = None
    if body.trial_run:
        trial_worker_id = user["id"]
        if trial_worker_id not in workers_by_id:
            # Admin isn't in one of the target roles, so `admin_list_workers`
            # never surfaced them — resolve directly.
            admin_row = await db.users.find_one(
                {"id": trial_worker_id, "org_id": org_id},
                {"_id": 0, "id": 1, "name": 1, "first_name": 1, "last_name": 1,
                 "email": 1, "mobile": 1, "phone": 1, "role_id": 1},
            )
            if admin_row:
                first = (admin_row.get("first_name") or "").strip()
                last = (admin_row.get("last_name") or "").strip()
                full = (admin_row.get("name") or f"{first} {last}").strip() \
                    or (admin_row.get("email") or "(admin trial)")
                workers_by_id[trial_worker_id] = {
                    "id": trial_worker_id, "name": full,
                    "phone": admin_row.get("mobile") or admin_row.get("phone"),
                    "role_id": admin_row.get("role_id"),
                    "email": admin_row.get("email"),
                    "kind": "user",
                }

    # v58.13.132n7a — the SMS shows a "Staff on this job: DANIEL BUTLER,
    # JARROD TARGETT, JASON DONNELLAN" line. Snapshot the full crew
    # roster on every child doc so the mobile detail screen can
    # render "Your work mates" without a second lookup. Sorted
    # alphabetically for stable display; excludes the trial-run
    # admin because they're not part of the real crew.
    real_worker_ids = [wid for wid in body.worker_ids
                       if wid != trial_worker_id and wid in workers_by_id]
    staff_names = sorted(
        [workers_by_id[wid]["name"] for wid in real_worker_ids]
    )

    # Look up existing assignments for the same (worker,date) in
    # ONE query.
    existing_by_worker: dict = {}
    async for d in db.daily_job_assignments.find(
        {"org_id": org_id, "worker_id": {"$in": list(workers_by_id.keys())},
         "date": the_date},
        {"_id": 0, "id": 1, "worker_id": 1},
    ):
        existing_by_worker[d["worker_id"]] = d["id"]

    job_batch_id = str(uuid.uuid4())
    issued_at = _now_iso_utc()
    created: List[dict] = []
    replaced: List[dict] = []
    conflicts: List[dict] = []

    # v58.13.132n7a — iteration order: real workers first, trial
    # admin last (so they always appear at the tail of the batch's
    # `created` list; keeps the officer's "Job issued to N workers"
    # toast honest about the crew size).
    iteration_ids = list(body.worker_ids)
    if trial_worker_id and trial_worker_id not in iteration_ids:
        iteration_ids.append(trial_worker_id)

    for wid in iteration_ids:
        w = workers_by_id.get(wid)
        if not w:
            continue   # already in not_found

        prev = existing_by_worker.get(wid)
        if prev and not body.override:
            conflicts.append({"worker_id": wid, "existing_assignment_id": prev})
            continue
        if prev and body.override:
            await db.daily_job_assignments.delete_one({"id": prev})
            replaced.append({"worker_id": wid, "previous_assignment_id": prev})

        assignment_id = str(uuid.uuid4())
        is_trial_mirror = (wid == trial_worker_id)
        doc = {
            "id": assignment_id,
            "org_id": org_id,
            # Worker snapshot (matches .132cf).
            "worker_id": wid,
            "worker_name": w["name"],
            "worker_phone": w.get("phone"),
            "worker_role_id": w.get("role_id"),
            "worker_kind": w.get("kind"),
            # Site snapshot (may be all null on free-text path).
            "site_id": site_snapshot.get("site_id"),
            "site_name": site_snapshot.get("site_name"),
            "site_address": site_snapshot.get("site_address"),
            "site_coords": site_snapshot.get("site_coords"),
            "site_freeform": body.site_freeform,
            # Customer.
            "customer": (body.customer or "").strip() or None,
            # Dual date fields (.132cf audit trail).
            "date": the_date,
            "date_local": the_date,
            "date_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            # Assigner snapshot.
            "assigned_by": user["id"],
            "assigned_by_id": user["id"],
            "assigned_by_name": assigner_name,
            "assigned_at": issued_at,
            # v58.13.132n7 additions — mobile Ship 1 reads these.
            "issued_at": issued_at,
            "task": (body.task or "").strip() or None,
            # v58.13.132n7a — Paneltec has no supervisors; keys removed.
            "truck_id": truck_snapshot["truck_id"],
            "truck_name": truck_snapshot["truck_name"],
            # v58.13.132n7a — SMS-shape parity fields.
            "truck_reg": truck_snapshot["truck_reg"],
            "staff_names": staff_names,
            "is_trial_mirror": is_trial_mirror,
            # Batch grouping.
            "job_batch_id": job_batch_id,
            # SMS stub — unused for `.132n7` (no SMS), preserved for
            # schema compatibility with the sibling module.
            "sms_sent_at": None,
            "sms_message_id": None,
            "sms_provider": None,
            # Lifecycle.
            "accepted_at": None,
            "declined_at": None,
            "completed_at": None,
            "status": "pending",
            "notes": (body.notes or "").strip() or None,
            "preamble": None,   # not used for batch flow
            "pdf_id": None,
            "pdf_url": None,
            "meta": {
                "source": "issue_job_form",
                "trial_mirror": is_trial_mirror,
            },
        }
        await db.daily_job_assignments.insert_one(doc)
        created.append({
            "worker_id": wid,
            "assignment_id": assignment_id,
            "worker_name": w["name"],
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
    """Return ALL `daily_job_assignments` docs for `date`, sorted by
    assigned_at descending, snapshot-fields projected out.

    Admin view — mirrors what the allocation officer needs to see on
    the left panel of the Issue Job form."""
    _require_admin(user)
    the_date = (date or _today_iso()).strip()

    cursor = db.daily_job_assignments.find(
        {"org_id": user["org_id"], "date": the_date},
        {"_id": 0},
    ).sort("assigned_at", -1).limit(limit)

    rows: List[dict] = []
    async for d in cursor:
        rows.append(d)

    return {
        "date": the_date,
        "total": len(rows),
        "rows": rows,
    }


# ─────────────── GET /daily-jobs/admin/trucks ───────────────

@router.get("/daily-jobs/admin/trucks")
async def admin_list_trucks(
    q: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    user: dict = Depends(get_current_user),
) -> dict:
    """Vehicles + plant from `db.assets`. Filter to non-deleted,
    org-scoped rows. Optional case-insensitive substring match on
    `name` or `rego`."""
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
    """v58.13.132n7 — sites source is `db.sites` (not
    `db.simpro_jobs` like the sibling module). `db.sites` is the
    admin-managed workspace list — carries address, coords and
    simpro_customer link for the address auto-populate flow on the
    Issue Job form.

    Rows: `{id, name, address_full, suburb, state, latitude,
    longitude}`. All null-safe."""
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
# Alias of `/mobile/daily-jobs/admin/workers` so the FE can stay
# under the `/daily-jobs/*` prefix without cross-module URLs.

@router.get("/daily-jobs/admin/workers")
async def admin_list_workers_v2(
    q: Optional[str] = None,
    role_id: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    skip: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
) -> dict:
    """Same rows/shape as `/mobile/daily-jobs/admin/workers`
    (users filtered to the target role_ids). Duplicated here so the
    Issue Job form's picker URLs all live under `/daily-jobs/*` for
    consistency."""
    _require_admin(user)

    allowed = TARGET_ROLE_IDS
    if role_id and role_id in allowed:
        allowed = [role_id]

    match: dict = {
        "org_id": user["org_id"],
        "role_id": {"$in": allowed},
    }
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
