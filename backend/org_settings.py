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


# ─── v160.0.12 — Companies (for form `company_selector` field type) ───

_DEFAULT_COMPANIES = [
    # `simpro_company_id` lets the mobile `company_selector` toggle filter
    # `worker_picker` dropdowns to only crew belonging to the selected
    # tradable-name entity. Values match what Simpro pushes onto
    # `workers.simpro_company_id` at sync time.
    {"id": "paneltec-civil", "name": "Paneltec Civil", "simpro_company_id": "2"},
    {"id": "viatec", "name": "Viatec", "simpro_company_id": "3"},
]


@router.get("/companies")
async def list_org_companies(user: dict = Depends(get_current_user)):
    """Returns the list of tradable-name companies the org operates under.
    Used by the `company_selector` form field. Self-heals on first read: if
    the org has no `companies` array yet, seed with Paneltec Civil + Viatec
    so the field never renders empty for the pilot tenant."""
    doc = await db.orgs.find_one({"id": user["org_id"]}, {"_id": 0, "companies": 1}) or {}
    companies = doc.get("companies")
    if not companies:
        companies = _DEFAULT_COMPANIES
        await db.orgs.update_one(
            {"id": user["org_id"]},
            {"$set": {"companies": companies, "updated_at": now_iso()}},
        )
    return {"companies": companies}


class CompaniesPatch(BaseModel):
    companies: list[dict]


@router.put("/companies")
async def replace_org_companies(body: CompaniesPatch, user: dict = Depends(get_current_user)):
    """Admin-only: replace the full companies list. Each entry must be
    `{id: slug, name: string}`. Duplicate ids rejected."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin role required")
    seen: set[str] = set()
    clean: list[dict] = []
    for c in body.companies:
        cid = str(c.get("id") or "").strip().lower()
        name = str(c.get("name") or "").strip()
        if not cid or not name:
            raise HTTPException(422, "Every company needs an id and name")
        if cid in seen:
            raise HTTPException(409, f"Duplicate company id: {cid}")
        seen.add(cid)
        clean.append({"id": cid, "name": name})
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {"companies": clean, "updated_at": now_iso()}},
    )
    return {"companies": clean}
