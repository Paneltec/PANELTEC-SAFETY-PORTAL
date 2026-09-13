"""v58.13.132dv — One-shot bulk soft-delete of test-shaped archived
insurance certificates on Stephen's org.

Idempotent: re-runs skip rows already carrying `deleted_at`.
Safe: GridFS blobs are NEVER touched — only the array-entry visibility
flag flips. Admins can restore any row via "Show deleted" +
Undelete in Org Settings → Past Certificates.

Usage (from repo root):
    python -m backend.scripts.cleanup_test_archives_v58_13_132dv \
        [--org-id <uuid>] [--dry-run]

Default org is the Paneltec Pty Ltd tenant (Stephen). Prints one line
per row processed so the output can be pasted into the ship memo for
audit compliance.

Exit code:
    0 — success (whether rows were cleared or already clean)
    1 — env or DB failure
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

DEFAULT_ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"   # Paneltec Pty Ltd
DELETED_BY = "migration:v58.13.132dv"
KINDS = ("public_liability", "workers_comp",
         "general_cover", "professional_indemnity")


async def _run(org_id: str, dry_run: bool) -> int:
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not (mongo_url and db_name):
        print("ERR: MONGO_URL / DB_NAME env not set", file=sys.stderr)
        return 1
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    org = await db.orgs.find_one({"id": org_id}, {"_id": 0, "name": 1})
    if not org:
        print(f"ERR: org {org_id} not found", file=sys.stderr)
        return 1
    print(f"ORG: {org.get('name')} ({org_id})  dry_run={dry_run}")
    now = datetime.now(timezone.utc).isoformat()

    grand_total = 0
    for kind in KINDS:
        field = f"{kind}_insurance"
        doc = await db.orgs.find_one({"id": org_id}, {"_id": 0, field: 1})
        block = (doc or {}).get(field) or {}
        prev = list(block.get("previous_certificates") or [])
        if not prev:
            print(f"  {kind}: no archived rows — skip")
            continue
        changed = 0
        for row in prev:
            if row.get("deleted_at"):
                # already soft-deleted — idempotent no-op
                continue
            audit = {
                "org_id": org_id,
                "policy_type": kind,
                "certificate_id": row.get("certificate_id"),
                "filename": row.get("certificate_filename"),
                "uploaded_at": row.get("uploaded_at"),
                "archived_at": row.get("archived_at"),
                "policy_number": row.get("policy_number"),
                "expiry_date": row.get("expiry_date"),
            }
            print("  DELETE " + json.dumps(audit, sort_keys=True))
            if not dry_run:
                row["deleted_at"] = now
                row["deleted_by"] = DELETED_BY
            changed += 1
        if changed and not dry_run:
            await db.orgs.update_one(
                {"id": org_id},
                {"$set": {f"{field}.previous_certificates": prev,
                          "updated_at": now}},
            )
        print(f"  {kind}: soft-deleted {changed} row(s)"
              f" ({'DRY-RUN' if dry_run else 'APPLIED'})")
        grand_total += changed
    print(f"TOTAL soft-deleted: {grand_total}")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--org-id", default=DEFAULT_ORG_ID,
                   help=f"Target org id (default: Stephen's org {DEFAULT_ORG_ID})")
    p.add_argument("--dry-run", action="store_true",
                   help="Print what would happen without mutating anything")
    args = p.parse_args()
    rc = asyncio.run(_run(args.org_id, args.dry_run))
    sys.exit(rc)


if __name__ == "__main__":
    main()
