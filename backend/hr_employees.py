"""v160.3.9.48 — HR Employees register (Active + Archived).

STRICT PII controls (v48 rewrite):
  - Every endpoint is gated by `require_permission("hr_employees", <action>)`.
    Legacy `require_roles("admin")` gates are RETIRED — the six new
    permission tokens (`view`, `edit`, `reveal_pii`, `archive`,
    `reimport`, `audit_view`) let admins hand out narrow slices of
    HR access via role tokens / per-user overrides.
  - Every read (list, get, columns) writes an audit row so we have
    a permanent trail of who saw which PII when.
  - DOB, street-address, and next-of-kin phone fields are masked by
    default; reveal endpoints return the raw values *and* log a
    dedicated `reveal-dob` / `reveal-address` / `reveal-next-of-kin`
    audit row per record + actor.
  - Ingest-time detection of a leaked plaintext password in the Notes
    column emits a `security_flag_detected` audit row at ingest time
    (`scripts/import_hr_employees.py`) so we retain a permanent
    record independent of the surfaced UI banner.
  - `linked_worker_id` is RESERVED on the schema for the P2
    Employee↔Worker linker. Not written or read by any endpoint yet —
    just tolerated in patch payloads.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel

from auth import get_current_user  # noqa: F401 — kept for future non-gated helpers
from db import db
from permissions import require_permission

log = logging.getLogger("paneltec.hr_employees")

router = APIRouter(prefix="/hr/employees", tags=["hr-employees"])

# Reveal-only PII field lists (mirrored on the frontend).
_DOB_FIELDS = {"date_of_birth"}
_ADDRESS_FIELDS = {"address_line_1", "address_line_2"}
_NEXT_OF_KIN_PHONE_FIELDS = {
    "next_of_kin_phone_number",
    "next_of_kin_secondary_phone_number",
}


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
    for token in s.replace("T", "-").split("-"):
        if len(token) == 4 and token.isdigit():
            return f"**/**/{token}"
    return "**/**/****"


def _mask_phone(v: Optional[str]) -> Optional[str]:
    """Preserve last-4 digits, mask the rest. `0412 345 678` → `••• ••• 678`."""
    if not v:
        return None
    digits = [c for c in str(v) if c.isdigit()]
    if len(digits) <= 4:
        return "•" * len(digits)
    keep = "".join(digits[-4:])
    return f"••• ••• {keep}"


def _redact_record(doc: dict) -> dict:
    """Strip DOB / street-address / next-of-kin-phone values from an
    outgoing document. Suburb / state / postcode / country stay visible;
    next-of-kin name + relationship stay visible."""
    if not doc:
        return doc
    out = dict(doc)
    if "date_of_birth" in out:
        out["date_of_birth_masked"] = _mask_dob(out.pop("date_of_birth"))
    for k in list(_ADDRESS_FIELDS):
        if k in out:
            out[f"{k}_masked"] = "•••" if out.get(k) else None
            del out[k]
    for k in list(_NEXT_OF_KIN_PHONE_FIELDS):
        if k in out:
            out[f"{k}_masked"] = _mask_phone(out.get(k))
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
    user: dict = Depends(require_permission("hr_employees", "view")),
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

    # v48 — security-flag banner signal. Any employee with a
    # `security_flag` field set (leaked_password_in_notes, etc.) OR a
    # `security_flag_detected` audit row is counted here so the FE can
    # render the banner without a second round-trip.
    security_flag_count = await db.hr_employees.count_documents(
        {"deleted_at": None, "security_flag": {"$ne": None, "$exists": True}}
    )

    await _audit(actor=user, request=request, action="list",
                 extra={"count": len(items), "filters": {
                     "q": q, "business_unit": business_unit,
                     "employment_status": employment_status,
                     "terminated": terminated, "archived": archived,
                     "manager": manager}})
    return {
        "items": items, "total": total,
        "limit": limit, "offset": offset,
        "security_flag_count": security_flag_count,
    }


@router.get("/columns")
async def columns(
    request: Request,
    user: dict = Depends(require_permission("hr_employees", "view")),
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
    for f in _NEXT_OF_KIN_PHONE_FIELDS:
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
    user: dict = Depends(require_permission("hr_employees", "audit_view")),
):
    """Read the audit trail — gated by `hr_employees.audit_view` (auditor
    role holds this WITHOUT `reveal_pii`)."""
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


# v58.13.29 — GET /linked. Enumerates currently-linked employees for
# the bulk-unlink wizard. Placed BEFORE `/{uid}` (line ~260) so the
# 1-segment literal path wins the router match against the 1-segment
# path-param route.
@router.get("/linked")
async def list_linked_employees(
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    """Return every hr_employee with a non-null `linked_worker_id`.

    Shape:
      {items: [{employee_id, employee_name, worker_id, worker_name,
                linked_at?}], total: N}

    Excludes soft-deleted employees. Hard-capped at 1000 for safety.
    Gated by `hr_employees.edit` (same as the linker endpoints).
    """
    items: list[dict] = []
    async for e in db.hr_employees.find(
        {"deleted_at": None,
         "linked_worker_id": {"$ne": None, "$exists": True}},
        {"_id": 0, "id": 1, "employee_id": 1,
         "first_name": 1, "last_name": 1,
         "linked_worker_id": 1, "linked_worker_name": 1,
         "updated_at": 1},
    ):
        wid = e.get("linked_worker_id")
        if not wid:  # defence-in-depth against {"": "..."} edge cases
            continue
        items.append({
            "employee_id": e["id"],
            "employee_name": f"{e.get('first_name','')} {e.get('last_name','')}".strip(),
            "worker_id": wid,
            "worker_name": e.get("linked_worker_name") or wid,
            "linked_at": e.get("updated_at"),
        })
        if len(items) >= 1000:
            break
    items.sort(key=lambda r: r["employee_name"].lower())
    return {"items": items, "total": len(items)}


@router.get("/{uid}")
async def get_employee(
    uid: str, request: Request,
    user: dict = Depends(require_permission("hr_employees", "view")),
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
    user: dict = Depends(require_permission("hr_employees", "reveal_pii")),
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
    user: dict = Depends(require_permission("hr_employees", "reveal_pii")),
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


@router.post("/{uid}/reveal-next-of-kin")
async def reveal_next_of_kin(
    uid: str, request: Request,
    user: dict = Depends(require_permission("hr_employees", "reveal_pii")),
):
    """v48 — Reveal next-of-kin PII (phone numbers unmasked). Name /
    relationship stay visible in the list projection; this endpoint
    returns the raw phone numbers plus a defence-in-depth full block."""
    doc = await db.hr_employees.find_one(
        {"$or": [{"id": uid}, {"employee_id": uid}], "deleted_at": None},
        {"_id": 0, "id": 1, "employee_id": 1,
         "next_of_kin_first_name": 1, "next_of_kin_last_name": 1,
         "next_of_kin_relationship": 1,
         "next_of_kin_phone_number": 1,
         "next_of_kin_secondary_phone_number": 1})
    if not doc:
        raise HTTPException(404, "not-found")
    await _audit(actor=user, request=request, action="reveal-next-of-kin",
                 employee_id=doc.get("employee_id"), target_uid=doc.get("id"))
    return {
        "employee_id": doc.get("employee_id"),
        "next_of_kin_first_name": doc.get("next_of_kin_first_name"),
        "next_of_kin_last_name": doc.get("next_of_kin_last_name"),
        "next_of_kin_relationship": doc.get("next_of_kin_relationship"),
        "next_of_kin_phone_number": doc.get("next_of_kin_phone_number"),
        "next_of_kin_secondary_phone_number": doc.get(
            "next_of_kin_secondary_phone_number"),
    }


class RowPatch(BaseModel):
    class Config:
        extra = "allow"


@router.patch("/{uid}")
async def patch_employee(
    uid: str, patch: RowPatch, request: Request,
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    # `linked_worker_id` is RESERVED for the P2 Employee↔Worker linker.
    # Not blocked from patches — admins may set it manually via curl —
    # but no endpoint reads it yet. Documented here so the review
    # trail is honest about the field's status.
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


@router.post("/{uid}/archive")
async def archive_employee(
    uid: str, request: Request,
    user: dict = Depends(require_permission("hr_employees", "archive")),
):
    """v48 — Semantic split with DELETE: `archive` sets
    `archived="Archived"` (idempotent, second call is a no-op).
    Does NOT set `deleted_at` — the row stays visible under the
    Archived tab. Restore is a PATCH that flips `archived` back."""
    r = await db.hr_employees.find_one_and_update(
        {"$or": [{"id": uid}, {"employee_id": uid}], "deleted_at": None},
        {"$set": {"archived": "Archived", "updated_at": _now()}},
        projection={"_id": 0}, return_document=True)
    if not r:
        raise HTTPException(404, "not-found")
    await _audit(actor=user, request=request, action="archive",
                 employee_id=r.get("employee_id"), target_uid=r.get("id"))
    return {"archived": True, "employee_id": r.get("employee_id"),
            "archived_status": r.get("archived")}


@router.delete("/{uid}")
async def delete_employee(
    uid: str, request: Request,
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    """Soft-delete. Sets `deleted_at` (the row disappears from every
    list endpoint) but PRESERVES the existing `archived` value so the
    semantic split with `POST /archive` is clear: archive keeps the
    row visible under the Archived tab; delete hides it entirely."""
    now = _now()
    r = await db.hr_employees.find_one_and_update(
        {"$or": [{"id": uid}, {"employee_id": uid}], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
        projection={"_id": 0}, return_document=True)
    if not r:
        raise HTTPException(404, "not-found")
    await _audit(actor=user, request=request, action="soft-delete",
                 employee_id=r.get("employee_id"), target_uid=r.get("id"))
    return {"deleted": True, "employee_id": r.get("employee_id"),
            "archived_preserved": r.get("archived")}


@router.post("/refresh-from-source")
async def refresh_from_source(
    request: Request,
    user: dict = Depends(require_permission("hr_employees", "reimport")),
):
    """v160.3.9.49 — Re-parse the on-disk `hr_employees_source.xlsx` and
    upsert every row. Same permission gate as `reimport` — same
    audit-trail semantics. Useful when the source file has been
    manually replaced but no HTTP upload is desired.

    Returns the standard `{source_bytes, parsed_rows, live_total,
    inserted, updated, unchanged, security_flags}` shape so the
    frontend Refresh button can render a single-line toast.
    """
    from pathlib import Path as _P
    src = (_P(__file__).resolve().parent / "scripts" / "data"
           / "hr_employees_source.xlsx")
    if not src.exists():
        raise HTTPException(404, "source-xlsx-missing")
    from scripts.import_hr_employees import (
        parse_workbook, upsert_rows, ensure_indexes as _idx)
    await _idx()
    rows, security_flags = parse_workbook(src)
    stats = await upsert_rows(rows, actor_id=user["id"],
                              security_flags=security_flags)
    total = await db.hr_employees.count_documents({"deleted_at": None})
    await _audit(actor=user, request=request, action="refresh-from-source",
                 extra={"parsed_rows": len(rows), "stats": stats})
    return {"source_bytes": src.stat().st_size, "parsed_rows": len(rows),
            "live_total": total, **stats}


@router.post("/reimport")
async def reimport(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    url: Optional[str] = Form(default=None),
    user: dict = Depends(require_permission("hr_employees", "reimport")),
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


# v58.13.25 — Employee ↔ Worker linker endpoints (originally shipped).
# v58.13.26 — Ranker rewritten around the composite normaliser in
# `name_matching.py`. Case-mismatch bug fixed (workers 88% ALL-CAPS,
# hr_employees 100% Mixed-case had produced 0 raw ratio hits ≥0.75).
# Fuzzy tier removed deliberately per Pass 1 diagnostic (80% FP-rate
# in the 0.60–0.79 band). Two new bulk endpoints added:
#   * GET  /link-candidates/bulk — auto_matches[] + no_match[].
#   * POST /link-worker/bulk     — commits per-employee via the same
#                                  code path as the single endpoint.
# _audit() calls corrected to use the canonical (employee_id, target_uid)
# kwargs — v58.13.25 was passing an unknown `target_id=…` that would
# have raised TypeError at runtime on the first real hit (no live hits
# had happened yet, per pre-ship count linked_worker_id=0).

from pydantic import BaseModel  # noqa: E402  (already imported above; harmless)

from name_matching import find_matches  # noqa: E402


class LinkWorkerIn(BaseModel):
    worker_id: str


class BulkLinkItem(BaseModel):
    employee_id: str
    worker_id: str
    tier: Optional[str] = None  # advisory only, ignored server-side


class BulkLinkIn(BaseModel):
    links: list[BulkLinkItem]


def _worker_display(w: dict) -> str:
    return f"{w.get('first_name','')} {w.get('last_name','')}".strip()


def _emp_display(e: dict) -> str:
    return f"{e.get('first_name','')} {e.get('last_name','')}".strip()


async def _link_worker_inner(
    *, eid: str, worker_id: str, user: dict, request: Request,
) -> dict:
    """Shared implementation for single + bulk link. Raises HTTPException
    on any failure (404 employee / 404 worker / 409 collision). Returns
    the {ok, linked_worker_id, linked_worker_name} shape on success."""
    org_id = user["org_id"]
    emp = await db.hr_employees.find_one({"id": eid, "deleted_at": None})
    if not emp:
        raise HTTPException(404, "employee-not-found")
    worker = await db.workers.find_one({"id": worker_id,
                                        "org_id": org_id,
                                        "deleted_at": None})
    if not worker:
        raise HTTPException(404, "worker-not-found")
    # Uniqueness collision (same worker → different employee).
    collision = await db.hr_employees.find_one({
        "linked_worker_id": worker_id,
        "id": {"$ne": eid}, "deleted_at": None,
    }, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1})
    if collision:
        raise HTTPException(409, {
            "error": "worker-already-linked",
            "linked_to_employee_id": collision["id"],
            "linked_to_employee_name": _emp_display(collision),
        })
    worker_name = _worker_display(worker)
    await db.hr_employees.update_one(
        {"id": eid},
        {"$set": {"linked_worker_id": worker_id,
                  "linked_worker_name": worker_name,
                  "updated_at": _now()}},
    )
    await _audit(actor=user, request=request, action="link_worker",
                 employee_id=emp.get("employee_id"), target_uid=eid,
                 extra={"worker_id": worker_id, "worker_name": worker_name})
    return {"ok": True, "linked_worker_id": worker_id,
            "linked_worker_name": worker_name}


@router.patch("/{eid}/link-worker")
async def link_worker(
    eid: str,
    body: LinkWorkerIn,
    request: Request,
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    return await _link_worker_inner(
        eid=eid, worker_id=body.worker_id, user=user, request=request,
    )


@router.patch("/{eid}/unlink-worker")
async def unlink_worker(
    eid: str,
    request: Request,
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    return await _unlink_worker_inner(eid=eid, user=user, request=request)


async def _unlink_worker_inner(
    *, eid: str, user: dict, request: Request,
) -> dict:
    """v58.13.29 — Shared implementation for single + bulk unlink.
    Idempotent: clearing an already-null link is a 200 no-op. Raises
    HTTPException(404) when the employee doesn't exist."""
    emp = await db.hr_employees.find_one({"id": eid, "deleted_at": None},
                                         {"_id": 0, "id": 1,
                                          "employee_id": 1,
                                          "linked_worker_id": 1,
                                          "linked_worker_name": 1})
    if not emp:
        raise HTTPException(404, "employee-not-found")
    prev = emp.get("linked_worker_id")
    await db.hr_employees.update_one(
        {"id": eid},
        {"$set": {"linked_worker_id": None,
                  "linked_worker_name": None,
                  "updated_at": _now()}},
    )
    if prev:
        await _audit(actor=user, request=request, action="unlink_worker",
                     employee_id=emp.get("employee_id"), target_uid=eid,
                     extra={"prev_worker_id": prev,
                            "prev_worker_name": emp.get("linked_worker_name")})
    return {"ok": True, "was_linked": bool(prev)}


