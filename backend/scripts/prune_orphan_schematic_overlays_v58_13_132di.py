"""v58.13.132di — Soft-delete orphaned Program Schematic overlays.

The FE registry in `frontend/src/lib/programSchematic.js` (canonical
source of cluster keys) shipped `.132dd` with a rebaked mobile
sub-cluster taxonomy: 10 fresh keys prefixed `mobile_*`. The old
`.132cu` cluster keys (`mobile`, `mobile_home_admin`,
`mobile_home_paneltec`, `mobile_home_viatec`, `mobile_modals`) were
retired. Any overlay row in `db.program_schematic_overlays` still
pointing at one of those retired keys is an orphan — it can never
match a rendered tile and therefore does nothing at runtime.

Behaviour:
  · Query all active overlays (`deleted_at is None`) whose
    `cluster_key` is in the RETIRED_CLUSTER_KEYS set.
  · Soft-delete each by stamping `deleted_at` + audit fields. Hard
    deletes are avoided so the history is preserved for auditability.

Idempotent: safe to run 100 times. The second run finds zero live
orphans and prints "0 pruned".

Usage:
    python -m scripts.prune_orphan_schematic_overlays_v58_13_132di

Exit code is always 0 unless MONGO_URL is unset.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

# Retired cluster keys — these no longer exist in the FE registry
# after the `.132dd` mobile sub-cluster rebake. Any overlay row
# pointing here is orphaned and should be soft-deleted.
RETIRED_CLUSTER_KEYS: frozenset[str] = frozenset({
    "mobile",
    "mobile_home_admin",
    "mobile_home_paneltec",
    "mobile_home_viatec",
    "mobile_modals",
})

# Sentinel actor id stamped on `updated_by` so the audit trail makes
# it clear this row was pruned by the .132di migration, not by a
# human admin.
AUDIT_ACTOR_ID = "migration:v58.13.132di"


async def run() -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL / DB_NAME env vars required", file=sys.stderr)
        return 1

    db = AsyncIOMotorClient(mongo_url)[db_name]
    now = datetime.now(timezone.utc).isoformat()

    # Snapshot the orphans first so we can log every id we're about
    # to prune. This makes the ship-memo audit trivial.
    orphans: list[dict] = []
    async for d in db.program_schematic_overlays.find(
        {"deleted_at": None,
         "cluster_key": {"$in": sorted(RETIRED_CLUSTER_KEYS)}},
        {"_id": 0, "id": 1, "cluster_key": 1, "node_key": 1,
         "org_id": 1, "status": 1, "custom_label": 1, "created_at": 1},
    ):
        orphans.append(d)

    print(f"Found {len(orphans)} orphaned overlay row(s):")
    for o in orphans:
        print(
            f"  · id={o.get('id')} · org={o.get('org_id')}"
            f" · cluster={o.get('cluster_key')}"
            f" · node={o.get('node_key')}"
            f" · status={o.get('status')}"
            f" · label={o.get('custom_label') or '-'}"
            f" · created={o.get('created_at')}"
        )

    if not orphans:
        print("Nothing to prune. Exiting cleanly (idempotent).")
        return 0

    ids = [o["id"] for o in orphans]
    result = await db.program_schematic_overlays.update_many(
        {"id": {"$in": ids}, "deleted_at": None},
        {"$set": {
            "deleted_at": now,
            "updated_at": now,
            "updated_by": AUDIT_ACTOR_ID,
        }},
    )
    print(
        f"Pruned {result.modified_count} row(s)"
        f" (matched={result.matched_count})."
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
