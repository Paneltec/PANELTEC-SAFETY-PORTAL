"""v58.13.106 — Public visitor sign-in flow.

Public + admin endpoints for the site-QR visitor form. Adheres to the
archived brief at /app/memory/v58_13_106_visitor_form_brief.md
(authoritative — collection name `site_visitors`, field names per
brief, token-based public flow).

Deviations from today's fresh spec (flagged in ship summary):
  · Collection: `site_visitors` (brief), NOT `visitor_signins`.
  · Public URL family: `/api/public/site/{token}/…` (brief token-based),
    NOT `/api/public/visitor/site/{site_id}` (fresh spec siteId-based).
  · Field names: `visiting_person`, `induction_acknowledged`,
    `source_ip`, `source_user_agent`, `gps_lat/gps_lng` per brief.
  · Rate limit: brief said 10/hour per IP. Applied on POST signin.

Admin endpoints kept from today's spec (additive, not contradictory
to brief). Route family: `/api/admin/visitors[…]`. Force sign-out
supported. `@safe_admin_endpoint` on list/get to prevent CF 520s.

NO automated notifications. Comms Safe Mode respected (no emails/SMS
scheduled from this module).
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Depends, Query, Body
from pydantic import BaseModel, Field

from db import db
from admin_safe_wrapper import safe_admin_endpoint
from rate_limit import limiter
from permissions import require_permission

# Import inside functions to avoid startup cycles

logger = logging.getLogger("visitor_signins")

public_router = APIRouter(prefix="/public/site", tags=["public-visitor"])
public_flat = APIRouter(prefix="/public/visitor", tags=["public-visitor"])
admin_router = APIRouter(prefix="/admin/visitors", tags=["admin-visitors"])


# ── Models ────────────────────────────────────────────────────────

class VisitorSigninIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    company: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=32)
    purpose: Optional[str] = Field(None, max_length=32)          # Contractor | Delivery | Client | Other
    visiting_person: Optional[str] = Field(None, max_length=120)
    vehicle_rego: Optional[str] = Field(None, max_length=16)
    induction_acknowledged: bool
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(req: Request) -> str:
    xff = req.headers.get("x-forwarded-for") or ""
    return xff.split(",")[0].strip() if xff else (req.client.host if req.client else "")


# ── Helpers ───────────────────────────────────────────────────────

async def _site_by_token(token: str) -> dict:
    site = await db.simpro_sites.find_one(
        {"scan_token": token,
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0, "id": 1, "simpro_site_id": 1, "name": 1, "address": 1,
         "org_id": 1, "archived": 1, "site_status": 1, "deleted_at": 1},
    )
    if not site:
        raise HTTPException(404, "Scan token not recognised")
    if site.get("archived") or site.get("site_status") == "archived":
        raise HTTPException(410, "Site is archived — visitor sign-in disabled")
    return site


# ── Public endpoints (no auth, rate-limited) ─────────────────────

@public_router.get("/{scan_token}/form")
async def public_visitor_form_info(scan_token: str, request: Request):
    """Minimal site info for the public visitor form header.

    Deliberately returns ONLY name + address + org display name. No
    org_id, no SWMS list, no worker roster — safe for any URL holder.
    """
    site = await _site_by_token(scan_token)
    # Pull just the org's display name (not the id) so the form can render
    # a branded header without leaking the tenancy tree.
    org_display = None
    org_id = site.get("org_id")
    if org_id:
        org = await db.organisations.find_one({"id": org_id}, {"_id": 0, "name": 1})
        if org:
            org_display = org.get("name")
    return {
        "site": {
            "id": site.get("simpro_site_id") or site.get("id"),
            "name": site.get("name"),
            "address": site.get("address"),
        },
        "org_display_name": org_display,
    }


@public_flat.post("/site/{scan_token}/signin")
@limiter.limit("10/hour")
async def public_visitor_signin(request: Request, scan_token: str, body: VisitorSigninIn):
    """Create a visitor record. Rate-limited to 10/hour per IP.

    The `induction_acknowledged` flag is REQUIRED — the frontend
    disables the submit button until the user ticks the checkbox, but
    we double-check here to catch API-only callers.
    """
    if not body.induction_acknowledged:
        raise HTTPException(400, "Safety induction must be acknowledged")
    site = await _site_by_token(scan_token)
    now = _now_iso()
    doc = {
        "id": _new_id(),
        "org_id": site.get("org_id"),
        "site_id": site.get("simpro_site_id") or site.get("id"),
        "site_scan_token": scan_token,
        "name": body.name.strip(),
        "company": (body.company or "").strip() or None,
        "phone": (body.phone or "").strip() or None,
        "purpose": (body.purpose or "").strip() or None,
        "visiting_person": (body.visiting_person or "").strip() or None,
        "vehicle_rego": (body.vehicle_rego or "").strip().upper() or None,
        "induction_acknowledged": True,
        "signed_in_at": now,
        "signed_out_at": None,
        "source_ip": _client_ip(request),
        "source_user_agent": request.headers.get("user-agent", "")[:400],
        "gps_lat": body.gps_lat,
        "gps_lng": body.gps_lng,
        "created_at": now,
        "updated_at": now,
    }
    await db.site_visitors.insert_one(doc)
    logger.info("visitor_signin id=%s site=%s ip=%s", doc["id"], doc["site_id"], doc["source_ip"])
    return {
        "visitor_id": doc["id"],
        "site_name": site.get("name"),
        "signed_in_at": now,
    }


@public_flat.post("/{visitor_id}/sign-out")
@limiter.limit("30/hour")
async def public_visitor_signout(request: Request, visitor_id: str, token: str):
    """Sign out. Requires the site's scan_token as a query-string
    parameter so a random URL holder can't sign out arbitrary
    visitors."""
    site = await _site_by_token(token)
    site_key = site.get("simpro_site_id") or site.get("id")
    v = await db.site_visitors.find_one(
        {"id": visitor_id, "site_id": site_key},
        {"_id": 0, "id": 1, "signed_out_at": 1, "signed_in_at": 1, "name": 1},
    )
    if not v:
        raise HTTPException(404, "Visitor record not found for this site")
    if v.get("signed_out_at"):
        return {"visitor_id": visitor_id, "signed_out_at": v["signed_out_at"], "already": True}
    now = _now_iso()
    await db.site_visitors.update_one(
        {"id": visitor_id},
        {"$set": {"signed_out_at": now, "updated_at": now, "signed_out_by": "self"}},
    )
    return {"visitor_id": visitor_id, "signed_out_at": now, "name": v.get("name")}


# ── Admin endpoints (auth + RBAC) ────────────────────────────────

@admin_router.get("")
@safe_admin_endpoint
async def admin_list_visitors(
    request: Request,
    site_id: Optional[str] = None,
    active_only: bool = False,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    include_deleted: bool = False,  # v58.13.110 — auditor toggle
    limit: int = Query(100, ge=1, le=500),
    user: dict = Depends(require_permission("sites_visitors", "view")),
):
    """List visitor sign-ins. Scoped by org. Capped at 500 rows to
    prevent CF 520s on wide date ranges. Use date_from/date_to to
    paginate historical windows.

    v58.13.110 — Soft-deleted rows are excluded by default. Pass
    `include_deleted=true` to include them (auditor / audit-trail
    surfaces only).
    """
    q: dict = {"org_id": user["org_id"]}
    if site_id:
        q["site_id"] = site_id
    if active_only:
        q["signed_out_at"] = None
    if not include_deleted:
        q["$or"] = [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]
    if date_from or date_to:
        q["signed_in_at"] = {}
        if date_from:
            q["signed_in_at"]["$gte"] = date_from
        if date_to:
            q["signed_in_at"]["$lte"] = date_to
    cursor = db.site_visitors.find(q, {"_id": 0}).sort("signed_in_at", -1).limit(limit)
    rows = [r async for r in cursor]
    # v58.13.110 — Enrich with site name/address for the decluttered
    # main table + detail drawer header. One cheap join per distinct
    # site_id in the result set (typically <20).
    site_ids = {r.get("site_id") for r in rows if r.get("site_id")}
    site_map: dict = {}
    if site_ids:
        async for s in db.simpro_sites.find(
            {"org_id": user["org_id"],
             "$or": [{"id": {"$in": list(site_ids)}},
                     {"simpro_site_id": {"$in": list(site_ids)}}]},
            {"_id": 0, "id": 1, "simpro_site_id": 1, "name": 1, "address": 1},
        ):
            key = s.get("simpro_site_id") or s.get("id")
            if key:
                site_map[key] = {"name": s.get("name"), "address": s.get("address")}
    for r in rows:
        site_meta = site_map.get(r.get("site_id"))
        if site_meta:
            r["site_name"] = site_meta["name"]
            r["site_address"] = site_meta["address"]
    return {"items": rows, "count": len(rows), "capped": len(rows) >= limit,
            "include_deleted": include_deleted}


@admin_router.get("/{visitor_id}")
@safe_admin_endpoint
async def admin_get_visitor(
    visitor_id: str,
    request: Request,
    user: dict = Depends(require_permission("sites_visitors", "view")),
):
    v = await db.site_visitors.find_one(
        {"id": visitor_id, "org_id": user["org_id"]}, {"_id": 0},
    )
    if not v:
        raise HTTPException(404, "Visitor not found")
    # v58.13.110 — Enrich with site info for the detail drawer header.
    site_key = v.get("site_id")
    if site_key:
        s = await db.simpro_sites.find_one(
            {"org_id": user["org_id"],
             "$or": [{"id": site_key}, {"simpro_site_id": site_key}]},
            {"_id": 0, "name": 1, "address": 1, "suburb": 1, "state": 1},
        )
        if s:
            v["site_name"] = s.get("name")
            v["site_address"] = s.get("address")
            v["site_suburb"] = s.get("suburb")
            v["site_state"] = s.get("state")
    return v


# v58.13.110 — Delete + bulk-delete + list-includes-deleted toggle.
class BulkDeleteIn(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=500)


@admin_router.delete("/{visitor_id}")
@safe_admin_endpoint
async def admin_delete_visitor(
    visitor_id: str,
    request: Request,
    user: dict = Depends(require_permission("sites_visitors", "delete")),
):
    """Soft-delete a single visitor row. Stamps `deleted_at` +
    `deleted_by`. Idempotent — a second call returns already=True."""
    v = await db.site_visitors.find_one(
        {"id": visitor_id, "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "deleted_at": 1},
    )
    if not v:
        raise HTTPException(404, "Visitor not found")
    if v.get("deleted_at"):
        return {"visitor_id": visitor_id, "deleted_at": v["deleted_at"], "already": True}
    now = _now_iso()
    await db.site_visitors.update_one(
        {"id": visitor_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": now, "deleted_by": user["id"], "updated_at": now}},
    )
    logger.info("visitor_delete id=%s actor=%s org=%s", visitor_id, user["id"], user["org_id"])
    return {"visitor_id": visitor_id, "deleted_at": now, "already": False}


@admin_router.post("/bulk-delete")
@safe_admin_endpoint
async def admin_bulk_delete_visitors(
    request: Request,
    body: BulkDeleteIn,
    user: dict = Depends(require_permission("sites_visitors", "delete")),
):
    """Soft-delete up to 500 visitor rows in one shot. Returns
    `{deleted: n, skipped: [{id, reason}]}`. Rows not found in the
    caller's org are reported as `not_found`; rows already deleted
    are reported as `already_deleted`. NEVER partially fails —
    every id in the payload lands in exactly one bucket."""
    ids = list({i for i in body.ids if i})  # dedupe, drop blanks
    if not ids:
        raise HTTPException(422, "ids must contain at least one non-empty value")
    # Fetch every candidate in one query.
    existing: dict = {}
    async for v in db.site_visitors.find(
        {"id": {"$in": ids}, "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "deleted_at": 1},
    ):
        existing[v["id"]] = v
    now = _now_iso()
    to_delete: list[str] = []
    skipped: list[dict] = []
    for vid in ids:
        row = existing.get(vid)
        if not row:
            skipped.append({"id": vid, "reason": "not_found"})
            continue
        if row.get("deleted_at"):
            skipped.append({"id": vid, "reason": "already_deleted"})
            continue
        to_delete.append(vid)
    deleted = 0
    if to_delete:
        res = await db.site_visitors.update_many(
            {"id": {"$in": to_delete}, "org_id": user["org_id"]},
            {"$set": {"deleted_at": now, "deleted_by": user["id"], "updated_at": now}},
        )
        deleted = res.modified_count
    logger.info(
        "visitor_bulk_delete deleted=%s skipped=%s actor=%s org=%s",
        deleted, len(skipped), user["id"], user["org_id"],
    )
    return {"deleted": deleted, "skipped": skipped, "requested": len(ids)}


@admin_router.post("/{visitor_id}/force-signout")
@safe_admin_endpoint
async def admin_force_signout(
    visitor_id: str,
    request: Request,
    user: dict = Depends(require_permission("sites_visitors", "edit")),
):
    """Admin can force sign-out a visitor (e.g. end of day). No
    Comms Safe Mode impact — writes a DB row only, no notifications."""
    v = await db.site_visitors.find_one(
        {"id": visitor_id, "org_id": user["org_id"]}, {"_id": 0, "signed_out_at": 1},
    )
    if not v:
        raise HTTPException(404, "Visitor not found")
    if v.get("signed_out_at"):
        return {"visitor_id": visitor_id, "signed_out_at": v["signed_out_at"], "already": True}
    now = _now_iso()
    await db.site_visitors.update_one(
        {"id": visitor_id},
        {"$set": {"signed_out_at": now, "updated_at": now,
                  "signed_out_by": user["id"], "signed_out_reason": "admin_force"}},
    )
    return {"visitor_id": visitor_id, "signed_out_at": now, "actor": user["id"]}


# ── Small helpers ────────────────────────────────────────────────

def _new_id() -> str:
    import uuid
    return uuid.uuid4().hex[:24]
