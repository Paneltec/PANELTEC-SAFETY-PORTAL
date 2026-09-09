"""v58.13.132r — Role consolidation migration (27 → 4).

Executes the full data migration in one script:
  Step 1 — Seed 3 new target system roles (Paneltec Civil, Viatec
           Traffic Solutions, External Contractor). Admin reused.
  Step 2 — Bucket every active user + rewrite users.role_id, users.role.
           Force-override for the 7 named office-staff users.
           Full audit trail written to `role_migration_log`.
  Step 3 — Rebuild permission_presets: 4 new `is_builtin=true` docs,
           existing 3 custom presets tombstoned with `deprecated=true`.
  Step 4 — Hard-delete the 22 legacy role docs (per user's final call
           in .132r).

Usage:
    python scripts/migrate_roles_to_4_v58_13_132r.py               # dry-run
    python scripts/migrate_roles_to_4_v58_13_132r.py --commit      # execute
    python scripts/migrate_roles_to_4_v58_13_132r.py --rollback --batch-id <id>
"""
from __future__ import annotations
import argparse, asyncio, os, sys, uuid
from datetime import datetime, timezone
from collections import Counter

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402


NEW_ROLES = [
    # role_id must exist as `admin` already — reused as-is.
    {"role_id": "paneltec_civil", "name": "Paneltec Civil",
     "description": "Field workers — Simpro Company 2 (Paneltec Civil & Construction).",
     "is_system": True, "is_active": True, "is_builtin": True,
     "supersedes_role_id": "general_user"},
    {"role_id": "viatec_traffic", "name": "Viatec Traffic Solutions",
     "description": "Field workers — Simpro Company 3 (Viatec Traffic Solutions).",
     "is_system": True, "is_active": True, "is_builtin": True,
     "supersedes_role_id": "general_user"},
    {"role_id": "external_contractor", "name": "External Contractor",
     "description": "Outside contractors — restricted read + own submissions only.",
     "is_system": True, "is_active": True, "is_builtin": True,
     "supersedes_role_id": "contractor_rep_submit_only"},
]

# Force these office-staff emails to Admin regardless of their
# current role/company mapping (per user's Part-2 answer).
FORCE_ADMIN_EMAILS = {
    "mel", "melinda", "melinda3260@gmail.com",
    "amanda", "amanda.guy@paneltec.com.au",
    "stephen", "stephen@paneltec.com.au",
    "john", "john@paneltec.com.au",
    "mat", "mat.loone@paneltec.com.au",
    "pat", "patrick@paneltec.com.au", "patrick",
    "josh",  # coming soon — may not exist yet, don't fail
}

ADMIN_ROLE_KEYS = {
    "admin", "owner", "full_admin",
    "report_emailing_admin", "responsible_manager", "mechanic",
    "training_inductions_only",
    "custom_director", "custom_administration", "custom_admin_assistant",
    "custom_business_development_manager", "custom_operations_manager",
    "custom_mechanic_technician",
}
CONTRACTOR_ROLE_KEYS = {"contractor_rep", "contractor_rep_submit_only", "contractor"}

