"""Suppliers — per-supplier metadata layer on top of Simpro Vendors.

The supplier rows themselves come live from Simpro (`integrations_simpro.py`,
`GET /api/integrations/simpro/suppliers`). This module stores org-local
metadata keyed by `simpro_supplier_id`:

  - `active_override`: org can mark a Simpro-active vendor as inactive locally
  - `location_on_map`: whether to display on the vehicles/map view
  - `parent_supplier_id`: hierarchical relationship (also a simpro_supplier_id)
  - `custom_contact` / `custom_phone`: org overrides that don't write back to Simpro
  - `notes`: free text

Writes restricted to admin + hseq_lead.
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user
from permissions import require_permission, require_module
from db import db
from models import new_id, now_iso

router = APIRouter(
    prefix="/suppliers", tags=["suppliers"],
    dependencies=[Depends(require_module("suppliers"))],  # v160.0.9
)

WRITE_ROLES = {"admin", "hseq_lead"}


def _require_write(user: dict):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(403, "Permission denied: suppliers.edit")


class SupplierMetaPatch(BaseModel):
    active_override: Optional[bool] = None
    location_on_map: Optional[bool] = None
    parent_supplier_id: Optional[str] = Field(default=None, max_length=64)
    custom_contact: Optional[str] = Field(default=None, max_length=120)
    custom_phone: Optional[str] = Field(default=None, max_length=40)
    custom_address: Optional[str] = Field(default=None, max_length=500)
    custom_state: Optional[str] = Field(default=None, max_length=20)
    notes: Optional[str] = Field(default=None, max_length=2000)


def _serialise(doc: dict) -> dict:
    return {
        "simpro_supplier_id": doc["simpro_supplier_id"],
        "active_override": doc.get("active_override"),
        "location_on_map": bool(doc.get("location_on_map", False)),
        "parent_supplier_id": doc.get("parent_supplier_id"),
        "custom_contact": doc.get("custom_contact"),
        "custom_phone": doc.get("custom_phone"),
        "custom_address": doc.get("custom_address"),
        "custom_state": doc.get("custom_state"),
        "notes": doc.get("notes"),
        "updated_at": doc.get("updated_at"),
    }


@router.get("/meta")
async def list_meta(user: dict = Depends(require_permission("suppliers", "view"))):
    """Return all supplier_meta rows for the org as a `{sid: meta}` map.
    The page calls this once on load and merges with the live Simpro feed."""
    cursor = db.supplier_meta.find(
        {"org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    rows = await cursor.to_list(5000)
    return {r["simpro_supplier_id"]: _serialise(r) for r in rows}


@router.get("/address-lookup")
async def address_lookup(
    company_name: str,
    user: dict = Depends(require_permission("suppliers", "view")),
):
    """v160.3.9.49 — Look up a supplier's postal address by company name.

    Two providers, both server-side (frontend never talks to them
    directly — keeps rate-limit compliance + no CORS pain):
      1. ABN Lookup (Australian Business Register) — free but requires
         `ABN_LOOKUP_GUID` env registration. Best for AU businesses.
      2. OpenStreetMap Nominatim — free, no key, 1 req/sec ToS. We
         send a descriptive `User-Agent: paneltec-civil/1.0` so we
         stay on the polite side of their throttle.

    Returns `{source, street, suburb, state, postcode, country,
    confidence, raw}` OR `{source: null}` when nothing matched.
    Secrets are never echoed back.
    """
    import os as _os
    import httpx as _h
    q = (company_name or "").strip()
    if not q or len(q) < 3:
        raise HTTPException(400, "company-name-too-short")

    result: dict = {"source": None, "street": None, "suburb": None,
                    "state": None, "postcode": None, "country": None,
                    "confidence": None}

    guid = _os.environ.get("ABN_LOOKUP_GUID", "").strip()
    if guid:
        try:
            async with _h.AsyncClient(timeout=8.0,
                                       headers={"User-Agent": "paneltec-civil/1.0"}) as c:
                r = await c.get(
                    "https://abr.business.gov.au/json/MatchingNames.aspx",
                    params={"name": q, "guid": guid, "maxResults": 5},
                )
                if r.status_code == 200:
                    # ABN JSON is wrapped in `callback(...)` — strip that.
                    import json as _j, re as _re
                    body = _re.sub(r"^[a-zA-Z_]+\(|\)$", "", r.text.strip())
                    data = _j.loads(body) if body else {}
                    names = data.get("Names") or []
                    if names:
                        top = names[0]
                        result.update({
                            "source": "abn",
                            "suburb": top.get("Postcode") and top.get("Location"),
                            "state": top.get("State"),
                            "postcode": top.get("Postcode"),
                            "country": "AU",
                            "confidence": top.get("Score"),
                        })
        except Exception:
            # Never log the GUID or the full URL — swallow and fall through.
            pass

    if result["source"] is None:
        try:
            async with _h.AsyncClient(timeout=8.0,
                                       headers={"User-Agent": "paneltec-civil/1.0"}) as c:
                r = await c.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": q, "format": "json", "limit": 1,
                            "addressdetails": 1, "countrycodes": "au"},
                )
                if r.status_code == 200:
                    data = r.json() or []
                    if data:
                        top = data[0]
                        addr = top.get("address") or {}
                        result.update({
                            "source": "osm",
                            "street": ", ".join(x for x in [
                                addr.get("house_number"),
                                addr.get("road") or addr.get("pedestrian"),
                            ] if x) or None,
                            "suburb": (addr.get("suburb") or addr.get("city")
                                       or addr.get("town") or addr.get("village")),
                            "state": addr.get("state"),
                            "postcode": addr.get("postcode"),
                            "country": addr.get("country_code", "").upper() or None,
                            "confidence": top.get("importance"),
                        })
        except Exception:
            pass

    return result


@router.get("/{simpro_supplier_id}/meta")
async def get_meta(simpro_supplier_id: str, user: dict = Depends(require_permission("suppliers", "view"))):
    doc = await db.supplier_meta.find_one(
        {"simpro_supplier_id": simpro_supplier_id,
         "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        return {"simpro_supplier_id": simpro_supplier_id,
                "active_override": None, "location_on_map": False,
                "parent_supplier_id": None, "custom_contact": None,
                "custom_phone": None, "custom_address": None,
                "custom_state": None, "notes": None, "updated_at": None}
    return _serialise(doc)


@router.patch("/{simpro_supplier_id}/meta")
async def upsert_meta(
    simpro_supplier_id: str,
    body: SupplierMetaPatch,
    user: dict = Depends(require_permission("suppliers", "edit")),
):
    _require_write(user)
    update = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in {
        "active_override", "location_on_map", "parent_supplier_id",
        "custom_contact", "custom_phone", "custom_address",
        "custom_state", "notes",
    }}
    if not update:
        raise HTTPException(400, "No fields supplied")
    update["updated_at"] = now_iso()
    update["updated_by"] = user["id"]
    result = await db.supplier_meta.find_one_and_update(
        {"simpro_supplier_id": simpro_supplier_id,
         "org_id": user["org_id"], "deleted_at": None},
        {"$set": update,
         "$setOnInsert": {
            "id": new_id(),
            "org_id": user["org_id"],
            "simpro_supplier_id": simpro_supplier_id,
            "created_at": now_iso(),
            "created_by": user["id"],
            "deleted_at": None,
         }},
        upsert=True,
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    return _serialise(result)


# ────────────────────── Renewal email ──────────────────────

class RenewalEmailIn(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    body_html: str = Field(min_length=1, max_length=20000)
    recipient_email: str = Field(min_length=3, max_length=160)
    cc: Optional[list[str]] = None


@router.post("/{simpro_supplier_id}/send-renewal", status_code=201)
async def send_renewal(
    simpro_supplier_id: str,
    body: RenewalEmailIn,
    user: dict = Depends(require_permission("suppliers", "edit")),
):
    """Queue a compliance-renewal email to this supplier via the org's M365
    outbox (or stash it for later send when M365 isn't connected)."""
    _require_write(user)
    from email_outbox import queue_email_doc
    doc = await queue_email_doc(
        org_id=user["org_id"],
        to=[body.recipient_email],
        cc=body.cc or [],
        subject=body.subject,
        body_html=body.body_html,
        related_record_type="supplier",
        related_record_id=simpro_supplier_id,
        resource_kind="contractors",
        created_by=user["id"],
    )
    return {"ok": True, "status": doc["status"], "outbox_id": doc["id"]}
