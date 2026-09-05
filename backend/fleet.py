"""v58.13.120b — Fleet & Service Register: Phase 2 backend endpoints.

Five endpoints, all under `/api/fleet`, guarded by the
`FLEET_REGISTER_ENABLED` env flag (default `false`). When the flag
is off, every endpoint returns 404 — which is preferable to 403
so a probe can't fingerprint the feature's existence.

Endpoints:
  · GET  /fleet/register            paginated cross-kind register
  · GET  /fleet/assets/{id}         merged asset detail + service history
  · GET  /fleet/search              cross-collection ranked hits
  · POST /fleet/assets/{id}/services log a service against an asset
  · GET  /fleet/categories          kind → sub_type filter tree

Permissions reuse existing `assets.*` and `plant_maintenance.*`
tokens. No new tokens. Rate-limits ride on the shared
`user_limiter` from `rate_limit.py`.
"""
from __future__ import annotations
import base64
import io
import logging
import os
import time
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import get_current_user
from auth_helpers import verify_bearer_token
from permissions import require_permission
from db import db
from models import new_id, now_iso
from rate_limit import user_limiter

log = logging.getLogger("paneltec.fleet")

router = APIRouter(prefix="/fleet", tags=["fleet"])


# ── Feature flag ────────────────────────────────────────────────────
def _flag_enabled() -> bool:
    """`FLEET_REGISTER_ENABLED` env var. Truthy: `1`, `true`, `yes`
    (case-insensitive). Anything else → off.

    v58.13.120d — Default flipped to **True**. Explicit env-var
    values still win: setting `FLEET_REGISTER_ENABLED=false` (or any
    non-truthy value) disables the feature, e.g. for a mid-flight
    rollback. Missing env var → on. This mirrors the frontend
    Phase-4 flip (App.js sidebar + redirect landed the same ship).

    Read at request time (not import time) so pytests + rollout
    toggles can flip it without a supervisor restart.
    """
    v = os.environ.get("FLEET_REGISTER_ENABLED")
    if v is None or v == "":
        return True
    return v.strip().lower() in {"1", "true", "yes", "on"}


def require_fleet_register_enabled():
    """FastAPI dependency: 404s when the feature flag is off. Used as
    the FIRST dep on every fleet route so the auth challenge doesn't
    fire and reveal the endpoint exists."""
    if not _flag_enabled():
        raise HTTPException(status_code=404)


# ── Response models ─────────────────────────────────────────────────
class AssetRow(BaseModel):
    id: str
    kind: str
    asset_type: Optional[str] = None
    sub_type: Optional[str] = None
    rego_serial: Optional[str] = None
    name: Optional[str] = None
    make: Optional[str] = None
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    status: Optional[str] = None
    source: Optional[str] = None
    org_id: Optional[str] = None
    workspace_id: Optional[str] = None
    scan_token: Optional[str] = None
    notes: Optional[str] = None
    photos: Optional[list[dict]] = None
    # v58.13.126 — Surface Navixy linkage on register rows so the
    # frontend's Data-source sourceCounts can classify each row. Prior
    # to .126 the model silently dropped this field, which is why the
    # Data-source radio showed `All 130 · Navixy 0 · Manual 130`
    # (bug: manual = total - 0 = total).
    navixy_device_id: Optional[int] = None
    odo_km: Optional[float] = None
    hours_meter: Optional[float] = None
    nfc_uid: Optional[str] = None
    # v58.13.127 — GPS fields for the LH MapPin cell + AssetMapModal.
    # Populated by the 15-min Navixy scheduler; 100% coverage across
    # Stephen's 72 Navixy assets today.
    last_known_lat: Optional[float] = None
    last_known_lng: Optional[float] = None
    navixy_last_position_time: Optional[str] = None
    vin: Optional[str] = None


class RegisterResponse(BaseModel):
    items: list[AssetRow]
    total: int
    page: int
    limit: int


class SearchHit(BaseModel):
    type: Literal["asset", "service", "inspection", "hazard",
                  "incident", "pre_start"]
    id: str
    label: str
    snippet: Optional[str] = None
    deep_link: str
    matched_field: Optional[str] = None


class SearchResponse(BaseModel):
    hits: list[SearchHit]
    total_by_kind: dict[str, int]
    q: str


