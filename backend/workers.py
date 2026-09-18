"""Workers — field-ops people imported from Simpro or created manually.

Phase 1: identity + contact + sync.
Phase 2: address + birth date + 7-day availability + Simpro client_ids.
"""
from __future__ import annotations
import re
from typing import Optional, Literal, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
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

# v58.13.20 — `require_permission` was double-imported (line above +
# in the multi-name import below). Dropped from the second import
# per ruff F811 fix; line 21 remains the sole source.
from permissions import resolve_team_scope, require_module
from permissions_scope import scope_filter, can_access_record, require_scoped_access  # v160.3.9.28 + v43.2

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
    # v58.13.132fd — Default coercion for `photo_offset_y`. Missing,
    # null, or non-integer stored values render as 50 (centred).
    _pox = out.get("photo_offset_y")
    if not isinstance(_pox, int):
        out["photo_offset_y"] = 50
    else:
        out["photo_offset_y"] = max(0, min(100, _pox))
    # v58.13.132hp — Default coercion for `photo_scale`. Missing, null,
    # or non-float stored values render as 1.0 (natural size).
    _ps = out.get("photo_scale")
    try:
        _psf = float(_ps) if _ps is not None else 1.0
    except (TypeError, ValueError):
        _psf = 1.0
    out["photo_scale"] = max(0.5, min(2.5, _psf))
    # v58.13.132hx — Photo transform (wheel-zoom + drag). Preferred
    # over the legacy photo_offset_y / photo_scale pair. Shape is
    # {x: float, y: float, zoom: float}. Missing / malformed →
    # derive from the legacy fields so the FE never sees `null`.
    _pt = out.get("photo_transform")
    if not isinstance(_pt, dict):
        _pt = {}
    try:
        _pt_zoom = float(_pt.get("zoom")) if _pt.get("zoom") is not None else float(out["photo_scale"])
    except (TypeError, ValueError):
        _pt_zoom = float(out["photo_scale"])
    try:
        _pt_x = float(_pt.get("x")) if _pt.get("x") is not None else 0.0
    except (TypeError, ValueError):
        _pt_x = 0.0
    try:
        _pt_y = float(_pt.get("y")) if _pt.get("y") is not None else float(-(out["photo_offset_y"] - 50) * 0.5)
    except (TypeError, ValueError):
        _pt_y = 0.0
    out["photo_transform"] = {
        "x": max(-500.0, min(500.0, _pt_x)),
        "y": max(-500.0, min(500.0, _pt_y)),
        "zoom": max(0.5, min(3.0, _pt_zoom)),
    }
    cid = doc.get("simpro_company_id")
    # v58.13.132hv — worker_company feature purged. company_label
    # now derives purely from simpro_company_id + source flags.
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
    # v58.13.56 — HR-merge lite. Strip the 4 HR fields from the
    # response unless the viewer holds `hr_employees.view`.
    _hr_fields = ("employee_id", "date_employee_added",
                  "working_visa", "do_not_rehire")
    if any(k in out for k in _hr_fields):
        viewer_role_l = ((viewer or {}).get("role") or "").lower()
        viewer_perms = ((viewer or {}).get("permissions") or {})
        hr_grant = viewer_perms.get("hr_employees") or {}
        privileged_hr = viewer_role_l in {"admin", "hr_lead"} or bool(hr_grant.get("view"))
        if not privileged_hr:
            for k in _hr_fields:
                out.pop(k, None)
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
    # v58.13.132hp — Paneltec-only personal fields (see WorkerPatch
    # for full-context comment). Optional at create so seeds / Simpro
    # imports never fail.
    usi_number: Optional[str] = Field(default=None, max_length=20)
    tax_file_number: Optional[str] = Field(default=None, max_length=20)
    emergency_contact_name: Optional[str] = Field(default=None, max_length=120)
    emergency_contact_phone: Optional[str] = Field(default=None, max_length=40)
    emergency_contact_relationship: Optional[str] = Field(default=None, max_length=60)
    # v58.13.132hq — Worker company (editable dropdown).
    # v58.13.132hv — REMOVED. Feature purged.


