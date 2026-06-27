"""Worker Certifications — Phase 1.

Tracks compliance docs (White Card, First Aid, Working at Heights, etc.) for
each worker. Files land in the Document Library's "Licences & Tickets" folder
so they remain discoverable from there. Status (`valid` / `expiring_soon` /
`expired` / `no_expiry` / `missing_file`) is derived per request — never stored.
"""
from __future__ import annotations
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument

from auth import get_current_user
from db import db
from models import new_id, now_iso
from document_library import (
    ALLOWED_EXTS, ALLOWED_MIMES, MAX_FILE_BYTES, UPLOAD_DIR,
    _safe_ext, _serialise_file, _stub_ai_tags,
)

router = APIRouter(prefix="/workers", tags=["worker-certifications"])

WRITE_ROLES = {"admin", "hseq_lead"}
TARGET_FOLDER_NAME = "Licences & Tickets"
FALLBACK_FOLDER_NAME = "Uncategorised"
EXPIRING_SOON_DAYS = 30
ISO_DATE_RE = r"^\d{4}-\d{2}-\d{2}$"


def _require_write(user: dict, action: str = "edit"):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(403, f"Permission denied: worker_certifications.{action}")


async def _require_worker(worker_id: str, org_id: str) -> dict:
    worker = await db.workers.find_one(
        {"id": worker_id, "org_id": org_id, "deleted_at": None}, {"_id": 0},
    )
    if not worker:
        raise HTTPException(404, "Worker not found")
    return worker


async def _resolve_licences_folder(org_id: str, created_by: str) -> dict:
    """Find the seed `Licences & Tickets` folder, falling back to Uncategorised."""
    for name in (TARGET_FOLDER_NAME, FALLBACK_FOLDER_NAME):
        folder = await db.doc_folders.find_one(
            {"org_id": org_id, "name": name, "deleted_at": None,
             "supplier_id": {"$exists": False}},  # exclude supplier-scoped clones
            {"_id": 0},
        )
        if folder:
            return folder
    # Last-resort: create a new Uncategorised root folder. The Document Library
    # auto-seeds these on first list call, so this branch is virtually unreachable.
    doc = {
        "id": new_id(), "org_id": org_id, "name": FALLBACK_FOLDER_NAME,
        "color_key": "slate", "sort_order": 999000, "is_system": True,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": created_by, "deleted_at": None,
    }
    await db.doc_folders.insert_one(doc)
    return doc


