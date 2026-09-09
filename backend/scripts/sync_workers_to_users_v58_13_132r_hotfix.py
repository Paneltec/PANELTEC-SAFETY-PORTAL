"""v58.13.132r_hotfix — Sync workers → users (create pending-invite
user rows for workers who have no corresponding login record).
Applies the `.132r` 4-role bucketing rules to auto-assign role_id.

Usage:
    python scripts/sync_workers_to_users_v58_13_132r_hotfix.py             # dry-run
    python scripts/sync_workers_to_users_v58_13_132r_hotfix.py --commit    # execute
"""
from __future__ import annotations
import argparse, asyncio, sys, uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402

# Same force-admin list as .132r migration, PLUS explicit email
# aliases for people whose given-name prefix doesn't match their
# email local-part (Josh → joshua@…).
FORCE_ADMIN_EMAILS = {
    "melinda3260@gmail.com", "amanda.guy@paneltec.com.au",
    "stephen@paneltec.com.au", "john@paneltec.com.au",
    "mat.loone@paneltec.com.au", "patrick@paneltec.com.au",
    # v58.13.132r hotfix — Josh's email is `joshua@…`, not `josh@…`,
    # so the name-prefix short-circuit in the .132r migration didn't
    # bucket him. Explicit email pin here.
    "joshua@paneltec.com.au", "josh@paneltec.com.au",
}
FORCE_ADMIN_FIRST_NAMES = {"josh", "joshua"}

ADMIN_ROLE_KEYS = {"admin", "owner", "full_admin", "responsible_manager"}


def bucket(email_lc: str, first_lc: str, company_id: str, is_ctr: bool) -> str:
    if email_lc in FORCE_ADMIN_EMAILS or first_lc in FORCE_ADMIN_FIRST_NAMES:
        return "admin"
    if is_ctr:
        return "external_contractor"
    if company_id == "2":
        return "paneltec_civil"
    if company_id == "3":
        return "viatec_traffic"
    return "paneltec_civil"  # sensible default for unknown cid


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    org_id = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"  # Paneltec tenant
    now = datetime.now(timezone.utc).isoformat()

    created = updated = skipped = 0
    async for w in db.workers.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1,
         "email": 1, "company_id": 1, "simpro_employee_id": 1,
         "is_contractor": 1},
    ):
        emp = str(w.get("simpro_employee_id") or "")
        email = (w.get("email") or "").strip().lower()
        first = (w.get("first_name") or "").strip()
        last = (w.get("last_name") or "").strip()
        cid = str(w.get("company_id") or "")
        is_ctr = bool(w.get("is_contractor"))
        if not email and not emp:
            skipped += 1
            continue

        # Try match by simpro_employee_id first, then by email.
        existing = None
        if emp:
            existing = await db.users.find_one(
                {"org_id": org_id, "simpro_employee_id": emp}, {"_id": 0}
            )
        if not existing and email:
            existing = await db.users.find_one(
                {"org_id": org_id, "email": email}, {"_id": 0}
            )

        role_id = bucket(email, first.lower(), cid, is_ctr)

        if existing:
            # If existing has no role_id (pending activation), stamp it.
            if not existing.get("role_id"):
                updated += 1
                print(f"  UPDATE  {email or emp}  role_id → {role_id}")
                if args.commit:
                    await db.users.update_one(
                        {"id": existing["id"]},
                        {"$set": {"role": role_id, "role_id": role_id,
                                  "activation_status": "pending_activation",
                                  "updated_at": now,
                                  "role_migrated_at": now,
                                  "role_migration_batch_id": "hotfix-workers-to-users"}},
                    )
            else:
                skipped += 1
            continue

        # CREATE pending-invite user.
        created += 1
        print(f"  CREATE  {email or emp}  ({first} {last})  cid={cid}  role_id={role_id}")
        if args.commit:
            await db.users.insert_one({
                "id": str(uuid.uuid4()), "org_id": org_id,
                "email": email or None,
                "name": f"{first} {last}".strip(),
                "first_name": first, "last_name": last,
                "role": role_id, "role_id": role_id,
                "simpro_employee_id": emp or None,
                "company_id": cid or None,
                "worker_id": w.get("id"),
                "activation_status": "pending_activation",
                "status": "pending_invite",
                "is_contractor": is_ctr,
                "created_at": now, "updated_at": now,
                "_created_by_hotfix": "v58.13.132r_workers_to_users",
            })

    print(f"\nSummary: created={created} updated={updated} skipped={skipped}  commit={args.commit}")


if __name__ == "__main__":
    asyncio.run(main())
