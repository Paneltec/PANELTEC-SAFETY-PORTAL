"""Document Library — predefined folders + file uploads.

Web-only for this turn. Files land in `/app/backend/uploads/document_library/{folder_id}/`.
Serve via the shared `/api/files/document_library/{folder_id}/{name}` route in
`dashboard.py`.

Write endpoints (create folder / rename / delete folder / upload / delete file)
are gated to roles `admin` and `hseq_lead`. The Uncategorised folder is
non-deletable and seeded automatically.
"""
from __future__ import annotations
import re
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/document-library", tags=["document-library"])

UPLOAD_DIR = Path(__file__).parent / "uploads" / "document_library"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

WRITE_ROLES = {"admin", "hseq_lead"}
DELETE_FOLDER_ROLES = {"admin"}
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB

ALLOWED_EXTS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".png", ".jpg", ".jpeg", ".txt", ".csv",
}
ALLOWED_MIMES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png", "image/jpeg",
    "text/plain", "text/csv",
}

PASTEL_CYCLE = ["mint", "sky", "peach", "blush", "lavender", "butter", "sage", "coral", "lilac"]

# Order matters — controls default sort_order on seed.
DEFAULT_FOLDERS = [
    "Alcohol & Drug Screening", "Asbestos", "Audits", "Australian Standards",
    "Barriers", "BYDA (Before You Dig)", "Calibration Certificates",
    "Carbon Reduction", "CCF (Civil Contractors Federation)", "Checklists",
    "Chemical Storage & Handling", "CodeSafe", "Committees & Memberships",
    "Competencies Matrices", "Confined Space", "Contract Management",
    "Electrical Safety", "Emergency Management", "Environmental Management",
    "First Aid", "Forms", "Working at Heights", "Hot Work", "Incident Reports",
    "Inductions", "Insurance", "ITPs (Inspection & Test Plans)",
    "JSEA / Risk Assessments", "Licences & Tickets", "Manuals & Procedures",
    "Permits to Work", "Plant & Equipment", "Company Policies", "PPE",
    "Procurement", "Rehabilitation & RTW", "Reports",
    "SDS (Safety Data Sheets)", "Site Management", "Subcontractor Management",
    "SWMS", "Toolbox Talks", "Traffic Management", "Training Records",
    "WHS Acts & Regulations",
]
UNCATEGORISED = "Uncategorised"


def _require(user: dict, roles: set, action: str = "edit"):
    if user.get("role") not in roles:
        raise HTTPException(403, f"Permission denied: document_library.{action}")


