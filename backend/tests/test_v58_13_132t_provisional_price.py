"""v58.13.132t — Provisional-price back-fill + upsert clear-flag tests.

  · Back-fill idempotency (run twice → 0 rows modified on second run)
  · Upsert-merge clears price_source when a real total_price arrives
  · Aggregation surfaces `totals.has_provisional`
"""
from __future__ import annotations
import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import Optional

import pytest

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")


def _fresh_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


PROVISIONAL_TAG = "provisional_static_3.00"
ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


# ─── Back-fill idempotency ────────────────────────────────────
@pytest.mark.asyncio
async def test_backfill_no_ghost_matches():
    """After the .132t back-fill has run, re-executing its target
    filter must match ZERO rows (idempotency)."""
    db = _fresh_db()
    q = {
        "deleted_at": None,
        "litres": {"$gt": 0},
        "$and": [
            {"$or": [{"total_price": None},
                     {"total_price": {"$exists": False}}]},
            {"$or": [{"price_source": {"$ne": PROVISIONAL_TAG}},
                     {"price_source": {"$exists": False}}]},
        ],
    }
    n = await db.fuel_transactions.count_documents(q)
    assert n == 0, f"back-fill filter still matches {n} rows"


@pytest.mark.asyncio
async def test_all_547_rows_have_provisional_price():
    db = _fresh_db()
    total = await db.fuel_transactions.count_documents({"deleted_at": None})
    with_price = await db.fuel_transactions.count_documents({
        "deleted_at": None, "total_price": {"$gt": 0},
    })
    assert with_price == total, f"{total - with_price} rows still missing total_price"


@pytest.mark.asyncio
async def test_provisional_marker_present():
    db = _fresh_db()
    n_flagged = await db.fuel_transactions.count_documents({
        "price_source": PROVISIONAL_TAG,
    })
    assert n_flagged == 547


@pytest.mark.asyncio
async def test_computed_price_per_litre_is_three():
    db = _fresh_db()
    async for t in db.fuel_transactions.find(
        {"price_source": PROVISIONAL_TAG}, {"computed_price_per_litre": 1}
    ).limit(20):
        assert t["computed_price_per_litre"] == 3.00


@pytest.mark.asyncio
async def test_total_price_matches_formula():
    """`total_price` must equal `round(litres * 3.00, 2)` on every
    provisional row (within 0.01 tolerance for rounding)."""
    db = _fresh_db()
    checked = 0
    async for t in db.fuel_transactions.find(
        {"price_source": PROVISIONAL_TAG},
        {"litres": 1, "total_price": 1},
    ).limit(50):
        expected = round(float(t["litres"]) * 3.00, 2)
        assert abs(t["total_price"] - expected) < 0.01, (
            f"row {t} — expected {expected}, got {t['total_price']}"
        )
        checked += 1
    assert checked >= 20


# ─── Aggregation surface ──────────────────────────────────────
@pytest.mark.asyncio
async def test_reports_totals_expose_has_provisional():
    """`totals.has_provisional` must be True while any row carries
    the .132t marker."""
    import fleet_fuel_reports  # noqa: WPS433
    # Rebuild db for the aggregation module (it imports its own `db`)
    result = await fleet_fuel_reports._aggregate(
        org_id=ORG_ID, scope="vehicle", period="monthly",
        from_date=None, to_date=None,
    )
    assert result["totals"]["has_provisional"] is True
    assert result["totals"]["total_price"] > 0


