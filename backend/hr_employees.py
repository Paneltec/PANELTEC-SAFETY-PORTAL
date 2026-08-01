"""v160.3.9.21 — HR Employees register (Active + Archived).

STRICT PII controls:
  - Every endpoint is admin-only via `require_roles("admin")`.
  - Every read (list, get, columns) writes an audit row so we have
    a permanent trail of who saw which PII when.
  - DOB and street-address fields are masked by default; reveal endpoints
    return the raw values *and* log a dedicated `reveal-dob` /
    `reveal-address` audit row per record + actor.
  - Ingest-time detection of a leaked plaintext password in the Notes
    column emits a `security_flag_detected` audit row at ingest time
    (in `scripts/import_hr_employees.py`) so we retain a permanent
    record independent of the surfaced UI banner.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel

from auth import get_current_user, require_roles
from db import db

log = logging.getLogger("paneltec.hr_employees")

router = APIRouter(prefix="/hr/employees", tags=["hr-employees"])

# Reveal-only PII field lists (mirrored on the frontend).
_DOB_FIELDS = {"date_of_birth"}
_ADDRESS_FIELDS = {"address_line_1", "address_line_2"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _audit(*, actor: dict, request: Request, action: str,
                 employee_id: Optional[str] = None,
                 target_uid: Optional[str] = None,
                 extra: Optional[dict] = None) -> None:
    """Insert a row into `hr_employees_audit`.
    Reads (list/get/columns) *and* writes both flow through here.
    """
    doc = {
        "id": str(uuid.uuid4()),
        "at": _now(),
        "actor_id": actor.get("id"),
        "actor_email": actor.get("email"),
        "actor_role": actor.get("role"),
        "ip": _client_ip(request),
        "user_agent": request.headers.get("user-agent", "")[:400],
        "action": action,
        "employee_id": employee_id,
        "target_uid": target_uid,
    }
    if extra:
        doc["extra"] = extra
    try:
        await db.hr_employees_audit.insert_one(doc)
    except Exception as e:
        log.warning("hr_employees_audit insert failed: %s", e)


def _mask_dob(iso_or_str: Optional[str]) -> Optional[str]:
    if not iso_or_str:
        return None
    s = str(iso_or_str)
    # ISO 2016-01-12 or "1966-01-12T00:00:00" — grab the last 4 digits when they look like a year.
    for token in s.replace("T", "-").split("-"):
        if len(token) == 4 and token.isdigit():
            return f"**/**/{token}"
    return "**/**/****"


def _redact_record(doc: dict) -> dict:
    """Strip DOB / street-address values from an outgoing document.
    Suburb / state / postcode / country stay visible."""
    if not doc:
        return doc
    out = dict(doc)
    if "date_of_birth" in out:
        out["date_of_birth_masked"] = _mask_dob(out.pop("date_of_birth"))
    for k in list(_ADDRESS_FIELDS):
        if k in out:
            out[f"{k}_masked"] = "•••" if out.get(k) else None
            del out[k]
    return out


async def ensure_indexes() -> None:
    try:
        await db.hr_employees.create_index("employee_id", unique=True)
        await db.hr_employees.create_index("last_name")
        await db.hr_employees.create_index("business_unit")
        await db.hr_employees.create_index("archived")
        await db.hr_employees_audit.create_index("employee_id")
        await db.hr_employees_audit.create_index("actor_id")
        await db.hr_employees_audit.create_index("at")
    except Exception as e:
        log.warning("hr_employees index setup: %s", e)


# ------------------------------------------------------------------ endpoints

@router.get("/")
async def list_employees(
    request: Request,
    q: Optional[str] = None,
    business_unit: Optional[str] = None,
    employment_status: Optional[str] = None,
    terminated: Optional[str] = None,   # yes | no | any
    archived: Optional[str] = None,     # active | archived | any
    manager: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    user: dict = Depends(require_roles("admin")),
):
    query: dict = {"deleted_at": None}
    if business_unit:
        query["business_unit"] = business_unit
    if employment_status:
        query["employment_status"] = employment_status
    if manager:
        query["manager"] = manager
    if terminated in ("yes", "no"):
        query["terminated_employee"] = "Yes" if terminated == "yes" else "No"
    if archived == "active":
        query["archived"] = "Active"
    elif archived == "archived":
        query["archived"] = "Archived"
    if q:
        import re as _re
        pat = _re.escape(q)
        query["$or"] = [
            {"employee_id":  {"$regex": pat, "$options": "i"}},
            {"first_name":   {"$regex": pat, "$options": "i"}},
            {"last_name":    {"$regex": pat, "$options": "i"}},
            {"email":        {"$regex": pat, "$options": "i"}},
            {"username":     {"$regex": pat, "$options": "i"}},
            {"business_unit":{"$regex": pat, "$options": "i"}},
            {"manager":      {"$regex": pat, "$options": "i"}},
        ]
    total = await db.hr_employees.count_documents(query)
    cursor = (db.hr_employees.find(query, {"_id": 0})
              .sort("last_name", 1)
              .skip(offset)
              .limit(min(limit, 1000)))
    items = [_redact_record(r) async for r in cursor]
    await _audit(actor=user, request=request, action="list",
                 extra={"count": len(items), "filters": {
                     "q": q, "business_unit": business_unit,
                     "employment_status": employment_status,
                     "terminated": terminated, "archived": archived,
                     "manager": manager}})
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/columns")
async def columns(
    request: Request,
    user: dict = Depends(require_roles("admin")),
):
    """Sparse-schema helper — union of every field key populated anywhere
    in the collection. Used by the frontend to hide 100%-empty columns.
    """
    keys: set[str] = set()
    async for doc in db.hr_employees.find({"deleted_at": None}, {"_id": 0}):
        for k, v in doc.items():
            if v not in (None, "", []) and k not in {"deleted_at"}:
                keys.add(k)
    # Ensure the redaction-produced masked keys surface too.
    if "date_of_birth" in keys:
        keys.add("date_of_birth_masked")
    for f in _ADDRESS_FIELDS:
        if f in keys:
            keys.add(f"{f}_masked")
    await _audit(actor=user, request=request, action="columns")
    return {"keys": sorted(keys)}


@router.get("/audit")
async def list_audit(
    request: Request,
    employee_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 100,
    user: dict = Depends(require_roles("admin")),
):
    """Read the audit trail — admin can review who's touched what."""
    query: dict = {}
    if employee_id:
        query["employee_id"] = employee_id
    if action:
        query["action"] = action
    cursor = (db.hr_employees_audit.find(query, {"_id": 0})
              .sort("at", -1).limit(min(limit, 500)))
    rows = [r async for r in cursor]
    await _audit(actor=user, request=request, action="audit-view",
                 extra={"count": len(rows), "filter_employee": employee_id})
    return {"items": rows, "total": len(rows)}


