"""Per-supplier side panels — tasks, notes, members (and panel-count
aggregations). Folder panel deferred to next turn.

All routes mounted under `/api/suppliers` to live alongside `supplier_meta`.
Writes are admin + hseq_lead; everyone reads.
"""
from __future__ import annotations
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from auth import get_current_user
from db import db
from models import new_id, now_iso

router = APIRouter(prefix="/suppliers", tags=["supplier-panels"])

WRITE_ROLES = {"admin", "hseq_lead"}
TASK_STATUSES = {"open", "in_progress", "done", "cancelled"}
TASK_PRIORITIES = {"low", "med", "high"}


def _require_write(user: dict, action: str = "edit"):
    if user.get("role") not in WRITE_ROLES:
        raise HTTPException(403, f"Permission denied: suppliers.{action}")


def _strip(d: dict) -> dict:
    d.pop("_id", None)
    return d


# ────────────────────── Tasks ──────────────────────

class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    due_date: Optional[str] = Field(default=None, max_length=20)  # YYYY-MM-DD
    status: str = Field(default="open")
    priority: str = Field(default="med")
    assigned_to: Optional[str] = Field(default=None, max_length=64)


class TaskPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    due_date: Optional[str] = Field(default=None, max_length=20)
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = Field(default=None, max_length=64)


def _validate_task(payload: dict):
    if "status" in payload and payload["status"] and payload["status"] not in TASK_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(TASK_STATUSES)}")
    if "priority" in payload and payload["priority"] and payload["priority"] not in TASK_PRIORITIES:
        raise HTTPException(400, f"priority must be one of {sorted(TASK_PRIORITIES)}")


@router.get("/{supplier_id}/tasks")
async def list_tasks(supplier_id: str, user: dict = Depends(get_current_user)):
    cursor = db.supplier_tasks.find(
        {"org_id": user["org_id"], "supplier_id": supplier_id, "deleted_at": None},
        {"_id": 0},
    ).sort([("status", 1), ("due_date", 1), ("created_at", -1)])
    return await cursor.to_list(500)


