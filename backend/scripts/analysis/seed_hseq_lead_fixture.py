"""v160.3.9.27 — Deterministic hseq_lead fixture seeder.

One-off. Not wired into any router or startup path. Creates (or
idempotently refreshes) a single hseq_lead-role user document so
testers can verify the v27 guard-migration 403 path without depending
on the throttled `demo@paneltec.com` or disabled `admin@paneltec.com`
accounts.

Fixture:
    email    : hseq-lead-fixture@paneltec.com.au
    password : HseqLeadFixture123!   (bcrypt-hashed on write)
    role     : "hseq_lead"           (legacy string — pre-v26 shape)
    role_id  : "hseq_manager"        (v26 catalogue id; still opt-in)
    activation_status : "active"
    is_archived       : False

Idempotent — re-running upserts by email + refreshes the password hash.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND = Path("/app/backend")
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
except Exception:
    pass

import bcrypt  # noqa: E402

from db import db  # noqa: E402
from models import new_id, now_iso  # noqa: E402


FIXTURE_EMAIL = "hseq-lead-fixture@paneltec.com.au"
FIXTURE_PASSWORD = "HseqLeadFixture123!"


async def seed() -> dict:
    existing = await db.users.find_one({"email": FIXTURE_EMAIL}, {"_id": 0})
    ts = now_iso()
    password_hash = bcrypt.hashpw(
        FIXTURE_PASSWORD.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    admin = await db.users.find_one(
        {"email": "stephen@paneltec.com.au"},
        {"_id": 0, "org_id": 1, "workspace_ids": 1},
    )
    org_id = (admin or {}).get("org_id")
    workspace_ids = (admin or {}).get("workspace_ids") or []

    set_fields = {
        "email": FIXTURE_EMAIL,
        "password_hash": password_hash,
        "name": "HSEQ Lead Fixture",
        "full_name": "HSEQ Lead Fixture",
        "role": "hseq_lead",
        "role_id": "hseq_manager",
        "org_id": org_id,
        "workspace_ids": workspace_ids,
        "activation_status": "active",
        "is_archived": False,
        "status": "active",
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
        "role": saved["role"],
        "role_id": saved["role_id"],
        "activation_status": saved["activation_status"],
        "is_archived": saved["is_archived"],
        "org_id": saved.get("org_id"),
    }


def main() -> None:
    result = asyncio.run(seed())
    print("HSEQ lead fixture seeded:")
    for k, v in result.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
