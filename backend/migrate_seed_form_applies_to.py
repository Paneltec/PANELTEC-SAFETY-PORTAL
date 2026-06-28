"""Phase 3.9b — Seed default `applies_to` on existing form_templates.

Idempotent. Gated by `forms.applies_to_seeded_at` in `db.migration_state` so
subsequent restarts skip the work.

Mapping rules (per user spec, "option b" for unspecified types):
  • Vehicle Pre-Use Inspection                    → kinds=[vehicle]
  • Heavy Vehicle Daily Check                     → kinds=[vehicle],
                                                    asset_types=[tipper,
                                                    vacuum_truck, service_truck,
                                                    crane_truck]
  • Plant Pre-Start Checklist (Heavy Equipment)   → kinds=[plant],
                                                    asset_types=[excavator,
                                                    generator, compactor]
  • Incident Report                               → kinds=[any]
  • Near Miss Report                              → kinds=[any]
  • Everything else                               → kinds=[], asset_types=[]
                                                    (won't appear on scans, still
                                                    callable from /app/forms)
"""
from __future__ import annotations
from datetime import datetime, timezone
from db import db

_SEED_KEY = "forms.applies_to_seeded_at"

_RULES: dict[str, dict] = {
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


async def run_migration() -> dict:
    state = await db.migration_state.find_one({"_id": _SEED_KEY})
    if state and state.get("at"):
        return {"already_done": True, "at": state["at"]}

    updated = 0
    defaulted = 0
    async for t in db.form_templates.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "applies_to": 1},
    ):
        # If a template already has explicit applies_to (e.g. via API edit),
        # respect that and skip — only seed first-time defaults.
        if t.get("applies_to"):
            continue
        rule = _RULES.get(t["name"])
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
