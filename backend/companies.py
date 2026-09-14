"""v160.3.9.19 — Companies reference-library router."""
from __future__ import annotations
import logging, uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from db import db
from auth import get_current_user
from permissions import require_permission  # v160.3.9.27 — guard migration

log = logging.getLogger("paneltec.companies")
router = APIRouter(prefix="/companies", tags=["companies"])
_ADMIN = {"admin"}
BOOKKEEPING = {"_id", "id", "content_hash", "created_at", "updated_at",
               "imported_at", "imported_by", "deleted_at", "deleted_by"}


def _now(): return datetime.now(timezone.utc).isoformat()


def _admin(user):
    if (user or {}).get("role") not in _ADMIN:
        raise HTTPException(403, "admin-required")


async def ensure_indexes():
    try:
        await db.companies.create_index("company_id", unique=True)
        await db.companies.create_index("state")
        await db.companies.create_index("account_type")
        await db.companies_audit.create_index("company_id")
    except Exception as e:
        log.warning("companies index setup: %s", e)


@router.get("/columns")
async def columns_metadata(_user: dict = Depends(get_current_user)):
    populated: set[str] = set()
    async for doc in db.companies.find({"deleted_at": None}, projection={"_id": 0}):
        for k, v in doc.items():
            if k in BOOKKEEPING: continue
            # `archived` is a bool that is always populated (defaults to
            # False); include it always so the frontend can render it.
            if k == "archived" or v not in (None, "", []):
                populated.add(k)
    return {"populated": sorted(populated), "total": len(populated)}


@router.get("/")
async def list_rows(
    q: Optional[str] = None,
    category: Optional[str] = None,
    state: Optional[str] = None,
    archived: Optional[bool] = None,
    account_type: Optional[str] = None,
    classification: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    _user: dict = Depends(get_current_user),
):
    query: dict = {"deleted_at": None}
    if category: query["company_category"] = category
    if state:    query["state"] = state
    if archived is not None: query["archived"] = archived
    if account_type: query["account_type"] = account_type
    if classification: query["company_classification"] = classification
    if q:
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"company_id":   {"$regex": pat, "$options": "i"}},
            {"company":      {"$regex": pat, "$options": "i"}},
            {"general_email": {"$regex": pat, "$options": "i"}},
            {"phone":        {"$regex": pat, "$options": "i"}},
            {"suburb":       {"$regex": pat, "$options": "i"}},
        ]
    total = await db.companies.count_documents(query)
    cursor = db.companies.find(query, {"_id": 0}).skip(offset).limit(min(limit, 1000))
    items = [r async for r in cursor]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{uid}")
async def get_row(uid: str, _user: dict = Depends(get_current_user)):
    doc = await db.companies.find_one(
        {"$or": [{"id": uid}, {"company_id": uid}], "deleted_at": None},
        {"_id": 0})
    if not doc: raise HTTPException(404, "not-found")
    return doc


class RowPatch(BaseModel):
    class Config: extra = "allow"


@router.post("/")
async def create_row(body: RowPatch, user: dict = Depends(require_permission("reference_library", "edit"))):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_admin(user)` removed.
    # Outer `Depends(require_permission("reference_library", ...))` on the
    # route signature is the sole authoritative guard now.
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items()
            if k not in BOOKKEEPING}
    company_id = str(data.get("company_id") or "").strip()
    if not company_id:
        raise HTTPException(400, "company_id-required")
    data["company_id"] = company_id
    if await db.companies.find_one({"company_id": company_id}):
        raise HTTPException(409, "company_id-already-exists")
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        **data,
        "created_at": now, "updated_at": now,
        "imported_by": user["id"], "imported_at": now,
        "deleted_at": None,
    }
    await db.companies.insert_one(doc)
    await db.companies_audit.insert_one({
        "id": str(uuid.uuid4()), "company_id": company_id,
        "action": "manual-insert", "at": now, "actor_id": user["id"],
    })
    doc.pop("_id", None)
    return doc


@router.patch("/{uid}")
async def patch_row(uid: str, patch: RowPatch, user: dict = Depends(require_permission("reference_library", "edit"))):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_admin(user)` removed.
    # Outer `Depends(require_permission("reference_library", ...))` on the
    # route signature is the sole authoritative guard now.
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if k not in BOOKKEEPING}
    if not updates: raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now()
    r = await db.companies.find_one_and_update(
        {"$or": [{"id": uid}, {"company_id": uid}], "deleted_at": None},
        {"$set": updates}, projection={"_id": 0}, return_document=True)
    if not r: raise HTTPException(404, "not-found")
    await db.companies_audit.insert_one({
        "id": str(uuid.uuid4()), "company_id": r["company_id"],
        "action": "manual-update", "at": updates["updated_at"],
        "actor_id": user["id"], "fields": list(updates.keys()),
    })
    return r


@router.delete("/{uid}")
async def delete_row(uid: str, user: dict = Depends(require_permission("reference_library", "delete"))):
    now = _now()
    r = await db.companies.find_one_and_update(
        {"$or": [{"id": uid}, {"company_id": uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True)
    if not r: raise HTTPException(404, "not-found")
    await db.companies_audit.insert_one({
        "id": str(uuid.uuid4()), "company_id": r["company_id"],
        "action": "soft-delete", "at": now, "actor_id": user["id"],
    })
    return {"deleted": True, "company_id": r["company_id"]}


@router.post("/reimport")
async def reimport(
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(require_permission("reference_library", "edit")),
):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_admin(user)` removed.
    # Outer `Depends(require_permission("reference_library", ...))` on the
    # route signature is the sole authoritative guard now.
    # v58.13.132gj — Route through the shared staging helper.
    # Persists a GridFS audit copy, writes the workbook to a
    # short-lived `NamedTemporaryFile`, unlinks on exit.
    from reimport_staging import staged_reimport_xlsx
    async with staged_reimport_xlsx(
        file=file, url=url, module="companies", user=user,
    ) as (size, dest):
        from scripts.import_companies import (
            parse_workbook, upsert_rows, ensure_indexes as _idx)
        await _idx()
        rows, populated = parse_workbook(dest)
        stats = await upsert_rows(rows, actor_id=user["id"])
    total = await db.companies.count_documents({"deleted_at": None})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "populated_columns": len(populated), "live_total": total, **stats}
