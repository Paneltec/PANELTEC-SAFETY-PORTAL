"""v160.3.9.26 — Deterministic pending_activation fixture seeder.

One-off. Not wired into any router or startup path. Creates (or
idempotently refreshes) a single user document representing the
"Simpro-imported but not yet activated by admin" state, so testers can
assert the `/api/auth/login` 403 path without needing a fresh Simpro
sync.

Fixture:
    email    : pending-activation-fixture@paneltec.com.au
    password : PendingFixture123!   (bcrypt-hashed on write)
    activation_status : "pending_activation"
    role_id           : None
    is_archived       : False
    role (legacy)     : "worker"

Idempotent — re-running this script upserts by email and re-hashes the
password with a fresh salt so the value is guaranteed correct.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Make `backend/` importable when invoked from /app.
BACKEND = Path("/app/backend")
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Load backend/.env so MONGO_URL etc. resolve when run standalone.
try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
except Exception:
    pass

import bcrypt  # noqa: E402

from db import db  # noqa: E402
from models import new_id, now_iso  # noqa: E402


FIXTURE_EMAIL = "pending-activation-fixture@paneltec.com.au"
FIXTURE_PASSWORD = "PendingFixture123!"


async def seed() -> dict:
    existing = await db.users.find_one({"email": FIXTURE_EMAIL}, {"_id": 0})
    ts = now_iso()
    password_hash = bcrypt.hashpw(
        FIXTURE_PASSWORD.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    # Locate any org so the fixture belongs somewhere plausible. Prefer
    # the same org the primary admin belongs to.
    admin = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                    {"_id": 0, "org_id": 1, "workspace_ids": 1})
    org_id = (admin or {}).get("org_id")
    workspace_ids = (admin or {}).get("workspace_ids") or []

    set_fields = {
        "email": FIXTURE_EMAIL,
        "password_hash": password_hash,
        "name": "Pending Activation Fixture",
        "role": "worker",
        "role_id": None,
        "org_id": org_id,
        "workspace_ids": workspace_ids,
        "activation_status": "pending_activation",
        "is_archived": False,
        "status": "active",
        "simpro_employee_id": None,
        "simpro_position": None,
        "simpro_last_synced_at": None,
        "updated_at": ts,
    }
    set_on_insert = {
        "id": new_id(),
        "created_at": ts,
        "token_version": 0,
    }
    await db.users.update_one(
        {"email": FIXTURE_EMAIL},
        {"$set": set_fields, "$setOnInsert": set_on_insert},
        upsert=True,
    )
    saved = await db.users.find_one({"email": FIXTURE_EMAIL}, {"_id": 0})
    return {
        "action": "updated" if existing else "created",
        "id": saved["id"],
        "email": saved["email"],
        "activation_status": saved["activation_status"],
        "role_id": saved["role_id"],
        "is_archived": saved["is_archived"],
        "org_id": saved.get("org_id"),
    }


def main() -> None:
    result = asyncio.run(seed())
    print("Pending-activation fixture seeded:")
    for k, v in result.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
