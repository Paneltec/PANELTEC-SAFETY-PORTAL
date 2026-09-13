"""v58.13.132eg — Server-side category counts for CAPTURE modules.

Adds `GET /api/{module}/category-counts` for each CAPTURE module so the
FE pill filters can render TRUE DB aggregates instead of counts derived
from the pagination-capped page. Without this, the `.132ef` X-Total
fix left a stale pill row on the Pre-Starts page: chips summed to 5,000
(the page cap) not 15,424 (the true active count).

Contract:
    GET /api/{module}/category-counts?include_archived=false
        →
        {
          "categories": [{"label": str, "count": int}, ...],
          "all_count": int,      # sum(categories.count), == X-Total-Count
          "archived_count": int, # == X-Archived-Count
        }

Categories are sorted count-desc. `all_count` respects the current
`include_archived` state so it moves in lockstep with the list
endpoint's `X-Total-Count` header from `.132ef`.

For `pre_starts`, the "category" is the inferred template type — same
inference logic the FE has in `preStartsPalette.inferTemplateType()`:
prefer `template_name_snapshot` → fall back to `template_name` → parse
`::<TYPE>` out of the `work_summary` import marker.

For the other modules, `category` maps to the natively-stored field
UNION the mirrored `form_submissions.template_name_snapshot` for the
same `mirror_categories` set the list endpoint uses:
    incidents         → native `category` ∪ mirror `template_name_snapshot`
    hazards           → native `severity` ∪ mirror `template_name_snapshot`
    inspections       → native `template_name` ∪ mirror `template_name_snapshot`
    risk_assessments  → native `severity` ∪ mirror `template_name_snapshot`
    site_diary        → native "Free-form" ∪ mirror `template_name_snapshot`
    admin/visitors    → native `purpose`

Mirror categories are kept in sync with the list-router registrations
in `crud.py` (search for `mirror_categories=`).

All routes require the same `<resource>.view` permission the module's
list route uses.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any, Dict

from fastapi import APIRouter, Depends

from db import db
from permissions import require_permission

logger = logging.getLogger("paneltec.category_counts")

router = APIRouter(tags=["category-counts"])


# ─── Shared helpers ────────────────────────────────────────────
def _base_query(user: dict, include_archived: bool) -> Dict[str, Any]:
    q: Dict[str, Any] = {"org_id": user["org_id"], "deleted_at": None}
    if not include_archived:
        q["archived_at"] = None
    return q


async def _archived_count(collection: str, user: dict) -> int:
    return await db[collection].count_documents({
        "org_id": user["org_id"], "deleted_at": None,
        "archived_at": {"$ne": None},
    })


async def _mirror_archived_count(mirror_categories: list[str], user: dict) -> int:
    return await db.form_submissions.count_documents({
        "org_id": user["org_id"], "deleted_at": None,
        "template_category_snapshot": {"$in": mirror_categories},
        "archived_at": {"$ne": None},
    })


async def _mirror_group_by_template(
    mirror_categories: list[str], user: dict, include_archived: bool,
) -> Counter:
    """Group mirrored `form_submissions` by `template_name_snapshot`."""
    mq: Dict[str, Any] = {
        "org_id": user["org_id"], "deleted_at": None,
        "template_category_snapshot": {"$in": mirror_categories},
    }
    if not include_archived:
        mq["archived_at"] = None
    counter: Counter = Counter()
    async for r in db.form_submissions.aggregate([
        {"$match": mq},
        {"$group": {"_id": "$template_name_snapshot", "n": {"$sum": 1}}},
    ]):
        counter[r["_id"] or ""] += r["n"]
    return counter


def _pack(counter: Counter, archived: int) -> Dict[str, Any]:
    return {
        "categories": [{"label": k or "Unclassified", "count": v}
                       for k, v in counter.most_common()],
        "all_count": sum(counter.values()),
        "archived_count": archived,
    }


# ─── Pre-Starts (inferred type from `work_summary`) ────────────
_WS_TAIL_A = re.compile(r"\s*\(\d+\)\s*-\s*\d+.*$")
_WS_TAIL_B = re.compile(r"\.pdf.*$", re.I)
_PRESTART_MIRROR = ["pre_start", "plant_pre_start"]


def _infer_pre_start_type(doc: dict) -> str:
    """Mirror of `frontend/src/lib/preStartsPalette.js::inferTemplateType`."""
    t = doc.get("template_name_snapshot") or doc.get("template_name") or ""
    t = t.strip() if isinstance(t, str) else ""
    if t:
        return t
    ws = doc.get("work_summary") or ""
    if not isinstance(ws, str):
        return ""
    idx = ws.find("::")
    if idx == -1:
        return ""
    after = ws[idx + 2:]
    after = _WS_TAIL_A.sub("", after)
    after = _WS_TAIL_B.sub("", after)
    return after.strip()


@router.get("/pre-starts/category-counts")
async def pre_starts_category_counts(
    include_archived: bool = False,
    user: dict = Depends(require_permission("pre_starts", "view")),
):
    q = _base_query(user, include_archived)
    counter: Counter = Counter()
    projection = {"_id": 0, "template_name_snapshot": 1,
                  "template_name": 1, "work_summary": 1}
    async for d in db.pre_starts.find(q, projection):
        counter[_infer_pre_start_type(d)] += 1
    # Add mirrored form_submissions rows the same way the list route
    # unions them.
    counter += await _mirror_group_by_template(
        _PRESTART_MIRROR, user, include_archived)
    archived = await _archived_count("pre_starts", user)
    archived += await _mirror_archived_count(_PRESTART_MIRROR, user)
    return _pack(counter, archived)


# ─── Incidents (native `category` + `incident` mirror) ─────────
_INCIDENT_MIRROR = ["incident"]


@router.get("/incidents/category-counts")
async def incidents_category_counts(
    include_archived: bool = False,
    user: dict = Depends(require_permission("incidents", "view")),
):
    q = _base_query(user, include_archived)
    counter: Counter = Counter()
    async for r in db.incidents.aggregate([
        {"$match": q},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]):
        counter[r["_id"] or ""] += r["n"]
    counter += await _mirror_group_by_template(
        _INCIDENT_MIRROR, user, include_archived)
    archived = await _archived_count("incidents", user)
    archived += await _mirror_archived_count(_INCIDENT_MIRROR, user)
    return _pack(counter, archived)


# ─── Hazards (native `severity` + `hazard`/`near_miss` mirror) ─
_HAZARD_MIRROR = ["hazard", "near_miss"]


@router.get("/hazards/category-counts")
async def hazards_category_counts(
    include_archived: bool = False,
    user: dict = Depends(require_permission("hazards", "view")),
):
    q = _base_query(user, include_archived)
    counter: Counter = Counter()
    async for r in db.hazards.aggregate([
        {"$match": q},
        {"$group": {"_id": "$severity", "n": {"$sum": 1}}},
    ]):
        counter[r["_id"] or ""] += r["n"]
    counter += await _mirror_group_by_template(
        _HAZARD_MIRROR, user, include_archived)
    archived = await _archived_count("hazards", user)
    archived += await _mirror_archived_count(_HAZARD_MIRROR, user)
    return _pack(counter, archived)


# ─── Inspections (native `template_name` + `inspection` mirror) ─
_INSPECTION_MIRROR = ["inspection"]


@router.get("/inspections/category-counts")
async def inspections_category_counts(
    include_archived: bool = False,
    user: dict = Depends(require_permission("inspections", "view")),
):
    q = _base_query(user, include_archived)
    counter: Counter = Counter()
    async for r in db.inspections.aggregate([
        {"$match": q},
        {"$group": {"_id": "$template_name", "n": {"$sum": 1}}},
    ]):
        counter[r["_id"] or ""] += r["n"]
    counter += await _mirror_group_by_template(
        _INSPECTION_MIRROR, user, include_archived)
    archived = await _archived_count("inspections", user)
    archived += await _mirror_archived_count(_INSPECTION_MIRROR, user)
    return _pack(counter, archived)


# ─── Risk Assessments (native `severity` + `risk_assessment` mirror)
_SSRA_MIRROR = ["risk_assessment"]


@router.get("/risk-assessments/category-counts")
async def risk_assessments_category_counts(
    include_archived: bool = False,
    user: dict = Depends(require_permission("risk_assessments", "view")),
):
    q = _base_query(user, include_archived)
    counter: Counter = Counter()
    async for r in db.risk_assessments.aggregate([
        {"$match": q},
        {"$group": {"_id": "$severity", "n": {"$sum": 1}}},
    ]):
        counter[r["_id"] or ""] += r["n"]
    counter += await _mirror_group_by_template(
        _SSRA_MIRROR, user, include_archived)
    archived = await _archived_count("risk_assessments", user)
    archived += await _mirror_archived_count(_SSRA_MIRROR, user)
    return _pack(counter, archived)


# ─── Site Diary (no native category; `site_diary` mirror) ─────
_DIARY_MIRROR = ["site_diary"]


@router.get("/site-diary/category-counts")
async def site_diary_category_counts(
    include_archived: bool = False,
    user: dict = Depends(require_permission("site_diary", "view")),
):
    q = _base_query(user, include_archived)
    counter: Counter = Counter()
    free = await db.site_diary_entries.count_documents(q)
    if free:
        counter["Free-form"] += free
    counter += await _mirror_group_by_template(
        _DIARY_MIRROR, user, include_archived)
    archived = await _archived_count("site_diary_entries", user)
    archived += await _mirror_archived_count(_DIARY_MIRROR, user)
    return _pack(counter, archived)


# ─── Site Visitors (group by `purpose`) ───────────────────────
# v58.13.132eg — Route lives under `/admin` NOT `/admin/visitors` so
# it slots in before the visitor_admin_router's `/{visitor_id}` catch.
# Compensated in the ship memo — the FE hits
# `/api/admin/visitors/category-counts` and this router prefix does
# the same.
@router.get("/admin/visitors/category-counts")
async def admin_visitors_category_counts(
    include_archived: bool = False,
    user: dict = Depends(require_permission("sites_visitors", "view")),
):
    q: Dict[str, Any] = {"org_id": user["org_id"]}
    q["$or"] = [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]
    if not include_archived:
        q["archived_at"] = None
    counter: Counter = Counter()
    async for r in db.site_visitors.aggregate([
        {"$match": q},
        {"$group": {"_id": "$purpose", "n": {"$sum": 1}}},
    ]):
        counter[r["_id"] or ""] += r["n"]
    archived = await db.site_visitors.count_documents({
        "org_id": user["org_id"], "archived_at": {"$ne": None},
    })
    return _pack(counter, archived)
