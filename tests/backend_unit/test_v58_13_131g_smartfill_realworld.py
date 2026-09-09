"""v58.13.131g — Real-world SmartFill CSV parser tests.

Locks in the observed export shapes from Paneltec's live SmartFill
portal (10-col + 9-col variants), the composite dedupe fallback,
the per-batch R4/R5 auto-suppression (interim — Navixy enrichment
in .131h will replace it), and R7 skip-when-no-price.

Uses the same in-memory `_FakeDB` pattern as `test_fuel_csv_import.py`.
"""
from __future__ import annotations
import re
import pytest

import fleet_fuel as ff
from test_fuel_csv_import import _FakeDB, _seed_asset


@pytest.fixture(autouse=True)
def _patch_db(monkeypatch):
    fake = _FakeDB()
    monkeypatch.setattr(ff, "db", fake)
    return fake


# ── §1 CSV column tolerance ────────────────────────────────────
_REAL_10COL_HEADER = (
    "Date,Time,Card Number,Description,Registration,From,Litres,"
    "Fuel Type,Pump,Odometer"
)
_REAL_9COL_HEADER = (
    "Date,Time,Card Number,Description,Registration,From,Litres,"
    "Fuel Type,Odometer"
)


@pytest.mark.asyncio
async def test_parse_real_10col_export_no_pump_no_price(_patch_db):
    """Full real-world 10-col export — no transaction_id, no
    key_code, no total_price, no driver. Every row odo=0."""
    fake = _patch_db
    await _seed_asset(fake, id="A1", rego_serial="XT04CS", name="Kroll")
    csv_text = (
        f"{_REAL_10COL_HEADER}\n"
        "2026-08-31,06:30:28,21321,Kroll,XT04CS,Paneltec Breadalbane,252.390,Diesel,1,0\n"
        "2026-08-31,07:26:20,21341,Traffic Ute,D04RF,Paneltec Breadalbane,44.590,Diesel,1,0\n"
    )
    r = await ff._import_csv(content=csv_text.encode(), filename="10col.csv",
                              org_id="ORG", workspace_id=None, user_id="U")
    assert r.rows_inserted == 2
    assert r.rows_rejected == 0
    batch = await fake.fuel_import_batches.find_one({"org_id": "ORG"})
    # v58.13.131g — columns_detected preserves the exact header order.
    assert batch["columns_detected"] == [
        "Date", "Time", "Card Number", "Description", "Registration",
        "From", "Litres", "Fuel Type", "Pump", "Odometer",
    ]
    # v58.13.131h — R4/R5 no longer auto-suppressed at batch level;
    # they now fire per-row when Navixy enrichment can't populate an
    # odometer. R7 is still suppressed when there's no price data.
    supp = batch["rules_suppressed"]
    assert any(s["rules"] == ["procurement_outlier"] for s in supp)


@pytest.mark.asyncio
async def test_parse_real_9col_export_missing_pump(_patch_db):
    """48-row current-week export — Pump column absent entirely."""
    fake = _patch_db
    await _seed_asset(fake, id="A1", rego_serial="XT04CS", name="Kroll")
    csv_text = (
        f"{_REAL_9COL_HEADER}\n"
        "2026-08-31,06:30:28,21321,Kroll,XT04CS,Paneltec Breadalbane,252.390,Diesel,0\n"
        "2026-08-31,07:26:20,21341,Traffic Ute,D04RF,Paneltec Breadalbane,44.590,Diesel,0\n"
        "2026-08-31,07:35:07,21332,200 Tipper,J45AL,Paneltec Breadalbane,124.410,Diesel,0\n"
    )
    r = await ff._import_csv(content=csv_text.encode(), filename="9col.csv",
                              org_id="ORG", workspace_id=None, user_id="U")
    assert r.rows_inserted == 3
    batch = await fake.fuel_import_batches.find_one({"org_id": "ORG"})
    assert "Pump" not in batch["columns_detected"]
    # Rows should still persist with pump=None.
    for tx in fake.fuel_transactions.docs:
        assert tx["pump"] is None


