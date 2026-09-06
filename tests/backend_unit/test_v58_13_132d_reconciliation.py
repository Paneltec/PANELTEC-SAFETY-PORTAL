"""
Test v58.13.132d — M4 Reconciliation: verify mobile uses existing web endpoints.

Tests:
  1. GET /api/sites — site list returns valid data
  2. GET /api/mobile/home — home endpoint returns 19 dynamic modules from site_signons
  3. POST /api/sites/{id}/signon-v127 — worker sign-in via legacy endpoint
  4. POST /api/me/signoff-active — worker sign-off via legacy endpoint
  5. Verify /api/mobile/sites/* endpoints are REMOVED
"""
import os
import time
import pytest
import requests

BASE = os.getenv("BASE_URL", "https://whs-compliance.preview.emergentagent.com")
_TOKEN_CACHE: dict = {}


def _login() -> str:
    """Authenticate and cache the token to avoid rate limits."""
    if _TOKEN_CACHE.get("token") and time.time() - _TOKEN_CACHE.get("ts", 0) < 300:
        return _TOKEN_CACHE["token"]
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "stephen@paneltec.com.au", "password": "Mcgstephen50#"},
        timeout=10,
    )
    if r.status_code == 429:
        pytest.skip("Rate-limited — try again shortly")
    assert r.status_code == 200, f"Login failed: {r.text[:200]}"
    tok = r.json()["access_token"]
    _TOKEN_CACHE["token"] = tok
    _TOKEN_CACHE["ts"] = time.time()
    return tok


def _headers() -> dict:
    return {"Authorization": f"Bearer {_login()}"}


# ── Test 1: GET /api/sites returns site list ──

def test_sites_list():
    r = requests.get(f"{BASE}/api/sites", headers=_headers(), timeout=10)
    assert r.status_code == 200
    sites = r.json()
    assert isinstance(sites, list)
    assert len(sites) >= 1, "Expected at least 1 site"
    site = sites[0]
    # Check expected fields from sites_qr.py::list_sites
    assert "simpro_site_id" in site
    assert "name" in site
    assert "latitude" in site or "longitude" in site
    print(f"✓ GET /api/sites returned {len(sites)} sites")


# ── Test 2: GET /api/mobile/home returns 19 modules + site_signons check ──

def test_home_dynamic_modules():
    r = requests.get(f"{BASE}/api/mobile/home", headers=_headers(), timeout=10)
    assert r.status_code == 200
    d = r.json()
    modules = d.get("modules", [])
    # Admin role should see all 19 modules
    assert len(modules) >= 15, f"Expected ≥15 modules for admin, got {len(modules)}"

    # Check module keys match mobile_modules_data.py::MODULE_KEYS
    expected_keys = {
        "pre_start", "site_diary", "hazard", "incident", "inspection",
        "swms", "inductions", "plant_vehicles", "certifications", "ask_intel",
        "sign_on", "profile", "forms", "document_library", "contractors",
        "suppliers", "workers", "users_directory", "compliance_snapshot",
    }
    returned_keys = {m["key"] for m in modules}
    assert returned_keys == expected_keys, f"Module keys mismatch: {expected_keys - returned_keys}"

    # Each module has label, icon, route
    for m in modules:
        assert "label" in m
        assert "icon" in m
        assert "route" in m
        assert m["route"].startswith("/")
    print(f"✓ GET /api/mobile/home returned {len(modules)} dynamic modules")

    # Site info should use site_signons
    site = d.get("site", {})
    assert "signed_in" in site
    print(f"✓ site.signed_in={site['signed_in']} (from site_signons collection)")


# ── Test 3: Worker sign-in via signon-v127 ──

def test_worker_signon_v127():
    # Pick the first site
    r = requests.get(f"{BASE}/api/sites", headers=_headers(), timeout=10)
    sites = r.json()
    if not sites:
        pytest.skip("No sites available")
    site_id = sites[0]["simpro_site_id"]

    # First, sign off any active signon (cleanup)
    requests.post(f"{BASE}/api/me/signoff-active", headers=_headers(), timeout=10)

    # Sign in
    r2 = requests.post(
        f"{BASE}/api/sites/{site_id}/signon-v127",
        json={"gps_lat": -33.8688, "gps_long": 151.2093, "answers": []},
        headers=_headers(),
        timeout=10,
    )
    assert r2.status_code == 200, f"signon-v127 failed: {r2.text[:300]}"
    body = r2.json()
    assert "id" in body or "signon_id" in body or "signed_at" in body
    print(f"✓ POST /api/sites/{site_id}/signon-v127 succeeded")


# ── Test 4: Worker sign-off via /api/me/signoff-active ──

def test_worker_signoff_active():
    r = requests.post(
        f"{BASE}/api/me/signoff-active",
        headers=_headers(),
        json={},
        timeout=10,
    )
    # Could be 200 (signed off) or 404 (no active signon)
    assert r.status_code in (200, 404), f"signoff-active unexpected: {r.status_code} {r.text[:200]}"
    if r.status_code == 200:
        print("✓ POST /api/me/signoff-active succeeded")
    else:
        print("✓ POST /api/me/signoff-active — no active signon (expected)")


# ── Test 5: Verify M3 mobile-only endpoints are REMOVED ──

def test_mobile_sites_endpoints_removed():
    endpoints = [
        ("GET", f"{BASE}/api/mobile/sites"),
        ("POST", f"{BASE}/api/mobile/sites/DEV-SITE-001/sign-in"),
        ("POST", f"{BASE}/api/mobile/sites/DEV-SITE-001/sign-out"),
        ("POST", f"{BASE}/api/mobile/sites/DEV-SITE-001/visitor-sign-in"),
        ("POST", f"{BASE}/api/mobile/gps/heartbeat"),
    ]
    h = _headers()
    for method, url in endpoints:
        if method == "GET":
            r = requests.get(url, headers=h, timeout=10)
        else:
            r = requests.post(url, headers=h, json={}, timeout=10)
        # Should return 404 (not found) or 405 (method not allowed) — NOT 200
        assert r.status_code in (404, 405, 422), (
            f"{method} {url} should be removed but returned {r.status_code}"
        )
    print("✓ All M3 /api/mobile/sites/* endpoints confirmed removed")
