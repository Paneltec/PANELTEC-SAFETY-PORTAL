"""v58.13.120g — sub_type normalisation round-trip pytest.

Locks the per-row deterministic reverse behaviour: for every one of
the 11 mappings the commit script applies, we can seed a fresh row,
run the commit path, assert the canonical value + audit markers, run
the reverse path, and assert the exact prior string is restored.

Also asserts that a row that ALREADY carried a canonical value is
untouched by commit + reverse — the script is idempotent both ways.

Uses the internal `_commit(db)` / `_reverse(db)` coroutines directly
so the pytest doesn't shell out. Each mapping is seeded on a scratch
`id` so the test can't collide with production rows.
"""
from __future__ import annotations
import importlib.util
import os
import uuid

import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

# Import the script as a module without going through pkg import
# machinery (backend/scripts isn't a package).
_spec = importlib.util.spec_from_file_location(
    "normalize_subtype_v58_13_120g",
    "/app/backend/scripts/normalize_subtype_v58_13_120g.py",
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)  # type: ignore


# The full mapping table the ship green-lit. Parametrised so a
# missing / renamed entry fails loud.
_MAPPINGS = [
    ("assets", "asset_type", "vacuum_truck",  "Vacuum Truck"),
    ("assets", "asset_type", "Vac Truck",     "Vacuum Truck"),
    ("assets", "asset_type", "VACUUM TRUCK",  "Vacuum Truck"),
    ("assets", "asset_type", "vac truck",     "Vacuum Truck"),
    ("assets", "asset_type", "Vacuum truck",  "Vacuum Truck"),
    ("assets", "asset_type", "excavator",     "Excavator"),
    ("assets", "asset_type", "trailer",       "Trailer"),
    ("assets", "asset_type", "TRAILER",       "Trailer"),
    ("assets", "asset_type", "ute",           "Ute"),
    ("assets", "asset_type", "UTE",           "Ute"),
    ("assets", "asset_type", "tipper",        "Tipper"),
    ("assets", "asset_type", "TIPPER",        "Tipper"),
    ("assets", "asset_type", "service_truck", "Service Truck"),
    ("assets", "asset_type", "crane_truck",   "Crane Truck"),
    ("assets", "asset_type", "compactor",     "Compactor"),
    ("assets", "asset_type", "vehicle",       "Vehicle"),
    ("assets", "asset_type", "other",         "Other"),
    # plant_maintenance leg — same shape.
    ("plant_maintenance", "sub_type", "Vac Truck", "Vacuum Truck"),
]


@pytest_asyncio.fixture
async def db():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = c[os.environ["DB_NAME"]]
    yield d
    c.close()


@pytest.mark.parametrize("coll,field,raw,canonical", _MAPPINGS)
@pytest.mark.asyncio
async def test_roundtrip_seed_commit_reverse(db, coll, field, raw, canonical):
    """Seed a fresh row with `raw`, run commit, assert canonical +
    audit markers, run reverse, assert exact `raw` restored + markers
    unset."""
    rid = f"120g-rt-{uuid.uuid4().hex[:10]}"
    seed = {
        "id": rid,
        field: raw,
        "deleted_at": None,
        "org_id": "roundtrip-test-org",
    }
    if coll == "plant_maintenance":
        seed["maintenance_id"] = rid
    try:
        await db[coll].insert_one(seed)

        # ── Commit ────────────────────────────────────────────────
        await _mod._commit(db)
        after_commit = await db[coll].find_one({"id": rid}, {"_id": 0})
        assert after_commit[field] == canonical, (
            f"expected {field}={canonical!r} after commit, got {after_commit[field]!r}"
        )
        assert after_commit["sub_type_normalised_v120g"] is True
        assert after_commit["sub_type_before_v120g"] == raw, (
            f"audit marker must preserve exact prior value {raw!r}, "
            f"got {after_commit['sub_type_before_v120g']!r}"
        )
        assert "sub_type_normalised_at" in after_commit

        # ── Reverse ───────────────────────────────────────────────
        await _mod._reverse(db)
        after_reverse = await db[coll].find_one({"id": rid}, {"_id": 0})
        assert after_reverse[field] == raw, (
            f"reverse must restore exact prior value {raw!r}, "
            f"got {after_reverse[field]!r}"
        )
        # Audit markers must be fully unset.
        assert "sub_type_normalised_v120g" not in after_reverse
        assert "sub_type_before_v120g" not in after_reverse
        assert "sub_type_normalised_at" not in after_reverse
    finally:
        await db[coll].delete_one({"id": rid})


@pytest.mark.asyncio
async def test_already_canonical_row_untouched_by_commit(db):
    """A row that already carries `'Vacuum Truck'` must NOT be
    stamped with audit markers by commit (nothing to reverse either
    for that row)."""
    rid = f"120g-canon-{uuid.uuid4().hex[:10]}"
    try:
        await db.assets.insert_one({
            "id": rid,
            "asset_type": "Vacuum Truck",
            "deleted_at": None,
            "org_id": "roundtrip-test-org",
        })
        await _mod._commit(db)
        row = await db.assets.find_one({"id": rid}, {"_id": 0})
        assert row["asset_type"] == "Vacuum Truck", "canonical must persist"
        assert "sub_type_normalised_v120g" not in row, (
            "already-canonical rows must NOT get the audit marker"
        )
        assert "sub_type_before_v120g" not in row
    finally:
        await db.assets.delete_one({"id": rid})


@pytest.mark.asyncio
async def test_commit_is_idempotent(db):
    """A second commit call on the same seed must be a no-op — the
    filter carries `sub_type_normalised_v120g: {$ne: True}` to skip
    already-stamped rows."""
    rid = f"120g-idem-{uuid.uuid4().hex[:10]}"
    try:
        await db.assets.insert_one({
            "id": rid,
            "asset_type": "Vac Truck",
            "deleted_at": None,
            "org_id": "roundtrip-test-org",
        })
        await _mod._commit(db)
        row1 = await db.assets.find_one({"id": rid}, {"_id": 0})
        first_stamp = row1["sub_type_normalised_at"]
        # Second run — must not touch the row again.
        await _mod._commit(db)
        row2 = await db.assets.find_one({"id": rid}, {"_id": 0})
        assert row2["sub_type_normalised_at"] == first_stamp, (
            "second commit must not re-stamp the timestamp"
        )
        assert row2["asset_type"] == "Vacuum Truck"
    finally:
        await db.assets.delete_one({"id": rid})


@pytest.mark.asyncio
async def test_reverse_is_idempotent(db):
    """Second reverse on a fully-restored set is a no-op."""
    rid = f"120g-reidem-{uuid.uuid4().hex[:10]}"
    try:
        await db.assets.insert_one({
            "id": rid,
            "asset_type": "Vac Truck",
            "deleted_at": None,
            "org_id": "roundtrip-test-org",
        })
        await _mod._commit(db)
        await _mod._reverse(db)
        await _mod._reverse(db)  # second reverse
        row = await db.assets.find_one({"id": rid}, {"_id": 0})
        assert row["asset_type"] == "Vac Truck"
        assert "sub_type_normalised_v120g" not in row
    finally:
        await db.assets.delete_one({"id": rid})
