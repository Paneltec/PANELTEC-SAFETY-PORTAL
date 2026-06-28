"""Phase 3.7 — Live picker endpoints for form fields.

Replaces the legacy plain `text` / empty `select` dropdowns seeded on Phase 1
templates ("Worker Full Name", "Job Site / Location", etc.) with dynamic data
sourced from:
  • `workers` collection  → worker_picker
  • `simpro_jobs` collection → job_picker (and derived site / customer
    fallbacks when the dedicated cache is empty)
  • `integration_configs.customers_cache` (Simpro vendors/customers sync) →
    customer_picker
  • `integration_configs.suppliers_cache` (alias for SitePicker fallback when
    Simpro sites cache isn't yet wired)

All endpoints are server-cached 60s per (org, endpoint, q, filters) tuple.
"""
from __future__ import annotations
import time
import math
import unicodedata
from typing import Optional

from fastapi import APIRouter, Depends, Query

from auth import get_current_user
from db import db

router = APIRouter(prefix="/forms/pickers", tags=["form-pickers"])

_CACHE: dict[tuple, dict] = {}
_TTL = 60.0


def _cache_get(key):
    row = _CACHE.get(key)
    if row and (time.time() - row["ts"]) < _TTL:
        return row["payload"]
    return None


def _cache_set(key, payload):
    _CACHE[key] = {"payload": payload, "ts": time.time()}


def cache_bust_org(org_id, prefix=None):
    """Invalidate picker cache entries for an org (optionally limited to a
    `prefix` such as 'jobs' or 'sites'). Called by Simpro sync endpoints."""
    dead = [k for k in _CACHE
            if isinstance(k, tuple) and len(k) > 1 and k[1] == org_id
            and (prefix is None or k[0] == prefix)]
    for k in dead:
        _CACHE.pop(k, None)


def _norm(s) -> str:
    if s is None:
        return ""
    return unicodedata.normalize("NFKD", str(s).lower()).strip()


_HTML_RX = __import__("re").compile(r"<[^>]+>")


def _strip_html(s) -> str:
    if not s:
        return ""
    text = _HTML_RX.sub(" ", str(s))
    # Collapse whitespace and strip.
    return " ".join(text.split())[:160]


_AUTO_SYNC_TTL = 600.0  # 10 minutes per org
_AUTO_SYNC_LOCK: dict[str, float] = {}


def _haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _maybe_auto_sync_workers(org_id, user):
    n = await db.workers.count_documents({"org_id": org_id, "deleted_at": None})
    if n > 0:
        return None
    last = _AUTO_SYNC_LOCK.get(org_id, 0)
    if (time.time() - last) < _AUTO_SYNC_TTL:
        return None
    _AUTO_SYNC_LOCK[org_id] = time.time()
    try:
        from workers import sync_from_simpro, SyncRequest
        await sync_from_simpro(SyncRequest(company="both"), user=user)
        from models import now_iso as _now
        return _now()
    except Exception:
        return None


async def _maybe_auto_sync_jobs(org_id, user):
    n = await db.simpro_jobs.count_documents({"org_id": org_id})
    if n > 0:
        return None
    key = f"jobs:{org_id}"
    last = _AUTO_SYNC_LOCK.get(key, 0)
    if (time.time() - last) < _AUTO_SYNC_TTL:
        return None
    _AUTO_SYNC_LOCK[key] = time.time()
    try:
        from integrations_simpro import simpro_sync_jobs
        await simpro_sync_jobs(user=user)
        from models import now_iso as _now
        return _now()
    except Exception:
        return None


async def _maybe_auto_sync_sites(org_id, user):
    n = await db.simpro_sites.count_documents({"org_id": org_id})
    if n > 0:
        return None
    key = f"sites:{org_id}"
    last = _AUTO_SYNC_LOCK.get(key, 0)
    if (time.time() - last) < _AUTO_SYNC_TTL:
        return None
    _AUTO_SYNC_LOCK[key] = time.time()
    try:
        from integrations_simpro import simpro_sync_sites
        await simpro_sync_sites(user=user)
        from models import now_iso as _now
        return _now()
    except Exception:
        return None


def _worker_display_name(w: dict) -> str:
    n = (w.get("name") or "").strip()
    if n:
        return n
    parts = [w.get("first_name") or "", w.get("last_name") or ""]
    return " ".join(p for p in parts if p).strip() or "—"


