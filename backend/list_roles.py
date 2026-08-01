"""v160.3.9.17 — List Roles reference-library router."""
from __future__ import annotations
import logging, uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from db import db
from auth import get_current_user
from permissions import require_permission  # v160.3.9.27 — guard migration

log = logging.getLogger("paneltec.list_roles")
router = APIRouter(prefix="/list-roles", tags=["list-roles"])
_ADMIN = {"admin"}


def _now(): return datetime.now(timezone.utc).isoformat()


def _admin(user):
    if (user or {}).get("role") not in _ADMIN:
        raise HTTPException(403, "admin-required")


async def ensure_indexes():
    try:
        await db.list_roles.create_index("role_id", unique=True)
        await db.list_roles.create_index("role_title")
        await db.list_roles_audit.create_index("role_id")
    except Exception as e:
        log.warning("list_roles index setup: %s", e)


class RolePatch(BaseModel):
    role_title: Optional[str] = None
    description: Optional[str] = None
    capabilities_count: Optional[int] = None
    people_count: Optional[int] = None
    capabilities: Optional[list[str]] = None
    people: Optional[list[str]] = None


class RoleCreate(RolePatch):
    role_id: str = Field(..., min_length=1)


@router.get("/")
async def list_rows(
    q: Optional[str] = None,
    min_capabilities: Optional[int] = None,
    min_people: Optional[int] = None,
    capability: Optional[str] = None,  # future: filter by array member
    person: Optional[str] = None,       # future: filter by array member
    limit: int = 500,
    offset: int = 0,
    _user: dict = Depends(get_current_user),
):
    query: dict = {"deleted_at": None}
    if min_capabilities is not None:
        query["capabilities_count"] = {"$gte": min_capabilities}
    if min_people is not None:
        query["people_count"] = {"$gte": min_people}
    if capability: query["capabilities"] = capability
    if person:     query["people"] = person
    if q:
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"role_id":     {"$regex": pat, "$options": "i"}},
            {"role_title":  {"$regex": pat, "$options": "i"}},
            {"description": {"$regex": pat, "$options": "i"}},
        ]
    total = await db.list_roles.count_documents(query)
    cursor = db.list_roles.find(query, {"_id": 0}).skip(offset).limit(min(limit, 1000))
    items = [r async for r in cursor]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{uid}")
async def get_row(uid: str, _user: dict = Depends(get_current_user)):
    doc = await db.list_roles.find_one(
        {"$or": [{"id": uid}, {"role_id": uid}], "deleted_at": None},
        {"_id": 0})
    if not doc:
        raise HTTPException(404, "not-found")
    return doc


@router.post("/")
async def create_row(body: RoleCreate, user: dict = Depends(require_permission("reference_library", "edit"))):
    _admin(user)
    if await db.list_roles.find_one({"role_id": body.role_id}):
        raise HTTPException(409, "role_id-already-exists")
    now = _now()
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "capabilities": doc.get("capabilities") or [],
        "people": doc.get("people") or [],
        "capabilities_count": doc.get("capabilities_count") or 0,
        "people_count": doc.get("people_count") or 0,
        "created_at": now, "updated_at": now,
        "imported_by": user["id"], "imported_at": now,
        "deleted_at": None,
    })
    await db.list_roles.insert_one(doc)
    await db.list_roles_audit.insert_one({
        "id": str(uuid.uuid4()), "role_id": body.role_id,
        "action": "manual-insert", "at": now, "actor_id": user["id"],
    })
    doc.pop("_id", None)
    return doc


@router.patch("/{uid}")
async def patch_row(uid: str, patch: RolePatch,
                    user: dict = Depends(require_permission("reference_library", "edit"))):
    _admin(user)
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if v is not None}
    if not updates:
        raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now()
    r = await db.list_roles.find_one_and_update(
        {"$or": [{"id": uid}, {"role_id": uid}], "deleted_at": None},
        {"$set": updates}, projection={"_id": 0}, return_document=True)
    if not r: raise HTTPException(404, "not-found")
    await db.list_roles_audit.insert_one({
        "id": str(uuid.uuid4()), "role_id": r["role_id"],
        "action": "manual-update", "at": updates["updated_at"],
        "actor_id": user["id"], "fields": list(updates.keys()),
    })
    return r


@router.delete("/{uid}")
async def delete_row(uid: str, user: dict = Depends(require_permission("reference_library", "delete"))):
    _admin(user)
    now = _now()
    r = await db.list_roles.find_one_and_update(
        {"$or": [{"id": uid}, {"role_id": uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True)
    if not r: raise HTTPException(404, "not-found")
    await db.list_roles_audit.insert_one({
        "id": str(uuid.uuid4()), "role_id": r["role_id"],
        "action": "soft-delete", "at": now, "actor_id": user["id"],
    })
    return {"deleted": True, "role_id": r["role_id"]}


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
            / "list_roles_source.xlsx")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if file:
        content = await file.read(); dest.write_bytes(content); size = len(content)
    else:
        import httpx as _h
        async with _h.AsyncClient(follow_redirects=True, timeout=60.0) as c:
            r = await c.get(url); r.raise_for_status()
            dest.write_bytes(r.content); size = len(r.content)
    from scripts.import_list_roles import (
        parse_workbook, upsert_rows, ensure_indexes as _idx)
    await _idx()
    rows = parse_workbook(dest)
    stats = await upsert_rows(rows, actor_id=user["id"])
    total = await db.list_roles.count_documents({"deleted_at": None})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "live_total": total, **stats}
