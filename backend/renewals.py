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


# ---------- Internal endpoints ----------

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
