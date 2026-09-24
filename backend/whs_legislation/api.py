"""v58.13.132mk — Admin API surface for WHS legislation ingest.

Mount under `/api/legislation/*`. All routes admin-gated.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user

from . import ingest

log = logging.getLogger("paneltec.whs_legislation.api")

router = APIRouter(prefix="/legislation", tags=["whs-legislation"])


_ADMIN_ROLE_IDS = {
    "admin", "hseq_manager", "hseq_manager_2", "hseq_manager_readonly",
    "hseq_manager_creator", "responsible_manager", "report_emailing_admin",
}
_ADMIN_LEGACY_ROLES = {"admin", "hseq_lead"}


def _require_admin(user: dict = Depends(get_current_user)) -> dict:
    rid = (user.get("role_id") or "").strip()
    legacy = (user.get("role") or "").strip().lower()
    if rid in _ADMIN_ROLE_IDS or legacy in _ADMIN_LEGACY_ROLES:
        return user
    raise HTTPException(403, "Admin only")


@router.post("/reingest")
async def reingest(user: dict = Depends(_require_admin)) -> Dict[str, Any]:
    """Kick off a background ingest run. Refuses if another is active."""
    try:
        return await ingest.start_run()
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@router.get("/reingest/status")
async def reingest_status(
    run_id: Optional[str] = Query(None),
    user: dict = Depends(_require_admin),
) -> Dict[str, Any]:
    """Progress + summary for one run. Empty run_id → latest run."""
    doc = await ingest.get_status(run_id)
    if not doc:
        return {"state": "none"}
    return doc


@router.get("/sources")
async def sources(user: dict = Depends(_require_admin)):
    """Per-doc summary for the future UI status panel."""
    return await ingest.list_sources()
