"""Phase 4.9 — Re-shipped counter fix + Today/Week/Month Trip data.

Covers two backend features in a single suite:
  1) GET /api/assets/{id}/trip-summary?range=today|week|month   (new endpoint)
  2) POST /api/assets/navixy/sync-counters Pass 0.5 (re-ship of v113 counter fix)

H89MY reference asset → id=5407000f-b1d6-44dd-af21-4cf59191d688,
navixy_device_id=10307562. Lifetime ground-truth ≈ 554.7 hrs / 109914.99 km.
"""
from __future__ import annotations
import os, time, subprocess, pytest, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://whs-compliance.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASSWORD = "Mcgstephen50#"
H89MY_ID = "5407000f-b1d6-44dd-af21-4cf59191d688"
H89MY_DEVICE_ID = 10307562
TRIP_SCHEMA_KEYS = {
    "range", "navixy", "as_of",
    "distance_km", "drive_seconds", "idle_seconds",
    "max_speed_kmh", "trip_count", "days_available", "sparkline",
}
NAVIXY_TRIP_SCHEMA_KEYS = TRIP_SCHEMA_KEYS | {"from", "to", "total_days_in_range"}


# ───── Fixtures ──────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def admin_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    token = r.json().get("access_token")
    assert token, "no access_token in login response"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def assets_list(admin_session) -> list[dict]:
    r = admin_session.get(f"{BASE_URL}/api/assets")
    assert r.status_code == 200, f"GET /api/assets failed {r.status_code}"
    body = r.json()
    if isinstance(body, dict):
        body = body.get("items") or body.get("assets") or []
    assert isinstance(body, list) and body, "expected non-empty assets list"
    return body


# ───── Part A — /trip-summary endpoint ───────────────────────────────

class TestTripSummaryToday:
    """H89MY today range — schema + non-zero distance/trips."""

    def test_today_returns_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "today"})
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"

    def test_today_schema_contract(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "today"})
        data = r.json()
        missing = NAVIXY_TRIP_SCHEMA_KEYS - set(data.keys())
        assert not missing, f"missing fields: {missing}; got {list(data.keys())}"
        assert data["range"] == "today"
        assert data["navixy"] is True
        assert isinstance(data["sparkline"], list)
        # sparkline of "today" should be 1 day
        assert data["total_days_in_range"] == 1
        assert len(data["sparkline"]) == 1
        for entry in data["sparkline"]:
            assert "date" in entry and "km" in entry

    def test_today_has_drive_activity(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "today"})
        data = r.json()
        # H89MY actually drove today per brief; tolerate zero only if Navixy data is empty.
        # Allow zero but warn — assert structure regardless.
        assert isinstance(data["distance_km"], (int, float))
        assert isinstance(data["trip_count"], int)
        # The brief explicitly says distance_km != 0 and trip_count >= 1.
        assert data["distance_km"] > 0, f"expected non-zero distance_km, got {data['distance_km']}"
        assert data["trip_count"] >= 1, f"expected trip_count>=1, got {data['trip_count']}"


class TestTripSummaryWeekMonth:
    """Week >= today, month >= week for both distance + trips."""

    def test_week_returns_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "week"})
        assert r.status_code == 200
        d = r.json()
        assert d["range"] == "week"
        assert d["total_days_in_range"] == 7
        assert len(d["sparkline"]) == 7

    def test_month_returns_200(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "month"})
        assert r.status_code == 200
        d = r.json()
        assert d["range"] == "month"
        assert d["total_days_in_range"] == 30
        assert len(d["sparkline"]) == 30

    def test_distance_monotonic(self, admin_session):
        # Use a fresh session to avoid cached today payload (cache key includes range so this isn't strictly needed).
        today = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "today"}).json()
        week  = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "week"}).json()
        month = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "month"}).json()
        assert week["distance_km"]  >= today["distance_km"], (week["distance_km"], today["distance_km"])
        assert month["distance_km"] >= week["distance_km"],  (month["distance_km"], week["distance_km"])
        assert week["trip_count"]   >= today["trip_count"]
        assert month["trip_count"]  >= week["trip_count"]


class TestTripSummaryCache:
    """Second hit within 60s must NOT add a new 'navixy.trip_summary' log line."""

    def test_cache_suppresses_log_within_60s(self, admin_session):
        log_path = "/var/log/supervisor/backend.err.log"
        # Capture current line count.
        before = int(subprocess.check_output(["wc", "-l", log_path]).split()[0])
        # Bust any prior cache by using a unique-ish range pair? Range is fixed enum, so we
        # use 'week' which is unlikely to be the first call in this test process but to be
        # safe, prime the cache then test the second call doesn't log.
        admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "week"})
        time.sleep(0.5)
        mid = int(subprocess.check_output(["wc", "-l", log_path]).split()[0])
        # Second call within 60s — should be served from cache.
        admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "week"})
        time.sleep(0.5)
        after = int(subprocess.check_output(["wc", "-l", log_path]).split()[0])

        # Count navixy.trip_summary lines added in each window for this device+range.
        def grep_lines(start, end):
            try:
                out = subprocess.check_output(
                    ["sed", "-n", f"{start+1},{end}p", log_path], text=True, errors="ignore"
                )
                return [ln for ln in out.splitlines()
                        if "navixy.trip_summary" in ln and f"device_id={H89MY_DEVICE_ID}" in ln and "range=week" in ln]
            except subprocess.CalledProcessError:
                return []

        first_window_lines  = grep_lines(before, mid)
        second_window_lines = grep_lines(mid, after)
        # First call MAY or may not have logged (depends on whether earlier tests primed cache).
        # The critical assertion is that the SECOND call (cache hit) must add zero new log lines.
        assert len(second_window_lines) == 0, (
            f"Second call within 60s should be cache hit but emitted log: {second_window_lines}"
        )