class BulkUnlinkIn(BaseModel):
    employee_ids: list[str]


@router.post("/unlink-worker/bulk")
async def unlink_worker_bulk(
    body: BulkUnlinkIn,
    request: Request,
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    """v58.13.29 — Fan-out unlink via the shared inner handler.
    Per-item try/except so one 404 doesn't kill the batch. Response
    mirrors the v58.13.26 bulk-link shape:
      {succeeded: N, failed: [{employee_id, error}]}

    Already-unlinked employees are counted in `succeeded` (idempotent).
    """
    succeeded = 0
    failed: list[dict] = []
    for eid in body.employee_ids:
        try:
            await _unlink_worker_inner(eid=eid, user=user, request=request)
            succeeded += 1
        except HTTPException as e:
            detail = e.detail
            err = detail if isinstance(detail, str) else str(detail)
            failed.append({"employee_id": eid, "error": err})
        except Exception as e:  # last-resort safety net
            log.exception("bulk unlink unexpected error")
            failed.append({"employee_id": eid, "error": str(e)})
    return {"succeeded": succeeded, "failed": failed}


# ---------------------------------------------------------------------------
# Helpers for the ranker + bulk endpoints
# ---------------------------------------------------------------------------
async def _load_linked_worker_ids(org_id: str) -> set[str]:
    """All worker_ids currently pointed at by any non-deleted employee."""
    linked: set[str] = set()
    async for d in db.hr_employees.find(
        {"deleted_at": None,
         "linked_worker_id": {"$ne": None, "$exists": True}},
        {"_id": 0, "linked_worker_id": 1},
    ):
        wid = d.get("linked_worker_id")
        if wid:
            linked.add(wid)
    return linked


async def _load_active_workers(org_id: str,
                               exclude_ids: set[str]) -> list[dict]:
    """Fetch active + not-deleted workers, excluding already-linked ids."""
    out: list[dict] = []
    async for w in db.workers.find(
        {"org_id": org_id, "deleted_at": None, "active": True},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1,
         "position": 1, "email": 1, "simpro_employee_id": 1},
    ):
        if w["id"] in exclude_ids:
            continue
        out.append(w)
    return out


