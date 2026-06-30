"""Phase 4.9.1 v114 — three bug fixes regression tests."""
import os, requests, pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://whs-compliance.preview.emergentagent.com").rstrip("/")
ADMIN = {"email": "stephen@paneltec.com.au", "password": "Mcgstephen50#"}

@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]

@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}"}

# Bug 1 — repair-lifetimes admin endpoint
def test_repair_lifetimes_admin(H):
    r = requests.post(f"{BASE}/api/assets/navixy/repair-lifetimes", headers=H, timeout=120)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("checked", "fixed_report", "fixed_tracks", "unreliable", "cleared"):
        assert k in d, f"missing key {k} in {d}"

def test_repair_lifetimes_non_admin():
    rl = requests.post(f"{BASE}/api/auth/login", json={"email": "worker@paneltec.com", "password": "demo123"}, timeout=15)
    if rl.status_code != 200:
        pytest.skip(f"worker login failed: {rl.status_code}")
    tok = rl.json()["access_token"]
    r = requests.post(f"{BASE}/api/assets/navixy/repair-lifetimes",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=30)
    assert r.status_code == 403

# Bug 1 — sync-counters includes repair sub-object
def test_sync_counters_includes_repair(H):
    r = requests.post(f"{BASE}/api/assets/navixy/sync-counters", headers=H, timeout=180)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "repair" in d, f"missing repair key in {d.keys()}"
    rep = d["repair"]
    for k in ("checked", "fixed_report", "fixed_tracks", "unreliable"):
        assert k in rep
    # also the existing fields
    for k in ("updated", "skipped", "contacted", "source_breakdown"):
        assert k in d

# Helper: pick an asset with hours_meter set
def _pick_asset(H):
    r = requests.get(f"{BASE}/api/assets?limit=200", headers=H, timeout=30)
    assert r.status_code == 200
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    for a in items:
        if a.get("hours_meter") and a.get("navixy_device_id"):
            return a
    pytest.skip("no asset with hours_meter found")

# Bug 2 — engine_hours monotonicity 409
def test_engine_hours_monotonic_409(H):
    a = _pick_asset(H)
    aid = a["id"]
    r = requests.post(f"{BASE}/api/assets/{aid}/meter-history", headers=H,
                      json={"date": "2020-01-15", "engine_hours": 99999}, timeout=30)
    assert r.status_code == 409, f"expected 409 got {r.status_code} body={r.text}"
    detail = r.json().get("detail", "")
    assert "engine_hours" in detail
    assert "Counters only go up" in detail

# Bug 2 — engine_hours reasonable returns 200
def test_engine_hours_reasonable_ok(H):
    a = _pick_asset(H)
    aid = a["id"]
    r = requests.post(f"{BASE}/api/assets/{aid}/meter-history", headers=H,
                      json={"date": "2020-01-15", "engine_hours": 0.5}, timeout=30)
    assert r.status_code == 200, f"expected 200 got {r.status_code} body={r.text}"
    assert r.json().get("ok") is True

# Bug 2 regression — odometer monotonicity still works
def test_odometer_monotonic_409(H):
    a = _pick_asset(H)
    aid = a["id"]
    r = requests.post(f"{BASE}/api/assets/{aid}/meter-history", headers=H,
                      json={"date": "2020-01-15", "odometer_km": 99999999}, timeout=30)
    assert r.status_code == 409, f"expected 409 got {r.status_code} body={r.text}"
    assert "odometer_km" in r.json().get("detail", "")

# Regression — trip-summary
@pytest.mark.parametrize("rng", ["today", "week", "month"])
def test_trip_summary(H, rng):
    a = _pick_asset(H)
    r = requests.get(f"{BASE}/api/assets/{a['id']}/trip-summary?range={rng}", headers=H, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("distance_km", "drive_seconds", "idle_seconds", "max_speed_kmh",
              "trip_count", "days_available", "sparkline"):
        assert k in d, f"missing {k} in {d}"

# Regression — meter-trends
def test_meter_trends(H):
    a = _pick_asset(H)
    r = requests.get(f"{BASE}/api/assets/{a['id']}/meter-trends", headers=H, timeout=30)
    assert r.status_code == 200
    d = r.json()
    for k in ("total", "week", "month"):
        assert k in d

# Regression — login
def test_login_works():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200
    assert "access_token" in r.json()

# Regression — service worker CACHE_VERSION
def test_service_worker_version():
    r = requests.get(f"{BASE}/service-worker.js", timeout=15)
    assert r.status_code == 200
    assert "paneltec-v114" in r.text
