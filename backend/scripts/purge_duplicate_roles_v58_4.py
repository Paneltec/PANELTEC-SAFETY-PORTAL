"""v160.3.9.58.4 — Prune 4 duplicate / placeholder roles.

Post-audit clean-up. All four IDs below have zero assigned users and
either duplicate an existing role or carry zero permission tokens.

Before deleting, this script:
  1. Prints each row's full doc for the audit trail.
  2. Aborts if ANY of the four now has a user assignment (defence
     against a concurrent role change since the audit).
  3. Writes a single `admin_actions` audit row listing the deleted IDs.

Idempotent — safe to re-run. Missing rows are skipped with a note.
No touching of the users collection.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone

from dotenv import load_dotenv


TARGETS = [
    # role_id, id, expected_name
    ("d6722b1e-168e-41a1-9018-450545c4e8a1", "d6722b1e-168e-41a1-9018-450545c4e8a1", "Cleaner"),   # admin_created UUID duplicate of `custom_cleaner`
    ("custom_construction_worker", None, "Construction Worker"),                                   # 0 tokens, superseded by L1/L2/L3/CW2
    ("custom_mechanic", None, "MECHANIC"),                                                          # 0 tokens, duplicates `mechanic`
    ("custom_newrole", None, "NewRole"),                                                            # obvious placeholder
]


async def _find_role(db, role_id: str, fallback_id: str | None):
    if role_id:
        r = await db.roles.find_one({"role_id": role_id}, {"_id": 0})
        if r:
            return r, "role_id"
    if fallback_id:
        r = await db.roles.find_one({"id": fallback_id}, {"_id": 0})
        if r:
            return r, "id"
    return None, None


async def _user_count(db, role_id: str | None, id_: str | None) -> int:
    """Match users on either `role_id` or `role` (legacy)."""
    or_clauses = []
    for v in (role_id, id_):
        if v:
            or_clauses.append({"role_id": v})
            or_clauses.append({"role": v})
    if not or_clauses:
        return 0
    return await db.users.count_documents({"$or": or_clauses})


async def main():
    load_dotenv("/app/backend/.env")
    from db import db

    print("─" * 78)
    print("v58.4 · purge_duplicate_roles — pre-flight audit")
    print("─" * 78)

    resolved = []  # list of (doc, key_used)
    for rid, fallback, expected_name in TARGETS:
        doc, key = await _find_role(db, rid, fallback)
        if not doc:
            print(f"⚠  {rid}: NOT FOUND — already purged? Skipping.")
            continue
        actual_name = doc.get("name")
        if expected_name and actual_name != expected_name:
            print(f"⚠  {rid}: name mismatch (expected {expected_name!r}, "
                  f"got {actual_name!r}) — ABORTING for safety")
            return
        n_users = await _user_count(db, doc.get("role_id"), doc.get("id"))
        if n_users > 0:
            print(f"⚠  {rid}: {n_users} user(s) now assigned — ABORTING; "
                  f"someone re-attached this role after the audit")
            return
        print(f"\n─ target: {rid}  (matched via `{key}`) ─")
        print(json.dumps(doc, indent=2, default=str))
        print(f"  → 0 users, safe to delete")
        resolved.append((doc, key))

    if not resolved:
        print("\nnothing to delete.")
        return

    print("\n" + "─" * 78)
    print(f"deleting {len(resolved)} role(s)…")
    print("─" * 78)

    deleted_ids: list[str] = []
    for doc, key in resolved:
        filt = {key: doc[key]}
        r = await db.roles.delete_one(filt)
        rid_for_log = doc.get("role_id") or doc.get("id")
        deleted_ids.append(rid_for_log)
        print(f"  deleted {rid_for_log}  (matched={r.deleted_count})")

    audit = {
        "id": f"v58_4-purge-dup-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}",
        "actor": "system-cleanup-v58-4",
        "action": "purge_duplicate_roles",
        "ids": deleted_ids,
        "reason": "post-audit prune of duplicate/placeholder roles with 0 users",
        "deleted_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_actions.insert_one(audit)
    print(f"\naudit row written to admin_actions: {audit['id']}")


if __name__ == "__main__":
    asyncio.run(main())
