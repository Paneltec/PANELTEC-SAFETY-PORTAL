"""v58.13.132mz — Backfill `mobile_preview.view` alongside `users.view`.

Idempotent one-shot migration that decouples the mock-phone preview
gate from `users.view`. Any role, custom preset, or per-user override
that currently grants `users.view` gets `mobile_preview.view` seeded
too so the pre-`.132mz` behaviour (whoever could open the Permissions
Matrix page could also open the phone preview) is preserved on
first boot after the ship.

After this run:
  · `db.roles.permission_tokens[]`         gets `mobile_preview.view` where `users.view` was already present.
  · `db.permission_presets.permissions.*`  gets `mobile_preview.view = True` where `users.view` was `True`.
  · `db.user_permissions.overrides.*`      gets `mobile_preview.view = True` where `users.view` was `True`.

Marker: `db.bk_migrations[_id=v58_13_132mz_mobile_preview_seed]`.

Call once on startup from `server.py`. Safe to re-run — the function
skips rows that already carry `mobile_preview.view` (or the token /
override cell equivalent).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict

from db import db

log = logging.getLogger("paneltec.migrations.v132mz")

MARKER_ID = "v58_13_132mz_mobile_preview_seed"


async def seed_mobile_preview_permission_on_startup() -> Dict[str, Any]:
    """Backfill `mobile_preview.view` where `users.view` is already granted.

    Returns a summary dict with per-collection counts so `server.py`
    can log the outcome for the ship log.
    """
    marker = await db.bk_migrations.find_one({"_id": MARKER_ID})
    if marker:
        return {
            "already_done": True,
            "at": marker.get("at"),
            "summary": marker.get("summary"),
        }

    ts = datetime.now(timezone.utc).isoformat()
    summary: Dict[str, int] = {
        "roles_scanned": 0,
        "roles_updated": 0,
        "presets_scanned": 0,
        "presets_updated": 0,
        "user_overrides_scanned": 0,
        "user_overrides_updated": 0,
    }

    # ── 1. roles.permission_tokens[] ─────────────────────────────
    async for role in db.roles.find(
        {},
        {"_id": 0, "role_id": 1, "permission_tokens": 1, "is_active": 1, "deleted_at": 1},
    ):
        summary["roles_scanned"] += 1
        tokens = list(role.get("permission_tokens") or [])
        if "users.view" not in tokens:
            continue
        if "mobile_preview.view" in tokens:
            continue
        tokens.append("mobile_preview.view")
        await db.roles.update_one(
            {"role_id": role["role_id"]},
            {"$set": {
                "permission_tokens": sorted(set(tokens)),
                "updated_at": ts,
            }},
        )
        summary["roles_updated"] += 1

    # ── 2. permission_presets.permissions[users][view] ───────────
    async for preset in db.permission_presets.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "permissions": 1},
    ):
        summary["presets_scanned"] += 1
        perms = dict(preset.get("permissions") or {})
        users_row = perms.get("users") or {}
        if not users_row.get("view"):
            continue
        mp_row = dict(perms.get("mobile_preview") or {})
        if mp_row.get("view"):
            continue
        # Merge: keep any pre-existing cell values, force view=True.
        mp_row["view"] = True
        # Backfill the other actions with False so the matrix payload
        # renders every column (matches `_validate_permissions`).
        for a in ("open", "edit", "delete", "email", "team_view",
                 "use", "approve", "reveal_pii", "archive",
                 "reimport", "audit_view"):
            mp_row.setdefault(a, False)
        perms["mobile_preview"] = mp_row
        await db.permission_presets.update_one(
            {"id": preset["id"]},
            {"$set": {"permissions": perms, "updated_at": ts}},
        )
        summary["presets_updated"] += 1

    # ── 3. user_permissions.overrides[users][view] ───────────────
    async for up in db.user_permissions.find(
        {},
        {"_id": 0, "user_id": 1, "overrides": 1},
    ):
        summary["user_overrides_scanned"] += 1
        overrides = dict(up.get("overrides") or {})
        users_row = overrides.get("users") or {}
        if not users_row.get("view"):
            continue
        mp_row = dict(overrides.get("mobile_preview") or {})
        if mp_row.get("view"):
            continue
        mp_row["view"] = True
        overrides["mobile_preview"] = mp_row
        await db.user_permissions.update_one(
            {"user_id": up["user_id"]},
            {"$set": {"overrides": overrides, "updated_at": ts}},
        )
        summary["user_overrides_updated"] += 1

    await db.bk_migrations.insert_one({
        "_id": MARKER_ID,
        "at": ts,
        "summary": summary,
    })
    log.info(
        "[v132mz] mobile_preview.view backfill complete: %s",
        summary,
    )
    return {"already_done": False, "at": ts, "summary": summary}
