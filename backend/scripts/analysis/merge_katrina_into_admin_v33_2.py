"""v160.3.9.33.2 — Merge Katrina Guy into `admin` role.

User confirmed with full awareness that Katrina becomes an Administrator
with full app control (verbatim: "User confirmed A: merge Administration
with Administrator per Katrina's role in the org.").

Idempotent — running twice is a no-op.

Steps:
  1. Locate exactly ONE user matching Katrina (simpro_position='Administration'
     AND email contains 'katrina.guy'). Multiple / zero matches → abort.
  2. If she's already role_id='admin' → no-op, exit clean.
  3. Update role_id='admin', role='admin', role_locked=True (future Simpro
     sync must not revert her — she's an admin by explicit directive, not
     by position). Bump token_version so any live sessions re-mint.
  4. Write `user_audit` action='admin_grant_by_explicit_directive'.
  5. If `custom_administration` role has zero remaining references, delete
     it. Write `role_audit` action='delete'.
"""
import asyncio
import sys

sys.path.insert(0, "/app/backend")

from db import db
from models import new_id, now_iso


async def main():
    stephen = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                       {"_id": 0, "id": 1, "email": 1})
    if not stephen:
        raise SystemExit("stephen@paneltec.com.au not found — aborting")

    matches = await db.users.find(
        {"simpro_position": "Administration",
         "email": {"$regex": "katrina.*guy", "$options": "i"}},
        {"_id": 0},
    ).to_list(10)

    if len(matches) == 0:
        print("STOP: 0 matches for Katrina Guy — nothing to merge.")
        return
    if len(matches) > 1:
        print(f"STOP: {len(matches)} matches — ambiguous. Manual review needed.")
        for m in matches:
            print(f"  id={m['id']} email={m['email']} name={m.get('name')}")
        return

    k = matches[0]
    print(f"BEFORE — {k.get('name')} ({k['email']})")
    print(f"  role={k.get('role')}  role_id={k.get('role_id')}  role_locked={k.get('role_locked')}")

    if k.get("role_id") == "admin":
        print("Katrina already on admin role — no-op. (Ensuring role_locked=True.)")
        await db.users.update_one({"id": k["id"]},
                                   {"$set": {"role_locked": True, "updated_at": now_iso()}})
    else:
        now = now_iso()
        await db.users.update_one(
            {"id": k["id"]},
            {"$set": {
                "role_id": "admin", "role": "admin",
                "role_locked": True,
                "role_assigned_at": now,
                "updated_at": now,
            }, "$inc": {"token_version": 1}},
        )
        await db.user_audit.insert_one({
            "id": new_id(),
            "user_id": k["id"],
            "action": "admin_grant_by_explicit_directive",
            "before": {"role_id": k.get("role_id"), "role": k.get("role"),
                       "role_locked": k.get("role_locked")},
            "after": {"role_id": "admin", "role": "admin", "role_locked": True},
            "reason": ("User confirmed A: merge Administration with "
                       "Administrator per Katrina's role in the org."),
            "actor_user_id": stephen["id"],
            "actor_email": "v33_2-merge-katrina-script",
            "at": now,
        })

    # Verify + delete unreferenced custom_administration role.
    remaining = await db.users.count_documents({"role_id": "custom_administration"})
    if remaining == 0:
        role_doc = await db.roles.find_one({"role_id": "custom_administration"}, {"_id": 0})
        if role_doc:
            deleted_at = now_iso()
            await db.roles.delete_one({"role_id": "custom_administration"})
            await db.role_audit.insert_one({
                "id": new_id(),
                "role_id": "custom_administration",
                "role_name": role_doc.get("name") or "Administration",
                "action": "delete",
                "before": role_doc,
                "after": None,
                "diff": {"hard_deleted": True,
                         "reason": "merged into admin after user directive"},
                "actor_user_id": stephen["id"],
                "actor_email": "v33_2-merge-katrina-script",
                "at": deleted_at,
            })
            print("Deleted role custom_administration (no remaining references).")
        else:
            print("Role custom_administration already absent.")
    else:
        print(f"KEPT custom_administration — still referenced by {remaining} user(s).")

    # Verify.
    k2 = await db.users.find_one({"id": k["id"]}, {"_id": 0})
    print(f"AFTER — {k2.get('name')} ({k2['email']})")
    print(f"  role={k2.get('role')}  role_id={k2.get('role_id')}  role_locked={k2.get('role_locked')}")


if __name__ == "__main__":
    asyncio.run(main())
