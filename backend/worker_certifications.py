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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument

from auth import get_current_user
from db import db
from models import new_id, now_iso
from permissions import require_permission
from document_library import (
    MAX_FILE_BYTES, UPLOAD_DIR, _safe_ext, _serialise_file, _stub_ai_tags,
)

log = logging.getLogger("paneltec.worker_certs")
from permissions import require_permission, resolve_team_scope, require_module

router = APIRouter(
    prefix="/workers", tags=["worker-certifications"],
    dependencies=[Depends(require_module("certifications"))],  # v160.0.9
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
    _require_write(user, action="upload")
    worker = await _require_worker(worker_id, user["org_id"])

    ext = _safe_ext(file.filename)
    if not ext:
        raise HTTPException(
            400,
            "Unsupported file type — allowed: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, JPEG, TXT, CSV",
        )

    # Smart routing: filename stem → seed folder → per-worker subfolder.
    cert_name = Path(file.filename or "").stem[:160] or "Certification"
    seed_name = _match_folder_name(cert_name)
    seed_folder = await _resolve_seed_folder(user["org_id"], seed_name, user["id"])
    sub_folder = await _find_or_create_worker_subfolder(seed_folder, worker, user["id"])

    folder_dir = UPLOAD_DIR / sub_folder["id"]
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
    out = []
    for c in certs:
        w = worker_map.get(c["worker_id"]) or {}
        row = _serialise_cert(c, today)
        row["worker_first_name"] = w.get("first_name", "")
        row["worker_last_name"] = w.get("last_name", "")
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
<p>– Paneltec Civil compliance reminders</p>
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
<p><a href="{app_base}/app/settings/workers?worker={worker.get('id')}">Open worker profile in Paneltec Civil →</a></p>
<p>– Paneltec Civil compliance reminders</p>
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
    tm_cfg = (tm.get("config") if tm and tm.get("status") == "connected" else None) or {}
    tm_ready = bool(tm_cfg.get("username") and tm_cfg.get("api_key"))

    async def _send_sms(mobiles: list[str], sms_text: str) -> tuple[list[str], Optional[str]]:
        if not (tm_ready and mobiles):
            return [], None
        import httpx
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post(
                    "https://rest.textmagic.com/api/v2/messages",
                    headers={"X-TM-Username": tm_cfg["username"], "X-TM-Key": tm_cfg["api_key"]},
                    data={"text": sms_text, "phones": ",".join(mobiles)},
                )
            if r.status_code in (200, 201):
                return mobiles, None
            return [], f"sms: HTTP {r.status_code} {r.text[:120]}"
        except Exception as e:
            return [], f"sms: {e}"

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
async def trigger_reminder_scan(user: dict = Depends(get_current_user)):
    """Manual trigger of the daily scan — admin-only."""
    _require_write(user, action="scan_reminders")
    stats = await run_reminder_scan()
    return {"ok": True, **stats}
