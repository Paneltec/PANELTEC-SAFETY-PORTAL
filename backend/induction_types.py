"""v58.13.132gv — Phase 3: Inductions dropdown admin CRUD.

Editable induction-type dropdown for the Worker Inductions matrix.
Previously the `<select>` in `InductionCardModal.jsx` was a
hardcoded 3-entry list (`competency`, `site_induction`, `license`).
Office staff couldn't add new induction types without a code
change. This ships:

* `induction_types` collection, one row per admin-managed type.
* CRUD sub-router at `/api/inductions/types` — admin-only writes,
  soft-delete + snapshot semantics identical to Phase 1's
  `/api/equipment/categories`.
* Auto-seeds the three legacy values on first-list per org so
  existing worker_certifications rows keep matching a dropdown
  entry (snapshot preserved). Renames don't cascade — matches
  the Phase 1 pattern.

Mounts BEFORE any `/{...}` catch-all is a non-issue here because
there's no existing `/inductions/*` router — the `/induction-columns`
prefix is different.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db

log = logging.getLogger("paneltec.induction_types")

router = APIRouter(prefix="/inductions/types",
                     tags=["induction-types"])

# Seed values MATCH the legacy hardcoded dropdown in
# InductionCardModal.jsx so existing `worker_certifications.type`
# strings continue to resolve to a live dropdown option after the
# API switch. Admins can rename these to prettier labels via the
# Manage Induction Types modal — renames don't cascade (snapshot
# semantics).
DEFAULT_INDUCTION_TYPES = [
    "competency",
    "site_induction",
    "license",
]


def _require_admin(user: dict) -> None:
    if (user or {}).get("role") != "admin":
        raise HTTPException(403, "Admin only")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class InductionTypeIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class InductionTypePatch(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


def _shape(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def _ensure_indexes():
    await db.induction_types.create_index(
        [("org_id", 1), ("deleted_at", 1), ("name", 1)])
    await db.induction_types.create_index("id", unique=True)


async def _seed_defaults(org_id: str, actor_id: str) -> None:
    """Idempotently seed the three legacy induction-type values for
    a fresh org so the dropdown never renders empty."""
    existing = await db.induction_types.count_documents(
        {"org_id": org_id, "deleted_at": None})
    if existing:
        return
    now = _now()
    docs = [
        {
            "id": str(uuid.uuid4()),
            "org_id": org_id,
            "name": name,
            "created_by": actor_id,
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
            "seeded": True,
        }
        for name in DEFAULT_INDUCTION_TYPES
    ]
    await db.induction_types.insert_many(docs)


@router.get("")
async def list_types(user: dict = Depends(get_current_user)):
    # Read is permitted for any authenticated user so the dropdown
    # populates for non-admin roles (managers filling out a
    # worker's induction). Writes remain admin-only.
    await _ensure_indexes()
    await _seed_defaults(user["org_id"], user["id"])
    items: list[dict] = []
    async for row in db.induction_types.find(
        {"org_id": user["org_id"], "deleted_at": None},
    ).sort([("name", 1)]):
        items.append(_shape(row))
    return {"items": items, "total": len(items)}


@router.post("", status_code=201)
async def create_type(body: InductionTypeIn,
                        user: dict = Depends(get_current_user)):
    _require_admin(user)
    await _ensure_indexes()
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    dupe = await db.induction_types.find_one({
        "org_id": user["org_id"], "deleted_at": None, "name": name,
    })
    if dupe:
        raise HTTPException(409, "Induction type already exists")
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "org_id": user["org_id"],
        "name": name,
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
        "seeded": False,
    }
    await db.induction_types.insert_one(doc.copy())
    return _shape(doc)


@router.patch("/{tid}")
async def rename_type(tid: str, body: InductionTypePatch,
                        user: dict = Depends(get_current_user)):
    _require_admin(user)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    dupe = await db.induction_types.find_one({
        "org_id": user["org_id"], "deleted_at": None, "name": name,
        "id": {"$ne": tid},
    })
    if dupe:
        raise HTTPException(409, "Induction type already exists")
    now = _now()
    r = await db.induction_types.update_one(
        {"id": tid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"name": name, "updated_at": now,
                    "updated_by": user["id"]}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Induction type not found")
    doc = await db.induction_types.find_one({"id": tid})
    return _shape(doc)


@router.delete("/{tid}", status_code=204)
async def delete_type(tid: str,
                        user: dict = Depends(get_current_user)):
    _require_admin(user)
    now = _now()
    r = await db.induction_types.update_one(
        {"id": tid, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": now, "deleted_by": user["id"]}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Induction type not found")
    # Snapshot semantics: worker_certifications rows already using
    # this type keep their `type` string. Nothing to cascade.
    return Response(status_code=204)
