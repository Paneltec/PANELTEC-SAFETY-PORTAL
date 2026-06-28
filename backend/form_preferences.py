"""Phase 3.9 — Per-user form preferences.

Each user has a single `user_form_preferences` document that whitelists which
form templates they personally use. The list is applied on top of (not in place
of) the asset-type filter in `/api/scan/{token}/forms` and on the main `/app/
forms` page list.

Sentinels & defaults:
  • A missing doc → seeded with *all* org templates enabled on first GET so the
    UI never shows a blank state for fresh accounts.
  • `enabled_template_ids: []` (explicit empty) → treated the same as "all
    enabled" so a worker can't accidentally lock themselves out by clearing
    every box.

Per-device overrides live in `localStorage.paneltec.form_prefs_device` on the
client and are never stored server-side. The backend therefore only manages
the server-side ("all my devices") record here.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db


router = APIRouter(prefix="/users", tags=["form-preferences"])

# Roles that can read or edit *another* user's preferences (training aid).
_ADMIN_READ_ROLES = {"admin", "manager", "hseq_lead"}
_ADMIN_WRITE_ROLES = {"admin"}


class FormPreferencesIn(BaseModel):
    enabled_template_ids: list[str] = Field(default_factory=list)
    # When true the caller is signalling "save on this device only" — the
    # server still stores the previous record untouched. We accept and
    # ignore this flag (the client routes around the API entirely in that
    # case) so the endpoint stays a single source of truth.
    device_only: bool = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _all_template_ids(org_id: str) -> list[str]:
    """Every active template visible to the org — used to seed defaults."""
    out: list[str] = []
    async for t in db.form_templates.find(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1},
    ):
        out.append(t["id"])
    return out


async def _load_or_seed(user: dict) -> dict:
    """Return the user's preferences doc, creating a 'all enabled' record on
    first access so subsequent reads are stable."""
    existing = await db.user_form_preferences.find_one(
        {"user_id": user["id"], "org_id": user["org_id"]},
        {"_id": 0},
    )
    if existing:
        return existing
    seed = {
        "id": str(uuid4()),
        "user_id": user["id"],
        "org_id": user["org_id"],
        "enabled_template_ids": await _all_template_ids(user["org_id"]),
        "last_updated_at": _now_iso(),
        "last_device": "all",
        "seeded": True,
    }
    await db.user_form_preferences.insert_one(seed)
    seed.pop("_id", None)
    return seed


async def get_effective_enabled_ids(user: dict) -> tuple[list[str], bool]:
    """Helper used by other modules (scan-forms, /app/forms list). Returns
    (enabled_ids, applied) where `applied=True` means the user has an
    explicit non-empty whitelist that should be intersected with caller's
    master list. Empty list → no filter."""
    doc = await db.user_form_preferences.find_one(
        {"user_id": user["id"], "org_id": user["org_id"]},
        {"_id": 0, "enabled_template_ids": 1},
    )
    ids = (doc or {}).get("enabled_template_ids") or []
    return ids, bool(ids)


# ────────────────── self ──────────────────

@router.get("/me/form-preferences")
async def get_my_form_preferences(user: dict = Depends(get_current_user)):
    return await _load_or_seed(user)


@router.put("/me/form-preferences")
async def update_my_form_preferences(
    body: FormPreferencesIn, user: dict = Depends(get_current_user),
):
    # `device_only=true` means "do NOT touch the server record" — the client
    # is about to write localStorage instead. Return the current server doc
    # so the UI can keep its state in sync.
    if body.device_only:
        return await _load_or_seed(user)
    doc = {
        "enabled_template_ids": list(dict.fromkeys(body.enabled_template_ids)),
        "last_updated_at": _now_iso(),
        "last_device": "all",
        "seeded": False,
    }
    await db.user_form_preferences.update_one(
        {"user_id": user["id"], "org_id": user["org_id"]},
        {"$set": doc, "$setOnInsert": {
            "id": str(uuid4()),
            "user_id": user["id"], "org_id": user["org_id"],
        }},
        upsert=True,
    )
    return await db.user_form_preferences.find_one(
        {"user_id": user["id"], "org_id": user["org_id"]},
        {"_id": 0},
    )


# ────────────────── admin / manager view of another worker ──────────────────

@router.get("/{user_id}/form-preferences")
async def get_user_form_preferences(
    user_id: str = Path(...), user: dict = Depends(get_current_user),
):
    if user_id == user["id"]:
        return await _load_or_seed(user)
    if user.get("role") not in _ADMIN_READ_ROLES:
        raise HTTPException(403, "Not authorised")
    target = await db.users.find_one(
        {"id": user_id, "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "org_id": 1, "name": 1, "email": 1, "role": 1},
    )
    if not target:
        raise HTTPException(404, "Worker not found")
    # Seed defaults for the target on first admin lookup so the UI never
    # shows a blank state for never-logged-in seats.
    return await _load_or_seed(target)


@router.put("/{user_id}/form-preferences")
async def update_user_form_preferences(
    body: FormPreferencesIn, user_id: str = Path(...),
    user: dict = Depends(get_current_user),
):
    if user_id == user["id"]:
        return await update_my_form_preferences(body, user)
    if user.get("role") not in _ADMIN_WRITE_ROLES:
        raise HTTPException(403, "Not authorised")
    target = await db.users.find_one(
        {"id": user_id, "org_id": user["org_id"]},
        {"_id": 0, "id": 1, "org_id": 1},
    )
    if not target:
        raise HTTPException(404, "Worker not found")
    doc = {
        "enabled_template_ids": list(dict.fromkeys(body.enabled_template_ids)),
        "last_updated_at": _now_iso(),
        "last_device": "all",
        "seeded": False,
    }
    await db.user_form_preferences.update_one(
        {"user_id": user_id, "org_id": user["org_id"]},
        {"$set": doc, "$setOnInsert": {
            "id": str(uuid4()),
            "user_id": user_id, "org_id": user["org_id"],
        }},
        upsert=True,
    )
    return await db.user_form_preferences.find_one(
        {"user_id": user_id, "org_id": user["org_id"]},
        {"_id": 0},
    )
