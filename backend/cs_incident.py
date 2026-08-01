"""v160.3.9.16 — CS Incident (Issue List) reference-library router."""
from __future__ import annotations
import logging, uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from db import db
from auth import get_current_user
from permissions import require_permission  # v160.3.9.27 — guard migration

log = logging.getLogger("paneltec.cs_incident")
router = APIRouter(prefix="/cs-incident", tags=["cs-incident"])

_ADMIN = {"admin"}
BOOKKEEPING = {"_id", "id", "created_at", "updated_at", "imported_at",
               "imported_by", "content_hash", "deleted_at", "deleted_by"}


def _now(): return datetime.now(timezone.utc).isoformat()


def _admin(user):
    if (user or {}).get("role") not in _ADMIN:
        raise HTTPException(403, "admin-required")


async def ensure_indexes():
    try:
        await db.cs_incident_issues.create_index("issue_number", unique=True)
        await db.cs_incident_issues.create_index("date_of_issue")
        await db.cs_incident_issues.create_index("business_unit")
        await db.cs_incident_issues.create_index("status")
        await db.cs_incident_issues_audit.create_index("issue_number")
    except Exception as e:
        log.warning("cs_incident index setup: %s", e)


@router.get("/columns")
async def columns_metadata(_user: dict = Depends(get_current_user)):
    """Return the set of currently-populated field names across the live
    collection. Frontend uses this to decide which columns to render."""
    populated: set[str] = set()
    cursor = db.cs_incident_issues.find(
        {"deleted_at": None}, projection={"_id": 0})
    async for doc in cursor:
        for k, v in doc.items():
            if k in BOOKKEEPING:
                continue
            if v not in (None, ""):
                populated.add(k)
    return {"populated": sorted(populated), "total": len(populated)}


@router.get("/")
async def list_rows(
    q: Optional[str] = None,
    business_unit: Optional[str] = None,
    status: Optional[str] = None,
    issue_type: Optional[str] = None,
    injury_severity: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    _user: dict = Depends(get_current_user),
):
    query: dict = {"deleted_at": None}
    if business_unit: query["business_unit"] = business_unit
    if status: query["status"] = status
    if issue_type: query["issue_type"] = issue_type
    if injury_severity: query["injury_severity"] = injury_severity
    if q:
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"issue_number": {"$regex": pat, "$options": "i"}},
            {"description": {"$regex": pat, "$options": "i"}},
            {"hazard_description": {"$regex": pat, "$options": "i"}},
            {"near_miss_description": {"$regex": pat, "$options": "i"}},
            {"property_description": {"$regex": pat, "$options": "i"}},
            {"other_description": {"$regex": pat, "$options": "i"}},
            {"identified_by": {"$regex": pat, "$options": "i"}},
            {"entered_by": {"$regex": pat, "$options": "i"}},
            {"responsible_manager": {"$regex": pat, "$options": "i"}},
        ]
    total = await db.cs_incident_issues.count_documents(query)
    cursor = db.cs_incident_issues.find(query, {"_id": 0}).skip(offset).limit(min(limit, 1000))
    items = [r async for r in cursor]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{uid}")
async def get_row(uid: str, _user: dict = Depends(get_current_user)):
    doc = await db.cs_incident_issues.find_one(
        {"$or": [{"id": uid}, {"issue_number": uid}], "deleted_at": None},
        {"_id": 0})
    if not doc:
        raise HTTPException(404, "not-found")
    return doc


class RowPatch(BaseModel):
    class Config: extra = "allow"


@router.post("/")
async def create_row(body: RowPatch, user: dict = Depends(require_permission("reference_library", "edit"))):
    _admin(user)
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items()
            if k not in BOOKKEEPING}
    issue_number = str(data.get("issue_number") or "").strip()
    if not issue_number:
        raise HTTPException(400, "issue_number-required")
    data["issue_number"] = issue_number
    if await db.cs_incident_issues.find_one({"issue_number": issue_number}):
        raise HTTPException(409, "issue_number-already-exists")
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        **data,
        "created_at": now, "updated_at": now,
        "imported_by": user["id"], "imported_at": now,
        "deleted_at": None,
    }
    await db.cs_incident_issues.insert_one(doc)
    await db.cs_incident_issues_audit.insert_one({
        "id": str(uuid.uuid4()), "issue_number": issue_number,
        "action": "manual-insert", "at": now, "actor_id": user["id"],
    })
    doc.pop("_id", None)
    return doc


@router.patch("/{uid}")
async def patch_row(uid: str, patch: RowPatch,
                    user: dict = Depends(require_permission("reference_library", "edit"))):
    _admin(user)
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if k not in BOOKKEEPING}
    if not updates:
        raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now()
    r = await db.cs_incident_issues.find_one_and_update(
        {"$or": [{"id": uid}, {"issue_number": uid}], "deleted_at": None},
        {"$set": updates}, projection={"_id": 0}, return_document=True)
    if not r:
        raise HTTPException(404, "not-found")
    await db.cs_incident_issues_audit.insert_one({
        "id": str(uuid.uuid4()), "issue_number": r["issue_number"],
        "action": "manual-update", "at": updates["updated_at"],
        "actor_id": user["id"], "fields": list(updates.keys()),
    })
    return r


@router.delete("/{uid}")
async def delete_row(uid: str, user: dict = Depends(require_permission("reference_library", "delete"))):
    _admin(user)
    now = _now()
    r = await db.cs_incident_issues.find_one_and_update(
        {"$or": [{"id": uid}, {"issue_number": uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True)
    if not r:
        raise HTTPException(404, "not-found")
    await db.cs_incident_issues_audit.insert_one({
        "id": str(uuid.uuid4()), "issue_number": r["issue_number"],
        "action": "soft-delete", "at": now, "actor_id": user["id"],
    })
    return {"deleted": True, "issue_number": r["issue_number"]}


@router.post("/reimport")
async def reimport(
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(require_permission("reference_library", "edit")),
):
    _admin(user)
    if bool(file) == bool(url):
        raise HTTPException(400, "supply-exactly-one-of-file-or-url")
    from pathlib import Path as _P
    dest = (_P(__file__).resolve().parent / "scripts" / "data"
            / "cs_incident_source.xlsx")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if file:
        content = await file.read()
        dest.write_bytes(content); size = len(content)
    else:
        import httpx as _h
        async with _h.AsyncClient(follow_redirects=True, timeout=60.0) as c:
            r = await c.get(url); r.raise_for_status()
            dest.write_bytes(r.content); size = len(r.content)

    from scripts.import_cs_incident import (
        parse_workbook, upsert_rows, ensure_indexes as _idx)
    await _idx()
    rows, populated = parse_workbook(dest)
    stats = await upsert_rows(rows, actor_id=user["id"])
    total = await db.cs_incident_issues.count_documents({"deleted_at": None})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "populated_columns": len(populated), "live_total": total,
            **stats}