# ─────────────── Workers ───────────────

@router.get("/workers")
async def workers(q: Optional[str] = None, limit: int = Query(200, ge=1, le=500),
                  user: dict = Depends(get_current_user)):
    key = ("workers", user["org_id"], _norm(q), limit)
    cached = _cache_get(key)
    if cached:
        return cached
    cur = db.workers.find(
        {"org_id": user["org_id"], "deleted_at": None, "active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "first_name": 1, "last_name": 1,
         "position": 1, "phone": 1, "mobile": 1, "email": 1},
    )
    rows = []
    qn = _norm(q)
    async for w in cur:
        name = _worker_display_name(w)
        trade = (w.get("position") or "").strip() or None
        if qn:
            hay = f"{_norm(name)} {_norm(trade)} {_norm(w.get('email'))}"
            if qn not in hay:
                continue
        rows.append({
            "id": w.get("id"), "name": name, "trade": trade,
            "phone": w.get("mobile") or w.get("phone"),
            "email": w.get("email"), "active": True,
        })
    rows.sort(key=lambda r: (r["name"] or "").lower())
    payload = {"workers": rows[:limit], "count": len(rows)}
    _cache_set(key, payload)
    return payload


# ─────────────── Jobs ───────────────

@router.get("/jobs")
async def jobs(q: Optional[str] = None, status: str = "open",
               customer_id: Optional[str] = None, site_id: Optional[str] = None,
               limit: int = Query(200, ge=1, le=500),
               user: dict = Depends(get_current_user)):
    auto_synced_at = await _maybe_auto_sync_jobs(user["org_id"], user)
    key = ("jobs", user["org_id"], _norm(q), status,
           customer_id or "", site_id or "", limit)
    cached = _cache_get(key)
    if cached:
        return cached
    flt: dict = {"org_id": user["org_id"]}
    if status == "open":
        flt["status_bucket"] = {"$ne": "completed"}
    if customer_id:
        flt["customer_name"] = customer_id
    if site_id:
        flt["site_name"] = site_id
    cur = db.simpro_jobs.find(flt, {
        "_id": 0, "id": 1, "simpro_job_id": 1, "name": 1, "site_name": 1,
        "customer_name": 1, "stage": 1, "status_bucket": 1,
    })
    rows = []
    qn = _norm(q)
    async for j in cur:
        display_name = _strip_html(j.get("name")) or f"Job #{j.get('simpro_job_id')}"
        if qn:
            hay = f"{_norm(display_name)} {_norm(j.get('site_name'))} {_norm(j.get('customer_name'))} {_norm(j.get('simpro_job_id'))}"
            if qn not in hay:
                continue
        rows.append({
            "id": j.get("id"), "simpro_job_id": j.get("simpro_job_id"),
            "name": display_name,
            "site_id": j.get("site_name"), "site_name": j.get("site_name"),
            "customer_id": j.get("customer_name"), "customer_name": j.get("customer_name"),
            "stage": j.get("stage"),
        })
    rows.sort(key=lambda r: (r["name"] or "").lower())
    payload = {"jobs": rows[:limit], "count": len(rows),
               "auto_synced_at": auto_synced_at}
    _cache_set(key, payload)
    return payload


# ─────────────── Sites ───────────────

