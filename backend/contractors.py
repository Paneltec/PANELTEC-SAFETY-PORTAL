"""Contractor Register — companies + their compliance documents.

Auto-computes document statuses (valid / expiring_soon / expired) on every read.
"""
from __future__ import annotations
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import List, Literal, Optional
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/contractors", tags=["contractors"])

DocType = Literal["public_liability", "workers_comp", "white_card", "sw_license", "induction", "other"]
ContractorStatus = Literal["active", "inactive", "suspended"]

UPLOAD_DIR = Path(__file__).parent / "uploads" / "contractor_docs"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class ContractorIn(BaseModel):
    name: str
    abn: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    trade: Optional[str] = None
    status: ContractorStatus = "active"


def _doc_status(expiry_iso: Optional[str], current: Optional[str] = None) -> str:
    """Compute valid / expiring_soon / expired / pending."""
    if current == "pending":
        return "pending"
    if not expiry_iso:
        return "valid"
    try:
        exp = date.fromisoformat(expiry_iso[:10])
    except Exception:
        return "valid"
    today = date.today()
    if exp < today:
        return "expired"
    if exp <= today + timedelta(days=30):
        return "expiring_soon"
    return "valid"


def _decorate(c: dict) -> dict:
    """Re-compute live document statuses + a compliance summary chip."""
    docs = c.get("documents") or []
    for d in docs:
        d["status"] = _doc_status(d.get("expiry_date"), d.get("status"))
    valid = sum(1 for d in docs if d["status"] == "valid")
    expiring = sum(1 for d in docs if d["status"] == "expiring_soon")
    expired = sum(1 for d in docs if d["status"] == "expired")
    pending = sum(1 for d in docs if d["status"] == "pending")
    c["documents"] = docs
    c["compliance_summary"] = {
        "valid": valid, "expiring_soon": expiring,
        "expired": expired, "pending": pending, "total": len(docs),
    }
    c.pop("_id", None)
    return c


@router.get("")
async def list_contractors(
    status: Optional[ContractorStatus] = None,
    expiring_within_days: Optional[int] = Query(None, ge=1, le=365),
    trade: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = {"org_id": user["org_id"], "deleted_at": None}
    if status:
        q["status"] = status
    if trade:
        q["trade"] = trade
    docs = await db.contractors.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = [_decorate(d) for d in docs]
    if expiring_within_days:
        cutoff = date.today() + timedelta(days=expiring_within_days)
        out = [c for c in out if any(
            d.get("expiry_date") and date.fromisoformat(d["expiry_date"][:10]) <= cutoff
            for d in c.get("documents", [])
        )]
    return out


@router.get("/{cid}")
async def get_contractor(cid: str, user: dict = Depends(get_current_user)):
    doc = await db.contractors.find_one({"id": cid, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return _decorate(doc)


@router.post("", status_code=201)
async def create_contractor(body: ContractorIn, user: dict = Depends(get_current_user)):
    doc = {
        "id": new_id(), "org_id": user["org_id"], "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
        "documents": [], **body.model_dump(),
    }
    await db.contractors.insert_one(dict(doc))
    return _decorate(doc)


@router.patch("/{cid}")
async def patch_contractor(cid: str, patch: dict, user: dict = Depends(get_current_user)):
    patch = {k: v for k, v in (patch or {}).items() if k not in {"id", "org_id", "created_at", "documents"}}
    patch["updated_at"] = now_iso()
    res = await db.contractors.find_one_and_update(
        {"id": cid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": patch}, return_document=True, projection={"_id": 0},
    )
    if not res:
        raise HTTPException(404, "Not found")
    return _decorate(res)


@router.delete("/{cid}")
async def delete_contractor(cid: str, user: dict = Depends(get_current_user)):
    res = await db.contractors.update_one(
        {"id": cid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- Documents ----------

@router.post("/{cid}/documents", status_code=201)
async def upload_document(
    cid: str,
    type: DocType = Form(...),
    expiry_date: Optional[str] = Form(None),
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    contractor = await db.contractors.find_one({"id": cid, "org_id": user["org_id"], "deleted_at": None})
    if not contractor:
        raise HTTPException(404, "Contractor not found")

    safe_ext = Path(file.filename or "doc").suffix.lower() or ".bin"
    if safe_ext not in {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx"}:
        safe_ext = ".bin"
    name = f"{cid}_{uuid.uuid4()}{safe_ext}"
    target = UPLOAD_DIR / name
    with target.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    doc = {
        "id": new_id(),
        "type": type,
        "file_url": f"/api/files/contractor_docs/{name}",
        "expiry_date": expiry_date,
        "status": _doc_status(expiry_date),
        "uploaded_at": now_iso(),
        "uploaded_by": user["id"],
    }
    await db.contractors.update_one(
        {"id": cid, "org_id": user["org_id"]},
        {"$push": {"documents": doc}, "$set": {"updated_at": now_iso()}},
    )
    return doc


@router.delete("/{cid}/documents/{doc_id}")
async def delete_document(cid: str, doc_id: str, user: dict = Depends(get_current_user)):
    res = await db.contractors.update_one(
        {"id": cid, "org_id": user["org_id"], "deleted_at": None},
        {"$pull": {"documents": {"id": doc_id}}, "$set": {"updated_at": now_iso()}},
    )
    if res.modified_count == 0:
        raise HTTPException(404, "Document not found")
    return {"ok": True}
