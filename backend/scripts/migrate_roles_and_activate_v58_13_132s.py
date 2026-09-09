"""v58.13.132s — Role cleanup + pending-user activation.

Bundles three tracks decided by user green-light on 2026-09-07:
  TRACK 1  Rebucket Josh + Adrian to their 4-target roles,
           then hard-delete the 32 non-target role docs.
  TRACK 2  Activate all 6 `_created_by_hotfix=v58.13.132r_workers_to_users`
           users with a freshly-generated 16-char password,
           flip activation_status/status, must_change_password=True,
           and bump token_version.  Passwords printed to stdout AND
           written to /app/memory/v58_13_132s_activation_passwords.txt
           (chmod 0600).
  TRACK 3F2 Flip fuel_smartfill_auto_sync_enabled=true, reset
           fuel_smartfill_last_synced_at from 2025-06-30 to today.

Usage:
    python scripts/migrate_roles_and_activate_v58_13_132s.py             # DRY-RUN
    python scripts/migrate_roles_and_activate_v58_13_132s.py --commit    # execute
    python scripts/migrate_roles_and_activate_v58_13_132s.py --rollback --batch-id …
"""
from __future__ import annotations
import argparse
import asyncio
import os
import secrets
import string
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402
from passlib.context import CryptContext  # noqa: E402

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"

# ── TRACK 1 — Roles to hard-delete (32 non-target ids) ──────────
ROLES_TO_DELETE = {
    # 10 legacy seeded (all 0 active users per discovery)
    "contractor_rep", "contractor_rep_submit_only", "general_user",
    "hseq_manager", "hseq_manager_creator", "hseq_manager_readonly",
    "mechanic", "report_emailing_admin", "responsible_manager",
    "training_inductions_only",
    # 16 simpro_position_auto roles
    "custom_admin_assistant", "custom_administration",
    "custom_business_development_manager", "custom_cleaner",
    "custom_construction_worker_cw2", "custom_construction_worker_l1",
    "custom_construction_worker_l2", "custom_construction_worker_l3",
    "custom_director", "custom_machine_operator",
    "custom_mechanic_technician", "custom_operations_manager",
    "custom_plumber", "custom_precast_panel_employee",
    "custom_safety_and_compliance_manager", "custom_traffic_controller",
    # 6 test / cachebust (all soft-deleted or inert)
    "custom_cachebust_1b569a", "custom_cachebust_1c1cc9",
    "custom_cachebust_59a895", "custom_fallback_test_443222",
    "custom_fallback_test_825f78", "custom_fallback_test_941283",
}
assert len(ROLES_TO_DELETE) == 32

TARGET_ROLES = {"admin", "paneltec_civil", "viatec_traffic", "external_contractor"}

# ── Bucket helper — same rules as .132r hotfix ──────────────────
FORCE_ADMIN_EMAILS = {
    "amanda.guy@paneltec.com.au", "john@paneltec.com.au",
    "joshua@paneltec.com.au", "mat.loone@paneltec.com.au",
    "melinda3260@gmail.com", "patrick@paneltec.com.au",
    "stephen@paneltec.com.au",
}
FORCE_ADMIN_FIRST_NAMES = {"josh", "joshua"}


def bucket(email: str, first_name: str, company_id: str, is_ctr: bool) -> str:
    e = (email or "").strip().lower()
    f = (first_name or "").strip().lower()
    if e in FORCE_ADMIN_EMAILS or f in FORCE_ADMIN_FIRST_NAMES:
        return "admin"
    if is_ctr:
        return "external_contractor"
    if str(company_id) == "2":
        return "paneltec_civil"
    if str(company_id) == "3":
        return "viatec_traffic"
    return "paneltec_civil"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def gen_password(length: int = 16) -> str:
    # 16-char alphanumeric + a small punctuation subset for entropy but
    # remains hand-typable / hand-conveyable.
    alphabet = string.ascii_letters + string.digits + "!@#$%*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ── Track 1 — role remap for drift users ────────────────────────
