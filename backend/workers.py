"""Workers — field-ops people imported from Simpro or created manually.

Phase 1: identity + contact + sync.
Phase 2: address + birth date + 7-day availability + Simpro client_ids.
"""
from __future__ import annotations
import re
from typing import Optional, Literal, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
import io
import logging

log = logging.getLogger("paneltec.workers")

from auth import get_current_user
from permissions import require_permission
from db import db
from models import new_id, now_iso

from permissions import require_permission, resolve_team_scope, require_module
from permissions_scope import scope_filter, can_access_record  # v160.3.9.28

router = APIRouter(
    prefix="/workers", tags=["workers"],
    # v160.0.9 — mobile module gate. Web callers bypass (no platform header).
    dependencies=[Depends(require_module("workers"))],
)

WRITE_ROLES = {"admin", "hseq_lead"}
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
AU_STATES = {"NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"}
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Simpro company IDs (Paneltec instance reality — these are stable in prod).
COMPANY_MAP = {"paneltec": "2", "viatec": "3"}


def _require_write(user: dict, action: str = "edit"):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(403, f"Permission denied: workers.{action}")


def _serialise(doc: dict, viewer: Optional[dict] = None) -> dict:
    out = {k: v for k, v in doc.items() if k != "_id"}
    cid = doc.get("simpro_company_id")
    if doc.get("source") == "manual":
        out["company_label"] = "Manual"
    elif cid == "2":
        out["company_label"] = "Paneltec"
    elif cid == "3":
        out["company_label"] = "Viatec"
    else:
        out["company_label"] = "Simpro"
    # v160.3.1 — PII gate on `simpro_sync_snapshot.pii`.
    # Only `admin` / `hr_lead` see the PII subdoc. The worker viewing
    # their OWN record also sees it (checked at the calling endpoint).
    # For every other viewer, `pii` is stripped and a bool `_pii_available`
    # is exposed so the UI can render a "Restricted" chip.
    snap = out.get("simpro_sync_snapshot")
    if isinstance(snap, dict):
        pii = snap.get("pii") or {}
        viewer_role = ((viewer or {}).get("role") or "").lower()
        viewer_id = (viewer or {}).get("id")
        viewer_email = _lower_safe((viewer or {}).get("email"))
        privileged = viewer_role in {"admin", "hr_lead", "hseq_lead"}
        own_row = bool(viewer_id and (doc.get("user_id") == viewer_id
                        or _lower_safe(doc.get("email")) == viewer_email and viewer_email))
        if not (privileged or own_row):
            snap_view = {k: v for k, v in snap.items() if k != "pii"}
            snap_view["_pii_available"] = bool(pii)
            out["simpro_sync_snapshot"] = snap_view
    return out


def _lower_safe(s):
    return (s or "").strip().lower() if isinstance(s, str) else ""


# v159.0 — Thin projection returned to non-admin/hseq callers. Deliberately
# excludes phone, email, DOB, address, availability, certifications, insurance,
# pay, notes and every free-text PII field. A worker-role user hitting
# `GET /api/workers` sees a directory-lite view only.
_THIN_FIELDS = ("id", "first_name", "last_name", "role", "active",
                "avatar_url", "trade", "company_label", "source",
                "simpro_employee_id", "simpro_company_id")


def _serialise_thin(doc: dict) -> dict:
    full = _serialise(doc)
    return {k: full.get(k) for k in _THIN_FIELDS if k in full}


def _wants_full(user: dict) -> bool:
    """Only admin + hseq_lead callers get the full PII-carrying worker row."""
    return user.get("role") in {"admin", "hseq_lead"}


def _validate_availability(av: Any) -> Optional[dict]:
    """Coerce an availability blob into the canonical shape.
    Returns None when input is None (means "clear")."""
    if av is None:
        return None
    if not isinstance(av, dict):
        raise HTTPException(400, "availability must be an object")
    out: dict = {}
    for day in DAYS:
        row = av.get(day) or {}
        if not isinstance(row, dict):
            raise HTTPException(400, f"availability.{day} must be an object")
        enabled = bool(row.get("enabled", False))
        start = (row.get("start") or "").strip()
        end = (row.get("end") or "").strip()
        if enabled:
            if not (TIME_RE.match(start) and TIME_RE.match(end)):
                raise HTTPException(400, f"availability.{day} requires HH:MM start/end when enabled")
            if start >= end:  # lexicographic == numeric for HH:MM zero-padded
                raise HTTPException(400, f"availability.{day} end time must be after start time")
        out[day] = {"enabled": enabled, "start": start, "end": end}
    return out


class WorkerIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: Optional[str] = Field(default="", max_length=80)
    email: Optional[str] = Field(default="", max_length=160)
    phone: Optional[str] = Field(default="", max_length=40)
    mobile: Optional[str] = Field(default="", max_length=40)
    position: Optional[str] = Field(default="", max_length=120)
    active: bool = True
    # Personal
    birth_date: Optional[str] = Field(default=None, max_length=10)
    country: Optional[str] = Field(default=None, max_length=80)
    state: Optional[str] = Field(default=None, max_length=8)
    street_address: Optional[str] = Field(default=None, max_length=200)
    suburb: Optional[str] = Field(default=None, max_length=120)
    postal_code: Optional[str] = Field(default=None, max_length=10)
    additional_notes: Optional[str] = Field(default=None, max_length=2000)
    # Phase 2
    availability: Optional[dict] = None
    client_ids: Optional[list[str]] = None


class WorkerPatch(BaseModel):
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    last_name: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=40)
    mobile: Optional[str] = Field(default=None, max_length=40)
    position: Optional[str] = Field(default=None, max_length=120)
    active: Optional[bool] = None
    birth_date: Optional[str] = Field(default=None, max_length=10)
    country: Optional[str] = Field(default=None, max_length=80)
    state: Optional[str] = Field(default=None, max_length=8)
    street_address: Optional[str] = Field(default=None, max_length=200)
    suburb: Optional[str] = Field(default=None, max_length=120)
    postal_code: Optional[str] = Field(default=None, max_length=10)
    additional_notes: Optional[str] = Field(default=None, max_length=2000)
    availability: Optional[dict] = None
    client_ids: Optional[list[str]] = None

    @field_validator("birth_date")
    @classmethod
    def _bd(cls, v):
        if v in (None, ""):
            return v
        if not ISO_DATE_RE.match(v):
            raise ValueError("birth_date must be YYYY-MM-DD")
        return v

    @field_validator("state")
    @classmethod
    def _state(cls, v):
        if v in (None, ""):
            return v
        if v.upper() not in AU_STATES:
            raise ValueError(f"state must be one of {sorted(AU_STATES)}")
        return v.upper()

    @field_validator("postal_code")
    @classmethod
    def _pc(cls, v):
        if v in (None, ""):
            return v
        if not re.match(r"^\d{4}$", v):
            raise ValueError("postal_code must be 4 digits")
        return v


class SyncRequest(BaseModel):
    company: Literal["paneltec", "viatec", "both"] = "both"


