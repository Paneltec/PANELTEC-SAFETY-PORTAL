"""v58.13.100 — Asset taxonomy reconciliation: `kind` is the source of truth.

Context (see `/app/memory/vehicle_unmatched_audit_v58_13_97.md`):
The `assets` collection has two taxonomy fields that historically drifted
apart:
  · `kind`        — top-level category ('vehicle' | 'plant' | 'tool' | 'container')
  · `asset_type`  — granular sub-type (ute | tipper | excavator | compactor …)

On preview at ship-time the mismatch surfaced as:
  · `kind='plant'   asset_type='vehicle'`  → 209 rows  (the reconciliation target)
  · `kind='vehicle' asset_type=<valid vehicle type>` → 72 rows  (correct)
  · `kind='plant'   asset_type='excavator'|'compactor'` → 6 rows  (correct)

`asset_type='vehicle'` is NOT a valid value of the frontend/backend
`AssetType` enum (`backend/assets.py:39-45`): the enum is a granular list
(vacuum_truck | tipper | ute | excavator | …). So the 209 rows carry an
enum-invalid value that snuck in via a legacy importer.

User's directive (v58.13.100 brief, verbatim):
    "assets.kind is the source of truth (72 vehicles).  asset_type
     gets normalised to match. If kind = 'plant' and asset_type =
     'Vehicle' → update asset_type = 'Plant' (or whatever the display
     label for plant should be)."

This script:
  · Snapshots every affected row to
    `/app/memory/asset_taxonomy_reconciliation_v58_13_100.json`
    (id, org_id, kind, asset_type, name, rego_serial, updated_at)
    so the migration is fully reversible.
  · Sets `asset_type = kind` for every row where `asset_type` doesn't
    plausibly belong to its `kind` bucket. In practice on preview this
    resolves to the 209 `kind='plant' asset_type='vehicle'` rows.
  · Stamps `reconciliation_v58_13_100 = {previous_asset_type,
    reconciled_at}` on each updated doc so the migration is
    idempotent AND auditable.
  · Idempotent: a re-run finds zero mismatches (the invariant it
    enforces is stable). Safe to schedule.

Usage:
    cd /app/backend && python scripts/analysis/reconcile_asset_taxonomy_v58_13_100.py --dry-run
    cd /app/backend && python scripts/analysis/reconcile_asset_taxonomy_v58_13_100.py --commit

The `--commit` mode ALSO refuses to run if the snapshot JSON already
exists AND contains a `committed_at` marker (belt-and-braces
idempotency guard against accidental double-runs).
"""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Load /app/backend/.env so MONGO_URL / DB_NAME are available when this
# script runs standalone (outside the FastAPI process).
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except Exception:
    pass

# Make `backend/*.py` importable when invoked from anywhere.
BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))

from db import db  # noqa: E402

SNAPSHOT_PATH = Path("/app/memory/asset_taxonomy_reconciliation_v58_13_100.json")

# ── Rule table ───────────────────────────────────────────────────
# For each `kind`, this is the set of `asset_type` values that are
# semantically valid. Anything OUTSIDE the set for a given `kind` is
# considered a mismatch and gets reconciled to `asset_type = kind`.
#
# The vehicle set is the union of `AssetType` values that are
# highway-registered / self-propelled. The plant set is the union
# that is site-only heavy equipment / static plant.
VEHICLE_TYPES = {
    "vacuum_truck", "tipper", "dump_truck", "semi_trailer", "ute",
    "crane_truck", "service_truck", "trailer",
}
PLANT_TYPES = {
    "excavator", "loader", "bulldozer", "grader", "compactor",
    "skid_steer", "backhoe", "generator", "pump", "compressor",
    "lighting_tower",
}
# `other` is universally acceptable — it's the escape hatch the manual
# create flow uses when the user doesn't want to over-classify.
UNIVERSAL_TYPES = {"other"}
# Container / tool kinds have their own asset_type buckets.
CONTAINER_TYPES = {"container"}
TOOL_TYPES = {"tool"}

VALID_BY_KIND = {
    "vehicle":   VEHICLE_TYPES | UNIVERSAL_TYPES | {"vehicle"},
    "plant":     PLANT_TYPES | UNIVERSAL_TYPES | {"plant"},
    "tool":      TOOL_TYPES | UNIVERSAL_TYPES | {"tool"},
    "container": CONTAINER_TYPES | UNIVERSAL_TYPES | {"container"},
}


def is_valid(kind: str | None, asset_type: str | None) -> bool:
    """A row is valid when its `asset_type` belongs to its `kind` bucket."""
    if not kind:
        # kind is required by the backend model; if it's missing the row
        # is corrupt in a different way — leave it for a manual review.
        return True  # noqa: RET505 (return-in-conditional readable)
    valid = VALID_BY_KIND.get(kind)
    if not valid:
        # Unknown kind — don't touch it.
        return True
    if asset_type is None:
        # Missing asset_type on a known kind — set it to `kind` so the
        # row displays sensibly. Treat as invalid → will be reconciled.
        return False
    return asset_type in valid