@router.get("/{uid}")
async def get_employee(
    uid: str, request: Request,
    user: dict = Depends(require_roles("admin")),
):
    doc = await db.hr_employees.find_one(
        {"$or": [{"id": uid}, {"employee_id": uid}], "deleted_at": None},
        {"_id": 0})
    if not doc:
        raise HTTPException(404, "not-found")
    await _audit(actor=user, request=request, action="get",
                 employee_id=doc.get("employee_id"), target_uid=doc.get("id"))
    return _redact_record(doc)


@router.post("/{uid}/reveal-dob")
async def reveal_dob(
    uid: str, request: Request,
    user: dict = Depends(require_roles("admin")),
):
    doc = await db.hr_employees.find_one(
        {"$or": [{"id": uid}, {"employee_id": uid}], "deleted_at": None},
        {"_id": 0, "id": 1, "employee_id": 1, "date_of_birth": 1})
    if not doc:
        raise HTTPException(404, "not-found")
    await _audit(actor=user, request=request, action="reveal-dob",
                 employee_id=doc.get("employee_id"), target_uid=doc.get("id"))
    return {"employee_id": doc.get("employee_id"),
            "date_of_birth": doc.get("date_of_birth")}


@router.post("/{uid}/reveal-address")
async def reveal_address(
    uid: str, request: Request,
    user: dict = Depends(require_roles("admin")),
):
    doc = await db.hr_employees.find_one(
        {"$or": [{"id": uid}, {"employee_id": uid}], "deleted_at": None},
        {"_id": 0, "id": 1, "employee_id": 1,
         "address_line_1": 1, "address_line_2": 1,
         "suburb": 1, "postcode": 1, "state": 1, "country": 1})
    if not doc:
        raise HTTPException(404, "not-found")
    await _audit(actor=user, request=request, action="reveal-address",
                 employee_id=doc.get("employee_id"), target_uid=doc.get("id"))
    return {
        "employee_id": doc.get("employee_id"),
        "address_line_1": doc.get("address_line_1"),
        "address_line_2": doc.get("address_line_2"),
        "suburb": doc.get("suburb"),
        "postcode": doc.get("postcode"),
        "state": doc.get("state"),
        "country": doc.get("country"),
    }


