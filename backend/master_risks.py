"""v160.3.9.13 — Master Risks reference-library router.

Read-only for all authenticated users; write endpoints (POST / PATCH /
DELETE / reimport) are admin-only. This is a global reference library —
NOT scoped per org.

Mount:
    api.include_router(master_risks_router)  # → /api/master-risks/*

Content is populated by `scripts/import_master_risks.py` from the source
XLSX. See that module for schema documentation.
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

log = logging.getLogger("paneltec.master_risks")
router = APIRouter(prefix="/master-risks", tags=["master-risks"])

_ADMIN_ROLES = {"admin", "hseq_lead"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="admin-required")


async def ensure_indexes() -> None:
    try:
        await db.master_risks.create_index("risk_id", unique=True)
        await db.master_risks.create_index("severity")
        await db.master_risks.create_index("classification")
        await db.master_risks_audit.create_index("risk_id")
    except Exception as e:  # pragma: no cover
        log.warning("master_risks index setup: %s", e)


# ────────────────── Schemas ──────────────────

class MasterRiskPatch(BaseModel):
    classification: Optional[str] = None
    activity: Optional[str] = None
    hazard_aspect: Optional[str] = None
    unwanted_event: Optional[str] = None
    risk_score_uncontrolled: Optional[str] = None
    risk_score_controlled: Optional[str] = None
    mandatory_controls: Optional[str] = None
    other_controls: Optional[str] = None
    legal_references: Optional[str] = None
    swms_reference: Optional[str] = None
    severity: Optional[str] = None
    fill_hex: Optional[str] = None
    fill_hex_controlled: Optional[str] = None


class MasterRiskCreate(MasterRiskPatch):
    risk_id: str = Field(..., min_length=1)


# ────────────────── Endpoints ──────────────────

@router.get("/")
async def list_master_risks(
    severity: Optional[str] = None,
    classification: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    _user: dict = Depends(get_current_user),
):
    """List all master risks (soft-deleted excluded).

    Filters combine with AND. `q` is a case-insensitive substring match
    across activity/hazard/unwanted/controls — a mongo `$text` index
    exists but a substring regex is more forgiving for short queries
    like `crane` or `edge`.
    """
    query: dict = {"deleted_at": None}
    if severity:
        query["severity"] = severity
    if classification:
        query["classification"] = classification
    if q:
        # Escape regex special chars for safety.
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"activity": {"$regex": pat, "$options": "i"}},
            {"hazard_aspect": {"$regex": pat, "$options": "i"}},
            {"unwanted_event": {"$regex": pat, "$options": "i"}},
            {"mandatory_controls": {"$regex": pat, "$options": "i"}},
            {"other_controls": {"$regex": pat, "$options": "i"}},
            {"risk_id": {"$regex": pat, "$options": "i"}},
        ]

    total = await db.master_risks.count_documents(query)
    cursor = db.master_risks.find(query, {"_id": 0}).skip(offset).limit(min(limit, 1000))
    items = [r async for r in cursor]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{risk_uid}")
async def get_master_risk(risk_uid: str,
                          _user: dict = Depends(get_current_user)):
    doc = await db.master_risks.find_one(
        {"$or": [{"id": risk_uid}, {"risk_id": risk_uid}], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "not-found")
    return doc


@router.post("/")
async def create_master_risk(body: MasterRiskCreate,
                              user: dict = Depends(get_current_user)):
    _require_admin(user)
    existing = await db.master_risks.find_one({"risk_id": body.risk_id})
    if existing:
        raise HTTPException(409, "risk_id-already-exists")
    now = _now_iso()
    doc = body.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "created_at": now, "updated_at": now,
        "imported_by": user["id"], "imported_at": now,
        "deleted_at": None,
    })
    await db.master_risks.insert_one(doc)
    await db.master_risks_audit.insert_one({
        "id": str(uuid.uuid4()), "risk_id": body.risk_id,
        "action": "manual-insert", "at": now, "actor_id": user["id"],
    })
    doc.pop("_id", None)
    return doc


@router.patch("/{risk_uid}")
async def patch_master_risk(risk_uid: str, patch: MasterRiskPatch,
                             user: dict = Depends(get_current_user)):
    _require_admin(user)
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if v is not None}
    if not updates:
        raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now_iso()
    r = await db.master_risks.find_one_and_update(
        {"$or": [{"id": risk_uid}, {"risk_id": risk_uid}], "deleted_at": None},
        {"$set": updates},
        projection={"_id": 0}, return_document=True,
    )
    if not r:
        raise HTTPException(404, "not-found")
    await db.master_risks_audit.insert_one({
        "id": str(uuid.uuid4()), "risk_id": r["risk_id"],
        "action": "manual-update", "at": updates["updated_at"],
        "actor_id": user["id"], "fields": list(updates.keys()),
    })
    return r


@router.delete("/{risk_uid}")
async def delete_master_risk(risk_uid: str,
                              user: dict = Depends(get_current_user)):
    _require_admin(user)
    now = _now_iso()
    r = await db.master_risks.find_one_and_update(
        {"$or": [{"id": risk_uid}, {"risk_id": risk_uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True,
    )
    if not r:
        raise HTTPException(404, "not-found")
    await db.master_risks_audit.insert_one({
        "id": str(uuid.uuid4()), "risk_id": r["risk_id"],
        "action": "soft-delete", "at": now, "actor_id": user["id"],
    })
    return {"deleted": True, "risk_id": r["risk_id"]}


@router.post("/reimport")
async def reimport_master_risks(
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(get_current_user),
):
    """Re-run the XLSX ingestion against a fresh source.

    Accepts either a multipart file upload (`file`) OR a URL (`url`) —
    exactly one is required. The uploaded/downloaded workbook overwrites
    the on-disk source at `scripts/data/master_risks_source.xlsx` (so
    subsequent CLI runs pick up the latest), then the ingestion is run
    inline with the current user as the actor.
    """
    _require_admin(user)
    if bool(file) == bool(url):
        raise HTTPException(400, "supply-exactly-one-of-file-or-url")

    # Persist a fresh copy of the source next to the import script.
    import os as _os
    from pathlib import Path as _Path
    dest = (_Path(__file__).resolve().parent / "scripts" / "data"
            / "master_risks_source.xlsx")
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

    # Run the ingestion using the sibling module's helpers.
    from scripts.import_master_risks import (
        parse_workbook, upsert_master_risks, ensure_indexes as _idx,
    )
    await _idx()
    rows = parse_workbook(dest)
    stats = await upsert_master_risks(rows, actor_id=user["id"])
    total = await db.master_risks.count_documents({"deleted_at": None})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "inserted": stats["inserted"], "updated": stats["updated"],
            "unchanged": stats["unchanged"], "live_total": total}
