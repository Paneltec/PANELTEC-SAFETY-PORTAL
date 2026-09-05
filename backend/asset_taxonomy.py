"""v58.13.124 — Shared asset sub-type / taxonomy canonicaliser.

Extracted from `scripts/normalize_subtype_v58_13_120g.py` so the same
canonical mapping applies on every WRITE path (Navixy backfill,
maintenance-import backfill, manual asset create/edit) — not just as
a periodic sweep script. This is the deferred `.121a` write-path fix
promised on `asset_navixy_sync.py:315` and reopened in `.124` after
the 5-row `Vac Truck` drift re-appeared in Fleet Register post-.120g.

## Usage
    from asset_taxonomy import normalize_asset_type
    doc["asset_type"] = normalize_asset_type(doc.get("asset_type"))

Returns the raw value unchanged when no mapping exists (keeps the
door open for new operator-invented sub-types).
"""
from __future__ import annotations
from typing import Optional


# Canonical mapping — mirror of `_CANONICAL_MAP` in
# scripts/normalize_subtype_v58_13_120g.py. Keep the two in sync;
# `test_v58_13_124_taxonomy_and_purge.py::test_canonical_maps_match`
# locks equality at CI-time.
CANONICAL_ASSET_TYPE_MAP: dict[str, str] = {
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
    # imports where the specific body-type wasn't captured.
    "vehicle":       "Vehicle",
    # Generic 'other' bucket — Title Case.
    "other":         "Other",
}


def normalize_asset_type(raw: Optional[str]) -> Optional[str]:
    """Return the canonical Title-Case sub-type for `raw`, unchanged
    when not in the map, and None-preserving.

    Case-sensitive lookup by design — the map covers every observed
    variant explicitly. A raw value that isn't in the map is passed
    through so operator-invented sub-types keep working (they'll show
    up as a new bucket in the filter tree and can be added to the map
    on the next ship if they stick around).
    """
    if raw is None:
        return None
    hit = CANONICAL_ASSET_TYPE_MAP.get(raw)
    return hit if hit is not None else raw
