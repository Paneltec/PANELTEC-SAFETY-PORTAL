"""Workers — field-ops people imported from Simpro or created manually.

Phase 1: identity + contact + sync.
Phase 2: address + birth date + 7-day availability + Simpro client_ids.
"""
from __future__ import annotations
import re
from typing import Optional, Literal, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from pymongo import ReturnDocument

from auth import get_current_user
from permissions import require_permission
from db import db
from models import new_id, now_iso

from permissions import require_permission, resolve_team_scope, require_module

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


def _serialise(doc: dict) -> dict:
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
    return out


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
    role_key = (user.get("role") or "").lower()
    supervisor_privileged = role_key == "supervisor"
    admin_privileged = role_key in {"admin", "hseq_lead"}
    if scope == "me" or (not admin_privileged and not supervisor_privileged):
        me = await db.workers.find_one(
            {"org_id": user["org_id"], "user_id": user["id"], "deleted_at": None},
            {"_id": 0},
        )
        if not me:
            # Fall back: try matching by email (Simpro-linked workers may not
            # carry a `user_id` link).
            me = await db.workers.find_one(
                {"org_id": user["org_id"], "email": (user.get("email") or "").lower(), "deleted_at": None},
                {"_id": 0},
            )
        return [_serialise(me)] if me else []

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
    role_key = (user.get("role") or "").lower()
    privileged = role_key in {"admin", "hseq_lead", "supervisor"}
    doc = await db.workers.find_one(
        {"id": worker_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Worker not found")
    if not privileged:
        owns = (doc.get("user_id") == user["id"]) or (
            (doc.get("email") or "").lower() == (user.get("email") or "").lower()
            and bool(user.get("email"))
        )
        if not owns:
            raise HTTPException(403, "Permission denied: workers.view")
    return _serialise(doc)


@router.post("", status_code=201)
async def create_worker(body: WorkerIn, user: dict = Depends(get_current_user)):
    _require_write(user)
    payload = body.model_dump()
    payload["availability"] = _validate_availability(payload.get("availability"))
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "simpro_employee_id": None, "simpro_company_id": None,
        "source": "manual",
        **payload,
        # Default country to Australia when absent.
        "country": payload.get("country") or "Australia",
        "client_ids": payload.get("client_ids") or [],
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.workers.insert_one(doc)
    return _serialise(doc)


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
    return _serialise(result)


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
