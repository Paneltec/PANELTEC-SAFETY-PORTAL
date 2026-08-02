"""v160.3.9.26 — Table-column visibility preferences (per-user, per-resource).

Motivation: the Lucidity `Column Configuration` cells (12 columns × N
users) are NOT authorisation — they are UI table-view preferences. We
lift them out of the permissions matrix into a dedicated per-user store
so Phase 4 UI can migrate them.

Endpoints (both require authentication only — the pref belongs to the
caller):

    GET  /api/user-prefs/table-columns/{resource}
    PUT  /api/user-prefs/table-columns/{resource}
    GET  /api/user-prefs/table-columns  (all resources, aggregated)

Storage: `user_prefs` collection.
    { user_id, resource, columns: [str], updated_at }

Idempotent — indexed as unique(user_id, resource).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import now_iso
from permissions import PERMISSIONS_SCHEMA


router = APIRouter(prefix="/user-prefs/table-columns", tags=["user-prefs"])


class TableColumnsIn(BaseModel):
    columns: List[str] = Field(default_factory=list, description="Ordered column keys the user has chosen to show.")


async def ensure_user_prefs_indexes() -> None:
    try:
        await db.user_prefs.create_index(
            [("user_id", 1), ("resource", 1)],
            unique=True,
            name="uniq_user_resource",
        )
    except Exception:
        pass


def _validate_resource(resource: str) -> None:
    # Accept any known resource; also allow the Risk Assessments
    # reference-lib table keys (master_risks, list_forms, etc.) which
    # aren't top-level PERMISSIONS_SCHEMA resources but ARE valid table
    # views. Keep the whitelist small.
    if resource in PERMISSIONS_SCHEMA:
        return
    extra_ok = {
        "master_risks", "list_forms", "incident_root_causes",
        "cs_incident", "list_roles", "completed_training", "companies",
        "plant_maintenance",
    }
    if resource not in extra_ok:
        raise HTTPException(400, f"Unknown resource '{resource}'")


@router.get("/{resource}")
async def get_columns(resource: str, user: dict = Depends(get_current_user)):
    _validate_resource(resource)
    doc = await db.user_prefs.find_one(
        {"user_id": user["id"], "resource": resource},
        {"_id": 0},
    )
    return {
        "resource": resource,
        "columns": (doc or {}).get("columns", []),
        "updated_at": (doc or {}).get("updated_at"),
    }


@router.put("/{resource}")
async def set_columns(resource: str, body: TableColumnsIn,
                      user: dict = Depends(get_current_user)):
    _validate_resource(resource)
    cols = [c.strip() for c in (body.columns or []) if isinstance(c, str) and c.strip()]
    ts = now_iso()
    await db.user_prefs.update_one(
        {"user_id": user["id"], "resource": resource},
        {"$set": {"columns": cols, "updated_at": ts},
         "$setOnInsert": {"user_id": user["id"], "resource": resource,
                          "created_at": ts}},
        upsert=True,
    )
    return {"resource": resource, "columns": cols, "updated_at": ts}


@router.get("")
async def list_all_prefs(user: dict = Depends(get_current_user)):
    docs = await db.user_prefs.find(
        {"user_id": user["id"]}, {"_id": 0},
    ).sort("resource", 1).to_list(200)
    return {"count": len(docs), "prefs": docs}


# ─────────────────────────────────────────────────────────────
# v160.3.9.33.1 — Section-order preference.
# Stored in the same `user_prefs` collection under a distinct
# `kind` discriminator so it doesn't clash with `table-columns`
# docs. Per-admin, per-resource. Used by the Users & Permissions
# grouped-by-role list to remember the admin's chosen order.
# ─────────────────────────────────────────────────────────────

section_order_router = APIRouter(
    prefix="/user-prefs/section-order",
    tags=["user-prefs"],
)


class SectionOrderIn(BaseModel):
    section_order: List[str] = Field(
        default_factory=list,
        description="Ordered list of section keys (role_ids) as picked by the admin.",
    )


@section_order_router.get("/{resource}")
async def get_section_order(resource: str, user: dict = Depends(get_current_user)):
    _validate_resource(resource)
    doc = await db.user_prefs.find_one(
        {"user_id": user["id"], "resource": resource, "kind": "section_order"},
        {"_id": 0},
    )
    return {
        "resource": resource,
        "section_order": (doc or {}).get("section_order", []),
        "updated_at": (doc or {}).get("updated_at"),
    }


@section_order_router.put("/{resource}")
async def set_section_order(resource: str, body: SectionOrderIn,
                             user: dict = Depends(get_current_user)):
    _validate_resource(resource)
    order = [s.strip() for s in (body.section_order or [])
             if isinstance(s, str) and s.strip()]
    ts = now_iso()
    await db.user_prefs.update_one(
        {"user_id": user["id"], "resource": resource, "kind": "section_order"},
        {"$set": {"section_order": order, "updated_at": ts},
         "$setOnInsert": {"user_id": user["id"], "resource": resource,
                          "kind": "section_order", "created_at": ts}},
        upsert=True,
    )
    return {"resource": resource, "section_order": order, "updated_at": ts}


@section_order_router.delete("/{resource}")
async def reset_section_order(resource: str, user: dict = Depends(get_current_user)):
    _validate_resource(resource)
    await db.user_prefs.delete_one(
        {"user_id": user["id"], "resource": resource, "kind": "section_order"},
    )
    return {"resource": resource, "section_order": [], "reset": True}