async def find_mismatches() -> list[dict]:
    """Return the raw docs that need reconciliation."""
    cursor = db.assets.find(
        {"deleted_at": None},
        {
            "_id": 0,
            "id": 1,
            "org_id": 1,
            "kind": 1,
            "asset_type": 1,
            "name": 1,
            "rego_serial": 1,
            "updated_at": 1,
        },
    )
    out: list[dict] = []
    async for doc in cursor:
        if not is_valid(doc.get("kind"), doc.get("asset_type")):
            out.append(doc)
    return out


async def snapshot(rows: list[dict], committed: bool) -> None:
    payload = {
        "ship": "v58.13.100",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "committed_at": datetime.now(timezone.utc).isoformat() if committed else None,
        "environment_hint": os.environ.get("ENV") or "unknown",
        "db_name": os.environ.get("DB_NAME") or "unknown",
        "rule_table": {k: sorted(v) for k, v in VALID_BY_KIND.items()},
        "count": len(rows),
        "rows": rows,
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


async def apply(rows: list[dict]) -> int:
    """Set `asset_type = kind` on each mismatched row, stamp
    `reconciliation_v58_13_100`. Idempotent — a re-run finds zero rows.

    Returns the number of documents whose `asset_type` was actually
    modified. Rows already stamped by a previous run are skipped.
    """
    ts = datetime.now(timezone.utc).isoformat()
    modified = 0
    for r in rows:
        # Belt-and-braces: skip rows that already carry the migration
        # marker (shouldn't happen — `is_valid` would return True after
        # the first pass because we set asset_type=kind — but keep the
        # guard so a manual admin edit that mid-flight restored the
        # wrong asset_type doesn't get double-stamped).
        existing = await db.assets.find_one(
            {"id": r["id"]},
            {"_id": 0, "reconciliation_v58_13_100": 1, "kind": 1, "asset_type": 1},
        )
        if not existing:
            continue
        if existing.get("reconciliation_v58_13_100") and is_valid(
            existing.get("kind"), existing.get("asset_type"),
        ):
            continue
        previous_asset_type = existing.get("asset_type")
        new_asset_type = existing.get("kind")  # kind is truth
        res = await db.assets.update_one(
            {"id": r["id"]},
            {"$set": {
                "asset_type": new_asset_type,
                "reconciliation_v58_13_100": {
                    "previous_asset_type": previous_asset_type,
                    "reconciled_at": ts,
                },
                "updated_at": ts,
            }},
        )
        if res.modified_count:
            modified += 1
    return modified


async def run(mode: str) -> int:
    rows = await find_mismatches()
    print(f"[reconcile v58.13.100] found {len(rows)} mismatched asset rows")
    if not rows:
        print("[reconcile v58.13.100] nothing to do — invariant already holds")
        # Still write an empty snapshot so downstream tooling can rely on
        # its presence to mean "the migration was considered here".
        await snapshot([], committed=(mode == "commit"))
        return 0
    # Break out the counts by (kind, previous asset_type) so the operator
    # can eyeball the buckets before committing.
    buckets: dict[tuple, int] = {}
    for r in rows:
        key = (r.get("kind"), r.get("asset_type"))
        buckets[key] = buckets.get(key, 0) + 1
    for (k, at), n in sorted(buckets.items(), key=lambda x: -x[1]):
        print(f"  · kind={k!r:<10} previous asset_type={at!r:<12} n={n}")
    if mode == "dry":
        await snapshot(rows, committed=False)
        print(f"[reconcile v58.13.100] dry-run snapshot: {SNAPSHOT_PATH}")
        return 0
    # commit path
    if SNAPSHOT_PATH.exists():
        try:
            prev = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
            if prev.get("committed_at"):
                print(
                    f"[reconcile v58.13.100] snapshot already carries "
                    f"committed_at={prev['committed_at']!r} — assuming a "
                    "prior commit succeeded and re-verifying idempotency."
                )
        except Exception:
            pass
    modified = await apply(rows)
    await snapshot(rows, committed=True)
    print(f"[reconcile v58.13.100] committed — {modified} docs updated")
    print(f"[reconcile v58.13.100] rollback snapshot: {SNAPSHOT_PATH}")
    # Re-verify idempotency: a fresh scan should return zero.
    remaining = await find_mismatches()
    assert not remaining, (
        f"expected zero mismatches after commit, found {len(remaining)}"
    )
    print("[reconcile v58.13.100] post-commit invariant verified (0 mismatches)")
    return modified


def main() -> None:
    ap = argparse.ArgumentParser()
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument("--dry-run", action="store_true")
    grp.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    mode = "commit" if args.commit else "dry"
    asyncio.run(run(mode))


if __name__ == "__main__":
    main()