# v58.13.131o — SmartFill card assignment entry.
# `card_number` is the SmartFill "Card Number" from the fuel CSV /
# Transactions:Read API. `assigned_from` / `assigned_to` are optional
# `YYYY-MM-DD` bounds — leave both null for the currently-active card.
# `assigned_to` set on an old assignment lets a card be re-assigned
# to a different worker without losing the historical resolution
# (see `resolve_driver_by_card` in `fleet_fuel.py`).
class SmartFillCardEntry(BaseModel):
    card_number: str = Field(min_length=1, max_length=32)
    assigned_from: Optional[str] = Field(default=None, max_length=10)
    assigned_to: Optional[str] = Field(default=None, max_length=10)
    notes: Optional[str] = Field(default=None, max_length=200)

    @field_validator("card_number")
    @classmethod
    def _cn(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("card_number required")
        return v

    @field_validator("assigned_from", "assigned_to")
    @classmethod
    def _dt(cls, v):
        if v in (None, ""):
            return None
        if not ISO_DATE_RE.match(v):
            raise ValueError("date must be YYYY-MM-DD")
        return v


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
    # v58.13.132fd — Vertical alignment for the worker photo crop.
    # Stored as an integer 0..100 — interpreted client-side as the
    # CSS `object-position` Y percentage (0 top, 50 centre, 100
    # bottom). Missing / null coerces to 50 on serialise. Values
    # outside the range are clamped server-side (never 400).
    photo_offset_y: Optional[int] = None
    # v58.13.132hp — Photo zoom / scale. Companion to `photo_offset_y`
    # so admins can crop tight portraits from wider originals without
    # a re-upload. Stored as a float in [0.5, 2.5]; missing / null
    # coerces to 1.0 on serialise. Out-of-range values are clamped
    # server-side (never 400).
    photo_scale: Optional[float] = None
    # v58.13.132hx — Photo transform (wheel-zoom + drag). Preferred
    # over the legacy photo_offset_y/photo_scale pair. Shape is
    # `{x: float, y: float, zoom: float}`. Missing / null coerces to
    # a value derived from the legacy pair on serialise.
    photo_transform: Optional[dict] = None
    # v58.13.132hp — Paneltec-only personal fields. NEVER synced from
    # or to Simpro (see integrations_simpro_workers.py::_extract_pii).
    # If Simpro carries its own emergency-contact block that maps to
    # a separate `emergency_contact` dict via `_extract_pii`, these
    # new fields sit BESIDE that block — they're admin-editable
    # Paneltec-native captures for USI (VET training), TFN (payroll)
    # and a manual emergency contact override.
    usi_number: Optional[str] = Field(default=None, max_length=20)
    tax_file_number: Optional[str] = Field(default=None, max_length=20)
    emergency_contact_name: Optional[str] = Field(default=None, max_length=120)
    emergency_contact_phone: Optional[str] = Field(default=None, max_length=40)
    emergency_contact_relationship: Optional[str] = Field(default=None, max_length=60)
    # v58.13.132hq — Worker company (editable dropdown).
    # v58.13.132hv — REMOVED. Feature purged.
    # v58.13.56 — HR-merge lite. Four flags migrated off `hr_employees`
    # so the Worker detail view can carry the HR context without a
    # separate register. Gate is `hr_employees.view` (see `_serialise`
    # PII-scrub below) — non-holders never see these fields in a GET.
    employee_id: Optional[str] = Field(default=None, max_length=40)
    date_employee_added: Optional[str] = Field(default=None, max_length=10)
    working_visa: Optional[bool] = None
    do_not_rehire: Optional[bool] = None

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
    include_inactive: bool = False,
    user: dict = Depends(require_permission("workers", "view")),
):
    # v58.13.132fy — `?include_inactive=true` (admin-only, silently
    # clamped for non-admin callers) returns soft-deleted / archived
    # workers alongside the active roster so the Workers list's
    # "Show inactive" toggle can surface them with a Restore action.
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
        (
            {"org_id": user["org_id"]}
            if (include_inactive and admin_privileged)
            else {"org_id": user["org_id"], "deleted_at": None}
        ), {"_id": 0},
    ).sort([("active", -1), ("last_name", 1), ("first_name", 1)])
    rows = await cursor.to_list(2000)
    if _wants_full(user):
        return [_serialise(r) for r in rows]
    # Supervisor (has team_view) gets the thin projection directory.
    return [_serialise_thin(r) for r in rows]