@router.get("/link-candidates/bulk")
async def link_candidates_bulk(
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    """v58.13.26 — Bulk composite-normalised match proposals.

    Returns two lists:
      * `auto_matches[]` — employees with an unambiguous 3-tier hit
        (email → norm_basic → norm_lfi). First-come-first-served on
        worker_id collisions (rare — 0 on live data).
      * `no_match[]`     — employees with no exact-normalised worker.

    Excludes already-linked employees and soft-deleted / inactive
    workers. Hard-capped at 1000 employees for safety.
    """
    org_id = user["org_id"]

    # Load all unlinked non-deleted employees (deterministic order).
    employees: list[dict] = []
    async for e in db.hr_employees.find(
        {"deleted_at": None,
         "linked_worker_id": {"$in": [None]}},
        {"_id": 0, "id": 1, "employee_id": 1,
         "first_name": 1, "last_name": 1, "email": 1},
    ):
        employees.append(e)
        if len(employees) >= 1000:
            break
    employees.sort(key=lambda e: (
        (e.get("last_name") or "").lower(),
        (e.get("first_name") or "").lower(),
        e.get("id") or "",
    ))

    linked = await _load_linked_worker_ids(org_id)
    workers = await _load_active_workers(org_id, linked)

    auto_matches: list[dict] = []
    no_match: list[dict] = []
    consumed_worker_ids: set[str] = set()

    for e in employees:
        pool = [w for w in workers if w["id"] not in consumed_worker_ids]
        r = find_matches(
            e.get("first_name") or "",
            e.get("last_name") or "",
            e.get("email"),
            pool,
        )
        if r is None:
            no_match.append({
                "employee_id": e["id"],
                "employee_name": _emp_display(e),
            })
            continue
        w = r["worker"]
        consumed_worker_ids.add(w["id"])
        auto_matches.append({
            "employee_id": e["id"],
            "employee_name": _emp_display(e),
            "worker_id": w["id"],
            "worker_name": _worker_display(w),
            "tier": r["tier"],
        })

    return {"auto_matches": auto_matches, "no_match": no_match}


@router.post("/link-worker/bulk")
async def link_worker_bulk(
    body: BulkLinkIn,
    request: Request,
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    """v58.13.26 — Fan out N link requests through the shared inner
    handler. Per-link try/except so one failure doesn't kill the batch.
    Uniqueness collisions and 404s land in `failed[]`; all successful
    links write an audit row via the same code path as the single
    endpoint."""
    succeeded = 0
    failed: list[dict] = []
    for item in body.links:
        try:
            await _link_worker_inner(
                eid=item.employee_id,
                worker_id=item.worker_id,
                user=user,
                request=request,
            )
            succeeded += 1
        except HTTPException as e:
            detail = e.detail
            if isinstance(detail, dict):
                err = detail.get("error", str(detail))
            else:
                err = str(detail)
            failed.append({"employee_id": item.employee_id, "error": err})
        except Exception as e:  # last-resort safety net
            log.exception("bulk link unexpected error")
            failed.append({"employee_id": item.employee_id, "error": str(e)})
    return {"succeeded": succeeded, "failed": failed}


@router.get("/{eid}/link-candidates")
async def link_candidates(
    eid: str,
    limit: int = 10,  # noqa: ARG001 — retained for FE back-compat
    user: dict = Depends(require_permission("hr_employees", "edit")),
):
    """v58.13.26 — Single-record ranker rewritten around `find_matches`.

    Returns AT MOST ONE candidate — the composite-normaliser hit at
    similarity=1.0 with its `tier`. Empty candidates + reason hint
    when there's no exact match; the FE `WorkerLinkModal` browse-all
    list handles the manual fallback.

    NO fuzzy tier. The v58.13.25 SequenceMatcher ≥0.75 path is
    deliberately gone — 80% false-positives in the 0.60–0.79 band on
    live data, and 0 hits at ≥0.75 due to the case-mismatch bug.
    """
    org_id = user["org_id"]
    emp = await db.hr_employees.find_one({"id": eid, "deleted_at": None},
                                         {"_id": 0, "first_name": 1,
                                          "last_name": 1, "email": 1})
    if not emp:
        raise HTTPException(404, "employee-not-found")

    linked = await _load_linked_worker_ids(org_id)
    workers = await _load_active_workers(org_id, linked)

    r = find_matches(
        emp.get("first_name") or "",
        emp.get("last_name") or "",
        emp.get("email"),
        workers,
    )
    if r is None:
        return {"target": {"first_name": emp.get("first_name"),
                           "last_name": emp.get("last_name")},
                "candidates": [],
                "reason": "no_exact_match",
                "suggestion": "browse_all"}
    w = r["worker"]
    return {"target": {"first_name": emp.get("first_name"),
                       "last_name": emp.get("last_name")},
            "candidates": [{
                "id": w["id"],
                "name": _worker_display(w),
                "position": w.get("position"),
                "email": w.get("email"),
                "simpro_employee_id": w.get("simpro_employee_id"),
                "similarity": 1.0,
                "tier": r["tier"],
            }]}