@pytest.mark.asyncio
async def test_column_order_shuffled_still_works(_patch_db):
    """Header normaliser handles arbitrary column ordering."""
    await _seed_asset(_patch_db, id="A1", rego_serial="XT04CS", name="Kroll")
    csv_text = (
        "Litres,Registration,Time,Date,Description,From,Fuel Type,Card Number,Odometer\n"
        "252.390,XT04CS,06:30:28,2026-08-31,Kroll,Paneltec Breadalbane,Diesel,21321,0\n"
    )
    r = await ff._import_csv(content=csv_text.encode(), filename="shuffled.csv",
                              org_id="ORG", workspace_id=None, user_id="U")
    assert r.rows_inserted == 1


# ── §2 Composite dedupe hash ──────────────────────────────────
@pytest.mark.asyncio
async def test_reimport_deduplicates_via_composite_hash(_patch_db):
    """The 500-row + 48-row overlap scenario: second import of an
    identical row (no transaction_id) must dedupe via composite hash."""
    fake = _patch_db
    await _seed_asset(fake, id="A1", rego_serial="XT04CS", name="Kroll")
    csv_text = (
        f"{_REAL_9COL_HEADER}\n"
        "2026-08-31,06:30:28,21321,Kroll,XT04CS,Paneltec Breadalbane,252.390,Diesel,0\n"
    )
    r1 = await ff._import_csv(content=csv_text.encode(), filename="a.csv",
                                org_id="ORG", workspace_id=None, user_id="U")
    r2 = await ff._import_csv(content=csv_text.encode(), filename="b.csv",
                                org_id="ORG", workspace_id=None, user_id="U")
    assert r1.rows_inserted == 1
    assert r2.rows_inserted == 0
    # v58.13.131n — under the default upsert-on, a re-import with the
    # same columns counts as `rows_unchanged`, not `rows_duplicate`.
    assert (r2.rows_duplicate + r2.rows_unchanged) == 1


def test_compose_dedupe_hash_stable():
    """Same input → same hash. Bump timestamp or litres → different hash."""
    a = ff._compose_dedupe_hash(card_number="21321", key_code="",
                                 registration="XT04CS", timestamp="2026-08-31T06:30:28+00:00",
                                 litres=252.390)
    b = ff._compose_dedupe_hash(card_number="21321", key_code="",
                                 registration="XT04CS", timestamp="2026-08-31T06:30:28+00:00",
                                 litres=252.390)
    c = ff._compose_dedupe_hash(card_number="21321", key_code="",
                                 registration="XT04CS", timestamp="2026-08-31T06:30:28+00:00",
                                 litres=252.400)
    assert a == b
    assert a != c
    assert ff._compose_dedupe_hash(card_number="", key_code="",
                                    registration="", timestamp="x",
                                    litres=1.0) is None


# ── §8 Description-only fallback ──────────────────────────────
@pytest.mark.asyncio
async def test_blank_rego_with_description_lands_unmatched(_patch_db):
    """"Daniel Butler" / "Office" style rows with no rego → unmatched
    (with description as the hint), NOT rejected."""
    fake = _patch_db
    csv_text = (
        f"{_REAL_9COL_HEADER}\n"
        "2026-08-31,08:00:00,,Daniel Butler,,Paneltec Breadalbane,50.000,Diesel,0\n"
        "2026-08-31,09:00:00,,,,Paneltec Breadalbane,10.000,Diesel,0\n"
    )
    r = await ff._import_csv(content=csv_text.encode(), filename="edge.csv",
                              org_id="ORG", workspace_id=None, user_id="U")
    # Row 1: unmatched (description present). Row 2: rejected (all blank).
    assert r.rows_inserted == 1
    assert r.rows_rejected == 1
    assert r.rows_unmatched == 1
    tx = await fake.fuel_transactions.find_one({"org_id": "ORG"})
    assert tx["description"] == "Daniel Butler"
    assert tx["match_status"] == "unmatched"


# ── R7 price-gate ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_r7_skipped_when_no_price_this_batch(_patch_db):
    """Batch has zero priced rows → R7 recorded in rules_suppressed."""
    fake = _patch_db
    await _seed_asset(fake, id="A1", rego_serial="XT04CS")
    csv_text = (
        f"{_REAL_9COL_HEADER}\n"
        "2026-08-31,06:30:28,21321,Kroll,XT04CS,Paneltec Breadalbane,252.390,Diesel,0\n"
    )
    await ff._import_csv(content=csv_text.encode(), filename="nopr.csv",
                          org_id="ORG", workspace_id=None, user_id="U")
    batch = await fake.fuel_import_batches.find_one({"org_id": "ORG"})
    supp_rules = [rule for s in batch["rules_suppressed"] for rule in s["rules"]]
    assert "procurement_outlier" in supp_rules