@router.get("")
async def list_workers(
    scope: Optional[Literal["me", "team", "all"]] = None,
    user: dict = Depends(require_permission("workers", "view")),
):
    # v159.0 — `?scope=me` returns just the caller's own worker row (with
    # full fields — a user always sees their own PII). Any other scope
    # falls through to the normal directory list, with a thin projection
    # applied for non-admin/hseq callers.
    # v160.0.8 — non-privileged callers (worker, contractor, auditor) are
    # ALWAYS clamped to their own worker row, regardless of `scope`. The
    # previous thin-projection directory still leaked names+roles of every
    # colleague. Supervisor keeps team-visible thin directory via team_view.
    # v160.3.9.28 — Own-row scoping delegated to permissions_scope.
    role_key = (user.get("role") or "").lower()
    supervisor_privileged = role_key == "supervisor"
    admin_privileged = role_key in {"admin", "hseq_lead"}
    if scope == "me" or (not admin_privileged and not supervisor_privileged):
        scope_q = scope_filter(user, "workers")
        if scope_q.get("__scope_no_match__"):
            return []
        me = await db.workers.find_one(
            {"org_id": user["org_id"], "deleted_at": None, **scope_q},
            {"_id": 0},
        )
        return [_serialise(me, viewer=user)] if me else []

    cursor = db.workers.find(
        {"org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    ).sort([("active", -1), ("last_name", 1), ("first_name", 1)])
    rows = await cursor.to_list(2000)
    if _wants_full(user):
        return [_serialise(r) for r in rows]
    # Supervisor (has team_view) gets the thin projection directory.
    return [_serialise_thin(r) for r in rows]


@router.get("/{worker_id}")
async def get_worker(worker_id: str, user: dict = Depends(get_current_user)):
    # v160.2.2 — Single-worker read for the Web admin's eye-icon
    # `WorkerViewModal`. admin/hseq_lead/supervisor may fetch any row;
    # non-privileged callers only see their OWN row (matched by
    # `user_id` or `email`).
    # v160.3.9.28 — Own-row check delegated to permissions_scope.
    doc = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Worker not found")
    role_key = (user.get("role") or "").lower()
    if role_key not in {"admin", "hseq_lead", "supervisor"}:
        # Uses can_access_record — returns True for admin bypass, then
        # matches user_id or email fallback for general users.
        if not can_access_record(user, "workers", doc):
            raise HTTPException(403, "Permission denied: workers.view")
    return _serialise(doc, viewer=user)


@router.post("", status_code=410)
async def create_worker_deprecated(
    actor: dict = Depends(require_permission("workers", "edit")),
):
    """v160.3.9.34.1 — Phase 4b parity. Manual worker creation is
    disabled; the only path into `db.workers` is the Simpro ZIP
    importer (`POST /api/integrations/simpro/workers/bulk-zip-import`)
    and the delta refresh (`POST /api/integrations/simpro/workers/refresh`).
    Auth gate is preserved — unauth callers still see 401, non-admin
    callers still see 403, only privileged callers reach the 410."""
    raise HTTPException(410, "worker create disabled: use Simpro ZIP import")


@router.patch("/{worker_id}")
async def update_worker(worker_id: str, body: WorkerPatch, user: dict = Depends(get_current_user)):
    _require_write(user)
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not payload:
        raise HTTPException(400, "No fields supplied")
    if "availability" in payload:
        payload["availability"] = _validate_availability(payload["availability"])
    payload["updated_at"] = now_iso()
    result = await db.workers.find_one_and_update(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": payload},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(404, "Worker not found")
    return _serialise(result, viewer=user)


@router.delete("/{worker_id}", status_code=204)
async def delete_worker(
    worker_id: str,
    user: dict = Depends(require_permission("workers", "delete")),
):
    # Phase 3.18 — auth now flows through the permissions matrix.
    ts = now_iso()
    result = await db.workers.update_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Worker not found")
    return None


@router.post("/sync-from-simpro")
async def sync_from_simpro(body: SyncRequest, user: dict = Depends(get_current_user)):
    _require_write(user, action="sync")
    if body.company == "both":
        target_ids = [COMPANY_MAP["paneltec"], COMPANY_MAP["viatec"]]
    else:
        target_ids = [COMPANY_MAP[body.company]]

    doc = await db.integration_configs.find_one(
        {"org_id": user["org_id"], "kind": "simpro"},
    )
    if not doc or doc.get("status") != "connected":
        raise HTTPException(400, "Simpro is not connected for this organisation")
    cfg = doc.get("config") or {}
    if not cfg.get("api_base_url") or not cfg.get("api_token"):
        raise HTTPException(400, "Simpro is missing api_base_url or api_token")

    from integrations_simpro import _refresh_staff_cache
    _, employees = await _refresh_staff_cache(cfg, target_ids, cfg["api_token"])

    created = updated = skipped = 0
    for emp in employees:
        # `_refresh_staff_cache` returns the Simpro IDs as `id` / `company_id`
        # (see `_normalise_employee`). Workers stores them under the
        # `simpro_*` namespace.
        sid = str(emp.get("id") or "")
        if not sid:
            skipped += 1
            continue
        first = (emp.get("first_name") or "").strip()
        last = (emp.get("last_name") or "").strip()
        if not first and not last:
            full = (emp.get("name") or "").strip()
            first, last = (full.split(" ", 1) + [""])[:2] if full else ("", "")
        record = {
            "org_id": user["org_id"],
            "simpro_employee_id": sid,
            "simpro_company_id": str(emp.get("company_id") or ""),
            "source": "simpro",
            "first_name": first or "(unnamed)",
            "last_name": last,
            "email": (emp.get("email") or "").strip() if emp.get("email") else "",
            "phone": (emp.get("phone") or "").strip() if emp.get("phone") else "",
            "mobile": (emp.get("phone") or "").strip() if emp.get("phone") else "",
            "position": (emp.get("position") or "").strip() if emp.get("position") else "",
            "active": bool(emp.get("active", True)),
            "updated_at": now_iso(),
            "deleted_at": None,
        }
        result = await db.workers.update_one(
            {"org_id": user["org_id"], "simpro_employee_id": sid},
            {"$set": record,
             "$setOnInsert": {
                "id": new_id(),
                "created_by": user["id"],
                "created_at": now_iso(),
                "birth_date": None, "country": "Australia", "state": None,
                "street_address": None, "suburb": None, "postal_code": None,
                "additional_notes": None,
                "availability": None, "client_ids": [],
             }},
            upsert=True,
        )
        if result.upserted_id:
            created += 1
        elif result.modified_count:
            updated += 1
        else:
            skipped += 1

    await db.integration_configs.update_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"$set": {"last_synced_at.employees": now_iso(), "updated_at": now_iso()}},
    )
    return {"ok": True, "created": created, "updated": updated, "skipped": skipped,
            "total": len(employees), "company": body.company,
            "synced_at": now_iso()}


# ─────────────────────────────────────────────────────────────────────
# v160.2.2 — /me/worker-profile (mounted at /api/me by server.py)
#
# Returns the caller's OWN worker row + certifications for the mobile
# "My Profile" screen. Strictly read-only. If no worker record is
# linked to the caller's user we return `{worker: null, certifications: []}`
# with a 200 so the mobile screen can render a friendly empty state
# instead of a hard error banner.
# ─────────────────────────────────────────────────────────────────────
me_router = APIRouter(prefix="/me", tags=["me"])


@me_router.get("/worker-profile")
async def get_my_worker_profile(user: dict = Depends(get_current_user)):
    # Deferred imports so worker_certifications (which itself imports
    # from `workers`) doesn't create an import cycle at module load.
    from datetime import date as _date
    from worker_certifications import _serialise_cert

    org_id = user["org_id"]
    email = (user.get("email") or "").lower()
    query = {
        "org_id": org_id, "deleted_at": None,
        "$or": [{"user_id": user["id"]}] + ([{"email": email}] if email else []),
    }
    worker = await db.workers.find_one(query, {"_id": 0})
    if not worker:
        return {"worker": None, "certifications": [], "clients": []}

    # Certifications for this worker.
    today = _date.today()
    cert_cursor = db.worker_certifications.find(
        {"org_id": org_id, "worker_id": worker["id"], "deleted_at": None},
        {"_id": 0},
    ).sort([("expiry_date", 1), ("name", 1)])
    certs = await cert_cursor.to_list(500)

    # Best-effort client name resolution from Simpro's cached customer list.
    client_ids = worker.get("client_ids") or []
    clients: list[dict] = []
    if client_ids:
        cfg_doc = await db.integration_configs.find_one(
            {"org_id": org_id, "kind": "simpro"}, {"_id": 0, "customers_cache": 1},
        ) or {}
        by_id = {
            str(c.get("simpro_customer_id")): c
            for c in (cfg_doc.get("customers_cache") or [])
        }
        for cid in client_ids:
            row = by_id.get(str(cid))
            if row:
                clients.append({
                    "id": cid, "name": row.get("name") or f"Customer #{cid}",
                    "company_label": row.get("company_label"),
                })
            else:
                clients.append({"id": cid, "name": f"Customer #{cid}", "company_label": None})

    return {
        "worker": _serialise(worker),
        "certifications": [_serialise_cert(c, today) for c in certs],
        "clients": clients,
    }


# ─────────────────────────────────────────────────────────────
# v160.3.9.34 — Worker avatar upload / delete.
#
# `POST /api/workers/{worker_id}/photo` accepts a multipart image
# (jpeg/png/webp) up to 10MB. Server-side canonicalisation via
# Pillow: centre-crop → 512×512 → re-encode JPEG q=85 (typical
# output ~150KB). Old GridFS blob is deleted BEFORE the new one
# is registered — zero-orphan invariant. If Pillow raises on a
# malformed image, falls back to storing the raw upload with a
# warning log (still MIME + size validated).
#
# `DELETE /api/workers/{worker_id}/photo` hard-deletes the blob
# and unsets both `photo_url` and `photo_gridfs_id`.
#
# Both gated via `_require_write` (admin + hseq_lead). Both
# scoped to the caller's org_id. Both emit a `worker_audit` row.
# ─────────────────────────────────────────────────────────────

_MAX_UPLOAD_BYTES = 10 * 1024 * 1024   # 10 MB pre-resize cap.
_MIME_MAGIC = [
    (b"\xff\xd8\xff",           "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n",      "image/png"),
    (b"RIFF",                    "image/webp"),  # partial; matched below.
]


def _sniff_mime(head: bytes) -> Optional[str]:
    for magic, mime in _MIME_MAGIC:
        if head.startswith(magic):
            if mime == "image/webp":
                # RIFF….WEBP — check bytes 8-12.
                if head[8:12] == b"WEBP":
                    return "image/webp"
                return None
            return mime
    return None


def _fs_bucket() -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db.client[db.name])


