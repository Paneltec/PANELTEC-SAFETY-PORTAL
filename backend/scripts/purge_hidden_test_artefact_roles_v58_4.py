"""v160.3.9.58.4 — Physically delete hidden pytest artefact roles.

Targets any role matching one of the three test-fixture naming patterns
that a previous pytest run left behind in `db.roles`. All rows carry
`is_active=False` so they're already hidden from the frontend, but they
still take up index space and clutter the audit trail.

Guardrails:
  · Only deletes rows where source != 'seed'.
  · Aborts if ANY targeted row is currently assigned to a user.
  · Writes a single `admin_actions` audit row with the full ID list.

Idempotent — safe to re-run.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

from dotenv import load_dotenv


PATTERNS = [
    re.compile(r"^custom_forms_test_[0-9a-f]{8}$"),
    re.compile(r"^custom_test_auditor_[0-9a-f]{8}$"),
    re.compile(r"^custom_schema_filter_[0-9a-f]{8}$"),
]


def _matches_pattern(role_id: str | None) -> bool:
    if not role_id:
        return False
    return any(p.match(role_id) for p in PATTERNS)


async def main():
    load_dotenv("/app/backend/.env")
    from db import db

    print("─" * 78)
    print("v58.4 · purge_hidden_test_artefact_roles — pre-flight audit")
    print("─" * 78)

    candidates: list[dict] = []
    async for r in db.roles.find({}, {"_id": 0}):
        rid = r.get("role_id")
        if not _matches_pattern(rid):
            continue
        if r.get("source") == "seed":
            print(f"⚠  {rid}: source=seed — skipping (must never delete a seed role)")
            continue
        candidates.append(r)

    print(f"\nfound {len(candidates)} candidate rows.")

    # Guardrail: no candidate may be assigned to a user.
    for r in candidates:
        rid = r.get("role_id")
        row_id = r.get("id")
        or_clauses = [{"role_id": rid}, {"role": rid}]
        if row_id:
            or_clauses.append({"role_id": row_id})
        n = await db.users.count_documents({"$or": or_clauses})
        if n > 0:
            print(f"⚠  {rid}: {n} user(s) assigned — ABORTING (test artefact "
                  f"is somehow live; needs manual triage)")
            return

    print("all candidates have 0 users — safe to delete.")

    ids_deleted: list[str] = []
    for r in candidates:
        rid = r.get("role_id")
        res = await db.roles.delete_one({"role_id": rid})
        if res.deleted_count:
            ids_deleted.append(rid)
            print(f"  deleted {rid}")

    audit = {
        "id": f"v58_4-purge-tests-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}",
        "actor": "system-cleanup-v58-4",
        "action": "purge_hidden_test_artefact_roles",
        "ids": ids_deleted,
        "count": len(ids_deleted),
        "reason": "pytest fixtures left in db.roles with is_active=False",
        "deleted_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_actions.insert_one(audit)
    print(f"\naudit row: {audit['id']}  ({len(ids_deleted)} row(s) purged)")


if __name__ == "__main__":
    asyncio.run(main())
