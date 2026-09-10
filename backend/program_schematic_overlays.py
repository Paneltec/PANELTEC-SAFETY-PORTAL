"""Program Schematic overlays — v58.13.132cr / .132cx.

Admin-editable overlay layer for the frontend Program Schematic
(`/app/settings/schematic`). The static registry in
`frontend/src/lib/programSchematic.js` is the canonical topology;
overlays let admins mark individual nodes as **dropped** (hidden in
the default render, restorable in Edit mode) or **added** (fresh
custom nodes that don't exist in the static registry), and to override
labels + attach notes.

Collection: `db.program_schematic_overlays`
Shape (one doc per (org_id, cluster_key, node_key)):
    {
      id:           <uuid>,
      org_id:       <str>,
      cluster_key:  <str>,          # e.g. "mobile_home_admin"
      node_key:     <str>,          # e.g. "mobile-home-admin-workers" or "_new_a1b2c3"
      status:       "dropped" | "added" | "kept",
      custom_label: <str|null>,     # overrides the static label when set
      notes:        <str|null>,     # admin's note about the change
      created_at:   <iso>,
      created_by:   <user_id>,
      updated_at:   <iso>,
      updated_by:   <user_id>,
      deleted_at:   <iso|null>,     # soft-delete marker
    }

Endpoints (mounted at `/api/program-schematic`):
  GET    /overlays                        — read, `users.view`
  PUT    /overlays/{cluster}/{node}       — idempotent upsert, `users.edit`
  DELETE /overlays/{cluster}/{node}       — soft-delete, `users.edit`
  POST   /overlays/new                    — mint a `_new_<6>` custom node,
                                            `users.edit`
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from permissions import require_permission


router = APIRouter(tags=["program-schematic"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _out(doc: dict) -> dict:
    """Serialise an overlay doc for the API response (drop Mongo _id)."""
    return {
        "id":           doc.get("id"),
        "org_id":       doc.get("org_id"),
        "cluster_key":  doc.get("cluster_key"),
        "node_key":     doc.get("node_key"),
        "status":       doc.get("status") or "kept",
        "custom_label": doc.get("custom_label"),
        "notes":        doc.get("notes"),
        "created_at":   doc.get("created_at"),
        "created_by":   doc.get("created_by"),
        "updated_at":   doc.get("updated_at"),
        "updated_by":   doc.get("updated_by"),
    }


# ─────────────── Models ───────────────


class OverlayUpsertIn(BaseModel):
    status:       Optional[str] = Field(default=None, description="'dropped' | 'added' | 'kept'")
    custom_label: Optional[str] = None
    notes:        Optional[str] = None


class OverlayCreateNewIn(BaseModel):
    cluster_key: str
    label:       str
    notes:       Optional[str] = None


# ─────────────── Routes ───────────────


@router.get("/overlays")
async def list_overlays(actor: dict = Depends(require_permission("users", "view"))):
    """Return active overlays for the caller's org, grouped by cluster
    then node key: `{ cluster_key: { node_key: overlay_doc } }`."""
    grouped: dict = {}
    async for d in db.program_schematic_overlays.find(
        {"org_id": actor["org_id"], "deleted_at": None},
        {"_id": 0},
    ):
        ck = d.get("cluster_key")
        nk = d.get("node_key")
        if not ck or not nk:
            continue
        grouped.setdefault(ck, {})[nk] = _out(d)
    return grouped


@router.put("/overlays/{cluster_key}/{node_key}")
async def upsert_overlay(
    cluster_key: str,
    node_key:    str,
    body:        OverlayUpsertIn,
    actor:       dict = Depends(require_permission("users", "edit")),
):
    """Idempotent upsert. Reactivates any soft-deleted doc for the
    same (org, cluster, node) tuple by clearing `deleted_at`."""
    if not cluster_key.strip() or not node_key.strip():
        raise HTTPException(400, "cluster_key and node_key required")

    now = _now_iso()
    existing = await db.program_schematic_overlays.find_one(
        {"org_id": actor["org_id"], "cluster_key": cluster_key, "node_key": node_key},
        {"_id": 0},
    )
    if existing:
        upd = {"updated_at": now, "updated_by": actor["id"], "deleted_at": None}
        if body.status is not None:
            upd["status"] = body.status
        if body.custom_label is not None:
            upd["custom_label"] = body.custom_label
        if body.notes is not None:
            upd["notes"] = body.notes
        await db.program_schematic_overlays.update_one(
            {"org_id": actor["org_id"], "cluster_key": cluster_key, "node_key": node_key},
            {"$set": upd},
        )
        saved = await db.program_schematic_overlays.find_one(
            {"org_id": actor["org_id"], "cluster_key": cluster_key, "node_key": node_key},
            {"_id": 0},
        )
        return _out(saved)

    doc = {
        "id":           _new_id(),
        "org_id":       actor["org_id"],
        "cluster_key":  cluster_key,
        "node_key":     node_key,
        "status":       body.status or "kept",
        "custom_label": body.custom_label,
        "notes":        body.notes,
        "created_at":   now,
        "created_by":   actor["id"],
        "updated_at":   now,
        "updated_by":   actor["id"],
        "deleted_at":   None,
    }
    await db.program_schematic_overlays.insert_one(doc)
    return _out(doc)


@router.delete("/overlays/{cluster_key}/{node_key}")
async def delete_overlay(
    cluster_key: str,
    node_key:    str,
    actor:       dict = Depends(require_permission("users", "edit")),
):
    """Soft-delete an overlay so the static registry re-appears
    verbatim in the render. Idempotent (returns 404 only if the
    overlay never existed for this tuple)."""
    now = _now_iso()
    r = await db.program_schematic_overlays.update_one(
        {"org_id": actor["org_id"], "cluster_key": cluster_key, "node_key": node_key,
         "deleted_at": None},
        {"$set": {"deleted_at": now, "updated_at": now, "updated_by": actor["id"]}},
    )
    if r.matched_count == 0:
        # Not an error — the caller's intent (no overlay for this
        # tuple) is already satisfied. Return 204-ish empty payload.
        return {"deleted": False}
    return {"deleted": True}


@router.post("/overlays/new", status_code=201)
async def create_new_custom_node(
    body:  OverlayCreateNewIn,
    actor: dict = Depends(require_permission("users", "edit")),
):
    """Mint a brand-new custom node with a server-generated `_new_<6>`
    key. The node is stored as `status='added'` with the provided
    `label` in `custom_label` so the FE renders it as a real card."""
    if not body.cluster_key.strip():
        raise HTTPException(400, "cluster_key required")
    if not body.label.strip():
        raise HTTPException(400, "label required")

    node_key = f"_new_{uuid.uuid4().hex[:6]}"
    now = _now_iso()
    doc = {
        "id":           _new_id(),
        "org_id":       actor["org_id"],
        "cluster_key":  body.cluster_key,
        "node_key":     node_key,
        "status":       "added",
        "custom_label": body.label.strip(),
        "notes":        body.notes,
        "created_at":   now,
        "created_by":   actor["id"],
        "updated_at":   now,
        "updated_by":   actor["id"],
        "deleted_at":   None,
    }
    await db.program_schematic_overlays.insert_one(doc)
    return _out(doc)
