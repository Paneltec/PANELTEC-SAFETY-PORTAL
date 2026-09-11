"""Organisation settings endpoints. Admin can edit, others can view."""
import os
import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user
from db import db
from models import now_iso

router = APIRouter(prefix="/api/org", tags=["org"])

# v58.13.132dp — Slug validation. lowercase-alphanumeric-hyphen only,
# 3-40 chars, no leading/trailing hyphens, no double hyphens.
SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def _default_portal_url() -> str:
    """v58.13.132dp — Default Portal URL for a fresh org. Sourced from
    the `PUBLIC_APP_URL` env; falls back to the preview domain so
    older orgs already have something sensible on their PDF footers."""
    return (
        os.environ.get("PUBLIC_APP_URL")
        or "https://whs-compliance.preview.emergentagent.com"
    ).rstrip("/")


def _is_admin(user: dict) -> bool:
    return (user.get("role") or user.get("role_id")) == "admin"


def _days_until(iso_date: Optional[str]) -> Optional[int]:
    """Days until an ISO date string (YYYY-MM-DD or full ISO). Returns
    None if unparseable. Negative if the date has already passed."""
    if not iso_date:
        return None
    try:
        s = iso_date.split("T")[0]
        d = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None
    return (d - datetime.now(timezone.utc)).days


def insurance_status(org: dict) -> dict:
    """v58.13.132dp — Compute per-policy expiry status for the org.

    Levels:
      * `critical` — within 7 days (or already expired)
      * `warning`  — within 30 days
      * `ok`       — more than 30 days out, or no policy on file
    """
    out: dict = {"warnings": [], "criticals": []}
    for kind, label in (
        ("public_liability", "Public liability insurance"),
        ("workers_comp",     "Workers compensation insurance"),
    ):
        block = (org.get(f"{kind}_insurance") or {})
        expiry = block.get("expiry_date")
        days = _days_until(expiry)
        block_status = {
            "policy_number": block.get("policy_number"),
            "expiry_date":   expiry,
            "certificate_id": block.get("certificate_id"),
            "certificate_filename": block.get("certificate_filename"),
            "days_until_expiry": days,
            "level": "ok",
        }
        if days is not None:
            if days <= 7:
                block_status["level"] = "critical"
                out["criticals"].append({"policy": kind, "label": label,
                                         "days": days, "expiry": expiry})
            elif days <= 30:
                block_status["level"] = "warning"
                out["warnings"].append({"policy": kind, "label": label,
                                        "days": days, "expiry": expiry})
        out[kind] = block_status
    return out


class InsurancePatch(BaseModel):
    policy_number: Optional[str] = None
    expiry_date: Optional[str] = None  # ISO YYYY-MM-DD


class OrgPatch(BaseModel):
    # Identity
    name: Optional[str] = None
    slug: Optional[str] = Field(default=None, min_length=3, max_length=40)
    abn: Optional[str] = None
    # v58.13.132dp
    trading_name: Optional[str] = None
    # Address
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    suburb: Optional[str] = None
    state: Optional[str] = None
    postcode: Optional[str] = None
    country: Optional[str] = None
    # Contact
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    # v58.13.132dp — additional org fields
    emergency_contact_phone: Optional[str] = None
    after_hours_contact_name: Optional[str] = None
    after_hours_contact_phone: Optional[str] = None
    website_url: Optional[str] = None  # public marketing site (was: `website`)
    # PDF branding
    timezone: Optional[str] = None
    default_workspace_id: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None  # legacy — retained for back-compat
    portal_url: Optional[str] = None  # v58.13.132dp — rendered on PDF footer
    # Insurance blocks (metadata only; certificate PDFs uploaded
    # separately via /insurance/{kind}/upload).
    public_liability_insurance: Optional[InsurancePatch] = None
    workers_comp_insurance: Optional[InsurancePatch] = None


def _strip_mongo(d: dict) -> dict:
    d.pop("_id", None)
    return d


def _decorate_get(doc: dict) -> dict:
    """Attach computed fields (insurance status, portal URL default,
    previous_slugs list default) to GET response so the FE doesn't
    have to duplicate the fallback logic."""
    if "portal_url" not in doc or not doc.get("portal_url"):
        doc["portal_url"] = _default_portal_url()
    doc.setdefault("previous_slugs", [])
    doc["insurance_status"] = insurance_status(doc)
    return doc


