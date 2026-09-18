"""Worker Certifications — Phase 1+2.

Phase 1: identity + status derivation + Document Library upload.
Phase 2 additions:
  - Smart folder routing (cert name → matching seed folder by keyword).
  - Per-worker subfolder inside the matched folder (Workers/{First Last}).
  - Send-Reminder endpoint (email via M365 outbox + SMS via TextMagic).
  - Background reminder scheduler (30/14/7/1 days + day-of + weekly post-expiry).
  - Idempotent send dedupe (cert_reminders_sent collection).
"""
from __future__ import annotations
import logging
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument

from auth import get_current_user
from db import db
from models import new_id, now_iso
from permissions import require_permission, resolve_team_scope, require_module
from document_library import (
    MAX_FILE_BYTES, UPLOAD_DIR, _safe_ext, _serialise_file, _stub_ai_tags,
)

log = logging.getLogger("paneltec.worker_certs")
# v58.13.88 lint sweep — `require_permission` was imported twice (line 25 and
# line 31 pre-sweep). Consolidated into the single import above. The extra
# symbols the second line added (`resolve_team_scope`, `require_module`) are
# kept on the consolidated line.
from permissions_scope import require_scoped_access  # v160.3.9.44 (P0-IDOR)

router = APIRouter(
    prefix="/workers", tags=["worker-certifications"],
    dependencies=[Depends(require_module("certifications"))],  # v160.0.9
)

# v160.3.7ai — Second router for org-level cert operations that live
# OUTSIDE the `/workers` prefix. Right now it hosts the bulk
# `clear-pending-review` action; future org-scoped bulk ops belong
# here too (bulk-reassign, bulk-recategorise, etc.).
certs_router = APIRouter(
    prefix="/certifications", tags=["certifications"],
    dependencies=[Depends(require_module("certifications"))],
)

WRITE_ROLES = {"admin", "hseq_lead"}
DEFAULT_FOLDER_NAME = "Licences & Tickets"
FALLBACK_FOLDER_NAME = "Uncategorised"
EXPIRING_SOON_DAYS = 30
ISO_DATE_RE = r"^\d{4}-\d{2}-\d{2}$"

# Keyword → seed folder mapping. First match (lowercased substring) wins.
# Ordered so longer/more-specific keywords resolve first.
CERT_FOLDER_KEYWORDS: list[tuple[str, str]] = [
    ("data sheet", "SDS (Safety Data Sheets)"),
    ("safety data", "SDS (Safety Data Sheets)"),
    ("sds", "SDS (Safety Data Sheets)"),
    ("alcohol", "Alcohol & Drug Screening"),
    ("drug", "Alcohol & Drug Screening"),
    ("first aid", "First Aid"),
    ("confined space", "Confined Space"),
    ("working at heights", "Working at Heights"),
    ("heights", "Working at Heights"),
    ("hot work", "Hot Work"),
    ("hot-work", "Hot Work"),
    ("white card", "Inductions"),
    ("induction", "Inductions"),
    ("ppe", "PPE"),
    ("calibration", "Calibration Certificates"),
    ("swms", "SWMS"),
    ("competencies", "Competencies Matrices"),
    ("competency", "Competencies Matrices"),
    ("competence", "Competencies Matrices"),
    ("training", "Training Records"),
    ("asbestos", "Asbestos"),
    ("byda", "BYDA (Before You Dig)"),
    ("before you dig", "BYDA (Before You Dig)"),
    ("electrical", "Electrical Safety"),
    ("permit", "Permits to Work"),
    ("audit", "Audits"),
    ("checklist", "Checklists"),
    ("traffic", "Traffic Management"),
    ("plant", "Plant & Equipment"),
    ("equipment", "Plant & Equipment"),
    ("chemical", "Chemical Storage & Handling"),
    ("rehabilitation", "Rehabilitation & RTW"),
    ("return to work", "Rehabilitation & RTW"),
    ("insurance", "Insurance"),
    ("policy", "Company Policies"),
    ("policies", "Company Policies"),
    ("itp", "ITPs (Inspection & Test Plans)"),
    ("inspection", "ITPs (Inspection & Test Plans)"),
    ("jsea", "JSEA / Risk Assessments"),
    ("risk assessment", "JSEA / Risk Assessments"),
    ("environmental", "Environmental Management"),
    ("emergency", "Emergency Management"),
    ("toolbox", "Toolbox Talks"),
    ("manual", "Manuals & Procedures"),
    ("procedure", "Manuals & Procedures"),
    ("licence", "Licences & Tickets"),
    ("license", "Licences & Tickets"),
    ("ticket", "Licences & Tickets"),
]


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


def _match_folder_name(cert_name: str) -> str:
    # Normalise so filenames like "First_Aid_Cert" and "Hot-Work" match the
    # same keywords as "First Aid Card".
    lower = (cert_name or "").lower().replace("_", " ").replace("-", " ")
    for kw, target in CERT_FOLDER_KEYWORDS:
        if kw in lower:
            return target
    return DEFAULT_FOLDER_NAME


async def _resolve_seed_folder(org_id: str, name: str, created_by: str) -> dict:
    """Find the canonical seed folder by name (top-level only)."""
    folder = await db.doc_folders.find_one(
        {"org_id": org_id, "name": name, "deleted_at": None,
         "supplier_id": {"$exists": False},
         "$or": [{"parent_folder_id": None}, {"parent_folder_id": {"$exists": False}}]},
        {"_id": 0},
        sort=[("created_at", 1)],
    )
    if folder:
        return folder
    # Last resort: fall back to "Licences & Tickets" then Uncategorised.
    for fb in (DEFAULT_FOLDER_NAME, FALLBACK_FOLDER_NAME):
        folder = await db.doc_folders.find_one(
            {"org_id": org_id, "name": fb, "deleted_at": None,
             "supplier_id": {"$exists": False},
             "$or": [{"parent_folder_id": None}, {"parent_folder_id": {"$exists": False}}]},
            {"_id": 0},
            sort=[("created_at", 1)],
        )
        if folder:
            return folder
    # Bare-bones create.
    doc = {
        "id": new_id(), "org_id": org_id, "name": FALLBACK_FOLDER_NAME,
        "color_key": "slate", "sort_order": 999000, "is_system": True,
        "parent_folder_id": None,
        "created_at": now_iso(), "updated_at": now_iso(),
        "created_by": created_by, "deleted_at": None,
    }
    await db.doc_folders.insert_one(doc)
    return doc


