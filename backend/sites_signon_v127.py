"""Phase 4.12 (paneltec-v127) — Sites + QR sign-on additions.

Sits alongside the earlier `sites_qr.py` (which already provides the public
scan resolver, sign-on POST, scan PDF and active-signons list). This module
adds the v127 surface area:

  · POST   /api/sites                          — admin, manual site only
  · PATCH  /api/sites/{id}                     — admin, edits signon_questions
                                                 + gps_override + manual fields
  · POST   /api/sites/bulk-delete              — admin, soft-delete
  · POST   /api/sites/{id}/restore             — admin, restore
  · GET    /api/sites/recycle-bin              — admin, soft-deleted list
  · POST   /api/sites/{id}/signoff             — sign off a specific signon
  · POST   /api/me/signoff-active              — sign off caller's active signon
  · GET    /api/sites/{id}/signon-log          — admin, time-range log
  · POST   /api/sites/{id}/signon-log/export   — admin, PDF or CSV

Schema additions on `simpro_sites` rows (lazy — written on first edit):
  · kind: "simpro" | "manual"
  · manual_address / manual_gps_lat / manual_gps_long  (manual only)
  · gps_override_lat / gps_override_long              (admin override, any kind)
  · signon_questions: [{ id, type, label, required, choices? }]
  · deleted_at / deleted_by / restore_until           (soft-delete pattern)

Distance check: haversine on the provided GPS vs the site's effective GPS
(override → manual → simpro). > 250m → `gps_warning: true` + distance stored.
Warn-only; never blocks.
"""
from __future__ import annotations

import csv
import io
import math
from datetime import datetime, timezone, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as _canvas

from auth import get_current_user
from db import db
from models import new_id, now_iso
from pdf_brand import ORANGE, SLATE, SLATE_INK, SLATE_MUTED, PAPER

router = APIRouter(prefix="/sites", tags=["sites-v127"])
me_router = APIRouter(prefix="/me", tags=["sites-v127"])

EDIT_ROLES = {"admin", "manager", "hseq_lead"}
GPS_WARN_METERS = 250.0          # warn-only, never blocks
SOFT_DELETE_DAYS = 30


def _require_admin(user: dict) -> None:
    if user.get("role") not in EDIT_ROLES:
        raise HTTPException(403, "Permission denied: sites.manage")


def _effective_gps(site: dict) -> tuple[float | None, float | None]:
    """Return the GPS to use for distance checks. Order:
    gps_override → manual_* (manual sites) → simpro latitude/longitude."""
    if site.get("gps_override_lat") is not None and site.get("gps_override_long") is not None:
        return float(site["gps_override_lat"]), float(site["gps_override_long"])
    if site.get("kind") == "manual":
        if site.get("manual_gps_lat") is not None and site.get("manual_gps_long") is not None:
            return float(site["manual_gps_lat"]), float(site["manual_gps_long"])
    if site.get("latitude") is not None and site.get("longitude") is not None:
        return float(site["latitude"]), float(site["longitude"])
    return None, None


def _haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    """Great-circle distance in metres."""
    r = 6_371_000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# ─────────────────── Create / Edit ───────────────────

class ManualSiteIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    gps_lat: float | None = None
    gps_long: float | None = None


class SignOnQuestion(BaseModel):
    id: str | None = None
    type: Literal["yesno", "text", "choice"]
    label: str = Field(min_length=1, max_length=200)
    required: bool = False
    choices: list[str] | None = None


class SitePatchIn(BaseModel):
    name: str | None = None
    manual_address: str | None = None
    manual_gps_lat: float | None = None
    manual_gps_long: float | None = None
    gps_override_lat: float | None = None
    gps_override_long: float | None = None
    signon_questions: list[SignOnQuestion] | None = None


@router.post("")
async def create_manual_site(body: ManualSiteIn,
                              user: dict = Depends(get_current_user)):
    _require_admin(user)
    doc = {
        "id": new_id(),
        "simpro_site_id": new_id(),     # reuse the same key the existing UI looks up
        "org_id": user["org_id"],
        "kind": "manual",
        "name": body.name,
        "manual_address": body.address,
        "address": body.address,         # mirror so existing list code Just Works
        "address_full": body.address,
        "suburb": body.suburb,
        "state": body.state,
        "postcode": body.postcode,
        "manual_gps_lat": body.gps_lat,
        "manual_gps_long": body.gps_long,
        "latitude": body.gps_lat,
        "longitude": body.gps_long,
        "signon_questions": [],
        "created_at": now_iso(),
        "created_by": user["id"],
        "deleted_at": None,
    }
    await db.simpro_sites.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.patch("/{site_id}")
