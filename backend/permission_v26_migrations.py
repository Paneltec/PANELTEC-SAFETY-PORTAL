"""v160.3.9.26 — Phase 2 migrations for the users & permissions redesign.

Idempotent. Every migration writes a row to `_migrations` under a stable
`key` so re-running the block is a no-op. On startup, `run_all()` is
called from `server.py` — safe on every boot.

Migrations landed here (in order):
  1. `v26-p2-add-approve-action`      — back-fill `approve: False` on
                                        every action-dict inside every
                                        `permission_presets` doc and
                                        every `user_permissions.overrides`
                                        doc.
  2. `v26-p2-add-new-resources`       — for the four new resources
                                        (`reference_library`,
                                        `notifications`, `help`,
                                        `sites`), insert an all-False
                                        action-dict into every stored
                                        matrix so the shape matches the
                                        new PERMISSIONS_SCHEMA. Purely
                                        cosmetic — `effective_for` falls
                                        back to ROLE_DEFAULTS (False)
                                        anyway; this is for hygiene when
                                        the UI reads a preset.
  3. `v26-p2-backfill-users-role-id`  — set `role_id`, `is_archived`,
                                        `activation_status` on every
                                        existing user per decision #2
                                        migration table.
"""
from __future__ import annotations

from typing import Any, Dict, List

from db import db
from models import now_iso
from permissions import ACTIONS, PERMISSIONS_SCHEMA, RESOURCES


# Legacy `users.role` → new `role_id`. `auditor` is deliberately left
# unmapped (per doc 04) — auditor users keep their legacy role for now.
LEGACY_ROLE_TO_ROLE_ID = {
    "admin":      "admin",
    "hseq_lead":  "hseq_manager",
    "supervisor": "responsible_manager",
    "worker":     "general_user",
}


async def _already_ran(key: str) -> bool:
    doc = await db["_migrations"].find_one({"key": key})
    return doc is not None


async def _mark_ran(key: str, result: Dict[str, Any]) -> None:
    await db["_migrations"].update_one(
        {"key": key},
        {"$set": {"key": key, "ran_at": now_iso(), "result": result}},
        upsert=True,
    )


# ─────────────────────────────────────────────────────────────
# Migration 1 — Back-fill `approve: False` on stored matrices
# ─────────────────────────────────────────────────────────────

async def m_add_approve_action() -> Dict[str, Any]:
    key = "v26-p2-add-approve-action"
    if await _already_ran(key):
        return {"skipped": True, "key": key}
    presets_touched = 0
    async for doc in db.permission_presets.find({}, {"_id": 0}):
        perms = doc.get("permissions") or {}
        changed = False
        for r, actions in list(perms.items()):
            if isinstance(actions, dict) and "approve" not in actions:
                actions["approve"] = False
                changed = True
        if changed:
            await db.permission_presets.update_one(
                {"id": doc["id"]},
                {"$set": {"permissions": perms, "updated_at": now_iso()}},
            )
            presets_touched += 1

    overrides_touched = 0
    async for doc in db.user_permissions.find({}, {"_id": 0}):
        ov = doc.get("overrides") or {}
        changed = False
        for r, actions in list(ov.items()):
            if isinstance(actions, dict) and "approve" not in actions:
                actions["approve"] = False
                changed = True
        if changed:
            await db.user_permissions.update_one(
                {"user_id": doc["user_id"]},
                {"$set": {"overrides": ov, "updated_at": now_iso()}},
            )
            overrides_touched += 1

    result = {
        "presets_touched": presets_touched,
        "overrides_touched": overrides_touched,
    }
    await _mark_ran(key, result)
    return {"key": key, **result}


# ─────────────────────────────────────────────────────────────
# Migration 2 — Add the four new resources to stored matrices
# ─────────────────────────────────────────────────────────────

_NEW_RESOURCES = ["reference_library", "notifications", "help", "sites"]


def _empty_action_dict() -> Dict[str, bool]:
    return {a: False for a in ACTIONS}


async def m_add_new_resources() -> Dict[str, Any]:
    key = "v26-p2-add-new-resources"
    if await _already_ran(key):
        return {"skipped": True, "key": key}

    presets_touched = 0
    async for doc in db.permission_presets.find({}, {"_id": 0}):
        perms = doc.get("permissions") or {}
        changed = False
        for r in _NEW_RESOURCES:
            if r not in perms:
                perms[r] = _empty_action_dict()
                changed = True
        if changed:
            await db.permission_presets.update_one(
                {"id": doc["id"]},
                {"$set": {"permissions": perms, "updated_at": now_iso()}},
            )
            presets_touched += 1

    overrides_touched = 0
    # user_permissions overrides are SPARSE — we do not force new resources
    # in here, because the presence of an empty action-dict would be
    # meaningfully different from "no override" (would block role default
    # from kicking in — though defaults are False anyway for these). Leave
    # untouched. Recorded here for the audit trail.

    result = {
        "presets_touched": presets_touched,
        "overrides_touched": overrides_touched,
        "new_resources": _NEW_RESOURCES,
    }
    await _mark_ran(key, result)
    return {"key": key, **result}


# ─────────────────────────────────────────────────────────────
# Migration 3 — Back-fill users.role_id + is_archived + activation_status
# ─────────────────────────────────────────────────────────────

async def m_backfill_users_role_id() -> Dict[str, Any]:
    key = "v26-p2-backfill-users-role-id"
    if await _already_ran(key):
        return {"skipped": True, "key": key}

    updated = 0
    audit_entries: list[dict] = []
    ts = now_iso()
    async for u in db.users.find({}, {"_id": 0, "id": 1, "role": 1,
                                       "role_id": 1, "is_archived": 1,
                                       "activation_status": 1, "status": 1}):
        set_fields: Dict[str, Any] = {}
        legacy_role = u.get("role")
        if not u.get("role_id") and legacy_role in LEGACY_ROLE_TO_ROLE_ID:
            set_fields["role_id"] = LEGACY_ROLE_TO_ROLE_ID[legacy_role]
        if "is_archived" not in u:
            set_fields["is_archived"] = False
        if "activation_status" not in u:
            # Existing users are treated as active unless their `status`
            # says otherwise. This maps legacy `status: 'disabled'` onto
            # `activation_status: 'suspended'` so the new field is a
            # complete replacement over time.
            if (u.get("status") or "active") == "disabled":
                set_fields["activation_status"] = "suspended"
            else:
                set_fields["activation_status"] = "active"
        if set_fields:
            await db.users.update_one({"id": u["id"]}, {"$set": set_fields})
            updated += 1
            audit_entries.append({
                "user_id": u["id"],
                "change_type": "v26_p2_backfill",
                "before": {
                    "role": legacy_role,
                    "role_id": u.get("role_id"),
                    "is_archived": u.get("is_archived"),
                    "activation_status": u.get("activation_status"),
                },
                "after": set_fields,
                "at": ts,
                "actor_user_id": "system.v26.migration",
            })

    if audit_entries:
        await db["_users_audit"].insert_many(audit_entries)

    result = {"users_updated": updated, "audit_entries": len(audit_entries)}
    await _mark_ran(key, result)
    return {"key": key, **result}


# ─────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────

async def run_all() -> List[Dict[str, Any]]:
    """Run every v26 migration in order. Safe on every boot."""
    out: List[Dict[str, Any]] = []
    out.append(await m_add_approve_action())
    out.append(await m_add_new_resources())
    out.append(await m_backfill_users_role_id())
    return out
