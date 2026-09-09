"""v58.13.132cb — Sites admin router.

Exposes `GET /api/sites/admin` (and thin CRUD for Phase A) against the
new canonical `sites` collection populated by
`scripts/merge_workspaces_into_sites_v58_13_132cb.py`.

Kept on a distinct prefix (`/sites/admin`) so it does NOT clash with
the pre-existing public site scan / sign-on router mounted at
`/sites` in `sites_qr.py` (Phase 4.12).

Post-`.132cb-b` this router will absorb the Phase-B FK rename
(workspace_id → site_id) and the frontend Sites admin page will call
`GET /api/sites` directly. For now it lives at `/sites/admin` to avoid
route collisions during the transition.
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import db
from models import new_id, now_iso


router = APIRouter(prefix="/sites/admin", tags=["sites-admin"])


class SiteIn(BaseModel):
    name: str
    address_full: Optional[str] = None
    description: Optional[str] = None
    default_for_org: Optional[bool] = None


def _require_admin(user: dict) -> None:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin role required")


@router.get("")
async def list_sites(user: dict = Depends(get_current_user)):
    """List every non-deleted site for the caller's org.

    Rows returned include both `source='simpro'` (project sites imported
    from the Simpro API) and `source='workspace_promoted'` (the old
    admin workspace container, kept so pre_starts/etc. FKs still
    resolve during Phase A). The `source` field is exposed so admin
    UIs can distinguish operational sites from the placeholder admin
    container.
    """
    docs = await db.sites.find(
        {
            "org_id": user["org_id"],
            "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
        },
        {"_id": 0},
    ).sort("name", 1).to_list(500)
    return docs


@router.post("")
async def create_site(body: SiteIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    doc = {
        "id": new_id(),
        "org_id": user["org_id"],
        "name": body.name.strip(),
        "address_full": body.address_full,
        "description": body.description,
        "default_for_org": bool(body.default_for_org),
        "source": "manual",
        "created_at": now_iso(),
    }
    if doc["default_for_org"]:
        await db.sites.update_many(
            {"org_id": user["org_id"]},
            {"$set": {"default_for_org": False}},
        )
    await db.sites.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{sid}")
async def update_site(sid: str, body: SiteIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not patch:
        raise HTTPException(400, "No fields to update")
    if patch.get("default_for_org"):
        await db.sites.update_many(
            {"org_id": user["org_id"], "id": {"$ne": sid}},
            {"$set": {"default_for_org": False}},
        )
    patch["updated_at"] = now_iso()
    doc = await db.sites.find_one_and_update(
        {"id": sid, "org_id": user["org_id"]},
        {"$set": patch},
        return_document=True,
        projection={"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Site not found")
    return doc


@router.delete("/{sid}")
async def delete_site(sid: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    res = await db.sites.update_one(
        {"id": sid, "org_id": user["org_id"]},
        {"$set": {"deleted_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Site not found")
    return {"ok": True, "deleted": True}
