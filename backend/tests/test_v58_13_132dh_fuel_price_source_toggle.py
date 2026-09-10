"""v58.13.132dh — Fuel Price Source segmented control.

Locks the enum-based `override_mode` field (`"provisional_all"` vs
`"smartfill_with_fallback"`) sitting alongside the legacy .132dg
boolean, and verifies the header segmented control + Per-Fill
Transactions read-time reprice.
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
PRICE_MOD  = APP_ROOT / "backend" / "fuel_price_settings.py"
FLEET_MOD  = APP_ROOT / "backend" / "fleet_fuel.py"
FUEL_JSX   = APP_ROOT / "frontend" / "src" / "pages" / "FuelReporting.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW         = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


# ─── Backend source guardrails ─────────────────────────────────

def test_override_mode_enum_defined():
    from fuel_price_settings import (
        DEFAULT_OVERRIDE_MODE,
        _mode_from_bool,
        _bool_from_mode,
    )
    assert DEFAULT_OVERRIDE_MODE == "smartfill_with_fallback"
    assert _mode_from_bool(True) == "provisional_all"
    assert _mode_from_bool(False) == "smartfill_with_fallback"
    assert _bool_from_mode("provisional_all") is True
    assert _bool_from_mode("smartfill_with_fallback") is False


def test_priceIn_accepts_mode_and_makes_price_optional():
    from fuel_price_settings import PriceIn
    # Price-only PATCH (legacy).
    p1 = PriceIn(provisional_price_per_litre=2.5)
    assert p1.override_mode is None
    # Mode-only PATCH (new .132dh flow).
    p2 = PriceIn(override_mode="provisional_all")
    assert p2.provisional_price_per_litre is None
    assert p2.override_mode == "provisional_all"
    # Both.
    p3 = PriceIn(provisional_price_per_litre=3.0,
                 override_mode="smartfill_with_fallback")
    assert p3.provisional_price_per_litre == 3.0
    assert p3.override_mode == "smartfill_with_fallback"


def test_out_surfaces_mode_and_boolean():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert '"override_mode":' in src
    # Both legacy boolean AND enum are persisted for BC.
    assert '"override_smartfill_real":' in src


def test_history_records_mode_transition():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert '"old_mode"' in src
    assert '"new_mode"' in src


def test_list_transactions_reprices_at_read_time():
    src = FLEET_MOD.read_text(encoding="utf-8")
    # The endpoint now materialises `items` and reprices each row.
    assert "effective_total_price(it, provisional_price, override_smartfill)" in src
    assert 'computed_price_per_litre' in src
    # And surfaces the state so the FE can badge the override.
    assert '"price_state"' in src


def test_frontend_header_segmented_control_wired():
    src = FUEL_JSX.read_text(encoding="utf-8")
    for testid in (
        "fuel-price-source-toggle",
        "fuel-price-source-smartfill",
        "fuel-price-source-provisional",
    ):
        assert f'data-testid="{testid}"' in src, f"missing testid {testid!r}"
    # Provisional-active badge on the header.
    assert 'data-testid="provisional-override-active-badge"' in src
    # PUT payload uses the enum, not the legacy boolean.
    assert "override_mode: mode" in src
    # Non-admins get a read-only chip.
    assert 'data-testid="fuel-price-source-readonly"' in src


def test_modal_override_checkbox_removed():
    """The .132dg modal checkbox is replaced by the .132dh header
    segmented control. Dual controls confused Stephen — the modal
    is now price-only."""
    src = FUEL_JSX.read_text(encoding="utf-8")
    assert 'fuel-price-override-checkbox' not in src
    assert 'fuel-price-override-row' not in src


# ─── End-to-end round-trip ─────────────────────────────────────

def _mongo():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture
def seeded_txs():
    db = _mongo()
    u = db.users.find_one({"email": "stephen@paneltec.com.au"})
    if not u:
        pytest.skip("Stephen user not seeded")
    org_id = u["org_id"]
    tag = f"pytest-132dh-{uuid.uuid4().hex[:6]}"
    now = datetime.now(timezone.utc)
    d0 = (now - timedelta(hours=6)).isoformat()
    d1 = (now - timedelta(hours=2)).isoformat()
    docs = [
        # SmartFill row with a REAL price @ 1.80/L.
        {"id": f"{tag}-real", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d0[:10], "timestamp": d0, "litres": 50.0,
         "total_price": 90.0, "computed_price_per_litre": 1.80,
         "price_source": "smartfill_actual",
         "driver": "Pytest Driver"},
        # SmartFill row missing a price — provisional fallback candidate.
        {"id": f"{tag}-nopr", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d1[:10], "timestamp": d1, "litres": 10.0,
         "total_price": None, "computed_price_per_litre": None,
         "price_source": None,
         "driver": "Pytest Driver"},
    ]
    db.fuel_transactions.insert_many(docs)
    yield {"org_id": org_id, "tag": tag}
    db.fuel_transactions.delete_many({"id": {"$in": [d["id"] for d in docs]}})


def _pin_login():
    r = requests.post(f"{API}/api/auth/mobile/pin-login",
                      json={"pin": "3310", "device_id": "pytest-132dh"})
    if r.status_code == 429 or r.status_code != 200:
        pytest.skip(f"PIN login unavailable ({r.status_code})")
    return {"Authorization": f"Bearer {r.json()['session_token']}"}


def _put(hdr, **body):
    r = requests.put(f"{API}/api/fleet/fuel/price-settings",
                     headers=hdr, json=body)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.live_db_writes
def test_mode_switch_persists_org_wide(seeded_txs):
    hdr = _pin_login()
    # Baseline: fallback.
    s0 = _put(hdr, override_mode="smartfill_with_fallback")
    assert s0["override_mode"] == "smartfill_with_fallback"
    assert s0["override_smartfill_real"] is False
    # Flip to provisional_all.
    s1 = _put(hdr, override_mode="provisional_all")
    assert s1["override_mode"] == "provisional_all"
    assert s1["override_smartfill_real"] is True  # BC boolean stays in sync.
    # Round-trip via GET.
    r = requests.get(f"{API}/api/fleet/fuel/price-settings", headers=hdr).json()
    assert r["override_mode"] == "provisional_all"
    # Restore.
    _put(hdr, override_mode="smartfill_with_fallback")


@pytest.mark.live_db_writes
def test_provisional_all_reprices_every_row(seeded_txs):
    hdr = _pin_login()
    tag = seeded_txs["tag"]
    # Set price 3.000 and mode = provisional_all.
    _put(hdr, provisional_price_per_litre=3.00, override_mode="provisional_all")
    r = requests.get(f"{API}/api/fleet/fuel/transactions",
                     headers=hdr,
                     params={"page": 1, "size": 200}).json()
    items = [i for i in r["items"] if i.get("registration") == tag]
    assert len(items) == 2, f"expected 2 seeded rows, saw {len(items)}"
    for it in items:
        litres = float(it["litres"])
        # EVERY row shows provisional × litres (real SmartFill folded).
        assert abs(it["total_price"] - litres * 3.00) < 0.01
        assert abs(it["computed_price_per_litre"] - 3.00) < 0.001
    # Response surfaces the effective state for the FE badge.
    assert r["price_state"]["override_mode"] == "provisional_all"
    assert abs(r["price_state"]["provisional_price_per_litre"] - 3.00) < 1e-6
    # DB integrity: stored total_price on the real-price row is
    # untouched (read-time reprice only).
    real = _mongo().fuel_transactions.find_one({"id": f"{tag}-real"})
    assert abs(real["total_price"] - 90.0) < 1e-6
    assert abs(real["computed_price_per_litre"] - 1.80) < 1e-6
    # Restore.
    _put(hdr, provisional_price_per_litre=2.25, override_mode="smartfill_with_fallback")


@pytest.mark.live_db_writes
def test_smartfill_with_fallback_preserves_real(seeded_txs):
    hdr = _pin_login()
    tag = seeded_txs["tag"]
    _put(hdr, provisional_price_per_litre=3.00, override_mode="smartfill_with_fallback")
    r = requests.get(f"{API}/api/fleet/fuel/transactions",
                     headers=hdr,
                     params={"page": 1, "size": 200}).json()
    items = {i["id"]: i for i in r["items"] if i.get("registration") == tag}
    real, nopr = items[f"{tag}-real"], items[f"{tag}-nopr"]
    # Real SmartFill row untouched (stored 90.0 @ 1.80/L).
    assert abs(real["total_price"] - 90.0) < 0.01
    assert abs(real["computed_price_per_litre"] - 1.80) < 0.001
    # Row without a real price falls back to provisional 3.00.
    assert abs(nopr["total_price"] - 10.0 * 3.00) < 0.01
    assert abs(nopr["computed_price_per_litre"] - 3.00) < 0.001
    assert r["price_state"]["override_mode"] == "smartfill_with_fallback"
    # Restore.
    _put(hdr, provisional_price_per_litre=2.25, override_mode="smartfill_with_fallback")


# ─── PATCH-style mode-only payload ─────────────────────────────

@pytest.mark.live_db_writes
def test_mode_only_payload_preserves_price():
    hdr = _pin_login()
    # Baseline: fix the price at 2.50.
    _put(hdr, provisional_price_per_litre=2.50, override_mode="smartfill_with_fallback")
    # Send ONLY the mode.
    r = requests.put(f"{API}/api/fleet/fuel/price-settings",
                     headers=hdr, json={"override_mode": "provisional_all"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["override_mode"] == "provisional_all"
    assert abs(body["provisional_price_per_litre"] - 2.50) < 1e-6, (
        "price wasn't preserved on mode-only PATCH"
    )
    # Restore.
    _put(hdr, provisional_price_per_litre=2.25, override_mode="smartfill_with_fallback")


# ─── Version sync ─────────────────────────────────────────────

def test_three_way_sync_at_132dh_or_later():
    running = re.search(r"RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text()).group(1)
    expected = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text()).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dh"
