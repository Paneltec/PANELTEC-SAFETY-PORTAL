"""v58.13.109 — Pytest guard for the orphan-maintenance vacuum
migration (`backend/scripts/vacuum_orphan_maintenance_v58_13_109.py`).

Strategy: seed 3 controllable orphan rows into a live `plant_maintenance`
collection with a `TESTV13109_` rego prefix so the assertions can
distinguish them from any prod-drift orphans. Exercise the pure
migration functions (`_backfill_assets` + a scoped re-parent) with the
seeded set — never invoke `main()`, so we can never accidentally touch
the 346 real orphans on preview.

Motor + pytest fixture teardowns don't compose cleanly (each new event
loop invalidates the shared motor client), so the async migration
functions are driven from ONE loop per test while seed/cleanup happens
via a pymongo sync client.

Coverage:
  · `_norm_rego` normalises case + whitespace.
  · Seeded orphan regos flow through `_backfill_assets`, producing
    `assets` docs with `kind="vehicle"`, `source="orphan_backfill"`,
    a per-run `orphan_backfill_run_id`, and a matching `rego_serial`.
  · Scoped re-parent stamps each seeded row's `plant_id` +
    `registration_matched=True`.
  · Idempotent — a second pass leaves the counts unchanged.
"""
from __future__ import annotations
import asyncio
import importlib
import os
import sys
import uuid
from pathlib import Path

import pytest
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))

load_dotenv(str(BACKEND / ".env"))
vac = importlib.import_module("vacuum_orphan_maintenance_v58_13_109")

TEST_PREFIX = "TESTV13109"
SEEDED_REGOS = [f"{TEST_PREFIX}{i:02d}A" for i in range(1, 4)]  # TESTV1310901A .. 03A


def _sync_db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _wipe_seed():
    sdb = _sync_db()
    sdb.assets.delete_many({"rego_serial": {"$in": SEEDED_REGOS}})
    sdb.plant_maintenance.delete_many({"registration_no": {"$in": SEEDED_REGOS}})


@pytest.fixture
def clean_seed():
    _wipe_seed()
    yield
    _wipe_seed()


# ── Pure-function checks ─────────────────────────────────────────

def test_norm_rego_uppercases_and_strips_whitespace():
    assert vac._norm_rego(" a18Dc ") == "A18DC"
    assert vac._norm_rego("gc 42\tXY") == "GC42XY"
    assert vac._norm_rego(None) == ""
    assert vac._norm_rego("") == ""


# ── DB-touching integration checks ────────────────────────────────

def test_backfill_and_reparent_three_seeded_orphans(clean_seed):
    """End-to-end: seed 3 orphan rows, backfill assets, re-parent."""
    sdb = _sync_db()
    for rego in SEEDED_REGOS:
        sdb.plant_maintenance.insert_one({
            "id": f"test-maint-{rego}",
            "maintenance_id": f"test-maint-{rego}",
            "registration_no": rego,
            "plant_id": None,
            "maintenance_type": "SERVICE",
            "maintenance_status": "COMPLETED",
            "date_completed": "2026-01-01",
            "description": "test row for v58.13.109 vacuum pytest",
            "deleted_at": None,
            "created_at": "2026-01-01T00:00:00+00:00",
        })

    # Sanity: no assets for these regos yet.
    assert sdb.assets.count_documents({"rego_serial": {"$in": SEEDED_REGOS}}) == 0

    async def _drive():
        # Build a fresh motor client on THIS event loop — the module-
        # level `db.db` singleton is bound to whichever loop first
        # touched it and would raise "Event loop is closed" here.
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        adb = client[os.environ["DB_NAME"]]
        try:
            run_id = f"pytest-{uuid.uuid4().hex[:8]}"
            created = await vac._backfill_assets(adb, set(SEEDED_REGOS), run_id)
            matched = 0
            async for m in adb.plant_maintenance.find(
                {"registration_no": {"$in": SEEDED_REGOS}},
                {"_id": 0, "id": 1, "registration_no": 1},
            ):
                asset_id = created.get(vac._norm_rego(m["registration_no"]))
                if not asset_id:
                    continue
                await adb.plant_maintenance.update_one(
                    {"id": m["id"]},
                    {"$set": {"plant_id": asset_id,
                               "registration_matched": True,
                               "updated_at": "2026-01-01T00:00:01+00:00"}},
                )
                matched += 1
            return created, matched, run_id
        finally:
            client.close()

    loop = asyncio.new_event_loop()
    try:
        created, matched, run_id = loop.run_until_complete(_drive())
    finally:
        loop.close()

    assert set(created.keys()) == set(SEEDED_REGOS)
    assert matched == 3

    for rego in SEEDED_REGOS:
        a = sdb.assets.find_one({"rego_serial": rego})
        assert a is not None, f"asset not created for {rego}"
        assert a["kind"] == "vehicle"
        assert a["source"] == "orphan_backfill"
        assert a["orphan_backfill_run_id"] == run_id
        assert a["id"] == created[rego]

        m = sdb.plant_maintenance.find_one({"registration_no": rego})
        assert m["plant_id"] == created[rego]
        assert m.get("registration_matched") is True


def test_backfill_is_idempotent_on_rerun(clean_seed):
    """A second pass with the same rego set must not duplicate assets —
    `_load_orphan_maint_regos` returns an empty set on the second call."""
    sdb = _sync_db()
    rego = SEEDED_REGOS[0]
    sdb.plant_maintenance.insert_one({
        "id": f"test-maint-{rego}",
        "maintenance_id": f"test-maint-{rego}",
        "registration_no": rego,
        "plant_id": None,
        "deleted_at": None,
    })

    async def _drive():
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        adb = client[os.environ["DB_NAME"]]
        try:
            asset_regos_1 = await vac._load_asset_regos(adb)
            missing_1 = await vac._load_orphan_maint_regos(adb, asset_regos_1)
            assert rego in missing_1
            await vac._backfill_assets(adb, {rego}, "pytest-idem")
            asset_regos_2 = await vac._load_asset_regos(adb)
            missing_2 = await vac._load_orphan_maint_regos(adb, asset_regos_2)
            return missing_2
        finally:
            client.close()

    loop = asyncio.new_event_loop()
    try:
        missing_after = loop.run_until_complete(_drive())
    finally:
        loop.close()

    assert rego not in missing_after, "second pass still saw the rego as missing"
    assert sdb.assets.count_documents({"rego_serial": rego}) == 1, (
        "duplicate asset created on rerun"
    )


# ── Version-sync forward-safe pins ───────────────────────────────

import re

FRONTEND = ROOT / "frontend"
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_VERSION_TS = (ROOT / "mobile" / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


def _ge_109(version: str) -> bool:
    m = re.search(r"58\.13\.(\d+)([a-z]*)", version)
    if not m:
        return False
    return int(m.group(1)) >= 109


def test_running_version_ge_109():
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and _ge_109(m.group(1)), f"RUNNING_VERSION {m and m.group(1)!r} must be >= .109"


def test_mobile_bundle_version_ge_109():
    m = re.search(r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'", MOBILE_VERSION_TS)
    assert m and _ge_109(m.group(1))


def test_service_worker_cache_version_ge_109():
    m = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m and _ge_109(m.group(1))
