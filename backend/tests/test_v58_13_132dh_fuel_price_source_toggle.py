"""v58.13.132dh — Fuel Price Source segmented control.

Locks the enum-based `override_mode` field (`"provisional_all"` vs
`"smartfill_with_fallback"`) sitting alongside the legacy .132dg
boolean, and verifies the header segmented control.

v58.13.132dy — INVERTED for the frozen-price architecture. Fuel
transactions are now stamped with `frozen_total_price`,
`frozen_price_per_litre`, and `frozen_price_source` AT IMPORT TIME.
Once stamped, a row is immutable — flipping the org-wide toggle
between `provisional_all` and `smartfill_with_fallback` does NOT
reprice historical rows. Only future imports pick up the new mode.

The pre-.132dy behavioural tests (which asserted read-time reprice
of every existing row) have been rewritten to lock the opposite:
existing frozen rows stay unchanged when the toggle flips. Source-
pins now assert the `frozen_at`-prefer path in `list_transactions`
+ retain the legacy `effective_total_price` fallback for rows the
`.132dx` migration hasn't yet touched (defensive).
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


def test_list_transactions_prefers_frozen_snapshot():
    """v58.13.132dy — `list_transactions` prefers the frozen snapshot
    fields (`frozen_total_price`, `frozen_price_per_litre`,
    `frozen_price_source`) when a row carries `frozen_at`. Legacy
    `effective_total_price` fallback is retained for pre-migration
    rows only."""
    src = FLEET_MOD.read_text(encoding="utf-8")
    # Prefer path — frozen snapshot short-circuits any read-time reprice.
    assert 'it.get("frozen_at")' in src
    assert 'frozen_total_price' in src
    assert 'frozen_price_per_litre' in src
    assert 'price_source_snapshot' in src and 'frozen_price_source' in src
    # Fallback path retained for legacy rows (defensive).
    assert "effective_total_price(it, provisional_price, override_smartfill)" in src
    # And surfaces the state so the FE can badge the current mode.
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


def test_frontend_toggle_labels_future_scoped():
    """v58.13.132dy — Toggle labels are re-worded so admins understand
    a flip only affects new imports. Historical rows are frozen."""
    src = FUEL_JSX.read_text(encoding="utf-8")
    # New "· future" scoped labels.
    assert "SmartFill real · future" in src
    assert "Provisional · future" in src
    # Hover tooltip carries the fuller sentence.
    assert "SmartFill real prices apply to imports going forward" in src
    assert "Provisional override applies to imports going forward" in src


def test_frontend_frozen_hints_wired():
    """v58.13.132dy — Two subtle info lines (one under the segmented
    control, one under the Provisional price Edit modal) tell the
    admin that historical transactions stay frozen."""
    src = FUEL_JSX.read_text(encoding="utf-8")
    assert 'data-testid="fuel-price-source-frozen-hint"' in src
    assert 'data-testid="fuel-price-edit-frozen-hint"' in src
    assert "Historical transactions are frozen" in src
    assert "New price applies to imports from now on" in src


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
def seeded_frozen_txs():
    """v58.13.132dy — Seed two rows with FROZEN snapshots already
    stamped. These stand in for real production rows the
    `.132dx` migration has already touched. The tests then flip
    the org toggle and assert every row surfaces its FROZEN
    values verbatim — read-time reprice is dead."""
    db = _mongo()
    u = db.users.find_one({"email": "stephen@paneltec.com.au"})
    if not u:
        pytest.skip("Stephen user not seeded")
    org_id = u["org_id"]
    tag = f"pytest-132dy-frozen-{uuid.uuid4().hex[:6]}"
    now = datetime.now(timezone.utc)
    d0 = (now - timedelta(hours=6)).isoformat()
    d1 = (now - timedelta(hours=2)).isoformat()
    frozen_at = now.isoformat()
    docs = [
        # Frozen at import time under SmartFill (real) mode — 50 L @ 1.80.
        {"id": f"{tag}-real", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d0[:10], "timestamp": d0, "litres": 50.0,
         "total_price": 90.0, "computed_price_per_litre": 1.80,
         "price_source": "smartfill_actual",
         "frozen_at": frozen_at,
         "frozen_total_price": 90.0,
         "frozen_price_per_litre": 1.80,
         "frozen_price_source": "smartfill_real",
         "driver": "Pytest Driver"},
        # Frozen at import time under Provisional (override) mode — 10 L @ 2.25.
        # (Stored total_price still carries the SmartFill raw for audit.)
        {"id": f"{tag}-ovr", "org_id": org_id, "asset_id": tag,
         "registration": tag, "deleted_at": None,
         "date_iso": d1[:10], "timestamp": d1, "litres": 10.0,
         "total_price": 25.0, "computed_price_per_litre": 2.50,
         "price_source": "smartfill_actual",
         "frozen_at": frozen_at,
         "frozen_total_price": 22.5,
         "frozen_price_per_litre": 2.25,
         "frozen_price_source": "provisional_override",
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
def test_mode_switch_persists_org_wide(seeded_frozen_txs):
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
def test_provisional_all_leaves_frozen_rows_unchanged(seeded_frozen_txs):
    """v58.13.132dy — Flipping to `provisional_all` MUST NOT reprice
    rows that were frozen at import. Each row surfaces its
    `frozen_total_price` + `frozen_price_per_litre` verbatim."""
    hdr = _pin_login()
    tag = seeded_frozen_txs["tag"]
    # Set price 3.000 (should NOT be applied to the frozen rows).
    _put(hdr, provisional_price_per_litre=3.00, override_mode="provisional_all")
    r = requests.get(f"{API}/api/fleet/fuel/transactions",
                     headers=hdr,
                     params={"page": 1, "size": 200}).json()
    items = {i["id"]: i for i in r["items"] if i.get("registration") == tag}
    assert len(items) == 2, f"expected 2 seeded rows, saw {len(items)}"
    # Row frozen as `smartfill_real` — still shows 90.0 @ 1.80.
    real = items[f"{tag}-real"]
    assert abs(real["total_price"] - 90.0) < 0.01, (
        f"frozen smartfill_real row was repriced under provisional_all: "
        f"got total {real['total_price']}"
    )
    assert abs(real["computed_price_per_litre"] - 1.80) < 0.001
    assert real.get("price_source_snapshot") == "smartfill_real"
    # Row frozen as `provisional_override` — still shows 22.5 @ 2.25,
    # NOT the new 3.00.
    ovr = items[f"{tag}-ovr"]
    assert abs(ovr["total_price"] - 22.5) < 0.01
    assert abs(ovr["computed_price_per_litre"] - 2.25) < 0.001
    assert ovr.get("price_source_snapshot") == "provisional_override"
    # Response still surfaces the current effective mode so the FE
    # segmented control paints correctly.
    assert r["price_state"]["override_mode"] == "provisional_all"
    # DB integrity: stored values untouched, `frozen_*` still present.
    real_db = _mongo().fuel_transactions.find_one({"id": f"{tag}-real"})
    assert abs(real_db["frozen_total_price"] - 90.0) < 1e-6
    assert real_db["frozen_price_source"] == "smartfill_real"
    # Restore.
    _put(hdr, provisional_price_per_litre=2.25, override_mode="smartfill_with_fallback")


@pytest.mark.live_db_writes
def test_smartfill_with_fallback_leaves_frozen_rows_unchanged(seeded_frozen_txs):
    """v58.13.132dy — Same guarantee under `smartfill_with_fallback`
    mode: rows frozen with a `provisional_override` snapshot keep
    surfacing the frozen provisional values, even though the current
    mode says "prefer real"."""
    hdr = _pin_login()
    tag = seeded_frozen_txs["tag"]
    _put(hdr, provisional_price_per_litre=3.00, override_mode="smartfill_with_fallback")
    r = requests.get(f"{API}/api/fleet/fuel/transactions",
                     headers=hdr,
                     params={"page": 1, "size": 200}).json()
    items = {i["id"]: i for i in r["items"] if i.get("registration") == tag}
    real, ovr = items[f"{tag}-real"], items[f"{tag}-ovr"]
    # Real-frozen row: 90.0 @ 1.80 (unchanged).
    assert abs(real["total_price"] - 90.0) < 0.01
    assert abs(real["computed_price_per_litre"] - 1.80) < 0.001
    # Override-frozen row: STILL 22.5 @ 2.25 — NOT reverted to the
    # SmartFill raw 25.0 @ 2.50. The frozen snapshot wins.
    assert abs(ovr["total_price"] - 22.5) < 0.01
    assert abs(ovr["computed_price_per_litre"] - 2.25) < 0.001
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

def test_three_way_sync_at_132dy_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "dy"
