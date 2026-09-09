"""v58.13.132v — fuel_cards back-fill tests."""
from __future__ import annotations
import os
import sys

import pytest

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

ORG_ID = "3116f250-a4eb-43f3-98a5-2a3656d6cb63"


def _fresh_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return c[os.environ["DB_NAME"]]


@pytest.mark.asyncio
async def test_fuel_cards_backfilled_67():
    db = _fresh_db()
    n = await db.fuel_cards.count_documents({"org_id": ORG_ID})
    assert n == 67


@pytest.mark.asyncio
async def test_attribution_kind_split():
    """59 vehicle · 1 shared · 7 unassigned (matches .132u discovery)."""
    db = _fresh_db()
    counts = {"vehicle": 0, "shared": 0, "unassigned": 0, "worker": 0}
    async for c in db.fuel_cards.find(
        {"org_id": ORG_ID}, {"attribution_kind": 1}
    ):
        counts[c["attribution_kind"]] = counts.get(c["attribution_kind"], 0) + 1
    assert counts == {"vehicle": 59, "shared": 1, "unassigned": 7, "worker": 0}


@pytest.mark.asyncio
async def test_unique_index_present():
    db = _fresh_db()
    idxs = await db.fuel_cards.list_indexes().to_list(20)
    named = {i["name"]: i for i in idxs}
    assert "org_id_1_card_number_1" in named
    assert named["org_id_1_card_number_1"].get("unique") is True


@pytest.mark.asyncio
async def test_office_card_marked_shared():
    db = _fresh_db()
    c = await db.fuel_cards.find_one({"card_number": "7684"})
    assert c is not None
    assert c["attribution_kind"] == "shared"
    assert "Office" in (c["notes"] or "")


@pytest.mark.asyncio
async def test_daniel_butler_marked_unassigned_worker_hint():
    db = _fresh_db()
    c = await db.fuel_cards.find_one({"card_number": "17079"})
    assert c is not None
    assert c["attribution_kind"] == "unassigned"
    # No worker_id — user assigns manually via UI.
    assert c["worker_id"] is None
    # Notes must hint at the person name.
    assert "Daniel Butler" in (c["notes"] or "")


@pytest.mark.asyncio
async def test_rego_unmatched_cards_have_helpful_notes():
    """6 cards with rego but no matching asset — notes must name the
    unmatched rego."""
    db = _fresh_db()
    unmatched = ["21310", "21325", "21327", "21333", "21350", "21372"]
    for cn in unmatched:
        c = await db.fuel_cards.find_one({"card_number": cn})
        assert c is not None, f"missing card {cn}"
        assert c["attribution_kind"] == "unassigned"
        assert "not found in assets" in (c["notes"] or "")


@pytest.mark.asyncio
async def test_vehicle_cards_have_asset_id():
    db = _fresh_db()
    async for c in db.fuel_cards.find(
        {"org_id": ORG_ID, "attribution_kind": "vehicle"},
    ):
        assert c["asset_id"], f"vehicle card {c['card_number']} missing asset_id"


@pytest.mark.asyncio
async def test_first_last_seen_dates_populated():
    db = _fresh_db()
    async for c in db.fuel_cards.find({"org_id": ORG_ID}):
        assert c["first_seen_at"], f"no first_seen_at on {c['card_number']}"
        assert c["last_seen_at"], f"no last_seen_at on {c['card_number']}"
        assert c["first_seen_at"] <= c["last_seen_at"]
        assert c["fill_count"] >= 1


@pytest.mark.asyncio
async def test_backfill_source_stamped():
    db = _fresh_db()
    async for c in db.fuel_cards.find({"org_id": ORG_ID}, {"source": 1}):
        assert c["source"] == "auto"