# v160.3.9.58.11.2 — Thin worker directory for form pickers.
#
# The "Log Service" modal (`AssetServiceTabs.RecordEditor`) used a
# free-text `<input>` for the Technician field. Users asked to pick
# from the Simpro-imported employee list instead. The existing
# `GET /api/workers` gate is `workers.view` (admin/HSEQ/supervisor
# only for the full directory) — too tight for a form dropdown that
# techs themselves need. This companion endpoint returns a THIN
# projection (id, first_name, last_name, name, simpro_employee_id,
# active) for use in pickers, gated on `get_current_user` to match
# the caller-authenticator on `POST /assets/{id}/records` (the
# actual "Log service" write endpoint uses `get_current_user`, not
# a permission — the directory read must not be TIGHTER than the
# write). Same org scoping as everything else in `workers.py`.
@router.get("/directory")
async def workers_directory(
    active: Optional[bool] = None,
    source: Optional[str] = None,
    limit: int = 500,
    user: dict = Depends(get_current_user),
):
    q: dict = {"org_id": user["org_id"], "deleted_at": None}
    if active is not None:
        q["active"] = active
    if source:
        q["source"] = source
    cursor = db.workers.find(
        q,
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1,
         "simpro_employee_id": 1, "active": 1, "position": 1},
    ).collation({"locale": "en", "strength": 2}).sort(
        [("first_name", 1), ("last_name", 1)],
    )
    rows = await cursor.to_list(min(limit, 500))
    return [{
        "id": r.get("id"),
        "first_name": r.get("first_name") or "",
        "last_name": r.get("last_name") or "",
        "name": (f"{r.get('first_name') or ''} {r.get('last_name') or ''}").strip(),
        "simpro_employee_id": r.get("simpro_employee_id"),
        "active": bool(r.get("active", True)),
        # v58.12.8 (shipped v58.12.10) — surface Simpro `position` for the
        # AssetServiceTabs Technician-position hybrid picker. Blank string
        # when absent so the FE distinct-position derivation drops it via
        # `.filter(Boolean)`.
        "position": r.get("position") or "",
    } for r in rows]


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
    # v160.3.9.44 (P0-IDOR) — Record-level scoping. `_require_write`'s
    # inner allowlist currently blocks contractor_rep, but the token
    # model still exposes `workers.edit`. Add an explicit
    # `require_scoped_access` so contractor_rep-with-workers.edit can
    # only patch their OWN contractor's workers — independent of the
    # legacy WRITE_ROLES allowlist. 404 (not 403) on scope-fail to
    # match SEC-004's existence-leak-avoidance pattern.
    existing = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Worker not found")
    require_scoped_access(user, "workers", existing)
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not payload:
        raise HTTPException(400, "No fields supplied")
    if "availability" in payload:
        payload["availability"] = _validate_availability(payload["availability"])
    # v58.13.132fd — Clamp `photo_offset_y` to [0, 100]. Spec calls
    # for server-side clamp, not a 400/422, so admins nudging a
    # slider past the range don't get rejected.
    if "photo_offset_y" in payload:
        pox = payload["photo_offset_y"]
        if pox is None or not isinstance(pox, int):
            payload["photo_offset_y"] = 50
        else:
            payload["photo_offset_y"] = max(0, min(100, pox))
    # v58.13.132hp — Same-shape clamp for `photo_scale` [0.5, 2.5].
    # Slider FE ships with a 0.5..2.0 range but we allow 2.5 server-
    # side so a future FE tweak doesn't need a coordinated re-ship.
    if "photo_scale" in payload:
        ps = payload["photo_scale"]
        try:
            psf = float(ps) if ps is not None else 1.0
        except (TypeError, ValueError):
            psf = 1.0
        payload["photo_scale"] = max(0.5, min(2.5, psf))
    # v58.13.132hx — Clamp `photo_transform.{x,y,zoom}`. Same posture
    # as photo_offset_y — silently coerce out-of-range rather than
    # 400 so a stale FE session can't fail its save.
    if "photo_transform" in payload:
        pt = payload["photo_transform"]
        if not isinstance(pt, dict):
            pt = {}
        try:
            _z = float(pt.get("zoom")) if pt.get("zoom") is not None else 1.0
        except (TypeError, ValueError):
            _z = 1.0
        try:
            _x = float(pt.get("x")) if pt.get("x") is not None else 0.0
        except (TypeError, ValueError):
            _x = 0.0
        try:
            _y = float(pt.get("y")) if pt.get("y") is not None else 0.0
        except (TypeError, ValueError):
            _y = 0.0
        payload["photo_transform"] = {
            "x": max(-500.0, min(500.0, _x)),
            "y": max(-500.0, min(500.0, _y)),
            "zoom": max(0.5, min(3.0, _z)),
        }
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


