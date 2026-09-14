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
    # v160.3.0-adjust-18 — Exclude legacy imported rows from live
    # compliance metrics. Legacy records remain visible on the Capture
    # tabs (with the LEGACY pill) but must not inflate this-quarter
    # dashboard counts.
    q = {"org_id": org_id, "deleted_at": None, "imported": {"$ne": True}}
    if workspace_id:
        q["workspace_id"] = workspace_id
    return await db[collection].count_documents(q)


async def _count_before(collection: str, org_id: str, workspace_id: Optional[str], before_iso: str) -> int:
    """v157.1 — Count of live (non-deleted, non-imported) docs whose
    `created_at` predates the ISO cutoff. Used to compute per-metric
    quarter-over-quarter deltas.
    v160.3.0-adjust-18 — Also exclude `imported: True`."""
    q = {"org_id": org_id, "deleted_at": None, "imported": {"$ne": True},
         "created_at": {"$lt": before_iso}}
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
    # v160.0.8 — clamp metric counts for non-privileged callers. Workers see
    # only their own created records; monitoring_scope reads "Personal".
    privileged = (user.get("role") or "").lower() in {"admin", "hseq_lead", "supervisor"}
    scope_filter: dict = {}
    if not privileged:
        scope_filter = {"created_by": user["id"]}
    swms_c = await db.swms.count_documents({"org_id": org_id, "deleted_at": None, "imported": {"$ne": True}, **scope_filter})
    pre_c = await db.pre_starts.count_documents({"org_id": org_id, "deleted_at": None, "imported": {"$ne": True}, **scope_filter})
    diary_c = await db.site_diary_entries.count_documents({"org_id": org_id, "deleted_at": None, "imported": {"$ne": True}, **scope_filter})
    haz_c = await db.hazards.count_documents({"org_id": org_id, "deleted_at": None, "imported": {"$ne": True}, **scope_filter})
    inc_c = await db.incidents.count_documents({"org_id": org_id, "deleted_at": None, "imported": {"$ne": True}, **scope_filter})
    insp_c = await db.inspections.count_documents({"org_id": org_id, "deleted_at": None, "imported": {"$ne": True}, **scope_filter})

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
    # v160.3.0-adjust-18 — Exclude legacy imports from all three counts.
    if privileged:
        needs_attention = await db.hazards.count_documents(
            {"org_id": org_id, "deleted_at": None, "imported": {"$ne": True},
             "status": {"$in": ["open", "in_progress"]}}
        )
        needs_attention += await db.incidents.count_documents(
            {"org_id": org_id, "deleted_at": None, "imported": {"$ne": True},
             "follow_up_status": {"$in": ["open", "in_progress"]}}
        )
        needs_attention += await db.swms.count_documents(
            {"org_id": org_id, "deleted_at": None, "imported": {"$ne": True},
             "status": "submitted"}
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
        monitoring_scope=("Organisation wide" if privileged else "Personal"),
    )


# ---------- File serving ----------
#
# v160.3.9.40 (SEC-004) — Every handler below now gates on
# `Depends(get_current_user)`, which accepts EITHER a bearer JWT OR
# the short-lived download-scoped JWT via `?token=<jwt>` in the query
# string. The FE `filesUrl()` helper (`frontend/src/lib/downloadUrl.js`)
# already fetches that token and appends it, so `<img src>` and
# `<a href>` calls continue to work without any FE change.
# The only handler that stays unauthenticated is `/renewals/{token}/…`,
# which authenticates via its own share-link token (verified out of
# band before serving); it lives under the middleware's SKIP_PATHS
# regex `^/api/files/renewals/` (see permissions_middleware.py).
#
# Org-scoping: for handlers whose parent resource has an org_id in DB
# (`document_library`, `form_photos`), the org must match
# `user["org_id"]` — otherwise 404 (not 403; do not confirm existence).
# Other handlers (`hazards`, `contractor_docs`, `pdfs`, `swms_scans`,
# `exports`) currently rely on the UUID-in-filename un-guessability
# plus caller-side auth; per-file org-scoping is a follow-up on the
# Wave 3 backlog (see security audit SEC-004 recommendation).


