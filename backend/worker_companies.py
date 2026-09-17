"""v58.13.132hq — Editable worker-company dropdown + CRUD.

The Workers register originally derived `company_label` from
`simpro_company_id` (2 → Paneltec, 3 → Viatec, else Simpro / Manual).
That mapping was fine when Paneltec + Viatec were the only two, but
Stephen added Walker Designs as a third worker company and the
FE toolbar filter needed to support N companies without a code
change.

This ship mirrors the `.132gv` induction_types pattern:

* `worker_companies` collection, one row per admin-managed company
  (name only — no descriptor / logo).
* CRUD sub-router at `/api/workers/companies` — admin-only writes,
  soft-delete + snapshot semantics.
* Auto-seeds `Paneltec`, `Viatec`, `Walker Designs` on first-list
  per org.
* Workers carry a `worker_company_id` FK + `worker_company_name`
  snapshot (renames don't cascade — matches the induction_types +
  equipment_categories pattern). See `workers.py::_serialise`.
* Backfill on startup: any worker without `worker_company_id` gets
  the org's Paneltec company (default assumption per Q2 default —
  admin bulk-reassign is a manual follow-up).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db

log = logging.getLogger("paneltec.worker_companies")

router = APIRouter(prefix="/worker-companies", tags=["worker-companies"])

# Seed the three companies Stephen currently uses. Admin can rename
# or soft-delete via CRUD; adds are unlimited. Order matches
# `.132hq` batch spec Q6 (Paneltec first as default fallback).
DEFAULT_WORKER_COMPANIES = ["Paneltec", "Viatec", "Walker Designs"]


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") != "admin":
        raise HTTPException(403, "Admin only")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class WorkerCompanyIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class WorkerCompanyPatch(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


def _shape(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def _ensure_indexes():
    await db.worker_companies.create_index(
        [("org_id", 1), ("deleted_at", 1), ("name", 1)])
    await db.worker_companies.create_index("id", unique=True)


async def _seed_defaults(org_id: str, actor_id: str) -> None:
    """Idempotently seed the three legacy company names for a fresh
    org so the toolbar filter never renders empty."""
    existing = await db.worker_companies.count_documents(
        {"org_id": org_id, "deleted_at": None})
    if existing:
        return
    now = _now()
    docs = [
        {
            "id": str(uuid.uuid4()),
            "org_id": org_id,
            "name": name,
            "created_by": actor_id,
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
            "seeded": True,
        }
        for name in DEFAULT_WORKER_COMPANIES
    ]
    await db.worker_companies.insert_many(docs)


async def get_default_company_for_org(org_id: str) -> Optional[dict]:
    """Return the row that should be used as the default assignment
    for workers created without an explicit company. Uses "Paneltec"
    (case-insensitive) if present, else the first seeded row, else
    the first non-deleted row. Callable from other modules (worker
    create hook, backfill migration)."""
    row = await db.worker_companies.find_one(
        {"org_id": org_id, "deleted_at": None,
         "name": {"$regex": "^paneltec$", "$options": "i"}},
        {"_id": 0},
    )
    if row:
        return row
    row = await db.worker_companies.find_one(
        {"org_id": org_id, "deleted_at": None, "seeded": True},
        {"_id": 0}, sort=[("created_at", 1)],
    )
    if row:
        return row
    row = await db.worker_companies.find_one(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0}, sort=[("created_at", 1)],
    )
    return row


async def backfill_worker_company_ids_on_startup() -> None:
    """v58.13.132hq — Idempotent seed-then-backfill.
    Ensures every org that has workers ALSO has the default
    worker_companies rows (bootstrap chicken-and-egg — the seed on
    first `GET /worker-companies` doesn't help until an admin
    calls it). Then walks workers with no `worker_company_id` and
    stamps the default. Legacy Simpro-sourced workers with
    `simpro_company_id` in {"2","3"} get mapped to Paneltec/Viatec
    respectively so the backfill respects existing meaning.
    """
    await _ensure_indexes()
    # Seed EVERY org that has at least one worker (fresh tenants
    # get their dropdown ready). Idempotent per org.
    worker_org_ids: list[str] = await db.workers.distinct("org_id")
    for org_id in worker_org_ids:
        try:
            await _seed_defaults(org_id, actor_id="system-backfill")
        except Exception as e:  # noqa: BLE001
            log.warning("seed defaults failed for org=%s: %s", org_id, e)
    # Now run the actual backfill.
    org_ids: list[str] = await db.worker_companies.distinct("org_id")
    for org_id in org_ids:
        # Build a name→row lookup for THIS org.
        by_name: dict[str, dict] = {}
        async for row in db.worker_companies.find(
            {"org_id": org_id, "deleted_at": None}, {"_id": 0},
        ):
            by_name[row["name"].lower()] = row
        default_row = by_name.get("paneltec") or next(iter(by_name.values()), None)
        if not default_row:
            continue
        # Walk workers with no worker_company_id.
        cursor = db.workers.find(
            {"org_id": org_id, "deleted_at": None,
             "$or": [
                 {"worker_company_id": None},
                 {"worker_company_id": {"$exists": False}},
             ]},
            {"_id": 0, "id": 1, "simpro_company_id": 1},
        )
        n_updates = 0
        async for w in cursor:
            sid = str(w.get("simpro_company_id") or "").strip()
            if sid == "3" and "viatec" in by_name:
                target = by_name["viatec"]
            else:
                target = default_row
            await db.workers.update_one(
                {"id": w["id"], "org_id": org_id},
                {"$set": {
                    "worker_company_id": target["id"],
                    "worker_company_name": target["name"],
                }},
            )
            n_updates += 1
        if n_updates:
            log.info("worker_companies backfill: org=%s updated=%d",
                     org_id, n_updates)


@router.get("")
async def list_companies(user: dict = Depends(get_current_user)):
    """Any authenticated user can read the list (workers toolbar
    filter chips render for everyone). Writes remain admin-only."""
    await _ensure_indexes()
    await _seed_defaults(user["org_id"], user["id"])
    items: list[dict] = []
    async for row in db.worker_companies.find(
        {"org_id": user["org_id"], "deleted_at": None},
    ).sort([("name", 1)]):
        items.append(_shape(row))
    return {"items": items, "total": len(items)}


@router.post("", status_code=201)
async def create_company(body: WorkerCompanyIn,
                          user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _ensure_indexes()
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    dupe = await db.worker_companies.find_one({
        "org_id": user["org_id"], "deleted_at": None, "name": name,
    })
    if dupe:
        raise HTTPException(409, "Worker company already exists")
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "org_id": user["org_id"],
        "name": name,
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
        "seeded": False,
    }
    await db.worker_companies.insert_one(doc.copy())
    return _shape(doc)


@router.patch("/{cid}")
async def rename_company(cid: str, body: WorkerCompanyPatch,
                          user: dict = Depends(get_current_user)):
    _require_admin(user)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    dupe = await db.worker_companies.find_one({
        "org_id": user["org_id"], "deleted_at": None, "name": name,
        "id": {"$ne": cid},
    })
    if dupe:
        raise HTTPException(409, "Worker company already exists")
    now = _now()
    r = await db.worker_companies.update_one(
        {"id": cid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"name": name, "updated_at": now,
                    "updated_by": user["id"]}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Worker company not found")
    # Snapshot semantics: existing workers keep their old
    # `worker_company_name` string. Admin can bulk-reassign via
    # PATCH /workers/{id} if they want the new name to appear.
    doc = await db.worker_companies.find_one({"id": cid})
    return _shape(doc)


@router.delete("/{cid}", status_code=204)
async def delete_company(cid: str,
                          user: dict = Depends(get_current_user)):
    _require_admin(user)
    now = _now()
    r = await db.worker_companies.update_one(
        {"id": cid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Worker company not found")
    # Snapshot semantics — existing workers keep the snapshot name.
    return Response(status_code=204)
