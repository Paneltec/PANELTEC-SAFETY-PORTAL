"""v160.3.9.33 — Phase 4d data fix: cleanup of orphaned test-artifact
role assignments.

Background:
  During Phase 4d development a handful of pytests (particularly the
  Option-1 fallback proof and cache-bust invariant test) created
  throwaway custom roles and assigned live production users to them
  without rolling those users back. This left users like Matthew Smith
  and Katrina Guy stuck on roles like `custom_fallback_test_XXXXXX`
  instead of their position-derived roles (`custom_plumber`,
  `custom_administration`).

  The updated `conftest.py` guard (v160.3.9.33) blocks this pattern
  from recurring. Meanwhile this script cleans up the historical
  damage. It is IDEMPOTENT — running it twice is a no-op.

What it does:
  1. Finds every user whose `role_id` matches one of the test-artifact
     prefixes (custom_fallback_test_, custom_cachebust_, custom_ptest_,
     custom_test_) OR whose role_id is an orphan (references a role no
     longer in db.roles).
  2. Skips known real-account fixtures (stephen, hseq-lead-fixture,
     contractor-rep-fixture, worker-fixture, pending-activation-fixture)
     and any doc with `is_test_fixture=True` OR `is_test=True`.
  3. For each affected user:
       • If `simpro_position` is set → assign the matching
         `custom_<slug(position)>` role. Auto-create it if it's not in
         `db.roles` (mirrors `roles_catalogue.create_role_from_position`
         semantics: source="simpro_position_auto", tokens=[]).
       • Else → assign `general_user` (safe conservative default).
       • Set `role_locked=False`, `role_assigned_at=now()`.
       • Write ONE `user_audit` row.
  4. After user re-assignment, deletes any TEST-PREFIX role in `db.roles`
     that is no longer referenced by any user. Writes one `role_audit`
     row per deletion.

Excluded from deletion (kept because they may still be referenced by
other fixtures or QA workflows the user owns):
  • `custom_forms_test_*` and `custom_test_auditor_*` roles — created
    by Phase 3d/4a form-assignment tests. They live in `db.roles` but
    no live user is assigned to them post-fix; still, we leave them
    for the QA suite unless every fixture is confirmed torn down.
"""
import asyncio
import sys

sys.path.insert(0, "/app/backend")

import re
from datetime import datetime, timezone

from db import db
from models import new_id, now_iso


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    s = _SLUG_RE.sub("_", (name or "").strip().lower()).strip("_")
    return s or "role"


TEST_PREFIXES = (
    "custom_fallback_test_",
    "custom_cachebust_",
    "custom_ptest_",
    # `custom_test_*` intentionally excluded — hits QA-owned rows like
    # `custom_test_auditor_*`. If those need cleanup, run a separate
    # pass with an explicit allow-list.
)
FIXTURE_EMAILS = frozenset({
    "stephen@paneltec.com.au",
    "hseq-lead-fixture@paneltec.com.au",
    "contractor-rep-fixture@paneltec.com.au",
    "worker-fixture@paneltec.com.au",
    "pending-activation-fixture@paneltec.com.au",
})


