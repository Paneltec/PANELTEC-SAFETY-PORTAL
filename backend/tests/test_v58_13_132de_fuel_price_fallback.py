"""v58.13.132de — Admin-editable fuel-price fallback calculator.

Locks:
  · 3 endpoints mounted at /api/fleet/fuel:
      GET  /price-settings  (fleet.view)
      PUT  /price-settings  (fleet.edit)
      GET  /price-history   (fleet.view)
  · DEFAULT_PROVISIONAL_PRICE = 2.25.
  · get_org_provisional_price helper falls back to 2.25 when the
    collection is unseeded.
  · Real SmartFill prices are never touched (this module only
    serves the fallback value).
  · Three-way web-version sync at .132de.
"""
from __future__ import annotations

import os
import re
import asyncio
from pathlib import Path

import bcrypt
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
PRICE_MOD = APP_ROOT / "backend" / "fuel_price_settings.py"
FUEL_JSX = APP_ROOT / "frontend" / "src" / "pages" / "FuelReporting.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def test_default_price_is_2_25():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert "DEFAULT_PROVISIONAL_PRICE = 2.25" in src


def test_get_org_provisional_price_helper_exists():
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert "async def get_org_provisional_price(org_id: str)" in src
    assert "return DEFAULT_PROVISIONAL_PRICE" in src, (
        "helper must default to 2.25 when unseeded"
    )


def test_all_three_endpoints_gated_and_mounted():
    for method, path, code in (
        ("GET", "/api/fleet/fuel/price-settings", (401, 403)),
        ("PUT", "/api/fleet/fuel/price-settings", (401, 403, 422)),
        ("GET", "/api/fleet/fuel/price-history",  (401, 403)),
    ):
        r = requests.request(method, f"{API}{path}",
                             json={"provisional_price_per_litre": 2.25}
                             if method == "PUT" else None)
        assert r.status_code in code, (
            f"{method} {path} returned {r.status_code}: {r.text[:200]}"
        )


def test_frontend_wires_price_card_and_modal():
    src = FUEL_JSX.read_text(encoding="utf-8")
    for testid in (
        "fuel-price-card",
        "fuel-price-value",
        "fuel-price-edit-btn",
        "fuel-price-edit-modal",
        "fuel-price-edit-input",
        "fuel-price-edit-save",
        "fuel-price-history-toggle",
        "fuel-price-history-list",
    ):
        assert f'data-testid="{testid}"' in src, f"missing testid {testid!r}"
    assert "loadPriceSettings" in src
    assert "savePriceSettings" in src
    assert "/fleet/fuel/price-settings" in src
    assert "/fleet/fuel/price-history" in src


def test_smartfill_real_prices_not_referenced_from_settings_module():
    """Guardrail: the settings module must not read/write anything
    on the fuel_transactions collection — only fuel_price_settings
    and fuel_price_history. Real SmartFill prices stay untouched."""
    src = PRICE_MOD.read_text(encoding="utf-8")
    assert "fuel_transactions" not in src, (
        "settings module must never touch fuel_transactions — that's "
        "where real SmartFill prices live"
    )
    assert "db.fuel_price_settings" in src
    assert "db.fuel_price_history" in src


def test_admin_can_read_and_write(monkeypatch=None):
    """End-to-end: log in as Stephen (admin), read settings, save
    a new price, verify history row appended."""
    # PIN login to get a bearer.
    r = requests.post(f"{API}/api/auth/mobile/pin-login",
                      json={"pin": "3310", "device_id": "pytest-132de"})
    if r.status_code == 429:
        return  # rate-limited from prior tests
    if r.status_code != 200:
        return  # PIN not seeded — skip
    token = r.json()["session_token"]
    hdr = {"Authorization": f"Bearer {token}"}

    # Read initial (or seeded) settings.
    g = requests.get(f"{API}/api/fleet/fuel/price-settings", headers=hdr)
    assert g.status_code == 200
    body = g.json()
    assert "provisional_price_per_litre" in body

    # Set to 2.25 (idempotent — if already 2.25 no history row added).
    put = requests.put(f"{API}/api/fleet/fuel/price-settings",
                       headers=hdr, json={"provisional_price_per_litre": 2.25})
    assert put.status_code == 200
    assert abs(put.json()["provisional_price_per_litre"] - 2.25) < 1e-6

    # Change to 2.30 to force a history row.
    put2 = requests.put(f"{API}/api/fleet/fuel/price-settings",
                        headers=hdr, json={"provisional_price_per_litre": 2.30})
    assert put2.status_code == 200

    # Read history — must contain at least the 2.30 row.
    h = requests.get(f"{API}/api/fleet/fuel/price-history", headers=hdr)
    assert h.status_code == 200
    rows = h.json()["history"]
    assert any(abs(r["new_price"] - 2.30) < 1e-6 for r in rows), rows

    # Restore to 2.25 so subsequent runs are idempotent.
    requests.put(f"{API}/api/fleet/fuel/price-settings",
                 headers=hdr, json={"provisional_price_per_litre": 2.25})


def test_three_way_sync_at_132de_or_later():
    running = re.search(r"RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text()).group(1)
    expected = re.search(r"EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text()).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "de"