class LogServiceIn(BaseModel):
    # Q6 (2026-09-04): required minimum = date, type, cost, description.
    date_completed: str = Field(min_length=1, max_length=32)
    maintenance_type: str = Field(min_length=1, max_length=80)
    cost: float = Field(ge=0)
    description: str = Field(min_length=1, max_length=4000)
    # Optional extras — surface on the drawer form but not required.
    performed_by: Optional[str] = Field(default=None, max_length=200)
    company: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=4000)
    next_due_date: Optional[str] = Field(default=None, max_length=32)
    # v58.13.121 — Service Check Sheet extension (all optional; the
    # pre-.121 4-field payload still submits successfully).
    checklist_items: Optional[list[dict]] = Field(default=None)
    advisory_comments: Optional[str] = Field(default=None, max_length=8000)
    next_service_due_km: Optional[float] = Field(default=None, ge=0)
    next_service_due_hours: Optional[float] = Field(default=None, ge=0)
    mileage_at_service: Optional[float] = Field(default=None, ge=0)
    hours_at_service: Optional[float] = Field(default=None, ge=0)
    technician_user_id: Optional[str] = Field(default=None, max_length=64)
    technician_name: Optional[str] = Field(default=None, max_length=200)
    technician_signature_data_url: Optional[str] = Field(default=None, max_length=500_000)
    customer_signature_data_url: Optional[str] = Field(default=None, max_length=500_000)
    vin_captured: Optional[str] = Field(default=None, max_length=64)
    make_model_captured: Optional[str] = Field(default=None, max_length=200)
    sheet_template_version: Optional[str] = Field(default=None, max_length=20)
    # v58.13.122 — Which preset the sheet was submitted under. One of
    # {"custom","minor","intermediate","major","heavy_overhaul"}.
    service_level: Optional[str] = Field(default=None, max_length=20)
    # v58.13.123 — Heavy-truck template extension. Additive only; not
    # required for light-vehicle submissions.
    tread_depth_readings: Optional[dict] = Field(default=None)
    consumables_used: Optional[str] = Field(default=None, max_length=8000)
    next_inspection_due_date: Optional[str] = Field(default=None, max_length=32)
    # Persist newly-captured VIN/Make/Model back to the asset row
    # when the asset side is null/empty. Default True.
    save_to_asset_record: Optional[bool] = Field(default=True)


# ── /fleet/register ────────────────────────────────────────────────
@router.get("/register", response_model=RegisterResponse)
async def get_register(
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
    kind: Optional[str] = Query(None, max_length=20),
    status: Optional[str] = Query(None, max_length=20),
    sub_type: Optional[str] = Query(None, max_length=80),
    q: Optional[str] = Query(None, max_length=200),
    # v58.13.120g — Navixy-only filter for the FilterTree checkbox.
    navixy_only: bool = Query(False),
    page: int = Query(1, ge=1, le=1000),
    limit: int = Query(50, ge=1, le=200),
):
    """Paginated cross-kind register. Server-side filter by kind /
    status / sub_type / navixy_only. Text search via `q` applies a
    case-insensitive regex across rego_serial + name + make + model
    + manufacturer + asset_type + description."""
    org_id = user["org_id"]
    filt: dict = {"org_id": org_id, "deleted_at": None}
    if kind:
        filt["kind"] = kind
    if status:
        filt["status"] = status
    if navixy_only:
        # Match either a set string or a set number — both shapes
        # have been observed in the assets collection.
        filt["navixy_device_id"] = {"$nin": [None, ""]}
    if sub_type:
        # `sub_type` and `asset_type` are used interchangeably in the
        # current data model — match either.
        filt["$or"] = [{"sub_type": sub_type}, {"asset_type": sub_type}]
    if q:
        needle = {"$regex": q, "$options": "i"}
        or_terms = [{f: needle} for f in
                    ("rego_serial", "name", "make", "model",
                     "manufacturer", "asset_type", "sub_type",
                     "description")]
        # If sub_type filter already put an $or in place, merge with $and.
        if "$or" in filt:
            filt = {"$and": [{k: v for k, v in filt.items() if k != "$or"},
                             {"$or": filt["$or"]},
                             {"$or": or_terms}]}
        else:
            filt["$or"] = or_terms

    total = await db.assets.count_documents(filt)
    skip = (page - 1) * limit
    # v58.13.120c2 — Push NULL-rego rows to the END of the register
    # (Mongo's default asc-sort places nulls first, which put every
    # legacy plant row without a rego on page 1 and hid the real
    # fleet). Uses `$ifNull` to project a sort key that only rego-
    # bearing rows can win the ascending race with.
    pipeline = [
        {"$match": filt},
        {"$addFields": {
            "_null_rego_last": {"$cond": [
                {"$or": [{"$eq": ["$rego_serial", None]},
                          {"$eq": ["$rego_serial", ""]}]},
                1, 0,
            ]},
        }},
        {"$sort": {"_null_rego_last": 1, "rego_serial": 1, "id": 1}},
        {"$skip": skip},
        {"$limit": limit},
        {"$project": {"_id": 0, "_null_rego_last": 0}},
    ]
    items = [d async for d in db.assets.aggregate(pipeline)]
    return {"items": items, "total": total, "page": page, "limit": limit}