# ── v58.13.131o — SmartFill card ↔ worker linkage ────────────────
# Fuel CSV imports carry a `Card Number` (e.g. 21318) but no driver
# name. Per-employee reports need a human name — so admins link one
# or more card numbers to each worker here. Backfill / insert-time
# resolution lives in `fleet_fuel.py:resolve_driver_by_card`.

@router.get("/{worker_id}/smartfill-cards")
async def list_smartfill_cards(
    worker_id: str,
    user: dict = Depends(require_permission("workers", "view")),
):
    worker = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not worker:
        raise HTTPException(404, "Worker not found")
    return {"cards": worker.get("smartfill_card_numbers") or []}


@router.post("/{worker_id}/smartfill-cards")
async def add_smartfill_card(
    worker_id: str,
    body: SmartFillCardEntry,
    user: dict = Depends(get_current_user),
):
    _require_write(user)
    existing = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Worker not found")
    require_scoped_access(user, "workers", existing)

    entry = body.model_dump()
    entry["created_at"] = now_iso()
    entry["created_by"] = user["id"]
    cards = list(existing.get("smartfill_card_numbers") or [])
    # Uniqueness within a worker's own list: if the same card_number
    # already exists AND has no `assigned_to`, reject as duplicate.
    # A card with `assigned_to` set is a historical row and can
    # co-exist with a fresh active one.
    for c in cards:
        if c.get("card_number") == entry["card_number"] and not c.get("assigned_to"):
            raise HTTPException(409, "Card number already linked to this worker (active)")

    # Cross-worker uniqueness on ACTIVE assignments (assigned_to=null).
    # A card can only be actively linked to ONE worker at a time —
    # historical assignments (with assigned_to set) don't conflict.
    other = await db.workers.find_one(
        {
            "org_id": user["org_id"],
            "deleted_at": None,
            "id": {"$ne": worker_id},
            "smartfill_card_numbers": {"$elemMatch": {
                "card_number": entry["card_number"],
                "$or": [
                    {"assigned_to": None},
                    {"assigned_to": {"$exists": False}},
                ],
            }},
        },
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1},
    )
    if other:
        raise HTTPException(
            409,
            f"Card {entry['card_number']} is actively linked to "
            f"{other.get('first_name','?')} {other.get('last_name','')}. "
            "Close that assignment first with `assigned_to`.",
        )

    cards.append(entry)
    await db.workers.update_one(
        {"id": worker_id, "org_id": user["org_id"]},
        {"$set": {"smartfill_card_numbers": cards, "updated_at": now_iso()}},
    )
    return {"ok": True, "cards": cards}


@router.delete("/{worker_id}/smartfill-cards/{card_number}", status_code=200)
async def remove_smartfill_card(
    worker_id: str,
    card_number: str,
    user: dict = Depends(get_current_user),
):
    _require_write(user)
    existing = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Worker not found")
    require_scoped_access(user, "workers", existing)
    cards = list(existing.get("smartfill_card_numbers") or [])
    filtered = [c for c in cards if c.get("card_number") != card_number]
    if len(filtered) == len(cards):
        raise HTTPException(404, f"Card {card_number} not linked to this worker")
    await db.workers.update_one(
        {"id": worker_id, "org_id": user["org_id"]},
        {"$set": {"smartfill_card_numbers": filtered, "updated_at": now_iso()}},
    )
    return {"ok": True, "removed": card_number, "cards": filtered}