@router.get("")
async def get_org(user: dict = Depends(get_current_user)):
    doc = await db.orgs.find_one({"id": user["org_id"]})
    if not doc:
        raise HTTPException(404, "Org not found")
    return _decorate_get(_strip_mongo(doc))


@router.patch("")
async def patch_org(body: OrgPatch, user: dict = Depends(get_current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(400, "No fields to update")

    # v58.13.132dp — Slug edit. Validate + uniqueness + previous_slugs.
    if "slug" in patch:
        raw_slug = patch["slug"].strip()
        # Strict: reject non-lowercase / special-char input BEFORE
        # normalising, so "BadSlug" and "bad_slug!" surface a 400
        # rather than being silently lowered.
        if not SLUG_RE.match(raw_slug):
            raise HTTPException(
                400,
                "Slug must be lowercase alphanumeric with hyphens "
                "(3-40 chars, no leading/trailing hyphens).",
            )
        new_slug = raw_slug
        current = await db.orgs.find_one(
            {"id": user["org_id"]},
            {"_id": 0, "slug": 1, "previous_slugs": 1},
        )
        cur_slug = (current or {}).get("slug")
        if new_slug != cur_slug:
            # Uniqueness: reject if any OTHER org owns this slug (as
            # current or previous). Backward-compat lookup path.
            clash = await db.orgs.find_one(
                {"id": {"$ne": user["org_id"]},
                 "$or": [{"slug": new_slug},
                         {"previous_slugs": new_slug}]},
                {"_id": 0, "id": 1},
            )
            if clash:
                raise HTTPException(409,
                    f"Slug '{new_slug}' is already used by another org.")
            # Push the old slug into previous_slugs so downstream
            # lookups (audit exports, deep links) still resolve.
            prev = list((current or {}).get("previous_slugs") or [])
            if cur_slug and cur_slug not in prev:
                prev.append(cur_slug)
            patch["previous_slugs"] = prev
        patch["slug"] = new_slug

    # Insurance blocks: merge under `{kind}_insurance.*` so we don't
    # blow away the certificate_id that the upload endpoint sets.
    for kind in ("public_liability_insurance", "workers_comp_insurance"):
        if kind in patch and isinstance(patch[kind], dict):
            existing = (await db.orgs.find_one(
                {"id": user["org_id"]}, {"_id": 0, kind: 1},
            ) or {}).get(kind) or {}
            merged = {**existing, **patch[kind]}
            patch[kind] = merged

    patch["updated_at"] = now_iso()
    doc = await db.orgs.find_one_and_update(
        {"id": user["org_id"]}, {"$set": patch}, return_document=True,
    )
    if not doc:
        raise HTTPException(404, "Org not found")
    return _decorate_get(_strip_mongo(doc))


# ── v58.13.132dp — Insurance certificate uploads (GridFS) ───────────
# Zero-disk uploads to keep the ephemeral-storage lint clean. Two
# discrete endpoints (one per policy_type) so the FE forms stay
# simple and audit logs unambiguous.
_INSURANCE_KINDS = {"public_liability", "workers_comp"}
_LOGO_KIND = "logo"


def _fs_bucket() -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db)


async def _replace_gridfs(user: dict, upload: UploadFile, meta_kind: str,
                          existing_id_field: str) -> tuple[str, str]:
    """Upload a file to GridFS under a stable metadata bucket, return
    `(gridfs_id, filename)`. Deletes the previous file if one is
    stored on the org so we don't leak."""
    from bson import ObjectId  # noqa: WPS433
    bucket = _fs_bucket()
    payload = await upload.read()
    if not payload:
        raise HTTPException(400, "Empty upload")
    filename = upload.filename or f"{meta_kind}.bin"
    upload_id = await bucket.upload_from_stream(
        filename, payload,
        metadata={
            "org_id": user["org_id"],
            "kind": meta_kind,
            "content_type": upload.content_type or "application/octet-stream",
            "uploaded_by": user.get("id"),
            "uploaded_at": now_iso(),
        },
    )
    # Delete previous
    prev = await db.orgs.find_one(
        {"id": user["org_id"]}, {"_id": 0, existing_id_field: 1},
    )
    prev_id = (prev or {}).get(existing_id_field)
    if prev_id:
        try:
            await bucket.delete(ObjectId(prev_id))
        except Exception:  # pragma: no cover - best-effort cleanup
            pass
    return str(upload_id), filename


@router.post("/insurance/{policy_type}/upload")
async def upload_insurance_cert(
    policy_type: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    # For cleanup we need to know the CURRENT certificate_id under this block.
    existing = (await db.orgs.find_one(
        {"id": user["org_id"]}, {"_id": 0, field: 1},
    ) or {}).get(field) or {}
    from bson import ObjectId  # noqa: WPS433
    bucket = _fs_bucket()
    payload = await file.read()
    if not payload:
        raise HTTPException(400, "Empty upload")
    filename = file.filename or f"{policy_type}-certificate.pdf"
    upload_id = await bucket.upload_from_stream(
        filename, payload,
        metadata={
            "org_id": user["org_id"],
            "kind": f"insurance_{policy_type}",
            "content_type": file.content_type or "application/pdf",
            "uploaded_by": user.get("id"),
            "uploaded_at": now_iso(),
        },
    )
    if existing.get("certificate_id"):
        try:
            await bucket.delete(ObjectId(existing["certificate_id"]))
        except Exception:  # pragma: no cover
            pass
    merged = {**existing,
              "certificate_id": str(upload_id),
              "certificate_filename": filename,
              "certificate_uploaded_at": now_iso()}
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {field: merged, "updated_at": now_iso()}},
    )
    return {"policy_type": policy_type,
            "certificate_id": str(upload_id),
            "certificate_filename": filename}