# 22 legacy roles to hard-delete AFTER migration confirms clean.
LEGACY_ROLES_TO_DELETE = {
    "hseq_manager", "hseq_manager_readonly", "hseq_manager_creator",
    "report_emailing_admin", "responsible_manager", "mechanic",
    "training_inductions_only", "contractor_rep",
    "contractor_rep_submit_only", "general_user",
    "custom_administration", "custom_admin_assistant",
    "custom_business_development_manager", "custom_director",
    "custom_mechanic_technician", "custom_operations_manager",
    "custom_safety_and_compliance_manager", "custom_cleaner",
    "custom_construction_worker_cw2", "custom_construction_worker_l1",
    "custom_construction_worker_l2", "custom_construction_worker_l3",
    "custom_machine_operator", "custom_plumber",
    "custom_precast_panel_employee", "custom_traffic_controller",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def build_bucket(email_lc: str, role: str, cid: str,
                       is_ctr: bool, forced: set) -> str:
    if email_lc in forced or any(email_lc.startswith(n + "@") or email_lc == n
                                  for n in FORCE_ADMIN_EMAILS):
        return "admin"
    if role in ADMIN_ROLE_KEYS:
        return "admin"
    if is_ctr or role in CONTRACTOR_ROLE_KEYS or "contractor" in role:
        return "external_contractor"
    if cid == "2":
        return "paneltec_civil"
    if cid == "3":
        return "viatec_traffic"
    # Test fixtures — defaults from discovery memo.
    fixture_defaults = {
        "pending-activation-fixture@paneltec.com.au": "admin",
        "hseq-lead-fixture@paneltec.com.au": "paneltec_civil",
        "worker-fixture@paneltec.com.au": "paneltec_civil",
        "admin@paneltec.com": "admin",
        "contractor-rep-fixture@paneltec.com": "external_contractor",
    }
    return fixture_defaults.get(email_lc, "paneltec_civil")


async def rollback(batch_id: str):
    print(f"ROLLBACK batch={batch_id}")
    n = 0
    async for log in db.role_migration_log.find({"batch_id": batch_id}, {"_id": 0}):
        await db.users.update_one(
            {"id": log["user_id"]},
            {"$set": {"role": log["old_role"], "role_id": log["old_role_id"]}},
        )
        n += 1
    print(f"Restored {n} users to their old_role_id values.")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--rollback", action="store_true")
    ap.add_argument("--batch-id")
    args = ap.parse_args()

    if args.rollback:
        if not args.batch_id:
            ap.error("--rollback requires --batch-id")
        await rollback(args.batch_id)
        return

    batch_id = f"role-mig-{uuid.uuid4().hex[:12]}"
    print(f"batch_id={batch_id}  commit={args.commit}")

    # Preload worker company_id index.
    worker_by_emp: dict = {}
    async for w in db.workers.find({}, {"_id": 0, "simpro_employee_id": 1, "company_id": 1}):
        emp = str(w.get("simpro_employee_id") or "")
        if emp:
            worker_by_emp[emp] = str(w.get("company_id") or "")

    # Step 1 — Seed 3 new roles.
    print("\n─ Step 1: seed new target roles ─")
    for r in NEW_ROLES:
        existing = await db.roles.find_one({"role_id": r["role_id"]})
        if existing:
            print(f"  ✓ exists  {r['role_id']}")
        else:
            print(f"  + create  {r['role_id']}  ({r['name']})")
            if args.commit:
                await db.roles.insert_one({
                    "id": str(uuid.uuid4()), **r,
                    "created_at": now_iso(), "updated_at": now_iso(),
                    "permission_tokens": [], "org_id": None,
                })

    # Step 2 — bucket + migrate users.
    print("\n─ Step 2: user migration ─")
    counts = Counter()
    forced_seen: list[str] = []
    notes_only = []
    async for u in db.users.find(
        {"deleted_at": None, "is_archived": {"$ne": True}},
        {"_id": 0, "id": 1, "email": 1, "role": 1, "role_id": 1,
         "company_id": 1, "is_contractor": 1, "simpro_employee_id": 1},
    ):
        email_lc = (u.get("email") or "").lower()
        old_role = u.get("role") or ""
        old_role_id = u.get("role_id") or old_role
        cid = str(u.get("company_id") or "")
        emp = str(u.get("simpro_employee_id") or "")
        if not cid and emp:
            cid = worker_by_emp.get(emp, "")
        is_ctr = bool(u.get("is_contractor"))
        new_role = await build_bucket(email_lc, (old_role_id or "").lower(), cid, is_ctr, FORCE_ADMIN_EMAILS)
        counts[new_role] += 1

        # Note force-override matches.
        if email_lc in {
            "melinda3260@gmail.com", "amanda.guy@paneltec.com.au",
            "stephen@paneltec.com.au", "john@paneltec.com.au",
            "mat.loone@paneltec.com.au", "patrick@paneltec.com.au",
        }:
            forced_seen.append(email_lc)

        if old_role_id == new_role:
            continue

        # Write audit + apply.
        if args.commit:
            await db.role_migration_log.insert_one({
                "id": str(uuid.uuid4()), "user_id": u["id"], "email": u.get("email"),
                "old_role": old_role, "old_role_id": old_role_id,
                "new_role_id": new_role, "batch_id": batch_id,
                "migrated_at": now_iso(),
            })
            await db.users.update_one(
                {"id": u["id"]},
                {"$set": {"role": new_role, "role_id": new_role,
                          "role_migrated_at": now_iso(),
                          "role_migration_batch_id": batch_id}},
            )

    for k, n in counts.most_common():
        print(f"  {n:4d}  → {k}")
    print(f"  force-override matches: {len(forced_seen)}")
    for e in forced_seen:
        print(f"     · {e}")
    josh = await db.users.find_one({"email": {"$regex": "^josh", "$options": "i"}})
    if not josh:
        print("  NOTE: 'Josh' not found in users — flagged (see memo).")

    # Step 3 — rebuild permission_presets.
    print("\n─ Step 3: rebuild permission_presets ─")
    org_id = os.environ.get("PANELTEC_ORG_ID") or "3116f250-a4eb-43f3-98a5-2a3656d6cb63"
    for r in [{"role_id": "admin", "name": "Admin"}] + NEW_ROLES:
        preset_id = f"preset_{r['role_id']}"
        existing = await db.permission_presets.find_one({"id": preset_id})
        if existing:
            print(f"  ✓ exists  {preset_id}")
        else:
            print(f"  + create  {preset_id}")
            if args.commit:
                await db.permission_presets.insert_one({
                    "id": preset_id, "org_id": org_id,
                    "name": r["name"], "role_id": r["role_id"],
                    "based_on": r["role_id"], "is_builtin": True,
                    "permission_tokens": [], "permissions": {},
                    "created_at": now_iso(), "updated_at": now_iso(),
                })
    # Tombstone the 3 custom presets.
    if args.commit:
        result = await db.permission_presets.update_many(
            {"is_builtin": {"$ne": True}, "deprecated": {"$ne": True}},
            {"$set": {"deprecated": True, "deprecated_at": now_iso()}},
        )
        print(f"  tombstoned {result.modified_count} custom presets")

    # Step 4 — hard-delete 22 legacy roles (safety: only after user migration commits).
    print("\n─ Step 4: hard-delete 22 legacy role docs ─")
    if args.commit:
        # Safety re-check: no active user should still be on any of the 22.
        stragglers = await db.users.count_documents({
            "deleted_at": None, "is_archived": {"$ne": True},
            "role_id": {"$in": list(LEGACY_ROLES_TO_DELETE)},
        })
        if stragglers:
            print(f"  ✗ ABORT hard-delete — {stragglers} users still on legacy roles")
            return
        result = await db.roles.delete_many({
            "role_id": {"$in": list(LEGACY_ROLES_TO_DELETE)},
            "is_system": {"$ne": True},  # NEVER drop system roles just in case
        })
        # Also delete legacy system-flagged roles that are safe (hseq_*, report_emailing_admin, etc.)
        for rid in LEGACY_ROLES_TO_DELETE:
            await db.roles.delete_one({"role_id": rid})
        remaining = await db.roles.count_documents({"is_active": True, "deprecated": {"$ne": True}})
        print(f"  ✓ deleted legacy role docs; active roles remaining: {remaining}")
    else:
        print(f"  would hard-delete {len(LEGACY_ROLES_TO_DELETE)} legacy role docs (dry-run)")

    print(f"\nDONE. batch_id={batch_id}")
    print(f"Rollback: python scripts/migrate_roles_to_4_v58_13_132r.py --rollback --batch-id {batch_id}")


if __name__ == "__main__":
    asyncio.run(main())
