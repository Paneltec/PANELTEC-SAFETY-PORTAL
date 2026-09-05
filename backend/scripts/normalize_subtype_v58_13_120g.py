"""v58.13.120g — sub_type / asset_type normalisation dry-run.

USER PAIN (verbatim): "vacuum trucks and vac truck are the same".

Two collections carry free-text sub-type labels:
  · `assets.asset_type` — 17 distinct values, primary field
    consumed by the Fleet Register filter tree (rendered as "Sub-type").
  · `plant_maintenance.sub_type` — 9 distinct values, used by the
    fleet search + drawer detail.

The current mix contains casing / underscore / abbreviation
duplicates that create phantom filter buckets:
  · `'Vac Truck'` (5) + `'vacuum_truck'` (13) → both mean the same
    thing and should collapse to `'Vacuum Truck'`.
  · `'Excavator'` (5) + `'excavator'` (1) → same.
  · `'Trailer'` (20) — already canonical, but present alongside
    `'trailer'` in some rows.

## Behaviour
  · Dry-run by default. Prints:
      - Per-collection value distribution.
      - Proposed canonical mapping table.
      - Row-count preview per mapping.
      - Rows that would be modified vs untouched.
    NO writes. Idempotent.
  · `--commit` performs the writes: `update_many({field: raw},
    {$set: {field: canonical, sub_type_normalised_v120g: true,
             sub_type_before_v120g: raw}})` per bucket.
    Stamps every touched row with the audit marker fields so the
    reverse script (below) can restore.
  · `--reverse` undoes the commit: `update_many({sub_type_
    normalised_v120g: true}, {$set: {field: sub_type_before_v120g},
    $unset: {sub_type_normalised_v120g: '', sub_type_before_v120g:
    ''}})`. Idempotent.

## Canonical mapping
  Chosen by (a) most-populous existing casing, (b) fall through
  to Title Case when a snake_case form dominates. Confirmed once
  with the user; see `_CANONICAL_MAP` below.

## Rules of engagement
  · Dry-run first, publish counts, PAUSE for green-light before
    `--commit`.
  · Reverse script covers every field this script touches.
  · Explicit --dry-run flag accepted as no-op for wrapper callers.
"""
from __future__ import annotations
import argparse
import asyncio
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

# Fail fast without silent defaults.
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# ── Canonical mapping ─────────────────────────────────────────────
# Structure: raw_value -> canonical_value. Missing keys pass through.
# Keys are compared case-sensitively; a raw value not in this table
# is untouched.
_CANONICAL_MAP: dict[str, str] = {
    # Vacuum trucks — the loudest duplicate.
    "vacuum_truck":  "Vacuum Truck",
    "Vac Truck":     "Vacuum Truck",
    "VACUUM TRUCK":  "Vacuum Truck",
    "vac truck":     "Vacuum Truck",
    "Vacuum truck":  "Vacuum Truck",
    # Excavator casing drift.
    "excavator":     "Excavator",
    # Trailer casing drift (both variants observed in different orgs).
    "trailer":       "Trailer",
    "TRAILER":       "Trailer",
    # Utility (ute) — matches user-facing "Ute".
    "ute":           "Ute",
    "UTE":           "Ute",
    # Tipper casing drift.
    "tipper":        "Tipper",
    "TIPPER":        "Tipper",
    # Service truck.
    "service_truck": "Service Truck",
    # Crane truck.
    "crane_truck":   "Crane Truck",
    # Compactor.
    "compactor":     "Compactor",
    # Generic 'vehicle' bucket — used by rows sourced from Navixy
    # imports where the specific body-type wasn't captured. Leaving
    # as "Vehicle" (Title Case) is more human-readable than the
    # lowercase raw.
    "vehicle":       "Vehicle",
    # Generic 'other' bucket — Title Case.
    "other":         "Other",
}

# Fields per collection.
_TARGETS: list[tuple[str, str]] = [
    ("assets", "asset_type"),
    ("plant_maintenance", "sub_type"),
]


