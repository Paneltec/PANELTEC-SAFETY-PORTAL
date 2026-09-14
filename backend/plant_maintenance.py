"""v160.3.9.20 — Plant Maintenance router."""
from __future__ import annotations
import logging, uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from db import db
from auth import get_current_user
from permissions import require_permission

log = logging.getLogger("paneltec.plant_maintenance")
router = APIRouter(prefix="/plant-maintenance", tags=["plant-maintenance"])


def _now(): return datetime.now(timezone.utc).isoformat()


async def ensure_indexes():
    try:
        await db.plant_maintenance.create_index("maintenance_id", unique=True)
        await db.plant_maintenance.create_index("plant_id")
        await db.plant_maintenance.create_index("registration_matched")
        await db.plant_maintenance.create_index("date_completed")
        await db.plant_maintenance_audit.create_index("maintenance_id")
    except Exception as e:
        log.warning("plant_maintenance index setup: %s", e)


# v58.13.120e — Retired four dead endpoints:
#   · GET  /plant-maintenance/orphan-count
#   · GET  /plant-maintenance/           (list)
#   · GET  /plant-maintenance/unmatched
#   · GET  /plant-maintenance/grouped
# All were driven by the pre-.120 PlantMaintenanceTab UI, which
# is deleted this ship. Kept endpoints ({uid} GET/PATCH/DELETE
# + /reimport POST) are used by the Fleet & Service Register.

@router.get("/{uid}")
async def get_row(uid: str, _user: dict = Depends(get_current_user)):
    doc = await db.plant_maintenance.find_one(
        {"$or": [{"id": uid}, {"maintenance_id": uid}], "deleted_at": None},
        {"_id": 0})
    if not doc: raise HTTPException(404, "not-found")
    return doc


class RowPatch(BaseModel):
    class Config: extra = "allow"


@router.patch("/{uid}")
async def patch_row(uid: str, patch: RowPatch, user: dict = Depends(require_permission("assets", "edit"))):
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if k not in {"_id", "id", "content_hash"}}
    if not updates: raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now()
    r = await db.plant_maintenance.find_one_and_update(
        {"$or": [{"id": uid}, {"maintenance_id": uid}], "deleted_at": None},
        {"$set": updates}, projection={"_id": 0}, return_document=True)
    if not r: raise HTTPException(404, "not-found")
    await db.plant_maintenance_audit.insert_one({
        "id": str(uuid.uuid4()), "maintenance_id": r["maintenance_id"],
        "action": "manual-update", "at": updates["updated_at"],
        "actor_id": user["id"], "fields": list(updates.keys()),
    })
    return r


@router.delete("/{uid}")
async def delete_row(uid: str, user: dict = Depends(require_permission("assets", "delete"))):
    now = _now()
    r = await db.plant_maintenance.find_one_and_update(
        {"$or": [{"id": uid}, {"maintenance_id": uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True)
    if not r: raise HTTPException(404, "not-found")
    return {"deleted": True, "maintenance_id": r["maintenance_id"]}


@router.post("/reimport")
async def reimport(
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(require_permission("assets", "edit")),
):
    # v58.13.132gj — Route through shared staging helper.
    from reimport_staging import staged_reimport_xlsx
    async with staged_reimport_xlsx(
        file=file, url=url, module="plant_maintenance", user=user,
    ) as (size, dest):
        from scripts.import_plant_maintenance import (
            parse_workbook, upsert_rows, ensure_indexes as _idx, _load_rego_index)
        await _idx()
        rows = parse_workbook(dest)
        rego_idx = await _load_rego_index()
        stats = await upsert_rows(rows, actor_id=user["id"], rego_idx=rego_idx)
    total = await db.plant_maintenance.count_documents({"deleted_at": None})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "live_total": total, **stats}


# Compat endpoint: fetch all maintenance for a given plant.
plant_scoped_router = APIRouter(prefix="/plant", tags=["plant-maintenance"])


@plant_scoped_router.get("/{plant_id}/maintenance")
async def maintenance_for_plant(plant_id: str,
                                _user: dict = Depends(get_current_user)):
    cursor = db.plant_maintenance.find(
        {"plant_id": plant_id, "deleted_at": None},
        {"_id": 0}).sort("date_completed", -1)
    items = [r async for r in cursor]
    return {"items": items, "total": len(items)}
