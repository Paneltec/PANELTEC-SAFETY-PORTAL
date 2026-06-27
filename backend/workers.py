"""Workers — field-ops people imported from Simpro or created manually.

Phase 1: identity + contact + sync. Address / availability / clients live as
empty fields for Phase 2 so we don't need a migration later.
"""
from __future__ import annotations
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/workers", tags=["workers"])

WRITE_ROLES = {"admin", "hseq_lead"}

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


class WorkerIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: Optional[str] = Field(default="", max_length=80)
    email: Optional[str] = Field(default="", max_length=160)
    phone: Optional[str] = Field(default="", max_length=40)
    mobile: Optional[str] = Field(default="", max_length=40)
    position: Optional[str] = Field(default="", max_length=120)
    active: bool = True


class WorkerPatch(BaseModel):
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    last_name: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=40)
    mobile: Optional[str] = Field(default=None, max_length=40)
    position: Optional[str] = Field(default=None, max_length=120)
    active: Optional[bool] = None


class SyncRequest(BaseModel):
    company: Literal["paneltec", "viatec", "both"] = "both"


@router.get("")
async def list_workers(user: dict = Depends(get_current_user)):
    cursor = db.workers.find(
        {"org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    ).sort([("active", -1), ("last_name", 1), ("first_name", 1)])
    rows = await cursor.to_list(2000)
    return [_serialise(r) for r in rows]


@router.post("", status_code=201)
async def create_worker(body: WorkerIn, user: dict = Depends(get_current_user)):
    _require_write(user)
    doc = {
        "id": new_id(), "org_id": user["org_id"],
        "simpro_employee_id": None, "simpro_company_id": None,
        "source": "manual",
        **body.model_dump(),
        # Phase 2 placeholders — leave as None / [] so the upcoming edit
        # modal can flip them on without a schema change.
        "birth_date": None, "country": None, "state": None,
        "street_address": None, "suburb": None, "postal_code": None,
        "additional_notes": None,
        "availability": None, "client_ids": [],
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
async def delete_worker(worker_id: str, user: dict = Depends(get_current_user)):
    _require_write(user, action="delete")
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
    # Resolve which Simpro company IDs to pull from.
    if body.company == "both":
        target_ids = [COMPANY_MAP["paneltec"], COMPANY_MAP["viatec"]]
    else:
        target_ids = [COMPANY_MAP[body.company]]

    # Reuse the existing staff-cache helper — it already fan-outs to /employees/{id}
    # for email/phone/position.
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
                "birth_date": None, "country": None, "state": None,
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

    return {"ok": True, "created": created, "updated": updated, "skipped": skipped,
            "total": len(employees), "company": body.company}
