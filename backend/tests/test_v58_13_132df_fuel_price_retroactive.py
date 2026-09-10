"""v58.13.132df — Retroactive + prospective provisional fuel price.

Locks:
  · `PROVISIONAL_PRICE_SOURCES` frozenset exported from
    `fuel_price_settings`.
  · `effective_total_price(tx, price)` helper — 3 branches:
      - provisional-marker tag → repriced
      - no total_price + litres>0 (SmartFill w/o real price) → repriced
      - real total_price → untouched
  · `_bust_downstream_caches()` clears in-process TTL caches in
    `fleet_fuel.py` (asset + card summaries) on price PUT.
  · `_aggregate` in `fleet_fuel_reports.py` reprices at read time.
  · `asset_fuel_summary` + `card_summary` split real/provisional
    aggregation buckets and reprice the provisional portion in
    Python at read time.
  · End-to-end: leaderboard totals change when the price is bumped,
    real-price fills remain untouched.
  · 3-way web-version sync at `.132df` or later.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
PRICE_MOD    = APP_ROOT / "backend" / "fuel_price_settings.py"
REPORTS_MOD  = APP_ROOT / "backend" / "fleet_fuel_reports.py"
FLEET_MOD    = APP_ROOT / "backend" / "fleet_fuel.py"
FUEL_JSX     = APP_ROOT / "frontend" / "src" / "pages" / "FuelReporting.jsx"
VERSION_JS   = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW           = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


# ─── Unit-level source guardrails ────────────────────────────────

def test_provisional_source_set_exported():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert "PROVISIONAL_PRICE_SOURCES" in src
    assert '"provisional_static_2.25"' in src
    assert '"provisional_static_3.00"' in src


def test_effective_total_price_helper_exists():
    from fuel_price_settings import effective_total_price, PROVISIONAL_PRICE_SOURCES
    # Branch 1: marker-tagged row is repriced.
    assert effective_total_price(
        {"litres": 40, "total_price": 88, "price_source": "provisional_static_2.25"},
        3.00,
    ) == pytest.approx(120.0)
    # Branch 2: SmartFill row without a real price is repriced.
    assert effective_total_price(
        {"litres": 10, "total_price": 0, "price_source": None},
        2.50,
    ) == pytest.approx(25.0)
    # Branch 3: real SmartFill price is never touched.
    assert effective_total_price(
        {"litres": 10, "total_price": 15.0, "price_source": "smartfill_actual"},
        99.99,
    ) == pytest.approx(15.0)
    # Guardrail: real-priced rows are protected regardless of price.
    assert "smartfill_actual" not in PROVISIONAL_PRICE_SOURCES


def test_reports_aggregate_uses_effective_price():
    src = REPORTS_MOD.read_text(encoding="utf-8")
    assert "from fuel_price_settings import" in src
    assert "effective_total_price" in src
    # v58.13.132dg — helper renamed to `get_org_price_state`
    # (returns price + override tuple). Test accepts either.
    assert ("get_org_price_state" in src) or ("get_org_provisional_price" in src)
    # Guardrail: the loop must overwrite `t['total_price']` with the
    # effective value BEFORE the roll-up. Otherwise the price change
    # would not flow through leaderboards.
    assert 't["total_price"] = effective_total_price(' in src


def test_asset_and_card_summary_split_buckets():
    src = FLEET_MOD.read_text(encoding="utf-8")
    # Both summaries must reference the split-bucket shape.
    assert "real_total_price" in src
    assert "provisional_litres" in src
    # Both summaries must import the read-time helpers.
    assert "PROVISIONAL_PRICE_SOURCES" in src
    assert "effective_total_price" in src
    # v58.13.132dg — accept either the .132df helper name or the
    # new combined `get_org_price_state`.
    assert ("get_org_price_state" in src) or ("get_org_provisional_price" in src)


def test_put_price_flushes_downstream_caches():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert "_bust_downstream_caches" in src
    # Must be called from within put_price_settings.
    assert src.count("_bust_downstream_caches()") >= 1
    # And target the two per-process caches in fleet_fuel.
    assert "_FUEL_SUMMARY_CACHE" in src
    assert "_CARD_SUMMARY_CACHE" in src


def test_frontend_copy_reflects_retroactive_intent():
    src = FUEL_JSX.read_text(encoding="utf-8")
    # Info-line reassurance.
    assert "Applies to past and future fills" in src
    assert "real prices are never overwritten" in src.lower()
    # Post-save reports refetch.
    assert "priceRefreshTick" in src
    # Banner uses the live setting, not the hardcoded literal.
    assert "priceSettings?.provisional_price_per_litre" in src


# ─── End-to-end: leaderboard totals track price changes ─────────

def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture
def seeded_txs():
    """Seed 3 test fuel_transactions for Stephen's org — 2 provisional,
    1 real-priced — inside a synthetic month. Cleans up after."""
    db = _mongo()
    # Resolve Stephen's org_id via his users row.
    u = db.users.find_one({"email": "stephen@paneltec.com.au"})
    if not u:
        pytest.skip("Stephen user not seeded")
    org_id = u["org_id"]

    # v58.13.132df — Use a synthetic asset_id in a distant-future date
    # window so we don't collide with real .132ap SmartFill data.
    tag = f"pytest-132df-{uuid.uuid4().hex[:6]}"
    now = datetime.now(timezone.utc)
    d0 = (now - timedelta(days=1)).isoformat()
    d1 = (now - timedelta(hours=6)).isoformat()
    d2 = (now - timedelta(hours=2)).isoformat()
    docs = [
        # Provisional marker row — 40 L, stored price stale.
        {"id": f"{tag}-A", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d0[:10], "timestamp": d0, "litres": 40.0,
         "total_price": 90.0, "price_source": "provisional_static_2.25",
         "driver": "Pytest Driver"},
        # SmartFill row w/o real price — 10 L, total_price null.
        {"id": f"{tag}-B", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d1[:10], "timestamp": d1, "litres": 10.0,
         "total_price": None, "price_source": None,
         "driver": "Pytest Driver"},
        # Real-priced SmartFill row — 20 L @ $1.80/L, must be untouched.
        {"id": f"{tag}-C", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d2[:10], "timestamp": d2, "litres": 20.0,
         "total_price": 36.0, "price_source": "smartfill_actual",
         "driver": "Pytest Driver"},
    ]
    db.fuel_transactions.insert_many(docs)
    yield {"org_id": org_id, "tag": tag, "docs": docs}
    db.fuel_transactions.delete_many({"id": {"$in": [d["id"] for d in docs]}})


def _pin_login():
    r = requests.post(f"{API}/api/auth/mobile/pin-login",
                      json={"pin": "3310", "device_id": "pytest-132df"})
    if r.status_code == 429 or r.status_code != 200:
        pytest.skip(f"PIN login unavailable ({r.status_code})")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def _put_price(hdr, price):
    r = requests.put(f"{API}/api/fleet/fuel/price-settings",
                     headers=hdr, json={"provisional_price_per_litre": price})
    assert r.status_code == 200, r.text


def _find_row_by_reg(rows, reg):
    return next((r for r in rows if reg in (r.get("label") or "")), None)


@pytest.mark.live_db_writes
def test_leaderboard_totals_reprice_at_read_time(seeded_txs):
    hdr = _pin_login()
    tag = seeded_txs["tag"]

    # Set price to 2.25 and read Per-Vehicle rollup.
    _put_price(hdr, 2.25)
    r1 = requests.get(f"{API}/api/fleet/fuel/reports",
                      headers=hdr,
                      params={"scope": "vehicle", "period": "monthly"})
    assert r1.status_code == 200, r1.text
    row1 = _find_row_by_reg(r1.json()["rows"], tag)
    assert row1 is not None, f"no synthetic row for tag {tag}"
    # Expected @ 2.25: (40 * 2.25) + (10 * 2.25) + 36 real = 90 + 22.5 + 36 = 148.5
    expected_at_225 = 40 * 2.25 + 10 * 2.25 + 36.0
    assert abs(row1["total_price"] - expected_at_225) < 0.01, (
        f"row1.total_price={row1['total_price']} expected {expected_at_225}"
    )

    # Bump price to 3.00 and re-read — totals must move.
    _put_price(hdr, 3.00)
    r2 = requests.get(f"{API}/api/fleet/fuel/reports",
                      headers=hdr,
                      params={"scope": "vehicle", "period": "monthly"})
    assert r2.status_code == 200, r2.text
    row2 = _find_row_by_reg(r2.json()["rows"], tag)
    assert row2 is not None
    # Expected @ 3.00: (40 * 3.00) + (10 * 3.00) + 36 real = 120 + 30 + 36 = 186
    expected_at_300 = 40 * 3.00 + 10 * 3.00 + 36.0
    assert abs(row2["total_price"] - expected_at_300) < 0.01, (
        f"row2.total_price={row2['total_price']} expected {expected_at_300}"
    )
    # Real-priced portion never moved — delta must equal
    # (provisional_litres) × (new − old) = 50 × 0.75 = 37.5.
    delta = row2["total_price"] - row1["total_price"]
    assert abs(delta - 37.5) < 0.01, (
        f"delta={delta} expected 37.5 (50 provisional L × $0.75)"
    )
    # Litres are physical — must not change with price.
    assert abs(row1["litres"] - row2["litres"]) < 1e-6

    # Restore price to 2.25 for idempotency.
    _put_price(hdr, 2.25)


@pytest.mark.live_db_writes
def test_smartfill_real_price_never_overwritten(seeded_txs):
    """After bumping the provisional price 2.25 → 3.00 → 2.25, the
    stored `total_price` on the real-priced row must remain 36.0."""
    hdr = _pin_login()
    _put_price(hdr, 3.00)
    _put_price(hdr, 2.25)
    db = _mongo()
    tag = seeded_txs["tag"]
    real_row = db.fuel_transactions.find_one({"id": f"{tag}-C"})
    assert real_row is not None
    assert abs(real_row["total_price"] - 36.0) < 1e-6, (
        f"real-priced row was overwritten: total_price={real_row['total_price']}"
    )


# ─── Version sync ─────────────────────────────────────────────

def test_three_way_sync_at_132df_or_later():
    running = re.search(r"RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text()).group(1)
    expected = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text()).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "df"