def _serialise_folder(doc: dict, file_count: int = 0, subfolder_count: int = 0) -> dict:
    return {
        "id": doc["id"],
        "name": doc["name"],
        "color_key": doc.get("color_key") or "sky",
        "sort_order": doc.get("sort_order", 0),
        "is_system": bool(doc.get("is_system")),
        "file_count": file_count,
        "subfolder_count": subfolder_count,
        "parent_folder_id": doc.get("parent_folder_id"),
        "worker_id": doc.get("worker_id"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


def _serialise_file(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "folder_id": doc["folder_id"],
        "filename": doc["filename"],
        "mime": doc.get("mime"),
        "size": doc.get("size", 0),
        "file_url": doc.get("file_url"),
        "uploaded_by": doc.get("uploaded_by"),
        "uploaded_by_name": doc.get("uploaded_by_name"),
        "uploaded_at": doc.get("uploaded_at"),
        "ai_tags": doc.get("ai_tags") or [],
    }


async def _seed_default_folders(org_id: str, created_by: str) -> None:
    has_any = await db.doc_folders.find_one(
        {"org_id": org_id, "deleted_at": None}, {"_id": 1}
    )
    if has_any:
        return
    docs = []
    for i, name in enumerate(DEFAULT_FOLDERS):
        docs.append({
            "id": new_id(), "org_id": org_id, "name": name,
            "color_key": PASTEL_CYCLE[i % len(PASTEL_CYCLE)],
            "sort_order": (i + 1) * 10,
            "is_system": False,
            "created_at": now_iso(), "updated_at": now_iso(),
            "created_by": created_by, "deleted_at": None,
        })
    # Uncategorised — system folder, always last, neutral colour.
    docs.append({
        "id": new_id(), "org_id": org_id, "name": UNCATEGORISED,
        "color_key": "slate",
        "sort_order": (len(DEFAULT_FOLDERS) + 1) * 10,
        "is_system": True,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": created_by, "deleted_at": None,
    })
    await db.doc_folders.insert_many(docs)


async def _file_counts(org_id: str) -> dict:
    """Return {folder_id: count} for non-deleted files."""
    pipeline = [
        {"$match": {"org_id": org_id, "deleted_at": None}},
        {"$group": {"_id": "$folder_id", "n": {"$sum": 1}}},
    ]
    out: dict = {}
    async for row in db.doc_files.aggregate(pipeline):
        out[row["_id"]] = row["n"]
    return out


# ────────────────────── Folders ──────────────────────

class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color_key: Optional[str] = Field(default=None, max_length=20)


class FolderPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    color_key: Optional[str] = Field(default=None, max_length=20)
    sort_order: Optional[int] = Field(default=None, ge=0, le=1000000)


@router.get("/folders")
async def list_folders(user: dict = Depends(get_current_user)):
    """Top-level folders only. Per-worker subfolders (created via the
    Worker Certifications upload flow) are returned via
    `GET /folders/{id}/subfolders`."""
    await _seed_default_folders(user["org_id"], user["id"])
    cursor = db.doc_folders.find(
        {"org_id": user["org_id"], "deleted_at": None,
         "$or": [{"parent_folder_id": None}, {"parent_folder_id": {"$exists": False}}]},
        {"_id": 0},
    ).sort([("sort_order", 1), ("name", 1)])
    folders = await cursor.to_list(500)
    counts = await _file_counts(user["org_id"])
    # Sub-folder counts so the UI can decorate "N subfolders" if it wants.
    sub_pipeline = [
        {"$match": {"org_id": user["org_id"], "deleted_at": None,
                    "parent_folder_id": {"$ne": None}}},
        {"$group": {"_id": "$parent_folder_id", "n": {"$sum": 1}}},
    ]
    sub_counts: dict = {}
    async for row in db.doc_folders.aggregate(sub_pipeline):
        sub_counts[row["_id"]] = row["n"]
    return [
        _serialise_folder(f, counts.get(f["id"], 0), sub_counts.get(f["id"], 0))
        for f in folders
    ]


@router.get("/folders/{folder_id}/subfolders")
async def list_subfolders(folder_id: str, user: dict = Depends(get_current_user)):
    """Children of a single folder (used by the Document Library to navigate
    into per-worker certification folders)."""
    parent = await db.doc_folders.find_one(
        {"id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not parent:
        raise HTTPException(404, "Folder not found")
    cursor = db.doc_folders.find(
        {"org_id": user["org_id"], "parent_folder_id": folder_id, "deleted_at": None},
        {"_id": 0},
    ).sort([("name", 1)])
    children = await cursor.to_list(2000)
    counts = await _file_counts(user["org_id"])
    return {
        "parent": _serialise_folder(parent, counts.get(parent["id"], 0)),
        "children": [_serialise_folder(c, counts.get(c["id"], 0)) for c in children],
    }


@router.post("/folders", status_code=201)
async def create_folder(body: FolderIn, user: dict = Depends(get_current_user)):
    _require(user, WRITE_ROLES)
    last = await db.doc_folders.find_one(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "sort_order": 1},
        sort=[("sort_order", -1)],
    )
    next_order = ((last or {}).get("sort_order") or 0) + 10
    color = (body.color_key or PASTEL_CYCLE[next_order // 10 % len(PASTEL_CYCLE)]).strip().lower()
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "name": body.name.strip(), "color_key": color,
        "sort_order": next_order, "is_system": False,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": user["id"], "deleted_at": None,
    }
    await db.doc_folders.insert_one(doc)
    return _serialise_folder(doc, 0)


@router.patch("/folders/{folder_id}")
async def rename_folder(
    folder_id: str, body: FolderPatch, user: dict = Depends(get_current_user),
):
    _require(user, WRITE_ROLES)
    existing = await db.doc_folders.find_one(
        {"id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Folder not found")
    if existing.get("is_system") and body.name is not None:
        raise HTTPException(400, "Cannot rename the system folder")
    update: dict = {"updated_at": now_iso()}
    if body.name is not None:
        update["name"] = body.name.strip()
    if body.color_key is not None:
        update["color_key"] = body.color_key.strip().lower()
    if body.sort_order is not None:
        update["sort_order"] = int(body.sort_order)
    if len(update) == 1:
        raise HTTPException(400, "No editable fields supplied")
    result = await db.doc_folders.find_one_and_update(
        {"id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": update},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    counts = await _file_counts(user["org_id"])
    return _serialise_folder(result, counts.get(folder_id, 0))


@router.delete("/folders/{folder_id}", status_code=204)
async def delete_folder(folder_id: str, user: dict = Depends(get_current_user)):
    _require(user, DELETE_FOLDER_ROLES, action="delete")
    existing = await db.doc_folders.find_one(
        {"id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Folder not found")
    if existing.get("is_system"):
        raise HTTPException(400, "Cannot delete the system folder")
    ts = now_iso()
    await db.doc_folders.update_one(
        {"id": folder_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    # Soft-delete all files under it.
    await db.doc_files.update_many(
        {"folder_id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    return None


# ────────────────────── Files ──────────────────────

async def _resolve_folder(folder_id: str, org_id: str) -> dict:
    folder = await db.doc_folders.find_one(
        {"id": folder_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not folder:
        raise HTTPException(404, "Folder not found")
    return folder


def _safe_ext(filename: Optional[str]) -> str:
    ext = (Path(filename or "").suffix or "").lower()
    return ext if ext in ALLOWED_EXTS else ""


# MOCKED: AI tag extraction is a filename-keyword stub for this turn.
# When PDF/DOCX text extraction is wired in, swap this for a Claude call over
# the first ~2000 chars of extracted_text (see plan in ask.py for a pattern).
def _stub_ai_tags(filename: str) -> List[str]:
    stem = Path(filename).stem.lower()
    # Strip dates, version markers and other noise before tokenising.
    cleaned = re.sub(r"[\d_\-\.]+", " ", stem)
    tokens = [t for t in re.split(r"\s+", cleaned) if len(t) >= 3]
    # Dedupe preserving order, cap at 5
    seen, out = set(), []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            out.append(t)
        if len(out) >= 5:
            break
    return out


@router.get("/folders/{folder_id}/files")
async def list_files(folder_id: str, user: dict = Depends(get_current_user)):
    await _resolve_folder(folder_id, user["org_id"])
    cursor = db.doc_files.find(
        {"folder_id": folder_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    ).sort([("uploaded_at", -1)])
    files = await cursor.to_list(500)
    return [_serialise_file(f) for f in files]


@router.post("/folders/{folder_id}/files", status_code=201)
async def upload_files(
    folder_id: str,
    files: List[UploadFile] = File(...),
    user: dict = Depends(get_current_user),
):
    _require(user, WRITE_ROLES, action="upload")
    folder = await _resolve_folder(folder_id, user["org_id"])
    folder_dir = UPLOAD_DIR / folder["id"]
    folder_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    rejected = []
    for upload in files:
        ext = _safe_ext(upload.filename)
        if not ext:
            rejected.append({
                "filename": upload.filename,
                "reason": "Unsupported file type — allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG, TXT, CSV",
            })
            continue
        # Stream to disk while checking size cap.
        stored_name = f"{uuid.uuid4().hex}{ext}"
        target = folder_dir / stored_name
        size = 0
        with target.open("wb") as out:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    out.close()
                    target.unlink(missing_ok=True)
                    rejected.append({"filename": upload.filename, "reason": "Exceeds 50 MB limit"})
                    break
                out.write(chunk)
        if size > MAX_FILE_BYTES:
            continue
        doc = {
            "id": new_id(),
            "org_id": user["org_id"],
            "folder_id": folder["id"],
            "filename": upload.filename or stored_name,
            "stored_name": stored_name,
            "mime": upload.content_type or "application/octet-stream",
            "size": size,
            "file_url": f"/api/files/document_library/{folder['id']}/{stored_name}",
            "uploaded_by": user["id"],
            "uploaded_by_name": user.get("name") or user.get("email"),
            "uploaded_at": now_iso(),
            "updated_at": now_iso(),
            "ai_tags": _stub_ai_tags(upload.filename or stored_name),
            "deleted_at": None,
        }
        await db.doc_files.insert_one(doc)
        saved.append(_serialise_file(doc))

    return {"saved": saved, "rejected": rejected}


@router.delete("/files/{file_id}", status_code=204)
async def delete_file(file_id: str, user: dict = Depends(get_current_user)):
    _require(user, WRITE_ROLES, action="delete")
    ts = now_iso()
    result = await db.doc_files.update_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "File not found")
    return None


@router.get("/files/{file_id}/download")
async def download_file(file_id: str, user: dict = Depends(get_current_user)):
    doc = await db.doc_files.find_one(
        {"id": file_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "File not found")
    path = UPLOAD_DIR / doc["folder_id"] / doc["stored_name"]
    if not path.exists():
        raise HTTPException(404, "File missing on disk")
    return FileResponse(
        str(path),
        media_type=doc.get("mime") or "application/octet-stream",
        filename=doc.get("filename"),
    )


# MOCKED: This is a basic Mongo regex search across filename + ai_tags only.
# Future work: ingest extracted_text (PDF parsing) and switch to a vector RAG
# index for true semantic Smart Search.
@router.get("/search")
async def search(
    q: str = Query(min_length=1, max_length=120),
    user: dict = Depends(get_current_user),
):
    pattern = re.escape(q.strip())
    cursor = db.doc_files.find(
        {
            "org_id": user["org_id"],
            "deleted_at": None,
            "$or": [
                {"filename": {"$regex": pattern, "$options": "i"}},
                {"ai_tags": {"$regex": pattern, "$options": "i"}},
            ],
        },
        {"_id": 0},
    ).sort([("uploaded_at", -1)]).limit(40)
    files = await cursor.to_list(40)
    # Attach folder name for context.
    folder_ids = list({f["folder_id"] for f in files})
    folder_map: dict = {}
    if folder_ids:
        async for fd in db.doc_folders.find(
            {"id": {"$in": folder_ids}, "org_id": user["org_id"]},
            {"_id": 0, "id": 1, "name": 1, "color_key": 1},
        ):
            folder_map[fd["id"]] = fd
    results = []
    for f in files:
        results.append({
            **_serialise_file(f),
            "folder": folder_map.get(f["folder_id"]),
        })
    return {"query": q, "count": len(results), "results": results}



# ────────────────────── Supplier-scoped folders ──────────────────────
# Sibling routes that filter `doc_folders` by `supplier_id`. Files reuse the
# main `/api/document-library/folders/{id}/files` endpoints — once a folder
# exists, supplier scoping is just a query filter on the listing side.

from fastapi import APIRouter as _AR

supplier_folders_router = _AR(prefix="/suppliers", tags=["supplier-folders"])


@supplier_folders_router.get("/{supplier_id}/folders")
async def supplier_list_folders(supplier_id: str, user: dict = Depends(get_current_user)):
    cursor = db.doc_folders.find(
        {"org_id": user["org_id"], "supplier_id": supplier_id, "deleted_at": None},
        {"_id": 0},
    ).sort([("sort_order", 1), ("name", 1)])
    folders = await cursor.to_list(500)
    counts = await _file_counts(user["org_id"])
    return [_serialise_folder(f, counts.get(f["id"], 0)) for f in folders]


@supplier_folders_router.post("/{supplier_id}/folders", status_code=201)
async def supplier_create_folder(
    supplier_id: str, body: FolderIn, user: dict = Depends(get_current_user),
):
    _require(user, WRITE_ROLES)
    last = await db.doc_folders.find_one(
        {"org_id": user["org_id"], "supplier_id": supplier_id, "deleted_at": None},
        {"_id": 0, "sort_order": 1},
        sort=[("sort_order", -1)],
    )
    next_order = ((last or {}).get("sort_order") or 0) + 10
    color = (body.color_key or PASTEL_CYCLE[next_order // 10 % len(PASTEL_CYCLE)]).strip().lower()
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "supplier_id": supplier_id,
        "name": body.name.strip(), "color_key": color,
        "sort_order": next_order, "is_system": False,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": user["id"], "deleted_at": None,
    }
    await db.doc_folders.insert_one(doc)
    return _serialise_folder(doc, 0)


async def supplier_folder_file_counts(org_id: str) -> dict:
    """Total file count grouped by supplier_id (for the Folders chip badge)."""
    pipeline = [
        {"$match": {"org_id": org_id, "deleted_at": None,
                    "supplier_id": {"$exists": True, "$ne": None}}},
        {"$lookup": {
            "from": "doc_files",
            "let": {"fid": "$id"},
            "pipeline": [
                {"$match": {"$expr": {"$and": [
                    {"$eq": ["$folder_id", "$$fid"]},
                    {"$eq": ["$deleted_at", None]},
                ]}}},
                {"$count": "n"},
            ],
            "as": "files",
        }},
        {"$group": {
            "_id": "$supplier_id",
            "n": {"$sum": {"$ifNull": [{"$arrayElemAt": ["$files.n", 0]}, 0]}},
        }},
    ]
    out: dict = {}
    async for row in db.doc_folders.aggregate(pipeline):
        if row["_id"]:
            out[row["_id"]] = row["n"]
    return out
