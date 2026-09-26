"""Mobile Daily-Job Assignments — v58.13.132p0.

Phase 1 of the 5-phase mobile job flow rebuild. The data model is
locked to the 7 SMS fields Stephen's whiteboard emits; nothing else
is invented.

Endpoints (all under `/api/mobile/`):
  POST /daily-jobs                       admin create (single worker)
  POST /daily-jobs/parse-pdf             legacy PDF prefill (untouched)
  GET  /daily-jobs/pdf/{pdf_id}          legacy PDF download (untouched)
  GET  /daily-jobs/today                 caller's active assignment
  POST /daily-jobs/{id}/accept           worker accept
  POST /daily-jobs/{id}/decline          worker decline
  POST /daily-jobs/{id}/signon           Phase 4 stub (501)

Locked schema (see `.132p0` memo):
  id, job_batch_id, worker_id, worker_email, worker_name,
  truck, date, site_name, address, customer, staff[], notes,
  status ∈ {issued, accepted, declined, signed_on, completed},
  issued_at, accepted_at, declined_at, signed_on_at, signed_on_gps,
  site_id, site_lat, site_lng,
  truck_prestart_id, site_prestart_id,
  created_at, updated_at

Purged (task, supervisor_*, truck_name, truck_reg,
is_past_date_fallback) — see `/app/scripts/migrate_132p0_data_model_reset.py`.
"""
from __future__ import annotations
import asyncio
import hashlib
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

from db import db
from auth import get_current_user
from models import now_iso
from sms_parser import coerce_date, today_iso_sydney

log = logging.getLogger("paneltec.mobile.daily_jobs")

router = APIRouter(tags=["mobile-daily-jobs"])

SYDNEY_TZ = ZoneInfo("Australia/Sydney")


# ─────────────── Constants ───────────────

STATUS_ISSUED = "issued"
STATUS_ACCEPTED = "accepted"
STATUS_DECLINED = "declined"
STATUS_SIGNED_ON = "signed_on"
STATUS_COMPLETED = "completed"
VALID_STATUSES = {STATUS_ISSUED, STATUS_ACCEPTED, STATUS_DECLINED,
                  STATUS_SIGNED_ON, STATUS_COMPLETED}
TERMINAL_STATUSES = {STATUS_DECLINED, STATUS_COMPLETED}


# ─────────────── Locked input model ───────────────

class DailyJobCreateIn(BaseModel):
    """Locked contract — exactly the 7 SMS fields plus a worker
    identifier. Unknown keys are IGNORED (`extra="ignore"`) so legacy
    callers that still send `task` / `supervisor_*` / `truck_name` /
    `truck_reg` don't 422 — but nothing they send survives past the
    Pydantic boundary.
    """
    model_config = ConfigDict(extra="ignore")

    # One of these must be supplied.
    worker_id: Optional[str] = None
    worker_email: Optional[str] = None

    # The seven SMS fields.
    truck: Optional[str] = None
    date: Optional[str] = None          # ISO YYYY-MM-DD; defaults to today (Sydney)
    site_name: Optional[str] = None
    address: Optional[str] = None
    customer: Optional[str] = None
    staff: List[str] = Field(default_factory=list)
    notes: Optional[str] = None

    # Admin-only knob to replace an existing (worker, date) row.
    override: bool = False


# ─────────────── Helpers ───────────────

def _require_admin(user: dict) -> None:
    if (user.get("role") or "").lower() != "admin":
        raise HTTPException(403, "Admin role required")


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(doc: dict) -> dict:
    """Strip Mongo `_id` before returning to callers."""
    return {k: v for k, v in doc.items() if k != "_id"}


