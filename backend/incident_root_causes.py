"""v160.3.9.15 — Incident Root Causes reference-library router.

Read-only for all authenticated users; write endpoints admin-only.
Mirrors the list_forms router structure.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from db import db
from auth import get_current_user
from permissions import require_permission  # v160.3.9.27 — guard migration

log = logging.getLogger("paneltec.incident_root_causes")
router = APIRouter(prefix="/incident-root-causes", tags=["incident-root-causes"])

_ADMIN_ROLES = {"admin"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") not in _ADMIN_ROLES:
        raise HTTPException(403, "admin-required")


async def ensure_indexes() -> None:
    try:
        await db.incident_root_causes.create_index("question_id", unique=True)
        await db.incident_root_causes.create_index("contributing_factor")
        await db.incident_root_causes.create_index("parent_question_id")
        await db.incident_root_causes_audit.create_index("question_id")
    except Exception as e:  # pragma: no cover
        log.warning("incident_root_causes index setup: %s", e)


class IRCPatch(BaseModel):
    description: Optional[str] = None
    contributing_factor: Optional[str] = None
    parent_question_id: Optional[str] = None
    has_action: Optional[bool] = None


class IRCCreate(IRCPatch):
    question_id: str = Field(..., min_length=1)


@router.get("/")
async def list_rows(
    q: Optional[str] = None,
    contributing_factor: Optional[str] = None,
    has_action: Optional[bool] = None,
    parent: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    _user: dict = Depends(get_current_user),
):
    query: dict = {"deleted_at": None}
    if contributing_factor:
        query["contributing_factor"] = contributing_factor
    if has_action is not None:
        query["has_action"] = has_action
    if parent is not None:
        # `parent=root` shortcut → rows with no parent.
        query["parent_question_id"] = None if parent in ("", "root") else parent
    if q:
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"question_id": {"$regex": pat, "$options": "i"}},
            {"description": {"$regex": pat, "$options": "i"}},
            {"contributing_factor": {"$regex": pat, "$options": "i"}},
        ]
    total = await db.incident_root_causes.count_documents(query)
    cursor = db.incident_root_causes.find(query, {"_id": 0}).skip(offset).limit(min(limit, 1000))
    items = [r async for r in cursor]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{uid}")
async def get_row(uid: str, _user: dict = Depends(get_current_user)):
    doc = await db.incident_root_causes.find_one(
        {"$or": [{"id": uid}, {"question_id": uid}], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "not-found")
    return doc


@router.post("/")
async def create_row(body: IRCCreate,
                     user: dict = Depends(require_permission("reference_library", "edit"))):
    _require_admin(user)
    if await db.incident_root_causes.find_one({"question_id": body.question_id}):
        raise HTTPException(409, "question_id-already-exists")
    now = _now_iso()
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "created_at": now, "updated_at": now,
        "imported_by": user["id"], "imported_at": now,
        "deleted_at": None,
    })
    await db.incident_root_causes.insert_one(doc)
    await db.incident_root_causes_audit.insert_one({
        "id": str(uuid.uuid4()), "question_id": body.question_id,
        "action": "manual-insert", "at": now, "actor_id": user["id"],
    })
    doc.pop("_id", None)
    return doc


@router.patch("/{uid}")
async def patch_row(uid: str, patch: IRCPatch,
                    user: dict = Depends(require_permission("reference_library", "edit"))):
    _require_admin(user)
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if v is not None}
    if not updates:
        raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now_iso()
    r = await db.incident_root_causes.find_one_and_update(
        {"$or": [{"id": uid}, {"question_id": uid}], "deleted_at": None},
        {"$set": updates},
        projection={"_id": 0}, return_document=True,
    )
    if not r:
        raise HTTPException(404, "not-found")
    await db.incident_root_causes_audit.insert_one({
        "id": str(uuid.uuid4()), "question_id": r["question_id"],
        "action": "manual-update", "at": updates["updated_at"],
        "actor_id": user["id"], "fields": list(updates.keys()),
    })
    return r


@router.delete("/{uid}")
async def delete_row(uid: str,
                     user: dict = Depends(require_permission("reference_library", "delete"))):
    _require_admin(user)
    now = _now_iso()
    r = await db.incident_root_causes.find_one_and_update(
        {"$or": [{"id": uid}, {"question_id": uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True,
    )
    if not r:
        raise HTTPException(404, "not-found")
    await db.incident_root_causes_audit.insert_one({
        "id": str(uuid.uuid4()), "question_id": r["question_id"],
        "action": "soft-delete", "at": now, "actor_id": user["id"],
    })
    return {"deleted": True, "question_id": r["question_id"]}


@router.post("/reimport")
async def reimport_rows(
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(require_permission("reference_library", "edit")),
):
    _require_admin(user)
    if bool(file) == bool(url):
        raise HTTPException(400, "supply-exactly-one-of-file-or-url")

    from pathlib import Path as _Path
    dest = (_Path(__file__).resolve().parent / "scripts" / "data"
            / "incident_root_causes_source.xlsx")
    dest.parent.mkdir(parents=True, exist_ok=True)

    if file:
        content = await file.read()
        dest.write_bytes(content)
        size = len(content)
    else:
        import httpx as _httpx
        async with _httpx.AsyncClient(follow_redirects=True, timeout=60.0) as c:
            r = await c.get(url)
            r.raise_for_status()
            dest.write_bytes(r.content)
            size = len(r.content)

    from scripts.import_incident_root_causes import (
        parse_workbook, upsert_rows, ensure_indexes as _idx,
    )
    await _idx()
    rows = parse_workbook(dest)
    stats = await upsert_rows(rows, actor_id=user["id"])
    total = await db.incident_root_causes.count_documents({"deleted_at": None})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "inserted": stats["inserted"], "updated": stats["updated"],
            "unchanged": stats["unchanged"], "live_total": total}
