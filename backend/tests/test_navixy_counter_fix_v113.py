"""Phase v113 — Navixy counter fix regression tests.

Verifies that /v2/tracker/get_counters Pass 0.5 refreshes hours_meter +
odo_km for every Navixy-synced asset on every sync cycle.

Reference asset (per user-provided Navixy screenshot, 2026-06-30):
    asset_id          = 5407000f-b1d6-44dd-af21-4cf59191d688
    navixy_device_id  = 10307562
    engine_hours      ≈ 554.7
    odometer_km       ≈ 109914.99
"""
from __future__ import annotations
import os
import re
import time
from datetime import datetime, timezone
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://whs-compliance.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASSWORD = "Mcgstephen50#"

H89MY_ASSET_ID = "5407000f-b1d6-44dd-af21-4cf59191d688"
H89MY_DEVICE_ID = 10307562
H89MY_EXPECTED_HOURS = 554.7
H89MY_EXPECTED_KM = 109914.99
HOURS_TOLERANCE = 5.0
KM_TOLERANCE = 100.0

BACKEND_LOG = "/var/log/supervisor/backend.err.log"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    tok = r.json().get("access_token")
    assert tok, "no access_token in login response"
    return tok


@pytest.fixture(scope="module")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    })
    return s


@pytest.fixture(scope="module")
def sync_result(admin_client):
    """Trigger the on-demand Navixy sync once for the whole test module."""
    r = admin_client.post(f"{BASE_URL}/api/assets/navixy/sync-counters", timeout=180)
    assert r.status_code == 200, f"sync trigger failed: {r.status_code} {r.text[:500]}"
    data = r.json()
    print(f"[sync_result] {data}")
    return data


# ────────────────────── 1. Force sync returns updated >= 50 ──────────────


class TestNavixySyncTrigger:
    def test_sync_returns_high_updated_count(self, sync_result):
        updated = sync_result.get("updated", 0)
        assert updated >= 50, (
            f"Expected updated >= 50 after Pass 0.5 fix, got updated={updated}. "
            f"Full response: {sync_result}"
        )

    def test_sync_response_shape(self, sync_result):
        # Should at minimum carry updated + skipped (or errors) counters
        assert isinstance(sync_result, dict)
        assert "updated" in sync_result


# ────────────────────── 2. H89MY meter-trends totals match Navixy UI ──────


class TestH89MYMeterTrends:
    def test_h89my_engine_hours_matches_navixy(self, admin_client, sync_result):
        r = admin_client.get(
            f"{BASE_URL}/api/assets/{H89MY_ASSET_ID}/meter-trends", timeout=20
        )
        assert r.status_code == 200, f"meter-trends GET failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        total = body.get("total") or {}
        hours = total.get("engine_hours")
        print(f"[H89MY] total={total}")
        assert hours is not None, "engine_hours missing on total"
        assert isinstance(hours, (int, float))
        delta = abs(float(hours) - H89MY_EXPECTED_HOURS)
        assert delta <= HOURS_TOLERANCE, (
            f"engine_hours={hours} differs from Navixy UI {H89MY_EXPECTED_HOURS} "
            f"by {delta:.2f} hrs (tolerance ±{HOURS_TOLERANCE})"
        )

    def test_h89my_odometer_matches_navixy(self, admin_client, sync_result):
        r = admin_client.get(
            f"{BASE_URL}/api/assets/{H89MY_ASSET_ID}/meter-trends", timeout=20
        )
        assert r.status_code == 200
        body = r.json()
        total = body.get("total") or {}
        km = total.get("odometer_km")
        assert km is not None, "odometer_km missing on total"
        delta = abs(float(km) - H89MY_EXPECTED_KM)
        assert delta <= KM_TOLERANCE, (
            f"odometer_km={km} differs from Navixy UI {H89MY_EXPECTED_KM} "
            f"by {delta:.2f} km (tolerance ±{KM_TOLERANCE})"
        )

    def test_h89my_hours_meter_updated_at_is_today(self, admin_client, sync_result):
        # Use /api/assets list to fetch the H89MY record with timestamp.
        r = admin_client.get(f"{BASE_URL}/api/assets?kind=all", timeout=30)
        assert r.status_code == 200
        items = r.json()
        if isinstance(items, dict):
            items = items.get("items") or items.get("assets") or []
        h89 = next((a for a in items if a.get("id") == H89MY_ASSET_ID), None)
        assert h89 is not None, "H89MY asset not present in /api/assets?kind=all"
        ts = h89.get("hours_meter_updated_at") or h89.get("odo_km_updated_at")
        assert ts, f"no hours_meter_updated_at on H89MY asset; raw: {h89}"
        today = datetime.now(timezone.utc).date().isoformat()
        ts_str = str(ts)
        # Accept either ISO date prefix YYYY-MM-DD or full ISO timestamp
        assert ts_str.startswith(today), (
            f"hours_meter_updated_at={ts_str} is not from today ({today}). "
            "The Pass 0.5 sync should have refreshed this on the just-triggered cycle."
        )


# ────────────────────── 3. Fleet-wide plausibility check ──────────────────


