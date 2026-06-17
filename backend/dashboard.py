"""Dashboard metrics + file serving."""
import mimetypes
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


@router.get("/metrics", response_model=DashboardMetrics)
async def metrics(
    workspace: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    org_id = user["org_id"]
    swms_c = await _count("swms", org_id, workspace)
    pre_c = await _count("pre_starts", org_id, workspace)
    diary_c = await _count("site_diary_entries", org_id, workspace)
    haz_c = await _count("hazards", org_id, workspace)
    inc_c = await _count("incidents", org_id, workspace)
    insp_c = await _count("inspections", org_id, workspace)

    # Records needing attention = open/in_progress hazards + open incidents + draft SWMS awaiting review
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
    )


# ---------- File serving (hazard photos) ----------

@files_router.get("/hazards/{name}")
async def serve_hazard(name: str):
    # prevent path traversal
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = UPLOAD_ROOT / "hazards" / name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    mime, _ = mimetypes.guess_type(str(path))
    return FileResponse(str(path), media_type=mime or "application/octet-stream")
