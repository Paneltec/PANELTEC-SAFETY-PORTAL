"""v58.13.132bh — Rename the `admin` seed role's display name from
"Administrator" to "Admin".

Idempotent one-liner script. Belt-and-braces companion to the
`roles_catalogue.SYSTEM_ROLES` constant change: on backend startup
`seed_system_roles()` will re-apply the new name via its `$set`, so
running this script is only strictly needed to avoid a backend
restart. Safe to re-run.

Usage:
    python scripts/rename_admin_role_v58_13_132bh.py             # dry-run
    python scripts/rename_admin_role_v58_13_132bh.py --commit
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402

OLD_NAME = "Administrator"
NEW_NAME = "Admin"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    role = await db.roles.find_one({"role_id": "admin"},
                                   {"_id": 0, "role_id": 1, "name": 1})
    if not role:
        print("roles.admin not found — is the catalogue seeded? Aborting.")
        return
    print(f"Current: roles.admin.name = {role.get('name')!r}")

    if role.get("name") == NEW_NAME:
        print(f"(no-op — already {NEW_NAME!r})")
        return

    print(f"Would rename → {NEW_NAME!r}")

    if not args.commit:
        print("(dry-run — no writes)")
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    result = await db.roles.update_one(
        {"role_id": "admin"},
        {"$set": {
            "name": NEW_NAME,
            "updated_at": now_iso,
            "_display_name_rename_at": now_iso,
            "_display_name_rename_version": "v58.13.132bh",
            "_display_name_previous": OLD_NAME,
        }},
    )
    print(f"WROTE: matched={result.matched_count} modified={result.modified_count}")

    # Bust the in-process cache (no-op cross-process but harmless).
    try:
        from permissions import _bust_role_cache
        _bust_role_cache("admin")
    except Exception:  # noqa: BLE001
        pass

    print("Restart the backend supervisor to invalidate any live "
          "in-memory role caches: `sudo supervisorctl restart backend`")


if __name__ == "__main__":
    asyncio.run(main())