async def patch_site(site_id: str, body: SitePatchIn,
                      user: dict = Depends(get_current_user)):
    _require_admin(user)
    site = await db.simpro_sites.find_one(
        {"simpro_site_id": site_id, "org_id": user["org_id"]},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Site not found")

    is_simpro = site.get("kind", "simpro") == "simpro"
    update: dict[str, Any] = {}

    # Simpro sites — only signon_questions + gps_override_* are editable.
    if body.signon_questions is not None:
        normalised: list[dict] = []
        for q in body.signon_questions:
            qd = q.model_dump()
            qd["id"] = qd.get("id") or new_id()
            if qd["type"] != "choice":
                qd["choices"] = None
            normalised.append(qd)
        update["signon_questions"] = normalised
    if body.gps_override_lat is not None:
        update["gps_override_lat"] = float(body.gps_override_lat)
    if body.gps_override_long is not None:
        update["gps_override_long"] = float(body.gps_override_long)

    # Manual sites — additionally allow name + manual_* fields.
    if not is_simpro:
        if body.name is not None:
            update["name"] = body.name
        if body.manual_address is not None:
            update["manual_address"] = body.manual_address
            update["address"] = body.manual_address
            update["address_full"] = body.manual_address
        if body.manual_gps_lat is not None:
            update["manual_gps_lat"] = float(body.manual_gps_lat)
            update["latitude"] = float(body.manual_gps_lat)
        if body.manual_gps_long is not None:
            update["manual_gps_long"] = float(body.manual_gps_long)
            update["longitude"] = float(body.manual_gps_long)

    if not update:
        return {"ok": True, "no_changes": True}
    update["updated_at"] = now_iso()
    await db.simpro_sites.update_one(
        {"simpro_site_id": site_id, "org_id": user["org_id"]},
        {"$set": update},
    )
    return {"ok": True, "updated_fields": sorted(update.keys())}


# ─────────────────── Soft delete + Recycle Bin ───────────────────

class BulkDeleteIn(BaseModel):
    site_ids: list[str]


@router.post("/bulk-delete")
async def bulk_delete_sites(body: BulkDeleteIn,
                             user: dict = Depends(get_current_user)):
    _require_admin(user)
    if not body.site_ids:
        return {"deleted": 0, "refused": []}
    now = now_iso()
    restore_until = (datetime.now(timezone.utc)
                     + timedelta(days=SOFT_DELETE_DAYS)).isoformat()
    refused: list[dict] = []
    deleted = 0
    for sid in body.site_ids:
        site = await db.simpro_sites.find_one(
            {"simpro_site_id": sid, "org_id": user["org_id"], "deleted_at": None},
            {"_id": 0},
        )
        if not site:
            refused.append({"id": sid, "reason": "not_found"})
            continue
        # Simpro-synced + linked to active jobs → refuse.
        if site.get("kind", "simpro") == "simpro" and site.get("simpro_active_jobs", 0) > 0:
            refused.append({"id": sid, "reason": "linked_to_active_simpro_jobs"})
            continue
        await db.simpro_sites.update_one(
            {"simpro_site_id": sid, "org_id": user["org_id"]},
            {"$set": {"deleted_at": now, "deleted_by": user["id"],
                      "restore_until": restore_until}},
        )
        deleted += 1
    return {"deleted": deleted, "refused": refused}


@router.post("/{site_id}/restore")
async def restore_site(site_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    r = await db.simpro_sites.update_one(
        {"simpro_site_id": site_id, "org_id": user["org_id"],
         "deleted_at": {"$ne": None}},
        {"$set": {"deleted_at": None, "deleted_by": None,
                  "restore_until": None, "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Site not in recycle bin")
    return {"ok": True}


@router.get("/recycle-bin")
async def list_recycle_bin(user: dict = Depends(get_current_user)):
    _require_admin(user)
    rows: list[dict] = []
    now = datetime.now(timezone.utc)
    async for s in db.simpro_sites.find(
        {"org_id": user["org_id"], "deleted_at": {"$ne": None}},
        {"_id": 0, "simpro_site_id": 1, "name": 1, "address_full": 1, "kind": 1,
         "deleted_at": 1, "restore_until": 1},
    ).sort("deleted_at", -1):
        days_left = None
        if s.get("restore_until"):
            try:
                ru = datetime.fromisoformat(s["restore_until"].replace("Z", "+00:00"))
                days_left = max(0, (ru - now).days)
            except ValueError:
                pass
        rows.append({**s, "days_left": days_left})
    return rows


# ─────────────────── Sign-on (with GPS + answers) ───────────────────

class SignOnAnswerIn(BaseModel):
    question_id: str
    value: Any                  # bool | str — type matches the question's type


class SignOnIn(BaseModel):
    name: str | None = None     # visitors must supply; workers default to JWT
    company: str | None = None
    phone: str | None = None
    gps_lat: float | None = None
    gps_long: float | None = None
    gps_accuracy_m: float | None = None
    answers: list[SignOnAnswerIn] = []


@router.post("/{site_id}/signon-v127")
async def signon_v127(site_id: str, body: SignOnIn,
                       user: dict = Depends(get_current_user)):
    """Authenticated sign-on with GPS + dynamic-question answers. The public
    /scan/site/{token}/sign-on path (in sites_qr.py) handles visitor flow."""
    site = await db.simpro_sites.find_one(
        {"simpro_site_id": site_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not site:
        raise HTTPException(404, "Site not found")

    gps_warning = False
    distance_m: float | None = None
    gps_unavailable = body.gps_lat is None or body.gps_long is None
    if not gps_unavailable:
        s_lat, s_lng = _effective_gps(site)
        if s_lat is not None and s_lng is not None:
            distance_m = round(_haversine_m(s_lat, s_lng,
                                            body.gps_lat, body.gps_long), 1)
            gps_warning = distance_m > GPS_WARN_METERS

    doc = {
        "id": new_id(),
        "org_id": site["org_id"],
        "site_id": site_id,
        "site_name": site.get("name"),
        "worker_id": user.get("worker_id") or user["id"],
        "signed_by_user_id": user["id"],
        "name": body.name or user.get("display_name") or user.get("email"),
        "company": body.company,
        "phone": body.phone,
        "signed_at": now_iso(),
        "signoff_at": None,
        "source": "qr_v127",
        "gps_lat": body.gps_lat,
        "gps_long": body.gps_long,
        "gps_accuracy_m": body.gps_accuracy_m,
        "gps_unavailable": gps_unavailable,
        "gps_distance_m": distance_m,
        "gps_warning": gps_warning,
        "answers": [a.model_dump() for a in body.answers],
    }
    await db.site_signons.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.post("/{site_id}/signoff")
async def signoff(site_id: str, signon_id: str,
                   user: dict = Depends(get_current_user)):
    r = await db.site_signons.update_one(
        {"id": signon_id, "site_id": site_id, "org_id": user["org_id"],
         "signoff_at": None},
        {"$set": {"signoff_at": now_iso(),
                  "signoff_by_user_id": user["id"]}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "No active sign-on for that id")
    return {"ok": True, "signoff_at": now_iso()}


@me_router.post("/signoff-active")
async def signoff_active(user: dict = Depends(get_current_user)):
    """Mobile / app convenience — signs off the caller's most-recent active
    sign-on across all sites. Returns {ok, signon_id} or 404 if nothing
    active."""
    sub = await db.site_signons.find_one(
        {"org_id": user["org_id"], "signed_by_user_id": user["id"],
         "signoff_at": None},
        {"_id": 0, "id": 1, "site_id": 1},
        sort=[("signed_at", -1)],
    )
    if not sub:
        raise HTTPException(404, "No active sign-on")
    await db.site_signons.update_one(
        {"id": sub["id"]},
        {"$set": {"signoff_at": now_iso(),
                  "signoff_by_user_id": user["id"]}},
    )
    return {"ok": True, "signon_id": sub["id"], "site_id": sub["site_id"]}


# ─────────────────── Sign-on log + export ───────────────────

@router.get("/{site_id}/signon-log")
async def signon_log(site_id: str,
                      from_: str | None = Query(None, alias="from"),
                      to: str | None = None,
                      user: dict = Depends(get_current_user)):
    _require_admin(user)
    q: dict[str, Any] = {"org_id": user["org_id"], "site_id": site_id}
    if from_ or to:
        rng: dict[str, str] = {}
        if from_: rng["$gte"] = from_
        if to: rng["$lte"] = to
        q["signed_at"] = rng
    rows: list[dict] = []
    async for s in db.site_signons.find(q, {"_id": 0}).sort("signed_at", -1).limit(2000):
        rows.append(s)
    return rows


def _csv_log(rows: list[dict]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Signed at", "Signed off at", "Name", "Company", "Phone",
                "GPS lat", "GPS long", "Distance (m)", "GPS warning",
                "GPS unavailable", "Answers"])
    for r in rows:
        ans = "; ".join(f"{a.get('question_id')}={a.get('value')}"
                        for a in (r.get("answers") or []))
        w.writerow([r.get("signed_at"), r.get("signoff_at") or "",
                    r.get("name") or "", r.get("company") or "",
                    r.get("phone") or "", r.get("gps_lat"), r.get("gps_long"),
                    r.get("gps_distance_m"),
                    "yes" if r.get("gps_warning") else "",
                    "yes" if r.get("gps_unavailable") else "",
                    ans])
    return buf.getvalue().encode("utf-8")


def _pdf_log(site_name: str, rows: list[dict]) -> bytes:
    buf = io.BytesIO()
    c = _canvas.Canvas(buf, pagesize=A4)
    # Brand header band
    c.setFillColor(SLATE)
    c.rect(0, A4[1] - 18 * mm, A4[0], 18 * mm, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(18 * mm, A4[1] - 11 * mm, "Paneltec Civil")
    c.setFillColor(PAPER)
    c.setFont("Helvetica", 9)
    c.drawString(18 * mm, A4[1] - 15 * mm,
                 f"Sign-on log · {site_name or 'Site'}")
    # Body header
    y = A4[1] - 28 * mm
    c.setFillColor(SLATE_INK)
    c.setFont("Helvetica-Bold", 9)
    for x, lbl in [(18, "Signed at"), (52, "Name"), (95, "Company"),
                   (130, "GPS dist"), (155, "Warn")]:
        c.drawString(x * mm, y, lbl)
    y -= 5 * mm
    c.setFont("Helvetica", 8)
    c.setFillColor(SLATE_MUTED)
    for r in rows:
        if y < 20 * mm:
            c.showPage()
            y = A4[1] - 28 * mm
        c.drawString(18 * mm, y, str(r.get("signed_at", ""))[:19])
        c.drawString(52 * mm, y, (r.get("name") or "")[:22])
        c.drawString(95 * mm, y, (r.get("company") or "")[:22])
        d = r.get("gps_distance_m")
        c.drawString(130 * mm, y, f"{d:.0f} m" if d is not None else "—")
        c.drawString(155 * mm, y, "⚠" if r.get("gps_warning") else "")
        y -= 4.5 * mm
    c.save()
    return buf.getvalue()


@router.post("/{site_id}/signon-log/export")
async def signon_log_export(site_id: str,
                              format: Literal["pdf", "csv"] = Query("pdf"),
                              from_: str | None = Query(None, alias="from"),
                              to: str | None = None,
                              user: dict = Depends(get_current_user)):
    _require_admin(user)
    site = await db.simpro_sites.find_one(
        {"simpro_site_id": site_id, "org_id": user["org_id"]},
        {"_id": 0, "name": 1},
    )
    if not site:
        raise HTTPException(404, "Site not found")
    rows = await signon_log(site_id, from_=from_, to=to, user=user)
    if format == "csv":
        return Response(content=_csv_log(rows),
                        media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition":
                                 f'attachment; filename="signon-log-{site_id}.csv"'})
    pdf = _pdf_log(site.get("name") or site_id, rows)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition":
                             f'attachment; filename="signon-log-{site_id}.pdf"'})
