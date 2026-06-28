"""Phase 3.9b — Seed default `applies_to` on existing form_templates and
backfill modern category keys for the 5 named templates so the scan-page
`recommended` badge logic lights up correctly.

Both steps are idempotent and individually gated:
  • applies_to seeding   → forms.applies_to_seeded_at
  • category backfill    → forms.categories_backfilled_at
"""
from __future__ import annotations
from datetime import datetime, timezone
from db import db

_SEED_KEY = "forms.applies_to_seeded_at"
_CAT_KEY  = "forms.categories_backfilled_at"
# Phase 3.9c — add empty worker_ids/roles/companies arrays to existing
# applies_to docs so the new pydantic models don't have to .get(...) every
# field. Idempotent — re-running is a no-op.
_TARGETS_KEY = "forms.applies_to_targets_seeded_at"

_APPLIES_TO_RULES: dict[str, dict] = {
    "Vehicle Pre-Use Inspection":
        {"kinds": ["vehicle"], "asset_types": []},
    "Heavy Vehicle Daily Check":
        {"kinds": ["vehicle"],
         "asset_types": ["tipper", "vacuum_truck", "service_truck", "crane_truck"]},
    "Plant Pre-Start Checklist (Heavy Equipment)":
        {"kinds": ["plant"],
         "asset_types": ["excavator", "generator", "compactor"]},
    "Plant Pre-Start Checklist":
        {"kinds": ["plant"], "asset_types": []},
    "Incident Report":  {"kinds": ["any"], "asset_types": []},
    "Near Miss Report": {"kinds": ["any"], "asset_types": []},
}

# Modern category keys aligned with the scan_forms recommended-badge rule.
_CATEGORY_RULES: dict[str, str] = {
    "Vehicle Pre-Use Inspection":                "pre_use",
    "Heavy Vehicle Daily Check":                 "daily_check",
    "Plant Pre-Start Checklist (Heavy Equipment)": "plant_pre_start",
    "Plant Pre-Start Checklist":                 "plant_pre_start",
    "Incident Report":                           "incident",
    "Near Miss Report":                          "near_miss",
}


async def _seed_applies_to() -> dict:
    state = await db.migration_state.find_one({"_id": _SEED_KEY})
    if state and state.get("at"):
        return {"already_done": True, "at": state["at"]}
    updated = 0
    defaulted = 0
    async for t in db.form_templates.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "applies_to": 1},
    ):
        if t.get("applies_to"):
            continue
        rule = _APPLIES_TO_RULES.get(t["name"])
        if rule:
            applies_to = {"kinds": rule["kinds"], "asset_types": rule["asset_types"]}
            updated += 1
        else:
            applies_to = {"kinds": [], "asset_types": []}
            defaulted += 1
        await db.form_templates.update_one(
            {"id": t["id"]},
            {"$set": {"applies_to": applies_to}},
        )
    now = datetime.now(timezone.utc).isoformat()
    await db.migration_state.update_one(
        {"_id": _SEED_KEY},
        {"$set": {"at": now, "updated_named": updated, "defaulted_blank": defaulted}},
        upsert=True,
    )
    return {"already_done": False, "at": now, "named": updated, "blank": defaulted}


async def _backfill_categories() -> dict:
    state = await db.migration_state.find_one({"_id": _CAT_KEY})
    if state and state.get("at"):
        return {"already_done": True, "at": state["at"]}
    updated = 0
    for name, cat in _CATEGORY_RULES.items():
        res = await db.form_templates.update_one(
            {"name": name, "deleted_at": None},
            {"$set": {"category": cat}},
        )
        if res.matched_count:
            updated += 1
    now = datetime.now(timezone.utc).isoformat()
    await db.migration_state.update_one(
        {"_id": _CAT_KEY},
        {"$set": {"at": now, "renamed": updated}},
        upsert=True,
    )
    return {"already_done": False, "at": now, "renamed": updated}


async def _seed_target_arrays() -> dict:
    """Phase 3.9c — backfill `worker_ids/roles/companies = []` on every
    `applies_to` document that's missing them. Safe to run repeatedly."""
    state = await db.migration_state.find_one({"_id": _TARGETS_KEY})
    if state and state.get("at"):
        return {"already_done": True, "at": state["at"]}
    updated = 0
    async for t in db.form_templates.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "applies_to": 1},
    ):
        a = t.get("applies_to") or {}
        changed = False
        for k in ("worker_ids", "roles", "companies"):
            if k not in a:
                a[k] = []
                changed = True
        if changed:
            a.setdefault("kinds", [])
            a.setdefault("asset_types", [])
            await db.form_templates.update_one(
                {"id": t["id"]}, {"$set": {"applies_to": a}},
            )
            updated += 1
    now = datetime.now(timezone.utc).isoformat()
    await db.migration_state.update_one(
        {"_id": _TARGETS_KEY},
        {"$set": {"at": now, "updated": updated}}, upsert=True,
    )
    return {"already_done": False, "at": now, "updated": updated}


async def run_migration() -> dict:
    a = await _seed_applies_to()
    b = await _backfill_categories()
    c = await _seed_target_arrays()
    return {"applies_to": a, "categories": b, "targets": c}
