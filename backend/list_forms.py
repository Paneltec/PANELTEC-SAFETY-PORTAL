"""v160.3.9.14 — List Forms reference-library router.

Read-only for all authenticated users; write endpoints (POST / PATCH /
DELETE / reimport) are admin-only. Mirror the master_risks router
structure; content populated by `scripts/import_list_forms.py`.
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

log = logging.getLogger("paneltec.list_forms")
router = APIRouter(prefix="/list-forms", tags=["list-forms"])

_ADMIN_ROLES = {"admin"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") not in _ADMIN_ROLES:
        raise HTTPException(403, "admin-required")


async def ensure_indexes() -> None:
    try:
        await db.list_forms.create_index("list_form_id", unique=True)
        await db.list_forms.create_index("form_group")
        await db.list_forms.create_index("name")
        await db.list_forms_audit.create_index("list_form_id")
    except Exception as e:  # pragma: no cover
        log.warning("list_forms index setup: %s", e)


class ListFormPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    form_group: Optional[list[str]] = None
    public_enabled: Optional[bool] = None
    mobile_enabled: Optional[bool] = None
    asset_enabled: Optional[bool] = None


class ListFormCreate(ListFormPatch):
    list_form_id: str = Field(..., min_length=1)


@router.get("/")
async def list_list_forms(
    group: Optional[str] = None,
    public: Optional[bool] = None,
    mobile: Optional[bool] = None,
    asset: Optional[bool] = None,
    q: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    _user: dict = Depends(get_current_user),
):
    query: dict = {"deleted_at": None}
    if group:
        query["form_group"] = group
    if public is not None:
        query["public_enabled"] = public
    if mobile is not None:
        query["mobile_enabled"] = mobile
    if asset is not None:
        query["asset_enabled"] = asset
    if q:
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"name": {"$regex": pat, "$options": "i"}},
            {"description": {"$regex": pat, "$options": "i"}},
            {"list_form_id": {"$regex": pat, "$options": "i"}},
        ]
    total = await db.list_forms.count_documents(query)
    cursor = db.list_forms.find(query, {"_id": 0}).skip(offset).limit(min(limit, 1000))
    items = [r async for r in cursor]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{uid}")
async def get_list_form(uid: str, _user: dict = Depends(get_current_user)):
    doc = await db.list_forms.find_one(
        {"$or": [{"id": uid}, {"list_form_id": uid}], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "not-found")
    return doc


@router.post("/")
async def create_list_form(body: ListFormCreate,
                            user: dict = Depends(require_permission("reference_library", "edit"))):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_require_admin(user)` removed.
    if await db.list_forms.find_one({"list_form_id": body.list_form_id}):
        raise HTTPException(409, "list_form_id-already-exists")
    now = _now_iso()
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "created_at": now, "updated_at": now,
        "imported_by": user["id"], "imported_at": now,
        "deleted_at": None,
    })
    await db.list_forms.insert_one(doc)
    await db.list_forms_audit.insert_one({
        "id": str(uuid.uuid4()), "list_form_id": body.list_form_id,
        "action": "manual-insert", "at": now, "actor_id": user["id"],
    })
    doc.pop("_id", None)
    return doc


@router.patch("/{uid}")
async def patch_list_form(uid: str, patch: ListFormPatch,
                           user: dict = Depends(require_permission("reference_library", "edit"))):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_require_admin(user)` removed.
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if v is not None}
    if not updates:
        raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now_iso()
    r = await db.list_forms.find_one_and_update(
        {"$or": [{"id": uid}, {"list_form_id": uid}], "deleted_at": None},
        {"$set": updates},
        projection={"_id": 0}, return_document=True,
    )
    if not r:
        raise HTTPException(404, "not-found")
    await db.list_forms_audit.insert_one({
        "id": str(uuid.uuid4()), "list_form_id": r["list_form_id"],
        "action": "manual-update", "at": updates["updated_at"],
        "actor_id": user["id"], "fields": list(updates.keys()),
    })
    return r


@router.delete("/{uid}")
async def delete_list_form(uid: str,
                            user: dict = Depends(require_permission("reference_library", "delete"))):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_require_admin(user)` removed.
    now = _now_iso()
    r = await db.list_forms.find_one_and_update(
        {"$or": [{"id": uid}, {"list_form_id": uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True,
    )
    if not r:
        raise HTTPException(404, "not-found")
    await db.list_forms_audit.insert_one({
        "id": str(uuid.uuid4()), "list_form_id": r["list_form_id"],
        "action": "soft-delete", "at": now, "actor_id": user["id"],
    })
    return {"deleted": True, "list_form_id": r["list_form_id"]}


@router.post("/reimport")
async def reimport_list_forms(
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(require_permission("reference_library", "edit")),
):
    # v160.3.9.29 (Blocker-E fix) — dead inline `_require_admin(user)` removed.
    if bool(file) == bool(url):
        raise HTTPException(400, "supply-exactly-one-of-file-or-url")

    from pathlib import Path as _Path
    dest = (_Path(__file__).resolve().parent / "scripts" / "data"
            / "list_forms_source.xlsx")
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

    from scripts.import_list_forms import (
        parse_workbook, upsert_list_forms, ensure_indexes as _idx,
    )
    await _idx()
    rows = parse_workbook(dest)
    stats = await upsert_list_forms(rows, actor_id=user["id"])
    total = await db.list_forms.count_documents({"deleted_at": None})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "inserted": stats["inserted"], "updated": stats["updated"],
            "unchanged": stats["unchanged"], "live_total": total}
