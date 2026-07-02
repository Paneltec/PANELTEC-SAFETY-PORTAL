"""Phase 4.17 v134.x (paneltec-v134) — Module dashboards aggregator.

Shared endpoint that powers the per-module analytics dashboards. Each module
has an aggregator function registered in `AGGREGATORS`; unknown modules 404
and modules whose aggregator hasn't been implemented yet return a `todo`
skeleton so the frontend can render a "coming soon" state instead of erroring.

Contract:
    GET /api/dashboards/{module}
    →  { module, kpis[], charts[], attention[], generated_at,
         todo?: bool, cache_hit: bool }

Cache:
    In-process per (org_id, module) for 60 s. No redis; single-process
    workers make this safe. Log line per call:
        `dashboards.query module=X org=Y ms=Z cache=hit|miss`

Aggregators shipped:
  v134.0 → SWMS
  v134.1 → Hazards, Incidents, Inspections, Sites
  v134.2 → Plant & Vehicles, Workers, Certifications, Audit Exports
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import db

log = logging.getLogger("paneltec.dashboards")
router = APIRouter(prefix="/dashboards", tags=["dashboards"])

# ---------------------------------------------------------------------------
# In-process cache — keyed by (org_id, module) → (payload_dict, expires_at).
# 60 s window matches the frontend auto-refresh cadence.
# ---------------------------------------------------------------------------
_CACHE: Dict[tuple, tuple] = {}
_CACHE_TTL_SECONDS = 60


def _cache_get(org_id: str, module: str):
    entry = _CACHE.get((org_id, module))
    if not entry:
        return None
    payload, expires_at = entry
    if time.monotonic() > expires_at:
        _CACHE.pop((org_id, module), None)
        return None
    return payload


def _cache_set(org_id: str, module: str, payload: dict):
    _CACHE[(org_id, module)] = (payload, time.monotonic() + _CACHE_TTL_SECONDS)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_dt(value) -> datetime | None:
    """Best-effort parse of the mixed date/datetime shapes used across
    collections (some ISO strings, some datetime objects, some date-only)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        s = value.strip()
        # Try full ISO first, then date-only.
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            pass
        if len(s) >= 10:
            try:
                d = datetime.strptime(s[:10], "%Y-%m-%d")
                return d.replace(tzinfo=timezone.utc)
            except ValueError:
                return None
    return None


def _month_buckets(n: int = 12) -> tuple[list[dict], dict]:
    """Return `n` monthly buckets (oldest → newest) plus a key index."""
    now = datetime.now(timezone.utc)
    months: list[dict] = []
    cursor = now.replace(day=1)
    for _ in range(n):
        months.append({
            "key": cursor.strftime("%Y-%m"),
            "label": cursor.strftime("%b"),
            "count": 0,
        })
        prev = cursor - timedelta(days=1)
        cursor = prev.replace(day=1)
    months.reverse()
    return months, {m["key"]: m for m in months}


def _day_buckets(n: int = 30) -> tuple[list[dict], dict]:
    """Return `n` daily buckets (oldest → newest) plus a key index."""
    today = datetime.now(timezone.utc).date()
    days: list[dict] = []
    for i in range(n - 1, -1, -1):
        d = today - timedelta(days=i)
        days.append({
            "key": d.isoformat(),
            "label": d.strftime("%d %b") if i == n - 1 or i == 0 or i % 5 == 0 else d.strftime("%d"),
            "count": 0,
        })
    return days, {x["key"]: x for x in days}


def _week_buckets(n: int = 12) -> tuple[list[dict], dict]:
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    weeks: list[dict] = []
    for i in range(n - 1, -1, -1):
        w = monday - timedelta(weeks=i)
        key = w.isoformat()
        weeks.append({"key": key, "label": w.strftime("%d %b"), "count": 0,
                      "closed": 0})
    return weeks, {w["key"]: w for w in weeks}


# ===========================================================================
# SWMS
# ===========================================================================
_SWMS_STATUSES = ["draft", "submitted", "changes_requested", "approved", "superseded"]
_SWMS_STATUS_LABELS = {
    "draft": "Draft", "submitted": "Submitted",
    "changes_requested": "Changes requested",
    "approved": "Approved", "superseded": "Superseded",
}
_SWMS_STATUS_COLORS = {
    "draft": "#94A3B8", "submitted": "#F59E0B",
    "changes_requested": "#EF4444", "approved": "#10B981",
    "superseded": "#64748B",
}