def _canonicalise_image(raw: bytes) -> tuple[bytes, str, dict]:
    """Return (blob, mime, meta). Falls back to (raw, sniffed_mime, {})
    if Pillow fails — never raises."""
    meta = {}
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        img.load()
        # EXIF orientation → apply.
        try:
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)
        except Exception:
            pass
        # Convert to RGB for JPEG (drop alpha).
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        # Centre-crop square → 512x512.
        w, h = img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
        img = img.resize((512, 512))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85, optimize=True)
        blob = out.getvalue()
        meta = {"resized_to": "512x512", "out_size": len(blob),
                "resized_by": "Pillow"}
        return blob, "image/jpeg", meta
    except Exception as e:
        log.warning("workers.photo Pillow-resize failed, storing raw: %s", e)
        return raw, _sniff_mime(raw[:16]) or "application/octet-stream", {
            "resized_to": None, "out_size": len(raw), "fallback_reason": str(e),
        }


@router.post("/{worker_id}/photo")
async def upload_worker_photo(
    worker_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    _require_write(user, action="edit")
    worker = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not worker:
        raise HTTPException(404, "Worker not found")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(400, "Empty upload")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Image too large (max {_MAX_UPLOAD_BYTES//1024//1024}MB)")
    mime = _sniff_mime(raw[:16])
    if mime is None:
        # Reject HEIC and everything unrecognised with a clear message.
        raise HTTPException(415,
            "Unsupported image format — please upload JPEG, PNG, or WebP. "
            "iPhone photos default to HEIC; convert to JPEG first.")

    canonical_blob, canonical_mime, meta = _canonicalise_image(raw)

    fs = _fs_bucket()
    # Delete OLD GridFS blob first — zero-orphan invariant.
    old_gid = worker.get("photo_gridfs_id")
    if old_gid:
        try:
            await fs.delete(ObjectId(old_gid))
        except Exception as e:
            log.warning("workers.photo old-blob delete failed (may already be gone): %s", e)

    new_gid = await fs.upload_from_stream(
        f"{worker_id}.jpg",
        canonical_blob,
        metadata={"kind": "worker_photo", "worker_id": worker_id,
                  "org_id": user["org_id"], "mime": canonical_mime,
                  "orig_size": len(raw), "orig_mime": mime, **meta},
    )
    ts = now_iso()
    photo_url = f"/api/workers/{worker_id}/photo/{new_gid}"
    updated = await db.workers.find_one_and_update(
        {"id": worker_id, "org_id": user["org_id"]},
        {"$set": {"photo_url": photo_url,
                  "photo_gridfs_id": str(new_gid),
                  "updated_at": ts}},
        return_document=ReturnDocument.AFTER,
    )
    await db.worker_audit.insert_one({
        "id": new_id(),
        "worker_id": worker_id,
        "org_id": user["org_id"],
        "action": "photo_uploaded",
        "actor_user_id": user["id"],
        "actor_email": user.get("email"),
        "diff": {"orig_bytes": len(raw), "orig_mime": mime,
                 "stored_bytes": len(canonical_blob),
                 "stored_mime": canonical_mime,
                 "gridfs_id": str(new_gid),
                 "old_gridfs_id": old_gid, **meta},
        "at": ts,
    })
    return _serialise(updated, viewer=user)


@router.delete("/{worker_id}/photo")
async def delete_worker_photo(
    worker_id: str,
    user: dict = Depends(get_current_user),
):
    _require_write(user, action="edit")
    worker = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not worker:
        raise HTTPException(404, "Worker not found")
    old_gid = worker.get("photo_gridfs_id")
    if old_gid:
        fs = _fs_bucket()
        try:
            await fs.delete(ObjectId(old_gid))
        except Exception as e:
            log.warning("workers.photo delete blob failed: %s", e)
    ts = now_iso()
    updated = await db.workers.find_one_and_update(
        {"id": worker_id, "org_id": user["org_id"]},
        {"$set": {"photo_url": None, "photo_gridfs_id": None,
                  "updated_at": ts}},
        return_document=ReturnDocument.AFTER,
    )
    await db.worker_audit.insert_one({
        "id": new_id(),
        "worker_id": worker_id,
        "org_id": user["org_id"],
        "action": "photo_deleted",
        "actor_user_id": user["id"],
        "actor_email": user.get("email"),
        "diff": {"old_gridfs_id": old_gid, "hard_deleted": True},
        "at": ts,
    })
    return _serialise(updated, viewer=user)

