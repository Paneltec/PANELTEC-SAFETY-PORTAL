"""v160.3.9.30 — Phase 3d idempotent seeder for the contractor_rep
pytest/manual fixture. Creates or refreshes a user document with:
  - email = contractor-rep-fixture@paneltec.com.au
  - role  = contractor_rep
  - company_id = bbf6b46f-dba2-40d6-94aa-8839e498dbef   (ATO Australian Taxation Office)
  - activation_status = 'active'
  - is_archived = False
  - password = ContractorRepFixture123!

Scoping enforcement lives in `permissions_scope.py` (Phase 3b). This
seed only puts a `company_id` on the user; the scope helper reads it
and narrows every list-endpoint query to matching records.

Run:
    cd /app/backend && python3 scripts/analysis/seed_contractor_rep_fixture.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import bcrypt
from db import db

FIXTURE_EMAIL = "contractor-rep-fixture@paneltec.com.au"
FIXTURE_PASSWORD = "ContractorRepFixture123!"
FIXTURE_COMPANY_ID = "bbf6b46f-dba2-40d6-94aa-8839e498dbef"  # ATO


async def main() -> None:
    now = datetime.now(timezone.utc).isoformat()
    pw_hash = bcrypt.hashpw(FIXTURE_PASSWORD.encode(), bcrypt.gensalt()).decode()

    existing = await db.users.find_one({"email": FIXTURE_EMAIL})
    # v160.3.9.30 (G1 fix) — Purge any stale user_permissions overrides
    # for this fixture's user_id. A prior admin session had written
    # explicit False overrides on contractors/workers/documents which
    # were merging on top of ROLE_DEFAULTS via effective_for() and
    # neutering the whole role. Idempotent purge keeps this seeder
    # self-healing.
    if existing:
        await db.user_permissions.delete_many({"user_id": existing.get("id")})
    doc = {
        "email": FIXTURE_EMAIL,
        "name": "Contractor Rep Fixture",
        "full_name": "Contractor Rep Fixture (ATO)",
        "role": "contractor_rep",
        "role_id": "contractor_rep",
        "company_id": FIXTURE_COMPANY_ID,
        "status": "active",
        "activation_status": "active",
        "is_archived": False,
        "password_hash": pw_hash,
        "token_version": (existing or {}).get("token_version", 0) + 1,
        "updated_at": now,
    }
    if existing:
        await db.users.update_one({"_id": existing["_id"]}, {"$set": doc})
        print(f"[seed] refreshed contractor_rep fixture: {FIXTURE_EMAIL} (id={existing.get('id')})")
    else:
        doc.update({
            "id": str(uuid.uuid4()),
            "created_at": now,
            "created_by": "seed_contractor_rep_fixture",
        })
        await db.users.insert_one(doc)
        print(f"[seed] created contractor_rep fixture: {FIXTURE_EMAIL} (id={doc['id']})")

    # Verify
    u = await db.users.find_one({"email": FIXTURE_EMAIL})
    print(f"[seed] verify: role={u['role']} company_id={u['company_id']} activation_status={u['activation_status']}")


if __name__ == "__main__":
    asyncio.run(main())
