"""v58.13.132gl-b — Equipment Register (extended in .132gs Phase 1).

Admin surface for tracking calibrated equipment (gas monitors, test
gauges, torque wrenches, etc). Each row has a name, category (now
managed via editable CRUD, see below), model number, serial number,
last-calibration and expiry dates, notes, a list of calibration
certificate files, and a generic list of attached documents (spec
sheets, manuals, invoices, warranty PDFs — anything that isn't a
calibration cert).

Follows the `.132fi` Licences shape: a single Mongo collection
`equipment_register`, soft-deletes only, `archive_audit` writes,
GridFS for file bodies via `uploads_storage.save_upload`.

.132gs Phase 1 additions:
    · `model_number` field on EquipmentIn / EquipmentPatch. Existing
      rows auto-read as `None` (no backfill migration needed —
      Pydantic tolerates missing keys).
    · Generic `documents: []` array alongside the existing `certs: []`
      array. Same GridFS storage, same upload / download / soft-delete
      shape, different subdir (`equipment_documents/`) so audits can
      tell the two apart at the storage layer.
    · Category CRUD moved to a new `equipment_categories` collection
      + a sub-router mounted BEFORE the `/{eid}` catch-all so
      `/equipment/categories` is not swallowed by the eid dispatcher.
      Admin-only writes; soft-delete only (categories retain a
      snapshot string on any equipment already using them).

Endpoints
---------
    GET    /api/equipment                          list (admin only)
    GET    /api/equipment/summary                  expiry summary
    GET    /api/equipment/categories               list active categories
    POST   /api/equipment/categories               create (admin)
    PATCH  /api/equipment/categories/{cid}         rename (admin)
    DELETE /api/equipment/categories/{cid}         soft-delete (admin)
    POST   /api/equipment                          create
    GET    /api/equipment/{eid}                    detail
    PATCH  /api/equipment/{eid}                    update
    DELETE /api/equipment/{eid}                    soft-delete + audit
    POST   /api/equipment/{eid}/certs              upload calibration cert
    GET    /api/equipment/{eid}/certs/{cert_id}    download
    DELETE /api/equipment/{eid}/certs/{cert_id}    soft-delete cert
    POST   /api/equipment/{eid}/documents          upload generic document
    GET    /api/equipment/{eid}/documents/{doc_id} download
    DELETE /api/equipment/{eid}/documents/{doc_id} soft-delete document
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, date
from typing import Optional

from fastapi import (
    APIRouter, Depends, HTTPException, UploadFile, File, Form,
)
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from uploads_storage import save_upload, read_upload

log = logging.getLogger("paneltec.equipment_register")

# `categories_router` MUST be include_router'd BEFORE the main
# `router` so `/equipment/categories` isn't consumed by `/{eid}`.
categories_router = APIRouter(prefix="/equipment/categories",
                              tags=["equipment-categories"])
router = APIRouter(prefix="/equipment", tags=["equipment-register"])

MAX_FILE_BYTES = 50 * 1024 * 1024
ALLOWED_MIMES = {
    "application/pdf", "image/png", "image/jpeg", "image/webp",
    "application/vnd.openxmlformats-officedocument."
    "wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument."
    "spreadsheetml.sheet",
    "text/plain", "text/csv",
}
ALLOWED_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".docx",
                ".xlsx", ".txt", ".csv"}

DEFAULT_CATEGORIES = [
    "Gas monitor", "Test gauge", "Torque wrench", "Pressure tester",
    "Multimeter", "Insulation tester", "Traffic-management sign", "Other",
]


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") != "admin":
        raise HTTPException(403, "Admin only")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_ext(filename: Optional[str]) -> str:
    if not filename:
        return ""
    idx = filename.rfind(".")
    if idx < 0:
        return ""
    return filename[idx:].lower()


class EquipmentIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=80)
    model_number: Optional[str] = Field(None, max_length=120)
    serial_number: Optional[str] = Field(None, max_length=120)
    last_calibration_date: Optional[str] = None  # ISO date YYYY-MM-DD
    expiry_date: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)


class EquipmentPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = Field(None, min_length=1, max_length=80)
    model_number: Optional[str] = Field(None, max_length=120)
    serial_number: Optional[str] = Field(None, max_length=120)
    last_calibration_date: Optional[str] = None
    expiry_date: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)


class CategoryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


class CategoryPatch(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


def _days_until(iso: Optional[str]) -> Optional[int]:
    """Days until `iso` (YYYY-MM-DD). Negative if past."""
    if not iso:
        return None
    try:
        d = date.fromisoformat(iso[:10])
    except ValueError:
        return None
    return (d - date.today()).days


def _shape(doc: dict) -> dict:
    doc.pop("_id", None)
    # Back-compat: model_number and documents default to None / [].
    doc.setdefault("model_number", None)
    doc.setdefault("documents", [])
    doc["days_until_expiry"] = _days_until(doc.get("expiry_date"))
    return doc


def _shape_category(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def _ensure_indexes():
    await db.equipment_register.create_index(
        [("org_id", 1), ("deleted_at", 1), ("expiry_date", 1)])
    await db.equipment_register.create_index("id", unique=True)
    await db.equipment_categories.create_index(
        [("org_id", 1), ("deleted_at", 1), ("name", 1)])
    await db.equipment_categories.create_index("id", unique=True)


async def _seed_default_categories(org_id: str, actor_id: str) -> None:
    """Idempotently seed the 8 default categories for a fresh org."""
    existing = await db.equipment_categories.count_documents(
        {"org_id": org_id, "deleted_at": None})
    if existing:
        return
    now = _now()
    docs = [
        {
            "id": str(uuid.uuid4()),
            "org_id": org_id,
            "name": name,
            "created_by": actor_id,
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
            "seeded": True,
        }
        for name in DEFAULT_CATEGORIES
    ]
    await db.equipment_categories.insert_many(docs)


# ─── Category CRUD (mounted before /{eid}) ─────────────────────

@categories_router.get("")
async def list_categories(user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _ensure_indexes()
    await _seed_default_categories(user["org_id"], user["id"])
    items: list[dict] = []
    async for row in db.equipment_categories.find(
        {"org_id": user["org_id"], "deleted_at": None},
    ).sort([("name", 1)]):
        items.append(_shape_category(row))
    return {"items": items, "total": len(items)}


@categories_router.post("", status_code=201)
async def create_category(body: CategoryIn,
                          user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _ensure_indexes()
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    dupe = await db.equipment_categories.find_one({
        "org_id": user["org_id"], "deleted_at": None, "name": name,
    })
    if dupe:
        raise HTTPException(409, "Category already exists")
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "org_id": user["org_id"],
        "name": name,
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
        "seeded": False,
    }
    await db.equipment_categories.insert_one(doc.copy())
    return _shape_category(doc)


@categories_router.patch("/{cid}")
async def rename_category(cid: str, body: CategoryPatch,
                          user: dict = Depends(get_current_user)):
    _require_admin(user)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    dupe = await db.equipment_categories.find_one({
        "org_id": user["org_id"], "deleted_at": None, "name": name,
        "id": {"$ne": cid},
    })
    if dupe:
        raise HTTPException(409, "Category already exists")
    now = _now()
    r = await db.equipment_categories.update_one(
        {"id": cid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"name": name, "updated_at": now,
                  "updated_by": user["id"]}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Category not found")
    doc = await db.equipment_categories.find_one({"id": cid})
    return _shape_category(doc)


@categories_router.delete("/{cid}", status_code=204)
async def delete_category(cid: str,
                          user: dict = Depends(get_current_user)):
    _require_admin(user)
    now = _now()
    r = await db.equipment_categories.update_one(
        {"id": cid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Category not found")
    # Existing equipment rows keep their `category` string snapshot;
    # nothing to cascade on the equipment_register side.
    return Response(status_code=204)


# ─── Equipment CRUD ─────────────────────────────────────────────

@router.get("")
async def list_equipment(user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _ensure_indexes()
    items: list[dict] = []
    async for row in db.equipment_register.find(
        {"org_id": user["org_id"], "deleted_at": None},
    ).sort([("expiry_date", 1), ("name", 1)]):
        items.append(_shape(row))
    return {"items": items, "total": len(items)}


@router.get("/summary")
async def summary(user: dict = Depends(get_current_user)):
    _require_admin(user)
    total = 0
    expired = 0
    expiring_30d = 0
    async for row in db.equipment_register.find(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "expiry_date": 1},
    ):
        total += 1
        d = _days_until(row.get("expiry_date"))
        if d is None:
            continue
        if d < 0:
            expired += 1
        elif d <= 30:
            expiring_30d += 1
    return {"total": total, "expired": expired,
            "expiring_30d": expiring_30d}


@router.post("", status_code=201)
async def create_equipment(body: EquipmentIn,
                             user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _ensure_indexes()
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "org_id": user["org_id"],
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
        "certs": [],
        "documents": [],
        **body.model_dump(),
    }
    await db.equipment_register.insert_one(doc.copy())
    await db.archive_audit.insert_one({
        "id": now.replace(":", "").replace(".", "")[:24],
        "module": "equipment_register",
        "resource": "equipment",
        "resource_id": doc["id"],
        "action": "created",
        "timestamp": now,
        "affected_count": 1,
        "actor_id": user["id"],
    })
    return _shape(doc)


@router.get("/{eid}")
async def get_equipment(eid: str,
                        user: dict = Depends(get_current_user)):
    _require_admin(user)
    doc = await db.equipment_register.find_one(
        {"id": eid, "org_id": user["org_id"], "deleted_at": None})
    if not doc:
        raise HTTPException(404, "Equipment not found")
    return _shape(doc)


@router.patch("/{eid}")
async def update_equipment(eid: str, body: EquipmentPatch,
                             user: dict = Depends(get_current_user)):
    _require_admin(user)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(400, "Nothing to update")
    patch["updated_at"] = _now()
    r = await db.equipment_register.update_one(
        {"id": eid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": patch},
    )
    if not r.matched_count:
        raise HTTPException(404, "Equipment not found")
    doc = await db.equipment_register.find_one({"id": eid})
    return _shape(doc)


@router.delete("/{eid}", status_code=204)
async def delete_equipment(eid: str,
                             user: dict = Depends(get_current_user)):
    _require_admin(user)
    now = _now()
    r = await db.equipment_register.update_one(
        {"id": eid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Equipment not found")
    await db.archive_audit.insert_one({
        "id": now.replace(":", "").replace(".", "")[:24],
        "module": "equipment_register",
        "resource": "equipment",
        "resource_id": eid,
        "action": "soft_deleted",
        "timestamp": now,
        "affected_count": 1,
        "actor_id": user["id"],
    })
    return Response(status_code=204)


# ─── Cert file endpoints ────────────────────────────────────────

async def _read_upload_bytes(file: UploadFile) -> bytearray:
    ext = _safe_ext(file.filename)
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, "Unsupported file type")
    if file.content_type and file.content_type not in ALLOWED_MIMES:
        raise HTTPException(400, "Unsupported mime type")
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_FILE_BYTES:
            raise HTTPException(400, "Exceeds 50 MB limit")
    return buf


@router.post("/{eid}/certs", status_code=201)
async def upload_cert(
    eid: str,
    file: UploadFile = File(...),
    calibration_date: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    _require_admin(user)
    eq = await db.equipment_register.find_one(
        {"id": eid, "org_id": user["org_id"], "deleted_at": None})
    if not eq:
        raise HTTPException(404, "Equipment not found")

    buf = await _read_upload_bytes(file)

    cert_id = str(uuid.uuid4())
    ext = _safe_ext(file.filename)
    stored_name = f"{cert_id}{ext}"
    await save_upload(
        "equipment_certs", [eid, stored_name], bytes(buf),
        module="equipment_register",
        org_id=user["org_id"],
        mime=file.content_type,
        orig_filename=file.filename,
    )
    now = _now()
    cert = {
        "id": cert_id,
        "filename": file.filename,
        "stored_name": stored_name,
        "mime": file.content_type,
        "size": len(buf),
        "calibration_date": calibration_date,
        "notes": notes,
        "uploaded_by": user["id"],
        "uploaded_at": now,
        "deleted_at": None,
    }
    await db.equipment_register.update_one(
        {"id": eid},
        {"$push": {"certs": cert}, "$set": {"updated_at": now}},
    )
    return cert


@router.get("/{eid}/certs/{cert_id}")
async def download_cert(eid: str, cert_id: str,
                          user: dict = Depends(get_current_user)):
    _require_admin(user)
    eq = await db.equipment_register.find_one(
        {"id": eid, "org_id": user["org_id"], "deleted_at": None})
    if not eq:
        raise HTTPException(404, "Equipment not found")
    cert = next((c for c in (eq.get("certs") or [])
                  if c.get("id") == cert_id
                  and c.get("deleted_at") is None), None)
    if not cert:
        raise HTTPException(404, "Cert not found")
    hit = await read_upload(
        "equipment_certs", [eid, cert["stored_name"]])
    if hit is None:
        raise HTTPException(410, "Cert bytes missing")
    data, mime = hit
    return Response(
        content=data,
        media_type=cert.get("mime") or mime or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{cert["filename"]}"',
        },
    )


@router.delete("/{eid}/certs/{cert_id}", status_code=204)
async def delete_cert(eid: str, cert_id: str,
                        user: dict = Depends(get_current_user)):
    _require_admin(user)
    now = _now()
    r = await db.equipment_register.update_one(
        {"id": eid, "org_id": user["org_id"],
         "certs.id": cert_id},
        {"$set": {"certs.$.deleted_at": now,
                  "certs.$.deleted_by": user["id"],
                  "updated_at": now}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Cert not found")
    return Response(status_code=204)


# ─── Generic document endpoints (.132gs Phase 1) ────────────────

@router.post("/{eid}/documents", status_code=201)
async def upload_document(
    eid: str,
    file: UploadFile = File(...),
    label: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    """Upload a generic supporting document (spec sheet, manual,
    warranty, invoice, etc). Separate from `certs` so audits and UI
    can differentiate calibration proof from ancillary paperwork."""
    _require_admin(user)
    eq = await db.equipment_register.find_one(
        {"id": eid, "org_id": user["org_id"], "deleted_at": None})
    if not eq:
        raise HTTPException(404, "Equipment not found")

    buf = await _read_upload_bytes(file)

    doc_id = str(uuid.uuid4())
    ext = _safe_ext(file.filename)
    stored_name = f"{doc_id}{ext}"
    await save_upload(
        "equipment_documents", [eid, stored_name], bytes(buf),
        module="equipment_register",
        org_id=user["org_id"],
        mime=file.content_type,
        orig_filename=file.filename,
    )
    now = _now()
    doc = {
        "id": doc_id,
        "filename": file.filename,
        "stored_name": stored_name,
        "mime": file.content_type,
        "size": len(buf),
        "label": label,
        "uploaded_by": user["id"],
        "uploaded_at": now,
        "deleted_at": None,
    }
    await db.equipment_register.update_one(
        {"id": eid},
        {"$push": {"documents": doc}, "$set": {"updated_at": now}},
    )
    return doc


@router.get("/{eid}/documents/{doc_id}")
async def download_document(eid: str, doc_id: str,
                            user: dict = Depends(get_current_user)):
    _require_admin(user)
    eq = await db.equipment_register.find_one(
        {"id": eid, "org_id": user["org_id"], "deleted_at": None})
    if not eq:
        raise HTTPException(404, "Equipment not found")
    doc = next((d for d in (eq.get("documents") or [])
                if d.get("id") == doc_id
                and d.get("deleted_at") is None), None)
    if not doc:
        raise HTTPException(404, "Document not found")
    hit = await read_upload(
        "equipment_documents", [eid, doc["stored_name"]])
    if hit is None:
        raise HTTPException(410, "Document bytes missing")
    data, mime = hit
    return Response(
        content=data,
        media_type=doc.get("mime") or mime or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{doc["filename"]}"',
        },
    )


@router.delete("/{eid}/documents/{doc_id}", status_code=204)
async def delete_document(eid: str, doc_id: str,
                          user: dict = Depends(get_current_user)):
    _require_admin(user)
    now = _now()
    r = await db.equipment_register.update_one(
        {"id": eid, "org_id": user["org_id"],
         "documents.id": doc_id},
        {"$set": {"documents.$.deleted_at": now,
                  "documents.$.deleted_by": user["id"],
                  "updated_at": now}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Document not found")
    return Response(status_code=204)
