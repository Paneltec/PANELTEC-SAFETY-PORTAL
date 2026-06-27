"""Forms Library — Phase 1.

Templates with arbitrary field arrays + submissions. Import accepts the
external JSON shape from the user's other safety app; dedupe by lowercase name
within the org so re-running the import is idempotent.
"""
from __future__ import annotations
from typing import Optional, Literal, Any

from fastapi import APIRouter, Depends, HTTPException
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
    return [_serialise(r) for r in rows]


@router.get("/templates/{template_id}")
async def get_template(template_id: str, user: dict = Depends(get_current_user)):
    row = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Template not found")
    return _serialise(row)


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

@router.get("/templates/{template_id}/submissions")
async def list_submissions(template_id: str, user: dict = Depends(get_current_user)):
    rows = await db.form_submissions.find(
        {"template_id": template_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    ).sort("submitted_at", -1).to_list(2000)
    return [_serialise(r) for r in rows]


@router.post("/templates/{template_id}/submissions", status_code=201)
async def create_submission(template_id: str, body: SubmissionIn,
                            user: dict = Depends(get_current_user)):
    template = await db.form_templates.find_one(
        {"id": template_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not template:
        raise HTTPException(404, "Template not found")
    # Photo / signature / gps store as null in Phase 1.
    cleaned: list[dict] = []
    for f in body.fields or []:
        v: Any = f.get("value")
        if f.get("type") in {"photo", "signature", "gps"}:
            v = None
        cleaned.append({
            "id": str(f.get("id") or ""),
            "label": str(f.get("label") or ""),
            "type": f.get("type") if f.get("type") in ALLOWED_FIELD_TYPES else "text",
            "value": v,
        })
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "template_id": template_id,
        "template_name_snapshot": template["name"],
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
    return _serialise(row)