async def _find_or_create_worker_subfolder(
    parent: dict, worker: dict, created_by: str,
) -> dict:
    label = (
        f"{worker.get('first_name', '')} {worker.get('last_name', '')}".strip()
        or "Unnamed worker"
    )
    existing = await db.doc_folders.find_one(
        {"org_id": parent["org_id"], "parent_folder_id": parent["id"],
         "name": label, "deleted_at": None},
        {"_id": 0},
        sort=[("created_at", 1)],
    )
    if existing:
        return existing
    doc = {
        "id": new_id(), "org_id": parent["org_id"], "name": label,
        "parent_folder_id": parent["id"],
        "worker_id": worker["id"],
        "color_key": parent.get("color_key") or "sky",
        "sort_order": (parent.get("sort_order") or 0) + 1,
        "is_system": False,
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
    if not cert.get("doc_file_id"):
        return {"key": "missing_file", "label": "Missing file", "days": None}
    expiry = _parse_iso(cert.get("expiry_date"))
    if expiry is None:
        # v58.13.111a — Copy fix. Previously EVERY null-expiry cert was
        # labelled "No expiry", which reads as "this cert genuinely
        # never expires" and hid rows where the admin had simply left
        # the field blank. Now: `held_no_expiry=True` (the induction-
        # style opt-in flag) still reads "No expiry"; every other null-
        # expiry row reads "Expiry not set" so it's obvious the admin
        # needs to add a date. Filter-chip key stays `no_expiry` so
        # existing chip filters + counts don't drift; only the row-
        # level label changes.
        if cert.get("held_no_expiry") is True:
            return {"key": "no_expiry", "label": "No expiry", "days": None}
        return {"key": "no_expiry", "label": "Expiry not set", "days": None}
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
    # v58.13.132ic — Optional category so the FE Licences / Inductions
    # tabs can persist their filter dimension when creating a new row.
    # Accepted values mirror `induction_columns.py`:
    #   `site_induction` · `competency` · `license` · `general`.
    # None → the row inherits whatever the `_match_folder_name` /
    # cert-kind classifier resolves at query time (backward compat).
    category: Optional[str] = Field(default=None, max_length=32)

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
    # v58.13.132ic — Allow reclassifying an existing cert between the
    # Certifications / Licences / Inductions tabs.
    category: Optional[str] = Field(default=None, max_length=32)

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
    # v160.0.8 — scope check: non-privileged callers may only view their
    # OWN worker row's certifications. Match by linked user_id or email.
    role_key = (user.get("role") or "").lower()
    privileged = role_key in {"admin", "hseq_lead", "supervisor"}
    if not privileged:
        me = await db.workers.find_one(
            {"org_id": user["org_id"], "deleted_at": None,
             "$or": [{"user_id": user["id"]},
                     {"email": (user.get("email") or "").lower()}]},
            {"_id": 0, "id": 1},
        )
        if not me or me.get("id") != worker_id:
            raise HTTPException(status_code=403,
                                detail="Permission denied: certifications.team_view")
    today = date.today()

    # v58.13.132ie — Auto-archive sweep. Any row with `expiry_date <
    # today` AND `archived_at IS NULL` AND `deleted_at IS NULL` is
    # flipped to `archived_at = now()` before we serialise the list.
    # Idempotent (re-runs are cheap: the second update matches 0 docs)
    # and scoped to this worker so the write blast radius is bounded.
    # Doing this on-fetch keeps the "user opens a worker → expired
    # rows drop into the Archived section" contract without needing
    # a cron.
    today_iso = today.isoformat()
    await db.worker_certifications.update_many(
        {
            "org_id": user["org_id"], "worker_id": worker_id,
            "deleted_at": None,
            "archived_at": None,
            "expiry_date": {"$lt": today_iso, "$ne": None},
        },
        {"$set": {"archived_at": now_iso(), "archived_reason": "auto_expired"}},
    )

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
        "doc_seed_folder": _match_folder_name(body.name),
        "notes": (body.notes or "").strip(),
        # v58.13.132ic — Persist FE-supplied category so the row lands
        # on the correct profile tab. Only accept known values;
        # everything else drops to None (backward compat).
        "category": (body.category
                     if body.category in ("site_induction", "competency",
                                           "license", "general")
                     else None),
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
    # v160.3.9.44 (P0-IDOR) — explicit contractor-scope gate.
    # Cert docs don't carry `company_id` directly; look up the parent
    # worker and pass THAT to `require_scoped_access`. Fail with 404
    # on scope-mismatch to avoid an existence leak.
    existing = await db.worker_certifications.find_one(
        {"id": cert_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Certification not found")
    parent_worker = await db.workers.find_one(
        {"id": existing.get("worker_id"), "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "company_id": 1, "user_id": 1, "email": 1},
    )
    require_scoped_access(user, "workers", parent_worker)
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not payload:
        raise HTTPException(400, "No fields supplied")
    # If name changed, recompute `doc_seed_folder` so the dashboard reflects
    # where future uploads would land. The file itself is NOT moved.
    if "name" in payload:
        payload["doc_seed_folder"] = _match_folder_name(payload["name"])
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
async def delete_cert(
    cert_id: str,
    user: dict = Depends(require_permission("certifications", "delete")),
):
    # Phase 3.18 — auth now flows through the permissions matrix so admins can
    # delegate cert-delete to specific HSEQ Leads via per-user override
    # without changing role membership.
    # v160.3.9.44 (P0-IDOR) — explicit contractor-scope gate.
    existing = await db.worker_certifications.find_one(
        {"id": cert_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Certification not found")
    parent_worker = await db.workers.find_one(
        {"id": existing.get("worker_id"), "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "company_id": 1, "user_id": 1, "email": 1},
    )
    from permissions_scope import require_scoped_access
    require_scoped_access(user, "workers", parent_worker)
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
    # v58.13.132fj — archive_audit trail.
    from archive_audit_helpers import record_file_archive_audit
    await record_file_archive_audit(
        module="certifications", resource="worker_certifications",
        resource_id=cert_id,
        filename=existing.get("name") or existing.get("filename"),
        worker_id=existing.get("worker_id"),
        user=user,
    )
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


# v58.13.132ie — Archived subfolder: manual archive / restore endpoints.
#
# `archived_at` semantic is distinct from `deleted_at`:
#   · deleted_at → soft-delete, 30-day audit trail, hidden by default,
#                  restored via the archive dialog.
#   · archived_at → "expired but preserved", visible in the collapsible
#                  Archived section of each cert-family tab, restored
#                  in-place. Set automatically by the on-fetch sweep
#                  in `list_certs` when `expiry_date < today`, or
#                  manually via this endpoint.
async def _archive_gate(cert_id: str, user: dict) -> dict:
    """Common lookup + scope check for archive + restore. Returns
    the resolved cert doc; raises 404 on scope-miss + 404 on missing."""
    existing = await db.worker_certifications.find_one(
        {"id": cert_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Certification not found")
    parent_worker = await db.workers.find_one(
        {"id": existing.get("worker_id"), "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "company_id": 1, "user_id": 1, "email": 1},
    )
    require_scoped_access(user, "workers", parent_worker)
    return existing


@router.post("/certifications/{cert_id}/archive")
async def archive_cert(
    cert_id: str,
    user: dict = Depends(require_permission("certifications", "edit")),
):
    """Manual archive — flips `archived_at` to now(). Idempotent: if
    the row is already archived the timestamp is refreshed."""
    await _archive_gate(cert_id, user)
    ts = now_iso()
    await db.worker_certifications.update_one(
        {"id": cert_id, "org_id": user["org_id"]},
        {"$set": {"archived_at": ts, "archived_reason": "manual",
                  "archived_by": user["id"], "updated_at": ts}},
    )
    row = await db.worker_certifications.find_one(
        {"id": cert_id, "org_id": user["org_id"]}, {"_id": 0},
    )
    return _serialise_cert(row)


@router.post("/certifications/{cert_id}/restore")
async def restore_cert(
    cert_id: str,
    user: dict = Depends(require_permission("certifications", "edit")),
):
    """Restore an archived cert back to active. Clears `archived_at`
    + related metadata. Row keeps its expiry_date — a restored+expired
    row will re-archive on next list fetch unless the user also
    updates the expiry."""
    await _archive_gate(cert_id, user)
    ts = now_iso()
    await db.worker_certifications.update_one(
        {"id": cert_id, "org_id": user["org_id"]},
        {"$set": {"archived_at": None, "archived_reason": None,
                  "archived_by": None, "updated_at": ts}},
    )
    row = await db.worker_certifications.find_one(
        {"id": cert_id, "org_id": user["org_id"]}, {"_id": 0},
    )
    return _serialise_cert(row)


# ────────────────────── Upload ──────────────────────

@router.post("/{worker_id}/certifications/upload", status_code=201)
async def upload_cert_file(
    worker_id: str,
    file: UploadFile = File(...),
    # v58.13.132ic — Optional category hint from the FE Licences /
    # Inductions tabs so the newly-created cert row lands on the
    # correct profile tab immediately (not just via filename
    # heuristic on next load).
    category: Optional[str] = Form(default=None),
    user: dict = Depends(get_current_user),
):
    _require_write(user, action="upload")
    worker = await _require_worker(worker_id, user["org_id"])

    ext = _safe_ext(file.filename)
    if not ext:
        raise HTTPException(
            400,
            "Unsupported file type — allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG, TXT, CSV",
        )

    # Smart routing: filename stem → seed folder.
    # v58.13.132fl — Skip the per-worker subfolder layer. Stephen's
    # brief: "Document Library is meant to be shared across the
    # whole team, not per-worker". The cert record still carries
    # worker_id (via `worker_certifications`) so per-worker
    # attribution is preserved without polluting the shared
    # library tree with per-person subfolders. The subfolder
    # helper `_find_or_create_worker_subfolder` is kept for
    # backwards compatibility but no longer called from the
    # cert-upload path.
    cert_name = Path(file.filename or "").stem[:160] or "Certification"
    seed_name = _match_folder_name(cert_name)
    seed_folder = await _resolve_seed_folder(user["org_id"], seed_name, user["id"])
    sub_folder = seed_folder

    stored_name = f"{uuid.uuid4().hex}{ext}"
    # v58.13.132gh — Bytes → GridFS under `document_library/<folder>/`
    # so the shared `_serve_async` reader picks them up.
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_FILE_BYTES:
            raise HTTPException(400, "Exceeds 50 MB limit")
    size = len(buf)
    from uploads_storage import save_upload as _save_cert  # noqa: WPS433
    await _save_cert(
        "document_library", [sub_folder["id"], stored_name], bytes(buf),
        module="worker_certifications",
        org_id=user["org_id"],
        mime=file.content_type,
        orig_filename=file.filename,
    )

    worker_label = f"{worker.get('first_name', '')} {worker.get('last_name', '')}".strip() or "(unnamed)"
    file_doc = {
        "id": new_id(),
        "org_id": user["org_id"],
        "folder_id": sub_folder["id"],
        "filename": file.filename or stored_name,
        "stored_name": stored_name,
        "mime": file.content_type or "application/octet-stream",
        "size": size,
        "file_url": f"/api/files/document_library/{sub_folder['id']}/{stored_name}",
        "uploaded_by": user["id"],
        "uploaded_by_name": user.get("name") or user.get("email"),
        "uploaded_at": now_iso(),
        "updated_at": now_iso(),
        "ai_tags": _stub_ai_tags(file.filename or stored_name) + [f"worker:{worker_label}"],
        "uploaded_via": "worker_certification",
        "worker_id": worker_id,
        "worker_name": worker_label,
        "seed_folder": seed_folder["name"],
        "deleted_at": None,
    }
    await db.doc_files.insert_one(file_doc)

    cert_doc = {
        "id": new_id(), "org_id": user["org_id"], "worker_id": worker_id,
        "name": cert_name,
        "issuer": "", "issue_date": None, "expiry_date": None,
        "doc_file_id": file_doc["id"],
        "doc_folder_id": sub_folder["id"],
        "doc_seed_folder": seed_folder["name"],
        "notes": "",
        # v58.13.132ic — Persist FE-supplied category so Licences /
        # Inductions upload lands on the correct tab.
        "category": (category
                     if category in ("site_induction", "competency",
                                      "license", "general")
                     else None),
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.worker_certifications.insert_one(cert_doc)

    return {
        "ok": True,
        "cert": _serialise_cert(cert_doc),
        "file": _serialise_file(file_doc),
        "folder": {"id": sub_folder["id"], "name": sub_folder["name"],
                   "parent_id": seed_folder["id"], "parent_name": seed_folder["name"]},
    }


# v58.13.79 — Attach a file to an EXISTING certification row.
#
# The pre-.79 upload flow (`POST /workers/{worker_id}/certifications/upload`)
# always CREATES a new cert row using the filename stem as the cert
# `name`. That made sense for the drop-zone but broke the very common
# "here's the image for my existing First Aid ticket" workflow:
#
#   Before this ship the user tried to attach a photo of their First
#   Aid ticket to the pre-existing Simpro-imported "First Aid" cert
#   row (which had `doc_file_id: None`). The upload succeeded but
#   created a brand-new row named after the raw phone filename
#   (e.g. "134098955674089059"), leaving the "First Aid" row still
#   file-less. The image looked disconnected from any known cert
#   type — matching the field-report verbatim
#   "disappeared and not connected to any particular type".
#
# This endpoint fixes that by PATCHING the existing cert row with
# the new file id (never creates a second row). Idempotent
# semantics: if the cert already has a file, the previous
# `doc_files` row is soft-deleted so we don't leak orphan files.
@router.post("/{worker_id}/certifications/{cert_id}/upload", status_code=200)
async def attach_cert_file(
    worker_id: str,
    cert_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    _require_write(user, action="upload")
    worker = await _require_worker(worker_id, user["org_id"])

    existing = await db.worker_certifications.find_one(
        {"id": cert_id, "worker_id": worker_id, "org_id": user["org_id"],
         "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Certification not found")

    ext = _safe_ext(file.filename)
    if not ext:
        raise HTTPException(
            400,
            "Unsupported file type — allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG, TXT, CSV",
        )

    # Prefer the folder classified from the EXISTING cert name so the
    # file lands next to metadata that already exists. Only fall back
    # to filename-derived classification when the cert `name` is
    # blank (shouldn't happen — model enforces min_length=1).
    seed_name = _match_folder_name(existing.get("name") or file.filename or "")
    seed_folder = await _resolve_seed_folder(user["org_id"], seed_name, user["id"])
    # v58.13.132fl — Skip per-worker subfolder layer (see note above).
    sub_folder = seed_folder

    stored_name = f"{uuid.uuid4().hex}{ext}"
    # v58.13.132gh — Bytes → GridFS under `document_library/<folder>/`.
    # Same pattern as `upload_cert_file` above; shared `_serve_async`
    # reader picks them up post-migration.
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_FILE_BYTES:
            raise HTTPException(400, "Exceeds 50 MB limit")
    size = len(buf)
    from uploads_storage import save_upload as _save_cert  # noqa: WPS433
    await _save_cert(
        "document_library", [sub_folder["id"], stored_name], bytes(buf),
        module="worker_certifications",
        org_id=user["org_id"],
        mime=file.content_type,
        orig_filename=file.filename,
    )

    worker_label = f"{worker.get('first_name', '')} {worker.get('last_name', '')}".strip() or "(unnamed)"
    file_doc = {
        "id": new_id(),
        "org_id": user["org_id"],
        "folder_id": sub_folder["id"],
        "filename": file.filename or stored_name,
        "stored_name": stored_name,
        "mime": file.content_type or "application/octet-stream",
        "size": size,
        "file_url": f"/api/files/document_library/{sub_folder['id']}/{stored_name}",
        "uploaded_by": user["id"],
        "uploaded_by_name": user.get("name") or user.get("email"),
        "uploaded_at": now_iso(),
        "updated_at": now_iso(),
        "ai_tags": _stub_ai_tags(file.filename or stored_name) + [f"worker:{worker_label}"],
        "uploaded_via": "worker_certification",
        "worker_id": worker_id,
        "worker_name": worker_label,
        "seed_folder": seed_folder["name"],
        "deleted_at": None,
    }
    await db.doc_files.insert_one(file_doc)

    # Soft-delete the old file row so the cert never carries a stale
    # doc_file_id reference and we don't leak disk usage.
    old_file_id = existing.get("doc_file_id")
    if old_file_id:
        await db.doc_files.update_one(
            {"id": old_file_id, "org_id": user["org_id"]},
            {"$set": {"deleted_at": now_iso(),
                       "deleted_by": user["id"],
                       "deleted_reason": "replaced by /certifications/{id}/upload"}},
        )

    updated = await db.worker_certifications.find_one_and_update(
        {"id": cert_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {
            "doc_file_id": file_doc["id"],
            "doc_folder_id": sub_folder["id"],
            "doc_seed_folder": seed_folder["name"],
            "updated_at": now_iso(),
        }},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        # Extremely unlikely — cert existed at the top of the handler.
        # If we lost the race, hard-tombstone the file row so nothing
        # dangles.
        await db.doc_files.update_one(
            {"id": file_doc["id"]},
            {"$set": {"deleted_at": now_iso(),
                       "deleted_reason": "attach-race: parent cert vanished"}},
        )
        raise HTTPException(409, "Certification was deleted while attaching the file")

    return {
        "ok": True,
        "cert": _serialise_cert(updated),
        "file": _serialise_file(file_doc),
        "folder": {"id": sub_folder["id"], "name": sub_folder["name"],
                   "parent_id": seed_folder["id"], "parent_name": seed_folder["name"]},
    }


# ────────────────────── Global view + search ──────────────────────

@router.get("/certifications/all")
async def list_all_certs(
    scope: Optional[str] = None,
    as_role: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    today = date.today()
    q: dict = {"org_id": user["org_id"], "deleted_at": None}
    # v159.1 — scope resolution:
    #   • Privileged roles (admin/hseq_lead/supervisor) may pass
    #     `?scope=me` to opt into "just my own certs".
    #   • ALL other roles (worker/contractor/auditor/etc.) are FORCED to
    #     scope=me regardless of the query string — a worker can never
    #     enumerate their colleagues' certifications from this endpoint.
    # v160.0.6 — defense in depth for preview-as-worker:
    #   Web admin's Live Preview iframe passes `?as_role=worker`. When an
    #   otherwise-privileged caller passes a non-privileged `as_role`,
    #   we downgrade `privileged` so the endpoint returns just the
    #   caller's own row — matching what the real worker would see.
    role_key = (user.get("role") or "").lower()
    privileged = role_key in {"admin", "hseq_lead", "supervisor"}
    if privileged and as_role:
        ar = as_role.lower()
        if ar and ar not in {"admin", "hseq_lead", "supervisor"}:
            privileged = False
    effective_scope = scope if privileged else "me"
    if effective_scope == "me":
        me = await db.workers.find_one(
            {"org_id": user["org_id"], "deleted_at": None,
             "$or": [{"user_id": user["id"]},
                     {"email": (user.get("email") or "").lower()}]},
            {"_id": 0, "id": 1},
        )
        q["worker_id"] = (me or {}).get("id") or "__no_match__"
    cursor = db.worker_certifications.find(q, {"_id": 0}).sort([("expiry_date", 1)])
    certs = await cursor.to_list(5000)
    worker_ids = list({c["worker_id"] for c in certs})
    worker_map: dict = {}
    if worker_ids:
        async for w in db.workers.find(
            {"id": {"$in": worker_ids}, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "mobile": 1, "email": 1},
        ):
            worker_map[w["id"]] = w
    # v58.13.111 — join doc_files so we can surface `preview_broken` +
    # `preview_broken_reason` per cert (audit script flags stubs so the
    # UI can show "Preview unavailable — please re-upload" without
    # attempting the 415-triggering /pdf fetch).
    file_ids = [c.get("doc_file_id") for c in certs if c.get("doc_file_id")]
    file_flags: dict = {}
    if file_ids:
        async for f in db.doc_files.find(
            {"id": {"$in": file_ids}},
            {"_id": 0, "id": 1, "preview_broken": 1, "preview_broken_reason": 1},
        ):
            file_flags[f["id"]] = f
    out = []
    for c in certs:
        w = worker_map.get(c["worker_id"]) or {}
        row = _serialise_cert(c, today)
        row["worker_first_name"] = w.get("first_name", "")
        row["worker_last_name"] = w.get("last_name", "")
        fmeta = file_flags.get(c.get("doc_file_id")) if c.get("doc_file_id") else None
        if fmeta:
            row["preview_broken"] = bool(fmeta.get("preview_broken"))
            row["preview_broken_reason"] = fmeta.get("preview_broken_reason")
        out.append(row)
    return out


@router.get("/certifications/search")
async def search_certs(
    q: str = "",
    as_role: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Lightweight text search across cert name, issuer, worker name, tags.
    v159.1 — non-privileged roles are automatically scoped to their own
    worker row so a mobile client can search without leaking org data.
    v160.0.6 — honours `?as_role=` from the preview-as-worker iframe."""
    q = (q or "").strip().lower()
    today = date.today()
    mongo_q: dict = {"org_id": user["org_id"], "deleted_at": None}
    role_key = (user.get("role") or "").lower()
    privileged = role_key in {"admin", "hseq_lead", "supervisor"}
    if privileged and as_role:
        ar = as_role.lower()
        if ar and ar not in {"admin", "hseq_lead", "supervisor"}:
            privileged = False
    if not privileged:
        me = await db.workers.find_one(
            {"org_id": user["org_id"], "deleted_at": None,
             "$or": [{"user_id": user["id"]},
                     {"email": (user.get("email") or "").lower()}]},
            {"_id": 0, "id": 1},
        )
        mongo_q["worker_id"] = (me or {}).get("id") or "__no_match__"
    cursor = db.worker_certifications.find(mongo_q, {"_id": 0})
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
        blob = " ".join([
            c.get("name", ""), c.get("issuer", ""), c.get("notes", ""),
            c.get("doc_seed_folder", ""),
            w.get("first_name", ""), w.get("last_name", ""),
        ]).lower()
        if q and q not in blob:
            continue
        row = _serialise_cert(c, today)
        row["worker_first_name"] = w.get("first_name", "")
        row["worker_last_name"] = w.get("last_name", "")
        out.append(row)
    return out


# ────────────────────── Reminders ──────────────────────

NOTICE_OFFSETS = [60, 30, 14, 7, 1, 0]  # days before expiry


def _classify_notice(expiry: date, today: date) -> Optional[str]:
    if not expiry:
        return None
    delta = (expiry - today).days
    if delta in NOTICE_OFFSETS:
        return f"day-{delta}" if delta > 0 else "expired-today"
    if -30 <= delta < 0:
        # Weekly nudge after expiry: only when |delta| is a multiple of 7.
        if abs(delta) % 7 == 0:
            return f"post-{abs(delta)}d"
    return None


def _build_messages(cert: dict, worker: dict, app_base: str,
                    audience: str = "admin") -> tuple[str, str, str]:
    """Returns (subject, body_html, sms). `audience='worker'` uses softer copy
    aimed at the cert holder; `audience='admin'` keeps the existing wording."""
    worker_label = f"{worker.get('first_name', '')} {worker.get('last_name', '')}".strip()
    first = (worker.get("first_name") or "there").strip() or "there"
    cert_label = cert.get("name") or "Certification"
    expiry = cert.get("expiry_date") or "—"
    status = _status_for(cert, date.today())
    if audience == "worker":
        subject = f"Heads up: your {cert_label} expires {expiry}"
        body_html = f"""
<p>Hi {first},</p>
<p>Your <strong>{cert_label}</strong> is approaching its expiry date —
please arrange renewal so your site work isn't interrupted.</p>
<table cellpadding="6" style="border-collapse:collapse">
  <tr><td><b>Certification</b></td><td>{cert_label}</td></tr>
  <tr><td><b>Issuer</b></td><td>{cert.get('issuer') or '—'}</td></tr>
  <tr><td><b>Expiry</b></td><td>{expiry}</td></tr>
  <tr><td><b>Status</b></td><td>{status['label']}</td></tr>
</table>
<p>Your HSEQ lead has been notified too — they'll be in touch if anything is needed from them.</p>
<p>– The Paneltec Group compliance reminders</p>
""".strip()
        sms = (f"Hi {first}, your {cert_label} expires {expiry}. "
               f"Please arrange renewal — your HSEQ lead has been notified.")
    else:
        subject = f"Cert expiry reminder: {worker_label} – {cert_label}"
        body_html = f"""
<p>Hi team,</p>
<p>This is a reminder that <strong>{worker_label}</strong>'s certification
<strong>{cert_label}</strong> is approaching expiry.</p>
<table cellpadding="6" style="border-collapse:collapse">
  <tr><td><b>Worker</b></td><td>{worker_label}</td></tr>
  <tr><td><b>Certification</b></td><td>{cert_label}</td></tr>
  <tr><td><b>Issuer</b></td><td>{cert.get('issuer') or '—'}</td></tr>
  <tr><td><b>Expiry</b></td><td>{expiry}</td></tr>
  <tr><td><b>Status</b></td><td>{status['label']}</td></tr>
</table>
<p><a href="{app_base}/app/settings/workers?worker={worker.get('id')}">Open worker profile in The Paneltec Group →</a></p>
<p>– The Paneltec Group compliance reminders</p>
""".strip()
        sms = (f"Paneltec WHS: {worker_label} {cert_label} expires {expiry}. "
               f"Renew at app.paneltec.com.au")
    return subject, body_html, sms[:160]


async def _admin_and_hseq(org_id: str) -> list[dict]:
    cursor = db.users.find(
        {"org_id": org_id, "role": {"$in": ["admin", "hseq_lead"]},
         "deleted_at": None},
        {"_id": 0, "email": 1, "mobile": 1, "name": 1, "id": 1},
    )
    return await cursor.to_list(200)


async def _resolve_worker_user(worker: dict, org_id: str) -> Optional[dict]:
    """Find the `users` record that represents this worker for self-notification."""
    queries: list[dict] = []
    if worker.get("simpro_employee_id"):
        queries.append({"simpro_employee_id": str(worker["simpro_employee_id"])})
    if worker.get("email"):
        queries.append({"email": worker["email"].lower().strip()})
    for q in queries:
        q.update({"org_id": org_id, "deleted_at": None})
        row = await db.users.find_one(q, {"_id": 0, "email": 1, "mobile": 1, "id": 1, "name": 1})
        if row:
            return row
    return None


async def _send_one_reminder(
    cert: dict, worker: dict, recipients: list[dict],
    notice_type: str, *, dry_run: bool = False, manual_by: Optional[str] = None,
) -> dict:
    """Queue email + SMS for a single cert. Dispatches TWO notices:
       - `{notice_type}_admin` → admins + HSEQ Lead
       - `{notice_type}_worker` → the worker themselves (if a `users` row exists
         OR a mobile/email is set on the worker record).
    Each audience is tracked separately in `cert_reminders_sent` so worker
    spam can't piggyback on admin re-notices."""
    from email_outbox import queue_email_doc
    org_id = cert["org_id"]
    app_base = "https://app.paneltec.com.au"

    summary = {"cert_id": cert["id"], "notice_type": notice_type,
               "email_to": [], "sms_to": [], "errors": [],
               "worker_email_to": [], "worker_sms_to": []}

    # TextMagic config used by both audiences.
    tm = await db.integration_configs.find_one(
        {"org_id": org_id, "kind": "textmagic"}, {"_id": 0},
    )
    # v160.3.9.43 — SEC-003 sweep: hydrate encrypted secrets on read
    # (TextMagic api_key + username are encrypted at rest under v40).
    from integrations import hydrate_integration_config
    tm_cfg = (hydrate_integration_config(tm) if tm and tm.get("status") == "connected" else None) or {}
    tm_ready = bool(tm_cfg.get("username") and tm_cfg.get("api_key"))

    async def _send_sms(mobiles: list[str], sms_text: str) -> tuple[list[str], Optional[str]]:
        if not mobiles:
            return [], None
        # v58.13.85 — Route through the centralised safe boundary so
        # Comms Safe Mode is honoured (was previously a direct httpx
        # call that bypassed the gate).
        from integrations_textmagic import safe_send_sms
        res = await safe_send_sms(
            org_id, mobiles=mobiles, text=sms_text,
            triggered_by_endpoint="worker_certifications._send_sms",
            )
        if res.get("ok") and not res.get("blocked"):
            return mobiles, None
        if res.get("blocked"):
            return [], None  # Silently held by Safe Mode; audit row is in comms_outbox_blocked.
        return [], f"sms: {res.get('error')}"

    # ── Admin / HSEQ Lead audience ─────────────────────
    admin_subject, admin_html, admin_sms = _build_messages(cert, worker, app_base, "admin")
    admin_emails = sorted({u["email"] for u in recipients if u.get("email")})
    if admin_emails:
        try:
            await queue_email_doc(
                org_id=org_id, to=admin_emails, subject=admin_subject,
                body_html=admin_html, attachments=[],
                related_record_type="worker_certification",
                related_record_id=cert["id"],
                created_by=manual_by or "system",
                resource_kind="renewal_links",
                    )
            summary["email_to"] = admin_emails
        except Exception as e:
            summary["errors"].append(f"admin email: {e}")
    admin_mobiles = sorted({u["mobile"] for u in recipients if u.get("mobile")})
    sent_sms, sms_err = await _send_sms(admin_mobiles, admin_sms)
    summary["sms_to"] = sent_sms
    if sms_err:
        summary["errors"].append(f"admin {sms_err}")

    # ── Worker self-notify audience ────────────────────
    worker_user = await _resolve_worker_user(worker, org_id)
    worker_email = (worker_user or {}).get("email") or worker.get("email") or ""
    worker_mobile = (worker_user or {}).get("mobile") or worker.get("mobile") or ""
    if worker_email or worker_mobile:
        wk_subject, wk_html, wk_sms = _build_messages(cert, worker, app_base, "worker")
        if worker_email:
            try:
                await queue_email_doc(
                    org_id=org_id, to=[worker_email], subject=wk_subject,
                    body_html=wk_html, attachments=[],
                    related_record_type="worker_certification",
                    related_record_id=cert["id"],
                    created_by=manual_by or "system",
                    resource_kind="renewal_links",
                            )
                summary["worker_email_to"] = [worker_email]
            except Exception as e:
                summary["errors"].append(f"worker email: {e}")
        sent_sms, sms_err = await _send_sms([worker_mobile] if worker_mobile else [], wk_sms)
        summary["worker_sms_to"] = sent_sms
        if sms_err:
            summary["errors"].append(f"worker {sms_err}")

    if not dry_run:
        ts = now_iso()
        rows = [{
            "id": new_id(), "org_id": org_id,
            "cert_id": cert["id"], "notice_type": f"{notice_type}_admin",
            "email_to": summary["email_to"], "sms_to": summary["sms_to"],
            "manual_by": manual_by, "sent_at": ts,
        }]
        if summary["worker_email_to"] or summary["worker_sms_to"]:
            rows.append({
                "id": new_id(), "org_id": org_id,
                "cert_id": cert["id"], "notice_type": f"{notice_type}_worker",
                "email_to": summary["worker_email_to"], "sms_to": summary["worker_sms_to"],
                "manual_by": manual_by, "sent_at": ts,
            })
        await db.cert_reminders_sent.insert_many(rows)
    return summary


@router.post("/certifications/{cert_id}/send-reminder")
async def manual_send_reminder(
    cert_id: str, user: dict = Depends(get_current_user),
):
    _require_write(user, action="send_reminder")
    cert = await db.worker_certifications.find_one(
        {"id": cert_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not cert:
        raise HTTPException(404, "Certification not found")
    worker = await db.workers.find_one(
        {"id": cert["worker_id"], "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not worker:
        raise HTTPException(404, "Worker not found")
    recipients = await _admin_and_hseq(user["org_id"])
    summary = await _send_one_reminder(
        cert, worker, recipients, notice_type="manual",
        manual_by=user["id"],
    )
    return {"ok": True, **summary}


async def run_reminder_scan() -> dict:
    """Cron-style scan across all orgs. Safe to call on startup or via APScheduler.
    Idempotent via `cert_reminders_sent.{cert_id, notice_type}` unique key.

    NOTE (v58.13.86): no auto-invocation anywhere. The startup call in
    `server.py` was deleted. Only manual admin trigger via the
    `POST /worker-certifications/reminders/scan` endpoint reaches this
    function now.
    """
    today = date.today()
    stats = {"checked": 0, "queued": 0, "skipped_duplicate": 0, "skipped_no_expiry": 0}
    cursor = db.worker_certifications.find(
        {"deleted_at": None, "expiry_date": {"$ne": None}},
        {"_id": 0},
    )
    certs = await cursor.to_list(20000)
    by_org: dict[str, list[dict]] = {}
    for c in certs:
        stats["checked"] += 1
        expiry = _parse_iso(c.get("expiry_date"))
        if not expiry:
            stats["skipped_no_expiry"] += 1
            continue
        notice = _classify_notice(expiry, today)
        if not notice:
            continue
        # Dedupe by (cert_id, notice_type_admin). The admin audience is the
        # canonical "did we send for this offset?" marker — workers piggyback.
        existing = await db.cert_reminders_sent.find_one(
            {"cert_id": c["id"], "notice_type": f"{notice}_admin"}, {"_id": 1},
        )
        if existing:
            stats["skipped_duplicate"] += 1
            continue
        by_org.setdefault(c["org_id"], []).append((c, notice))

    for org_id, items in by_org.items():
        recipients = await _admin_and_hseq(org_id)
        worker_ids = list({c["worker_id"] for c, _ in items})
        workers = {}
        async for w in db.workers.find(
            {"id": {"$in": worker_ids}, "org_id": org_id, "deleted_at": None},
            {"_id": 0},
        ):
            workers[w["id"]] = w
        for cert, notice in items:
            worker = workers.get(cert["worker_id"])
            if not worker:
                continue
            try:
                await _send_one_reminder(cert, worker, recipients, notice)
                stats["queued"] += 1
            except Exception as e:
                log.warning("Reminder send failed cert=%s err=%s", cert["id"], e)
    return stats


@router.post("/certifications/scan-reminders")
# v58.13.88 — `?force=1` accepted for symmetry with the asset-service
# scan endpoint; both are already user-action so the IS_PROD env gate
# doesn't apply. Logged for audit.
async def trigger_reminder_scan(user: dict = Depends(get_current_user)):
    """Manual trigger of the daily scan — admin-only."""
    _require_write(user, action="scan_reminders")
    stats = await run_reminder_scan()
    return {"ok": True, **stats}



# ────────────────────── Bulk operations ──────────────────────
# v160.3.7ai — Bulk-clear the `pending_review` flag on Simpro-imported
# certs. The v160.3.6 ZIP import backfill always stamps
# `pending_review: True` on newly-created rows so a human can eyeball
# the cert-name → column-key match. In practice the auto-slug matcher
# is highly accurate (635+ live rows all show correct column_keys),
# so the flag adds noise without adding signal once an admin has
# already sanity-checked one row for a given column. This endpoint
# lets admins clear the flag in one call, either row-by-row or in
# bulk (scope="all_pending").
class BulkClearPendingReviewIn(BaseModel):
    ids: Optional[list[str]] = None
    scope: Optional[str] = None     # "all_pending" — clear every pending row in the org


@certs_router.post("/bulk-clear-pending-review")
async def bulk_clear_pending_review(
    body: BulkClearPendingReviewIn,
    user: dict = Depends(get_current_user),
):
    """Clear `pending_review` on a set of certifications.

    Payload variants:
      • `{ids: ["cert-id-1", "cert-id-2"]}` — clear a specific selection.
        Any id not owned by the caller's org is silently ignored.
      • `{scope: "all_pending"}` — clear every pending cert in the
        caller's org in one shot (the "271 rows" bulk action).
      • Passing neither returns 400 to avoid an accidental
        clear-nothing.
    """
    _require_write(user, action="bulk_clear_pending_review")
    filt: dict = {
        "org_id": user["org_id"],
        "deleted_at": None,
        "pending_review": True,
    }
    if body.ids:
        # v160.3.7ai — Explicit id list. Bounded to avoid pathological
        # payloads; 5000 is plenty for the largest org's Simpro dump.
        if len(body.ids) > 5000:
            raise HTTPException(400, "Too many ids in one request (max 5000)")
        filt["id"] = {"$in": body.ids}
    elif body.scope != "all_pending":
        raise HTTPException(
            400,
            "Provide either `ids` or `scope: 'all_pending'`.",
        )

    ts = now_iso()
    result = await db.worker_certifications.update_many(
        filt,
        {"$set": {"pending_review": False,
                  "pending_review_cleared_at": ts,
                  "pending_review_cleared_by": user.get("id"),
                  "updated_at": ts}},
    )
    updated = int(result.modified_count or 0)

    # Audit-log the bulk clear so a future auditor can retrace who
    # released these rows. Only log when we actually updated something
    # so we don't spam the log with no-op requests.
    if updated:
        await db.audit_logs.insert_one({
            "org_id":     user["org_id"],
            "actor_id":   user.get("id"),
            "actor_name": user.get("name") or user.get("email"),
            "action":     "certifications.bulk_clear_pending_review",
            "at":         ts,
            "count":      updated,
            "scope":      body.scope if not body.ids else "ids",
            "ids_count":  len(body.ids) if body.ids else None,
        })

    return {"updated": updated}


# ── v58.13.109 — Sidebar Certifications badge ────────────────────
#
# Cheap count endpoint for the AppShell sidebar red pill. Two buckets:
#   • `expired` — expiry_date < today.
#   • `expiring_soon` — expiry_date in [today, today + window_days).
# `window_days` defaults to 30 to match `EXPIRING_SOON_DAYS` (line 54)
# so the badge and the per-cert `_status_for()` classifier stay in
# lock-step; a caller can override to any value in [1, 365] for
# alternate dashboard tiles.
#
# Scope mirrors `list_all_certs` above:
#   • Privileged roles (admin / hseq_lead / supervisor) see the org.
#   • Everyone else is auto-scoped to their own worker row so the
#     badge doesn't leak colleague counts on a mobile client.
#
# Guarded by `@safe_admin_endpoint` per brief: an unhandled Mongo
# hiccup on shell mount would otherwise 500 the sidebar and render
# the entire app unusable.
from admin_safe_wrapper import safe_admin_endpoint  # noqa: E402


@certs_router.get("/expiry-count")
@safe_admin_endpoint
async def certifications_expiry_count(
    request: Request,
    window_days: int = 30,
    user: dict = Depends(get_current_user),
):
    """Return `{expired: n, expiring_soon: n, window_days: int}` for
    the sidebar Certifications badge. Cheap two-count aggregation with
    no per-cert serialisation — designed to be polled once on shell
    mount + on route change without pressuring Mongo."""
    if window_days < 1 or window_days > 365:
        raise HTTPException(422, "window_days must be in [1, 365]")

    today = date.today()
    horizon = today + timedelta(days=window_days)
    today_iso = today.isoformat()
    horizon_iso = horizon.isoformat()

    q: dict = {"org_id": user["org_id"], "deleted_at": None,
               "expiry_date": {"$ne": None}}
    # Same scope logic as `list_all_certs`: privileged sees the org,
    # everyone else sees only their own worker row.
    role_key = (user.get("role") or "").lower()
    privileged = role_key in {"admin", "hseq_lead", "supervisor"}
    if not privileged:
        me = await db.workers.find_one(
            {"org_id": user["org_id"], "deleted_at": None,
             "$or": [{"user_id": user["id"]},
                     {"email": (user.get("email") or "").lower()}]},
            {"_id": 0, "id": 1},
        )
        q["worker_id"] = (me or {}).get("id") or "__no_match__"

    expired = await db.worker_certifications.count_documents(
        {**q, "expiry_date": {"$lt": today_iso, "$ne": None}}
    )
    expiring_soon = await db.worker_certifications.count_documents(
        {**q, "expiry_date": {"$gte": today_iso, "$lt": horizon_iso}}
    )
    return {
        "expired": int(expired),
        "expiring_soon": int(expiring_soon),
        "window_days": window_days,
    }

