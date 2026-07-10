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


# ─── v160.0.13 · Per-role Form allowlist (Permissions Matrix) ───

_FORM_CATEGORIES = ["general", "pre_start", "inspection", "near_miss", "incident", "toolbox"]


def _norm_role(r: str) -> str:
    r = (r or "").lower().strip()
    if r not in {"worker", "supervisor", "contractor", "foreman", "admin", "owner", "hseq"}:
        raise HTTPException(400, f"Unknown role: {r}")
    return r


@router.get("/role-presets/{role}/forms")
async def get_role_forms(role: str, user: dict = Depends(get_current_user)):
    """Returns full template list with `enabled` per template based on the
    role's allowlist. Admin-only. Includes empty-category placeholders so
    the UI can render all 6 category sections.

    Response: `{ role, categories: [{key, label, forms: [{id, name, enabled}]}] }`."""
    if user.get("role") not in ("admin", "owner"):
        raise HTTPException(403, "Admin role required")
    role = _norm_role(role)
    org = await db.orgs.find_one({"id": user["org_id"]}, {"_id": 0, "role_form_allowlist": 1}) or {}
    allowlist = (org.get("role_form_allowlist") or {}).get(role)
    # None = all enabled by default. Empty list = all disabled.
    explicit = isinstance(allowlist, list)
    allowed = set(allowlist) if explicit else set()

    cursor = db.form_templates.find(
        {"org_id": user["org_id"], "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "category": 1},
    ).sort("name", 1)
    by_cat: dict[str, list] = {c: [] for c in _FORM_CATEGORIES}
    async for t in cursor:
        cat = (t.get("category") or "general").lower()
        if cat not in by_cat:
            cat = "general"
        enabled = (t["id"] in allowed) if explicit else True
        by_cat[cat].append({"id": t["id"], "name": t.get("name") or "Untitled", "enabled": enabled})

    return {
        "role": role,
        "explicit": explicit,
        "categories": [
            {"key": c, "label": c.replace("_", " ").title(), "forms": by_cat[c]}
            for c in _FORM_CATEGORIES
        ],
    }


class RoleFormsPatch(BaseModel):
    allowed_form_ids: list[str]


@router.put("/role-presets/{role}/forms")
async def put_role_forms(role: str, body: RoleFormsPatch, user: dict = Depends(get_current_user)):
    """Admin-only: replace the allowlist for `role`. IDs not present in
    `form_templates` are silently dropped."""
    if user.get("role") not in ("admin", "owner"):
        raise HTTPException(403, "Admin role required")
    role = _norm_role(role)
    # Validate ids belong to this org — reject unknown/foreign ids.
    ids = list({str(x) for x in (body.allowed_form_ids or []) if x})
    if ids:
        valid_ids = set()
        async for t in db.form_templates.find(
            {"org_id": user["org_id"], "id": {"$in": ids}, "deleted_at": None},
            {"_id": 0, "id": 1},
        ):
            valid_ids.add(t["id"])
        ids = [x for x in ids if x in valid_ids]
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {f"role_form_allowlist.{role}": ids, "updated_at": now_iso()}},
    )
    return {"role": role, "allowed_form_ids": ids}