class TestFleetCounters:
    def test_fleet_has_many_plausible_navixy_assets(self, admin_client, sync_result):
        r = admin_client.get(f"{BASE_URL}/api/assets?kind=all", timeout=30)
        assert r.status_code == 200
        items = r.json()
        if isinstance(items, dict):
            items = items.get("items") or items.get("assets") or []
        navixy_assets = [a for a in items if a.get("navixy_device_id")]
        plausible = [
            a for a in navixy_assets
            if (a.get("hours_meter") or 0) > 100 and (a.get("odo_km") or 0) > 500
        ]
        print(
            f"[fleet] navixy_assets={len(navixy_assets)} plausible(hrs>100 & km>500)={len(plausible)}"
        )
        assert len(plausible) >= 5, (
            f"Only {len(plausible)} Navixy assets have plausible non-zero counters "
            f"(hrs>100 AND km>500); expected >= 5. Total navixy assets: {len(navixy_assets)}. "
            "Pre-fix bug showed stuck 30-50 hr values across the fleet."
        )

    def test_fleet_no_stuck_low_hours_majority(self, admin_client, sync_result):
        r = admin_client.get(f"{BASE_URL}/api/assets?kind=all", timeout=30)
        assert r.status_code == 200
        items = r.json()
        if isinstance(items, dict):
            items = items.get("items") or items.get("assets") or []
        navixy_assets = [a for a in items if a.get("navixy_device_id")]
        if not navixy_assets:
            pytest.skip("no navixy assets")
        stuck = [a for a in navixy_assets if 0 < (a.get("hours_meter") or 0) < 60]
        # Allow a small minority of genuinely low-usage trackers.
        ratio = len(stuck) / max(len(navixy_assets), 1)
        assert ratio < 0.5, (
            f"{len(stuck)}/{len(navixy_assets)} ({ratio:.0%}) Navixy assets have "
            f"hours_meter < 60. Pre-fix bug pattern. Sample stuck: "
            f"{[(a.get('id'), a.get('hours_meter')) for a in stuck[:5]]}"
        )


# ────────────────────── 4. Structured log line emitted ────────────────────


class TestStructuredSyncLog:
    LOG_PATTERN = re.compile(
        r"navixy\.sync device_id=(\d+) hours=([\w\.\-]+) km=([\w\.\-]+) source=get_counters"
    )

    def test_get_counters_log_line_emitted(self, sync_result):
        # Give the log a moment to flush after the sync POST returns.
        time.sleep(2)
        # Tail the last ~2000 lines for matches.
        try:
            with open(BACKEND_LOG, "r", errors="ignore") as f:
                lines = f.readlines()[-4000:]
        except FileNotFoundError:
            pytest.skip(f"backend log not found at {BACKEND_LOG}")
        matches = [ln for ln in lines if self.LOG_PATTERN.search(ln)]
        print(f"[log] matched {len(matches)} navixy.sync get_counters lines")
        if matches:
            print(f"[log] sample: {matches[-1].strip()}")
        assert matches, (
            "No 'navixy.sync device_id=… hours=… km=… source=get_counters' lines "
            f"found in {BACKEND_LOG}. Pass 0.5 may not be running."
        )

    def test_h89my_specifically_logged(self, sync_result):
        time.sleep(1)
        try:
            with open(BACKEND_LOG, "r", errors="ignore") as f:
                lines = f.readlines()[-6000:]
        except FileNotFoundError:
            pytest.skip("backend log missing")
        h89_lines = [
            ln for ln in lines
            if f"device_id={H89MY_DEVICE_ID}" in ln and "source=get_counters" in ln
        ]
        print(f"[log] H89MY (tid={H89MY_DEVICE_ID}) lines: {len(h89_lines)}")
        if h89_lines:
            print(f"[log] last H89MY line: {h89_lines[-1].strip()}")
        # Soft assertion: at least one H89MY get_counters log line should appear
        # after the just-triggered sync. If it doesn't, the device may have been
        # skipped — that's a regression worth flagging.
        assert h89_lines, (
            f"No get_counters log line found for H89MY device_id={H89MY_DEVICE_ID}. "
            "Pass 0.5 should iterate every synced asset."
        )


# ────────────────────── 5. Regression: meter_history file is read-only on assets


class TestMeterHistoryReadOnlyOnAssets:
    def test_no_writes_to_assets_collection_in_meter_history(self):
        path = "/app/backend/asset_meter_history.py"
        with open(path, "r") as f:
            src = f.read()
        # Forbidden writes
        forbidden = re.findall(
            r"db\.assets\.(?:update_one|update_many|insert_one|insert_many|delete_one|delete_many|replace_one|find_one_and_update|bulk_write)",
            src,
        )
        assert not forbidden, (
            f"asset_meter_history.py must NEVER write to db.assets. Found: {forbidden}"
        )
        # Allowed reads only
        all_assets_calls = re.findall(r"db\.assets\.\w+", src)
        bad = [c for c in all_assets_calls if c not in {"db.assets.find", "db.assets.find_one"}]
        assert not bad, f"Unexpected db.assets.* calls in meter_history: {bad}"

    def test_only_meter_history_collection_is_written(self):
        path = "/app/backend/asset_meter_history.py"
        with open(path, "r") as f:
            src = f.read()
        # Every db.<coll>.update/insert call must target asset_meter_history.
        write_calls = re.findall(
            r"db\.(\w+)\.(?:update_one|update_many|insert_one|insert_many|replace_one|find_one_and_update|bulk_write)",
            src,
        )
        assert write_calls, "expected at least one write call in meter_history module"
        bad = [c for c in write_calls if c != "asset_meter_history"]
        assert not bad, f"Writes target collections other than asset_meter_history: {bad}"
