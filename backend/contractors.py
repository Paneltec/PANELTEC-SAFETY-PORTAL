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
    # Phase 3.14 — surface the simpro linkage so the frontend can render
    # the "Simpro" chip next to the contractor name.
    c["simpro_vendor_id"] = c.get("simpro_vendor_id")
    c["needs_email"] = bool(c.get("needs_email"))
    c.pop("_id", None)
    return c


@router.get("")
async def list_contractors(
    status: Optional[ContractorStatus] = None,
    expiring_within_days: Optional[int] = Query(None, ge=1, le=365),
    trade: Optional[str] = None,
    missing_renewal_link: Optional[bool] = Query(False),
    search: Optional[str] = Query(None, max_length=120),
    user: dict = Depends(require_permission("contractors", "view")),
):
    q = {"org_id": user["org_id"], "deleted_at": None}
    if status:
        q["status"] = status
    if trade:
        q["trade"] = trade
    if search and search.strip():
        # Phase 3.14c — server-side search (regex, case-insensitive) across the
        # three identity fields a user is most likely to type: company name,
        # ABN, or the imported Simpro vendor id.
        import re as _re
        rx = {"$regex": _re.escape(search.strip()), "$options": "i"}
        q["$or"] = [{"name": rx}, {"abn": rx}, {"simpro_vendor_id": rx}]
    docs = await db.contractors.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

    # Phase 3.14b — annotate `has_active_renewal_link` so the frontend can
    # render a "needs renewal link" badge and filter on it without a 2nd round-trip.
    active_cids: set[str] = set()
    async for r in db.renewal_links.find(
        {"org_id": user["org_id"], "status": "pending"},
        {"_id": 0, "contractor_id": 1},
    ):
        if r.get("contractor_id"):
            active_cids.add(r["contractor_id"])

    out = []
    for d in docs:
        decorated = _decorate(d)
        decorated["has_active_renewal_link"] = d["id"] in active_cids
        out.append(decorated)

    if expiring_within_days:
        cutoff = date.today() + timedelta(days=expiring_within_days)
        out = [c for c in out if any(
            d.get("expiry_date") and date.fromisoformat(d["expiry_date"][:10]) <= cutoff
            for d in c.get("documents", [])
        )]
    if missing_renewal_link:
        out = [c for c in out if not c.get("has_active_renewal_link")]
    return out


@router.get("/{cid}")
async def get_contractor(cid: str, user: dict = Depends(require_permission("contractors", "view"))):
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


# ─────────────── Phase 3.14 — Import from Simpro ───────────────

class ImportFromSimproIn(BaseModel):
    vendor_ids: List[str]


@router.post("/import-from-simpro")
async def import_from_simpro(body: ImportFromSimproIn, user: dict = Depends(get_current_user)):
    """Promote one or more cached Simpro vendors into the contractors table.
    Idempotent on `simpro_vendor_id` — a re-run updates the existing row
    rather than creating a duplicate. admin/manager only."""
    if user.get("role") not in {"admin", "manager"}:
        raise HTTPException(403, "Only admin/manager can import contractors")
    if not body.vendor_ids:
        return {"created": 0, "updated": 0, "skipped": 0, "errors": [], "contractors": []}

    # Pull the local mirror in one shot.
    cur = db.simpro_suppliers.find(
        {"org_id": user["org_id"], "simpro_vendor_id": {"$in": body.vendor_ids}},
        {"_id": 0},
    )
    suppliers = {s["simpro_vendor_id"]: s async for s in cur}

    created = updated = skipped = 0
    errors: list[dict] = []
    out: list[dict] = []
    now = now_iso()

    for vid in body.vendor_ids:
        s = suppliers.get(vid)
        if not s:
            errors.append({"simpro_vendor_id": vid, "reason": "not in cached suppliers"})
            skipped += 1
            continue
        # Has a contractor already been promoted from this vendor?
        existing = await db.contractors.find_one(
            {"org_id": user["org_id"], "simpro_vendor_id": vid, "deleted_at": None},
            {"_id": 0},
        )
        payload = {
            "name": s.get("name") or "(unnamed)",
            "abn": s.get("abn") or "",
            "contact_name": s.get("primary_contact_name") or "",
            "contact_email": s.get("email") or "",
            "contact_phone": s.get("phone") or "",
            "status": "active",
            "simpro_vendor_id": vid,
            "simpro_company_id": s.get("simpro_company_id"),
            "imported_from": "simpro",
            "imported_at": now,
            "needs_email": not bool(s.get("email")),
            "updated_at": now,
        }
        if existing:
            await db.contractors.update_one({"id": existing["id"]}, {"$set": payload})
            merged = {**existing, **payload}
            out.append(_decorate(merged))
            updated += 1
        else:
            doc = {
                "id": new_id(), "org_id": user["org_id"],
                "created_by": user["id"], "created_at": now,
                "deleted_at": None, "documents": [],
                "trade": None, **payload,
            }
            await db.contractors.insert_one(dict(doc))
            out.append(_decorate(doc))
            created += 1
        # Backlink on the supplier row.
        await db.simpro_suppliers.update_one(
            {"org_id": user["org_id"], "simpro_vendor_id": vid},
            {"$set": {"last_imported_at": now}},
        )

    return {"created": created, "updated": updated, "skipped": skipped,
            "errors": errors, "contractors": out}