@router.get("/insurance/{policy_type}/download")
async def download_insurance_cert(
    policy_type: str,
    user: dict = Depends(get_current_user),
):
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    cert_id = block.get("certificate_id")
    if not cert_id:
        raise HTTPException(404, "No certificate on file")
    from bson import ObjectId  # noqa: WPS433
    bucket = _fs_bucket()
    grid_out = await bucket.open_download_stream(ObjectId(cert_id))
    data = await grid_out.read()
    ctype = ((grid_out.metadata or {}).get("content_type")
             or "application/pdf")
    filename = block.get("certificate_filename") or f"{policy_type}.pdf"
    return Response(
        content=data,
        media_type=ctype,
        headers={"Content-Disposition":
                 f'inline; filename="{filename}"'},
    )


@router.post("/logo/upload")
async def upload_logo(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    upload_id, filename = await _replace_gridfs(
        user, file, meta_kind=_LOGO_KIND, existing_id_field="logo_gridfs_id",
    )
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {"logo_gridfs_id": upload_id,
                  "logo_filename": filename,
                  "logo_url": f"/api/org/logo/{upload_id}",
                  "updated_at": now_iso()}},
    )
    return {"logo_gridfs_id": upload_id,
            "logo_url": f"/api/org/logo/{upload_id}",
            "logo_filename": filename}


@router.get("/logo/{gridfs_id}")
async def get_logo(gridfs_id: str, user: dict = Depends(get_current_user)):
    from bson import ObjectId  # noqa: WPS433
    bucket = _fs_bucket()
    try:
        grid_out = await bucket.open_download_stream(ObjectId(gridfs_id))
    except Exception:
        raise HTTPException(404, "Logo not found")
    data = await grid_out.read()
    ctype = ((grid_out.metadata or {}).get("content_type") or "image/png")
    return Response(content=data, media_type=ctype,
                    headers={"Cache-Control": "public, max-age=3600"})


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

_FORM_CATEGORIES = ["general", "pre_start", "inspection", "near_miss", "incident", "toolbox", "admin"]

# v58.13.132bk — Whitelist tightened to the 4 core seed role_ids (plus
# `owner` which remains valid because it's a permission tier, not a
# role_id). Legacy tokens (`worker`, `supervisor`, `foreman`,
# `contractor`, `hseq`) are now rejected by both GET and PUT — the
# `.132bk` backfill script rewrites any existing `role_form_allowlist`
# rows keyed by those tokens.
_ACCEPTED_ROLES = {
    "admin", "owner",
    "paneltec_civil", "viatec_traffic", "external_contractor",
}


def _norm_role(r: str) -> str:
    r = (r or "").lower().strip()
    if r not in _ACCEPTED_ROLES:
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
    `form_templates` are silently dropped.

    v58.13.132bk — `admin` and `owner` are read-only "sees-everything"
    tiers; PUT rejects them so callers can't accidentally restrict
    admins by writing an allowlist. The Permissions Matrix UI reflects
    this by rendering the Admin tab as read-only.
    """
    if user.get("role") not in ("admin", "owner"):
        raise HTTPException(403, "Admin role required")
    role = _norm_role(role)
    if role in ("admin", "owner"):
        raise HTTPException(400,
            "Admin/Owner see every form — cannot store a restricted "
            "allowlist for these tiers.")
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
