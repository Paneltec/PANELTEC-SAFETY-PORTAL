"""v58.13.132w — ingest wiring tests for fuel_cards lookup path."""
from __future__ import annotations
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


def _fresh_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


@pytest.mark.live_db_writes
@pytest.mark.asyncio
async def test_resolve_asset_all_branches():
    """Combined branch-coverage test — single event loop because
    `fleet_fuel._resolve_asset` uses the module-level Motor client
    which binds to the first loop that touches it. pytest-asyncio's
    fresh-loop-per-test model can't share the client across tests.

    Verifies:
      (1) vehicle-kind → returns mapped asset_id + status=matched_via_fuel_card
      (2) worker-kind  → returns mapped worker_id + status=matched_worker_via_card
      (3) unassigned   → falls through, flags pending=True
      (4) brand-new    → auto-creates fuel_cards doc, pending=True
      (5) shared       → returns None/None + status=shared_via_fuel_card
    """
    from fleet_fuel import _resolve_asset
    db = _fresh_db()
    now = datetime.now(timezone.utc).isoformat()

    # ── (1) Vehicle ────────────────────────────────
    fc = await db.fuel_cards.find_one(
        {"org_id": ORG_ID, "attribution_kind": "vehicle"},
    )
    assert fc is not None
    asset_id, worker_id, status, pending = await _resolve_asset(
        org_id=ORG_ID, key_code="", card_number=fc["card_number"],
        registration="ZZZ_NEVER_EXISTS", description="ZZZ",
    )
    assert asset_id == fc["asset_id"]
    assert worker_id is None
    assert status == "matched_via_fuel_card"
    assert pending is False

    # ── (2) Worker ─────────────────────────────────
    fixture_worker_id = str(uuid.uuid4())
    fixture_card_w = f"test-132w-worker-{uuid.uuid4().hex[:6]}"
    await db.fuel_cards.insert_one({
        "id": str(uuid.uuid4()), "org_id": ORG_ID,
        "card_number": fixture_card_w,
        "attribution_kind": "worker",
        "asset_id": None, "worker_id": fixture_worker_id,
        "smartfill_description": None, "smartfill_registration": None,
        "notes": "test fixture", "source": "manual",
        "created_at": now, "updated_at": now,
    })
    try:
        asset_id, worker_id, status, pending = await _resolve_asset(
            org_id=ORG_ID, key_code="", card_number=fixture_card_w,
            registration="", description="",
        )
        assert asset_id is None
        assert worker_id == fixture_worker_id
        assert status == "matched_worker_via_card"
        assert pending is False
    finally:
        await db.fuel_cards.delete_one({"card_number": fixture_card_w})

    # ── (3) Unassigned falls through, flags pending ──────────
    # Use a synthetic unassigned card (not "17079" — real "Daniel
    # Butler" description fuzzy-matches an actual asset in this org,
    # which is correct behavior but not what this branch tests).
    fixture_card_u = f"test-132w-unassigned-{uuid.uuid4().hex[:6]}"
    await db.fuel_cards.insert_one({
        "id": str(uuid.uuid4()), "org_id": ORG_ID,
        "card_number": fixture_card_u,
        "attribution_kind": "unassigned",
        "asset_id": None, "worker_id": None,
        "smartfill_description": None, "smartfill_registration": None,
        "notes": "test fixture", "source": "manual",
        "created_at": now, "updated_at": now,
    })
    try:
        asset_id, worker_id, status, pending = await _resolve_asset(
            org_id=ORG_ID, key_code="", card_number=fixture_card_u,
            registration="", description="",
        )
        # No asset resolves, no worker, pending must be True.
        assert asset_id is None
        assert worker_id is None
        assert status == "unmatched"
        assert pending is True
    finally:
        await db.fuel_cards.delete_one({"card_number": fixture_card_u})

    # ── (4) Brand-new card auto-creates fuel_cards row ────────
    new_card = f"test-132w-newcard-{uuid.uuid4().hex[:6]}"
    assert await db.fuel_cards.find_one({"card_number": new_card}) is None
    try:
        asset_id, worker_id, status, pending = await _resolve_asset(
            org_id=ORG_ID, key_code="", card_number=new_card,
            registration="", description="Some new vehicle",
        )
        assert asset_id is None
        assert status == "unmatched"
        assert pending is True
        fc_new = await db.fuel_cards.find_one({"card_number": new_card})
        assert fc_new is not None
        assert fc_new["attribution_kind"] == "unassigned"
        assert fc_new["source"] == "auto"
        assert "Seen at ingest" in (fc_new["notes"] or "")
    finally:
        await db.fuel_cards.delete_one({"card_number": new_card})

    # ── (5) Shared ─────────────────────────────────
    asset_id, worker_id, status, pending = await _resolve_asset(
        org_id=ORG_ID, key_code="", card_number="7684",
        registration="", description="Office",
    )
    assert asset_id is None
    assert worker_id is None
    assert status == "shared_via_fuel_card"
    assert pending is False
