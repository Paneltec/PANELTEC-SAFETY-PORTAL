"""v160.3.8.1 — Settings sub-nav layout endpoints.

Persists the per-org left-sidebar Settings-section layout in the
``settings_nav_layout`` collection. Any authenticated user can GET
(so their sidebar renders); only admin / HSEQ-lead can PUT (so field
workers can't accidentally reorganise the admin surfaces for the
whole org).

Layout schema (single doc per org, upserted on PUT):

    {
      org_id:     "...",
      version:    1,
      updated_at: "2026-07-14T…",
      updated_by: "<user_id>",
      layout:     [ {type:"item", key:"..."} | {type:"folder", id:"...", label:"...", children:[...]} ]
    }

Validation on PUT rejects unknown keys, duplicate keys, and duplicate
folder ids so a rogue payload can never poison the frontend.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from db import db
from models import now_iso
from settings_nav_registry import (
    SETTINGS_NAV_KEYS, SETTINGS_NAV_ITEMS, default_layout,
)

router = APIRouter(prefix="/settings", tags=["settings-nav"])

WRITE_ROLES = {"admin", "hseq_lead"}


def _collect_keys(layout: list[dict]) -> set[str]:
    """Flatten every `type:item` key across root + folders."""
    out: set[str] = set()
    for n in layout or []:
        if n.get("type") == "item" and n.get("key"):
            out.add(n["key"])
        elif n.get("type") == "folder":
            for c in n.get("children") or []:
                if c.get("type") == "item" and c.get("key"):
                    out.add(c["key"])
    return out


def _reconcile(layout: list[dict]) -> tuple[list[dict], list[str]]:
    """v160.3.8.4 — Ensure every registry key appears in `layout`.

    Missing keys are APPENDED to the root in registry order so the
    operator's existing arrangement is never rewritten. Returns
    ``(reconciled_layout, appended_keys)``; ``appended_keys`` is empty
    when the doc was already complete.
    """
    have = _collect_keys(layout)
    missing = [it["key"] for it in SETTINGS_NAV_ITEMS if it["key"] not in have]
    if not missing:
        return layout, []
    fixed = list(layout) + [{"type": "item", "key": k} for k in missing]
    return fixed, missing


class LayoutItem(BaseModel):
    type: str
    key: Optional[str] = None
    id: Optional[str] = None
    label: Optional[str] = None
    children: Optional[list["LayoutItem"]] = None


LayoutItem.model_rebuild()


class NavLayoutIn(BaseModel):
    layout: list[LayoutItem] = Field(default_factory=list)


def _validate_layout(layout: list[dict[str, Any]]) -> None:
    """Walk the tree and fail loudly on any structural or key error.

    Errors surface as HTTP 400 with a `detail` string that names the
    offending key or id — so the frontend can toast it directly.

    v160.3.8.4 — Also rejects a layout that OMITS any registry key so
    a partial payload can never drop a nav item (this closed the
    "Integrations disappeared" regression). Callers that legitimately
    want to hide keys should do so client-side via `adminOnly` /
    `resource` gates, not by removing them from the layout.
    """
    seen_keys: set[str] = set()
    seen_folder_ids: set[str] = set()

    def _walk(nodes: list[dict[str, Any]], depth: int = 0) -> None:
        if depth > 2:
            # Two levels max (root + folder). Nested folders would
            # complicate the UI and aren't in scope.
            raise HTTPException(400, "Nested folders are not allowed.")
        for n in nodes:
            t = n.get("type")
            if t == "item":
                k = n.get("key")
                if not k or k not in SETTINGS_NAV_KEYS:
                    raise HTTPException(400, f"Unknown nav key: {k!r}")
                if k in seen_keys:
                    raise HTTPException(400, f"Duplicate nav key: {k!r}")
                seen_keys.add(k)
            elif t == "folder":
                fid = n.get("id")
                if not fid or not isinstance(fid, str):
                    raise HTTPException(400, "Folder missing string id")
                if fid in seen_folder_ids:
                    raise HTTPException(400, f"Duplicate folder id: {fid!r}")
                seen_folder_ids.add(fid)
                children = n.get("children") or []
                _walk(children, depth + 1)
            else:
                raise HTTPException(400, f"Unknown node type: {t!r}")

    _walk(layout)

    missing = [k for k in SETTINGS_NAV_KEYS if k not in seen_keys]
    if missing:
        # Preserve registry order in the error message so the caller
        # can see WHICH key is gone at a glance.
        first = next(it["key"] for it in SETTINGS_NAV_ITEMS if it["key"] in missing)
        raise HTTPException(400, f"Missing nav key: {first!r}")


def _hash_layout(layout: list[dict[str, Any]]) -> str:
    """SHA1 of the layout — cheap identity check for audit-log
    diffing. We store the *hash* on the audit row so a future auditor
    can prove "the layout Alice PUT is the layout that Alice
    approved" without spelunking a giant blob.
    """
    return hashlib.sha1(
        json.dumps(layout, sort_keys=True, separators=(",", ":")).encode("utf-8"),
    ).hexdigest()


@router.get("/nav-layout")
async def get_nav_layout(user: dict = Depends(get_current_user)):
    """Return this org's persisted layout or the fresh-seed default.

    v160.3.8.4 — Reconciles the persisted layout against the current
    registry: if a doc predates a nav item added in a later release
    (or an admin somehow PUT a partial layout), the missing keys are
    APPENDED to the root and the doc is upserted so subsequent reads
    are clean. The operator's existing ordering is never rewritten.

    Also returns the full registry so a stale/legacy client doesn't
    have to hard-code icon names or bail on an unknown key.
    """
    doc = await db.settings_nav_layout.find_one(
        {"org_id": user["org_id"]}, {"_id": 0},
    )
    seeded = doc is None
    if seeded:
        layout = default_layout()
    else:
        layout = doc.get("layout") or []
        reconciled, appended = _reconcile(layout)
        if appended:
            ts = now_iso()
            next_version = int((doc or {}).get("version") or 0) + 1
            await db.settings_nav_layout.update_one(
                {"org_id": user["org_id"]},
                {"$set": {
                    "layout":     reconciled,
                    "version":    next_version,
                    "updated_at": ts,
                    "updated_by": "system_migration",
                }},
                upsert=True,
            )
            await db.audit_logs.insert_one({
                "org_id":     user["org_id"],
                "actor_id":   "system_migration",
                "actor_name": "settings_nav_reconciler",
                "action":     "settings_nav.reconcile",
                "at":         ts,
                "appended":   appended,
                "version":    next_version,
            })
            layout = reconciled

    return {
        "layout":  layout,
        "version": (doc or {}).get("version", 0) if not seeded else 0,
        "updated_at": (doc or {}).get("updated_at"),
        "seeded":  seeded,
        "registry": SETTINGS_NAV_ITEMS,
    }


@router.put("/nav-layout")
async def put_nav_layout(
    body: NavLayoutIn,
    user: dict = Depends(get_current_user),
):
    if (user.get("role") or "").lower() not in WRITE_ROLES:
        raise HTTPException(403, "Only admin / HSEQ lead can rearrange the Settings nav.")
    layout_raw = [n.model_dump(exclude_none=True) for n in body.layout]
    _validate_layout(layout_raw)
    ts = now_iso()

    before = await db.settings_nav_layout.find_one(
        {"org_id": user["org_id"]}, {"_id": 0, "layout": 1, "version": 1},
    )
    before_hash = _hash_layout(before["layout"]) if before and before.get("layout") else None
    after_hash = _hash_layout(layout_raw)
    next_version = int((before or {}).get("version") or 0) + 1

    await db.settings_nav_layout.update_one(
        {"org_id": user["org_id"]},
        {"$set": {
            "org_id":     user["org_id"],
            "layout":     layout_raw,
            "version":    next_version,
            "updated_at": ts,
            "updated_by": user.get("id"),
        }},
        upsert=True,
    )
    # Only audit an actual change — a no-op PUT (identical layout)
    # shouldn't pollute the log.
    if before_hash != after_hash:
        await db.audit_logs.insert_one({
            "org_id":     user["org_id"],
            "actor_id":   user.get("id"),
            "actor_name": user.get("name") or user.get("email"),
            "action":     "settings_nav.update",
            "at":         ts,
            "before_hash": before_hash,
            "after_hash":  after_hash,
            "version":    next_version,
        })
    return {"ok": True, "version": next_version, "updated_at": ts}


# ────────────────────── Startup migration ──────────────────────
# v160.3.8.4 — Idempotent one-shot pass over every org's saved
# `settings_nav_layout`. Any doc that predates a registry entry (or
# that got persisted from a partial payload) gets the missing keys
# appended to root. Running it a second time is a no-op — the loop
# short-circuits on `_reconcile()` returning an empty diff.
async def reconcile_all_orgs() -> dict:
    """Reconcile every persisted settings-nav layout against the
    registry. Returns a summary dict for the caller's audit log.
    """
    ts = now_iso()
    inspected = 0
    reconciled = 0
    per_org: list[dict[str, Any]] = []
    async for doc in db.settings_nav_layout.find({}, {"_id": 0, "org_id": 1, "layout": 1, "version": 1}):
        inspected += 1
        layout = doc.get("layout") or []
        fixed, appended = _reconcile(layout)
        if not appended:
            continue
        next_version = int(doc.get("version") or 0) + 1
        await db.settings_nav_layout.update_one(
            {"org_id": doc["org_id"]},
            {"$set": {
                "layout":     fixed,
                "version":    next_version,
                "updated_at": ts,
                "updated_by": "system_migration",
            }},
        )
        await db.audit_logs.insert_one({
            "org_id":     doc["org_id"],
            "actor_id":   "system_migration",
            "actor_name": "settings_nav_reconciler_startup",
            "action":     "settings_nav.reconcile",
            "at":         ts,
            "appended":   appended,
            "version":    next_version,
        })
        reconciled += 1
        per_org.append({"org_id": doc["org_id"], "appended": appended})
    return {"inspected": inspected, "reconciled": reconciled, "per_org": per_org}