async def _org_scope_document_library(folder_id: str, user: dict) -> None:
    """404 if the document_library folder is not in the caller's org."""
    folder = await db.document_library_folders.find_one(
        {"id": folder_id},
        {"_id": 0, "org_id": 1},
    )
    # If the folder metadata is missing we still 404 — the file might
    # be an orphan write from before the folder registry existed, and
    # we cannot prove ownership.
    if not folder or folder.get("org_id") != user.get("org_id"):
        raise HTTPException(status_code=404, detail="Not found")


async def _org_scope_form_photo(submission_id: str, user: dict) -> None:
    """404 if the form submission is not in the caller's org."""
    sub = await db.form_submissions.find_one(
        {"id": submission_id},
        {"_id": 0, "org_id": 1},
    )
    if not sub or sub.get("org_id") != user.get("org_id"):
        raise HTTPException(status_code=404, detail="Not found")


def _serve(*parts: str):
    for p in parts:
        if "/" in p or "\\" in p or ".." in p:
            raise HTTPException(status_code=400, detail="Invalid filename")
    path = UPLOAD_ROOT.joinpath(*parts)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    mime, _ = mimetypes.guess_type(str(path))
    return FileResponse(str(path), media_type=mime or "application/octet-stream")


async def _serve_async(subdir: str, *parts: str):
    """v58.13.132gf — GridFS-preferring async variant of `_serve()`.

    Reads GridFS via `uploads_storage.read_upload`; on miss, falls
    back to the pre-`.132gf` local-disk path so files uploaded
    before the migration keep serving until the sweeper runs."""
    for p in (subdir, *parts):
        if "/" in p or "\\" in p or ".." in p:
            raise HTTPException(status_code=400, detail="Invalid filename")
    from uploads_storage import read_upload  # noqa: WPS433 — lazy
    from fastapi.responses import Response

    hit = await read_upload(subdir, parts)
    if hit is not None:
        data, mime = hit
        return Response(content=data, media_type=mime)
    path = UPLOAD_ROOT.joinpath(subdir, *parts)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    mime, _ = mimetypes.guess_type(str(path))
    return FileResponse(str(path),
                        media_type=mime or "application/octet-stream")


@files_router.get("/hazards/{name}")
async def serve_hazard(name: str, user: dict = Depends(get_current_user)):
    # v58.13.132gh — GridFS-preferring reader; disk fallback retained.
    return await _serve_async("hazards", name)


@files_router.get("/contractor_docs/{name}")
async def serve_contractor_doc(name: str, user: dict = Depends(get_current_user)):
    return await _serve_async("contractor_docs", name)


@files_router.get("/renewals/{token}/{name}")
async def serve_renewal(token: str, name: str):
    # PUBLIC share-link path — auth is the `token` in the URL, which
    # was minted by the renewal-email flow and is scope-limited to a
    # single renewal record. Kept unauthenticated intentionally.
    return await _serve_async("renewals", token, name)


@files_router.get("/exports/{name}")
async def serve_export(name: str, user: dict = Depends(get_current_user)):
    # v58.13.132gi — GridFS-preferring reader; disk fallback retained.
    return await _serve_async("exports", name)


@files_router.get("/pdfs/{name}")
async def serve_pdf(name: str, user: dict = Depends(get_current_user)):
    # v58.13.132gi — GridFS-preferring reader; disk fallback retained.
    return await _serve_async("pdfs", name)


@files_router.get("/document_library/{folder_id}/{name}")
async def serve_document_library(
    folder_id: str, name: str,
    user: dict = Depends(get_current_user),
):
    await _org_scope_document_library(folder_id, user)
    # v58.13.132gh — Doc-library serve was still on the sync _serve;
    # swap so worker-cert + induction uploads (which live under
    # `document_library/<folder>/...`) stream from GridFS post-migration.
    return await _serve_async("document_library", folder_id, name)