@router.post("/{supplier_id}/tasks", status_code=201)
async def create_task(supplier_id: str, body: TaskIn, user: dict = Depends(get_current_user)):
    _require_write(user)
    payload = body.model_dump()
    _validate_task(payload)
    doc = {
        "id": new_id(), "org_id": user["org_id"], "supplier_id": supplier_id,
        **payload,
        "created_by": user["id"], "created_by_name": user.get("name") or user.get("email"),
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.supplier_tasks.insert_one(doc)
    return _strip(doc)


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskPatch, user: dict = Depends(get_current_user)):
    _require_write(user)
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    _validate_task(payload)
    if not payload:
        raise HTTPException(400, "No fields supplied")
    payload["updated_at"] = now_iso()
    result = await db.supplier_tasks.find_one_and_update(
        {"id": task_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": payload},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(404, "Task not found")
    return result


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: str, user: dict = Depends(get_current_user)):
    _require_write(user, action="delete")
    ts = now_iso()
    result = await db.supplier_tasks.update_one(
        {"id": task_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Task not found")
    return None


# ────────────────────── Notes ──────────────────────

class NoteIn(BaseModel):
    body_md: str = Field(min_length=1, max_length=10000)


class NotePatch(BaseModel):
    body_md: Optional[str] = Field(default=None, min_length=1, max_length=10000)


@router.get("/{supplier_id}/notes")
async def list_notes(supplier_id: str, user: dict = Depends(get_current_user)):
    cursor = db.supplier_notes.find(
        {"org_id": user["org_id"], "supplier_id": supplier_id, "deleted_at": None},
        {"_id": 0},
    ).sort([("created_at", -1)])
    return await cursor.to_list(500)


@router.post("/{supplier_id}/notes", status_code=201)
async def create_note(supplier_id: str, body: NoteIn, user: dict = Depends(get_current_user)):
    _require_write(user)
    doc = {
        "id": new_id(), "org_id": user["org_id"], "supplier_id": supplier_id,
        "body_md": body.body_md.strip(),
        "created_by": user["id"], "created_by_name": user.get("name") or user.get("email"),
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.supplier_notes.insert_one(doc)
    return _strip(doc)


@router.patch("/notes/{note_id}")
async def update_note(note_id: str, body: NotePatch, user: dict = Depends(get_current_user)):
    # Non-admin authors may edit their own notes. Admins / HSEQ may edit any.
    existing = await db.supplier_notes.find_one(
        {"id": note_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Note not found")
    if user.get("role") not in WRITE_ROLES and existing.get("created_by") != user["id"]:
        raise HTTPException(403, "You can only edit your own notes")
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not payload:
        raise HTTPException(400, "No fields supplied")
    payload["updated_at"] = now_iso()
    result = await db.supplier_notes.find_one_and_update(
        {"id": note_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": payload},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    return result


@router.delete("/notes/{note_id}", status_code=204)
async def delete_note(note_id: str, user: dict = Depends(get_current_user)):
    existing = await db.supplier_notes.find_one(
        {"id": note_id, "org_id": user["org_id"], "deleted_at": None},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(404, "Note not found")
    if user.get("role") not in WRITE_ROLES and existing.get("created_by") != user["id"]:
        raise HTTPException(403, "You can only delete your own notes")
    ts = now_iso()
    await db.supplier_notes.update_one(
        {"id": note_id, "org_id": user["org_id"]},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    return None


# ────────────────────── Members ──────────────────────

class MemberIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=40)
    simpro_employee_id: Optional[str] = Field(default=None, max_length=64)
    is_primary_contact: bool = False


class MemberPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    role: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=40)
    is_primary_contact: Optional[bool] = None


@router.get("/{supplier_id}/members")
async def list_members(supplier_id: str, user: dict = Depends(get_current_user)):
    cursor = db.supplier_members.find(
        {"org_id": user["org_id"], "supplier_id": supplier_id, "deleted_at": None},
        {"_id": 0},
    ).sort([("is_primary_contact", -1), ("name", 1)])
    return await cursor.to_list(500)


@router.post("/{supplier_id}/members", status_code=201)
async def create_member(supplier_id: str, body: MemberIn, user: dict = Depends(get_current_user)):
    _require_write(user)
    payload = body.model_dump()
    # If this member is being set as primary, demote any existing primary.
    if payload.get("is_primary_contact"):
        await db.supplier_members.update_many(
            {"org_id": user["org_id"], "supplier_id": supplier_id,
             "is_primary_contact": True, "deleted_at": None},
            {"$set": {"is_primary_contact": False, "updated_at": now_iso()}},
        )
    doc = {
        "id": new_id(), "org_id": user["org_id"], "supplier_id": supplier_id,
        **payload,
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(), "deleted_at": None,
    }
    await db.supplier_members.insert_one(doc)
    return _strip(doc)


@router.patch("/members/{member_id}")
async def update_member(member_id: str, body: MemberPatch, user: dict = Depends(get_current_user)):
    _require_write(user)
    payload = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not payload:
        raise HTTPException(400, "No fields supplied")
    payload["updated_at"] = now_iso()
    if payload.get("is_primary_contact"):
        existing = await db.supplier_members.find_one(
            {"id": member_id, "org_id": user["org_id"]}, {"_id": 0, "supplier_id": 1},
        )
        if existing:
            await db.supplier_members.update_many(
                {"org_id": user["org_id"], "supplier_id": existing["supplier_id"],
                 "is_primary_contact": True, "deleted_at": None, "id": {"$ne": member_id}},
                {"$set": {"is_primary_contact": False, "updated_at": now_iso()}},
            )
    result = await db.supplier_members.find_one_and_update(
        {"id": member_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": payload},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise HTTPException(404, "Member not found")
    return result


@router.delete("/members/{member_id}", status_code=204)
async def delete_member(member_id: str, user: dict = Depends(get_current_user)):
    _require_write(user, action="delete")
    ts = now_iso()
    result = await db.supplier_members.update_one(
        {"id": member_id, "org_id": user["org_id"], "deleted_at": None},
        {"$set": {"deleted_at": ts, "updated_at": ts}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Member not found")
    return None


# ────────────────────── Panel counts ──────────────────────

@router.get("/panel-counts")
async def panel_counts(user: dict = Depends(get_current_user)):
    """Aggregate per-supplier counts of open tasks, notes, and members for the
    badge dots shown on the Suppliers table chips. Folder count is included
    as a placeholder of zero — wired up when the folders panel ships."""
    org_id = user["org_id"]

    async def _agg(coll, extra_match: dict) -> dict:
        match = {"org_id": org_id, "deleted_at": None, **extra_match}
        pipeline = [
            {"$match": match},
            {"$group": {"_id": "$supplier_id", "n": {"$sum": 1}}},
        ]
        out: dict = {}
        async for row in coll.aggregate(pipeline):
            if row["_id"]:
                out[row["_id"]] = row["n"]
        return out

    tasks = await _agg(db.supplier_tasks, {"status": {"$in": ["open", "in_progress"]}})
    notes = await _agg(db.supplier_notes, {})
    members = await _agg(db.supplier_members, {})
    # Folders count = total files across folders that are tied to this supplier.
    from document_library import supplier_folder_file_counts
    folders = await supplier_folder_file_counts(org_id)

    sids = set(tasks) | set(notes) | set(members) | set(folders)
    return {
        sid: {
            "tasks": tasks.get(sid, 0),
            "notes": notes.get(sid, 0),
            "members": members.get(sid, 0),
            "folders": folders.get(sid, 0),
        }
        for sid in sids
    }
