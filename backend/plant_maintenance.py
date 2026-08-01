"""v160.3.9.20 — Plant Maintenance router."""
from __future__ import annotations
import logging, uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from db import db
from auth import get_current_user

log = logging.getLogger("paneltec.plant_maintenance")
router = APIRouter(prefix="/plant-maintenance", tags=["plant-maintenance"])
_ADMIN = {"admin", "hseq_lead"}


def _now(): return datetime.now(timezone.utc).isoformat()


def _admin(user):
    if (user or {}).get("role") not in _ADMIN:
        raise HTTPException(403, "admin-required")


async def ensure_indexes():
    try:
        await db.plant_maintenance.create_index("maintenance_id", unique=True)
        await db.plant_maintenance.create_index("plant_id")
        await db.plant_maintenance.create_index("registration_matched")
        await db.plant_maintenance.create_index("date_completed")
        await db.plant_maintenance_audit.create_index("maintenance_id")
    except Exception as e:
        log.warning("plant_maintenance index setup: %s", e)


@router.get("/")
async def list_rows(
    q: Optional[str] = None,
    plant_id: Optional[str] = None,
    maintenance_type: Optional[str] = None,
    company: Optional[str] = None,
    completed_after: Optional[str] = None,
    completed_before: Optional[str] = None,
    limit: int = 1000,
    offset: int = 0,
    _user: dict = Depends(get_current_user),
):
    query: dict = {"deleted_at": None}
    if plant_id == "unmatched":
        query["plant_id"] = None
    elif plant_id:
        query["plant_id"] = plant_id
    if maintenance_type: query["maintenance_type"] = maintenance_type
    if company: query["company"] = company
    if completed_after or completed_before:
        rng: dict = {}
        if completed_after: rng["$gte"] = completed_after
        if completed_before: rng["$lte"] = completed_before
        query["date_completed"] = rng
    if q:
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"maintenance_id":         {"$regex": pat, "$options": "i"}},
            {"description":            {"$regex": pat, "$options": "i"}},
            {"registration_no":        {"$regex": pat, "$options": "i"}},
            {"registration_matched":   {"$regex": pat, "$options": "i"}},
            {"notes":                  {"$regex": pat, "$options": "i"}},
            {"performed_by":           {"$regex": pat, "$options": "i"}},
            {"company":                {"$regex": pat, "$options": "i"}},
        ]
    total = await db.plant_maintenance.count_documents(query)
    cursor = db.plant_maintenance.find(query, {"_id": 0}).skip(offset).limit(min(limit, 2000))
    items = [r async for r in cursor]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/unmatched")
async def unmatched_summary(_user: dict = Depends(get_current_user)):
    """Group unmatched maintenance rows by registration_matched."""
    pipeline = [
        {"$match": {"plant_id": None, "deleted_at": None}},
        {"$group": {
            "_id": "$registration_matched",
            "count": {"$sum": 1},
            "sample_description": {"$first": "$description"},
            "sample_asset_code": {"$first": "$asset_code"},
            "last_date_completed": {"$max": "$date_completed"},
        }},
        {"$sort": {"count": -1}},
    ]
    groups = []
    async for g in db.plant_maintenance.aggregate(pipeline):
        groups.append({
            "registration_matched": g["_id"],
            "count": g["count"],
            "sample_description": g.get("sample_description"),
            "sample_asset_code": g.get("sample_asset_code"),
            "last_date_completed": g.get("last_date_completed"),
        })
    total = await db.plant_maintenance.count_documents(
        {"plant_id": None, "deleted_at": None})
    return {"total_unmatched_rows": total,
            "distinct_regos": len(groups), "groups": groups}


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
async def patch_row(uid: str, patch: RowPatch, user: dict = Depends(get_current_user)):
    _admin(user)
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
async def delete_row(uid: str, user: dict = Depends(get_current_user)):
    _admin(user); now = _now()
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
    user: dict = Depends(get_current_user),
):
    _admin(user)
    if bool(file) == bool(url):
        raise HTTPException(400, "supply-exactly-one-of-file-or-url")
    from pathlib import Path as _P
    dest = (_P(__file__).resolve().parent / "scripts" / "data"
            / "plant_maintenance_source.xlsx")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if file:
        content = await file.read(); dest.write_bytes(content); size = len(content)
    else:
        import httpx as _h
        async with _h.AsyncClient(follow_redirects=True, timeout=60.0) as c:
            r = await c.get(url); r.raise_for_status()
            dest.write_bytes(r.content); size = len(r.content)
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
