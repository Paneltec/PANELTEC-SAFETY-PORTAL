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


def _default_staff_login_url() -> str:
    """v58.13.132ds — Server-computed Staff Login URL. This is the live
    Emergent preview URL where office staff sign in. It is DISTINCT
    from `portal_url` (which is rendered on public PDF report footers
    and can be a customer-facing production domain once live).

    Read-only in the UI — Emergent controls this URL. Sourced from
    the same `PUBLIC_APP_URL` env as the portal default, with the
    preview-domain fallback so a fresh install still surfaces a
    working link on the settings page."""
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

    v58.13.132dq — Added `general_cover` slot alongside the two
    Australian-mandatory policies.
    """
    out: dict = {"warnings": [], "criticals": []}
    for kind, label in (
        ("public_liability",       "Public liability insurance"),
        ("workers_comp",           "Workers compensation insurance"),
        ("general_cover",          "General cover insurance"),
        ("professional_indemnity", "Professional indemnity insurance"),
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
    # v58.13.132dr — Brand display name drives the sidebar wordmark
    # via `Logo(displayName=…)`. Lookup order on the FE:
    # display_name → trading_name → name → 'Paneltec Civil' fallback.
    display_name: Optional[str] = None
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
    # v58.13.132dq — Third insurance slot + editable email preamble
    # template used by the Insurance Certificates dispatch flow.
    general_cover_insurance: Optional[InsurancePatch] = None
    # v58.13.132dq (add-on) — Fourth insurance slot.
    professional_indemnity_insurance: Optional[InsurancePatch] = None
    insurance_email_preamble: Optional[str] = None


def _strip_mongo(d: dict) -> dict:
    d.pop("_id", None)
    return d


def _decorate_get(doc: dict) -> dict:
    """Attach computed fields (insurance status, portal URL default,
    previous_slugs list default) to GET response so the FE doesn't
    have to duplicate the fallback logic."""
    if "portal_url" not in doc or not doc.get("portal_url"):
        doc["portal_url"] = _default_portal_url()
    # v58.13.132ds — Staff Login URL is ALWAYS server-computed and
    # overwrites any stashed value. Emergent controls this URL;
    # admins can't override it from the UI.
    doc["staff_login_url"] = _default_staff_login_url()
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
    for kind in ("public_liability_insurance",
                 "workers_comp_insurance",
                 "general_cover_insurance",
                 "professional_indemnity_insurance"):
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
_INSURANCE_KINDS = {"public_liability", "workers_comp", "general_cover",
                    "professional_indemnity"}
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
    # For archive we need to know the CURRENT certificate metadata
    # under this block.
    existing = (await db.orgs.find_one(
        {"id": user["org_id"]}, {"_id": 0, field: 1},
    ) or {}).get(field) or {}
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
    # v58.13.132dq — Archive the CURRENT cert into `previous_certificates[]`
    # instead of deleting from GridFS. Audit compliance requires
    # historical certs remain addressable forever.
    prev_list = list(existing.get("previous_certificates") or [])
    if existing.get("certificate_id"):
        prev_list.append({
            "certificate_id":       existing.get("certificate_id"),
            "certificate_filename": existing.get("certificate_filename"),
            "policy_number":        existing.get("policy_number"),
            "expiry_date":          existing.get("expiry_date"),
            "uploaded_at":          existing.get("certificate_uploaded_at"),
            "archived_at":          now_iso(),
            "archived_by":          user.get("id"),
        })
    merged = {**existing,
              "certificate_id": str(upload_id),
              "certificate_filename": filename,
              "certificate_uploaded_at": now_iso(),
              "previous_certificates": prev_list}
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {field: merged, "updated_at": now_iso()}},
    )
    return {"policy_type": policy_type,
            "certificate_id": str(upload_id),
            "certificate_filename": filename,
            "archived_count": len(prev_list)}


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


# ── v58.13.132dq — Archived insurance certificates ────────────────
# Upload replaces the "current" pointer but never deletes from
# GridFS. Old certs live under `{kind}_insurance.previous_certificates[]`
# and stay downloadable forever for audit compliance.

@router.get("/insurance/{policy_type}/history")
async def list_insurance_history(
    policy_type: str,
    include_deleted: bool = False,
    user: dict = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    rows = list(block.get("previous_certificates") or [])
    # v58.13.132ds — Default view filters out soft-deleted archive
    # entries. `include_deleted=true` returns everything (soft-
    # deleted rows carry `deleted_at`/`deleted_by`, GridFS file is
    # preserved so audit downloads still resolve).
    if not include_deleted:
        rows = [r for r in rows if not r.get("deleted_at")]
    # Reverse-chronological — newest archive at the top.
    def _sort_key(r: dict) -> str:
        return r.get("archived_at") or r.get("uploaded_at") or ""
    rows.sort(key=_sort_key, reverse=True)
    return {"policy_type": policy_type, "items": rows, "total": len(rows)}


# ── v58.13.132ds — Soft-delete archived insurance certificates ─────
# GridFS file is NEVER physically deleted — the download endpoint
# above still resolves the file so an admin can always retrieve it
# for audit. The soft-delete flag hides the row from the default
# `history` list; `?include_deleted=true` surfaces it with the
# Undelete affordance.

@router.delete("/insurance/{policy_type}/history/{file_id}")
async def soft_delete_insurance_history(
    policy_type: str,
    file_id: str,
    user: dict = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    prev = list(block.get("previous_certificates") or [])
    hit = next((p for p in prev if p.get("certificate_id") == file_id), None)
    if not hit:
        raise HTTPException(404, "Archived certificate not found")
    if hit.get("deleted_at"):
        return {"ok": True, "already_deleted": True}
    hit["deleted_at"] = now_iso()
    hit["deleted_by"] = user.get("id")
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {f"{field}.previous_certificates": prev,
                  "updated_at": now_iso()}},
    )
    return {"ok": True, "deleted_at": hit["deleted_at"]}


@router.post("/insurance/{policy_type}/history/{file_id}/undelete")
async def undelete_insurance_history(
    policy_type: str,
    file_id: str,
    user: dict = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    prev = list(block.get("previous_certificates") or [])
    hit = next((p for p in prev if p.get("certificate_id") == file_id), None)
    if not hit:
        raise HTTPException(404, "Archived certificate not found")
    hit.pop("deleted_at", None)
    hit.pop("deleted_by", None)
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {f"{field}.previous_certificates": prev,
                  "updated_at": now_iso()}},
    )
    return {"ok": True}


# v58.13.132dv — Bulk soft-delete on archived certificates. Soft-
# deletes every non-deleted row in `previous_certificates[]` for a
# given policy type. Preserves GridFS blobs. Idempotent (already-
# deleted rows are skipped) and admin-only. Powers the "Clear all
# archived (N)" button surface on the Email Certificates popup.
@router.post("/insurance/{policy_type}/history/clear-all")
async def clear_all_insurance_history(
    policy_type: str,
    user: dict = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    prev = list(block.get("previous_certificates") or [])
    now = now_iso()
    uid = user.get("id")
    cleared = 0
    for p in prev:
        if not p.get("deleted_at"):
            p["deleted_at"] = now
            p["deleted_by"] = uid
            cleared += 1
    if cleared:
        await db.orgs.update_one(
            {"id": user["org_id"]},
            {"$set": {f"{field}.previous_certificates": prev,
                      "updated_at": now}},
        )
    return {"ok": True, "cleared": cleared, "policy_type": policy_type}


# ── v58.13.132dw — Purge (row-level Mongo removal) ─────────────────
# Removes an archived certificate entry from `previous_certificates[]`
# entirely. The GridFS blob (fs.files + fs.chunks under the ObjectId
# `file_id`) is NEVER touched — compliance-driven audit downloads
# stay resolvable via a direct Mongo query even though the UI no
# longer references it. Purge is only allowed once a row is already
# soft-deleted (409 otherwise) — this guarantees the two-step
# operator UX: soft-delete first, then explicitly purge with the
# typed-confirm second.

async def _write_purge_audit(user: dict, policy_type: str,
                              row: dict) -> None:
    """v58.13.132dw — append one audit_logs row per purge. Ledger
    is the same collection existing invite / reset actions write to,
    so the org's compliance audit view surfaces this without any
    downstream schema tweaks."""
    await db.audit_logs.insert_one({
        "org_id": user["org_id"],
        "actor_id": user.get("id"),
        "actor_name": user.get("name"),
        "action": "insurance_cert_purged",
        "at": now_iso(),
        "policy_type": policy_type,
        "file_id": row.get("certificate_id"),
        "certificate_filename": row.get("certificate_filename"),
        "original_uploaded_at": row.get("uploaded_at"),
        "original_archived_at": row.get("archived_at"),
        "soft_deleted_at": row.get("deleted_at"),
        "soft_deleted_by": row.get("deleted_by"),
    })


@router.post("/insurance/{policy_type}/history/{file_id}/purge")
async def purge_insurance_history(
    policy_type: str,
    file_id: str,
    user: dict = Depends(get_current_user),
):
    """v58.13.132dw — Purge a single soft-deleted archived cert row.
    409 if the row hasn't been soft-deleted first; forces the two-
    step operator UX (Soft-delete → explicit typed-confirm Purge)."""
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    prev = list(block.get("previous_certificates") or [])
    hit = next((p for p in prev if p.get("certificate_id") == file_id), None)
    if not hit:
        raise HTTPException(404, "Archived certificate not found")
    if not hit.get("deleted_at"):
        raise HTTPException(
            409,
            "Row must be soft-deleted before purge. "
            "Soft-delete the certificate first, then re-run purge.",
        )
    # Remove the entry from the array (Mongo row only — GridFS blob
    # under ObjectId(file_id) is left untouched for audit).
    new_prev = [p for p in prev if p.get("certificate_id") != file_id]
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {f"{field}.previous_certificates": new_prev,
                  "updated_at": now_iso()}},
    )
    await _write_purge_audit(user, policy_type, hit)
    return {"ok": True, "purged": 1, "policy_type": policy_type,
            "file_id": file_id}


@router.post("/insurance/{policy_type}/history/purge-all-deleted")
async def purge_all_deleted_insurance_history(
    policy_type: str,
    user: dict = Depends(get_current_user),
):
    """v58.13.132dw — Bulk-purge every soft-deleted row for the
    given policy type. Rows that DON'T carry `deleted_at` are
    preserved. Idempotent when there's nothing to purge (200,
    `purged: 0`). Audit log gets one entry per row purged."""
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    prev = list(block.get("previous_certificates") or [])
    to_purge = [p for p in prev if p.get("deleted_at")]
    if not to_purge:
        return {"ok": True, "purged": 0, "policy_type": policy_type}
    new_prev = [p for p in prev if not p.get("deleted_at")]
    await db.orgs.update_one(
        {"id": user["org_id"]},
        {"$set": {f"{field}.previous_certificates": new_prev,
                  "updated_at": now_iso()}},
    )
    for row in to_purge:
        await _write_purge_audit(user, policy_type, row)
    return {"ok": True, "purged": len(to_purge),
            "policy_type": policy_type}


@router.get("/insurance/{policy_type}/history/{file_id}/download")
async def download_insurance_history_cert(
    policy_type: str,
    file_id: str,
    user: dict = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    if policy_type not in _INSURANCE_KINDS:
        raise HTTPException(400, f"Unknown policy_type: {policy_type}")
    field = f"{policy_type}_insurance"
    org = await db.orgs.find_one({"id": user["org_id"]},
                                 {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    prev = block.get("previous_certificates") or []
    hit = next((p for p in prev if p.get("certificate_id") == file_id), None)
    if not hit:
        raise HTTPException(404, "Archived certificate not found")
    from bson import ObjectId  # noqa: WPS433
    try:
        grid_out = await _fs_bucket().open_download_stream(ObjectId(file_id))
    except Exception:
        raise HTTPException(404, "Archived certificate not found in GridFS")
    data = await grid_out.read()
    ctype = ((grid_out.metadata or {}).get("content_type")
             or "application/pdf")
    filename = hit.get("certificate_filename") or f"{policy_type}-archived.pdf"
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


# ── v58.13.132dq — Insurance certificate email dispatch (M365) ─────
# Fetches selected certificates from GridFS in-process and attaches
# them raw to the outbound Graph SendMail — zero disk writes. Non-
# admins get 403. Empty recipient / cert lists get 400. Every
# dispatch (even mocked) writes an `insurance_email_log` audit row.
_DEFAULT_PREAMBLE = (
    "Please find attached our current insurance certificates. "
    "Please retain these for your records.\n\n"
    "Kind regards,\n"
)


class InsuranceEmailIn(BaseModel):
    recipients: list[str] = Field(default_factory=list)
    certificate_types: list[str] = Field(default_factory=list)
    # v58.13.132dq — Optional per-policy archived selections; each
    # entry is a `certificate_id` string (must be present in that
    # policy's `previous_certificates[]`). Sent in ADDITION to (or
    # in place of) the current active certificate.
    archived_certificate_ids: dict[str, list[str]] = Field(default_factory=dict)
    subject: Optional[str] = None
    preamble: Optional[str] = None
    note: Optional[str] = None
    cc: list[str] = Field(default_factory=list)


async def _load_cert_bytes(org_id: str, kind: str,
                           archive_file_id: Optional[str] = None) -> Optional[dict]:
    """Return {content_bytes, filename, content_type} for a policy's
    GridFS certificate, or None if not uploaded.

    v58.13.132dq — When `archive_file_id` is provided, resolves that
    specific archived certificate (must be present in
    `{kind}_insurance.previous_certificates[]`) instead of the
    current active cert. Prevents an admin from tricking the endpoint
    into leaking arbitrary GridFS blobs by passing a foreign id."""
    from bson import ObjectId  # noqa: WPS433
    field = f"{kind}_insurance"
    org = await db.orgs.find_one({"id": org_id}, {"_id": 0, field: 1})
    block = (org or {}).get(field) or {}
    if archive_file_id:
        prev = block.get("previous_certificates") or []
        hit = next((p for p in prev
                    if p.get("certificate_id") == archive_file_id), None)
        if not hit:
            return None
        cid = archive_file_id
        filename = hit.get("certificate_filename") or f"{kind}-archived.pdf"
    else:
        cid = block.get("certificate_id")
        if not cid:
            return None
        filename = block.get("certificate_filename") or f"{kind}-certificate.pdf"
    try:
        grid_out = await _fs_bucket().open_download_stream(ObjectId(cid))
    except Exception:
        return None
    data = await grid_out.read()
    ctype = ((grid_out.metadata or {}).get("content_type") or "application/pdf")
    return {
        "content_bytes": data,
        "filename": filename,
        "content_type": ctype,
        "kind": kind,
        "archive_file_id": archive_file_id,
    }


@router.post("/insurance/email")
async def dispatch_insurance_email(body: InsuranceEmailIn,
                                   user: dict = Depends(get_current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    recipients = [r.strip() for r in (body.recipients or []) if r and r.strip()]
    if not recipients:
        raise HTTPException(400, "At least one recipient required.")
    kinds = [k for k in (body.certificate_types or []) if k in _INSURANCE_KINDS]
    arch_map = body.archived_certificate_ids or {}
    has_arch = any((v or []) for k, v in arch_map.items() if k in _INSURANCE_KINDS)
    if not kinds and not has_arch:
        raise HTTPException(400, "At least one certificate type or archived id required.")

    org = await db.orgs.find_one({"id": user["org_id"]}, {"_id": 0})
    if not org:
        raise HTTPException(404, "Org not found")

    # Collect certificates from GridFS. Silently skip kinds that have
    # no uploaded PDF (spec: send the ones that exist). Archived
    # selections (v58.13.132dq) are appended in the order requested,
    # after the current active cert for that kind.
    attachments = []
    included: list[str] = []
    archived_included: list[dict] = []
    for kind in kinds:
        blob = await _load_cert_bytes(user["org_id"], kind)
        if blob:
            attachments.append({
                "content_bytes": blob["content_bytes"],
                "filename": blob["filename"],
                "content_type": blob["content_type"],
            })
            included.append(kind)
    for kind, fids in (body.archived_certificate_ids or {}).items():
        if kind not in _INSURANCE_KINDS:
            continue
        for fid in (fids or []):
            blob = await _load_cert_bytes(user["org_id"], kind,
                                          archive_file_id=fid)
            if blob:
                attachments.append({
                    "content_bytes": blob["content_bytes"],
                    "filename": blob["filename"],
                    "content_type": blob["content_type"],
                })
                archived_included.append({"kind": kind, "file_id": fid,
                                          "filename": blob["filename"]})

    org_name = org.get("name") or "Paneltec Civil"
    subject = (body.subject or f"{org_name} — Insurance Certificates").strip()
    preamble = (
        body.preamble
        or org.get("insurance_email_preamble")
        or (_DEFAULT_PREAMBLE + org_name)
    )
    parts = [preamble]
    if body.note:
        parts.append("")
        parts.append(body.note)
    body_text = "\n".join(parts)
    body_html = (
        "<html><body style=\"font-family:Helvetica,Arial,sans-serif;"
        "font-size:13px;color:#0f172a;line-height:1.55;\">"
        + body_text.replace("\n", "<br>")
        + "</body></html>"
    )

    # Dispatch via existing Graph helper. If M365 isn't configured,
    # `graph_send_mail` returns `{ok: False, error: 'sender_email_missing'|'tenant …'}` — we
    # surface a `mocked=True` flag so the FE toast can honour spec.
    from integrations_m365 import graph_send_mail  # noqa: WPS433
    result = {"ok": False, "error": "m365_not_configured"}
    mocked = False
    try:
        result = await graph_send_mail(
            user["org_id"], to=recipients, cc=body.cc or [],
            subject=subject, body_html=body_html, attachments=attachments,
        )
    except HTTPException as e:  # pragma: no cover — token errors already handled internally
        result = {"ok": False, "error": str(e.detail)}
    except Exception as e:
        result = {"ok": False, "error": f"dispatch: {e}"}
    if not result.get("ok"):
        # Spec: if credentials/wiring absent, dispatch is MOCKED —
        # button works, payload logged, no real email. Flag it.
        mocked = True

    # Audit log — every send (real or mocked) writes a row.
    log_row = {
        "id": _new_id(),
        "org_id": user["org_id"],
        "sent_by_user_id": user.get("id"),
        "sent_by_email": user.get("email"),
        "timestamp": now_iso(),
        "recipients": recipients,
        "cc": body.cc or [],
        "certificate_types": included,
        "requested_types": kinds,
        "skipped_types": [k for k in kinds if k not in included],
        "archived_included": archived_included,
        "subject": subject,
        "note": body.note or None,
        "ok": bool(result.get("ok")),
        "mocked": mocked,
        "error": result.get("error"),
        "provider": "microsoft365_graph_send_mail",
    }
    await db.insurance_email_log.insert_one(log_row)
    log_row.pop("_id", None)
    return {"ok": bool(result.get("ok")),
            "mocked": mocked,
            "error": result.get("error"),
            "sent_to": recipients,
            "included_types": included,
            "archived_included": archived_included,
            "skipped_types": log_row["skipped_types"],
            "audit_id": log_row["id"]}


@router.get("/insurance/email/log")
async def list_insurance_email_log(
    include_deleted: bool = False,
    user: dict = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    # v58.13.132ds — Default view filters out soft-deleted log rows.
    # `include_deleted=true` returns everything (soft-deleted rows
    # carry `deleted_at`/`deleted_by`). Log row is preserved forever
    # so the org's compliance audit trail is never lost.
    q: dict = {"org_id": user["org_id"]}
    if not include_deleted:
        q["deleted_at"] = None
    rows = [
        r async for r in db.insurance_email_log
        .find(q, {"_id": 0})
        .sort("timestamp", -1).limit(10)
    ]
    return {"items": rows, "total": len(rows)}


# ── v58.13.132ds — Soft-delete + Clear-all on insurance email log ──

@router.delete("/insurance/email/log/{log_id}")
async def soft_delete_email_log(log_id: str,
                                user: dict = Depends(get_current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    row = await db.insurance_email_log.find_one(
        {"id": log_id, "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "deleted_at": 1},
    )
    if not row:
        raise HTTPException(404, "Audit log row not found")
    if row.get("deleted_at"):
        return {"ok": True, "already_deleted": True}
    await db.insurance_email_log.update_one(
        {"id": log_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": now_iso(),
                  "deleted_by": user.get("id")}},
    )
    return {"ok": True}


@router.post("/insurance/email/log/{log_id}/undelete")
async def undelete_email_log(log_id: str,
                             user: dict = Depends(get_current_user)):
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    row = await db.insurance_email_log.find_one(
        {"id": log_id, "org_id": user["org_id"]}, {"_id": 0, "id": 1},
    )
    if not row:
        raise HTTPException(404, "Audit log row not found")
    await db.insurance_email_log.update_one(
        {"id": log_id, "org_id": user["org_id"]},
        {"$unset": {"deleted_at": "", "deleted_by": ""}},
    )
    return {"ok": True}


@router.post("/insurance/email/log/clear-all")
async def clear_all_email_log(user: dict = Depends(get_current_user)):
    """v58.13.132ds — Soft-delete every currently visible (i.e.
    non-deleted) audit log row for this org. Preserves data — just
    hides. Returns the count actually flipped so the FE can toast
    "Cleared N log entries"."""
    if not _is_admin(user):
        raise HTTPException(403, "Admin role required")
    result = await db.insurance_email_log.update_many(
        {"org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now_iso(),
                  "deleted_by": user.get("id")}},
    )
    return {"ok": True, "cleared": result.modified_count}


def _new_id() -> str:
    import uuid  # noqa: WPS433
    return str(uuid.uuid4())


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
