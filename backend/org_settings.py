"""Organisation settings endpoints. Admin can edit, others can view."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from auth import get_current_user
from db import db
from models import now_iso

router = APIRouter(prefix="/api/org", tags=["org"])


class OrgPatch(BaseModel):
    name: Optional[str] = None
    abn: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    suburb: Optional[str] = None
    state: Optional[str] = None
    postcode: Optional[str] = None
    country: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    timezone: Optional[str] = None
    default_workspace_id: Optional[str] = None


def _strip_mongo(d: dict) -> dict:
    d.pop("_id", None)
    return d


@router.get("")
async def get_org(user: dict = Depends(get_current_user)):
    doc = await db.orgs.find_one({"id": user["org_id"]})
    if not doc:
        raise HTTPException(404, "Org not found")
    return _strip_mongo(doc)


@router.patch("")
async def patch_org(body: OrgPatch, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin role required")
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not patch:
        raise HTTPException(400, "No fields to update")
    patch["updated_at"] = now_iso()
    doc = await db.orgs.find_one_and_update(
        {"id": user["org_id"]}, {"$set": patch}, return_document=True,
    )
    if not doc:
        raise HTTPException(404, "Org not found")
    return _strip_mongo(doc)
