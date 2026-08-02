"""v160.3.9.18 — My Completed Training reference-library router."""
from __future__ import annotations
import hashlib, json, logging, uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from db import db
from auth import get_current_user
from permissions import require_permission  # v160.3.9.27 — guard migration

log = logging.getLogger("paneltec.completed_training")
router = APIRouter(prefix="/completed-training", tags=["completed-training"])
_ADMIN = {"admin"}
BOOKKEEPING = {"_id", "id", "content_hash", "created_at", "updated_at",
               "imported_at", "imported_by", "deleted_at", "deleted_by"}


def _now(): return datetime.now(timezone.utc).isoformat()


def _admin(user):
    if (user or {}).get("role") not in _ADMIN:
        raise HTTPException(403, "admin-required")


async def ensure_indexes():
    try:
        await db.completed_training.create_index("content_hash", unique=True)
        await db.completed_training.create_index("expiry_date")
        await db.completed_training.create_index("business_unit")
        await db.completed_training.create_index("issuer")
    except Exception as e:
        log.warning("completed_training index setup: %s", e)


@router.get("/columns")
async def columns_metadata(_user: dict = Depends(get_current_user)):
    populated: set[str] = set()
    async for doc in db.completed_training.find(
            {"deleted_at": None}, projection={"_id": 0}):
        for k, v in doc.items():
            if k in BOOKKEEPING: continue
            if v not in (None, "", []):
                populated.add(k)
    return {"populated": sorted(populated), "total": len(populated)}


@router.get("/")
async def list_rows(
    q: Optional[str] = None,
    business_unit: Optional[str] = None,
    issuer: Optional[str] = None,
    expiry_before: Optional[str] = None,
    expiry_after: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    _user: dict = Depends(get_current_user),
):
    query: dict = {"deleted_at": None}
    if business_unit: query["business_unit"] = business_unit
    if issuer: query["issuer"] = issuer
    if expiry_before or expiry_after:
        rng: dict = {}
        if expiry_before: rng["$lte"] = expiry_before
        if expiry_after:  rng["$gte"] = expiry_after
        query["expiry_date"] = rng
    if q:
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"competency":  {"$regex": pat, "$options": "i"}},
            {"description": {"$regex": pat, "$options": "i"}},
            {"notes":       {"$regex": pat, "$options": "i"}},
            {"created_by":  {"$regex": pat, "$options": "i"}},
            {"issuer":      {"$regex": pat, "$options": "i"}},
        ]
    total = await db.completed_training.count_documents(query)
    cursor = db.completed_training.find(query, {"_id": 0}).skip(offset).limit(min(limit, 1000))
    items = [r async for r in cursor]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{uid}")
async def get_row(uid: str, _user: dict = Depends(get_current_user)):
    doc = await db.completed_training.find_one(
        {"id": uid, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "not-found")
    return doc


class RowPatch(BaseModel):
    class Config: extra = "allow"


@router.post("/")
async def create_row(body: RowPatch, user: dict = Depends(require_permission("reference_library", "edit"))):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_admin(user)` removed.
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items()
            if k not in BOOKKEEPING}
    # Completed-training rows key on `content_hash` (deterministic from
    # payload contents so re-imports are idempotent). Synthesise one for
    # manual inserts so the unique index enforces "no duplicate manual
    # entries for the same worker+course+date".
    if not data:
        raise HTTPException(400, "payload-required")
    content_hash = hashlib.sha256(json.dumps(
        {k: data.get(k) for k in sorted(data.keys())},
        sort_keys=True, default=str).encode()).hexdigest()
    if await db.completed_training.find_one({"content_hash": content_hash}):
        raise HTTPException(409, "identical-record-already-exists")
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        **data,
        "content_hash": content_hash,
        "created_at": now, "updated_at": now,
        "imported_by": user["id"], "imported_at": now,
        "deleted_at": None,
    }
    await db.completed_training.insert_one(doc)
    await db.completed_training_audit.insert_one({
        "id": str(uuid.uuid4()), "content_hash": content_hash,
        "action": "manual-insert", "at": now, "actor_id": user["id"],
    })
    doc.pop("_id", None)
    return doc


@router.patch("/{uid}")
async def patch_row(uid: str, patch: RowPatch,
                    user: dict = Depends(require_permission("reference_library", "edit"))):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_admin(user)` removed.
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if k not in BOOKKEEPING}
    if not updates:
        raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now()
    r = await db.completed_training.find_one_and_update(
        {"id": uid, "deleted_at": None},
        {"$set": updates}, projection={"_id": 0}, return_document=True)
    if not r: raise HTTPException(404, "not-found")
    await db.completed_training_audit.insert_one({
        "id": str(uuid.uuid4()),
        "target_id": uid, "action": "manual-update",
        "at": updates["updated_at"], "actor_id": user["id"],
        "fields": list(updates.keys()),
    })
    return r


@router.delete("/{uid}")
async def delete_row(uid: str, user: dict = Depends(require_permission("reference_library", "delete"))):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_admin(user)` removed.
    now = _now()
    r = await db.completed_training.find_one_and_update(
        {"id": uid, "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True)
    if not r: raise HTTPException(404, "not-found")
    await db.completed_training_audit.insert_one({
        "id": str(uuid.uuid4()), "target_id": uid, "action": "soft-delete",
        "at": now, "actor_id": user["id"],
    })
    return {"deleted": True, "id": uid}


@router.post("/reimport")
async def reimport(
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(require_permission("reference_library", "edit")),
):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_admin(user)` removed.
    if bool(file) == bool(url):
        raise HTTPException(400, "supply-exactly-one-of-file-or-url")
    from pathlib import Path as _P
    dest = (_P(__file__).resolve().parent / "scripts" / "data"
            / "completed_training_source.xlsx")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if file:
        content = await file.read(); dest.write_bytes(content); size = len(content)
    else:
        import httpx as _h
        async with _h.AsyncClient(follow_redirects=True, timeout=60.0) as c:
            r = await c.get(url); r.raise_for_status()
            dest.write_bytes(r.content); size = len(r.content)
    from scripts.import_completed_training import (
        parse_workbook, upsert_rows, ensure_indexes as _idx)
    await _idx()
    rows, populated = parse_workbook(dest)
    stats = await upsert_rows(rows, actor_id=user["id"])
    total = await db.completed_training.count_documents({"deleted_at": None})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "populated_columns": len(populated),
            "live_total": total, **stats}