@router.delete("/{worker_id}", status_code=204)
async def delete_worker(
    worker_id: str,
    request: Request,
    user: dict = Depends(require_permission("workers", "delete")),
):
    # Phase 3.18 — auth now flows through the permissions matrix.
    # v160.3.9.44 (P0-IDOR) — explicit contractor-scope gate.
    existing = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Worker not found")
    require_scoped_access(user, "workers", existing)
    ts = now_iso()
    result = await db.workers.update_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Worker not found")

    # v58.13.28 — Auto-null cascade: any hr_employees still pointing at
    # this now-soft-deleted worker must have `linked_worker_id` cleared
    # so future joins don't dereference a tombstone. The link's
    # historical existence is preserved in the audit trail (one row
    # per affected employee below).
    #
    # Deferred import — hr_employees is peer-router and importing it
    # at module scope would risk load-order weirdness during test
    # harness setup that mocks the workers module in isolation.
    from hr_employees import _audit as _hr_audit
    affected = []
    async for e in db.hr_employees.find(
        {"linked_worker_id": worker_id, "deleted_at": None},
        {"_id": 0, "id": 1, "employee_id": 1,
         "linked_worker_name": 1},
    ):
        affected.append(e)
    if affected:
        upd = await db.hr_employees.update_many(
            {"linked_worker_id": worker_id, "deleted_at": None},
            {"$set": {"linked_worker_id": None,
                      "linked_worker_name": None,
                      "updated_at": ts}},
        )
        log.info(
            "v58.13.28 cascade: worker %s soft-deleted → unlinked %d hr_employees",
            worker_id, upd.modified_count,
        )
        worker_name = (
            f"{existing.get('first_name','')} {existing.get('last_name','')}".strip()
        )
        for e in affected:
            await _hr_audit(
                actor=user, request=request,
                action="worker_unlinked_via_cascade",
                employee_id=e.get("employee_id"),
                target_uid=e.get("id"),
                extra={
                    "prev_worker_id": worker_id,
                    "prev_worker_name": e.get("linked_worker_name") or worker_name,
                    "reason": "worker_soft_deleted",
                },
            )
    return None


# v58.13.132fy — Restore a soft-deleted / deactivated worker.
#
# Companion to the `?include_inactive=true` list flag: once an admin
# spots a worker in the "Show inactive" toggle they need a one-click
# path back to active state. Clears `deleted_at`, plus the legacy
# `deactivated_at` / `soft_deleted` flags some older rows still carry
# from the pre-v58.13 archive-refactor. Writes an `archive_audit` row
# so the paper trail matches the `bulk_archive` / `unarchive` patterns
# used elsewhere (see `visitor_signins.admin_unarchive_visitor`).
#
# Admin-only — mirrors the soft-delete permission (`workers.delete`)
# but tightens further to `role == "admin"` because HSEQ leads can
# archive but not resurrect. Idempotent: restoring an already-active
# worker returns `{already_active: true}` without a duplicate audit row.
@router.post("/{worker_id}/restore")
async def restore_worker(
    worker_id: str,
    request: Request,
    body: Optional[dict] = None,
    user: dict = Depends(require_permission("workers", "delete")),
):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    existing = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"]},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Worker not found")
    require_scoped_access(user, "workers", existing)

    inactive = (
        existing.get("deleted_at")
        or existing.get("deactivated_at")
        or existing.get("soft_deleted")
    )
    if not inactive:
        return {"worker_id": worker_id, "already_active": True}

    ts = now_iso()
    reason = (body or {}).get("reason")
    await db.workers.update_one(
        {"id": worker_id, "org_id": user["org_id"]},
        {"$set": {
            "deleted_at": None,
            "deactivated_at": None,
            "soft_deleted": False,
            "active": True,
            "updated_at": ts,
        }},
    )
    import uuid as _uuid
    await db.archive_audit.insert_one({
        "id": str(_uuid.uuid4()),
        "module": "workers",
        "actor_user_id": user["id"],
        "actor_email": user.get("email"),
        "action": "restore",
        "batch_id": "",
        "criteria": {"item_id": worker_id, "collection": "workers"},
        "affected_count": 1,
        "reason": reason,
        "timestamp": ts,
    })
    log.info(
        "v58.13.132fy worker_restore id=%s actor=%s org=%s",
        worker_id, user["id"], user["org_id"],
    )
    return {
        "worker_id": worker_id,
        "already_active": False,
        "restored_at": ts,
    }


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
    # v160.3.9.43 — SEC-003 sweep: hydrate encrypted secrets on read.
    # `api_token` and `api_base_url` are now stored as `<field>_encrypted`
    # under v40; the raw `doc["config"]` no longer contains plaintext.
    from integrations import hydrate_integration_config
    cfg = hydrate_integration_config(doc)
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
# v58.13.132i — Worker self-edit (PATCH /api/me/worker-profile)
#
# Lets the worker update a WHITELISTED set of their own personal
# fields from mobile. Non-whitelisted fields are silently dropped.
# Every change writes a `worker_change_log` row for audit.
# ─────────────────────────────────────────────────────────────

