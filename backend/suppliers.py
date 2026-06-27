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
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/suppliers", tags=["suppliers"])

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
async def list_meta(user: dict = Depends(get_current_user)):
    """Return all supplier_meta rows for the org as a `{sid: meta}` map.
    The page calls this once on load and merges with the live Simpro feed."""
    cursor = db.supplier_meta.find(
        {"org_id": user["org_id"], "deleted_at": None}, {"_id": 0},
    )
    rows = await cursor.to_list(5000)
    return {r["simpro_supplier_id"]: _serialise(r) for r in rows}


@router.get("/{simpro_supplier_id}/meta")
async def get_meta(simpro_supplier_id: str, user: dict = Depends(get_current_user)):
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
    user: dict = Depends(get_current_user),
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
