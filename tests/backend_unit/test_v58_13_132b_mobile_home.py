"""v58.13.132b — Mobile Home Dashboard endpoint tests.

Tests: shape, weather, module filtering, company toggle, notification stub.
"""
import pytest
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("JWT_SECRET", "test-secret-132b")


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _get_token():
    """Helper to get an admin JWT for testing."""
    import requests
    BASE = os.environ.get("BACKEND_URL", "https://whs-compliance.preview.emergentagent.com")
    r = requests.post(f"{BASE}/api/auth/login", json={
        "email": "stephen@paneltec.com.au",
        "password": "Mcgstephen50#"
    })
    if r.status_code == 429:
        pytest.skip("Rate limited on login")
    return r.json().get("access_token", "")


def test_home_endpoint_shape():
    """GET /api/mobile/home returns correctly shaped payload."""
    import requests
    BASE = os.environ.get("BACKEND_URL", "https://whs-compliance.preview.emergentagent.com")
    token = _get_token()
    r = requests.get(f"{BASE}/api/mobile/home", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    data = r.json()

    # Top-level keys
    assert "user" in data
    assert "companies" in data
    assert "active_company_id" in data
    assert "can_switch_company" in data
    assert "today" in data
    assert "site" in data
    assert "weather" in data
    assert "modules" in data

    # User shape
    user = data["user"]
    assert "name" in user
    assert "avatar_initials" in user
    assert "company_id" in user
    assert "company_name" in user

    # Today shape
    today = data["today"]
    assert "date_iso" in today
    assert "day_name" in today
    assert "greeting" in today
    assert today["greeting"] in ["Good morning", "Good afternoon", "Good evening"]

    # Weather shape
    w = data["weather"]
    assert "temperature_c" in w
    assert "condition" in w
    assert "wind_kmh" in w
    assert "wind_dir" in w
    assert "location_source" in w

    # Modules shape
    modules = data["modules"]
    assert isinstance(modules, list)
    assert len(modules) >= 1
    for m in modules:
        assert "key" in m
        assert "label" in m
        assert "icon" in m
        assert "route" in m

    print(f"Home shape OK: {len(modules)} modules, weather={w['temperature_c']}°C {w['condition']}")


def test_home_requires_auth():
    """GET /api/mobile/home without token returns 401/403."""
    import requests
    BASE = os.environ.get("BACKEND_URL", "https://whs-compliance.preview.emergentagent.com")
    r = requests.get(f"{BASE}/api/mobile/home")
    assert r.status_code in (401, 403, 422)


def test_notification_count_stub():
    """GET /api/mobile/notifications/count returns {count: 0}."""
    import requests
    BASE = os.environ.get("BACKEND_URL", "https://whs-compliance.preview.emergentagent.com")
    token = _get_token()
    r = requests.get(f"{BASE}/api/mobile/notifications/count",
                     headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_active_company_set():
    """POST /api/mobile/user/active-company updates the active company."""
    import requests
    BASE = os.environ.get("BACKEND_URL", "https://whs-compliance.preview.emergentagent.com")
    token = _get_token()

    # Try setting company_id to "2" (Paneltec)
    r = requests.post(f"{BASE}/api/mobile/user/active-company",
                      json={"company_id": "2"},
                      headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_weather_cache():
    """Weather data should be cached — two rapid requests should return same data."""
    import requests
    BASE = os.environ.get("BACKEND_URL", "https://whs-compliance.preview.emergentagent.com")
    token = _get_token()
    headers = {"Authorization": f"Bearer {token}"}

    r1 = requests.get(f"{BASE}/api/mobile/home", headers=headers)
    r2 = requests.get(f"{BASE}/api/mobile/home", headers=headers)

    assert r1.status_code == 200
    assert r2.status_code == 200
    # Same weather since it's cached for 10 min
    assert r1.json()["weather"]["temperature_c"] == r2.json()["weather"]["temperature_c"]


def test_module_filtering_admin():
    """Admin users should see all modules including toolbox_talk and my_fleet."""
    import requests
    BASE = os.environ.get("BACKEND_URL", "https://whs-compliance.preview.emergentagent.com")
    token = _get_token()
    r = requests.get(f"{BASE}/api/mobile/home", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    module_keys = [m["key"] for m in r.json()["modules"]]
    assert "sites" in module_keys
    assert "hazards" in module_keys
    assert "prestart" in module_keys
    assert "toolbox_talk" in module_keys
    assert "my_fleet" in module_keys
    assert "profile" in module_keys