async def _dry_run(d) -> tuple[int, list[str]]:
    """Return (total_rows_that_would_change, report_lines)."""
    lines: list[str] = []
    total = 0
    for coll, field in _TARGETS:
        lines.append(f"\n══════════════════════════════════════════════════════════")
        lines.append(f"  Collection: {coll}   ·   field: {field}")
        lines.append(f"══════════════════════════════════════════════════════════")
        # Distribution
        rows = [r async for r in d[coll].aggregate([
            {"$match": {"deleted_at": None}},
            {"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
        ])]
        # Group by canonical target.
        by_target: dict[str, list[tuple[str, int]]] = defaultdict(list)
        for r in rows:
            raw = r["_id"]
            n = r["n"]
            if raw is None:
                continue
            canonical = _CANONICAL_MAP.get(raw)
            if canonical:
                by_target[canonical].append((raw, n))
        if not by_target:
            lines.append("  (no rows match the canonical map — nothing to do)")
            continue
        for canonical, members in by_target.items():
            merged_before = sum(n for raw, n in members if raw != canonical)
            already = next((n for raw, n in members if raw == canonical), 0)
            after = already + merged_before
            change_hint = "no change" if merged_before == 0 else f"{merged_before} rows re-labelled"
            lines.append(f"\n  → Canonical: '{canonical}'  ({change_hint})")
            for raw, n in sorted(members, key=lambda x: -x[1]):
                arrow = "  " if raw == canonical else "→ "
                lines.append(f"       {arrow}{n:5d}  raw={raw!r}")
            if merged_before > 0:
                lines.append(f"       Result: '{canonical}' will carry {after} rows (was {already}).")
                total += merged_before
    return total, lines


async def _commit(d) -> tuple[int, list[str]]:
    """Live write. Returns (rows_modified, report_lines)."""
    now = datetime.now(timezone.utc).isoformat()
    lines: list[str] = []
    modified = 0
    for coll, field in _TARGETS:
        lines.append(f"\n══════════════════════════════════════════════════════════")
        lines.append(f"  Committing: {coll}.{field}")
        lines.append(f"══════════════════════════════════════════════════════════")
        for raw, canonical in _CANONICAL_MAP.items():
            if raw == canonical:
                continue
            filt = {
                field: raw,
                "deleted_at": None,
                "sub_type_normalised_v120g": {"$ne": True},  # idempotent
            }
            update = {"$set": {
                field: canonical,
                "sub_type_normalised_v120g": True,
                "sub_type_before_v120g": raw,
                "sub_type_normalised_at": now,
            }}
            r = await d[coll].update_many(filt, update)
            if r.modified_count:
                lines.append(f"  → {r.modified_count:5d}  {raw!r} → {canonical!r}")
                modified += r.modified_count
        if modified == 0:
            lines.append("  (nothing to write — already normalised)")
    return modified, lines


async def _reverse(d) -> tuple[int, list[str]]:
    """Restore pre-.120g values from the audit marker."""
    lines: list[str] = []
    modified = 0
    for coll, field in _TARGETS:
        lines.append(f"\n══════════════════════════════════════════════════════════")
        lines.append(f"  Reversing: {coll}.{field}")
        lines.append(f"══════════════════════════════════════════════════════════")
        # We do this row-by-row because $set from another field
        # isn't supported in a single update_many statement without
        # aggregation-pipeline updates. Small volumes → keep it
        # simple.
        cursor = d[coll].find(
            {"sub_type_normalised_v120g": True},
            {"_id": 1, "id": 1, "sub_type_before_v120g": 1},
        )
        n = 0
        async for row in cursor:
            n += 1
            await d[coll].update_one(
                {"_id": row["_id"]},
                {
                    "$set": {field: row["sub_type_before_v120g"]},
                    "$unset": {
                        "sub_type_normalised_v120g": "",
                        "sub_type_before_v120g": "",
                        "sub_type_normalised_at": "",
                    },
                },
            )
        if n:
            lines.append(f"  → restored {n} row(s)")
            modified += n
        else:
            lines.append("  (nothing to restore)")
    return modified, lines


async def _main():
    parser = argparse.ArgumentParser(
        description="v58.13.120g sub_type normalisation."
    )
    parser.add_argument("--commit", action="store_true",
                        help="Live write. Defaults to DRY-RUN when omitted.")
    parser.add_argument("--dry-run", action="store_true",
                        help="No-op — dry-run is already the default.")
    parser.add_argument("--reverse", action="store_true",
                        help="Roll back a prior --commit run.")
    args = parser.parse_args()

    if args.commit and args.reverse:
        print("ERROR: --commit and --reverse are mutually exclusive.")
        sys.exit(2)

    c = AsyncIOMotorClient(MONGO_URL)
    d = c[DB_NAME]
    try:
        if args.reverse:
            n, lines = await _reverse(d)
            for l in lines: print(l)
            print(f"\nREVERSE complete: {n} row(s) restored.")
        elif args.commit:
            n, lines = await _commit(d)
            for l in lines: print(l)
            print(f"\nCOMMIT complete: {n} row(s) modified.")
        else:
            n, lines = await _dry_run(d)
            for l in lines: print(l)
            print(f"\nDRY-RUN complete: {n} row(s) WOULD be modified. "
                  f"Re-run with --commit to write.")
    finally:
        c.close()


if __name__ == "__main__":
    asyncio.run(_main())
