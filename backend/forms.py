"""Forms Library — Phase 2.

Adds on top of Phase 1:
  • Photo uploads bound to a submission + field (`POST /submissions/{id}/photos`)
  • GPS / signature values are stored inline on the submission's field value
  • PDF generation per submission (`GET /submissions/{id}/pdf`)
  • Per-submission read-back of attached photos (`GET /submissions/{id}/photos`)

Submissions are workable by ANY authenticated org user (workers fill them out
on their phone). Template CRUD and submission delete remain admin/hseq_lead.
"""
from __future__ import annotations
import io
import re
import uuid
from pathlib import Path
from typing import Any, List, Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile,
)
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/forms", tags=["forms"])

WRITE_ROLES = {"admin", "hseq_lead"}
ALLOWED_CATEGORIES = {"incident", "inspection", "toolbox", "near_miss", "general"}
ALLOWED_FIELD_TYPES = {"text", "textarea", "date", "number", "select", "radio",
                       "photo", "signature", "gps"}
PHOTO_ALLOWED_MIMES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"}
MAX_PHOTO_BYTES = 15 * 1024 * 1024

UPLOAD_ROOT = Path(__file__).parent / "uploads" / "form_photos"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def _require_write(user: dict, action: str = "edit"):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(403, f"Permission denied: forms.{action}")


def _serialise(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "_id"}


def _norm_category(cat: str) -> str:
    c = (cat or "general").lower().replace(" ", "_").replace("-", "_")
    return c if c in ALLOWED_CATEGORIES else "general"


def _clean_field(f: dict) -> dict:
    return {
        "id": str(f.get("id") or new_id())[:60],
        "label": str(f.get("label") or "").strip()[:200] or "Untitled",
        "type": f.get("type") if f.get("type") in ALLOWED_FIELD_TYPES else "text",
        "required": bool(f.get("required", False)),
        "options": list(f.get("options") or []),
        "placeholder": str(f.get("placeholder") or "")[:200],
    }


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = "general"
    description: Optional[str] = Field(default="", max_length=2000)
    fields: list[dict] = []


class TemplatePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    fields: Optional[list[dict]] = None


class ImportPayload(BaseModel):
    app: Optional[str] = None
    exported_at: Optional[str] = None
    version: Optional[int] = 1
    count: Optional[int] = None
    templates: list[dict]


class SubmissionIn(BaseModel):
    fields: list[dict]


# ──────────────── Templates ────────────────

@router.get("/templates")
async def list_templates(category: Optional[str] = None,
                         user: dict = Depends(get_current_user)):
    q: dict = {"org_id": user["org_id"], "deleted_at": None}
    if category and category != "all":
        q["category"] = _norm_category(category)
    rows = await db.form_templates.find(q, {"_id": 0}).sort("name", 1).to_list(2000)
    if not rows:
        return []
    # Decorate with submission counts in one aggregate.
    ids = [r["id"] for r in rows]
    counts: dict = {}
    pipeline = [
        {"$match": {"org_id": user["org_id"], "template_id": {"$in": ids},
                    "deleted_at": None}},
        {"$group": {"_id": "$template_id", "n": {"$sum": 1}}},
    ]
    async for c in db.form_submissions.aggregate(pipeline):
        counts[c["_id"]] = c["n"]
    return [{**_serialise(r), "submission_count": counts.get(r["id"], 0)} for r in rows]


@router.get("/templates/{template_id}")
async def get_template(template_id: str, user: dict = Depends(get_current_user)):
    row = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Template not found")
    n = await db.form_submissions.count_documents(
        {"template_id": template_id, "org_id": user["org_id"], "deleted_at": None},
    )
    return {**_serialise(row), "submission_count": n}


@router.post("/templates", status_code=201)
async def create_template(body: TemplateIn, user: dict = Depends(get_current_user)):
    _require_write(user, action="create")
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "name": body.name.strip(),
        "category": _norm_category(body.category),
        "description": (body.description or "").strip(),
        "fields": [_clean_field(f) for f in (body.fields or [])],
        "source": "manual", "imported_at": None,
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.form_templates.insert_one(doc)
    return _serialise(doc)


