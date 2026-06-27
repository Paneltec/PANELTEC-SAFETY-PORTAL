"""Workspace listing + CRUD. Admin-only mutations."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class WsIn(BaseModel):
    name: str
    description: Optional[str] = None
    address: Optional[str] = None
    default_for_org: Optional[bool] = None


def _require_admin(user: dict):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin role required")


@router.get("")
async def list_workspaces(user: dict = Depends(get_current_user)):
    docs = await db.workspaces.find(
        {"org_id": user["org_id"],
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]},
        {"_id": 0},
    ).sort("name", 1).to_list(200)
    # Compute member counts in one round-trip.
    counts = {w["id"]: 0 for w in docs}
    cursor = db.users.find({"org_id": user["org_id"], "workspace_ids": {"$in": list(counts)}},
                           {"workspace_ids": 1})
    async for u in cursor:
        for wid in u.get("workspace_ids", []):
            if wid in counts:
                counts[wid] += 1
    for w in docs:
        w["member_count"] = counts.get(w["id"], 0)
    return docs


@router.post("")
async def create_workspace(body: WsIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    doc = {
        "id": new_id(), "org_id": user["org_id"], "name": body.name.strip(),
        "description": body.description, "address": body.address,
        "default_for_org": bool(body.default_for_org),
        "created_at": now_iso(),
    }
    if doc["default_for_org"]:
        await db.workspaces.update_many({"org_id": user["org_id"]},
                                        {"$set": {"default_for_org": False}})
    await db.workspaces.insert_one(doc)
    doc.pop("_id", None)
    doc["member_count"] = 0
    return doc


@router.patch("/{wid}")
async def update_workspace(wid: str, body: WsIn, user: dict = Depends(get_current_user)):
    _require_admin(user)
    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if not patch:
        raise HTTPException(400, "No fields to update")
    if patch.get("default_for_org"):
        await db.workspaces.update_many(
            {"org_id": user["org_id"], "id": {"$ne": wid}},
            {"$set": {"default_for_org": False}},
        )
    patch["updated_at"] = now_iso()
    doc = await db.workspaces.find_one_and_update(
        {"id": wid, "org_id": user["org_id"]}, {"$set": patch},
        return_document=True, projection={"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Workspace not found")
    return doc


@router.delete("/{wid}")
async def delete_workspace(wid: str, force: bool = False, user: dict = Depends(get_current_user)):
    """Soft-delete a workspace. Refuses if it is the last workspace in the org.

    By default also refuses if any users are still assigned — admin must reassign
    them first. Passing `?force=true` (admin only) unassigns all users from this
    workspace before soft-deleting it. Users left with zero workspaces are NOT
    auto-reassigned; they will need to be placed manually in Settings → Users.
    """
    _require_admin(user)
    active = await db.workspaces.count_documents({
        "org_id": user["org_id"],
        "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}],
    })
    if active <= 1:
        raise HTTPException(400, "Cannot delete the only workspace — create another one first")

    users_updated = 0
    if force:
        res = await db.users.update_many(
            {"org_id": user["org_id"], "workspace_ids": wid},
            {"$pull": {"workspace_ids": wid}, "$set": {"updated_at": now_iso()}},
        )
        users_updated = res.modified_count
    else:
        in_use = await db.users.count_documents({"org_id": user["org_id"], "workspace_ids": wid})
        if in_use:
            raise HTTPException(
                400,
                f"Cannot delete — {in_use} user(s) assigned. Reassign them in Settings → Users first, "
                "or re-call with ?force=true to unassign them automatically.",
            )

    res = await db.workspaces.update_one(
        {"id": wid, "org_id": user["org_id"]},
        {"$set": {"deleted_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Workspace not found")
    return {"ok": True, "deleted": True, "users_updated": users_updated}


@router.post("/{wid}/unassign-all")
async def unassign_all_from_workspace(wid: str, user: dict = Depends(get_current_user)):
    """Admin-only convenience: remove this workspace from every user's
    workspace_ids without deleting the workspace itself. Used by the UI when an
    admin wants to clear assignments before reviewing the workspace."""
    _require_admin(user)
    res = await db.users.update_many(
        {"org_id": user["org_id"], "workspace_ids": wid},
        {"$pull": {"workspace_ids": wid}, "$set": {"updated_at": now_iso()}},
    )
    return {"ok": True, "users_updated": res.modified_count}
