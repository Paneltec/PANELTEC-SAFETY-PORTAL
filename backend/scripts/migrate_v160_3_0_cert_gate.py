"""v160.3.0 — Qualification gating template schema migration.

The gate lives entirely on `form_templates.required_certifications`
(list of cert-kind slugs — see `cert_kinds.py`). Existing rows never
had this field. Fresh rows created via `POST /api/forms/templates`
already receive an empty list, so this migration is only meaningful
for the pre-existing 27+ templates in the demo org (and every other
org's stock templates).

It does two things, in this order:

1. Snapshot every affected template into
   `form_templates_backup_v160_3_0` before mutating anything.
   Idempotent on re-run (skips if snapshot already populated).
2. `$set` `required_certifications: []` on every template that
   doesn't already have the key set (regardless of category — no
   category is auto-gated). This is a *shape* migration only; NO
   template is automatically qualification-gated by running this
   script. Actual gate configuration is a human decision — see
   `/app/memory/v160_3_0_cert_mapping_proposal.md` for the
   proposed slugs per template.

Re-running is a no-op — the second `$set` filter narrows to rows
that STILL lack the field.

Usage
-----
    cd /app/backend && python3 -m scripts.migrate_v160_3_0_cert_gate
"""
from __future__ import annotations

import asyncio
import json
import os

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv


SNAPSHOT = "form_templates_backup_v160_3_0"


async def main() -> dict:
    load_dotenv("/app/backend/.env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    snap_existing = await db[SNAPSHOT].estimated_document_count()
    if snap_existing == 0:
        live = await db.form_templates.find({}, {"_id": 0}).to_list(None)
        if live:
            await db[SNAPSHOT].insert_many(live)
        snap_written = len(live)
    else:
        snap_written = 0

    # Idempotent shape write — only rows that STILL lack the field.
    res = await db.form_templates.update_many(
        {"required_certifications": {"$exists": False}},
        {"$set": {"required_certifications": []}},
    )

    summary = {
        "snapshot_collection": SNAPSHOT,
        "snapshot_rows_written": snap_written,
        "templates_shape_migrated": res.modified_count,
    }
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    asyncio.run(main())
