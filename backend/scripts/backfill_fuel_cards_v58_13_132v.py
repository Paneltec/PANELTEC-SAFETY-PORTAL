"""v58.13.132v — Back-fill `fuel_cards` collection.

Creates one `fuel_cards` doc per unique `card_number` observed in
`fuel_transactions`. Deterministic + idempotent — second run modifies
0 rows.

Sources:
  · card_number       — from fuel_transactions (source of truth)
  · attribution_kind  — resolved from rego + description:
      vehicle:     transaction already has asset_id
      unassigned:  no asset_id AND (desc is person-like OR
                                    rego doesn't match any asset)
  · asset_id          — inherited from the fill's own asset_id
                        (already computed by fleet_fuel enrichment)
  · smartfill_description / smartfill_registration — echoed from
    the most recent fill for this card
  · notes             — helper text for unassigned rows
  · first_seen_at / last_seen_at — from min/max transaction date
  · fill_count        — count of fills observed

Usage:
    python scripts/backfill_fuel_cards_v58_13_132v.py           # dry-run
    python scripts/backfill_fuel_cards_v58_13_132v.py --commit  # execute
"""
from __future__ import annotations
import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from db import db  # noqa: E402

ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    # Ensure the unique index exists.
    if args.commit:
        await db.fuel_cards.create_index(
            [("org_id", 1), ("card_number", 1)], unique=True,
        )
        # Helper indexes for admin UI
        await db.fuel_cards.create_index("asset_id")
        await db.fuel_cards.create_index("worker_id")
        await db.fuel_cards.create_index("attribution_kind")

    # Aggregate fills → per-card summary.
    per_card: dict = {}
    async for t in db.fuel_transactions.find(
        {"org_id": ORG_ID, "deleted_at": None},
        {"card_number": 1, "asset_id": 1, "registration": 1,
         "description": 1, "date_iso": 1, "timestamp": 1},
    ):
        cn = (t.get("card_number") or "").strip()
        if not cn:
            continue
        entry = per_card.setdefault(cn, {
            "card_number": cn,
            "asset_ids": set(), "regos": set(),
            "descs": set(), "fill_count": 0,
            "first_seen_at": None, "last_seen_at": None,
        })
        entry["fill_count"] += 1
        if t.get("asset_id"):
            entry["asset_ids"].add(t["asset_id"])
        if t.get("registration"):
            entry["regos"].add(t["registration"])
        if t.get("description"):
            entry["descs"].add(t["description"])
        d = t.get("date_iso") or (t.get("timestamp") or "")[:10]
        if d:
            if entry["first_seen_at"] is None or d < entry["first_seen_at"]:
                entry["first_seen_at"] = d
            if entry["last_seen_at"] is None or d > entry["last_seen_at"]:
                entry["last_seen_at"] = d

    print(f"unique cards seen: {len(per_card)}")

    # Detect person-name descriptions using the workers table.
    # We don't create worker links from this back-fill (per user
    # directive — "do NOT auto-create a worker; user will assign
    # manually"). We only USE the workers list to identify which
    # descriptions look person-like → mark unassigned with notes.
    workers: list = []
    async for w in db.workers.find(
        {"org_id": ORG_ID, "deleted_at": None},
        {"first_name": 1, "last_name": 1},
    ):
        first = (w.get("first_name") or "").strip()
        last = (w.get("last_name") or "").strip()
        if first and last:
            workers.append((first.lower(), last.lower()))

    def _looks_like_person(desc: str) -> bool:
        d = (desc or "").strip().lower()
        if not d:
            return False
        parts = d.split()
        if len(parts) < 2:
            return False
        # Two-token descriptions that look like `First Last`.
        return not any(kw in d for kw in ("truck", "ute", "van", "trailer",
                                          "tipper", "iveco", "amarok",
                                          "ranger", "capvac", "cappa",
                                          "utility", "vehicle"))

    def _classify(entry: dict) -> tuple[str, str]:
        """Return (attribution_kind, notes)."""
        if entry["asset_ids"]:
            return "vehicle", ""
        # No asset_id — either person or shared or missing-asset.
        desc = next(iter(entry["descs"] or [""]), "")
        if desc.strip().lower() in ("office", "shared", "depot", "pool"):
            return "shared", f"Shared card — description: '{desc}'"
        if _looks_like_person(desc):
            return "unassigned", f"Likely driver name: '{desc}' — please assign a worker."
        reg = next(iter(entry["regos"] or [""]), "")
        if reg:
            return "unassigned", f"rego '{reg}' not found in assets — description: '{desc}'"
        return "unassigned", f"No rego, no asset — description: '{desc}'"

    now = datetime.now(timezone.utc).isoformat()
    inserted = 0
    updated = 0
    skipped = 0

    for cn, entry in sorted(per_card.items()):
        kind, notes = _classify(entry)
        asset_id = next(iter(entry["asset_ids"] or [None]), None)
        desc = next(iter(entry["descs"] or [""]), "") or None
        rego = next(iter(entry["regos"] or [""]), "") or None
        doc = {
            "card_number": cn,
            "org_id": ORG_ID,
            "attribution_kind": kind,
            "asset_id": asset_id if kind == "vehicle" else None,
            "worker_id": None,
            "smartfill_description": desc,
            "smartfill_registration": rego,
            "notes": notes,
            "fill_count": entry["fill_count"],
            "first_seen_at": entry["first_seen_at"],
            "last_seen_at": entry["last_seen_at"],
            "source": "auto",
            "assigned_by": "script:v58.13.132v",
            "assigned_at": now,
            "updated_at": now,
        }
        existing = await db.fuel_cards.find_one(
            {"org_id": ORG_ID, "card_number": cn}
        )
        if existing:
            skipped += 1
            continue
        doc["id"] = str(uuid.uuid4())
        doc["created_at"] = now
        print(f"  INSERT  card={cn:<8}  kind={kind:<11}  "
              f"asset_id={(asset_id or '-')[:8]}  desc={desc!r}")
        if args.commit:
            await db.fuel_cards.insert_one(doc)
        inserted += 1

    print(f"\ninserted: {inserted}  skipped (already-present): {skipped}  "
          f"updated: {updated}  commit={args.commit}")


if __name__ == "__main__":
    asyncio.run(main())