_SELF_EDIT_WHITELIST = frozenset({
    "preferred_name", "phone", "mobile", "email",
    "street_address", "suburb", "state", "postal_code", "country",
    "next_of_kin", "emergency_contact",
})


class SelfEditBody(BaseModel):
    preferred_name: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=40)
    mobile: Optional[str] = Field(default=None, max_length=40)
    email: Optional[str] = Field(default=None, max_length=160)
    street_address: Optional[str] = Field(default=None, max_length=200)
    suburb: Optional[str] = Field(default=None, max_length=120)
    state: Optional[str] = Field(default=None, max_length=8)
    postal_code: Optional[str] = Field(default=None, max_length=10)
    country: Optional[str] = Field(default=None, max_length=80)
    next_of_kin: Optional[dict] = None
    emergency_contact: Optional[dict] = None


@me_router.patch("/worker-profile")
async def self_edit_worker_profile(body: SelfEditBody, user: dict = Depends(get_current_user)):
    org_id = user["org_id"]
    email_lower = (user.get("email") or "").lower()
    query = {
        "org_id": org_id, "deleted_at": None,
        "$or": [{"user_id": user["id"]}] + ([{"email": email_lower}] if email_lower else []),
    }
    worker = await db.workers.find_one(query, {"_id": 0})
    if not worker:
        raise HTTPException(404, "No linked worker record found")

    payload_raw = body.model_dump(exclude_unset=True)
    # Whitelist filter — silently drop non-whitelisted fields
    payload = {k: v for k, v in payload_raw.items() if k in _SELF_EDIT_WHITELIST}
    if not payload:
        raise HTTPException(400, "No editable fields supplied")

    # Validate next_of_kin / emergency_contact shape
    for nok_field in ("next_of_kin", "emergency_contact"):
        if nok_field in payload and payload[nok_field] is not None:
            nok = payload[nok_field]
            if not isinstance(nok, dict):
                raise HTTPException(422, f"{nok_field} must be an object")
            # Keep only allowed sub-keys
            payload[nok_field] = {
                "name": str(nok.get("name") or "")[:80],
                "phone": str(nok.get("phone") or "")[:40],
                "relationship": str(nok.get("relationship") or "")[:60],
            }

    # Write change log rows
    now = now_iso()
    for field, new_val in payload.items():
        old_val = worker.get(field)
        if old_val != new_val:
            await db.worker_change_log.insert_one({
                "id": new_id(),
                "org_id": org_id,
                "worker_id": worker["id"],
                "field": field,
                "old_value": old_val,
                "new_value": new_val,
                "changed_by": user["id"],
                "changed_by_name": user.get("name") or user.get("email"),
                "source": "mobile_self_edit",
                "timestamp": now,
            })

    payload["updated_at"] = now
    updated = await db.workers.find_one_and_update(
        {"id": worker["id"], "org_id": org_id, "deleted_at": None},
        {"$set": payload},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(404, "Worker update failed")
    return {"ok": True, "worker": _serialise(updated, viewer=user)}
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
    # v58.13.71 — Repointed to the DEFAULT `fs` bucket. The 8 existing
    # worker photos on preview already live in `fs`; the historical
    # `bk_fs` write path (v160.3.9.34.3) predates the disk-bloat
    # cleanup pass and shared the bucket with backup snapshots, which
    # was semantically wrong and made the preview DB unprunable.
    # `simpro_zip_import.py::_fs_bucket()` also now writes to `fs`
    # (same ship), so the reader/writer parity that .34.3 was
    # solving is preserved — just on the correct bucket.
    return AsyncIOMotorGridFSBucket(db.client[db.name], bucket_name="fs")


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


