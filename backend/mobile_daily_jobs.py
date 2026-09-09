"""Mobile Daily-Job Assignments — v58.13.132cf.

Backend for the "SMS you your job for the day; accept in-app" flow, now
generalised into the **Ad-hoc Job Assignments** admin surface.

Endpoints (all under `/api/mobile/`):
  POST /daily-jobs                       admin create (worker+assigner snapshot + preamble + pdf)
  POST /daily-jobs/parse-pdf             admin PDF upload → AI-parsed form prefill
  GET  /daily-jobs/today                 worker's assignment for today (Sydney)
  POST /daily-jobs/{id}/accept           worker accepts (ownership-checked)
  POST /daily-jobs/{id}/decline          worker declines (ownership-checked)

Timezone: Australia/Sydney. `_today_iso()` used to be UTC, which caused
"disappears at midnight UTC" bugs for the AU admin (`.132cf` fix).
Every assignment doc now carries both `date_local` (Sydney) and
`date_utc` (audit) alongside the primary `date` (== date_local).

Ownership: a worker can only accept/decline their own assignment. Admins
can create for any user in their org.

Role gate: `.132cf` tightens all endpoints in this module to
role='admin' only. The previous "admin/manager/hseq_lead/owner"
permissive gate is retired per Stephen (no managers/HSEQ in this org).
"""
from __future__ import annotations
import hashlib
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from db import db
from auth import get_current_user
from models import now_iso

router = APIRouter(tags=["mobile-daily-jobs"])

SYDNEY_TZ = ZoneInfo("Australia/Sydney")


# ─────────────── Models ───────────────

class DailyJobCreateIn(BaseModel):
    worker_id: str = Field(..., min_length=1)
    site_id: str = Field(..., min_length=1)
    date: Optional[str] = None          # ISO YYYY-MM-DD; defaults to today (Sydney)
    notes: Optional[str] = None
    site_name: Optional[str] = None     # snapshot for offline UX
    site_address: Optional[str] = None
    site_coords: Optional[dict] = None  # {"lat": ..., "lng": ...}
    # v58.13.132ab — allow admin to replace an existing assignment for the
    # same worker on the same date. Defaults to false → 409 on duplicate.
    override: bool = False
    # v58.13.132cf additions
    preamble: Optional[str] = None      # editable message to worker, ≤500 chars
    pdf_id: Optional[str] = None        # links to parse-pdf upload
    pdf_url: Optional[str] = None       # snapshot URL for mobile card


# ─────────────── Helpers ───────────────

def _today_iso() -> str:
    """Return today's date in Australia/Sydney timezone as YYYY-MM-DD.

    v58.13.132cf — switched from UTC. The AU admin's day rolls over at
    Sydney midnight; using UTC caused "disappears at midnight AEST"
    bugs where an assignment created 22:00 AEST silently landed on
    the NEXT day's list."""
    return datetime.now(SYDNEY_TZ).strftime("%Y-%m-%d")


def _now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_admin(user: dict) -> None:
    """v58.13.132cf — strict admin-only. The .132n permissive gate
    (admin/manager/hseq_lead/owner) is retired per Stephen brief."""
    if (user.get("role") or "").lower() != "admin":
        raise HTTPException(403, "Admin role required")


async def _dispatch_sms_stub(
    *, worker_id: str, org_id: str, assignment_id: str,
    message: str, phone: Optional[str],
) -> dict:
    """v58.13.132n — SMS dispatch STUB (Comms Safe Mode)."""
    row = {
        "id": str(uuid.uuid4()),
        "org_id": org_id,
        "worker_id": worker_id,
        "assignment_id": assignment_id,
        "phone": phone,
        "message": message,
        "queued_at": now_iso(),
        "sent_at": None,
        "provider": None,
        "provider_message_id": None,
        "status": "queued_manual",
    }
    await db.pending_sms_dispatches.insert_one(row)
    return {"sms_status": "queued_manual", "queue_id": row["id"]}


def _clean_assignment(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "_id"}


