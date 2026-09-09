"""v58.13.132bt — Fuel Anomalies entry-point banner on Fuel Reports.

Frontend source pins + endpoint reuse:
  · FuelReporting page fetches `/fleet/fuel/anomalies?count_only=true`
    on mount and on window focus (30s effective refresh cadence when
    the tab is re-focused).
  · Banner is a `<Link to="/app/fleet/fuel/anomalies">` with
    `bg-amber-50 border border-amber-200 rounded-lg` and an
    `AlertTriangle` icon + count copy + `Review anomalies →` CTA.
  · Banner is HIDDEN when the count is a concrete 0 (nothing to
    review); RENDERED when count > 0 or null (endpoint unreachable —
    still let admins navigate).
  · Existing count_only endpoint (introduced in .131c) is reused —
    no new backend surface added.
  · Version pin forward-safe >= .132bt.
"""
from __future__ import annotations
import os
import re
import time
import pytest
from pathlib import Path
from dotenv import load_dotenv
import httpx


def _read_frontend_env(key):
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError(f"{key} missing")


@pytest.fixture(scope="module")
def env():
    load_dotenv("/app/backend/.env")
    return {"api_url": _read_frontend_env("REACT_APP_BACKEND_URL")}


@pytest.fixture(scope="module")
def token(env):
    last = None
    for attempt in range(6):
        try:
            r = httpx.post(
                f"{env['api_url']}/api/auth/login",
                json={"email": "stephen@paneltec.com.au",
                      "password": "Mcgstephen50#"}, timeout=10,
            )
            if r.status_code == 429:
                time.sleep(2 * (attempt + 1))
                last = r.text
                continue
            r.raise_for_status()
            return r.json()["access_token"]
        except httpx.HTTPStatusError as e:
            last = str(e)
            if e.response.status_code == 429:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"login failed: {last}")


# ── Endpoint reuse: count_only path still honours .131c contract ──
def test_count_only_endpoint_returns_scalar(env, token):
    r = httpx.get(
        f"{env['api_url']}/api/fleet/fuel/anomalies",
        params={"resolved": False, "count_only": True}, timeout=15,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) == {"count"}, f"count_only leaked extra keys: {body.keys()}"
    assert isinstance(body["count"], int)
    assert body["count"] >= 0


# ── Frontend source pins ────────────────────────────────────────
FE_ROOT = Path("/app/frontend/src")
FUEL_REPORTING = (FE_ROOT / "pages" / "FuelReporting.jsx").read_text()
VERSION_JS = (FE_ROOT / "lib" / "version.js").read_text()
SW_JS = Path("/app/frontend/public/service-worker.js").read_text()


def test_banner_testid_and_style():
    assert 'data-testid="fuel-reporting-anomalies-banner"' in FUEL_REPORTING
    assert 'data-testid="fuel-reporting-anomalies-cta"' in FUEL_REPORTING
    # Banner styling per spec.
    assert "bg-amber-50 border border-amber-200 rounded-lg" in FUEL_REPORTING
    # CTA styling: amber-600 filled.
    assert "bg-amber-600" in FUEL_REPORTING


def test_banner_links_to_anomaly_inbox():
    # Link's `to` prop points at the Fuel Anomalies route.
    assert 'to="/app/fleet/fuel/anomalies"' in FUEL_REPORTING


def test_banner_uses_count_only_endpoint():
    assert "count_only: true" in FUEL_REPORTING
    assert "loadAnomalyCount" in FUEL_REPORTING
    # Focus-based refresh.
    assert "window.addEventListener('focus'" in FUEL_REPORTING


def test_banner_hidden_when_count_zero():
    # Render guard: banner mounts only when anomalyCount !== 0.
    assert "anomalyCount !== 0" in FUEL_REPORTING


def test_banner_placed_above_smartfill_autosync_card():
    banner = FUEL_REPORTING.find('data-testid="fuel-reporting-anomalies-banner"')
    autosync = FUEL_REPORTING.find("SmartFill auto-sync status card")
    assert banner > 0 and autosync > 0
    assert banner < autosync, "banner must render above the SmartFill auto-sync card"


def test_version_and_cache_bumped_to_132bt():
    def ge(v):
        m = re.search(r"\.132([a-z]+)$", v)
        return bool(m) and m.group(1) >= "bt"
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and ge(m.group(1)), m and m.group(1)
    m2 = re.search(r"EXPECTED_CACHE_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m2 and ge(m2.group(1)), m2 and m2.group(1)
    m3 = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m3 and ge(m3.group(1)), m3 and m3.group(1)
