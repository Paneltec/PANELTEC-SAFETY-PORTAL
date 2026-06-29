"""Renewal Links — single-use, expiring secure links so contractors can
upload renewed documents without an account.

Internal endpoints under /renewals require JWT; the public /public/renewals/*
endpoints accept a token in the path and never require auth.
"""
from __future__ import annotations
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/renewals", tags=["renewals"])
public_router = APIRouter(prefix="/public/renewals", tags=["public-renewals"])

WRITE_ROLES = {"admin", "hseq_lead"}

DEFAULT_DOC_TYPES = [
    ("Public liability", "public_liability", 10, "Public liability insurance certificate."),
    ("Workers comp", "workers_comp", 20, "Workers' compensation insurance certificate."),
    ("White card", "white_card", 30, "General construction induction (white card)."),
    ("SafeWork licence", "safework_licence", 40, "SafeWork-issued trade or operator licence."),
    ("Induction", "induction", 50, "Site or company induction record."),
    ("Other", "other", 60, "Any other compliance document."),
]


def _slugify(label: str) -> str:
    import re as _re
    s = _re.sub(r"[^a-z0-9]+", "_", (label or "").lower()).strip("_")
    return s or "type"


async def _ensure_seed_doc_types(org_id: str):
    """Seed the standard 6 types if missing, then backfill any legacy slugs
    referenced by existing renewals so the labels still resolve cleanly."""
    ts = now_iso()
    existing = await db.renewal_doc_types.find(
        {"org_id": org_id}, {"_id": 0, "slug": 1},
    ).to_list(500)
    have = {r["slug"] for r in existing}

    # Insert any missing standard seeds (idempotent by slug).
    to_insert = []
    for (label, slug, so, desc) in DEFAULT_DOC_TYPES:
        if slug in have:
            continue
        to_insert.append({
            "id": new_id(), "org_id": org_id, "label": label, "slug": slug,
            "description": desc, "active": True, "sort_order": so,
            "created_at": ts, "updated_at": ts, "deleted_at": None,
        })
        have.add(slug)
    if to_insert:
        await db.renewal_doc_types.insert_many(to_insert)

    # Backfill any legacy slugs referenced by existing renewals that aren't yet
    # in the registry — keep them active so existing links still resolve to a
    # readable label.
    cursor = db.renewal_links.find(
        {"org_id": org_id}, {"_id": 0, "doc_types_requested": 1},
    )
    legacy_slugs: set[str] = set()
    async for r in cursor:
        for s in (r.get("doc_types_requested") or []):
            if s and s not in have:
                legacy_slugs.add(s)
    if legacy_slugs:
        last = await db.renewal_doc_types.find_one(
            {"org_id": org_id}, {"sort_order": 1}, sort=[("sort_order", -1)],
        )
        next_order = (last.get("sort_order", 0) if last else 0) + 10
        legacy_docs = []
        for slug in sorted(legacy_slugs):
            label = slug.replace("_", " ").title()
            legacy_docs.append({
                "id": new_id(), "org_id": org_id, "label": label, "slug": slug,
                "description": "Legacy doc type — auto-imported from existing renewals.",
                "active": True, "sort_order": next_order,
                "created_at": ts, "updated_at": ts, "deleted_at": None,
            })
            next_order += 10
        if legacy_docs:
            await db.renewal_doc_types.insert_many(legacy_docs)


def _require_write(user: dict):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(403, "Permission denied: renewals.write")


UPLOAD_DIR = Path(__file__).parent / "uploads" / "renewals"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class RenewalCreate(BaseModel):
    contractor_id: str
    doc_types_requested: List[str] = Field(min_length=1)
    expires_in_days: int = Field(default=14, ge=1, le=90)
    subject: Optional[str] = Field(default=None, max_length=200)
    message: Optional[str] = Field(default=None, max_length=4000)


class RenewalPatch(BaseModel):
    contractor_id: Optional[str] = None
    doc_types_requested: Optional[List[str]] = None
    subject: Optional[str] = Field(default=None, max_length=200)
    message: Optional[str] = Field(default=None, max_length=4000)
    expires_at: Optional[str] = None  # ISO datetime — admin may extend the deadline


def _public_url(token: str) -> str:
    base = os.environ.get("FRONTEND_PUBLIC_URL", "").rstrip("/")
    if not base:
        # Best effort — the playwright env points REACT_APP_BACKEND_URL at the same host
        base = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
    return f"{base}/renew/{token}" if base else f"/renew/{token}"


