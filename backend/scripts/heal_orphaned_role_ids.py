"""v160.3.9.57.1 — Heal `users.role_id` values that no longer point at
a live `roles` document.

Symptom this prevents:
    Users & Permissions page crashes because
    `_role_default(user, resource, action)` cannot resolve `role_id`
    → falls through to some path that raises, or renders as `undefined`
    on the frontend.

Cause it addresses:
    The v57 role purge (`purge_test_artefact_roles.py`) already
    guaranteed no user referenced the 16 test-artefact roles it
    deleted, but other historical role-delete operations across the
    lifetime of the app may have left orphans. This is a belt-and-
    braces safety pass.

Behaviour:
    1. Scan every `users` doc and check its `role_id`.
    2. Any role_id that does NOT resolve to a live `roles.id` is
       flagged as "orphaned".
    3. The `stephen@paneltec.com.au` admin is NEVER touched even if
       flagged — surface a WARN log line instead so a human can
       intervene manually.
    4. Every other orphan is reassigned to the safe default role
       `general_user` (or `admin` if `general_user` doesn't exist —
       the DB may not have that seeded).
    5. An audit row is inserted into `admin_actions` with the full
       remap ledger.

Usage:
    python3 /app/backend/scripts/heal_orphaned_role_ids.py
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient


_SAFE_DEFAULT_CANDIDATES = ["general_user", "worker", "admin"]
_VERSION_TAG = "paneltec-v160.3.9.57.1"
_ADMIN_EMAIL_PROTECTED = "stephen@paneltec.com.au"


async def main() -> int:
    load_dotenv("/app/backend/.env")
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "paneltec")]

    # Build the live role_id set. Cover both `.id` and the alternate
    # `.role_id` key that some seed rows use.
    live_ids: set[str] = set()
    async for r in db.roles.find({}, {"_id": 0, "id": 1, "role_id": 1}):
        if r.get("id"):
            live_ids.add(r["id"])
        if r.get("role_id"):
            live_ids.add(r["role_id"])

    print(f"=== Live roles collection has {len(live_ids)} distinct id/role_id values ===")

    # Pick a safe default.
    safe_default: str | None = None
    for cand in _SAFE_DEFAULT_CANDIDATES:
        if cand in live_ids:
            safe_default = cand
            break
    if not safe_default:
        print("ABORT — none of the safe-default candidates exist in the roles collection:")
        print(f"  looked for: {_SAFE_DEFAULT_CANDIDATES}")
        return 1
    print(f"Safe default role for heal target → {safe_default!r}")

    # Scan users.
    orphans: list[dict] = []
    protected_orphans: list[dict] = []
    async for u in db.users.find({}, {"_id": 0, "id": 1, "email": 1, "role_id": 1}):
        rid = u.get("role_id")
        if rid and rid in live_ids:
            continue
        (protected_orphans if u.get("email") == _ADMIN_EMAIL_PROTECTED else orphans).append(u)

    print(f"\nFound {len(orphans)} orphaned user role_id(s) to heal.")
    for u in orphans:
        print(f"  - {u.get('email')!r}  role_id={u.get('role_id')!r} → {safe_default!r}")

    if protected_orphans:
        print(
            f"\nWARN — {len(protected_orphans)} PROTECTED user(s) also flagged as orphaned. "
            f"NOT auto-healed. Manual intervention required:"
        )
        for u in protected_orphans:
            print(f"  ! {u.get('email')!r} role_id={u.get('role_id')!r}")

    if not orphans:
        print("\nNothing to heal. Exiting.")
        return 0

    # Bulk update — one $set per orphan so we can log the previous value.
    ledger: list[dict] = []
    for u in orphans:
        prev = u.get("role_id")
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {"role_id": safe_default, "role": safe_default}},
        )
        ledger.append({"user_id": u["id"], "email": u.get("email"),
                       "prev_role_id": prev, "new_role_id": safe_default})

    await db.admin_actions.insert_one({
        "actor": "system-cleanup-v57-1",
        "action": "heal_orphaned_role_ids",
        "safe_default": safe_default,
        "ledger": ledger,
        "healed_count": len(ledger),
        "protected_but_orphaned": [u.get("email") for u in protected_orphans],
        "run_at": datetime.now(timezone.utc).isoformat(),
        "version": _VERSION_TAG,
    })
    print(f"\nHealed {len(ledger)} user(s). Audit row inserted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
