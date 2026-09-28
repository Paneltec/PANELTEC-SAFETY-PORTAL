"""v58.13.132p3c - one-off auto-link: match users to workers by email.

Walks every doc in the users collection, looks up a matching worker
by case-insensitive email, and sets worker.user_id = user.id so the
mobile /api/me/leave/* endpoints can resolve the callers worker record.

Idempotent - safe to re-run after HR adds new worker records.
Does NOT create new workers or modify any field other than user_id.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")


async def main() -> int:
    from db import db

    users = await db.users.find({}, {"_id": 0, "id": 1, "email": 1, "name": 1}).to_list(10_000)
    workers = await db.workers.find({}, {"_id": 0, "id": 1, "email": 1, "user_id": 1,
                                         "first_name": 1, "last_name": 1}).to_list(10_000)

    print(f"Total users:   {len(users)}")
    print(f"Total workers: {len(workers)}")
    print()

    worker_by_email: dict[str, dict] = {}
    for w in workers:
        e = (w.get("email") or "").strip().lower()
        if e:
            worker_by_email[e] = w

    linked_this_run = 0
    already_linked = 0
    unlinked_users: list[str] = []
    user_ids_in_workers: set[str] = set()

    for u in users:
        uid = u.get("id")
        uemail = (u.get("email") or "").strip().lower()
        if not uemail or not uid:
            unlinked_users.append(uemail or "(no email)")
            continue

        w = worker_by_email.get(uemail)
        if not w:
            unlinked_users.append(uemail)
            continue

        wid = w.get("id")
        user_ids_in_workers.add(wid)
        existing_uid = w.get("user_id")

        if existing_uid == uid:
            already_linked += 1
            continue

        await db.workers.update_one(
            {"id": wid},
            {"$set": {"user_id": uid}},
        )
        linked_this_run += 1
        action = "LINKED" if not existing_uid else f"RELINKED (was {existing_uid})"
        print(f"  {action}: user {uid} ({uemail}) -> worker {wid}")

    user_emails = {(u.get("email") or "").strip().lower() for u in users}
    orphan_workers: list[str] = []
    for w in workers:
        we = (w.get("email") or "").strip().lower()
        if we and we not in user_emails:
            orphan_workers.append(we)

    print()
    print("=" * 60)
    print(f"Linked this run:     {linked_this_run}")
    print(f"Already linked:      {already_linked}")
    print(f"Unlinked users:      {len(unlinked_users)}")
    print(f"Orphan workers:      {len(orphan_workers)}")
    print("=" * 60)

    if unlinked_users:
        print(f"\nUnlinked users (no matching worker) - showing up to 20:")
        for e in unlinked_users[:20]:
            print(f"  - {e}")
        if len(unlinked_users) > 20:
            print(f"  ... and {len(unlinked_users) - 20} more")

    if orphan_workers:
        print(f"\nOrphan workers (no matching user account) - showing up to 20:")
        for e in orphan_workers[:20]:
            print(f"  - {e}")
        if len(orphan_workers) > 20:
            print(f"  ... and {len(orphan_workers) - 20} more")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