@files_router.get("/form_photos/{submission_id}/{name}")
async def serve_form_photo(
    submission_id: str, name: str,
    user: dict = Depends(get_current_user),
):
    await _org_scope_form_photo(submission_id, user)
    return await _serve_async("form_photos", submission_id, name)


# Phase 4.6 — signed-evidence SWMS scans (PDF + JPG/PNG).
@files_router.get("/swms_scans/{name}")
async def serve_swms_scan(name: str, user: dict = Depends(get_current_user)):
    return await _serve_async("swms_scans", name)


# v160.3.7q — Program Schematic module-stats endpoint.
#
# Feeds the `/settings/schematic` bird's-eye page. Returns a shallow
# `{collection: count}` map — org-scoped, live-count aggregate across
# every collection surfaced on the diagram. Cached in-process for 30s so
# repeated tab-switches don't hammer Mongo. Not persisted; the cache
# rebuilds on the next request after expiry or on process restart.
import asyncio as _asyncio
import time as _time

_MODULE_STATS_CACHE: dict = {}  # org_id -> (ts, payload)
_MODULE_STATS_TTL = 30.0

_MODULE_STATS_COLLECTIONS = {
    # People
    "workers":          {"c": "workers",           "q": {}},
    "users":            {"c": "users",             "q": {}},
    "active_sessions":  {"c": "active_sessions",   "q": {}},
    # Capture
    "swms":             {"c": "swms",              "q": {"deleted_at": None}},
    "prestarts":        {"c": "prestarts",         "q": {"deleted_at": None}},
    "diary_entries":    {"c": "diary_entries",     "q": {"deleted_at": None}},
    "hazards":          {"c": "hazards",           "q": {"deleted_at": None}},
    "incidents":        {"c": "incidents",         "q": {"deleted_at": None}},
    "inspections":      {"c": "inspections",       "q": {"deleted_at": None}},
    "risk_assessments": {"c": "risk_assessments",  "q": {"deleted_at": None}},
    "form_submissions": {"c": "form_submissions",  "q": {"deleted_at": None}},
    "form_templates":   {"c": "form_templates",    "q": {}},
    # Compliance
    "doc_folders":      {"c": "doc_folders",       "q": {}},
    "doc_files":        {"c": "doc_files",         "q": {}},
    "certifications":   {"c": "certifications",    "q": {}},
    "contractors":      {"c": "contractors",       "q": {"deleted_at": None}},
    "renewals":         {"c": "renewals",          "q": {}},
    # Fleet
    "sites":            {"c": "sites",             "q": {"deleted_at": None}},
    "assets":           {"c": "assets",            "q": {}},
    # Backup
    "bk_snapshots":     {"c": "bk_snapshots",      "q": {}},
}


@router.get("/module-stats")
async def module_stats(user: dict = Depends(get_current_user)):
    """Aggregate live counts for the Program Schematic diagram.

    Cached per-org for 30 s. Uses `asyncio.gather` across every counted
    collection so the whole payload comes back in ~one Mongo round-trip
    of latency instead of 20 sequential queries.
    """
    org_id = user["org_id"]
    now = _time.time()
    hit = _MODULE_STATS_CACHE.get(org_id)
    if hit and (now - hit[0]) < _MODULE_STATS_TTL:
        return {**hit[1], "cached": True, "ttl_s": _MODULE_STATS_TTL}

    async def _one(name: str, cfg: dict):
        q = {"org_id": org_id, **cfg["q"]}
        try:
            n = await db[cfg["c"]].count_documents(q)
        except Exception:
            n = 0
        return name, n

    pairs = await _asyncio.gather(*[
        _one(name, cfg) for name, cfg in _MODULE_STATS_COLLECTIONS.items()
    ])
    payload = {"counts": dict(pairs), "generated_at": datetime.now(timezone.utc).isoformat()}
    _MODULE_STATS_CACHE[org_id] = (now, payload)
    return {**payload, "cached": False, "ttl_s": _MODULE_STATS_TTL}
