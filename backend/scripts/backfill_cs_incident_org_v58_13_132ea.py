"""v58.13.132ea — Backfill org_id on migrated CS Incidents.

Problem
-------
The `.132dz` migration copied every `cs_incident_issues` doc into
`incidents` verbatim — including the source `org_id=None` field
present on all 254 rows. `cs_incident_issues` was designed as a
shared reference library across all orgs (no org scoping), but
`incidents` is org-scoped: `/api/incidents` filters by
`org_id == user["org_id"]`, so every CS-migrated doc is invisible
to every real user.

Fix
---
Stamp the 254 rows with the Paneltec Pty Ltd `org_id`
(`3116f250-a4eb-43f3-98a5-2a3656d6cb63`) — that's the tenant that
owned the CS Incident reference library (Stephen's org, admin of
the Paneltec Civil business unit).

Idempotent: only touches `incidents` rows carrying
`migrated_from == "cs_incidents"` AND `org_id in [None, ""]`.
A second run finds zero matching rows.

Usage
-----
    python -m backend.scripts.backfill_cs_incident_org_v58_13_132ea --dry-run
    python -m backend.scripts.backfill_cs_incident_org_v58_13_132ea --commit
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve()
_BACKEND = _HERE.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(_BACKEND / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

STAMP_FIELD = "_org_backfilled_at_v58_13_132ea"
PANELTEC_ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


async def run(commit: bool) -> int:
    db = _db()
    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"v58.13.132ea org_id backfill — mode={mode}")

    q = {
        "migrated_from": "cs_incidents",
        "$or": [
            {"org_id": None},
            {"org_id": {"$exists": False}},
            {"org_id": ""},
        ],
    }
    orphaned = await db.incidents.count_documents(q)
    total_migrated = await db.incidents.count_documents(
        {"migrated_from": "cs_incidents"}
    )
    already_stamped = await db.incidents.count_documents({
        "migrated_from": "cs_incidents",
        STAMP_FIELD: {"$exists": True},
    })

    print(f"  incidents.migrated_from=cs_incidents total: {total_migrated}")
    print(f"  · orphaned (org_id missing/null/empty):    {orphaned}")
    print(f"  · already backfilled (stamp present):      {already_stamped}")

    if orphaned == 0:
        print("  Nothing to do.")
        return 0

    sample_ids = []
    async for d in db.incidents.find(q, {"_id": 0, "id": 1}).limit(5):
        sample_ids.append(d["id"])
    print(f"  sample orphan ids: {sample_ids}")

    if commit:
        r = await db.incidents.update_many(
            q,
            {"$set": {"org_id": PANELTEC_ORG_ID,
                      STAMP_FIELD: _now_iso(),
                      "org_backfill_reason": (
                          "cs_incident_issues had no org scoping; the "
                          "Paneltec Civil business unit ran the CS "
                          "Incident reference library. Stephen's tenant "
                          "(Paneltec Pty Ltd) is the operational owner.")}}
        )
        print(f"  matched={r.matched_count}, modified={r.modified_count}")
    else:
        print(f"  DRY-RUN — would stamp {orphaned} rows with "
              f"org_id={PANELTEC_ORG_ID}")

    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    commit = bool(args.commit) and not args.dry_run
    return asyncio.run(run(commit))


if __name__ == "__main__":
    sys.exit(main())
