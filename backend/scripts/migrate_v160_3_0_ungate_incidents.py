"""v160.3.0-adjust — Un-gate incident + near-miss templates.

Per user follow-up on v160.3.0-apply: witnesses without a valid
white_card must still be able to report incidents / near-misses.
Gating those forms risks suppressing safety-critical intel from
subcontractors, visitors, or brand-new workers whose induction
paperwork hasn't been captured yet.

This migration:
  1. Snapshots `form_templates` →
     `form_templates_backup_v160_3_0_ungate_incidents`
     (idempotent — skipped if already populated).
  2. `$set: {required_certifications: []}` on templates matched by
     name. Runs only when the current value is NOT already `[]`
     (so re-run reports 0 changes).

Templates un-gated:
  - "Incident Report"
  - "Incident Report Form"
  - "Near Miss Report"

The rest of the 17 v160.3.0-apply gates stay in place — this is a
narrow, category-scoped adjustment.
"""
from __future__ import annotations

import asyncio
import json
import os

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv


SNAPSHOT = "form_templates_backup_v160_3_0_ungate_incidents"

# Exact names — matched case-sensitively against `form_templates.name`.
# Kept as a code constant (not a config file) because the un-gating
# decision is a versioned commitment, not a runtime toggle.
UNGATE_NAMES: tuple[str, ...] = (
    "Incident Report",
    "Incident Report Form",
    "Near Miss Report",
)


async def main() -> dict:
    load_dotenv("/app/backend/.env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    # Snapshot — idempotent.
    existing_snap = await db[SNAPSHOT].estimated_document_count()
    if existing_snap == 0:
        live = await db.form_templates.find({}, {"_id": 0}).to_list(None)
        if live:
            await db[SNAPSHOT].insert_many(live)
        snap_written = len(live)
    else:
        snap_written = 0

    # Only touch rows whose current gate is non-empty. This keeps
    # re-runs reporting 0 modifications (idempotent).
    touched: list[dict] = []
    for name in UNGATE_NAMES:
        cursor = db.form_templates.find(
            {"name": name, "deleted_at": None},
            {"_id": 0, "id": 1, "name": 1, "required_certifications": 1},
        )
        async for row in cursor:
            current = row.get("required_certifications") or []
            if not current:
                touched.append({"id": row["id"], "name": name,
                                "was": [], "action": "unchanged"})
                continue
            await db.form_templates.update_one(
                {"id": row["id"]},
                {"$set": {"required_certifications": []}},
            )
            touched.append({"id": row["id"], "name": name,
                            "was": current, "action": "ungated"})

    summary = {
        "snapshot_collection": SNAPSHOT,
        "snapshot_rows_written": snap_written,
        "ungated_count": sum(1 for t in touched if t["action"] == "ungated"),
        "unchanged_count": sum(1 for t in touched if t["action"] == "unchanged"),
        "touched": touched,
    }
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    asyncio.run(main())
