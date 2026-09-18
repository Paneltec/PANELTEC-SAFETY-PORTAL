"""Mobile data endpoints — v58.13.132db.

Minimal backend surface for the Expo mobile app's mocked screens.
All routes accept the standard bearer JWT via `get_current_user`;
the mobile PIN-login (backend/auth_mobile_pin.py:293) mints tokens
via the same `auth.create_access_token()` helper so no separate
mobile-auth dep is needed.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Any, List, Optional

log = logging.getLogger("paneltec.mobile.data")

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import db

router = APIRouter(tags=["mobile-data"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


# ────────────────────── a) records/mine ──────────────────────

CATEGORY_LABELS = {
    "pre_start":  "Pre-Starts",
    "hazard":     "Hazards",
    "swms":       "SWMS",
    "incident":   "Incidents",
    "inspection": "Inspections",
    "near_miss":  "Near Miss",
    "toolbox":    "Toolbox Talks",
    "general":    "General",
}


@router.get("/mobile/records/mine")
async def records_mine(user: dict = Depends(get_current_user)):
    """Group the caller's recent submissions by template category.

    Joins `form_submissions.submitted_by == user.id` against
    `form_templates.category`. Categories with no submissions are
    omitted. Each group returns at most 50 most-recent items.

    v58.13.132im — Both Mongo cursor drains are wrapped in
    `asyncio.wait_for(..., timeout=6.0)` so a slow index scan can
    never turn into an infinite mobile-home spinner. On timeout we
    return `{groups: []}` with a warning log; the mobile home
    already renders an empty-state card in that case.
    """
    async def _load():
        # Build a template_id → category map (small set — cache-worthy).
        tpl_cat: dict[str, str] = {}
        async for t in db.form_templates.find(
            {"org_id": user["org_id"]}, {"_id": 0, "id": 1, "category": 1}
        ):
            tpl_cat[t.get("id") or ""] = t.get("category") or "general"

        submissions = []
        async for s in db.form_submissions.find(
            {"org_id": user["org_id"], "submitted_by": user["id"],
             "deleted_at": None},
            {"_id": 0, "id": 1, "template_id": 1, "template_name_snapshot": 1,
             "submitted_at": 1, "status": 1},
        ).sort("submitted_at", -1).limit(500):
            submissions.append(s)
        return tpl_cat, submissions

    try:
        tpl_cat, submissions = await asyncio.wait_for(_load(), timeout=6.0)
    except asyncio.TimeoutError:
        log.warning("records/mine hit 6s wait_for — returning empty groups")
        return {"groups": [], "degraded": True}

    groups_map: dict[str, list[dict]] = {}
    for s in submissions:
        cat = tpl_cat.get(s.get("template_id") or "", "general")
        groups_map.setdefault(cat, []).append({
            "id":     s.get("id"),
            "date":   s.get("submitted_at"),
            "status": s.get("status") or "submitted",
            "title":  s.get("template_name_snapshot") or "Form",
        })

    groups = [
        {"category": cat,
         "label":    CATEGORY_LABELS.get(cat, cat.replace("_", " ").title()),
         "count":    len(items),
         "items":    items[:50]}
        for cat, items in sorted(groups_map.items(), key=lambda kv: -len(kv[1]))
    ]
    return {"groups": groups}


# ────────────────────── b) ai/briefing (cached 6h) ──────────────────────

_BRIEFING_CACHE: dict[str, dict] = {}
_BRIEFING_TTL_SEC = 6 * 3600


@router.get("/mobile/ai/briefing")
async def ai_briefing(user: dict = Depends(get_current_user)):
    """2–3 sentence daily briefing for the mobile home screen.

    Cached per-user for 6 h. Falls back to a hand-crafted string if
    Claude is unavailable or the Emergent LLM key is missing.
    """
    now_ts = datetime.now(timezone.utc).timestamp()
    cached = _BRIEFING_CACHE.get(user["id"])
    if cached and (now_ts - cached["ts"]) < _BRIEFING_TTL_SEC:
        return {
            "briefing":     cached["briefing"],
            "severity":     cached["severity"],
            "generated_at": cached["generated_at"],
        }

    # Cheap signal-gather for the LLM prompt.
    open_hazards = await db.form_submissions.count_documents({
        "org_id": user["org_id"], "deleted_at": None,
        "template_name_snapshot": {"$regex": "hazard", "$options": "i"},
        "submitted_at": {"$gte": (datetime.now(timezone.utc)
                                  .replace(hour=0, minute=0, second=0)
                                  .isoformat())},
    })
    role_label = (user.get("role") or user.get("role_id") or "worker").replace("_", " ").title()

    briefing = (
        f"Good morning, {user.get('name', 'team')}. "
        f"You're logged in as {role_label}. "
        f"{open_hazards} hazard report{'s' if open_hazards != 1 else ''} "
        f"submitted today across the org — check the Hazards tab for detail."
    )
    severity = "warn" if open_hazards > 3 else "info"

    # Best-effort LLM upgrade — if `ai._claude_json` is available and
    # the Emergent LLM key is set, upgrade the briefing.
    # v58.13.132il — Hard 8s timeout so a slow/hanging Claude call
    # can never turn into an infinite spinner on the mobile home
    # screen. If the wait_for fires, we keep the fallback string
    # that was already computed above.
    try:
        if os.environ.get("EMERGENT_LLM_KEY"):
            from ai import _claude_json
            prompt = (
                f"You are the WHS assistant for a construction contractor. "
                f"Write a 2-3 sentence morning briefing for a {role_label}. "
                f"Signals: {open_hazards} hazard reports today. "
                f"Return JSON: {{\"briefing\": str, \"severity\": \"info\"|\"warn\"}}."
            )
            resp = await asyncio.wait_for(
                _claude_json(
                    system="You are a concise safety briefing writer.",
                    user_text=prompt,
                ),
                timeout=8.0,
            )
            if isinstance(resp, dict) and resp.get("briefing"):
                briefing = str(resp["briefing"])[:600]
                severity = resp.get("severity", severity)
    except asyncio.TimeoutError:
        log.warning("mobile briefing LLM upgrade timed out — using fallback")
    except Exception as _e:
        log.warning("mobile briefing LLM upgrade failed: %s", _e)

    payload = {"briefing": briefing, "severity": severity,
               "generated_at": _now_iso()}
    _BRIEFING_CACHE[user["id"]] = {**payload, "ts": now_ts}
    return payload


# ────────────────────── c) prestart/submit ──────────────────────


class SignOnRow(BaseModel):
    name: str
    role: Optional[str] = None
    signed_at: Optional[str] = None


class PreStartSubmitIn(BaseModel):
    vehicle_rego: Optional[str] = None
    date:         Optional[str] = None
    crew_lead:    Optional[str] = None
    crew_members: List[str] = []
    work_summary: Optional[str] = None
    hazards:      Optional[str] = None
    sign_ons:     List[SignOnRow] = []


@router.post("/mobile/prestart/submit", status_code=201)
async def prestart_submit(
    body: PreStartSubmitIn,
    user: dict = Depends(get_current_user),
):
    """Write a lightweight pre-start submission. Uses a synthetic
    template_id so it groups under `pre_start` in `/records/mine`
    even without a live template row."""
    submission_id = _new_id()
    now = _now_iso()

    # Look up (or accept the absence of) a real pre-start template.
    tpl = await db.form_templates.find_one(
        {"org_id": user["org_id"], "category": "pre_start",
         "deleted_at": None},
        {"_id": 0, "id": 1, "name": 1},
    )
    tpl_id = (tpl or {}).get("id") or "mobile-prestart"
    tpl_name = (tpl or {}).get("name") or "Daily Pre-Start (mobile)"

    doc = {
        "id":                     submission_id,
        "org_id":                 user["org_id"],
        "template_id":            tpl_id,
        "template_name_snapshot": tpl_name,
        "category":               "pre_start",
        "fields":                 body.model_dump(),
        "submitted_by":           user["id"],
        "submitted_by_name":      user.get("name"),
        "submitted_at":           now,
        "status":                 "submitted",
        "source":                 "mobile",
        "deleted_at":             None,
    }
    await db.form_submissions.insert_one(doc)
    return {"submission_id": submission_id, "status": "submitted"}


# ────────────────────── d) sites/{id}/sign-on + sign-off ──────────────────────


class GeoIn(BaseModel):
    lat:       float
    lng:       float
    timestamp: Optional[str] = None


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371000.0
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lng2 - lng1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * R * asin(sqrt(a))


async def _resolve_site(site_id: str, org_id: str) -> dict:
    site = await db.sites.find_one(
        {"id": site_id, "org_id": org_id, "deleted_at": None},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "site_not_found")
    return site


@router.post("/mobile/sites/{site_id}/sign-on", status_code=201)
async def mobile_site_sign_on(
    site_id: str,
    body:    GeoIn,
    user:    dict = Depends(get_current_user),
):
    site = await _resolve_site(site_id, user["org_id"])
    warn = None
    if site.get("latitude") is not None and site.get("longitude") is not None:
        d = _haversine_m(body.lat, body.lng, float(site["latitude"]),
                         float(site["longitude"]))
        if d > 250.0:
            warn = f"gps_offsite_{int(d)}m"

    now = _now_iso()
    doc = {
        "id":            _new_id(),
        "org_id":        user["org_id"],
        "site_id":       site_id,
        "user_id":       user["id"],
        "user_name":     user.get("name"),
        "signed_on_at":  now,
        "signed_off_at": None,
        "signon_lat":    body.lat,
        "signon_lng":    body.lng,
        "warn":          warn,
        "source":        "mobile",
        "deleted_at":    None,
    }
    await db.site_attendance.insert_one(doc)
    return {"attendance_id": doc["id"], "signed_on_at": now, "warn": warn}


@router.post("/mobile/sites/{site_id}/sign-off")
async def mobile_site_sign_off(
    site_id: str,
    body:    GeoIn,
    user:    dict = Depends(get_current_user),
):
    now = _now_iso()
    r = await db.site_attendance.find_one_and_update(
        {"org_id": user["org_id"], "site_id": site_id,
         "user_id": user["id"], "signed_off_at": None,
         "deleted_at": None},
        {"$set": {"signed_off_at": now, "signoff_lat": body.lat,
                  "signoff_lng": body.lng}},
        sort=[("signed_on_at", -1)],
        return_document=True,
    )
    if not r:
        raise HTTPException(404, "no_open_signon_for_this_site")
    return {"attendance_id": r.get("id"), "signed_off_at": now}


# ────────────────────── e) ai/ask ──────────────────────


class AskIn(BaseModel):
    prompt: str


@router.post("/mobile/ai/ask")
async def ai_ask(body: AskIn, user: dict = Depends(get_current_user)):
    """Role-scoped LLM chat. Best-effort — falls back to a stub answer
    if the LLM path is unavailable."""
    if not body.prompt.strip():
        raise HTTPException(400, "prompt required")
    role_label = (user.get("role") or user.get("role_id") or "worker").replace("_", " ")

    try:
        if os.environ.get("EMERGENT_LLM_KEY"):
            from ai import _claude_json
            resp = await _claude_json(
                system=(f"You are the WHS assistant for Paneltec Civil. "
                        f"The user's role is: {role_label}. Answer plainly, "
                        f"cite relevant policy or SWMS names when applicable. "
                        f"Return JSON: {{\"answer\": str}}."),
                user_text=body.prompt,
            )
            if isinstance(resp, dict) and resp.get("answer"):
                return {"answer": str(resp["answer"]), "sources": []}
    except Exception:
        pass

    return {
        "answer": ("I couldn't reach the assistant right now — please "
                   "check the User Manual or ask your supervisor. "
                   f"(prompt received: {body.prompt[:80]!r})"),
        "sources": [],
    }