@router.get("/sites")
async def sites(q: Optional[str] = None, customer_id: Optional[str] = None,
                lat: Optional[float] = None, lng: Optional[float] = None,
                limit: int = Query(200, ge=1, le=500),
                user: dict = Depends(get_current_user)):
    """Sites — prefer the `simpro_sites` collection (real Simpro data with
    coords). Fall back to deriving from `simpro_jobs.site_name` only when the
    collection is empty for this org."""
    auto_synced_at = await _maybe_auto_sync_sites(user["org_id"], user)
    key = ("sites", user["org_id"], _norm(q), customer_id or "",
           round(lat or 0, 3), round(lng or 0, 3), limit)
    cached = _cache_get(key)
    if cached:
        return cached
    qn = _norm(q)
    rows: list[dict] = []
    sites_count = await db.simpro_sites.count_documents({"org_id": user["org_id"]})
    if sites_count > 0:
        flt: dict = {"org_id": user["org_id"]}
        if customer_id:
            cust_doc = await db.integration_configs.find_one(
                {"org_id": user["org_id"], "kind": "simpro"},
                {"_id": 0, "customers_cache": 1},
            )
            cust_ids = [str(c.get("simpro_customer_id"))
                        for c in (cust_doc or {}).get("customers_cache") or []
                        if (c.get("name") or "").strip().lower() == customer_id.lower()]
            if cust_ids:
                flt["simpro_customer_id"] = {"$in": cust_ids}
        async for s in db.simpro_sites.find(flt, {"_id": 0}):
            name = s.get("name") or "(unnamed)"
            hay = f"{_norm(name)} {_norm(s.get('address_full'))} {_norm(s.get('suburb'))}"
            if qn and qn not in hay:
                continue
            row = {
                "id": s.get("simpro_site_id"),
                "simpro_site_id": s.get("simpro_site_id"),
                "name": name,
                "address": s.get("address_full") or s.get("address"),
                "customer_id": s.get("simpro_customer_id"),
                "lat": s.get("latitude"), "lng": s.get("longitude"),
            }
            if (lat is not None and lng is not None
                    and row["lat"] is not None and row["lng"] is not None):
                row["distance_km"] = round(_haversine_km(lat, lng, row["lat"], row["lng"]), 1)
            rows.append(row)
        rows.sort(key=lambda r: (
            0 if r.get("distance_km") is not None else 1,
            r.get("distance_km") if r.get("distance_km") is not None else 0,
            (r.get("name") or "").lower(),
        ))
    else:
        match: dict = {"org_id": user["org_id"], "site_name": {"$nin": [None, ""]}}
        if customer_id:
            match["customer_name"] = customer_id
        cur = db.simpro_jobs.aggregate([
            {"$match": match},
            {"$group": {"_id": "$site_name",
                        "customer_name": {"$first": "$customer_name"},
                        "n": {"$sum": 1}}},
            {"$sort": {"_id": 1}},
            {"$limit": 500},
        ])
        async for r in cur:
            sname = r.get("_id")
            if not sname:
                continue
            if qn and qn not in (_norm(sname) + " " + _norm(r.get("customer_name"))):
                continue
            rows.append({
                "id": sname, "simpro_site_id": sname, "name": sname,
                "address": None, "customer_id": r.get("customer_name"),
                "customer_name": r.get("customer_name"), "jobs": r.get("n", 0),
            })
    payload = {"sites": rows[:limit], "count": len(rows),
               "source": "simpro_sites" if sites_count > 0 else "simpro_jobs_fallback",
               "sorted_by_distance": (lat is not None and lng is not None),
               "auto_synced_at": auto_synced_at}
    _cache_set(key, payload)
    return payload


# ─────────────── Customers ───────────────

@router.get("/customers")
async def customers(q: Optional[str] = None,
                    limit: int = Query(200, ge=1, le=500),
                    user: dict = Depends(get_current_user)):
    """Backed by `integration_configs.customers_cache` (Simpro vendor sync). On
    cold cache, returns an empty list with `count=0`."""
    key = ("customers", user["org_id"], _norm(q), limit)
    cached = _cache_get(key)
    if cached:
        return cached
    cfg_doc = await db.integration_configs.find_one(
        {"org_id": user["org_id"], "kind": "simpro"},
        {"_id": 0, "customers_cache": 1, "customers_cached_at": 1, "status": 1},
    )
    raw = (cfg_doc or {}).get("customers_cache") or []
    qn = _norm(q)
    rows = []
    for c in raw:
        if not isinstance(c, dict):
            continue
        name = (c.get("name") or "").strip()
        if not name:
            continue
        if not c.get("active", True):
            continue
        cid = str(c.get("simpro_customer_id") or "")
        if not cid:
            continue
        if qn and qn not in _norm(name):
            continue
        rows.append({
            "id": name,  # picker stores name (keeps job/site filtering simple)
            "simpro_customer_id": cid,
            "simpro_company_id": c.get("simpro_company_id"),
            "company_label": c.get("company_label"),
            "name": name,
        })
    rows.sort(key=lambda r: (r["name"] or "").lower())
    payload = {
        "customers": rows[:limit],
        "count": len(rows),
        "connected": bool(cfg_doc and cfg_doc.get("status") == "connected"),
        "cached_at": (cfg_doc or {}).get("customers_cached_at"),
    }
    _cache_set(key, payload)
    return payload
