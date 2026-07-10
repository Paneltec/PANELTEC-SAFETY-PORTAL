"""Generic CRUD routers — permission-gated.

Each entity exposes:
  GET    /api/{entity}                 — list (requires <resource>.view)
  GET    /api/{entity}/{id}            — detail (requires <resource>.view)
  POST   /api/{entity}                 — create (requires <resource>.edit)
  PATCH  /api/{entity}/{id}            — partial update (requires <resource>.edit)
  DELETE /api/{entity}/{id}            — soft delete (requires <resource>.edit)
"""
from typing import Any, Dict, Optional, Type

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import db
from models import (
    HazardIn, IncidentIn, InspectionIn, PreStartIn, SiteDiaryIn, SwmsIn,
    SwmsReview, new_id, now_iso,
)
from permissions import require_permission, require_module, resolve_team_scope


def _scoped(user: dict, workspace_id: Optional[str] = None) -> dict:
    q: Dict[str, Any] = {"org_id": user["org_id"], "deleted_at": None}
    if workspace_id:
        q["workspace_id"] = workspace_id
    return q


def _strip(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


def build_router(prefix: str, collection: str, model: Type[BaseModel], resource: str,
                 module_id: Optional[str] = None,
                 mirror_categories: Optional[list[str]] = None) -> APIRouter:
    # v160.0.9 — router-level `require_module()` gate. When `module_id`
    # is set, every route on this router is subject to the mobile
    # module toggle for the caller's role. Web callers bypass (no
    # `x-client-platform: mobile` header).
    #
    # v160.2.5a — `mirror_categories` unions `form_submissions` rows
    # tagged with any of the given template categories into the list
    # response. Fixes the routing gap where phone-submitted forms
    # (which land in `form_submissions`) never surfaced on the
    # web-admin Capture sub-tabs (which read from their own legacy
    # collections). Merged rows carry `source: "form_submission"` so
    # the UI can render them alongside legacy entries.
    from fastapi import Depends as _Dep
    router_deps = [_Dep(require_module(module_id))] if module_id else []
    r = APIRouter(prefix=f"/{prefix}", tags=[prefix], dependencies=router_deps)

    @r.get("")
    async def list_items(
        workspace_id: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        include_superseded: bool = Query(False),
        date_from: Optional[str] = Query(None),
        date_to: Optional[str] = Query(None),
        scope: Optional[str] = Query(None, description="`me` = own records only, `team` = org-wide (needs team_view)"),
        limit: int = Query(200, ge=1, le=500),
        user: dict = Depends(require_permission(resource, "view")),
    ):
        q = _scoped(user, workspace_id)
        # v159.2 — team-scoping. If the caller lacks `team_view` on this
        # resource (or explicitly asked `?scope=me`), narrow the query to
        # records they created themselves.
        own_only = await resolve_team_scope(user, resource, scope)
        if own_only is not None:
            q["created_by"] = own_only
        if status:
            q["status"] = status
        elif collection == "swms" and not include_superseded:
            # Phase 4.1 — hide chained ancestors from default SWMS lists.
            q["status"] = {"$ne": "superseded"}
        if date_from or date_to:
            rng: Dict[str, Any] = {}
            if date_from:
                rng["$gte"] = date_from
            if date_to:
                rng["$lte"] = date_to
            q["date"] = rng
        docs = await db[collection].find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)

        # v160.2.5a — union in matching `form_submissions` (phone-filled
        # forms). Non-destructive — legacy rows keep priority; merged
        # rows carry `source: "form_submission"` and are ordered by
        # created_at (newest first). Skipped when `mirror_categories`
        # isn't set on this router, or when the caller narrowed with
        # `status=` (we can't safely map arbitrary status strings across
        # heterogeneous schemas).
        if mirror_categories and not status:
            mq: Dict[str, Any] = {
                "org_id": user["org_id"], "deleted_at": None,
                "template_category_snapshot": {"$in": mirror_categories},
            }
            if workspace_id:
                mq["workspace_id"] = workspace_id
            if own_only is not None:
                # v160.2.5a — form_submissions uses `submitted_by`, not
                # `created_by`. Match either key so worker-scope filters
                # still apply to mirrored rows.
                mq["$or"] = [{"created_by": own_only}, {"submitted_by": own_only}]
            if date_from or date_to:
                mq["submitted_at"] = {
                    **({"$gte": date_from} if date_from else {}),
                    **({"$lte": date_to} if date_to else {}),
                }
            mirrored = await db.form_submissions.find(mq, {"_id": 0}).sort(
                "submitted_at", -1).to_list(limit)
            for m in mirrored:
                # Normalise the shape so the existing web-admin table
                # renderers can pick it up without blowing up on missing
                # keys. Original fields are left intact.
                sub_at = m.get("submitted_at") or ""
                m.setdefault("created_at", sub_at)
                m.setdefault("created_by", m.get("submitted_by"))
                m.setdefault("status", "submitted")
                m.setdefault("date", sub_at[:10] if sub_at else "")
                m.setdefault("title",
                             m.get("template_name_snapshot") or "Form submission")
                m["source"] = "form_submission"
            docs = docs + mirrored
            docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
            docs = docs[:limit]
        return docs

    @r.get("/{item_id}")
    async def get_item(item_id: str, user: dict = Depends(require_permission(resource, "view"))):
        doc = await db[collection].find_one(
            {"id": item_id, "org_id": user["org_id"], "deleted_at": None}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Not found")
        # v159.2 — team-scoping on detail: workers without `team_view` can
        # only open their own records. Others (supervisor+/auditor) unchanged.
        own_only = await resolve_team_scope(user, resource, None)
        if own_only is not None and doc.get("created_by") != own_only:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied: {resource}.team_view",
            )
        return doc

    @r.post("", status_code=201)
    async def create_item(body: model, user: dict = Depends(require_permission(resource, "edit"))):
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
        if collection == "swms":
            # Phase 4.1 — version-chain auto-commit. If a non-superseded record
            # exists with the same title in this org, we either:
            #   (a) update IN-PLACE if the incoming version matches (idempotent), or
            #   (b) insert FRESH and link via supersedes/superseded_by pointers,
            #       archiving the old row with status=superseded.
            doc["version"] = doc.get("version") or 1
            title = (payload.get("title") or "").strip()
            new_ver = payload.get("version")
            if title:
                existing = await db.swms.find_one(
                    {"org_id": user["org_id"], "title": title,
                     "deleted_at": None,
                     "status": {"$ne": "superseded"}},
                    {"_id": 0},
                )
                if existing:
                    if (existing.get("version") or 1) == new_ver:
                        # Idempotent re-import — patch in place.
                        await db.swms.update_one(
                            {"id": existing["id"]},
                            {"$set": {**{k: v for k, v in payload.items() if k != "id"},
                                      "updated_at": now_iso(),
                                      "updated_by": user["id"]}},
                        )
                        return {**existing, **payload, "id": existing["id"],
                                "_chain_action": "in_place_update"}
                    # Different version → chain. Insert fresh, archive old.
                    doc["supersedes"] = existing["id"]
                    await db.swms.update_one(
                        {"id": existing["id"]},
                        {"$set": {"superseded_by": doc["id"],
                                  "status": "superseded",
                                  "updated_at": now_iso()}},
                    )
                    doc["_chain_action"] = "superseded_v" + str(existing.get("version"))
        await db[collection].insert_one(dict(doc))
        return _strip(doc)

    @r.patch("/{item_id}")
    async def update_item(item_id: str, patch: dict,
                          user: dict = Depends(require_permission(resource, "edit"))):
        patch = {k: v for k, v in (patch or {}).items()
                 if k not in {"id", "org_id", "created_at", "created_by"}}
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
    async def delete_item(item_id: str,
                          user: dict = Depends(require_permission(resource, "edit"))):
        result = await db[collection].update_one(
            {"id": item_id, "org_id": user["org_id"], "deleted_at": None},
            {"$set": {"deleted_at": now_iso()}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"ok": True}

    return r


# ---------- Build the six entity routers ----------
# v160.0.9 — each router now carries the corresponding mobile module id
# so the phone gets 403 when an admin turns the module OFF.
# v160.2.5a — Capture sub-tabs mirror phone-filled submissions by
# template category. Buckets:
#   pre_starts  ← pre_start | plant_pre_start
#   site_diary  ← (no live category yet; keeps empty until seeded)
#   hazards     ← near_miss
#   incidents   ← incident
#   inspections ← inspection
# `general` and `toolbox` are catch-all for the /forms tab (per-template
# view via FormSubmissions.jsx) — deliberately NOT mirrored here so a
# submission never double-lands in two Capture tabs.
swms_router       = build_router("swms",         "swms",                SwmsIn,        "swms",         "swms")
prestarts_router  = build_router("pre-starts",   "pre_starts",          PreStartIn,    "pre_starts",   "pre_start",
                                 mirror_categories=["pre_start", "plant_pre_start"])
diary_router      = build_router("site-diary",   "site_diary_entries",  SiteDiaryIn,   "site_diary",   "site_diary",
                                 mirror_categories=["site_diary"])
hazards_router    = build_router("hazards",      "hazards",             HazardIn,      "hazards",      "hazard",
                                 mirror_categories=["near_miss"])
incidents_router  = build_router("incidents",    "incidents",           IncidentIn,    "incidents",    "incident",
                                 mirror_categories=["incident"])
inspections_router = build_router("inspections", "inspections",         InspectionIn,  "inspections",  "inspection",
                                  mirror_categories=["inspection"])


# ---------- SWMS review (extra endpoint) ----------

@swms_router.post("/{item_id}/review")
async def review_swms(item_id: str, body: SwmsReview,
                      user: dict = Depends(require_permission("swms", "edit"))):
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