async def _ensure_position_role(position: str, actor_email: str) -> str:
    """Return `custom_<slug(position)>`, creating the role doc if
    missing. Mirrors roles_catalogue.create_role_from_position."""
    role_id = "custom_" + _slugify(position)
    existing = await db.roles.find_one({"role_id": role_id}, {"_id": 0})
    if existing:
        return role_id
    now = now_iso()
    doc = {
        "id": new_id(),
        "role_id": role_id,
        "name": position.strip(),
        "description": (f"Auto-created from Simpro position '{position.strip()}' "
                        f"during v4d data fix. Configure permissions in Roles Admin."),
        "permission_tokens": [],
        "is_system": False,
        "is_active": True,
        "source": "simpro_position_auto",
        "supersedes_role_id": None,
        "pending_scoping_helper": False,
        "deleted_at": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.roles.insert_one(doc)
    await db.role_audit.insert_one({
        "id": new_id(),
        "role_id": role_id,
        "role_name": position.strip(),
        "action": "create_from_data_fix",
        "before": None,
        "after": doc,
        "diff": {"created_by_script": True,
                 "simpro_position": position.strip(),
                 "reason": "v4d test-artifact cleanup"},
        "actor_user_id": None,
        "actor_email": actor_email,
        "at": now,
    })
    return role_id


async def main():
    # Actor for audit rows.
    admin = await db.users.find_one({"email": "stephen@paneltec.com.au"},
                                     {"_id": 0, "id": 1, "email": 1})
    actor_id = (admin or {}).get("id")
    actor_email = "v4d-data-fix-script"

    # ─── 1. Find affected users ────────────────────────────────────
    roles = {r["role_id"]: r async for r in
             db.roles.find({}, {"_id": 0, "role_id": 1, "source": 1, "name": 1})
             .__aiter__()}
    all_role_ids = set(roles.keys())

    affected = []
    async for u in db.users.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1,
                                       "role": 1, "role_id": 1,
                                       "simpro_position": 1, "is_test_fixture": 1,
                                       "is_test": 1}):
        rid = u.get("role_id")
        if not rid:
            continue
        if u.get("email") in FIXTURE_EMAILS:
            continue
        if u.get("is_test_fixture") or u.get("is_test"):
            continue
        reason = None
        for p in TEST_PREFIXES:
            if rid.startswith(p):
                reason = f"prefix={p}"
                break
        if not reason and rid not in all_role_ids:
            reason = "orphaned_role_missing_from_db"
        if reason:
            affected.append({**u, "_reason": reason})

    print(f"\n{'=' * 68}")
    print(f"BEFORE FIX — {len(affected)} affected user(s):")
    print(f"{'=' * 68}")
    for u in affected:
        pos = u.get("simpro_position") or "-"
        print(f"  {u['id'][:8]}..  {u.get('name','')[:22]:22}  "
              f"{u.get('email','')[:38]:38}  "
              f"role_id={u.get('role_id'):40}  pos={pos:22}  "
              f"reason={u['_reason']}")

    # ─── 2. Fix each user ─────────────────────────────────────────
    fixed = []
    now = now_iso()
    for u in affected:
        old_role_id = u.get("role_id")
        pos = (u.get("simpro_position") or "").strip()
        if pos:
            new_role_id = await _ensure_position_role(pos, actor_email)
        else:
            new_role_id = "general_user"
        if old_role_id == new_role_id:
            # Should never happen given the filter, but guard just in case.
            fixed.append({**u, "_new_role_id": new_role_id, "_status": "already-correct"})
            continue
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {
                "role_id": new_role_id,
                "role": new_role_id,
                "role_locked": False,
                "role_assigned_at": now,
                "updated_at": now,
            }, "$inc": {"token_version": 1}},
        )
        await db.user_audit.insert_one({
            "id": new_id(),
            "user_id": u["id"],
            "action": "data_fix_orphaned_test_role",
            "before": {"role_id": old_role_id},
            "after": {"role_id": new_role_id},
            "diff": {"reason": "test_artifact_cleanup",
                     "orphan_reason": u["_reason"],
                     "simpro_position": pos or None},
            "actor_user_id": actor_id,
            "actor_email": actor_email,
            "at": now,
        })
        fixed.append({**u, "_new_role_id": new_role_id, "_status": "fixed"})

    # ─── 3. Delete unreferenced test-prefix roles ─────────────────
    orphan_roles_deleted = []
    for rid, rdoc in list(roles.items()):
        if not any(rid.startswith(p) for p in TEST_PREFIXES):
            continue
        # Still referenced by any user?
        still_used = await db.users.count_documents({"role_id": rid})
        if still_used:
            continue
        # Soft-delete: same pattern as roles_catalogue delete_role.
        deleted_at = now_iso()
        await db.roles.update_one(
            {"role_id": rid},
            {"$set": {"is_active": False, "deleted_at": deleted_at,
                      "updated_at": deleted_at}},
        )
        # Then hard-delete (test artifacts have no compliance value).
        await db.roles.delete_one({"role_id": rid})
        await db.role_audit.insert_one({
            "id": new_id(),
            "role_id": rid,
            "role_name": rdoc.get("name") or rid,
            "action": "delete_test_artifact",
            "before": rdoc,
            "after": None,
            "diff": {"hard_deleted": True,
                     "reason": "v4d test-artifact cleanup script"},
            "actor_user_id": actor_id,
            "actor_email": actor_email,
            "at": deleted_at,
        })
        orphan_roles_deleted.append(rid)

    # ─── 4. Report ────────────────────────────────────────────────
    print(f"\n{'=' * 68}")
    print(f"AFTER FIX")
    print(f"{'=' * 68}")
    print(f"Users fixed: {sum(1 for f in fixed if f['_status']=='fixed')}")
    print(f"Users already correct: {sum(1 for f in fixed if f['_status']=='already-correct')}")
    print(f"Orphan test-prefix roles deleted: {len(orphan_roles_deleted)}")
    for rid in orphan_roles_deleted:
        print(f"  - {rid}")
    print()
    print("Per-user diff:")
    for f in fixed:
        print(f"  {f.get('name',''):22}  {f.get('email',''):38}  "
              f"{f.get('role_id'):40}  →  {f['_new_role_id']:35}  ({f['_status']})")

    # ─── 5. Verification: Matthew + Jason ────────────────────────
    print(f"\n{'=' * 68}")
    print("VERIFICATION — Plumbers")
    print(f"{'=' * 68}")
    for match in ("matthew.*smith", "jason.*donnellan"):
        u = await db.users.find_one(
            {"$or": [{"email": {"$regex": match, "$options": "i"}},
                     {"name": {"$regex": match, "$options": "i"}}]},
            {"_id": 0, "name": 1, "email": 1, "role_id": 1, "role_locked": 1,
             "simpro_position": 1},
        )
        if u:
            print(f"  {u.get('name'):20}  {u.get('email','')[:38]:38}  "
                  f"pos={u.get('simpro_position'):20}  "
                  f"role_id={u.get('role_id'):22}  "
                  f"role_locked={u.get('role_locked')}")

    print(f"\nDone. Script is idempotent — re-running will be a no-op.")


if __name__ == "__main__":
    asyncio.run(main())