async def _resolve_assignee(user_or_worker_id: str, org_id: str) -> Optional[dict]:
    """v58.13.132cf — the FE picker sources from `users` (filtered by
    role_id), but legacy callers may still pass a `workers.id`. Try
    users first, then workers, so both id shapes resolve cleanly."""
    u = await db.users.find_one(
        {"id": user_or_worker_id, "org_id": org_id},
        {"_id": 0, "id": 1, "email": 1, "phone": 1, "mobile": 1,
         "name": 1, "first_name": 1, "last_name": 1, "role_id": 1},
    )
    if u:
        first = (u.get("first_name") or "").strip()
        last = (u.get("last_name") or "").strip()
        full = (u.get("name") or f"{first} {last}").strip() or (u.get("email") or "(unnamed)")
        return {
            "id": u["id"],
            "name": full,
            "phone": u.get("mobile") or u.get("phone"),
            "role_id": u.get("role_id"),
            "email": u.get("email"),
            "kind": "user",
        }
    w = await db.workers.find_one(
        {"id": user_or_worker_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "email": 1, "phone": 1, "mobile": 1,
         "first_name": 1, "last_name": 1},
    )
    if w:
        first = (w.get("first_name") or "").strip()
        last = (w.get("last_name") or "").strip()
        full = f"{first} {last}".strip() or "(unnamed)"
        return {
            "id": w["id"],
            "name": full,
            "phone": w.get("mobile") or w.get("phone"),
            "role_id": None,
            "email": w.get("email"),
            "kind": "worker",
        }
    return None


# ─────────────── POST /mobile/daily-jobs ───────────────