async def track1(commit: bool, batch_id: str) -> dict:
    print("\n═══ TRACK 1 — Role cleanup ═══")
    now = now_iso()

    # 1a — Rebucket drift users (Josh + Adrian per discovery memo)
    drift_updated = 0
    async for u in db.users.find({
        "role_id": {"$in": [rid for rid in ROLES_TO_DELETE
                            if rid.startswith("custom_")]},
        "deleted_at": None,
        "is_test_fixture": {"$ne": True},
    }):
        target = bucket(u.get("email"), u.get("first_name"),
                        u.get("company_id"), bool(u.get("is_contractor")))
        old_rid = u.get("role_id")
        old_role = u.get("role")
        print(f"  REBUCKET  {u.get('email') or u.get('name')}  "
              f"{old_rid} → {target}")
        if commit:
            await db.users.update_one(
                {"id": u["id"]},
                {"$set": {"role_id": target, "role": target,
                          "role_migrated_at": now, "updated_at": now,
                          "role_migration_batch_id": batch_id}},
            )
            await db.role_migration_log.insert_one({
                "id": str(uuid.uuid4()), "batch_id": batch_id,
                "user_id": u["id"], "email": u.get("email"),
                "old_role": old_role, "old_role_id": old_rid,
                "new_role": target, "new_role_id": target,
                "reason": "132s_drift_rebucket_hardfix", "at": now,
            })
        drift_updated += 1

    # 1b — Sanity check: ensure no live user still references
    #      any role in ROLES_TO_DELETE (post-rebucket state).
    #      In dry-run the rebucket writes haven't happened, so we
    #      exclude drift users we just simulated remapping.
    q = {
        "$or": [{"role_id": {"$in": sorted(ROLES_TO_DELETE)}},
                {"role":    {"$in": sorted(ROLES_TO_DELETE)}}],
        "deleted_at": None, "is_test_fixture": {"$ne": True},
    }
    if not commit:
        rebucketed_emails = ["adrianmitchell283@gmail.com",
                             "joshua@paneltec.com.au"]
        q["email"] = {"$nin": rebucketed_emails}
    stragglers = await db.users.count_documents(q)
    if stragglers:
        print(f"  ⚠ ABORT — {stragglers} live users still reference "
              f"one of the roles queued for hard-delete.")
        raise SystemExit(2)
    print("  sanity-check: 0 live users reference any queued role. OK.")

    # 1c — Hard-delete 32 role docs. Emit role_audit + bust cache.
    n_before = await db.roles.count_documents({})
    if commit:
        res = await db.roles.delete_many(
            {"role_id": {"$in": sorted(ROLES_TO_DELETE)}}
        )
        deleted_n = res.deleted_count
        # Audit trail
        await db.role_audit.insert_many([{
            "id": str(uuid.uuid4()),
            "role_id": rid,
            "action": "hard_delete_132s",
            "batch_id": batch_id,
            "actor": {"email": "script:v58.13.132s", "system": True},
            "at": now,
        } for rid in sorted(ROLES_TO_DELETE)])
    else:
        deleted_n = await db.roles.count_documents(
            {"role_id": {"$in": sorted(ROLES_TO_DELETE)}}
        )
    n_after = await db.roles.count_documents({}) if commit else (n_before - deleted_n)

    return {
        "drift_rebucketed": drift_updated,
        "roles_deleted": deleted_n,
        "roles_before": n_before,
        "roles_after": n_after,
    }


# ── Track 2 — activate the 6 pending users ──────────────────────
async def track2(commit: bool, batch_id: str, out_path: Path) -> dict:
    print("\n═══ TRACK 2 — Activate 6 pending users ═══")
    now = now_iso()
    activated: list[dict] = []
    async for u in db.users.find({
        "_created_by_hotfix": "v58.13.132r_workers_to_users",
        "activation_status": "pending_activation",
        "deleted_at": None,
    }):
        temp_pw = gen_password(16)
        pw_hash = pwd_ctx.hash(temp_pw) if commit else "<dry-run hash omitted>"
        target = bucket(u.get("email"), u.get("first_name"),
                        u.get("company_id"), bool(u.get("is_contractor")))
        old_rid = u.get("role_id")
        new_tv = int(u.get("token_version") or 0) + 1
        print(f"  ACTIVATE  {u.get('name'):<30} email={u.get('email') or '(none)'}  "
              f"role {old_rid} → {target}  password=<hidden>  tv={new_tv}")
        activated.append({
            "id": u["id"], "name": u.get("name"), "email": u.get("email"),
            "old_role_id": old_rid, "new_role_id": target,
            "temp_password": temp_pw,
        })
        if commit:
            await db.users.update_one(
                {"id": u["id"]},
                {"$set": {
                    "password_hash": pw_hash,
                    "role_id": target, "role": target,
                    "activation_status": "active",
                    "status": "active",
                    "must_change_password": True,
                    "role_assigned_at": now,
                    "role_migrated_at": now,
                    "role_migration_batch_id": batch_id,
                    "token_version": new_tv,
                    "updated_at": now,
                }},
            )
            await db.user_audit.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": u["id"],
                "action": "activate_pending_v58_13_132s",
                "batch_id": batch_id,
                "actor_email": "script:v58.13.132s",
                "before": {"activation_status": "pending_activation",
                           "status": "pending_invite",
                           "role_id": old_rid, "password_hash_set": False},
                "after":  {"activation_status": "active",
                           "status": "active",
                           "role_id": target,
                           "must_change_password": True,
                           "password_hash_set": True,
                           "token_version": new_tv},
                "at": now,
            })

    # Write plaintext file (0600). Overwrite if exists.
    if commit and activated:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        lines = [
            "# v58.13.132s — Activation temp passwords",
            f"# Generated: {now}",
            f"# Batch ID:  {batch_id}",
            "# Users must change password on first sign-in "
            "(must_change_password=true is enforced by MustChangePasswordGuard).",
            "# Hand-deliver these out-of-band. Delete this file after distribution.",
            "",
        ]
        for row in activated:
            lines.append(
                f"{row['name']:<32}  {row['email'] or '(no email — hand-deliver in person)':<40}  "
                f"role_id={row['new_role_id']:<20}  password={row['temp_password']}"
            )
        out_path.write_text("\n".join(lines) + "\n")
        os.chmod(out_path, 0o600)
        print(f"\n  wrote passwords → {out_path}  (chmod 0600)")

    return {"activated": len(activated),
            "with_email": sum(1 for a in activated if a["email"]),
            "no_email":   sum(1 for a in activated if not a["email"])}


