"""Generic CRUD routers — one per entity. All routes are org/workspace scoped
and require a JWT-authenticated user. Soft delete via `deleted_at`.

Each entity exposes:
  GET    /api/{entity}                 — list (filters: workspace_id, status, date_from, date_to)
  GET    /api/{entity}/{id}            — detail
  POST   /api/{entity}                 — create
  PATCH  /api/{entity}/{id}            — partial update
  DELETE /api/{entity}/{id}            — soft delete
"""
from typing import Any, Dict, List, Optional, Type

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import get_current_user
from db import db
from models import (
    HazardIn, IncidentIn, InspectionIn, PreStartIn, SiteDiaryIn, SwmsIn,
    SwmsReview, new_id, now_iso,
)


def _scoped(user: dict, workspace_id: Optional[str] = None) -> dict:
    q: Dict[str, Any] = {"org_id": user["org_id"], "deleted_at": None}
    if workspace_id:
        q["workspace_id"] = workspace_id
    return q


def _strip(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


def build_router(prefix: str, collection: str, model: Type[BaseModel]) -> APIRouter:
    r = APIRouter(prefix=f"/{prefix}", tags=[prefix])

    @r.get("")
    async def list_items(
        workspace_id: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        limit: int = Query(200, ge=1, le=500),
        user: dict = Depends(get_current_user),
    ):
        q = _scoped(user, workspace_id)
        if status:
            q["status"] = status
        if date_from or date_to:
            rng: Dict[str, Any] = {}
            if date_from:
                rng["$gte"] = date_from
            if date_to:
                rng["$lte"] = date_to
            q["date"] = rng
        docs = await db[collection].find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
        return docs

    @r.get("/{item_id}")
    async def get_item(item_id: str, user: dict = Depends(get_current_user)):
        doc = await db[collection].find_one({"id": item_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Not found")
        return doc

    @r.post("", status_code=201)
    async def create_item(body: model, user: dict = Depends(get_current_user)):
        payload = body.model_dump()
        doc = {
            "id": new_id(),
            "org_id": user["org_id"],
            "created_by": user["id"],
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "deleted_at": None,
            **payload,
        }
        # Version starts at 1 for SWMS
        if collection == "swms":
            doc["version"] = 1
        await db[collection].insert_one(dict(doc))
        return _strip(doc)

    @r.patch("/{item_id}")
    async def update_item(item_id: str, patch: dict, user: dict = Depends(get_current_user)):
        patch = {k: v for k, v in (patch or {}).items() if k not in {"id", "org_id", "created_at", "created_by"}}
        patch["updated_at"] = now_iso()
        result = await db[collection].find_one_and_update(
            {"id": item_id, "org_id": user["org_id"], "deleted_at": None},
            {"$set": patch},
            return_document=True,
            projection={"_id": 0},
        )
        if not result:
            raise HTTPException(status_code=404, detail="Not found")
        return result

    @r.delete("/{item_id}")
    async def delete_item(item_id: str, user: dict = Depends(get_current_user)):
        result = await db[collection].update_one(
            {"id": item_id, "org_id": user["org_id"], "deleted_at": None},
            {"$set": {"deleted_at": now_iso()}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"ok": True}

    return r


# ---------- Build the six entity routers ----------
swms_router = build_router("swms", "swms", SwmsIn)
prestarts_router = build_router("pre-starts", "pre_starts", PreStartIn)
diary_router = build_router("site-diary", "site_diary_entries", SiteDiaryIn)
hazards_router = build_router("hazards", "hazards", HazardIn)
incidents_router = build_router("incidents", "incidents", IncidentIn)
inspections_router = build_router("inspections", "inspections", InspectionIn)


# ---------- SWMS review (extra endpoint) ----------

@swms_router.post("/{item_id}/review")
async def review_swms(item_id: str, body: SwmsReview, user: dict = Depends(get_current_user)):
    if user["role"] not in {"hseq_lead", "admin"}:
        raise HTTPException(status_code=403, detail="Only HSE leads can review SWMS")
    status_map = {"approve": "approved", "reject": "rejected", "request_changes": "changes_requested"}
    update = {
        "status": status_map[body.action],
        "review_note": body.note,
        "reviewed_by": user["id"],
        "reviewed_at": now_iso(),
        "updated_at": now_iso(),
    }
    result = await db.swms.find_one_and_update(
        {"id": item_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": update},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="SWMS not found")
    return result
