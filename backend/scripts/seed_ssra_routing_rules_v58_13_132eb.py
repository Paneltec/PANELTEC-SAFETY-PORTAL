"""v58.13.132eb — Seed routing rules for all SSRA template variants.

Background
----------
The `.132dz` ship seeded a single routing rule for the Construction &
Excavation SSRA template (`dc28f66a-…`). Post-ship investigation
during `.132eb` revealed the `form_templates` collection carries
**12 SSRA templates** in total — 6 copies of "Construction & Excavation
SSRA" and 6 copies of "Viatec Traffic Solutions SSRA" (each re-import
of the source PDF minted a new row rather than upserting the existing
one). Only ONE of the 12 rows was covered by the `.132dz` rule.

This script seeds a routing rule for every SSRA template row (both
brand names), keyed by `template_id`, mapping to
`destination_category="risk_assessment"`. Idempotent — a re-run
finds every row already present and exits with no writes.

Usage
-----
    python -m backend.scripts.seed_ssra_routing_rules_v58_13_132eb --dry-run
    python -m backend.scripts.seed_ssra_routing_rules_v58_13_132eb --commit
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve()
_BACKEND = _HERE.parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(_BACKEND / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db():
    return AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


# v58.13.132eb — Match every SSRA variant regardless of business unit.
# Both "Construction & Excavation SSRA" and "Viatec Traffic Solutions
# SSRA" carry `category=hazard` on the template row itself; the
# routing rule flips them to `risk_assessment` at write time.
SSRA_TEMPLATE_NAME_RE = re.compile(r"SSRA", re.IGNORECASE)


async def run(commit: bool) -> int:
    db = _db()
    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"v58.13.132eb SSRA routing rules seed — mode={mode}")

    # Match every SSRA template that isn't soft-deleted.
    q = {"name": {"$regex": "SSRA", "$options": "i"},
         "$or": [{"deleted_at": None}, {"deleted_at": {"$exists": False}}]}
    templates = await db.form_templates.find(q, {"_id": 0, "id": 1,
                                                  "name": 1}).to_list(length=None)
    print(f"  matched {len(templates)} SSRA template(s):")
    for t in templates:
        print(f"    · id={t.get('id')}  name={t.get('name')!r}")

    seeded = 0
    updated = 0
    already = 0
    for t in templates:
        tid = t.get("id")
        name = t.get("name") or ""
        if not tid:
            continue
        existing = await db.form_routing_rules.find_one({"template_id": tid})
        if existing:
            if (existing.get("destination_category") == "risk_assessment"
                    and existing.get("active") is True
                    and existing.get("template_name_hint") == name):
                already += 1
                continue
            if commit:
                await db.form_routing_rules.update_one(
                    {"template_id": tid},
                    {"$set": {
                        "destination_category": "risk_assessment",
                        "template_name_hint": name,
                        "active": True,
                        "reason": ("v58.13.132eb — SSRA templates route to Risk "
                                   "Assessments regardless of business unit "
                                   "(covers 12 template variants: 6 Construction "
                                   "& Excavation + 6 Viatec Traffic Solutions)."),
                        "updated_at": _now_iso(),
                    }},
                )
            updated += 1
        else:
            if commit:
                await db.form_routing_rules.insert_one({
                    "id": str(uuid.uuid4()),
                    "template_id": tid,
                    "destination_category": "risk_assessment",
                    "template_name_hint": name,
                    "reason": ("v58.13.132eb — SSRA templates route to Risk "
                               "Assessments regardless of business unit "
                               "(covers 12 template variants: 6 Construction "
                               "& Excavation + 6 Viatec Traffic Solutions)."),
                    "active": True,
                    "created_at": _now_iso(),
                    "created_by": "system",
                })
            seeded += 1

    print()
    print(f"  seeded new:      {seeded}")
    print(f"  updated existing:{updated}")
    print(f"  already correct: {already}")
    if not commit:
        print("  DRY-RUN — re-run with --commit to apply.")
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