class RowPatch(BaseModel):
    class Config:
        extra = "allow"


@router.patch("/{uid}")
async def patch_employee(
    uid: str, patch: RowPatch, request: Request,
    user: dict = Depends(require_roles("admin")),
):
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items()
               if k not in {"_id", "id", "content_hash", "employee_id"}}
    if not updates:
        raise HTTPException(400, "no-fields")
    updates["updated_at"] = _now()
    r = await db.hr_employees.find_one_and_update(
        {"$or": [{"id": uid}, {"employee_id": uid}], "deleted_at": None},
        {"$set": updates}, projection={"_id": 0}, return_document=True)
    if not r:
        raise HTTPException(404, "not-found")
    await _audit(actor=user, request=request, action="manual-update",
                 employee_id=r.get("employee_id"), target_uid=r.get("id"),
                 extra={"fields": list(updates.keys())})
    return _redact_record(r)


@router.delete("/{uid}")
async def delete_employee(
    uid: str, request: Request,
    user: dict = Depends(require_roles("admin")),
):
    now = _now()
    r = await db.hr_employees.find_one_and_update(
        {"$or": [{"id": uid}, {"employee_id": uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True)
    if not r:
        raise HTTPException(404, "not-found")
    await _audit(actor=user, request=request, action="soft-delete",
                 employee_id=r.get("employee_id"), target_uid=r.get("id"))
    return {"deleted": True, "employee_id": r.get("employee_id")}


@router.post("/reimport")
async def reimport(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(require_roles("admin")),
):
    if bool(file) == bool(url):
        raise HTTPException(400, "supply-exactly-one-of-file-or-url")
    from pathlib import Path as _P
    dest = (_P(__file__).resolve().parent / "scripts" / "data"
            / "hr_employees_source.xlsx")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if file:
        content = await file.read()
        dest.write_bytes(content)
        size = len(content)
    else:
        import httpx as _h
        async with _h.AsyncClient(follow_redirects=True, timeout=60.0) as c:
            r = await c.get(url)
            r.raise_for_status()
            dest.write_bytes(r.content)
            size = len(r.content)
    from scripts.import_hr_employees import (
        parse_workbook, upsert_rows, ensure_indexes as _idx)
    await _idx()
    rows, security_flags = parse_workbook(dest)
    stats = await upsert_rows(rows, actor_id=user["id"],
                              security_flags=security_flags)
    total = await db.hr_employees.count_documents({"deleted_at": None})
    await _audit(actor=user, request=request, action="reimport",
                 extra={"source_bytes": size, "parsed_rows": len(rows),
                        "stats": stats})
    return {"source_bytes": size, "parsed_rows": len(rows),
            "live_total": total, **stats}
