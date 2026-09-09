"""v58.13.131o — Backfill `resolved_driver_name` on existing fuel_transactions.

Runs once (idempotent — re-runs are cheap and just recompute). Iterates
every fuel_transactions doc in the org, resolves the card_number → worker
via the (worker.smartfill_card_numbers) index, and sets
`resolved_driver_name` + `resolved_driver_worker_id` where a match is
found.

Usage:
    cd /app/backend && python scripts/backfill_resolved_driver_name_v58_13_131o.py --org-id ORG [--commit]

Without `--commit` the script prints what it WOULD update but doesn't
touch Mongo. Add `--commit` to persist. Add `--all-orgs` to iterate
every org that has any workers with smartfill_card_numbers set.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from typing import Optional

sys.path.insert(0, "/app/backend")

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402
from fleet_fuel import (  # noqa: E402
    _compute_price_per_litre, _load_card_worker_index, resolve_driver_by_card,
)
from models import now_iso  # noqa: E402


async def _list_orgs_with_cards() -> list[str]:
    """v58.13.131o (post-ship amendment) — Now picks any org with
    EITHER linked cards OR fuel transactions, so the
    `computed_price_per_litre` backfill also runs for orgs that
    have fuel data but no card links yet."""
    orgs = set()
    async for w in db.workers.find(
        {"deleted_at": None,
         "smartfill_card_numbers": {"$exists": True, "$ne": []}},
        {"_id": 0, "org_id": 1},
    ):
        if w.get("org_id"):
            orgs.add(w["org_id"])
    async for t in db.fuel_transactions.find(
        {"deleted_at": None,
         "computed_price_per_litre": {"$exists": False},
         "total_price": {"$gt": 0}, "litres": {"$gt": 0}},
        {"_id": 0, "org_id": 1},
    ).limit(500):
        if t.get("org_id"):
            orgs.add(t["org_id"])
    return sorted(orgs)


async def backfill_org(org_id: str, commit: bool) -> dict:
    """Backfill both `resolved_driver_name` (card→worker linkage)
    AND `computed_price_per_litre` (total_price ÷ litres) on every
    fuel_transactions doc in the org. Both are independent — a row
    can gain one without the other. Idempotent."""
    index = await _load_card_worker_index(org_id)

    scanned = 0
    would_update = 0
    updated = 0
    price_would = price_updated = 0
    unresolved: dict[str, int] = {}

    async for tx in db.fuel_transactions.find(
        {"org_id": org_id, "deleted_at": None},
        {"_id": 0, "id": 1, "card_number": 1, "date_iso": 1,
         "resolved_driver_name": 1, "resolved_driver_worker_id": 1,
         "litres": 1, "total_price": 1, "computed_price_per_litre": 1},
    ):
        scanned += 1
        updates: dict = {}

        # ── (1) card → worker resolution ───────────────────
        card = (tx.get("card_number") or "").strip()
        if card:
            match = resolve_driver_by_card(
                card_number=card, date_iso=tx.get("date_iso"), index=index
            )
            if not match:
                unresolved[card] = unresolved.get(card, 0) + 1
            elif not (
                tx.get("resolved_driver_name") == match["worker_name"]
                and tx.get("resolved_driver_worker_id") == match["worker_id"]
            ):
                updates["resolved_driver_name"] = match["worker_name"]
                updates["resolved_driver_worker_id"] = match["worker_id"]

        # ── (2) computed price per litre ───────────────────
        # v58.13.131o (post-ship amendment) — backfill this per row
        # from Total Price ÷ Litres (Ignore stale SmartFill unit_price).
        cpl = _compute_price_per_litre(tx.get("total_price"), tx.get("litres"))
        if cpl is not None and tx.get("computed_price_per_litre") != cpl:
            updates["computed_price_per_litre"] = cpl
            price_would += 1

        # Only write if the doc actually changes.
        if not updates:
            continue
        would_update += 1
        if commit:
            updates["_resolved_driver_backfilled_at"] = now_iso()
            updates["updated_at"] = now_iso()
            await db.fuel_transactions.update_one(
                {"id": tx["id"], "org_id": org_id},
                {"$set": updates},
            )
            updated += 1
            if "computed_price_per_litre" in updates:
                price_updated += 1

    return {
        "org_id": org_id,
        "cards_in_index": len(index),
        "scanned": scanned,
        "would_update": would_update,
        "updated": updated,
        "price_would_update": price_would,
        "price_updated": price_updated,
        "unresolved_cards": unresolved,
    }


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--org-id", help="Single org to process")
    ap.add_argument("--all-orgs", action="store_true",
                    help="Iterate every org with any linked cards")
    ap.add_argument("--commit", action="store_true",
                    help="Persist changes (default: dry-run)")
    args = ap.parse_args()

    if not args.org_id and not args.all_orgs:
        ap.error("Provide either --org-id or --all-orgs")

    orgs = [args.org_id] if args.org_id else await _list_orgs_with_cards()
    print(f"backfill target orgs: {len(orgs)}  commit={args.commit}")

    total_scanned = total_would = total_updated = 0
    for org_id in orgs:
        r = await backfill_org(org_id, commit=args.commit)
        print(f"  org={org_id[:12]}…  "
              f"cards={r['cards_in_index']}  scanned={r['scanned']}  "
              f"would_update={r['would_update']}  updated={r['updated']}  "
              f"price/L_would={r['price_would_update']}  "
              f"price/L_updated={r['price_updated']}  "
              f"unresolved_uniq={len(r['unresolved_cards'])}")
        top_unresolved = sorted(
            r["unresolved_cards"].items(), key=lambda kv: -kv[1]
        )[:10]
        for cn, n in top_unresolved:
            print(f"      unresolved  card={cn}  txns={n}")
        total_scanned += r["scanned"]
        total_would += r["would_update"]
        total_updated += r["updated"]

    print(f"\nSummary: scanned={total_scanned} "
          f"would_update={total_would} updated={total_updated}")


if __name__ == "__main__":
    asyncio.run(main())