class TestTripSummaryValidation:
    def test_invalid_range_400(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/assets/{H89MY_ID}/trip-summary", params={"range": "invalid"})
        # FastAPI Query(regex=...) returns 422 by default; brief asks for 400 OR validation error.
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}"

    def test_404_for_missing_asset(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/assets/non-existent-id-xyz/trip-summary", params={"range": "today"})
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text[:120]}"


class TestTripSummaryNonNavixy:
    """An asset with navixy_device_id IS NULL → 200, navixy=False, distance_km=0, no upstream call."""

    def test_non_navixy_asset_graceful_noop(self, admin_session, assets_list):
        non_navixy = next((a for a in assets_list if not a.get("navixy_device_id")), None)
        if not non_navixy:
            pytest.skip("no non-Navixy asset available in this org")
        r = admin_session.get(f"{BASE_URL}/api/assets/{non_navixy['id']}/trip-summary",
                              params={"range": "today"})
        assert r.status_code == 200, f"{r.status_code} {r.text[:150]}"
        d = r.json()
        assert d["navixy"] is False
        assert d["distance_km"] == 0
        assert d["trip_count"] == 0
        assert d["sparkline"] == []


# ───── Part B — Re-shipped counter fix (Pass 0.5) ────────────────────

@pytest.fixture(scope="module")
def sync_result(admin_session) -> dict:
    """Force a counter sync cycle and return the response payload."""
    r = admin_session.post(f"{BASE_URL}/api/assets/navixy/sync-counters", timeout=120)
    assert r.status_code == 200, f"sync-counters {r.status_code} {r.text[:200]}"
    return r.json()


class TestCounterSync:
    def test_sync_runs_and_updates_many(self, sync_result):
        # The brief says "for at least 50 devices" — match against `updated`/`total` keys.
        updated = sync_result.get("updated", sync_result.get("count", 0))
        assert isinstance(updated, int)
        assert updated >= 50, f"expected >=50 devices updated, got {updated}; payload={sync_result}"

    def test_structured_log_line_emitted(self, sync_result):
        # Re-check log for the structured per-device line pattern.
        log_path = "/var/log/supervisor/backend.err.log"
        out = subprocess.check_output(
            ["grep", "-cE", r"navixy\.sync device_id=[0-9]+ hours=.+ km=.+ source=counters_v2", log_path],
            text=True,
        ).strip()
        # The grep -c returns the count of matches in the WHOLE log (sufficient for this run).
        assert int(out) >= 50, f"expected ≥50 structured 'navixy.sync … source=counters_v2' log lines, found {out}"

    def test_h89my_counters_persisted(self, admin_session, sync_result):
        # /api/assets returns persisted hours/km — H89MY must be plausible (close to ground truth).
        r = admin_session.get(f"{BASE_URL}/api/assets")
        assert r.status_code == 200
        body = r.json()
        items = body if isinstance(body, list) else (body.get("items") or body.get("assets") or [])
        h89 = next((a for a in items if a.get("id") == H89MY_ID), None)
        assert h89, "H89MY not present in /api/assets"
        hrs = h89.get("engine_hours") or h89.get("hours_meter") or 0
        km  = h89.get("odometer_km") or h89.get("odo_km") or 0
        assert hrs > 500, f"engine_hours expected ~554.7, got {hrs}"
        assert km  > 100000, f"odometer_km expected ~109914.99, got {km}"


class TestFleetCounters:
    """≥3 Navixy-synced assets with hours>100 AND km>500."""

    def test_fleet_has_plausible_counters(self, assets_list):
        plausible = [
            a for a in assets_list
            if a.get("navixy_device_id")
            and (a.get("engine_hours") or a.get("hours_meter") or 0) > 100
            and (a.get("odometer_km") or a.get("odo_km") or 0) > 500
        ]
        assert len(plausible) >= 3, (
            f"expected ≥3 Navixy assets with hrs>100 & km>500, got {len(plausible)}. "
            f"Sample: {[(a.get('rego_serial') or a.get('name'), a.get('engine_hours') or a.get('hours_meter'), a.get('odometer_km') or a.get('odo_km')) for a in plausible[:5]]}"
        )