@router.post("/mobile/daily-jobs", status_code=201)
async def create_daily_job(body: DailyJobCreateIn,
                           user: dict = Depends(get_current_user)) -> dict:
    _require_admin(user)
    the_date = body.date or _today_iso()

    assignee = await _resolve_assignee(body.worker_id, user["org_id"])
    if not assignee:
        raise HTTPException(404, "Worker not found in your org")

    # v58.13.132ab — duplicate guard.
    existing = await db.daily_job_assignments.find_one(
        {"org_id": user["org_id"], "worker_id": body.worker_id, "date": the_date},
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

    # v58.13.132cf — assigner (admin) snapshot.
    assigner_name = (
        user.get("name")
        or f"{(user.get('first_name') or '').strip()} {(user.get('last_name') or '').strip()}".strip()
        or user.get("email")
        or "(unknown admin)"
    )

    # Preamble — cap length + default when blank.
    preamble = (body.preamble or "").strip()
    if len(preamble) > 500:
        preamble = preamble[:500]
    if not preamble:
        preamble = "You have been assigned the job attached. Please review before starting."

    assignment_id = str(uuid.uuid4())
    doc = {
        "id": assignment_id,
        "org_id": user["org_id"],
        # v58.13.132cf — snapshot the assignee's identity + role at write
        # time so subsequent reads never depend on the join staying live.
        "worker_id": body.worker_id,
        "worker_name": assignee["name"],
        "worker_phone": assignee.get("phone"),
        "worker_role_id": assignee.get("role_id"),
        "worker_kind": assignee.get("kind"),
        "site_id": body.site_id,
        "site_name": body.site_name,
        "site_address": body.site_address,
        "site_coords": body.site_coords,
        # Dual date fields — the .132cf TZ audit trail.
        "date": the_date,
        "date_local": the_date,           # Australia/Sydney
        "date_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "assigned_by": user["id"],
        "assigned_by_id": user["id"],
        "assigned_by_name": assigner_name,
        "assigned_at": _now_iso_utc(),
        "sms_sent_at": None,
        "sms_message_id": None,
        "sms_provider": None,
        "accepted_at": None,
        "declined_at": None,
        "completed_at": None,
        "status": "pending",
        "notes": body.notes,
        # v58.13.132cf — new fields.
        "preamble": preamble,
        "pdf_id": body.pdf_id,
        "pdf_url": body.pdf_url,
        "meta": {},
    }
    await db.daily_job_assignments.insert_one(doc)

    # Stub SMS dispatch (Comms Safe Mode).
    site_ref = body.site_name or body.site_id
    msg = (
        f"Paneltec: today's job — {site_ref}. Open the app and tap Accept to "
        f"confirm. Reply STOP to opt out."
    )
    sms = await _dispatch_sms_stub(
        worker_id=body.worker_id,
        org_id=user["org_id"],
        assignment_id=assignment_id,
        message=msg,
        phone=assignee.get("phone"),
    )
    doc = _clean_assignment(doc)
    doc.update(sms)
    return doc


# ─────────────── POST /mobile/daily-jobs/parse-pdf ───────────────

_PDF_PARSE_CACHE: dict = {}  # {sha256: (ts, parsed_result)}
_PDF_PARSE_TTL_S = 5 * 60    # 5 minutes
MAX_PDF_BYTES = 10 * 1024 * 1024  # 10 MB


def _job_pdf_bucket():
    """v58.13.132cf — GridFS bucket for ad-hoc job briefs. Matches the
    pattern used by `assets.py::_fs_bucket()` for asset photos — Mongo
    GridFS keeps files inside the DB (not on the pod), so no
    `ephemeral-upload-storage` concern."""
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
    """Best-effort PDF-bytes → text via PyPDF2 text-layer. Kept simple:
    if the text-layer is empty (image-only PDFs), returns "" and the
    caller surfaces a 422 to the FE so Stephen re-attaches a text PDF."""
    try:
        import io
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        chunks = []
        for p in reader.pages[:20]:  # cap for latency
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
    """Upload a job-brief PDF, extract text, and pipe through an LLM to
    prefill the Ad-hoc Job Assignment form. Result cached 5 min per
    SHA-256 of the file so repeated uploads of the same PDF (e.g. after
    edit-then-retry) skip the LLM call.

    v58.13.132cf — the PDF is stored in the Mongo GridFS bucket
    `job_pdfs` (NOT on the pod filesystem), so the assignment doc's
    `pdf_id` continues to resolve after a pod restart or scale-out."""
    _require_admin(user)

    filename = (file.filename or "").strip() or "job.pdf"
    if not filename.lower().endswith(".pdf") and (file.content_type or "").lower() != "application/pdf":
        raise HTTPException(400, "Only PDF files are supported")

    # Read full body with size cap.
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

    # Cache lookup — returns immediately even before we've written the
    # file to GridFS (cached entry already has a pdf_id).
    import time as _t
    now = _t.time()
    hit = _PDF_PARSE_CACHE.get(digest)
    if hit and (now - hit[0]) < _PDF_PARSE_TTL_S:
        return {**hit[1], "cache_hit": True}

    text = await _pdf_to_text(bytes(buf))
    if len(text) < 40:
        raise HTTPException(422, "Could not extract readable text from this PDF (image-only PDFs aren't supported yet)")

    # LLM call — same pattern as swms_phase45.parse_swms_text.
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
            text=f"Document begins below.\n=====\n{trimmed}\n====="
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

    # Store the PDF bytes in GridFS. Mongo returns an ObjectId — we
    # stringify it and expose it as `pdf_id`; the mobile card fetches
    # via the download endpoint below.
    bucket = _job_pdf_bucket()
    grid_id = await bucket.upload_from_stream(
        filename,
        bytes(buf),
        metadata={
            "org_id": user["org_id"],
            "uploaded_by": user["id"],
            "uploaded_at": _now_iso_utc(),
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


# ─────────────── GET /mobile/daily-jobs/pdf/{pdf_id} ───────────────

@router.get("/mobile/daily-jobs/pdf/{pdf_id}")
async def download_pdf(pdf_id: str, user: dict = Depends(get_current_user)):
    """Stream a job-brief PDF from GridFS. Any authenticated user in the
    org can read (workers view PDFs attached to their own assignment;
    admins view PDFs while reviewing)."""
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
async def get_today_daily_job(user: dict = Depends(get_current_user)) -> dict:
    """Return the caller's assignment for today (Sydney), if any.

    v58.13.132cf — assignee_id lookup now covers both users and workers
    (matches the .132cf create-path). Snapshot fields (`worker_name`,
    `assigned_by_name`, `preamble`, `pdf_url`) come straight from the
    doc — no additional lookups needed."""
    the_date = _today_iso()
    assignee_id = None
    if user.get("id"):
        # Prefer the user-side match (matches the picker's user source).
        assignee_id = user["id"]
    if user.get("email") and not await db.daily_job_assignments.find_one(
        {"org_id": user["org_id"], "worker_id": assignee_id, "date": the_date},
    ):
        # Fallback: look up a linked worker row by email.
        w = await db.workers.find_one(
            {"org_id": user["org_id"], "email": user["email"], "deleted_at": None},
            {"_id": 0, "id": 1},
        )
        if w:
            assignee_id = w.get("id")

    if not assignee_id:
        return {"assignment": None, "status": "no_job"}

    doc = await db.daily_job_assignments.find_one(
        {"org_id": user["org_id"], "worker_id": assignee_id, "date": the_date},
        {"_id": 0},
    )
    if not doc:
        return {"assignment": None, "status": "no_job"}

    status = _derive_status(doc)
    return {"assignment": _clean_assignment(doc), "status": status}


def _derive_status(doc: dict) -> str:
    if doc.get("declined_at"):
        return "declined"
    if doc.get("completed_at"):
        return "accepted"  # completed rolls up as accepted for the home state
    if doc.get("accepted_at"):
        return "accepted"
    return "pending_accept"


# ─────────────── POST /mobile/daily-jobs/{id}/accept ───────────────

@router.post("/mobile/daily-jobs/{assignment_id}/accept")
async def accept_daily_job(assignment_id: str,
                           user: dict = Depends(get_current_user)) -> dict:
    return await _transition_assignment(
        assignment_id=assignment_id, user=user,
        set_field="accepted_at", forbidden_field="declined_at",
        result_status="accepted",
    )


# ─────────────── POST /mobile/daily-jobs/{id}/decline ───────────────

@router.post("/mobile/daily-jobs/{assignment_id}/decline")
async def decline_daily_job(assignment_id: str,
                            user: dict = Depends(get_current_user)) -> dict:
    return await _transition_assignment(
        assignment_id=assignment_id, user=user,
        set_field="declined_at", forbidden_field="accepted_at",
        result_status="declined",
    )


async def _transition_assignment(
    *, assignment_id: str, user: dict, set_field: str,
    forbidden_field: str, result_status: str,
) -> dict:
    doc = await db.daily_job_assignments.find_one(
        {"id": assignment_id, "org_id": user["org_id"]}, {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Assignment not found")

    # Ownership — caller must be the assignee (via user_id) OR via a
    # workers-row keyed by email.
    if doc.get("worker_id") != user.get("id"):
        worker_id = None
        if user.get("email"):
            w = await db.workers.find_one(
                {"org_id": user["org_id"], "email": user["email"], "deleted_at": None},
                {"_id": 0, "id": 1},
            )
            worker_id = (w or {}).get("id")
        if worker_id != doc.get("worker_id"):
            raise HTTPException(403, "You can only respond to your own assignments")

    if doc.get(forbidden_field):
        raise HTTPException(
            409,
            f"Assignment already {'accepted' if forbidden_field == 'accepted_at' else 'declined'}",
        )
    if doc.get(set_field):
        return {"assignment": doc, "status": _derive_status(doc), "idempotent": True}

    updated = await db.daily_job_assignments.find_one_and_update(
        {"id": assignment_id, "org_id": user["org_id"]},
        {"$set": {set_field: now_iso(), "status": result_status,
                  "updated_at": now_iso()}},
        return_document=True, projection={"_id": 0},
    )
    return {"assignment": updated, "status": _derive_status(updated)}
