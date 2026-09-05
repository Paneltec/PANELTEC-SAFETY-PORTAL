"""v58.13.129 — Enrich empty `name`/`asset_type` from plant_maintenance history.

## Context
28 assets in Stephen's org (20 trailers + 7 vehicles + 1 plant) carry
no `name` at all — the backfill from `.120a` populated `description`
only. Their pm rows in `plant_maintenance` DO carry a `description`
(and often a `sub_type`) that reads sensibly as a name.

## Selection rule
Per asset with empty `name`:
  1. Match pm rows where `registration_no == rego` OR `plant_id == asset.id`
  2. Filter to non-empty `description`
  3. Sort `date_completed DESC`, tie-break `len(description) DESC`
  4. Pick the top row; write:
     · `name` ← that description
     · `asset_type` ← that sub_type (canonicalised via `normalize_asset_type`)
       IF the current asset_type is empty OR normalises to the same value
       (never overwrite a more-specific existing bucket per user Q2)

## Guards
- Never overwrite an already-populated `name`.
- Audit markers `name_enriched_v129=true`, `name_before_v129`,
  `asset_type_before_v129`, `name_enriched_at`.
- Idempotent: filter includes `name_enriched_v129: {$ne: True}`.

## Usage
  Dry-run: python /app/backend/scripts/enrich_asset_names_v58_13_129.py
  Commit:  python /app/backend/scripts/enrich_asset_names_v58_13_129.py --commit
  Reverse: python /app/backend/scripts/enrich_asset_names_v58_13_129.py --reverse
"""
from __future__ import annotations
import argparse
import asyncio
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv


async def _pick_pm(db, asset):
    """Best pm row for enrichment. Latest date, tie-break longest desc."""
    rego = asset.get("rego_serial")
    q = {"$and": [
        {"description": {"$nin": [None, ""]}},
        {"$or": [
            {"registration_no": rego} if rego else {"registration_no": "__nope__"},
            {"plant_id": asset["id"]},
        ]},
    ]}
    rows = []
    async for pm in db.plant_maintenance.find(q, {
        "_id": 0, "id": 1, "description": 1, "sub_type": 1, "date_completed": 1,
    }):
        rows.append(pm)
    if not rows:
        return None
    rows.sort(
        key=lambda p: (p.get("date_completed") or "", len(p.get("description") or "")),
        reverse=True,
    )
    return rows[0]


async def main(commit: bool, reverse: bool) -> int:
    load_dotenv("/app/backend/.env")
    sys.path.insert(0, "/app/backend")
    from db import db  # noqa: E402
    from asset_taxonomy import normalize_asset_type  # noqa: E402

    if reverse:
        print("─" * 78)
        print("v58.13.129 · enrich_asset_names  mode=REVERSE")
        print("─" * 78)
        n = 0
        async for row in db.assets.find(
            {"name_enriched_v129": True},
            {"_id": 1, "id": 1, "name_before_v129": 1, "asset_type_before_v129": 1},
        ):
            set_doc = {"name": row.get("name_before_v129")}
            if "asset_type_before_v129" in row:
                set_doc["asset_type"] = row.get("asset_type_before_v129")
            await db.assets.update_one(
                {"_id": row["_id"]},
                {"$set": set_doc,
                 "$unset": {"name_enriched_v129": "",
                            "name_before_v129": "",
                            "asset_type_before_v129": "",
                            "name_enriched_at": ""}},
            )
            n += 1
        print(f"REVERSE complete: {n} row(s) restored.")
        return 0

    mode = "LIVE COMMIT" if commit else "DRY-RUN (read-only)"
    print("─" * 78)
    print(f"v58.13.129 · enrich_asset_names  mode={mode}")
    print("─" * 78)

    # Assets with empty name AND not yet enriched.
    q = {
        "$or": [{"name": None}, {"name": ""}],
        "name_enriched_v129": {"$ne": True},
        "deleted_at": None,
    }
    proposals: list[dict] = []
    async for a in db.assets.find(q):
        pm = await _pick_pm(db, a)
        if not pm:
            continue
        cur_at = (a.get("asset_type") or "").strip()
        pm_st_raw = (pm.get("sub_type") or "").strip()
        pm_st_canon = normalize_asset_type(pm_st_raw) or pm_st_raw

        # Q2 rule: only fill asset_type when empty OR when the current value
        # normalises to the SAME canonical bucket. Never overwrite a
        # more-specific value with a generic pm slug.
        new_at = cur_at
        if not cur_at:
            new_at = pm_st_canon or cur_at
        elif normalize_asset_type(cur_at) == pm_st_canon:
            new_at = pm_st_canon  # canonicalise casing in-place
        proposals.append({
            "id": a["id"],
            "rego": a.get("rego_serial") or "—",
            "before_name": a.get("name") or "",
            "after_name": pm.get("description") or "",
            "before_at": cur_at,
            "after_at": new_at,
            "pm_id": pm.get("id"),
        })

    print(f"BEFORE assets with empty name: {len(proposals)}")
    print(f"\n{'rego':10} {'before_at':14} {'after_at':14} name")
    for p in proposals:
        marker = "→" if p["before_at"] != p["after_at"] else " "
        print(f"  {p['rego']:10} {p['before_at']!r:14} {marker}{p['after_at']!r:13} {p['after_name'][:70]!r}")

    if not commit:
        print("\nDRY-RUN complete — no rows written. Re-run with --commit.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    modified = 0
    for p in proposals:
        r = await db.assets.update_one(
            {"id": p["id"], "name_enriched_v129": {"$ne": True}},
            {"$set": {
                "name": p["after_name"],
                "asset_type": p["after_at"] or None,
                "name_enriched_v129": True,
                "name_before_v129": p["before_name"],
                "asset_type_before_v129": p["before_at"],
                "name_enriched_at": now,
            }},
        )
        modified += r.modified_count
    print(f"\nCOMMIT complete: {modified} row(s) enriched.")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true")
    p.add_argument("--reverse", action="store_true")
    args = p.parse_args()
    if args.commit and args.reverse:
        print("ERROR: --commit and --reverse are mutually exclusive.")
        sys.exit(2)
    sys.exit(asyncio.run(main(commit=args.commit, reverse=args.reverse)))