async def _refresh_status(link: dict) -> dict:
    """Auto-expire links whose expires_at has passed."""
    if link.get("status") == "pending":
        try:
            exp = datetime.fromisoformat(link["expires_at"].replace("Z", "+00:00"))
        except Exception:
            return link
        if exp < datetime.now(timezone.utc):
            await db.renewal_links.update_one({"id": link["id"]}, {"$set": {"status": "expired"}})
            link["status"] = "expired"
    return link


# ---------- Doc types (admin-managed registry) ----------

class DocTypeIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)


class DocTypePatch(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    active: Optional[bool] = None
    sort_order: Optional[int] = None


def _doc_type_out(d: dict) -> dict:
    return {k: v for k, v in d.items() if k != "_id"}


@router.get("/doc-types")
async def list_doc_types(user: dict = Depends(get_current_user)):
    await _ensure_seed_doc_types(user["org_id"])
    rows = await db.renewal_doc_types.find(
        {"org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    ).sort("sort_order", 1).to_list(500)
    return rows


@router.post("/doc-types", status_code=201)
async def create_doc_type(body: DocTypeIn, user: dict = Depends(get_current_user)):
    _require_write(user)
    await _ensure_seed_doc_types(user["org_id"])
    label = body.label.strip()
    slug = _slugify(label)
    # Ensure slug uniqueness within org (active or deleted)
    base = slug
    n = 2
    while await db.renewal_doc_types.find_one({"org_id": user["org_id"], "slug": slug, "deleted_at": None}):
        slug = f"{base}_{n}"
        n += 1
    last = await db.renewal_doc_types.find_one(
        {"org_id": user["org_id"], "deleted_at": None},
        {"sort_order": 1}, sort=[("sort_order", -1)],
    )
    sort_order = (last.get("sort_order", 0) if last else 0) + 10
    ts = now_iso()
    doc = {
        "id": new_id(), "org_id": user["org_id"], "label": label, "slug": slug,
        "description": (body.description or "").strip() or None,
        "active": True, "sort_order": sort_order,
        "created_at": ts, "updated_at": ts, "deleted_at": None,
    }
    await db.renewal_doc_types.insert_one(dict(doc))
    return _doc_type_out(doc)


@router.patch("/doc-types/{type_id}")
async def update_doc_type(type_id: str, body: DocTypePatch, user: dict = Depends(get_current_user)):
    _require_write(user)
    update: dict = {"updated_at": now_iso()}
    if body.label is not None:
        update["label"] = body.label.strip()
    if body.description is not None:
        update["description"] = body.description.strip() or None
    if body.active is not None:
        update["active"] = body.active
    if body.sort_order is not None:
        update["sort_order"] = int(body.sort_order)
    if len(update) == 1:
        raise HTTPException(400, "No editable fields supplied")
    res = await db.renewal_doc_types.update_one(
        {"id": type_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Doc type not found")
    doc = await db.renewal_doc_types.find_one(
        {"id": type_id, "org_id": user["org_id"]}, {"_id": 0},
    )
    return doc


@router.delete("/doc-types/{type_id}")
async def delete_doc_type(type_id: str, user: dict = Depends(get_current_user)):
    _require_write(user)
    doc = await db.renewal_doc_types.find_one(
        {"id": type_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Doc type not found")
    # Guard: any non-revoked, non-deleted link still using this slug?
    in_use = await db.renewal_links.count_documents({
        "org_id": user["org_id"],
        "doc_types_requested": doc["slug"],
        "status": {"$in": ["pending"]},
        "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
    })
    if in_use > 0:
        raise HTTPException(
            409,
            f"{in_use} renewal link{'s' if in_use != 1 else ''} still require this doc type — revoke them first.",
        )
    await db.renewal_doc_types.update_one(
        {"id": type_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": now_iso(), "active": False}},
    )
    return {"ok": True}


# ---------- Internal renewal endpoints ----------

class RenewalBulkCreate(BaseModel):
    contractor_ids: List[str] = Field(min_length=1)
    doc_types_requested: List[str] = Field(min_length=1)
    expires_in_days: int = Field(default=14, ge=1, le=90)
    subject: Optional[str] = Field(default=None, max_length=200)
    message: Optional[str] = Field(default=None, max_length=4000)


@router.post("", status_code=201)
async def create_renewal(body: RenewalCreate, user: dict = Depends(get_current_user)):
    _require_write(user)
    contractor = await db.contractors.find_one({"id": body.contractor_id, "org_id": user["org_id"], "deleted_at": None})
    if not contractor:
        raise HTTPException(404, "Contractor not found")

    token = uuid.uuid4().hex
    expires_at = (datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)).isoformat()
    link = {
        "id": new_id(), "org_id": user["org_id"],
        "contractor_id": body.contractor_id,
        "contractor_name": contractor.get("name"),
        "doc_types_requested": body.doc_types_requested,
        "subject": (body.subject or "").strip() or None,
        "message": (body.message or "").strip() or None,
        "token": token, "expires_at": expires_at, "status": "pending",
        "created_by": user["id"], "created_at": now_iso(),
        "used_at": None, "submitted_files": [],
    }
    await db.renewal_links.insert_one(dict(link))
    link.pop("_id", None)
    link["public_url"] = _public_url(token)
    return link


@router.post("/bulk", status_code=201)
async def create_renewal_bulk(body: RenewalBulkCreate, user: dict = Depends(get_current_user)):
    """Phase 3.14b — bulk-create renewal links for N contractors at once.

    Idempotent: if a contractor already has a `pending` link covering ALL of
    the requested doc_types, we skip rather than minting a duplicate. Skipped
    rows still return their existing link id so the caller can deep-link to it.
    """
    _require_write(user)
    created: list[dict] = []
    skipped: list[dict] = []
    errors: list[dict] = []
    expires_at = (datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)).isoformat()
    req_types = set(body.doc_types_requested)

    for cid in body.contractor_ids:
        contractor = await db.contractors.find_one(
            {"id": cid, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0},
        )
        if not contractor:
            errors.append({"contractor_id": cid, "error": "not_found"})
            continue

        existing = await db.renewal_links.find_one(
            {"contractor_id": cid, "org_id": user["org_id"], "status": "pending"},
            {"_id": 0, "id": 1, "doc_types_requested": 1, "token": 1},
        )
        if existing and req_types.issubset(set(existing.get("doc_types_requested") or [])):
            skipped.append({"contractor_id": cid, "renewal_id": existing["id"],
                            "reason": "already_has_active_link"})
            continue

        token = uuid.uuid4().hex
        link = {
            "id": new_id(), "org_id": user["org_id"],
            "contractor_id": cid,
            "contractor_name": contractor.get("name"),
            "doc_types_requested": body.doc_types_requested,
            "subject": (body.subject or "").strip() or None,
            "message": (body.message or "").strip() or None,
            "token": token, "expires_at": expires_at, "status": "pending",
            "created_by": user["id"], "created_at": now_iso(),
            "used_at": None, "submitted_files": [],
        }
        await db.renewal_links.insert_one(dict(link))
        link.pop("_id", None)
        link["public_url"] = _public_url(token)
        created.append(link)

    return {"created": len(created), "skipped": len(skipped),
            "errors": len(errors), "details": {
                "created": created, "skipped": skipped, "errors": errors}}


@router.patch("/{rid}")
async def update_renewal(rid: str, body: RenewalPatch, user: dict = Depends(get_current_user)):
    """Edit a renewal link's metadata. The public token stays the same so the
    contractor's existing link keeps working — only the displayed fields change."""
    _require_write(user)
    existing = await db.renewal_links.find_one(
        {"id": rid, "org_id": user["org_id"], "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Renewal not found")
    if existing.get("status") == "used":
        raise HTTPException(409, "Cannot edit a renewal link that has already been submitted")

    update: dict = {"updated_at": now_iso()}
    if body.contractor_id is not None:
        contractor = await db.contractors.find_one(
            {"id": body.contractor_id, "org_id": user["org_id"], "deleted_at": None},
        )
        if not contractor:
            raise HTTPException(404, "Contractor not found")
        update["contractor_id"] = body.contractor_id
        update["contractor_name"] = contractor.get("name")
    if body.doc_types_requested is not None:
        if not body.doc_types_requested:
            raise HTTPException(400, "doc_types_requested cannot be empty")
        update["doc_types_requested"] = body.doc_types_requested
    if body.subject is not None:
        update["subject"] = body.subject.strip() or None
    if body.message is not None:
        update["message"] = body.message.strip() or None
    if body.expires_at is not None:
        try:
            datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
        except Exception as exc:
            raise HTTPException(400, "expires_at must be an ISO datetime") from exc
        update["expires_at"] = body.expires_at
        # If we extended past now and the link was 'expired', flip back to pending.
        if existing.get("status") == "expired":
            try:
                if datetime.fromisoformat(body.expires_at.replace("Z", "+00:00")) > datetime.now(timezone.utc):
                    update["status"] = "pending"
            except Exception:
                pass
    if len(update) == 1:
        raise HTTPException(400, "No editable fields supplied")

    await db.renewal_links.update_one({"id": rid, "org_id": user["org_id"]}, {"$set": update})
    refreshed = await db.renewal_links.find_one({"id": rid, "org_id": user["org_id"]}, {"_id": 0})
    refreshed = await _refresh_status(refreshed)
    refreshed["public_url"] = _public_url(refreshed["token"])
    return refreshed


@router.get("")
async def list_renewals(
    status: Optional[str] = Query(None),
    contractor_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    q = {"org_id": user["org_id"], "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]}
    if status:
        q["status"] = status
    if contractor_id:
        q["contractor_id"] = contractor_id
    docs = await db.renewal_links.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        d = await _refresh_status(d)
        d["public_url"] = _public_url(d["token"])
        out.append(d)
    return out


@router.post("/{rid}/revoke")
async def revoke_renewal(rid: str, user: dict = Depends(get_current_user)):
    _require_write(user)
    res = await db.renewal_links.find_one_and_update(
        {"id": rid, "org_id": user["org_id"], "status": "pending"},
        {"$set": {"status": "revoked"}},
        return_document=True, projection={"_id": 0},
    )
    if not res:
        raise HTTPException(404, "Renewal not found or already used")
    res["public_url"] = _public_url(res["token"])
    return res


@router.delete("/{rid}")
async def delete_renewal(rid: str, user: dict = Depends(get_current_user)):
    """Soft-delete a renewal link. Hides it from the list but keeps the audit
    trail in the DB (deleted_at timestamp). Also flips status to revoked so the
    public token immediately stops working."""
    _require_write(user)
    res = await db.renewal_links.update_one(
        {"id": rid, "org_id": user["org_id"]},
        {"$set": {"deleted_at": now_iso(), "status": "revoked"}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Renewal not found")
    return {"ok": True}


# ---------- Public endpoints ----------

@public_router.get("/{token}")
async def public_get(token: str):
    link = await db.renewal_links.find_one({"token": token}, {"_id": 0})
    if not link:
        raise HTTPException(404, "Not found")
    link = await _refresh_status(link)
    if link["status"] != "pending":
        raise HTTPException(410, f"Link is {link['status']}")
    return {
        "contractor_name": link.get("contractor_name"),
        "doc_types_requested": link.get("doc_types_requested", []),
        "expires_at": link.get("expires_at"),
    }


@public_router.post("/{token}/submit")
async def public_submit(token: str, files: List[UploadFile] = File(...)):
    link = await db.renewal_links.find_one({"token": token})
    if not link:
        raise HTTPException(404, "Not found")
    link = await _refresh_status(link)
    if link["status"] != "pending":
        raise HTTPException(410, f"Link is {link['status']}")

    folder = UPLOAD_DIR / token
    folder.mkdir(parents=True, exist_ok=True)

    submitted = []
    doc_types = link.get("doc_types_requested", [])
    # Map by position: file[i] -> doc_types[i] if present, else 'other'
    for i, up in enumerate(files):
        ext = Path(up.filename or "doc").suffix.lower() or ".bin"
        name = f"{uuid.uuid4()}{ext}"
        target = folder / name
        with target.open("wb") as f:
            shutil.copyfileobj(up.file, f)

        doc_type = doc_types[i] if i < len(doc_types) else "other"
        file_url = f"/api/files/renewals/{token}/{name}"
        rec = {
            "id": new_id(), "type": doc_type, "file_url": file_url,
            "uploaded_at": now_iso(), "status": "pending", "expiry_date": None,
        }
        submitted.append(rec)
        # Attach to contractor
        await db.contractors.update_one(
            {"id": link["contractor_id"]},
            {"$push": {"documents": rec}, "$set": {"updated_at": now_iso()}},
        )

    await db.renewal_links.update_one(
        {"id": link["id"]},
        {"$set": {"status": "used", "used_at": now_iso(), "submitted_files": submitted}},
    )
    return {"ok": True, "submitted_count": len(submitted)}
