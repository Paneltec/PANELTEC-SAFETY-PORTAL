"""Dashboard metrics + file serving."""
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from auth import get_current_user
from db import db
from models import DashboardMetrics

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
files_router = APIRouter(prefix="/files", tags=["files"])

UPLOAD_ROOT = Path(__file__).parent / "uploads"


async def _count(collection: str, org_id: str, workspace_id: Optional[str]) -> int:
    q = {"org_id": org_id, "deleted_at": None}
    if workspace_id:
        q["workspace_id"] = workspace_id
    return await db[collection].count_documents(q)


async def _count_before(collection: str, org_id: str, workspace_id: Optional[str], before_iso: str) -> int:
    """v157.1 — Count of live (non-deleted) docs whose `created_at` predates
    the ISO cutoff. Used to compute per-metric quarter-over-quarter deltas.
    Note: this reflects "how many of the currently-live docs were created
    before the cutoff", not "how many existed at the cutoff moment". The
    delta therefore expresses NET GROWTH inside the quarter, ignoring docs
    that were both created and soft-deleted before the cutoff (edge case,
    accepted for the sake of a single index-friendly query)."""
    q = {"org_id": org_id, "deleted_at": None, "created_at": {"$lt": before_iso}}
    if workspace_id:
        q["workspace_id"] = workspace_id
    return await db[collection].count_documents(q)


def _quarter_start_iso(now: Optional[datetime] = None) -> str:
    """ISO-8601 timestamp for the first day 00:00 UTC of the current
    calendar quarter (Q1: Jan, Q2: Apr, Q3: Jul, Q4: Oct)."""
    now = now or datetime.now(timezone.utc)
    q_month = ((now.month - 1) // 3) * 3 + 1
    start = datetime(now.year, q_month, 1, tzinfo=timezone.utc)
    return start.isoformat()


def _delta_pct(current: int, previous: int) -> Optional[float]:
    """Percentage growth from `previous` to `current`. Returns `None` when
    `previous == 0` — the frontend hides the delta row so we never show a
    misleading "+∞%" or "−100%" for cold-start collections."""
    if previous <= 0:
        return None
    return round(((current - previous) / previous) * 100, 1)


@router.get("/metrics", response_model=DashboardMetrics)
async def metrics(
    workspace: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    org_id = user["org_id"]
    # v160.0 — WATCH card gating. Non-privileged callers (workers,
    # contractors, auditors on the phone) get a zeroed attention block so
    # the mobile can safely hide the aggregate card without a second call.
    # Web callers are always admin/hseq/supervisor so this is a no-op there.
    privileged = (user.get("role") or "").lower() in {"admin", "hseq_lead", "supervisor"}
    swms_c = await _count("swms", org_id, workspace)
    pre_c = await _count("pre_starts", org_id, workspace)
    diary_c = await _count("site_diary_entries", org_id, workspace)
    haz_c = await _count("hazards", org_id, workspace)
    inc_c = await _count("incidents", org_id, workspace)
    insp_c = await _count("inspections", org_id, workspace)

    # v157.1 — quarter-over-quarter deltas. Only computed when the previous
    # period had at least one live doc; otherwise `None` and the frontend
    # hides the delta line.
    q_start = _quarter_start_iso()
    swms_prev = await _count_before("swms", org_id, workspace, q_start)
    pre_prev = await _count_before("pre_starts", org_id, workspace, q_start)
    diary_prev = await _count_before("site_diary_entries", org_id, workspace, q_start)
    haz_prev = await _count_before("hazards", org_id, workspace, q_start)
    inc_prev = await _count_before("incidents", org_id, workspace, q_start)
    insp_prev = await _count_before("inspections", org_id, workspace, q_start)

    deltas = {
        "swms_count":         _delta_pct(swms_c,  swms_prev),
        "prestarts_count":    _delta_pct(pre_c,   pre_prev),
        "diary_count":        _delta_pct(diary_c, diary_prev),
        "hazards_count":      _delta_pct(haz_c,   haz_prev),
        "incidents_count":    _delta_pct(inc_c,   inc_prev),
        "inspections_count":  _delta_pct(insp_c,  insp_prev),
    }

    # Records needing attention = open/in_progress hazards + open incidents + draft SWMS awaiting review
    if privileged:
        needs_attention = await db.hazards.count_documents(
            {"org_id": org_id, "deleted_at": None, "status": {"$in": ["open", "in_progress"]}}
        )
        needs_attention += await db.incidents.count_documents(
            {"org_id": org_id, "deleted_at": None, "follow_up_status": {"$in": ["open", "in_progress"]}}
        )
        needs_attention += await db.swms.count_documents(
            {"org_id": org_id, "deleted_at": None, "status": "submitted"}
        )
        # Attention score: simple heuristic — start at 100, subtract per attention item, floor 40
        score = max(40, 100 - needs_attention * 3)
        if score >= 85:
            band = "Strong"
        elif score >= 65:
            band = "Watch"
        else:
            band = "Action needed"
    else:
        # v160.0 — worker phone: no aggregate WATCH signal. The mobile
        # dashboard renders the card only when band != None.
        needs_attention = 0
        score = 0
        band = "hidden"

    return DashboardMetrics(
        swms_count=swms_c,
        prestarts_count=pre_c,
        diary_count=diary_c,
        hazards_count=haz_c,
        incidents_count=inc_c,
        inspections_count=insp_c,
        attention_score=score,
        attention_band=band,
        records_needing_attention=needs_attention,
        deltas=deltas,
        delta_label="vs last quarter",
    )


# ---------- File serving ----------

def _serve(*parts: str):
    for p in parts:
        if "/" in p or "\\" in p or ".." in p:
            raise HTTPException(status_code=400, detail="Invalid filename")
    path = UPLOAD_ROOT.joinpath(*parts)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    mime, _ = mimetypes.guess_type(str(path))
    return FileResponse(str(path), media_type=mime or "application/octet-stream")


@files_router.get("/hazards/{name}")
async def serve_hazard(name: str):
    return _serve("hazards", name)


@files_router.get("/contractor_docs/{name}")
async def serve_contractor_doc(name: str):
    return _serve("contractor_docs", name)


@files_router.get("/renewals/{token}/{name}")
async def serve_renewal(token: str, name: str):
    return _serve("renewals", token, name)


@files_router.get("/exports/{name}")
async def serve_export(name: str):
    return _serve("exports", name)


@files_router.get("/pdfs/{name}")
async def serve_pdf(name: str):
    return _serve("pdfs", name)


@files_router.get("/document_library/{folder_id}/{name}")
async def serve_document_library(folder_id: str, name: str):
    return _serve("document_library", folder_id, name)


@files_router.get("/form_photos/{submission_id}/{name}")
async def serve_form_photo(submission_id: str, name: str):
    return _serve("form_photos", submission_id, name)


# Phase 4.6 — signed-evidence SWMS scans (PDF + JPG/PNG).
@files_router.get("/swms_scans/{name}")
async def serve_swms_scan(name: str):
    return _serve("swms_scans", name)