async def _resolve_worker(
    *, org_id: str, worker_id: Optional[str], worker_email: Optional[str],
) -> Optional[dict]:
    """Resolve a worker/user identity for the create-path. Tries
    `db.users` first (matches the picker feed), then `db.workers`.

    Returns a normalised dict:
        {id, email, name, phone, kind}
    """
    if worker_id:
        u = await db.users.find_one(
            {"id": worker_id, "org_id": org_id},
            {"_id": 0, "id": 1, "email": 1, "name": 1,
             "first_name": 1, "last_name": 1, "mobile": 1, "phone": 1},
        )
        if u:
            return _worker_row(u, kind="user")
        w = await db.workers.find_one(
            {"id": worker_id, "org_id": org_id, "deleted_at": None},
            {"_id": 0, "id": 1, "email": 1,
             "first_name": 1, "last_name": 1, "mobile": 1, "phone": 1},
        )
        if w:
            return _worker_row(w, kind="worker")
    if worker_email:
        needle = worker_email.strip().lower()
        u = await db.users.find_one(
            {"org_id": org_id, "email": {"$regex": f"^{re.escape(needle)}$", "$options": "i"}},
            {"_id": 0, "id": 1, "email": 1, "name": 1,
             "first_name": 1, "last_name": 1, "mobile": 1, "phone": 1},
        )
        if u:
            return _worker_row(u, kind="user")
        w = await db.workers.find_one(
            {"org_id": org_id, "email": {"$regex": f"^{re.escape(needle)}$", "$options": "i"},
             "deleted_at": None},
            {"_id": 0, "id": 1, "email": 1,
             "first_name": 1, "last_name": 1, "mobile": 1, "phone": 1},
        )
        if w:
            return _worker_row(w, kind="worker")
    return None


def _worker_row(r: dict, *, kind: str) -> dict:
    first = (r.get("first_name") or "").strip()
    last = (r.get("last_name") or "").strip()
    full = (r.get("name") or f"{first} {last}").strip() \
        or (r.get("email") or "(unnamed)")
    return {
        "id": r["id"],
        "email": r.get("email"),
        "name": full,
        "phone": r.get("mobile") or r.get("phone"),
        "kind": kind,
    }