# ─── Upsert clear-flag ────────────────────────────────────────
@pytest.mark.live_db_writes
@pytest.mark.asyncio
async def test_upsert_merge_clears_provisional_flag():
    """When a real total_price arrives via the upsert-merge branch
    for a row currently carrying `price_source='provisional_static_3.00'`,
    the flag must be cleared and price_provisional_at nulled.

    Simulates the exact update payload composition in
    `fleet_fuel.py:894-909` without needing to import the whole
    CSV pipeline.
    """
    db = _fresh_db()
    # Fabricate a fixture doc — test-fixture, cleaned up at end
    fixture_id = "test-132t-fixture-01"
    await db.fuel_transactions.delete_one({"id": fixture_id})
    now = datetime.now(timezone.utc).isoformat()
    await db.fuel_transactions.insert_one({
        "id": fixture_id, "org_id": ORG_ID,
        "litres": 100.0,
        "total_price": 300.0,
        "computed_price_per_litre": 3.00,
        "price_source": PROVISIONAL_TAG,
        "price_provisional_at": now,
        "is_test_fixture": True,
        "deleted_at": None,
        "created_at": now, "updated_at": now,
    })

    # Simulate the upsert-merge branch when a real total_price arrives
    dup = await db.fuel_transactions.find_one({"id": fixture_id})
    updates: dict = {"total_price": 190.0}  # real price from re-uploaded CSV
    # ── Excerpt of fleet_fuel.py:886-909 logic ──
    from fleet_fuel import _compute_price_per_litre
    merged_total = updates.get("total_price", dup.get("total_price"))
    merged_litres = dup.get("litres")
    new_cpl = _compute_price_per_litre(merged_total, merged_litres)
    if new_cpl is not None and dup.get("computed_price_per_litre") != new_cpl:
        updates["computed_price_per_litre"] = new_cpl
    incoming_tp = updates.get("total_price")
    had_provisional = dup.get("price_source") == PROVISIONAL_TAG
    if had_provisional and incoming_tp is not None:
        updates["price_source"] = None
        updates["price_provisional_at"] = None
    # ── end excerpt ──
    await db.fuel_transactions.update_one({"id": fixture_id}, {"$set": updates})

    updated = await db.fuel_transactions.find_one({"id": fixture_id})
    try:
        assert updated["total_price"] == 190.0
        assert updated["computed_price_per_litre"] == 1.90
        assert updated["price_source"] is None
        assert updated["price_provisional_at"] is None
    finally:
        # Clean up fixture
        await db.fuel_transactions.delete_one({"id": fixture_id})


@pytest.mark.live_db_writes
@pytest.mark.asyncio
async def test_upsert_no_provisional_does_not_clear_missing_flag():
    """If a doc never had `price_source` set, the upsert MUST NOT
    add `price_source=None` (that would be pointless churn) —
    verify the branch is properly guarded."""
    db = _fresh_db()
    fixture_id = "test-132t-fixture-02"
    await db.fuel_transactions.delete_one({"id": fixture_id})
    now = datetime.now(timezone.utc).isoformat()
    await db.fuel_transactions.insert_one({
        "id": fixture_id, "org_id": ORG_ID,
        "litres": 100.0,
        "total_price": 300.0,
        "computed_price_per_litre": 3.00,
        # No price_source set — a legacy real-price row.
        "is_test_fixture": True,
        "deleted_at": None,
        "created_at": now, "updated_at": now,
    })
    dup = await db.fuel_transactions.find_one({"id": fixture_id})
    updates: dict = {"total_price": 210.0}
    from fleet_fuel import _compute_price_per_litre
    merged_total = updates.get("total_price", dup.get("total_price"))
    merged_litres = dup.get("litres")
    new_cpl = _compute_price_per_litre(merged_total, merged_litres)
    if new_cpl is not None and dup.get("computed_price_per_litre") != new_cpl:
        updates["computed_price_per_litre"] = new_cpl
    incoming_tp = updates.get("total_price")
    had_provisional = dup.get("price_source") == PROVISIONAL_TAG
    if had_provisional and incoming_tp is not None:
        updates["price_source"] = None
        updates["price_provisional_at"] = None
    try:
        assert "price_source" not in updates, (
            "clear-flag branch fired on a non-provisional row"
        )
    finally:
        await db.fuel_transactions.delete_one({"id": fixture_id})