def _parse_iso(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _status_for(cert: dict, today: date) -> dict:
    """Return {key, label, days} — pure function of expiry + file presence."""
    if not cert.get("doc_file_id"):
        return {"key": "missing_file", "label": "Missing file", "days": None}
    expiry = _parse_iso(cert.get("expiry_date"))
    if expiry is None:
        return {"key": "no_expiry", "label": "No expiry", "days": None}
    delta = (expiry - today).days
    if delta < 0:
        return {"key": "expired",
                "label": f"Expired {abs(delta)} day{'s' if abs(delta) != 1 else ''} ago",
                "days": delta}
    if delta < EXPIRING_SOON_DAYS:
        return {"key": "expiring_soon",
                "label": f"Expires in {delta} day{'s' if delta != 1 else ''}",
                "days": delta}
    return {"key": "valid", "label": "Valid", "days": delta}


def _serialise_cert(cert: dict, today: Optional[date] = None) -> dict:
    today = today or date.today()
    out = {k: v for k, v in cert.items() if k != "_id"}
    out["status"] = _status_for(cert, today)
    return out


class CertIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    issuer: Optional[str] = Field(default="", max_length=160)
    issue_date: Optional[str] = Field(default=None, max_length=10)
    expiry_date: Optional[str] = Field(default=None, max_length=10)
    notes: Optional[str] = Field(default="", max_length=2000)

    @field_validator("issue_date", "expiry_date")
    @classmethod
    def _iso(cls, v):
        if v in (None, ""):
            return None
        import re
        if not re.match(ISO_DATE_RE, v):
            raise ValueError("must be YYYY-MM-DD")
        return v


class CertPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    issuer: Optional[str] = Field(default=None, max_length=160)
    issue_date: Optional[str] = Field(default=None, max_length=10)
    expiry_date: Optional[str] = Field(default=None, max_length=10)
    notes: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("issue_date", "expiry_date")
    @classmethod
    def _iso(cls, v):
        if v in (None, ""):
            return None
        import re
        if not re.match(ISO_DATE_RE, v):
            raise ValueError("must be YYYY-MM-DD")
        return v


# ────────────────────── List / CRUD ──────────────────────

@router.get("/{worker_id}/certifications")
async def list_certs(worker_id: str, user: dict = Depends(get_current_user)):
    await _require_worker(worker_id, user["org_id"])
    today = date.today()
    cursor = db.worker_certifications.find(
        {"org_id": user["org_id"], "worker_id": worker_id, "deleted_at": None},
        {"_id": 0},
    ).sort([("expiry_date", 1), ("name", 1)])
    rows = await cursor.to_list(500)
    return [_serialise_cert(r, today) for r in rows]


@router.post("/{worker_id}/certifications", status_code=201)
async def create_cert(
    worker_id: str, body: CertIn, user: dict = Depends(get_current_user),
):
    _require_write(user, action="create")
    await _require_worker(worker_id, user["org_id"])
    doc = {
        "id": new_id(), "org_id": user["org_id"], "worker_id": worker_id,
        "name": body.name.strip(),
        "issuer": (body.issuer or "").strip(),
        "issue_date": body.issue_date,
        "expiry_date": body.expiry_date,
        "doc_file_id": None, "doc_folder_id": None,
        "notes": (body.notes or "").strip(),
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.worker_certifications.insert_one(doc)
    return _serialise_cert(doc)


@router.patch("/certifications/{cert_id}")
async def update_cert(
    cert_id: str, body: CertPatch, user: dict = Depends(get_current_user),
):
    _require_write(user)
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not payload:
        raise HTTPException(400, "No fields supplied")
    payload["updated_at"] = now_iso()
    result = await db.worker_certifications.find_one_and_update(
        {"id": cert_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": payload},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(404, "Certification not found")
    return _serialise_cert(result)


@router.delete("/certifications/{cert_id}", status_code=204)
async def delete_cert(cert_id: str, user: dict = Depends(get_current_user)):
    _require_write(user, action="delete")
    existing = await db.worker_certifications.find_one(
        {"id": cert_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Certification not found")
    ts = now_iso()
    await db.worker_certifications.update_one(
        {"id": cert_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    # Cascade: soft-delete the doc_file ONLY if (a) it was created via this
    # certification flow AND (b) no other live cert references the same file.
    file_id = existing.get("doc_file_id")
    if file_id:
        file_doc = await db.doc_files.find_one(
            {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0},
        )
        if file_doc and file_doc.get("uploaded_via") == "worker_certification":
            other = await db.worker_certifications.find_one(
                {"org_id": user["org_id"], "deleted_at": None,
                 "doc_file_id": file_id, "id": {"$ne": cert_id}},
                {"_id": 1},
            )
            if not other:
                await db.doc_files.update_one(
                    {"id": file_id, "org_id": user["org_id"]},
                    {"$set": {"deleted_at": ts, "updated_at": ts}},
                )
    return None


# ────────────────────── Upload ──────────────────────

@router.post("/{worker_id}/certifications/upload", status_code=201)
async def upload_cert_file(
    worker_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Multipart upload — saves the file under Document Library "Licences &
    Tickets" with `uploaded_via=worker_certification` AND creates a stub cert
    row with `name = filename without extension` so the UI can render an inline
    edit form for issuer/dates immediately."""
    _require_write(user, action="upload")
    worker = await _require_worker(worker_id, user["org_id"])
    folder = await _resolve_licences_folder(user["org_id"], user["id"])

    ext = _safe_ext(file.filename)
    if not ext:
        raise HTTPException(
            400,
            "Unsupported file type — allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG, TXT, CSV",
        )

    folder_dir = UPLOAD_DIR / folder["id"]
    folder_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    target = folder_dir / stored_name

    size = 0
    with target.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                out.close()
                target.unlink(missing_ok=True)
                raise HTTPException(400, "Exceeds 50 MB limit")
            out.write(chunk)

    worker_label = f"{worker.get('first_name', '')} {worker.get('last_name', '')}".strip() or "(unnamed)"
    file_doc = {
        "id": new_id(),
        "org_id": user["org_id"],
        "folder_id": folder["id"],
        "filename": file.filename or stored_name,
        "stored_name": stored_name,
        "mime": file.content_type or "application/octet-stream",
        "size": size,
        "file_url": f"/api/files/document_library/{folder['id']}/{stored_name}",
        "uploaded_by": user["id"],
        "uploaded_by_name": user.get("name") or user.get("email"),
        "uploaded_at": now_iso(),
        "updated_at": now_iso(),
        "ai_tags": _stub_ai_tags(file.filename or stored_name) + [f"worker:{worker_label}"],
        # Markers so we can identify cert-sourced files in the Document Library
        # (and so cert-delete can safely cascade).
        "uploaded_via": "worker_certification",
        "worker_id": worker_id,
        "worker_name": worker_label,
        "deleted_at": None,
    }
    await db.doc_files.insert_one(file_doc)

    cert_name = Path(file.filename or stored_name).stem[:160] or "Certification"
    cert_doc = {
        "id": new_id(), "org_id": user["org_id"], "worker_id": worker_id,
        "name": cert_name,
        "issuer": "", "issue_date": None, "expiry_date": None,
        "doc_file_id": file_doc["id"],
        "doc_folder_id": folder["id"],
        "notes": "",
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.worker_certifications.insert_one(cert_doc)

    return {
        "ok": True,
        "cert": _serialise_cert(cert_doc),
        "file": _serialise_file(file_doc),
        "folder": {"id": folder["id"], "name": folder["name"]},
    }


# ────────────────────── Global view (for Phase 2 page) ──────────────────────

@router.get("/certifications/all")
async def list_all_certs(user: dict = Depends(get_current_user)):
    """Returns ALL certs across the org, each enriched with worker name."""
    today = date.today()
    cursor = db.worker_certifications.find(
        {"org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    ).sort([("expiry_date", 1)])
    certs = await cursor.to_list(5000)
    worker_ids = list({c["worker_id"] for c in certs})
    worker_map: dict = {}
    if worker_ids:
        async for w in db.workers.find(
            {"id": {"$in": worker_ids}, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1},
        ):
            worker_map[w["id"]] = w
    out = []
    for c in certs:
        w = worker_map.get(c["worker_id"]) or {}
        row = _serialise_cert(c, today)
        row["worker_first_name"] = w.get("first_name", "")
        row["worker_last_name"] = w.get("last_name", "")
        out.append(row)
    return out
