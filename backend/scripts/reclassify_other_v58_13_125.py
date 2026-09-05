"""v58.13.125 — Retroactive reclassify of `asset_type='other'` rows.

## Context
`.125` widens `VEHICLE_TYPE_KEYWORDS` in `backend/forms.py` to catch
13 body-types (D-Max, BT-50, Landcruiser, HiAce, DAF Tilt Tray,
Hino Carbon/Curtain, Flocon, Gas Truck, Prime Mover, Rammer, etc.)
that previously fell through to `"other"`.

This script re-runs the widened classifier over every existing
`asset_type='other'` (case-insensitive) row and writes the new slug
in place. Idempotent — a second run finds nothing.

## Usage
    Dry-run (default):
        python /app/backend/scripts/reclassify_other_v58_13_125.py
    Live commit:
        python /app/backend/scripts/reclassify_other_v58_13_125.py --commit

## Audit + rollback
Every touched row is stamped:
    _reclassified_v125:      true
    _prior_asset_type:       "<raw value before>"
    _reclassified_at:        <ISO timestamp>

Reverse via `--reverse` — restores `asset_type` from `_prior_asset_type`
and unsets the audit markers.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv


async def main(commit: bool, reverse: bool) -> int:
    load_dotenv("/app/backend/.env")
    sys.path.insert(0, "/app/backend")
    from db import db  # noqa: E402
    from forms import _classify_vehicle_type  # noqa: E402
    from asset_taxonomy import normalize_asset_type  # noqa: E402

    if reverse:
        print("─" * 78)
        print("v58.13.125 · reclassify_other  mode=REVERSE")
        print("─" * 78)
        n = 0
        cursor = db.assets.find(
            {"_reclassified_v125": True},
            {"_id": 1, "id": 1, "_prior_asset_type": 1},
        )
        async for row in cursor:
            await db.assets.update_one(
                {"_id": row["_id"]},
                {"$set": {"asset_type": row.get("_prior_asset_type") or "other"},
                 "$unset": {"_reclassified_v125": "",
                            "_prior_asset_type": "",
                            "_reclassified_at": ""}},
            )
            n += 1
        print(f"REVERSE complete: {n} row(s) restored.")
        return 0

    mode = "LIVE COMMIT" if commit else "DRY-RUN (read-only)"
    print("─" * 78)
    print(f"v58.13.125 · reclassify_other  mode={mode}")
    print("─" * 78)

    q = {"asset_type": {"$regex": r"^other$", "$options": "i"}}
    docs = []
    async for a in db.assets.find(q, {"_id": 0, "id": 1, "org_id": 1, "name": 1, "asset_type": 1}):
        docs.append(a)

    would_change = 0
    unchanged = 0
    proposals: list[tuple[str, str, str, str]] = []  # (id, name, before, after)
    for a in docs:
        nm = a.get("name") or ""
        # Classifier operates on label + tag_names; we don't have tag
        # names for existing rows, so classify by name alone.
        raw_slug = _classify_vehicle_type(nm, tag_names=None)
        canonical = normalize_asset_type(raw_slug) or raw_slug
        if raw_slug == "other":
            unchanged += 1
            continue
        proposals.append((a["id"], nm[:50], a.get("asset_type", ""), canonical))
        would_change += 1

    print(f"BEFORE: {len(docs)} rows with asset_type ~ /^other$/i")
    print(f"Proposals:")
    for _id, nm, before, after in proposals:
        print(f"  {_id[:8]}  {nm:52} {before!r:10} → {after!r}")
    print(f"\nWould change: {would_change}   Unchanged: {unchanged}")

    if not commit:
        print("\nDRY-RUN complete — no rows written. Re-run with --commit.")
        return 0

    now = datetime.now(timezone.utc).isoformat()
    modified = 0
    for _id, nm, before, after in proposals:
        r = await db.assets.update_one(
            {"id": _id, "_reclassified_v125": {"$ne": True}},  # idempotent
            {"$set": {
                "asset_type": after,
                "_reclassified_v125": True,
                "_prior_asset_type": before,
                "_reclassified_at": now,
            }},
        )
        modified += r.modified_count
    print(f"\nCOMMIT complete: {modified} row(s) reclassified.")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--commit", action="store_true", help="Apply writes. Default is dry-run.")
    p.add_argument("--reverse", action="store_true", help="Restore prior asset_type.")
    args = p.parse_args()
    if args.commit and args.reverse:
        print("ERROR: --commit and --reverse are mutually exclusive.")
        sys.exit(2)
    sys.exit(asyncio.run(main(commit=args.commit, reverse=args.reverse)))