@router.patch("/templates/{template_id}")
async def update_template(template_id: str, body: TemplatePatch,
                          user: dict = Depends(get_current_user)):
    _require_write(user)
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not payload:
        raise HTTPException(400, "No fields supplied")
    if "category" in payload:
        payload["category"] = _norm_category(payload["category"])
    if "fields" in payload and payload["fields"] is not None:
        payload["fields"] = [_clean_field(f) for f in payload["fields"]]
    payload["updated_at"] = now_iso()
    row = await db.form_templates.find_one_and_update(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": payload},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not row:
        raise HTTPException(404, "Template not found")
    return _serialise(row)


@router.delete("/templates/{template_id}", status_code=204)
async def delete_template(template_id: str, user: dict = Depends(get_current_user)):
    _require_write(user, action="delete")
    ts = now_iso()
    r = await db.form_templates.update_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Template not found")
    return None


@router.post("/templates/import")
async def import_templates(body: ImportPayload, user: dict = Depends(get_current_user)):
    _require_write(user, action="import")
    created: list[dict] = []
    skipped: list[dict] = []
    ts = now_iso()
    existing = await db.form_templates.find(
        {"org_id": user["org_id"], "deleted_at": None}, {"_id": 0, "name": 1},
    ).to_list(5000)
    seen = {(r["name"] or "").strip().lower() for r in existing}

    for t in body.templates or []:
        name = str(t.get("name") or "").strip()
        if not name:
            skipped.append({"name": "(unnamed)", "reason": "missing name"})
            continue
        key = name.lower()
        if key in seen:
            skipped.append({"name": name, "reason": "already exists"})
            continue
        seen.add(key)
        doc = {
            "id": new_id(), "org_id": user["org_id"],
            "name": name,
            "category": _norm_category(t.get("category") or "general"),
            "description": str(t.get("description") or "").strip(),
            "fields": [_clean_field(f) for f in (t.get("fields") or [])],
            "source": "imported",
            "imported_at": ts,
            "created_by": user["id"],
            "created_at": ts, "updated_at": ts, "deleted_at": None,
        }
        await db.form_templates.insert_one(doc)
        created.append({"id": doc["id"], "name": name})
    return {"ok": True, "created": len(created), "created_items": created,
            "skipped": skipped}


# ──────────────── Submissions ────────────────

def _submission_status(template_fields: list, fields: list) -> str:
    """Complete if every required, non-binary field has a non-empty value.
    Photo/signature/GPS fields are considered complete when value is present.
    """
    by_id = {f.get("id"): f for f in fields}
    for tf in template_fields or []:
        if not tf.get("required"):
            continue
        sf = by_id.get(tf["id"]) or {}
        v = sf.get("value")
        if tf.get("type") in {"photo", "signature", "gps"}:
            if not v:
                return "draft"
            if isinstance(v, list) and len(v) == 0:
                return "draft"
        else:
            if v in (None, ""):
                return "draft"
            if isinstance(v, str) and not v.strip():
                return "draft"
    return "complete"


def _field_summary(fields: list) -> dict:
    out = {"photo_count": 0, "has_signature": False, "has_gps": False}
    for f in fields or []:
        t = f.get("type")
        v = f.get("value")
        if t == "photo" and isinstance(v, list):
            out["photo_count"] += len(v)
        if t == "signature" and v:
            out["has_signature"] = True
        if t == "gps" and v:
            out["has_gps"] = True
    return out


@router.get("/templates/{template_id}/submissions")
async def list_submissions(template_id: str, user: dict = Depends(get_current_user)):
    template = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not template:
        raise HTTPException(404, "Template not found")
    rows = await db.form_submissions.find(
        {"template_id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    ).sort("submitted_at", -1).to_list(2000)
    out = []
    for r in rows:
        out.append({
            **_serialise(r),
            "status": _submission_status(template.get("fields") or [], r.get("fields") or []),
            **_field_summary(r.get("fields") or []),
        })
    return out


@router.post("/templates/{template_id}/submissions", status_code=201)
async def create_submission(template_id: str, body: SubmissionIn,
                            user: dict = Depends(get_current_user)):
    template = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not template:
        raise HTTPException(404, "Template not found")
    cleaned: list[dict] = []
    for f in body.fields or []:
        t = f.get("type") if f.get("type") in ALLOWED_FIELD_TYPES else "text"
        v: Any = f.get("value")
        # Photo arrays may be empty at submit-time; they get filled by the
        # subsequent /photos endpoint. Signature is base64 PNG. GPS is a dict.
        if t == "photo":
            if v is None:
                v = []
            elif not isinstance(v, list):
                v = []
        cleaned.append({
            "id": str(f.get("id") or ""),
            "label": str(f.get("label") or ""),
            "type": t,
            "value": v,
        })
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "template_id": template_id,
        "template_name_snapshot": template["name"],
        "template_category_snapshot": template.get("category") or "general",
        "fields": cleaned,
        "submitted_by": user["id"],
        "submitted_by_name": user.get("name") or user.get("email"),
        "submitted_at": now_iso(),
        "deleted_at": None,
    }
    await db.form_submissions.insert_one(doc)
    return _serialise(doc)


@router.get("/submissions/{submission_id}")
async def get_submission(submission_id: str, user: dict = Depends(get_current_user)):
    row = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Submission not found")
    template = await db.form_templates.find_one(
        {"id": row["template_id"], "org_id": user["org_id"]}, {"_id": 0},
    )
    return {
        **_serialise(row),
        "template": _serialise(template) if template else None,
        "status": _submission_status((template or {}).get("fields") or [], row.get("fields") or []),
        **_field_summary(row.get("fields") or []),
    }


@router.delete("/submissions/{submission_id}", status_code=204)
async def delete_submission(submission_id: str, user: dict = Depends(get_current_user)):
    # Allow the original submitter OR admin/hseq_lead to delete.
    row = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Submission not found")
    if user.get("role") not in WRITE_ROLES and row.get("submitted_by") != user["id"]:
        raise HTTPException(403, "Permission denied: forms.delete")
    ts = now_iso()
    await db.form_submissions.update_one(
        {"id": submission_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": ts}},
    )
    return None


# ──────────────── Submission photos ────────────────

def _safe_ext(filename: Optional[str]) -> str:
    ext = (Path(filename or "").suffix or "").lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"}:
        return ext
    return ""


@router.post("/submissions/{submission_id}/photos", status_code=201)
async def upload_submission_photos(
    submission_id: str,
    field_id: str = Form(...),
    files: List[UploadFile] = File(...),
    user: dict = Depends(get_current_user),
):
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    # Validate the target field exists on this submission and is a photo field.
    target = None
    for f in sub.get("fields") or []:
        if f.get("id") == field_id:
            target = f
            break
    if not target:
        raise HTTPException(400, "Unknown field_id on this submission")
    if target.get("type") != "photo":
        raise HTTPException(400, "Field is not a photo field")

    sub_dir = UPLOAD_ROOT / submission_id
    sub_dir.mkdir(parents=True, exist_ok=True)

    saved: list[dict] = []
    rejected: list[dict] = []
    for upload in files:
        ext = _safe_ext(upload.filename)
        mime = (upload.content_type or "").lower()
        if not ext or (mime and mime not in PHOTO_ALLOWED_MIMES):
            rejected.append({"filename": upload.filename, "reason": "Unsupported image type"})
            continue
        stored_name = f"{uuid.uuid4().hex}{ext}"
        target_path = sub_dir / stored_name
        size = 0
        oversize = False
        with target_path.open("wb") as out:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_PHOTO_BYTES:
                    oversize = True
                    break
                out.write(chunk)
        if oversize:
            target_path.unlink(missing_ok=True)
            rejected.append({"filename": upload.filename, "reason": "Exceeds 15MB limit"})
            continue
        file_url = f"/api/files/form_photos/{submission_id}/{stored_name}"
        photo = {
            "id": new_id(),
            "filename": upload.filename or stored_name,
            "stored_name": stored_name,
            "mime": upload.content_type or "image/jpeg",
            "size": size,
            "file_url": file_url,
            "uploaded_by": user["id"],
            "uploaded_by_name": user.get("name") or user.get("email"),
            "uploaded_at": now_iso(),
        }
        saved.append(photo)

    if saved:
        # Append to the photo field's value array atomically.
        new_value = list(target.get("value") or []) + saved
        await db.form_submissions.update_one(
            {"id": submission_id, "org_id": user["org_id"], "fields.id": field_id},
            {"$set": {"fields.$.value": new_value}},
        )

    return {"saved": saved, "rejected": rejected}


@router.get("/submissions/{submission_id}/photos/{stored_name}")
async def serve_submission_photo(submission_id: str, stored_name: str,
                                 user: dict = Depends(get_current_user)):
    """Authenticated direct fetch. Frontend tends to prefer this anyway via
    axios so the token header is sent. Public file route is also exposed via
    dashboard.py for image tags in PDFs."""
    if "/" in stored_name or "\\" in stored_name or ".." in stored_name:
        raise HTTPException(400, "Invalid filename")
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 1},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    path = UPLOAD_ROOT / submission_id / stored_name
    if not path.exists():
        raise HTTPException(404, "Photo not found")
    from fastapi.responses import FileResponse
    return FileResponse(str(path), media_type="image/jpeg")


# ──────────────── PDF generation ────────────────

def _resolve_user_for_pdf(request: Request, token: Optional[str],
                          submission_id: str) -> Any:
    """Return an awaitable that resolves to the authenticated user dict. Supports
    Bearer auth OR a signed pdf-token bound to this submission."""
    if token:
        import jwt
        from auth import JWT_ALGORITHM, _secret
        try:
            payload = jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
        except jwt.ExpiredSignatureError:
            raise HTTPException(401, "PDF token expired",
                                headers={"X-Auth-Reason": "pdf-token-expired"})
        except jwt.InvalidTokenError:
            raise HTTPException(401, "Invalid PDF token",
                                headers={"X-Auth-Reason": "pdf-token-invalid"})
        if payload.get("type") != "pdf-token":
            raise HTTPException(401, "Wrong token type",
                                headers={"X-Auth-Reason": "pdf-token-invalid"})
        if payload.get("resource") != "form_submission" or payload.get("record_id") != submission_id:
            raise HTTPException(403, "Token does not match this submission",
                                headers={"X-Auth-Reason": "pdf-token-mismatch"})

        async def _resolve():
            u = await db.users.find_one({"id": payload["sub"]},
                                         {"_id": 0, "password_hash": 0})
            if not u or u.get("status") == "disabled":
                raise HTTPException(401, "User not found",
                                    headers={"X-Auth-Reason": "pdf-token-invalid"})
            return u
        return _resolve()
    return get_current_user(request, creds=None)


@router.get("/submissions/{submission_id}/pdf")
async def render_submission_pdf(
    submission_id: str, request: Request,
    download: int = Query(0),
    token: Optional[str] = Query(None),
):
    user = await _resolve_user_for_pdf(request, token, submission_id)
    sub = await db.form_submissions.find_one(
        {"id": submission_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    template = await db.form_templates.find_one(
        {"id": sub["template_id"], "org_id": user["org_id"]}, {"_id": 0},
    )
    from forms_pdf import render_form_submission_pdf
    pdf_bytes = render_form_submission_pdf(sub, template or {})
    name = re.sub(r"[^A-Za-z0-9]+", "-", (sub.get("template_name_snapshot") or "form")).strip("-").lower()
    fname = f"{name}-{(sub.get('submitted_at') or '')[:10]}.pdf"
    disp = "attachment" if download else "inline"
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": f'{disp}; filename="{fname}"'},
    )


# ---- Mint a pdf-token for a form_submission (so PdfActions popup works) ----

class FormPdfTokenIn(BaseModel):
    submission_id: str
    action: str = Field(default="view", pattern="^(view|download)$")


@router.post("/submissions/pdf-token")
async def mint_form_pdf_token(body: FormPdfTokenIn, request: Request,
                              user: dict = Depends(get_current_user)):
    sub = await db.form_submissions.find_one(
        {"id": body.submission_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    if not sub:
        raise HTTPException(404, "Submission not found")
    import jwt
    from datetime import datetime, timezone, timedelta
    from auth import JWT_ALGORITHM, _secret
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"], "org_id": user["org_id"],
        "resource": "form_submission", "record_id": body.submission_id,
        "action": body.action,
        "exp": now + timedelta(seconds=90), "iat": now, "type": "pdf-token",
    }
    token = jwt.encode(payload, _secret(), algorithm=JWT_ALGORITHM)
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host")
            or request.url.netloc)
    path = f"/api/forms/submissions/{body.submission_id}/pdf?token={token}"
    if body.action == "download":
        path += "&download=1"
    return {"token": token, "url": f"{proto}://{host}{path}", "path": path,
            "expires_in": 90}