# ── Total Price header aliases ─────────────────────────────────
# NOTE: The `$` alias is registered in `_HEADER_ALIASES` for forward-
# compatibility but can't be matched by the normaliser (which strips
# to `[a-z0-9]`). Real portal exports use `Total Price` — the alias
# list is a safety net for future variants.
@pytest.mark.parametrize("alias", ["Total Price", "Amount", "Cost", "Value", "Price", "Total"])
@pytest.mark.asyncio
async def test_total_price_header_aliases(_patch_db, alias):
    """Every recognised alias maps to canonical total_price."""
    fake = _patch_db
    await _seed_asset(fake, id="A1", rego_serial="XT04CS")
    csv_text = (
        f"Date,Time,Card Number,Registration,Litres,{alias}\n"
        f"2026-08-31,06:30:28,21321,XT04CS,50.000,175.00\n"
    )
    r = await ff._import_csv(content=csv_text.encode(), filename="alias.csv",
                              org_id="ORG", workspace_id=None, user_id="U")
    assert r.rows_inserted == 1
    tx = await fake.fuel_transactions.find_one({"org_id": "ORG"})
    assert tx["total_price"] == 175.00


# ── Coverage stats ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_batch_records_price_and_odo_coverage(_patch_db):
    """price_coverage_pct + zero_odometer_pct end up on the batch doc."""
    fake = _patch_db
    await _seed_asset(fake, id="A1", rego_serial="XT04CS")
    csv_text = (
        "Date,Time,Card Number,Registration,Litres,Total Price,Odometer\n"
        "2026-08-31,06:30:28,21321,XT04CS,50.000,175.00,0\n"
        "2026-08-31,07:30:28,21321,XT04CS,60.000,,0\n"
    )
    await ff._import_csv(content=csv_text.encode(), filename="cov.csv",
                          org_id="ORG", workspace_id=None, user_id="U")
    batch = await fake.fuel_import_batches.find_one({"org_id": "ORG"})
    assert batch["price_coverage_pct"] == 50.0
    assert batch["zero_odometer_pct"] == 100.0


# ── Version pin ────────────────────────────────────────────────
def _read(rel):
    with open(f"/app/{rel}") as fh:
        return fh.read()


def test_version_bumped_to_131g():
    # v58.13.122c — Ship-label chronology is not monotonic; instead of
    # regexing the current version string (which can go "backwards" to
    # .122c after .131k), we assert the .131g ship memo exists as
    # persistent proof-of-ship.
    from pathlib import Path
    memo = Path("/app/memory/v58_13_131g_shipped_finish_deferred.md")
    assert memo.exists(), "v58.13.131g ship memo missing — ship regressed?"


# ── v58.13.131h — Soft-delete → re-import cycle ─────────────────
@pytest.mark.asyncio
async def test_soft_delete_then_reimport_succeeds(_patch_db):
    """After soft-deleting a batch, re-importing the identical CSV
    must succeed (rather than being blocked by dedupe on
    soft-deleted rows). The partial-unique index filter includes
    `deleted_at: null` so soft-deleted rows are excluded from
    dedupe checks."""
    fake = _patch_db
    await _seed_asset(fake, id="A1", rego_serial="XT04CS", name="Kroll")
    csv_text = (
        f"{_REAL_9COL_HEADER}\n"
        "2026-08-31,06:30:28,21321,Kroll,XT04CS,Paneltec Breadalbane,252.390,Diesel,0\n"
    )
    r1 = await ff._import_csv(content=csv_text.encode(), filename="a.csv",
                                org_id="ORG", workspace_id=None, user_id="U")
    assert r1.rows_inserted == 1
    # Soft-delete every fuel_transaction in the batch.
    for d in fake.fuel_transactions.docs:
        d["deleted_at"] = "2026-09-05T08:00:00+00:00"
    # Re-import — our fake DB's find() honours `deleted_at: None`
    # via `$ne` matcher and dedupe should therefore NOT trigger.
    r2 = await ff._import_csv(content=csv_text.encode(), filename="a2.csv",
                                org_id="ORG", workspace_id=None, user_id="U")
    assert r2.rows_inserted == 1, (
        "Soft-deleted rows must NOT block re-import "
        "(partial index filter requires deleted_at: null)"
    )
    assert r2.rows_duplicate == 0
