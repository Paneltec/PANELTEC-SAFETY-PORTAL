#!/usr/bin/env python3
"""Account recovery for the Paneltec Safety Portal — run INSIDE the backend
container by whoever hosts it (no app login needed).

    docker exec -it <backend container> python scripts/account_recovery.py --list
    docker exec -it <backend container> python scripts/account_recovery.py --unlock stephen@example.com
    docker exec -it <backend container> python scripts/account_recovery.py --set-password stephen@example.com
        (prompts for the new password; or add --password 'NewPass123' to skip the prompt)
    docker exec -it <backend container> python scripts/account_recovery.py --unlock-all

--list prints each user's email, name, role and whether they are locked.
Nothing here ever prints or stores a password in the clear beyond what
you type in.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import db  # noqa: E402
from auth import hash_password  # noqa: E402
from models import now_iso  # noqa: E402

UNLOCK = {"failed_login_attempts": 0, "locked_until": None, "last_failed_login_at": None}


async def list_users() -> None:
    rows = await db.users.find(
        {}, {"_id": 0, "email": 1, "name": 1, "role": 1, "role_id": 1, "locked_until": 1,
             "failed_login_attempts": 1, "status": 1, "org_id": 1}).sort("email", 1).to_list(1000)
    print(f"{'email':40} {'name':28} {'role':16} {'status':10} lock")
    for u in rows:
        lock = ""
        if u.get("locked_until"):
            lock = f"locked until {u['locked_until'][:16]}"
        elif u.get("failed_login_attempts"):
            lock = f"{u['failed_login_attempts']} failed tries"
        print(f"{(u.get('email') or ''):40} {(u.get('name') or '')[:28]:28} "
              f"{(u.get('role_id') or u.get('role') or ''):16} {(u.get('status') or 'active'):10} {lock}")
    print(f"\n{len(rows)} user(s)")


async def unlock(email: str | None) -> None:
    q = {"email": email.lower()} if email else {}
    r = await db.users.update_many(q, {"$set": UNLOCK})
    print(f"Unlocked {r.modified_count} account(s)" if r.matched_count else "No such user")


async def set_password(email: str, password: str) -> None:
    u = await db.users.find_one({"email": email.lower()}, {"_id": 0, "id": 1, "name": 1})
    if not u:
        print(f"No user with email {email}")
        sys.exit(1)
    if len(password) < 8:
        print("Password must be at least 8 characters")
        sys.exit(1)
    await db.users.update_one({"id": u["id"]}, {"$set": {
        "password_hash": hash_password(password), **UNLOCK,
        "must_change_password": False, "password_changed_at": now_iso(),
        "reset_token_hash": None, "reset_expires_at": None,
    }})
    print(f"Password updated for {u.get('name') or email}. They can sign in now.")


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list users and lock status")
    ap.add_argument("--unlock", metavar="EMAIL", help="clear the lock/failed-attempt count for one user")
    ap.add_argument("--unlock-all", action="store_true", help="clear locks for every user")
    ap.add_argument("--set-password", metavar="EMAIL", help="set a new password for one user")
    ap.add_argument("--password", help="the new password (otherwise you are prompted)")
    a = ap.parse_args()
    if a.list:
        await list_users()
    elif a.unlock:
        await unlock(a.unlock)
    elif a.unlock_all:
        await unlock(None)
    elif a.set_password:
        pw = a.password or getpass.getpass("New password: ")
        if not a.password and pw != getpass.getpass("Again: "):
            print("Passwords did not match"); sys.exit(1)
        await set_password(a.set_password, pw)
    else:
        ap.print_help()


if __name__ == "__main__":
    asyncio.run(main())