async def _aggregate_swms(org_id: str) -> dict:
    base = {"org_id": org_id, "deleted_at": None}

    status_counts = {s: 0 for s in _SWMS_STATUSES}
    async for row in db.swms.aggregate(
        [{"$match": base}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]
    ):
        s = row.get("_id") or "draft"
        status_counts[s] = row.get("n", 0)

    total = sum(status_counts.values())
    drafts = status_counts.get("draft", 0)
    approved = status_counts.get("approved", 0)
    submitted = status_counts.get("submitted", 0)
    changes = status_counts.get("changes_requested", 0)

    ai_parsed = await db.swms.count_documents({
        **base,
        "$or": [
            {"parsed_by_ai": True},
            {"source_kind": {"$in": ["paste", "scan"]}},
            {"source_file": {"$exists": True, "$ne": None}},
        ],
    })

    months, idx = _month_buckets(12)
    async for doc in db.swms.find(
        {**base, "created_at": {"$exists": True}},
        {"created_at": 1, "_id": 0},
    ):
        dt = _parse_dt(doc.get("created_at"))
        if not dt:
            continue
        m = idx.get(dt.strftime("%Y-%m"))
        if m:
            m["count"] += 1
    trend = [{"x": m["label"], "y": m["count"]} for m in months]

    attention: list[dict] = []
    q = {**base, "status": {"$in": ["submitted", "changes_requested"]}}
    async for doc in db.swms.find(q, {"id": 1, "title": 1, "status": 1,
                                      "created_at": 1, "version": 1}) \
            .sort("created_at", -1).limit(5):
        st = doc.get("status") or "submitted"
        attention.append({
            "id": doc.get("id"),
            "label": f"{doc.get('title') or 'Untitled SWMS'} — {_SWMS_STATUS_LABELS.get(st, st)}",
            "timestamp": doc.get("created_at").isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
            "severity": "amber" if st == "submitted" else "red",
            "route": f"/app/swms/{doc.get('id')}",
        })

    donut = [
        {"label": _SWMS_STATUS_LABELS[s], "value": status_counts.get(s, 0),
         "color": _SWMS_STATUS_COLORS[s]}
        for s in _SWMS_STATUSES if status_counts.get(s, 0) > 0
    ]

    kpis = [
        {"key": "total", "label": "Total SWMS", "value": total},
        {"key": "drafts", "label": "Drafts", "value": drafts},
        {"key": "approved", "label": "Approved", "value": approved},
        {"key": "ai_parsed", "label": "AI-parsed", "value": ai_parsed},
        {"key": "awaiting_ack", "label": "Awaiting acknowledgement",
         "value": submitted + changes,
         "placeholder": True, "coming_soon": True,
         "hint": "Acknowledgement tracking ships in a future phase; the "
                 "count above reflects SWMS currently in review."},
    ]
    charts = [
        {"type": "bar",   "title": "SWMS created per month (last 12)", "data": trend},
        {"type": "donut", "title": "By status", "data": donut},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ===========================================================================
# HAZARDS
# ===========================================================================
_SEV_COLORS = {"low": "#94A3B8", "medium": "#F59E0B",
               "high": "#EF4444", "critical": "#B91C1C"}
_SEV_ORDER = ["critical", "high", "medium", "low"]


async def _aggregate_hazards(org_id: str) -> dict:
    base = {"org_id": org_id, "deleted_at": None}
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    open_count = await db.hazards.count_documents({**base, "status": {"$in": ["open", "in_progress"]}})
    closed_week = await db.hazards.count_documents({
        **base, "status": "closed",
        "updated_at": {"$gte": week_ago.isoformat()},
    })
    high_open = await db.hazards.count_documents({
        **base, "status": {"$in": ["open", "in_progress"]},
        "severity": {"$in": ["high", "critical"]},
    })

    # Severity donut.
    sev_counts = {s: 0 for s in _SEV_ORDER}
    async for row in db.hazards.aggregate(
        [{"$match": base}, {"$group": {"_id": "$severity", "n": {"$sum": 1}}}]
    ):
        s = row.get("_id") or "medium"
        sev_counts[s] = row.get("n", 0)
    donut = [{"label": s.capitalize(), "value": sev_counts.get(s, 0),
              "color": _SEV_COLORS[s]}
             for s in _SEV_ORDER if sev_counts.get(s, 0) > 0]

    # Weekly line: captured vs closed over 12 weeks.
    weeks, widx = _week_buckets(12)
    for w in weeks:
        w["closed"] = 0

    def _week_key(dt: datetime) -> str:
        d = dt.date()
        m = d - timedelta(days=d.weekday())
        return m.isoformat()

    async for doc in db.hazards.find({**base}, {"created_at": 1, "updated_at": 1, "status": 1, "_id": 0}):
        cdt = _parse_dt(doc.get("created_at"))
        if cdt:
            w = widx.get(_week_key(cdt))
            if w:
                w["count"] += 1
        if (doc.get("status") == "closed"):
            udt = _parse_dt(doc.get("updated_at"))
            if udt:
                w = widx.get(_week_key(udt))
                if w:
                    w["closed"] += 1

    # Flatten into two series interleaved for the bar chart.
    trend = [{"x": w["label"], "y": w["count"]} for w in weeks]

    # Avg time-to-close (days) — best-effort using updated_at - created_at
    # on closed hazards.
    close_deltas: list[float] = []
    async for doc in db.hazards.find({**base, "status": "closed"},
                                     {"created_at": 1, "updated_at": 1, "_id": 0}):
        cdt = _parse_dt(doc.get("created_at"))
        udt = _parse_dt(doc.get("updated_at"))
        if cdt and udt and udt >= cdt:
            close_deltas.append((udt - cdt).total_seconds() / 86400.0)
    avg_close = round(sum(close_deltas) / len(close_deltas), 1) if close_deltas else 0

    # Attention rows — high/critical open hazards, newest first.
    attention: list[dict] = []
    q = {**base, "status": {"$in": ["open", "in_progress"]},
         "severity": {"$in": ["high", "critical"]}}
    async for doc in db.hazards.find(q, {"id": 1, "title": 1, "severity": 1,
                                         "created_at": 1, "status": 1}) \
            .sort("created_at", -1).limit(5):
        sev = doc.get("severity") or "high"
        attention.append({
            "id": doc.get("id"),
            "label": f"{doc.get('title') or 'Hazard'} — {sev} · {doc.get('status')}",
            "timestamp": doc.get("created_at"),
            "severity": "red" if sev in ("high", "critical") else "amber",
            "route": f"/app/hazards/{doc.get('id')}",
        })

    kpis = [
        {"key": "open", "label": "Open", "value": open_count},
        {"key": "closed_week", "label": "Closed this week", "value": closed_week},
        {"key": "high_open", "label": "High-severity open", "value": high_open},
        {"key": "avg_close", "label": "Avg close (days)", "value": avg_close, "unit": "d"},
    ]
    charts = [
        {"type": "bar",   "title": "Hazards captured per week (12wk)", "data": trend},
        {"type": "donut", "title": "By severity", "data": donut},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ===========================================================================
# INCIDENTS
# ===========================================================================
_INC_CATEGORY_COLORS = {
    "near_miss": "#F59E0B", "first_aid": "#10B981",
    "property":  "#7C3AED", "env":       "#0EA5E9",
    "medical":   "#EF4444", "lti":       "#B91C1C",
}
_INC_CATEGORY_LABEL = {
    "near_miss": "Near miss", "first_aid": "First aid",
    "property": "Property", "env": "Environmental",
    "medical": "Medical", "lti": "LTI",
}


async def _aggregate_incidents(org_id: str) -> dict:
    base = {"org_id": org_id, "deleted_at": None}
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    this_month = await db.incidents.count_documents({
        **base, "occurred_at": {"$gte": month_start.isoformat()},
    })
    ytd = await db.incidents.count_documents({
        **base, "occurred_at": {"$gte": year_start.isoformat()},
    })
    open_inv = await db.incidents.count_documents({
        **base, "follow_up_status": {"$in": ["open", "in_progress"]},
    })

    # Days since last incident
    last = await db.incidents.find_one(
        {**base}, {"occurred_at": 1, "_id": 0}, sort=[("occurred_at", -1)])
    days_since = None
    if last:
        dt = _parse_dt(last.get("occurred_at"))
        if dt:
            days_since = max(0, (now - dt).days)

    # 12-month bar.
    months, idx = _month_buckets(12)
    async for doc in db.incidents.find({**base}, {"occurred_at": 1, "_id": 0}):
        dt = _parse_dt(doc.get("occurred_at"))
        if not dt:
            continue
        m = idx.get(dt.strftime("%Y-%m"))
        if m:
            m["count"] += 1
    trend = [{"x": m["label"], "y": m["count"]} for m in months]

    # Donut by category.
    cat_counts: Dict[str, int] = {}
    async for row in db.incidents.aggregate(
        [{"$match": base}, {"$group": {"_id": "$category", "n": {"$sum": 1}}}]
    ):
        cat_counts[row.get("_id") or "other"] = row.get("n", 0)
    donut = [
        {"label": _INC_CATEGORY_LABEL.get(k, k.replace("_", " ").title()),
         "value": v,
         "color": _INC_CATEGORY_COLORS.get(k, "#94A3B8")}
        for k, v in sorted(cat_counts.items(), key=lambda x: -x[1]) if v > 0
    ]

    attention: list[dict] = []
    q = {**base, "follow_up_status": {"$in": ["open", "in_progress"]}}
    async for doc in db.incidents.find(q, {"id": 1, "title": 1, "category": 1,
                                           "follow_up_status": 1, "occurred_at": 1}) \
            .sort("occurred_at", -1).limit(5):
        cat = _INC_CATEGORY_LABEL.get(doc.get("category") or "", doc.get("category") or "incident")
        attention.append({
            "id": doc.get("id"),
            "label": f"{doc.get('title') or 'Incident'} — {cat}",
            "timestamp": doc.get("occurred_at"),
            "severity": "red" if doc.get("follow_up_status") == "open" else "amber",
            "route": f"/app/incidents/{doc.get('id')}",
        })

    kpis = [
        {"key": "month", "label": "This month", "value": this_month},
        {"key": "ytd", "label": "Year to date", "value": ytd},
        {"key": "days_since", "label": "Days since last",
         "value": days_since if days_since is not None else 0,
         "unit": "d",
         **({} if days_since is not None else {"placeholder": True, "coming_soon": True,
                                               "hint": "No incidents recorded yet"})},
        {"key": "open_inv", "label": "Open investigations", "value": open_inv},
    ]
    charts = [
        {"type": "bar",   "title": "Incidents per month (12mo)", "data": trend},
        {"type": "donut", "title": "By category", "data": donut},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ===========================================================================
# INSPECTIONS
# ===========================================================================
_INSP_TYPE_COLORS = ["#F97316", "#10B981", "#7C3AED", "#F59E0B", "#0EA5E9", "#EF4444"]


def _insp_pass_rate(items: list) -> float | None:
    if not items:
        return None
    graded = [i for i in items if (i.get("response") or "").lower() in ("pass", "fail")]
    if not graded:
        return None
    passes = sum(1 for i in graded if (i.get("response") or "").lower() == "pass")
    return round(passes / len(graded) * 100.0, 1)


async def _aggregate_inspections(org_id: str) -> dict:
    base = {"org_id": org_id, "deleted_at": None}
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    completed_month = await db.inspections.count_documents({
        **base, "date": {"$gte": month_start.strftime("%Y-%m-%d")},
    })
    # Overdue heuristic: no corrective_actions closed & date > 30d ago.
    thirty_ago = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    overdue = await db.inspections.count_documents({
        **base, "date": {"$lt": thirty_ago},
        "corrective_actions": {"$exists": True, "$ne": []},
    })

    # 12-month pass rate line & type bar; compute in one pass.
    months, idx = _month_buckets(12)
    for m in months:
        m["pass_total"] = 0
        m["pass_count"] = 0
    type_counts: Dict[str, int] = {}
    rates: list[float] = []

    async for doc in db.inspections.find(
        {**base}, {"date": 1, "template_name": 1, "checklist_items": 1, "_id": 0}
    ):
        dt = _parse_dt(doc.get("date"))
        items = doc.get("checklist_items") or []
        graded = [i for i in items if (i.get("response") or "").lower() in ("pass", "fail")]
        passes = sum(1 for i in graded if (i.get("response") or "").lower() == "pass")
        if dt:
            m = idx.get(dt.strftime("%Y-%m"))
            if m:
                m["pass_total"] += len(graded)
                m["pass_count"] += passes
        if graded:
            rates.append(passes / len(graded))
        t = (doc.get("template_name") or "Other")
        type_counts[t] = type_counts.get(t, 0) + 1

    trend = [
        {"x": m["label"],
         "y": round(m["pass_count"] / m["pass_total"] * 100.0, 1) if m["pass_total"] else 0}
        for m in months
    ]
    avg_pass_rate = round(sum(rates) / len(rates) * 100.0, 1) if rates else 0

    # Bar by inspection type (top 6).
    top_types = sorted(type_counts.items(), key=lambda x: -x[1])[:6]
    type_bar = [{"x": t[:14], "y": c} for t, c in top_types]

    attention: list[dict] = []
    async for doc in db.inspections.find(
        {**base}, {"id": 1, "template_name": 1, "date": 1, "checklist_items": 1}
    ).sort("date", -1).limit(20):
        rate = _insp_pass_rate(doc.get("checklist_items") or [])
        if rate is None or rate >= 80:
            continue
        attention.append({
            "id": doc.get("id"),
            "label": f"{doc.get('template_name') or 'Inspection'} — {rate:.0f}% pass rate",
            "timestamp": doc.get("date"),
            "severity": "red" if rate < 60 else "amber",
            "route": f"/app/inspections/{doc.get('id')}",
        })
        if len(attention) >= 5:
            break

    kpis = [
        {"key": "month", "label": "Completed this month", "value": completed_month},
        {"key": "overdue", "label": "Overdue follow-up", "value": overdue},
        {"key": "pass_rate", "label": "Pass rate", "value": avg_pass_rate, "unit": "%"},
        {"key": "types", "label": "Templates in use", "value": len(type_counts)},
    ]
    charts = [
        {"type": "bar", "title": "Pass rate per month (%)", "data": trend},
        {"type": "bar", "title": "Inspections by type", "data": type_bar},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ===========================================================================
# SITES
# ===========================================================================
async def _aggregate_sites(org_id: str) -> dict:
    base = {"org_id": org_id, "deleted_at": None}
    now = datetime.now(timezone.utc)
    today = now.date()
    today_start = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
    week_ago = now - timedelta(days=7)

    active_sites = await db.sites.count_documents({**base, "active": True})
    if active_sites == 0:  # fallback if `active` field isn't set
        active_sites = await db.sites.count_documents(base)

    signons_today = await db.site_signons.count_documents({
        "org_id": org_id,
        "signed_at": {"$gte": today_start.isoformat()},
    })
    # "Currently on site" — sign-ons in the last 12h without a matching sign-off.
    on_site_since = (now - timedelta(hours=12)).isoformat()
    currently_on_site = await db.site_signons.count_documents({
        "org_id": org_id,
        "signed_at": {"$gte": on_site_since},
        "$or": [{"signed_off_at": {"$exists": False}}, {"signed_off_at": None}],
    })

    gps_anomalies = await db.site_signons.count_documents({
        "org_id": org_id,
        "signed_at": {"$gte": week_ago.isoformat()},
        "gps_distance_m": {"$gt": 250},
    })

    # 30-day sign-ons bar.
    days, didx = _day_buckets(30)
    async for doc in db.site_signons.find(
        {"org_id": org_id, "signed_at": {"$gte": (now - timedelta(days=31)).isoformat()}},
        {"signed_at": 1, "site_name": 1, "_id": 0},
    ):
        dt = _parse_dt(doc.get("signed_at"))
        if not dt:
            continue
        key = dt.date().isoformat()
        d = didx.get(key)
        if d:
            d["count"] += 1
    trend = [{"x": d["label"], "y": d["count"]} for d in days]

    # Sign-ons by site (donut).
    site_counts: Dict[str, int] = {}
    async for row in db.site_signons.aggregate([
        {"$match": {"org_id": org_id,
                    "signed_at": {"$gte": week_ago.isoformat()}}},
        {"$group": {"_id": "$site_name", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 8},
    ]):
        site_counts[row.get("_id") or "Unknown"] = row.get("n", 0)
    palette = ["#F97316", "#10B981", "#7C3AED", "#F59E0B", "#0EA5E9",
               "#EF4444", "#8B5CF6", "#0891B2"]
    donut = [{"label": (k or "Unknown")[:22], "value": v, "color": palette[i % len(palette)]}
             for i, (k, v) in enumerate(site_counts.items()) if v > 0]

    attention: list[dict] = []
    async for doc in db.site_signons.find({
        "org_id": org_id,
        "signed_at": {"$gte": week_ago.isoformat()},
        "gps_distance_m": {"$gt": 250},
    }, {"id": 1, "site_name": 1, "signed_at": 1, "gps_distance_m": 1}) \
            .sort("signed_at", -1).limit(5):
        d = int(doc.get("gps_distance_m") or 0)
        attention.append({
            "id": doc.get("id"),
            "label": f"GPS anomaly · {doc.get('site_name') or 'Site'} · {d} m from marker",
            "timestamp": doc.get("signed_at"),
            "severity": "amber",
            "route": "/app/sites",
        })

    kpis = [
        {"key": "active", "label": "Active sites", "value": active_sites},
        {"key": "on_site", "label": "Currently on site", "value": currently_on_site},
        {"key": "today", "label": "Sign-ons today", "value": signons_today},
        {"key": "gps_anomalies", "label": "GPS anomalies (7d)", "value": gps_anomalies},
    ]
    charts = [
        {"type": "bar",   "title": "Sign-ons per day (30d)", "data": trend},
        {"type": "donut", "title": "Sign-ons by site (7d)", "data": donut},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ===========================================================================
# PLANT & VEHICLES
# ===========================================================================
_ASSET_TYPE_PALETTE = ["#F97316", "#10B981", "#7C3AED", "#F59E0B",
                       "#0EA5E9", "#EF4444", "#8B5CF6", "#0891B2"]


async def _aggregate_vehicles(org_id: str) -> dict:
    base = {"org_id": org_id, "deleted_at": None}
    now = datetime.now(timezone.utc)
    today = now.date()
    week_ago_iso = (today - timedelta(days=7)).isoformat()
    thirty_ago_iso = (today - timedelta(days=30)).isoformat()

    active_assets = await db.assets.count_documents(base)

    # Fleet totals from most-recent per-asset meter reading. Use aggregate
    # pipeline that groups by asset_id and picks max snapshot_date.
    pipe = [
        {"$match": {"org_id": org_id,
                    "snapshot_date": {"$gte": thirty_ago_iso}}},
        {"$sort": {"snapshot_date": -1}},
        {"$group": {"_id": "$asset_id",
                    "eh": {"$first": "$engine_hours_total"},
                    "km": {"$first": "$odometer_km_total"}}},
    ]
    fleet_eh = 0.0
    fleet_km_total = 0.0
    async for row in db.asset_meter_history.aggregate(pipe):
        fleet_eh += float(row.get("eh") or 0)
        fleet_km_total += float(row.get("km") or 0)

    # Km driven this week — sum of (max snapshot in last 7d − min snapshot
    # in last 7d) per asset.
    week_pipe = [
        {"$match": {"org_id": org_id,
                    "snapshot_date": {"$gte": week_ago_iso}}},
        {"$sort": {"snapshot_date": 1}},
        {"$group": {"_id": "$asset_id",
                    "min_km": {"$first": "$odometer_km_total"},
                    "max_km": {"$last": "$odometer_km_total"}}},
    ]
    km_this_week = 0.0
    async for row in db.asset_meter_history.aggregate(week_pipe):
        try:
            km_this_week += max(0.0, float(row.get("max_km") or 0) - float(row.get("min_km") or 0))
        except (TypeError, ValueError):
            continue

    # Assets needing manual reading — no snapshot in the last 30d.
    recent_ids = set()
    async for row in db.asset_meter_history.aggregate([
        {"$match": {"org_id": org_id, "snapshot_date": {"$gte": thirty_ago_iso}}},
        {"$group": {"_id": "$asset_id"}},
    ]):
        recent_ids.add(row.get("_id"))
    all_asset_ids = set()
    async for row in db.assets.find(base, {"id": 1, "_id": 0}):
        all_asset_ids.add(row.get("id"))
    needing_manual = len(all_asset_ids - recent_ids)

    # Line — fleet engine hours per day (30d).
    days, didx = _day_buckets(30)
    for d in days:
        d["eh"] = 0.0
    async for row in db.asset_meter_history.aggregate([
        {"$match": {"org_id": org_id, "snapshot_date": {"$gte": thirty_ago_iso}}},
        {"$group": {"_id": "$snapshot_date",
                    "eh": {"$sum": "$engine_hours_total"}}},
    ]):
        key = row.get("_id")
        d = didx.get(key)
        if d:
            d["eh"] = round(float(row.get("eh") or 0), 1)
    trend = [{"x": d["label"], "y": d["eh"]} for d in days]

    # Top 5 assets by weekly km.
    async def _asset_name(asset_id: str) -> str:
        r = await db.assets.find_one({"id": asset_id, "org_id": org_id},
                                     {"name": 1, "make": 1, "model": 1, "_id": 0})
        if not r:
            return asset_id[:8]
        return r.get("name") or f"{r.get('make', '')} {r.get('model', '')}".strip() or asset_id[:8]

    per_asset_km: Dict[str, float] = {}
    async for row in db.asset_meter_history.aggregate(week_pipe):
        try:
            k = max(0.0, float(row.get("max_km") or 0) - float(row.get("min_km") or 0))
        except (TypeError, ValueError):
            continue
        if k > 0:
            per_asset_km[row.get("_id")] = k
    top5 = sorted(per_asset_km.items(), key=lambda x: -x[1])[:5]
    top5_bar = []
    for asset_id, km in top5:
        name = await _asset_name(asset_id)
        top5_bar.append({"x": str(name)[:14], "y": round(km, 1)})

    # Attention: assets with no reading in >30d.
    attention: list[dict] = []
    async for row in db.assets.find(base, {"id": 1, "name": 1, "make": 1,
                                           "model": 1, "navixy_last_seen_at": 1}):
        aid = row.get("id")
        if aid not in recent_ids:
            name = row.get("name") or f"{row.get('make', '')} {row.get('model', '')}".strip() or aid[:8]
            attention.append({
                "id": aid,
                "label": f"{name} — no meter reading in the last 30 days",
                "timestamp": row.get("navixy_last_seen_at"),
                "severity": "amber",
                "route": f"/app/vehicles?asset={aid}",
            })
            if len(attention) >= 5:
                break

    kpis = [
        {"key": "active", "label": "Active assets", "value": active_assets},
        {"key": "engine_hours", "label": "Fleet engine hours",
         "value": int(fleet_eh), "unit": "h"},
        {"key": "km_week", "label": "Km driven (7d)",
         "value": int(km_this_week), "unit": "km"},
        {"key": "manual_needed", "label": "Assets needing manual reading",
         "value": needing_manual},
    ]
    charts = [
        {"type": "bar", "title": "Fleet engine hours snapshot (30d)", "data": trend},
        {"type": "bar", "title": "Top 5 assets by weekly km", "data": top5_bar},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ===========================================================================
# WORKERS / USERS
# ===========================================================================
_ROLE_LABEL = {
    "admin": "Admin", "hseq_lead": "HSEQ Lead", "manager": "Manager",
    "supervisor": "Supervisor", "worker": "Worker", "auditor": "Auditor",
}


async def _aggregate_workers(org_id: str) -> dict:
    base = {"org_id": org_id, "deleted_at": None}
    now = datetime.now(timezone.utc)
    month_ago_iso = (now - timedelta(days=30)).isoformat()

    total = await db.users.count_documents(base)
    active_month = await db.users.count_documents({
        **base, "last_login_at": {"$gte": month_ago_iso},
    })
    invite_pending = await db.users.count_documents({
        **base, "invite_expires_at": {"$exists": True, "$ne": None},
        "password_hash": {"$in": [None, ""]},
    })
    now_iso = now.isoformat()
    locked = await db.users.count_documents({
        **base, "locked_until": {"$gt": now_iso},
    })
    never_logged_in = await db.users.count_documents({
        **base, "$or": [{"last_login_at": None},
                        {"last_login_at": {"$exists": False}}],
    })

    # Role donut.
    role_counts: Dict[str, int] = {}
    async for row in db.users.aggregate(
        [{"$match": base}, {"$group": {"_id": "$role", "n": {"$sum": 1}}}]
    ):
        role_counts[row.get("_id") or "worker"] = row.get("n", 0)
    donut = [
        {"label": _ROLE_LABEL.get(k, k.title()),
         "value": v,
         "color": _ASSET_TYPE_PALETTE[i % len(_ASSET_TYPE_PALETTE)]}
        for i, (k, v) in enumerate(sorted(role_counts.items(), key=lambda x: -x[1])) if v > 0
    ]

    # 7-day sign-ins bar (from `session_history`).
    days, didx = _day_buckets(7)
    week_start_iso = (now - timedelta(days=7)).isoformat()
    async for row in db.session_history.aggregate([
        {"$match": {"org_id": org_id, "kind": "login",
                    "created_at": {"$gte": week_start_iso}}},
    ]):
        dt = _parse_dt(row.get("created_at"))
        if not dt:
            continue
        d = didx.get(dt.date().isoformat())
        if d:
            d["count"] += 1
    bar = [{"x": d["label"], "y": d["count"]} for d in days]

    # Attention: locked or never-logged-in users.
    attention: list[dict] = []
    async for doc in db.users.find({
        **base, "locked_until": {"$gt": now_iso},
    }, {"id": 1, "email": 1, "name": 1, "locked_until": 1}).limit(3):
        attention.append({
            "id": doc.get("id"),
            "label": f"{doc.get('name') or doc.get('email')} — account locked",
            "timestamp": doc.get("locked_until"),
            "severity": "red",
            "route": "/app/settings/users",
        })
    async for doc in db.users.find({
        **base, "invite_expires_at": {"$exists": True, "$ne": None},
        "password_hash": {"$in": [None, ""]},
    }, {"id": 1, "email": 1, "name": 1, "invite_expires_at": 1}).limit(5):
        if len(attention) >= 5:
            break
        attention.append({
            "id": doc.get("id"),
            "label": f"{doc.get('name') or doc.get('email')} — invite pending",
            "timestamp": doc.get("invite_expires_at"),
            "severity": "amber",
            "route": "/app/settings/users",
        })

    kpis = [
        {"key": "total", "label": "Total users", "value": total},
        {"key": "active_month", "label": "Active this month", "value": active_month,
         **({} if active_month > 0 else {"placeholder": True, "coming_soon": True,
                                         "hint": "last_login_at populates once "
                                                 "users sign in on v134+"})},
        {"key": "invite_pending", "label": "Invite pending", "value": invite_pending},
        {"key": "locked", "label": "Locked", "value": locked},
        {"key": "never_logged_in", "label": "Never logged in", "value": never_logged_in},
    ]
    charts = [
        {"type": "donut", "title": "By role", "data": donut},
        {"type": "bar", "title": "Sign-ins per day (7d)", "data": bar},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ===========================================================================
# CERTIFICATIONS
# ===========================================================================
async def _aggregate_certifications(org_id: str) -> dict:
    base = {"org_id": org_id, "deleted_at": None}
    now = datetime.now(timezone.utc)
    today_iso = now.date().isoformat()
    in_30d = (now + timedelta(days=30)).date().isoformat()

    total = await db.worker_certifications.count_documents(base)
    expiring = await db.worker_certifications.count_documents({
        **base, "expiry_date": {"$gte": today_iso, "$lte": in_30d},
    })
    expired = await db.worker_certifications.count_documents({
        **base, "expiry_date": {"$lt": today_iso, "$ne": None},
    })
    renewals_in_progress = 0  # No explicit renewal state; leave as placeholder.

    # Bar — expirations upcoming per month (6mo out).
    months = []
    idx: Dict[str, dict] = {}
    cursor = now.replace(day=1)
    for _ in range(6):
        months.append({"key": cursor.strftime("%Y-%m"),
                       "label": cursor.strftime("%b"), "count": 0})
        idx[cursor.strftime("%Y-%m")] = months[-1]
        # next month
        y, m = cursor.year, cursor.month
        cursor = cursor.replace(year=y + (m // 12), month=(m % 12) + 1)

    end_iso = cursor.date().isoformat()
    async for doc in db.worker_certifications.find({
        **base,
        "expiry_date": {"$gte": today_iso, "$lt": end_iso},
    }, {"expiry_date": 1, "_id": 0}):
        exp = doc.get("expiry_date")
        if isinstance(exp, str) and len(exp) >= 7:
            m = idx.get(exp[:7])
            if m:
                m["count"] += 1
    trend = [{"x": m["label"], "y": m["count"]} for m in months]

    # Donut by cert name (top 8).
    type_counts: Dict[str, int] = {}
    async for row in db.worker_certifications.aggregate([
        {"$match": base},
        {"$group": {"_id": "$name", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 8},
    ]):
        type_counts[row.get("_id") or "Other"] = row.get("n", 0)
    donut = [
        {"label": (k or "Other")[:20], "value": v,
         "color": _ASSET_TYPE_PALETTE[i % len(_ASSET_TYPE_PALETTE)]}
        for i, (k, v) in enumerate(type_counts.items()) if v > 0
    ]

    # Attention — expired first, then those expiring within 30 days.
    attention: list[dict] = []
    async for doc in db.worker_certifications.find({
        **base, "expiry_date": {"$lt": today_iso, "$ne": None},
    }, {"id": 1, "name": 1, "worker_id": 1, "expiry_date": 1}) \
            .sort("expiry_date", -1).limit(3):
        attention.append({
            "id": doc.get("id"),
            "label": f"{doc.get('name') or 'Certification'} — expired {doc.get('expiry_date')}",
            "timestamp": doc.get("expiry_date"),
            "severity": "red",
            "route": "/app/certifications",
        })
    async for doc in db.worker_certifications.find({
        **base, "expiry_date": {"$gte": today_iso, "$lte": in_30d},
    }, {"id": 1, "name": 1, "worker_id": 1, "expiry_date": 1}) \
            .sort("expiry_date", 1).limit(5):
        if len(attention) >= 5:
            break
        attention.append({
            "id": doc.get("id"),
            "label": f"{doc.get('name') or 'Certification'} — expires {doc.get('expiry_date')}",
            "timestamp": doc.get("expiry_date"),
            "severity": "amber",
            "route": "/app/certifications",
        })

    kpis = [
        {"key": "total", "label": "Total certs", "value": total},
        {"key": "expiring", "label": "Expiring in 30d", "value": expiring},
        {"key": "expired", "label": "Expired", "value": expired},
        {"key": "renewals_in_progress", "label": "Renewals in progress",
         "value": renewals_in_progress, "placeholder": True, "coming_soon": True,
         "hint": "Renewal workflow ships in a future phase."},
    ]
    charts = [
        {"type": "bar",   "title": "Expirations upcoming per month (6mo)", "data": trend},
        {"type": "donut", "title": "By cert type", "data": donut},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ===========================================================================
# AUDIT EXPORTS
# ===========================================================================
async def _aggregate_audit_exports(org_id: str) -> dict:
    base = {"org_id": org_id}
    now = datetime.now(timezone.utc)
    year_start_iso = now.replace(month=1, day=1, hour=0, minute=0, second=0,
                                  microsecond=0).isoformat()

    this_year = await db.audit_exports.count_documents({
        **base, "generated_at": {"$gte": year_start_iso},
    })
    last_doc = await db.audit_exports.find_one(
        base, {"generated_at": 1, "_id": 0}, sort=[("generated_at", -1)])
    last_export = last_doc.get("generated_at") if last_doc else None

    # 12-month bar — packs per month.
    months, idx = _month_buckets(12)
    async for doc in db.audit_exports.find({**base, "generated_at": {"$exists": True}},
                                           {"generated_at": 1, "_id": 0}):
        dt = _parse_dt(doc.get("generated_at"))
        if not dt:
            continue
        m = idx.get(dt.strftime("%Y-%m"))
        if m:
            m["count"] += 1
    trend = [{"x": m["label"], "y": m["count"]} for m in months]

    # Bar — packs by contents type (sum across `include[]`).
    include_counts: Dict[str, int] = {}
    async for doc in db.audit_exports.find(base, {"include": 1, "_id": 0}):
        for k in (doc.get("include") or []):
            include_counts[k] = include_counts.get(k, 0) + 1
    label_map = {"swms": "SWMS", "pre_starts": "Pre-starts",
                 "site_diary": "Site diary", "hazards": "Hazards",
                 "incidents": "Incidents", "inspections": "Inspections",
                 "contractors": "Contractors"}
    include_bar = [
        {"x": label_map.get(k, k.replace("_", " ").title())[:14], "y": v}
        for k, v in sorted(include_counts.items(), key=lambda x: -x[1])
    ]

    # Coverage % — how many of the 7 canonical section-kinds appeared in
    # at least one pack this year.
    coverage_pct = round(len(include_counts) / max(1, len(label_map)) * 100)

    # Sites included — distinct workspace_ids used across generated packs.
    ws_ids = set()
    async for doc in db.audit_exports.find(base, {"workspace_id": 1, "_id": 0}):
        wsid = doc.get("workspace_id")
        if wsid:
            ws_ids.add(wsid)
    total_ws = await db.workspaces.count_documents({"org_id": org_id, "deleted_at": None})
    sites_included = f"{len(ws_ids)} / {total_ws}"

    # Attention — packs older than 90 days without a follow-up.
    ninety_ago_iso = (now - timedelta(days=90)).isoformat()
    attention: list[dict] = []
    if not last_doc or _parse_dt(last_doc.get("generated_at")) and \
            _parse_dt(last_doc.get("generated_at")) < now - timedelta(days=90):
        attention.append({
            "id": "no-recent",
            "label": "No audit pack generated in the last 90 days",
            "timestamp": last_export,
            "severity": "amber",
            "route": "/app/audit-exports",
        })

    kpis = [
        {"key": "year", "label": "Packs this year", "value": this_year},
        {"key": "last_export", "label": "Last export",
         "value": (last_export or "—")[:10] if isinstance(last_export, str) else "—"},
        {"key": "coverage", "label": "Coverage", "value": coverage_pct, "unit": "%"},
        {"key": "sites_included", "label": "Workspaces covered", "value": sites_included},
    ]
    charts = [
        {"type": "bar", "title": "Packs per month (12mo)", "data": trend},
        {"type": "bar", "title": "Packs by contents type", "data": include_bar},
    ]
    return {"kpis": kpis, "charts": charts, "attention": attention}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
Aggregator = Callable[[str], Awaitable[dict]]

AGGREGATORS: Dict[str, Aggregator] = {
    "swms": _aggregate_swms,
    "hazards": _aggregate_hazards,
    "incidents": _aggregate_incidents,
    "inspections": _aggregate_inspections,
    "sites": _aggregate_sites,
    "vehicles": _aggregate_vehicles,
    "workers": _aggregate_workers,
    "certifications": _aggregate_certifications,
    "audit_exports": _aggregate_audit_exports,
}


@router.get("/{module}")
async def module_dashboard(module: str, user: dict = Depends(get_current_user)):
    # Normalise `-` → `_` so `/api/dashboards/audit-exports` and
    # `/api/dashboards/audit_exports` behave identically. Frontend routes
    # tend to prefer hyphens for URL slugs; MongoDB collection names in the
    # aggregator registry use underscores.
    module = (module or "").strip().lower().replace("-", "_")
    if not module:
        raise HTTPException(status_code=400, detail="module required")

    org_id = user["org_id"]
    started = time.monotonic()

    cached = _cache_get(org_id, module)
    if cached is not None:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        log.info("dashboards.query module=%s org=%s ms=%d cache=hit", module, org_id, elapsed_ms)
        return {**cached, "cache_hit": True}

    if module not in AGGREGATORS:
        raise HTTPException(status_code=404, detail=f"Unknown module: {module}")

    aggregator = AGGREGATORS[module]
    result = await aggregator(org_id)
    payload = {
        "module": module,
        "kpis": result.get("kpis", []),
        "charts": result.get("charts", []),
        "attention": result.get("attention", []),
        "todo": False,
        "generated_at": _now_iso(),
    }

    _cache_set(org_id, module, payload)
    elapsed_ms = int((time.monotonic() - started) * 1000)
    log.info("dashboards.query module=%s org=%s ms=%d cache=miss", module, org_id, elapsed_ms)
    return {**payload, "cache_hit": False}