# ── /fleet/assets/{id} ─────────────────────────────────────────────
@router.get("/assets/{asset_id}")
async def get_asset_detail(
    asset_id: str,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
    history_limit: int = Query(50, ge=1, le=500),
):
    """Merged asset detail: asset fields + service history + counters
    + open compliance rollups. Replaces the current 3-call fan-out
    (assets/{id} + plant-maintenance?plant_id=... + counters)."""
    org_id = user["org_id"]
    a = await db.assets.find_one(
        {"id": asset_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not a:
        raise HTTPException(404, "Asset not found")

    # Service history (limited).
    # v58.13.120b — pm rows imported pre-.120 may carry `org_id=null`
    # (the XLSX importer didn't stamp it before our backfill era);
    # match either the user's org_id OR null. The asset lookup above
    # is already org-scoped, so any pm row pointing at this asset is
    # implicitly trusted for this user's org.
    history_filter = {
        "plant_id": asset_id,
        "$or": [{"org_id": org_id}, {"org_id": None},
                 {"org_id": {"$exists": False}}],
    }
    history_cursor = (db.plant_maintenance.find(history_filter, {"_id": 0})
                      .sort([("date_completed", -1), ("id", -1)])
                      .limit(history_limit))
    history = [d async for d in history_cursor]

    # Counters (cheap aggregations).
    total_records = await db.plant_maintenance.count_documents(history_filter)
    spend_pipe = [
        {"$match": {**history_filter, "cost": {"$type": "number"}}},
        {"$group": {"_id": None, "total": {"$sum": "$cost"}}},
    ]
    spend_doc = None
    async for r in db.plant_maintenance.aggregate(spend_pipe):
        spend_doc = r
        break
    total_spend = float(spend_doc["total"]) if spend_doc else 0.0
    last_service_date = history[0]["date_completed"] if history else None

    # Open compliance rollups. Each is a defensive count — we tolerate
    # a missing collection or missing linked_asset_id field gracefully.
    async def _open_count(coll: str, extra: dict) -> int:
        try:
            return await db[coll].count_documents({
                "org_id": org_id,
                "$or": [{"linked_asset_id": asset_id},
                         {"asset_id": asset_id},
                         {"plant_id": asset_id}],
                **extra,
            })
        except Exception as e:  # pragma: no cover
            log.warning("fleet.detail counter %s failed: %s", coll, e)
            return 0

    open_hazards = await _open_count("hazards",
        {"status": {"$nin": ["closed", "resolved"]}})
    open_incidents = await _open_count("incidents",
        {"status": {"$nin": ["closed", "resolved"]}})

    return {
        "asset": a,
        "history": history,
        "history_truncated": len(history) == history_limit and total_records > history_limit,
        "counters": {
            "total_records": total_records,
            "total_spend": total_spend,
            "last_service_date": last_service_date,
            "open_hazards": open_hazards,
            "open_incidents": open_incidents,
        },
    }


# ── /fleet/search ──────────────────────────────────────────────────
_DEEP_LINK_MAP = {
    "asset":       "/app/fleet?open={id}",
    "service":     "/app/fleet?open={plant_id}&service={id}",
    "inspection":  "/app/inspections?open={id}",
    "hazard":      "/app/hazards?open={id}",
    "incident":    "/app/incidents?open={id}",
    "pre_start":   "/app/pre-starts?open={id}",
}


@router.get("/search", response_model=SearchResponse)
@user_limiter.limit("60/minute")
async def fleet_search(
    request: Request,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(get_current_user),
    q: str = Query(..., min_length=1, max_length=200),
    kinds: Optional[str] = Query(None, max_length=200,
        description="Comma-separated: asset,service,inspection,hazard,incident,pre_start"),
):
    """Cross-collection ranked search. Caps 50 hits/collection.
    `kinds` narrows the surface (e.g. `?kinds=asset,service`)."""
    org_id = user["org_id"]
    needle = {"$regex": q, "$options": "i"}
    wanted = set((kinds or "").split(",")) if kinds else set(_DEEP_LINK_MAP.keys())
    wanted = {k.strip() for k in wanted if k.strip()}
    if not wanted:
        wanted = set(_DEEP_LINK_MAP.keys())

    total: dict[str, int] = {k: 0 for k in _DEEP_LINK_MAP.keys()}
    hits: list[dict] = []
    CAP = 50

    async def _scan(coll_name: str, fields: list[str], hit_type: str,
                    build_label, extra_filter=None):
        or_terms = [{f: needle} for f in fields]
        # v58.13.120c2 — pm rows imported pre-.120 all carry
        # `org_id=null`; the detail endpoint already tolerates this
        # (see history_filter in `get_asset_detail`). Mirror the same
        # null-tolerant scope here so search picks them up. Every
        # other collection has proper org_id, so scope tightly.
        if coll_name == "plant_maintenance":
            org_scope = {"$or": [{"org_id": org_id}, {"org_id": None},
                                  {"org_id": {"$exists": False}}]}
            filt = {"deleted_at": None, "$and": [org_scope, {"$or": or_terms}]}
        else:
            filt = {"org_id": org_id, "deleted_at": None, "$or": or_terms}
        if extra_filter:
            filt.update(extra_filter)
        n = await db[coll_name].count_documents(filt)
        total[hit_type] = n
        cursor = db[coll_name].find(filt, {"_id": 0}).limit(CAP)
        async for r in cursor:
            # Which field matched?
            matched_field = None
            for f in fields:
                v = r.get(f)
                if isinstance(v, str) and q.lower() in v.lower():
                    matched_field = f
                    break
            label, snippet = build_label(r)
            deep = _DEEP_LINK_MAP[hit_type].format(
                id=r.get("id", ""),
                plant_id=r.get("plant_id", ""))
            hits.append({"type": hit_type, "id": r.get("id"),
                          "label": label, "snippet": snippet,
                          "deep_link": deep,
                          "matched_field": matched_field})

    # v58.13.120b — Asset scan. Fields include `manufacturer` +
    # `asset_code` (the .120 audit gap).
    if "asset" in wanted:
        await _scan(
            "assets",
            ["rego_serial", "name", "make", "model", "manufacturer",
             "asset_type", "sub_type", "asset_code", "scan_token",
             "description"],
            "asset",
            lambda r: (r.get("name") or r.get("rego_serial") or r["id"],
                        (r.get("description") or "")[:200] or None),
        )
    if "service" in wanted:
        await _scan(
            "plant_maintenance",
            ["maintenance_id", "description", "registration_no",
             "notes", "performed_by", "company", "maintenance_type",
             "manufacturer", "asset_code", "sub_type"],
            "service",
            lambda r: (r.get("maintenance_id") or f"service {r.get('id','')[:8]}",
                        (r.get("description") or "")[:200] or None),
        )
    if "inspection" in wanted:
        await _scan(
            "inspections",
            ["title", "description", "template_name", "notes"],
            "inspection",
            lambda r: (r.get("title") or r.get("template_name") or "inspection",
                        (r.get("description") or "")[:200] or None),
        )
    if "hazard" in wanted:
        await _scan(
            "hazards",
            ["title", "description", "location", "notes"],
            "hazard",
            lambda r: (r.get("title") or "hazard",
                        (r.get("description") or "")[:200] or None),
        )
    if "incident" in wanted:
        await _scan(
            "incidents",
            ["title", "description", "location", "notes"],
            "incident",
            lambda r: (r.get("title") or "incident",
                        (r.get("description") or "")[:200] or None),
        )
    if "pre_start" in wanted:
        await _scan(
            "pre_starts",
            ["type", "work_summary", "notes", "operator_name",
             "site_address"],
            "pre_start",
            lambda r: (r.get("type") or f"pre-start {r.get('date','')}",
                        (r.get("work_summary") or "")[:200] or None),
        )

    # Rank: assets first (most register-relevant), then services, then
    # the rest in enum order. Within each type, keep DB order.
    order = {"asset": 0, "service": 1, "inspection": 2, "hazard": 3,
             "incident": 4, "pre_start": 5}
    hits.sort(key=lambda h: order.get(h["type"], 99))

    return {"hits": hits, "total_by_kind": total, "q": q}


# ── POST /fleet/assets/{id}/services ────────────────────────────────
@router.post("/assets/{asset_id}/services")
async def log_service(
    asset_id: str,
    body: LogServiceIn,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """Log a service against an asset. Inserts into
    `plant_maintenance` with `plant_id` pre-linked, sets
    `registration_matched=True` when the asset carries a rego, and
    stamps `created_by=<user id>` + `logged_via_fleet_ui=True` for
    audit trail differentiation from XLSX imports.

    Permission uses `assets.edit` (matches the existing
    `plant_maintenance.patch_row` / `.delete_row` handlers rather
    than a synthetic `plant_maintenance.create` token that the
    permission matrix doesn't define)."""
    org_id = user["org_id"]
    a = await db.assets.find_one(
        {"id": asset_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "rego_serial": 1},
    )
    if not a:
        raise HTTPException(404, "Asset not found")

    ts = now_iso()
    rec = {
        "id": new_id(),
        # Human-friendly monotonic id: yyyymmdd + short-uuid tail.
        "maintenance_id": f"svc-{ts[:10].replace('-', '')}-{new_id()[:6]}",
        "org_id": org_id,
        "plant_id": asset_id,
        "registration_no": a.get("rego_serial"),
        "registration_matched": bool(a.get("rego_serial")),
        "date_completed": body.date_completed,
        "maintenance_type": body.maintenance_type,
        "cost": body.cost,
        "description": body.description,
        "performed_by": body.performed_by,
        "company": body.company,
        "notes": body.notes,
        "next_due_date": body.next_due_date,
        "created_at": ts,
        "updated_at": ts,
        "created_by": user["id"],
        "logged_via_fleet_ui": True,
        "deleted_at": None,
    }
    # v58.13.121 — Service Check Sheet extension. Only stamp the
    # sheet fields when the caller supplied a `sheet_template_version`
    # (marker of a full-sheet submit) so short-form service logs
    # stay clean.
    if body.sheet_template_version:
        rec.update({
            "checklist_items": body.checklist_items or [],
            "advisory_comments": body.advisory_comments,
            "next_service_due_km": body.next_service_due_km,
            "next_service_due_hours": body.next_service_due_hours,
            "mileage_at_service": body.mileage_at_service,
            "hours_at_service": body.hours_at_service,
            "technician_user_id": body.technician_user_id,
            "technician_name": body.technician_name,
            "technician_signature_data_url": body.technician_signature_data_url,
            "customer_signature_data_url": body.customer_signature_data_url,
            "vin_captured": body.vin_captured,
            "make_model_captured": body.make_model_captured,
            "sheet_template_version": body.sheet_template_version,
            "service_level": body.service_level,
            "tread_depth_readings": body.tread_depth_readings,
            "consumables_used": body.consumables_used,
            "next_inspection_due_date": body.next_inspection_due_date,
        })
        # Copy VIN / Make / Model back to the asset row if the asset
        # side is empty. Never overwrite existing values.
        if body.save_to_asset_record:
            patch: dict = {}
            asset_full = await db.assets.find_one(
                {"id": asset_id, "org_id": org_id},
                {"_id": 0, "vin": 1, "make": 1, "model": 1},
            ) or {}
            if body.vin_captured and not asset_full.get("vin"):
                patch["vin"] = body.vin_captured
            if body.make_model_captured:
                # Best-effort split "Make Model" → make + model.
                parts = body.make_model_captured.strip().split(" ", 1)
                if parts and not asset_full.get("make"):
                    patch["make"] = parts[0]
                if len(parts) > 1 and not asset_full.get("model"):
                    patch["model"] = parts[1]
            if patch:
                patch["updated_at"] = ts
                await db.assets.update_one({"id": asset_id}, {"$set": patch})
    await db.plant_maintenance.insert_one(rec)
    # v58.13.122 — invalidate the schedule-status cache so the next
    # rollup / next-service call for this asset reflects the fresh
    # baseline.
    try:
        from fleet_service_schedules import invalidate_cache as _svc_invalidate
        _svc_invalidate(asset_id)
    except Exception:
        pass
    rec.pop("_id", None)
    return rec


# ── /fleet/categories ──────────────────────────────────────────────
_CATEGORIES_CACHE: dict = {"ts": 0.0, "org_id": None, "data": None}
_CATEGORIES_TTL_SECONDS = 60


@router.get("/categories")
async def get_categories(
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    """Live-count filter tree grouped by kind → sub_type. 60s cache
    keyed on org_id. Includes zero-count sub_types under any kind
    that has at least one row so the UI can render a stable tree
    without flicker."""
    org_id = user["org_id"]
    now = time.time()
    if (_CATEGORIES_CACHE["org_id"] == org_id
            and _CATEGORIES_CACHE["data"] is not None
            and now - _CATEGORIES_CACHE["ts"] < _CATEGORIES_TTL_SECONDS):
        return _CATEGORIES_CACHE["data"]

    # v58.13.126 — Normalise `asset_type` at aggregation-time so
    # `vacuum_truck` + `Vac Truck` collapse into a single "Vacuum
    # Truck" bucket (bug: the raw case-sensitive group produced two
    # buttons in the filter tree, both labelled "Vacuum Truck").
    # Also project a `has_navixy` boolean so we can return the
    # authoritative Data-source counts (bug: frontend derived
    # sourceCounts from list-page rows, which returned 0).
    from asset_taxonomy import normalize_asset_type  # noqa: WPS433
    pipe = [
        {"$match": {"org_id": org_id, "deleted_at": None}},
        {"$group": {
            "_id": {"kind": "$kind", "sub_type": "$asset_type",
                     "status": "$status",
                     "has_navixy": {"$cond": [
                         {"$and": [
                             {"$ne": ["$navixy_device_id", None]},
                             {"$ifNull": ["$navixy_device_id", False]},
                         ]},
                         True, False,
                     ]}},
            "n": {"$sum": 1},
        }},
    ]
    kinds: dict[str, dict] = {}
    src_navixy = src_manual = 0
    async for r in db.assets.aggregate(pipe):
        k = r["_id"].get("kind") or "unknown"
        raw_st = r["_id"].get("sub_type") or "unknown"
        # Collapse to canonical Title-Case at aggregation-time.
        st = normalize_asset_type(raw_st) or raw_st
        status = r["_id"].get("status") or "unknown"
        has_navixy = r["_id"].get("has_navixy", False)
        entry = kinds.setdefault(k, {"kind": k, "total": 0,
                                       "sub_types": {}, "statuses": {}})
        entry["total"] += r["n"]
        entry["sub_types"][st] = entry["sub_types"].get(st, 0) + r["n"]
        entry["statuses"][status] = entry["statuses"].get(status, 0) + r["n"]
        if has_navixy:
            src_navixy += r["n"]
        else:
            src_manual += r["n"]

    total = sum(k["total"] for k in kinds.values())
    data = {
        "kinds": sorted(kinds.values(), key=lambda x: (-x["total"], x["kind"])),
        "total": total,
        # v58.13.126 — Authoritative Data-source counts. Sums to total.
        "source_counts": {
            "total": total,
            "navixy": src_navixy,
            "manual": src_manual,
        },
        "generated_at": now_iso(),
        "cache_ttl_seconds": _CATEGORIES_TTL_SECONDS,
    }
    _CATEGORIES_CACHE.update({"ts": now, "org_id": org_id, "data": data})
    return data


# ── v58.13.121 — /fleet/technicians (5-min cached picker) ────────────
_TECHNICIANS_CACHE: dict = {"ts": 0.0, "org_id": None, "data": None}
_TECHNICIANS_TTL_SECONDS = 300

# Roles/positions considered service-technician candidates.
# v58.13.123a — Narrowed per user directive. Admin/supervisor/manager
# dropped; only tech-role users appear in the Service Check Sheet
# picker.
_TECHNICIAN_ROLE_PREFIXES = ("custom_mechanic", "custom_service_tech",
                              "custom_fitter", "custom_technician")
_TECHNICIAN_POSITION_KEYWORDS = ("mechanic", "technician", "fitter",
                                  "service tech")


@router.get("/technicians")
async def list_technicians(
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "edit")),
):
    """5-min cached picker for the Service Check Sheet's Technician
    field. Returns locally-linked Simpro-imported users whose role
    or position matches a service-technician pattern, plus any
    admin/supervisor role by default. Falls through to free-text
    entry on the frontend when the list is empty."""
    org_id = user["org_id"]
    now = time.time()
    if (_TECHNICIANS_CACHE["org_id"] == org_id
            and _TECHNICIANS_CACHE["data"] is not None
            and now - _TECHNICIANS_CACHE["ts"] < _TECHNICIANS_TTL_SECONDS):
        return _TECHNICIANS_CACHE["data"]

    role_prefixes = _TECHNICIAN_ROLE_PREFIXES
    pos_keywords = _TECHNICIAN_POSITION_KEYWORDS

    filt = {
        "org_id": org_id,
        "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}],
    }
    rows: list[dict] = []
    # v58.13.123a — Expanded source: users collection + workers collection.
    async for u in db.users.find(filt, {
        "_id": 0, "id": 1, "email": 1,
        "first_name": 1, "last_name": 1, "role": 1, "position": 1,
        "simpro_employee_id": 1,
    }):
        role = (u.get("role") or "")
        pos = (u.get("position") or "").lower()
        role_hit = any(role.startswith(p) for p in role_prefixes)
        pos_hit = any(k in pos for k in pos_keywords) if pos else False
        if not (role_hit or pos_hit):
            continue
        name = " ".join([u.get("first_name") or "", u.get("last_name") or ""]).strip()
        if not name:
            name = u.get("email") or u["id"][:8]
        rows.append({
            "id": u["id"], "name": name, "source": "user",
            "role": u.get("role"), "position": u.get("position"),
            "simpro_employee_id": u.get("simpro_employee_id"),
        })
    # v58.13.123a — Also include workers where role/position matches.
    async for w in db.workers.find({"org_id": org_id,
                                      "$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]},
                                     {"_id": 0, "id": 1, "first_name": 1,
                                      "last_name": 1, "position": 1, "role": 1}):
        pos = (w.get("position") or "").lower()
        role = (w.get("role") or "")
        if not (any(k in pos for k in pos_keywords) if pos else False) and not any(role.startswith(p) for p in role_prefixes):
            continue
        name = " ".join([w.get("first_name") or "", w.get("last_name") or ""]).strip() or w["id"][:8]
        rows.append({
            "id": w["id"], "name": name, "source": "worker",
            "role": w.get("role"), "position": w.get("position"),
            "simpro_employee_id": None,
        })
    # Dedupe by id, keep first (users win over workers).
    seen = set(); deduped = []
    for r in rows:
        if r["id"] in seen: continue
        seen.add(r["id"]); deduped.append(r)
    deduped.sort(key=lambda r: r["name"].lower())
    rows = deduped

    data = {
        "technicians": rows,
        "total": len(rows),
        "generated_at": now_iso(),
        "cache_ttl_seconds": _TECHNICIANS_TTL_SECONDS,
    }
    _TECHNICIANS_CACHE.update({"ts": now, "org_id": org_id, "data": data})
    return data


# ── v58.13.121 — /fleet/assets/{id}/service-sheet/{maint}/pdf ────────
@router.get("/assets/{asset_id}/service-sheet/{maintenance_id}/pdf")
async def get_service_sheet_pdf(
    asset_id: str,
    maintenance_id: str,
    request: Request,
    _flag: None = Depends(require_fleet_register_enabled),
    token: Optional[str] = Query(None),
):
    """Generate a watermark-free A4 PDF of a completed Service Check
    Sheet record. Auth via Bearer OR `?token=<jwt>` fallback (same
    v143 pattern used by GridFS photo streams). The generated PDF
    contains ONLY content flowables the module lays down — no source
    watermark ever appears."""
    # Bearer-or-token auth.
    auth_header = request.headers.get("authorization")
    ok, user = await verify_bearer_token(db, auth_header)
    if not ok and token:
        ok, user = await verify_bearer_token(db, f"Bearer {token}")
    if not ok or not user:
        raise HTTPException(401, "Not authenticated")
    org_id = user["org_id"]

    a = await db.assets.find_one(
        {"id": asset_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not a:
        raise HTTPException(404, "Asset not found")
    rec = await db.plant_maintenance.find_one(
        {"$or": [{"id": maintenance_id}, {"maintenance_id": maintenance_id}],
         "plant_id": asset_id, "deleted_at": None},
        {"_id": 0},
    )
    if not rec:
        raise HTTPException(404, "Service record not found")
    if not rec.get("sheet_template_version"):
        raise HTTPException(400, "This record has no Service Check Sheet to print")

    from fleet_service_sheet_pdf import render_service_sheet_pdf
    pdf_bytes = render_service_sheet_pdf(asset=a, record=rec, org_name=user.get("org_name"))
    # v58.13.123 — filename convention: rego-date-template.
    tv = (rec.get("sheet_template_version") or "v121.1").replace(".", "-")
    rego = (a.get("rego_serial") or "asset").replace("/", "-").replace(" ", "-")
    date = (rec.get("date_completed") or "")[:10] or "undated"
    filename = f"service-sheet-{rego}-{date}-{tv}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "X-Sheet-Template-Version": rec.get("sheet_template_version") or "",
        },
    )


# ── v58.13.122 — Service Schedule endpoints ──────────────────────
async def _last_pm_for(asset_id: str, org_id: str) -> Optional[dict]:
    """Latest pm row for an asset. Used to seed `compute_next_due`."""
    cursor = db.plant_maintenance.find(
        {"plant_id": asset_id,
         "$or": [{"org_id": org_id}, {"org_id": None}, {"org_id": {"$exists": False}}],
         "deleted_at": None},
        {"_id": 0}
    ).sort([("date_completed", -1), ("id", -1)]).limit(1)
    async for r in cursor:
        return r
    return None


@router.get("/assets/{asset_id}/next-service")
async def get_next_service(
    asset_id: str,
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    """Compute the next-service block for a single asset. Cached
    5 min in-memory; invalidated by `log_service` on any new pm
    row for the asset."""
    org_id = user["org_id"]
    a = await db.assets.find_one(
        {"id": asset_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not a:
        raise HTTPException(404, "Asset not found")
    from fleet_service_schedules import compute_next_due
    last_pm = await _last_pm_for(asset_id, org_id)
    return compute_next_due(a, last_pm)


@router.get("/service-status-rollup")
async def get_service_status_rollup(
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
    ids: Optional[str] = Query(None, max_length=8000,
        description="Comma-separated asset ids. When omitted, rolls up the whole org."),
):
    """Batched status per asset id (used by the register table to
    render Status pills without N HTTP calls). Response:
    `{ statuses: {<asset_id>: {status, level, hint, ...}, ...},
       counts: {green, amber, red, grey}, total }`."""
    org_id = user["org_id"]
    filt: dict = {"org_id": org_id, "deleted_at": None}
    if ids:
        wanted = [i.strip() for i in ids.split(",") if i.strip()]
        if not wanted:
            return {"statuses": {}, "counts": {"green": 0, "amber": 0, "red": 0, "grey": 0}, "total": 0}
        filt["id"] = {"$in": wanted}

    from fleet_service_schedules import compute_next_due
    statuses: dict[str, dict] = {}
    counts = {"green": 0, "amber": 0, "red": 0, "grey": 0}
    async for a in db.assets.find(filt, {"_id": 0}):
        aid = a["id"]
        last_pm = await _last_pm_for(aid, org_id)
        block = compute_next_due(a, last_pm)
        # Trim to just what the register-table pill needs.
        statuses[aid] = {
            "status": block["status"],
            "level": block["level"],
            "primary_metric": block["primary_metric"],
            "hint": block["hint"],
        }
        counts[block["status"]] = counts.get(block["status"], 0) + 1
    return {"statuses": statuses, "counts": counts, "total": len(statuses)}


# ── v58.13.123 — Sheet template registry endpoint ────────────────
@router.get("/service-sheet-templates")
async def list_sheet_templates(
    _flag: None = Depends(require_fleet_register_enabled),
    user: dict = Depends(require_permission("assets", "view")),
):
    """Return the frozen template registry. Callers pick the version
    via `pick_default_template(asset)` OR by explicit user choice."""
    from fleet_service_sheet_templates import all_templates, pick_default_template
    return {
        "templates": all_templates(),
        "default_for_asset_note": "Client should call pick_default_template(asset) via the frontend helper.",
    }
