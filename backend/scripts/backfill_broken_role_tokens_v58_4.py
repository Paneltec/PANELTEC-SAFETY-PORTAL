"""v160.3.9.58.4 — Backfill permission tokens for two silently-broken roles.

`custom_cleaner` and `custom_mechanic_technician` each have exactly one
user assigned but zero permission tokens — their user is effectively
locked out. This script backfills sensible tokens on the ROLE itself
(so any future user assigned to the same role also gets them) without
touching individual user records.

Token choices — reasoning inline. Both baselines are lifted from
existing, comparable roles so we don't invent a new privilege shape.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from dotenv import load_dotenv


# Reference baseline: `custom_construction_worker_l1` (16 tokens).
# A cleaner does the same field-worker daily loop (pre-start check,
# raise hazards, view SWMS, view certifications). Same shape suits.
CLEANER_TOKENS = [
    "certifications.view",
    "hazards.edit",
    "hazards.open",
    "hazards.view",
    "help.open",
    "help.view",
    "inductions.view",
    "notifications.use",
    "notifications.view",
    "pre_starts.edit",
    "pre_starts.open",
    "pre_starts.view",
    "reference_library.view",
    "site_diary.view",
    "swms.view",
    "workers.view",
]

# Reference baseline: `mechanic` seed role (11 tokens: assets, vehicles,
# documents, certifications) UNION with the field-worker basics from
# construction_worker_l1 (pre_starts + hazards + swms + notifications
# + help). A mechanic-technician still fills out daily pre-starts and
# needs to raise hazards. Set-union produces 17 tokens.
MECHANIC_TECHNICIAN_TOKENS = sorted(set([
    # mechanic baseline
    "assets.edit", "assets.open", "assets.team_view", "assets.view",
    "certifications.view",
    "documents.edit", "documents.open", "documents.view",
    "vehicles.edit", "vehicles.open", "vehicles.view",
    # field-worker basics
    "hazards.edit", "hazards.open", "hazards.view",
    "help.open", "help.view",
    "notifications.use", "notifications.view",
    "pre_starts.edit", "pre_starts.open", "pre_starts.view",
    "swms.view",
]))


TARGETS = [
    ("custom_cleaner", CLEANER_TOKENS,
     "baseline: custom_construction_worker_l1 (field-worker daily loop)"),
    ("custom_mechanic_technician", MECHANIC_TECHNICIAN_TOKENS,
     "baseline: mechanic (assets/vehicles/documents) ∪ construction_worker_l1 basics"),
]


async def main():
    load_dotenv("/app/backend/.env")
    from db import db

    print("─" * 78)
    print("v58.4 · backfill_broken_role_tokens")
    print("─" * 78)

    now = datetime.now(timezone.utc).isoformat()
    for role_id, tokens, reasoning in TARGETS:
        role = await db.roles.find_one({"role_id": role_id}, {"_id": 0})
        if not role:
            print(f"⚠  {role_id}: NOT FOUND — skipping")
            continue

        before = role.get("permission_tokens") or []
        # Merge-safe: union with whatever is already there (would be
        # empty for these two, but the union guarantees idempotency).
        merged = sorted(set(before) | set(tokens))
        added = sorted(set(merged) - set(before))
        if not added:
            print(f"  {role_id}: already has all tokens — no-op")
            continue

        await db.roles.update_one(
            {"role_id": role_id},
            {"$set": {"permission_tokens": merged, "updated_at": now}},
        )
        print(f"\n─ {role_id} ({role.get('name')}) ─")
        print(f"  before: {len(before)} tokens")
        print(f"  after:  {len(merged)} tokens (+{len(added)})")
        print(f"  added:  {added}")
        print(f"  reasoning: {reasoning}")

        audit = {
            "id": f"v58_4-backfill-{role_id}-{now.replace(':','').replace('-','')[:15]}",
            "actor": "system-cleanup-v58-4",
            "action": "backfill_role_tokens",
            "role_id": role_id,
            "tokens_added": added,
            "token_count_before": len(before),
            "token_count_after": len(merged),
            "reasoning": reasoning,
            "backfilled_at": now,
        }
        await db.admin_actions.insert_one(audit)
        print(f"  audit row: {audit['id']}")


if __name__ == "__main__":
    asyncio.run(main())