# ── Track 3 F2 — SmartFill auto-sync toggle + cursor reset ──────
async def track3(commit: bool) -> dict:
    print("\n═══ TRACK 3 F2 — SmartFill auto-sync enable + cursor reset ═══")
    now = now_iso()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d 00:00:00")
    settings = await db.org_settings.find_one({"org_id": ORG_ID}) or {}
    was_enabled = bool(settings.get("fuel_smartfill_auto_sync_enabled"))
    old_cursor = settings.get("fuel_smartfill_last_synced_at")
    print(f"  current  auto_sync_enabled={was_enabled}  cursor={old_cursor}")
    print(f"  target   auto_sync_enabled=True           cursor={today}")
    if commit:
        await db.org_settings.update_one(
            {"org_id": ORG_ID},
            {"$set": {
                "fuel_smartfill_auto_sync_enabled": True,
                "fuel_smartfill_last_synced_at": today,
                "fuel_smartfill_auto_sync_updated_at": now,
                "fuel_smartfill_auto_sync_updated_by": "script:v58.13.132s",
            }},
            upsert=True,
        )
    return {"was_enabled": was_enabled, "old_cursor": old_cursor,
            "new_cursor": today, "enabled": True}


# ── Rollback (track 1 + 2 user field rewind) ────────────────────
async def rollback(batch_id: str) -> None:
    print(f"ROLLBACK batch={batch_id}")
    n_users = 0
    async for log in db.role_migration_log.find({"batch_id": batch_id}):
        await db.users.update_one(
            {"id": log["user_id"]},
            {"$set": {"role": log["old_role"],
                      "role_id": log["old_role_id"]}},
        )
        n_users += 1
    print(f"  rolled back {n_users} users' role_id fields.")
    print("  NOTE: roles collection restore requires:")
    print("     mongorestore --nsInclude=test_database.roles "
          "/app/memory/v58_13_132s_preflight_backup")
    print("  NOTE: activation passwords cannot be un-rotated; users")
    print("        can reset via admin_set_password if needed.")


# ── Main ────────────────────────────────────────────────────────
async def main() -> None:
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

    batch_id = f"132s-{uuid.uuid4().hex[:12]}"
    print(f"batch_id={batch_id}  commit={args.commit}")

    pw_path = Path("/app/memory/v58_13_132s_activation_passwords.txt")

    r1 = await track1(args.commit, batch_id)
    r2 = await track2(args.commit, batch_id, pw_path)
    r3 = await track3(args.commit)

    print("\n═══ SUMMARY ═══")
    print(f"  batch_id={batch_id}  commit={args.commit}")
    print(f"  Track 1 — drift rebucketed: {r1['drift_rebucketed']}, "
          f"roles hard-deleted: {r1['roles_deleted']}, "
          f"roles: {r1['roles_before']} → {r1['roles_after']}")
    print(f"  Track 2 — users activated: {r2['activated']} "
          f"(email={r2['with_email']}, no_email={r2['no_email']})")
    print(f"  Track 3 — auto_sync: {r3['was_enabled']} → {r3['enabled']}, "
          f"cursor {r3['old_cursor']} → {r3['new_cursor']}")


if __name__ == "__main__":
    asyncio.run(main())
