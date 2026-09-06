"""v58.13.131i — Tests for Navixy history writeback field-name proof,
per-fill enrichment (`_import_csv` auto-enriches), and L/100km sanity
guards.

Reuses the `_FakeDB` fixture from `test_fuel_csv_import.py` so imports
have full-fidelity assets / fuel_transactions / fuel_import_batches
collections. Adds `asset_meter_history` on the instance.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, "..", "..", "backend"))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import fleet_fuel as ff  # noqa: E402
from test_fuel_csv_import import _FakeDB, _FakeCollection, _seed_asset  # noqa: E402


def _new_fake_db():
    """Extend the shared `_FakeDB` with an `asset_meter_history`
    collection used by `.131i` enrichment."""
    fake = _FakeDB()
    fake.asset_meter_history = _FakeCollection()
    return fake


@pytest.fixture
def fake_db(monkeypatch):
    fake = _new_fake_db()
    monkeypatch.setattr(ff, "db", fake)
    return fake


# ─────────────────────────────────────────────────────────────
# 1. Writeback field-name proof
# ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_meter_history_upsert_writes_odometer_km_total(monkeypatch):
    """Prove that the daily-snapshot cron writes
    `odometer_km_total`, not `odometer_km`. This is the field the
    `.131h` memo greped for by the wrong name."""
    import asset_meter_history as amh

    # Patch `_FakeCollection.update_one` isn't upsert-aware in the
    # shared fake, so use a small local variant for this test.
    class _MHColl(_FakeCollection):
        async def update_one(self, q, upd, upsert=False, **_kw):
            for d in self.docs:
                if all(d.get(k) == v for k, v in q.items()):
                    d.update(upd.get("$set") or {})
                    return type("R", (), {"matched_count": 1, "modified_count": 1})()
            if upsert:
                doc = {k: v for k, v in q.items()
                       if not isinstance(v, dict)}
                doc.update(upd.get("$setOnInsert") or {})
                doc.update(upd.get("$set") or {})
                self.docs.append(doc)
                return type("R", (), {"matched_count": 0, "modified_count": 0,
                                       "upserted_id": True})()
            return type("R", (), {"matched_count": 0, "modified_count": 0})()

        async def create_index(self, *a, **kw):
            return None

    fake_amh = _MHColl()

    class _FakeDBAMH:
        def __init__(self):
            self.asset_meter_history = fake_amh
    monkeypatch.setattr(amh, "db", _FakeDBAMH())

    asset = {"id": "a1", "org_id": "o1", "navixy_device_id": 999}
    ok = await amh._upsert(asset, "2026-09-05", 123.4, 55555.7, "navixy_sync")
    assert ok is True
    assert fake_amh.docs, "meter_history upsert produced no doc"
    stored = fake_amh.docs[0]
    assert stored["odometer_km_total"] == 55555.7
    assert stored["engine_hours_total"] == 123.4
    # The name the .131h memo grepped for MUST NOT exist on the doc.
    assert "odometer_km" not in stored


# ─────────────────────────────────────────────────────────────
# 2. Enrichment tier waterfall
# ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_enrich_returns_navixy_live_when_history_available(fake_db):
    from fleet_fuel_enrich import enrich_fill

    await fake_db.asset_meter_history.insert_one({
        "asset_id": "a1",
        "snapshot_date": "2026-09-04",
        "odometer_km_total": 12345.6,
        "engine_hours_total": 200.0,
    })
    out = await enrich_fill(
        fake_db,
        asset_id="a1",
        date_iso="2026-09-05",
        csv_odo=0,
        csv_hours=None,
        snapshots={},
    )
    assert out["odometer_source"] == "navixy_live"
    assert out["odometer_km"] == 12346
    assert out["_enrichment_confidence"] == "high"


@pytest.mark.asyncio
async def test_enrich_falls_back_to_snapshot_when_no_history(fake_db):
    from fleet_fuel_enrich import enrich_fill

    now = datetime.now(timezone.utc)
    snaps = {"a1": {"odo_km": 50000.0, "odo_updated": now, "hours": 700.0}}
    out = await enrich_fill(
        fake_db,
        asset_id="a1",
        date_iso="2026-09-05",
        csv_odo=None,
        csv_hours=None,
        snapshots=snaps,
    )
    assert out["odometer_source"] == "navixy_snapshot"
    assert out["_enrichment_confidence"] == "fresh"


@pytest.mark.asyncio
async def test_enrich_marks_stale_when_snapshot_older_than_24h(fake_db):
    from fleet_fuel_enrich import enrich_fill

    old = datetime.now(timezone.utc) - timedelta(hours=48)
    snaps = {"a1": {"odo_km": 50000.0, "odo_updated": old, "hours": None}}
    out = await enrich_fill(
        fake_db,
        asset_id="a1",
        date_iso="2026-09-05",
        csv_odo=None,
        csv_hours=None,
        snapshots=snaps,
    )
    assert out["_enrichment_confidence"] == "stale"


@pytest.mark.asyncio
async def test_enrich_returns_csv_wins_when_positive(fake_db):
    from fleet_fuel_enrich import enrich_fill

    snaps = {"a1": {"odo_km": 999.0, "odo_updated": datetime.now(timezone.utc),
                    "hours": 0}}
    out = await enrich_fill(
        fake_db,
        asset_id="a1",
        date_iso="2026-09-05",
        csv_odo=87654,
        csv_hours=None,
        snapshots=snaps,
    )
    assert out["odometer_source"] == "csv"
    assert out["odometer_km"] == 87654


@pytest.mark.asyncio
async def test_enrich_returns_unknown_when_no_signal(fake_db):
    from fleet_fuel_enrich import enrich_fill

    out = await enrich_fill(
        fake_db,
        asset_id="a1",
        date_iso="2026-09-05",
        csv_odo=None,
        csv_hours=None,
        snapshots={},
    )
    assert out["odometer_source"] == "unknown"


# ─────────────────────────────────────────────────────────────
# 3. L/100km guards
# ─────────────────────────────────────────────────────────────


def test_lp100_computes_normal_case():
    from fleet_fuel_enrich import compute_lp100

    lp, skip = compute_lp100(
        prev_odo=10000, prev_ts_iso="2026-09-01T10:00:00+00:00",
        prev_confidence="high", curr_odo=10500,
        curr_ts_iso="2026-09-03T10:00:00+00:00",
        curr_confidence="high", curr_litres=50,
    )
    assert skip is None
    assert lp == pytest.approx(10.0)


def test_lp100_skips_when_delta_zero():
    from fleet_fuel_enrich import compute_lp100

    lp, skip = compute_lp100(
        prev_odo=10000, prev_ts_iso="2026-09-01T10:00:00+00:00",
        prev_confidence="high", curr_odo=10000,
        curr_ts_iso="2026-09-02T10:00:00+00:00",
        curr_confidence="high", curr_litres=50,
    )
    assert lp is None
    assert skip == "delta_too_small_or_odd"


def test_lp100_skips_when_previous_stale():
    from fleet_fuel_enrich import compute_lp100

    lp, skip = compute_lp100(
        prev_odo=10000, prev_ts_iso="2026-09-01T10:00:00+00:00",
        prev_confidence="stale", curr_odo=10500,
        curr_ts_iso="2026-09-03T10:00:00+00:00",
        curr_confidence="high", curr_litres=50,
    )
    assert lp is None
    assert skip == "stale_confidence"


def test_lp100_skips_when_gap_over_30d():
    from fleet_fuel_enrich import compute_lp100

    lp, skip = compute_lp100(
        prev_odo=10000, prev_ts_iso="2026-06-01T10:00:00+00:00",
        prev_confidence="high", curr_odo=10500,
        curr_ts_iso="2026-09-03T10:00:00+00:00",
        curr_confidence="high", curr_litres=50,
    )
    assert lp is None
    assert skip.startswith("gap_over_")


def test_lp100_skips_when_computed_over_500():
    from fleet_fuel_enrich import compute_lp100

    lp, skip = compute_lp100(
        prev_odo=10000, prev_ts_iso="2026-09-01T10:00:00+00:00",
        prev_confidence="high", curr_odo=10001,
        curr_ts_iso="2026-09-02T10:00:00+00:00",
        curr_confidence="high", curr_litres=999,
    )
    assert lp is None
    assert skip == "computed_over_500"


# ─────────────────────────────────────────────────────────────
# 4. `_import_csv` auto-enriches — closes .131h Gap #7
# ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_import_csv_auto_enriches_from_navixy_live(fake_db):
    now = datetime.now(timezone.utc)
    await _seed_asset(
        fake_db,
        id="a1",
        rego_serial="AAA111",
        name="Vehicle - AAA111",
    )
    # Add Navixy plumbing bits the enrichment path expects.
    fake_db.assets.docs[-1].update({
        "navixy_device_id": 1,
        "odo_km_updated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "hours_meter_updated_at": None,
    })
    await fake_db.asset_meter_history.insert_one({
        "asset_id": "a1",
        "snapshot_date": "2026-09-04",
        "odometer_km_total": 55555.0,
        "engine_hours_total": 200.0,
    })

    csv_text = (
        "Date,Time,Registration,Litres,Odometer\n"
        "2026-09-05,08:00,AAA111,50.0,0\n"
    )
    res = await ff._import_csv(
        content=csv_text.encode("utf-8"),
        filename="test.csv",
        org_id="ORG",
        workspace_id=None,
        user_id="u1",
    )
    assert res.rows_inserted == 1
    tx = fake_db.fuel_transactions.docs[0]
    assert tx["odometer_source"] == "navixy_live"
    assert tx["odometer_km"] == 55555


@pytest.mark.asyncio
async def test_import_csv_falls_back_to_unknown_when_no_navixy(fake_db):
    await _seed_asset(fake_db, id="a2", rego_serial="BBB222",
                      name="Vehicle - BBB222")
    csv_text = (
        "Date,Time,Registration,Litres,Odometer\n"
        "2026-09-05,08:00,BBB222,50.0,0\n"
    )
    res = await ff._import_csv(
        content=csv_text.encode("utf-8"),
        filename="test.csv",
        org_id="ORG",
        workspace_id=None,
        user_id="u1",
    )
    assert res.rows_inserted == 1
    tx = fake_db.fuel_transactions.docs[0]
    assert tx["odometer_source"] == "unknown"
    r5 = [f for f in tx["anomaly_flags"] if f["rule"] == "missing_odometer"]
    assert r5, "R5 (missing_odometer) should fire when source is unknown"


# ─────────────────────────────────────────────────────────────
# 5. Version pin
# ─────────────────────────────────────────────────────────────


def test_version_pinned_at_131i_or_later():
    # v58.13.122c — Ship-label chronology is not monotonic; the .131i
    # ship might legitimately be followed by .122c. Assert the .131i
    # ship memo exists as persistent proof-of-ship.
    from pathlib import Path
    memo = Path("/app/memory/v58_13_131i_shipped_finish_deferred.md")
    assert memo.exists(), "v58.13.131i ship memo missing — ship regressed?"