async def _geocode_address(address: str) -> Optional[dict]:
    """Best-effort geocode via the existing Nominatim proxy. Returns
    `{lat, lng, display_name}` or None. Never raises — the mobile
    client tolerates missing coords (falls back to the address string
    for the Google Maps deep-link)."""
    if not address or not address.strip():
        return None
    # Import lazily so the module still loads if Nominatim is down.
    try:
        from mobile_daily_jobs_admin import _GEO_CACHE, _GEO_TTL_S  # noqa: WPS437
        import httpx
        import time
        key = address.strip().lower()
        now = time.time()
        hit = _GEO_CACHE.get(key)
        if hit and (now - hit[0]) < _GEO_TTL_S:
            return hit[1]
        url = "https://nominatim.openstreetmap.org/search"
        params = {"q": address, "format": "json", "limit": 1, "countrycodes": "au"}
        headers = {"User-Agent": "Paneltec-Civil-Mobile/1.0"}
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(url, params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
        if not data:
            return None
        top = data[0]
        result = {
            "lat": float(top["lat"]),
            "lng": float(top["lon"]),
            "display_name": top.get("display_name", address),
        }
        _GEO_CACHE[key] = (now, result)
        return result
    except Exception as exc:  # noqa: BLE001
        log.info("geocode failed for %r: %s", address, exc)
        return None


async def _match_site(*, org_id: str, site_name: Optional[str],
                      address: Optional[str]) -> Optional[str]:
    """Best-effort match against `db.sites`. Returns a `sites.id` or None.

    Match by exact name first (case-insensitive), then by
    address_full substring. Only surfaces non-deleted rows.
    """
    if site_name:
        s = await db.sites.find_one(
            {"org_id": org_id, "deleted_at": None,
             "name": {"$regex": f"^{re.escape(site_name.strip())}$", "$options": "i"}},
            {"_id": 0, "id": 1},
        )
        if s:
            return s["id"]
    if address:
        s = await db.sites.find_one(
            {"org_id": org_id, "deleted_at": None,
             "address_full": {"$regex": re.escape(address.strip()), "$options": "i"}},
            {"_id": 0, "id": 1},
        )
        if s:
            return s["id"]
    return None


def build_assignment_doc(
    *, org_id: str, worker: dict, payload: DailyJobCreateIn,
    the_date: str, geocode: Optional[dict], site_id: Optional[str],
    assigned_by_id: Optional[str] = None, job_batch_id: Optional[str] = None,
    meta: Optional[dict] = None,
) -> dict:
    """Assemble the canonical .132p0 assignment doc. Shared between
    the single-create and the bulk-create paths so both surfaces
    produce byte-identical shapes."""
    issued_at = _now_utc_iso()
    return {
        "id": str(uuid.uuid4()),
        "job_batch_id": job_batch_id or str(uuid.uuid4()),
        "org_id": org_id,
        # Worker snapshot — enough to render the tile offline.
        "worker_id": worker["id"],
        "worker_email": worker.get("email"),
        "worker_name": worker["name"],
        # The seven SMS fields.
        "truck": (payload.truck or "").strip() or None,
        "date": the_date,
        "site_name": (payload.site_name or "").strip() or None,
        "address": (payload.address or "").strip() or None,
        "customer": (payload.customer or "").strip() or None,
        "staff": [s.strip() for s in (payload.staff or []) if s and s.strip()],
        "notes": (payload.notes or "").strip() or None,
        # Lifecycle.
        "status": STATUS_ISSUED,
        "issued_at": issued_at,
        "accepted_at": None,
        "declined_at": None,
        "signed_on_at": None,
        "signed_on_gps": None,
        # Geo enrichment.
        "site_id": site_id,
        "site_lat": (geocode or {}).get("lat"),
        "site_lng": (geocode or {}).get("lng"),
        # Phase 3+/5 refs (populated later).
        "truck_prestart_id": None,
        "site_prestart_id": None,
        # Audit + convenience.
        "assigned_by_id": assigned_by_id,
        "created_at": issued_at,
        "updated_at": issued_at,
        "meta": meta or {},
    }


# ─────────────── POST /mobile/daily-jobs ───────────────

@router.post("/mobile/daily-jobs", status_code=201)
async def create_daily_job(body: DailyJobCreateIn,
                           user: dict = Depends(get_current_user)) -> dict:
    _require_admin(user)

    if not body.worker_id and not body.worker_email:
        raise HTTPException(400, "Provide worker_id or worker_email")

    org_id = user["org_id"]
    the_date = coerce_date(body.date) or today_iso_sydney()

    worker = await _resolve_worker(
        org_id=org_id,
        worker_id=body.worker_id,
        worker_email=body.worker_email,
    )
    if not worker:
        raise HTTPException(404, "Worker not found in your org")

    # Duplicate guard on (worker, date).
    existing = await db.daily_job_assignments.find_one(
        {"org_id": org_id, "worker_id": worker["id"], "date": the_date},
        {"_id": 0, "id": 1},
    )
    if existing and not body.override:
        raise HTTPException(
            409,
            "Worker already has an assignment for this date. "
            "Pass override=true to replace.",
        )
    if existing and body.override:
        await db.daily_job_assignments.delete_one({"id": existing["id"]})

    # Geo enrichment — never blocks the create if Nominatim is down.
    geocode = await _geocode_address(body.address or body.site_name or "")
    site_id = await _match_site(
        org_id=org_id,
        site_name=body.site_name,
        address=body.address,
    )

    doc = build_assignment_doc(
        org_id=org_id,
        worker=worker,
        payload=body,
        the_date=the_date,
        geocode=geocode,
        site_id=site_id,
        assigned_by_id=user.get("id"),
        meta={"source": "daily_jobs_single_create"},
    )
    await db.daily_job_assignments.insert_one(doc)
    return _clean(doc)


# ─────────────── Legacy PDF prefill (unchanged; used by AdminAssignDailyJobs) ─

_PDF_PARSE_CACHE: dict = {}
_PDF_PARSE_TTL_S = 5 * 60
MAX_PDF_BYTES = 10 * 1024 * 1024


def _job_pdf_bucket():
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket
    return AsyncIOMotorGridFSBucket(db.client[db.name], bucket_name="job_pdfs")


PDF_SYSTEM = """You are an operations dispatcher parsing Australian civil-
construction job briefs. Extract the following fields from the document
text as STRICT JSON (no markdown fences, no commentary):

{
  "worker_name":  "<person the job is assigned to or null>",
  "date":         "<YYYY-MM-DD or null; today if only weekday is given>",
  "site_name":    "<site or job title or null>",
  "site_address": "<full street + suburb + state or null>",
  "notes":        "<special instructions, materials list, safety notes, or null>"
}

Return null (not empty string) for any field the document doesn't clearly
state. Never invent a worker name."""


async def _pdf_to_text(pdf_bytes: bytes) -> str:
    try:
        import io
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        chunks = []
        for p in reader.pages[:20]:
            try:
                chunks.append(p.extract_text() or "")
            except Exception:
                continue
        return "\n\n".join(chunks).strip()
    except Exception:
        return ""


@router.post("/mobile/daily-jobs/parse-pdf")
async def parse_pdf(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict:
    _require_admin(user)

    filename = (file.filename or "").strip() or "job.pdf"
    if not filename.lower().endswith(".pdf") and (file.content_type or "").lower() != "application/pdf":
        raise HTTPException(400, "Only PDF files are supported")

    hasher = hashlib.sha256()
    buf = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_PDF_BYTES:
            raise HTTPException(413, "PDF exceeds 10 MB limit")
        hasher.update(chunk)
    if not buf:
        raise HTTPException(400, "Empty PDF")
    digest = hasher.hexdigest()

    import time as _t
    now = _t.time()
    hit = _PDF_PARSE_CACHE.get(digest)
    if hit and (now - hit[0]) < _PDF_PARSE_TTL_S:
        return {**hit[1], "cache_hit": True}

    text = await _pdf_to_text(bytes(buf))
    if len(text) < 40:
        raise HTTPException(422, "Could not extract readable text from this PDF (image-only PDFs aren't supported yet)")

    from emergentintegrations.llm.chat import LlmChat, UserMessage
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(503, "Emergent LLM key not configured")

    trimmed = text[:12_000]
    chat = LlmChat(
        api_key=key,
        session_id=str(uuid.uuid4()),
        system_message=PDF_SYSTEM,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    try:
        reply = await chat.send_message(UserMessage(
            text=f"Document begins below.\n=====\n{trimmed}\n=====",
        ))
    except Exception as exc:
        raise HTTPException(503, f"LLM call failed: {exc}") from exc

    raw = reply if isinstance(reply, str) else getattr(reply, "content", str(reply))
    import json as _json
    parsed: dict = {}
    for candidate in (
        raw,
        *(m.group(1) for m in re.finditer(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)),
        (re.search(r"\{.*\}", raw, re.DOTALL).group(0) if re.search(r"\{.*\}", raw, re.DOTALL) else "{}"),
    ):
        try:
            parsed = _json.loads(candidate)
            break
        except Exception:
            continue
    parsed = parsed if isinstance(parsed, dict) else {}
    normalised = {
        "worker_name":  parsed.get("worker_name") or None,
        "date":         parsed.get("date") or None,
        "site_name":    parsed.get("site_name") or None,
        "site_address": parsed.get("site_address") or None,
        "notes":        parsed.get("notes") or None,
    }

    bucket = _job_pdf_bucket()
    grid_id = await bucket.upload_from_stream(
        filename,
        bytes(buf),
        metadata={
            "org_id": user["org_id"],
            "uploaded_by": user["id"],
            "uploaded_at": _now_utc_iso(),
            "sha256": digest,
            "content_type": file.content_type or "application/pdf",
        },
    )
    pdf_id = str(grid_id)

    result = {
        "parsed": normalised,
        "raw_text_snippet": text[:500],
        "pdf_id": pdf_id,
        "pdf_url": f"/api/mobile/daily-jobs/pdf/{pdf_id}",
        "cache_hit": False,
    }
    _PDF_PARSE_CACHE[digest] = (now, result)
    return result


@router.get("/mobile/daily-jobs/pdf/{pdf_id}")
async def download_pdf(pdf_id: str, user: dict = Depends(get_current_user)):
    from bson import ObjectId
    from fastapi.responses import StreamingResponse
    try:
        oid = ObjectId(pdf_id)
    except Exception:
        raise HTTPException(404, "PDF not found")
    bucket = _job_pdf_bucket()
    try:
        stream = await bucket.open_download_stream(oid)
    except Exception:
        raise HTTPException(404, "PDF not found")
    meta = stream.metadata or {}
    if meta.get("org_id") and meta.get("org_id") != user["org_id"]:
        raise HTTPException(404, "PDF not found")
    async def _iter():
        while True:
            chunk = await stream.readchunk()
            if not chunk:
                break
            yield chunk
    return StreamingResponse(
        _iter(),
        media_type=meta.get("content_type") or "application/pdf",
        headers={"Content-Disposition": f'inline; filename="{stream.filename}"'},
    )


# ─────────────── GET /mobile/daily-jobs/today ───────────────

@router.get("/mobile/daily-jobs/today")
async def get_today(user: dict = Depends(get_current_user)) -> dict:
    """Return the caller's ACTIVE (non-terminal) assignment.

    Locked shape:
        {"assignment": <doc> | null, "status": <status> | "no_job"}

    `.132p0`: NO `is_past_date_fallback` flag. NO past-date-magic
    fallback that pretends yesterday's job is today. The caller's
    active job is defined as: the most-recent doc keyed off
    `(org_id, worker_id)` whose `status` is NOT in TERMINAL_STATUSES.
    Sort: `date` desc, then `issued_at` desc.
    """
    async def _load() -> dict:
        org_id = user["org_id"]
        candidate_ids: list = []
        if user.get("id"):
            candidate_ids.append(user["id"])
        # Email fallback → linked workers row.
        if user.get("email"):
            w = await db.workers.find_one(
                {"org_id": org_id, "email": user["email"], "deleted_at": None},
                {"_id": 0, "id": 1},
            )
            if w and w.get("id") and w["id"] not in candidate_ids:
                candidate_ids.append(w["id"])

        if not candidate_ids:
            return {"assignment": None, "status": "no_job"}

        doc = await db.daily_job_assignments.find_one(
            {
                "org_id": org_id,
                "worker_id": {"$in": candidate_ids},
                "status": {"$nin": list(TERMINAL_STATUSES)},
            },
            {"_id": 0},
            sort=[("date", -1), ("issued_at", -1)],
        )
        if not doc:
            return {"assignment": None, "status": "no_job"}
        return {"assignment": _clean(doc), "status": doc.get("status") or STATUS_ISSUED}

    try:
        return await asyncio.wait_for(_load(), timeout=6.0)
    except asyncio.TimeoutError:
        log.warning("daily-jobs/today hit 6s wait_for — returning no_job/degraded")
        return {"assignment": None, "status": "no_job", "degraded": True}


# ─────────────── Accept / Decline / Sign-on ───────────────

async def _transition(
    *, assignment_id: str, user: dict,
    from_statuses: set, to_status: str, stamp_field: str,
) -> dict:
    """Ownership-checked state transition.

    Caller must own the assignment (matches by user_id OR by the
    linked workers.id via email). `from_statuses` guards illegal
    transitions (e.g. can't decline a completed job). Idempotent:
    if the doc is already in `to_status`, return it unchanged.
    """
    doc = await db.daily_job_assignments.find_one(
        {"id": assignment_id, "org_id": user["org_id"]},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Assignment not found")

    # Ownership.
    caller_ids = set()
    if user.get("id"):
        caller_ids.add(user["id"])
    if user.get("email"):
        w = await db.workers.find_one(
            {"org_id": user["org_id"], "email": user["email"], "deleted_at": None},
            {"_id": 0, "id": 1},
        )
        if w and w.get("id"):
            caller_ids.add(w["id"])
    if doc.get("worker_id") not in caller_ids:
        raise HTTPException(403, "You can only respond to your own assignments")

    current = doc.get("status") or STATUS_ISSUED
    if current == to_status:
        return {"assignment": doc, "status": current, "idempotent": True}
    if current not in from_statuses:
        raise HTTPException(
            409,
            f"Cannot transition from {current!r} to {to_status!r}",
        )

    updated = await db.daily_job_assignments.find_one_and_update(
        {"id": assignment_id, "org_id": user["org_id"]},
        {"$set": {
            "status": to_status,
            stamp_field: _now_utc_iso(),
            "updated_at": _now_utc_iso(),
        }},
        return_document=True, projection={"_id": 0},
    )
    return {"assignment": updated, "status": updated.get("status") or to_status}


@router.post("/mobile/daily-jobs/{assignment_id}/accept")
async def accept(assignment_id: str,
                 user: dict = Depends(get_current_user)) -> dict:
    return await _transition(
        assignment_id=assignment_id, user=user,
        from_statuses={STATUS_ISSUED},
        to_status=STATUS_ACCEPTED, stamp_field="accepted_at",
    )


@router.post("/mobile/daily-jobs/{assignment_id}/decline")
async def decline(assignment_id: str,
                  user: dict = Depends(get_current_user)) -> dict:
    return await _transition(
        assignment_id=assignment_id, user=user,
        from_statuses={STATUS_ISSUED, STATUS_ACCEPTED},
        to_status=STATUS_DECLINED, stamp_field="declined_at",
    )


class SignOnIn(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None


@router.post("/mobile/daily-jobs/{assignment_id}/signon", status_code=501)
async def signon_stub(assignment_id: str,
                      body: SignOnIn = None,
                      user: dict = Depends(get_current_user)) -> dict:
    """Phase 4 stub. Wire in Phase 4 (site sign-on + on-site pre-start)."""
    raise HTTPException(501, "Sign-on lands in Phase 4")
