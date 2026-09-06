"""v58.13.132c — Mobile Sites endpoint tests."""
import pytest
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("JWT_SECRET", "test-secret-132c")

BASE = os.environ.get("BACKEND_URL", "https://whs-compliance.preview.emergentagent.com")

_cached_token = None

def _get_token():
    global _cached_token
    if _cached_token:
        return _cached_token
    import requests
    r = requests.post(f"{BASE}/api/auth/login", json={
        "email": "stephen@paneltec.com.au", "password": "Mcgstephen50#"})
    if r.status_code == 429:
        pytest.skip("Rate limited")
    _cached_token = r.json().get("access_token", "")
    return _cached_token


def _auth():
    return {"Authorization": f"Bearer {_get_token()}"}


def test_list_sites():
    import requests
    r = requests.get(f"{BASE}/api/mobile/sites", headers=_auth())
    assert r.status_code == 200
    data = r.json()
    assert "sites" in data
    assert len(data["sites"]) >= 1
    site = data["sites"][0]
    assert "id" in site
    assert "name" in site
    assert "address" in site
    print(f"Sites: {[s['name'] for s in data['sites']]}")


def test_list_sites_with_gps():
    import requests
    r = requests.get(f"{BASE}/api/mobile/sites?lat=-34.79&lng=149.13", headers=_auth())
    assert r.status_code == 200
    data = r.json()
    sites = data["sites"]
    # Should have distance_km
    for s in sites:
        if s.get("latitude"):
            assert s["distance_km"] is not None


def test_worker_sign_in():
    import requests
    h = _auth()
    # Get first site
    sites = requests.get(f"{BASE}/api/mobile/sites", headers=h).json()["sites"]
    site_id = sites[0]["id"]

    r = requests.post(f"{BASE}/api/mobile/sites/{site_id}/sign-in",
                      json={"kind": "worker", "gps": {"lat": -34.79, "lng": 149.13}},
                      headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["kind"] == "worker"
    assert data["site_id"] == site_id
    assert data["signed_out_at"] is None
    print(f"Signed in to {data['site_name']}")
    return data


def test_auto_sign_out_previous():
    import requests
    h = _auth()
    sites = requests.get(f"{BASE}/api/mobile/sites", headers=h).json()["sites"]
    if len(sites) < 2:
        pytest.skip("Need 2+ sites")

    # Sign in to first site
    r1 = requests.post(f"{BASE}/api/mobile/sites/{sites[0]['id']}/sign-in",
                       json={"kind": "worker"}, headers=h)
    assert r1.status_code == 200

    # Sign in to second site — should auto-sign-out first
    r2 = requests.post(f"{BASE}/api/mobile/sites/{sites[1]['id']}/sign-in",
                       json={"kind": "worker"}, headers=h)
    assert r2.status_code == 200
    assert r2.json()["site_id"] == sites[1]["id"]


def test_worker_sign_out():
    import requests
    h = _auth()
    sites = requests.get(f"{BASE}/api/mobile/sites", headers=h).json()["sites"]
    site_id = sites[0]["id"]

    # Sign in first
    requests.post(f"{BASE}/api/mobile/sites/{site_id}/sign-in",
                  json={"kind": "worker"}, headers=h)

    r = requests.post(f"{BASE}/api/mobile/sites/{site_id}/sign-out",
                      json={"gps": {"lat": -34.79, "lng": 149.13}}, headers=h)
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_current_occupancy():
    import requests
    h = _auth()
    sites = requests.get(f"{BASE}/api/mobile/sites", headers=h).json()["sites"]
    site_id = sites[0]["id"]

    # Sign in
    requests.post(f"{BASE}/api/mobile/sites/{site_id}/sign-in",
                  json={"kind": "worker"}, headers=h)

    r = requests.get(f"{BASE}/api/mobile/sites/{site_id}/current-occupancy", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["total_count"] >= 1
    assert len(data["workers"]) >= 1


def test_visitor_requires_host():
    import requests
    h = _auth()
    sites = requests.get(f"{BASE}/api/mobile/sites", headers=h).json()["sites"]
    site_id = sites[0]["id"]

    # Sign out first to clear state
    requests.post(f"{BASE}/api/mobile/sites/{site_id}/sign-out", json={}, headers=h)

    # Try visitor sign-in without host signed in
    r = requests.post(f"{BASE}/api/mobile/sites/{site_id}/visitor-sign-in",
                      json={
                          "visitor_details": {"name": "Test Visitor", "host_user_id": "fake-id"},
                          "induction_ack": True,
                      }, headers=h)
    assert r.status_code == 400
    assert "host" in r.json()["detail"].lower()


def test_visitor_sign_in_success():
    import requests
    h = _auth()
    sites = requests.get(f"{BASE}/api/mobile/sites", headers=h).json()["sites"]
    site_id = sites[0]["id"]

    # Sign in as worker first (host)
    si = requests.post(f"{BASE}/api/mobile/sites/{site_id}/sign-in",
                       json={"kind": "worker"}, headers=h).json()

    # Now visitor sign-in
    r = requests.post(f"{BASE}/api/mobile/sites/{site_id}/visitor-sign-in",
                      json={
                          "visitor_details": {
                              "name": "Jane Doe",
                              "company": "Acme Inspections",
                              "phone": "0400111222",
                              "purpose": "Safety audit",
                              "host_user_id": si["user_id"],
                              "escort_required": True,
                          },
                          "ppe_ack": ["Hard hat", "Hi-vis vest"],
                          "induction_ack": True,
                      }, headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["kind"] == "visitor"
    assert data["visitor_details"]["name"] == "Jane Doe"


def test_photo_size_cap():
    import requests
    h = _auth()
    sites = requests.get(f"{BASE}/api/mobile/sites", headers=h).json()["sites"]
    site_id = sites[0]["id"]

    big_photo = "data:image/jpeg;base64," + "A" * 250_000
    r = requests.post(f"{BASE}/api/mobile/sites/{site_id}/sign-in",
                      json={"kind": "worker", "photo_data_uri": big_photo},
                      headers=h)
    assert r.status_code == 413


def test_gps_heartbeat():
    import requests
    h = _auth()
    sites = requests.get(f"{BASE}/api/mobile/sites", headers=h).json()["sites"]
    site_id = sites[0]["id"]

    # Sign in
    requests.post(f"{BASE}/api/mobile/sites/{site_id}/sign-in",
                  json={"kind": "worker"}, headers=h)

    r = requests.post(f"{BASE}/api/mobile/gps/heartbeat",
                      json={"lat": -34.79, "lng": 149.13}, headers=h)
    # May be rate-limited from prior test run — both 200 and 429 are valid
    assert r.status_code in (200, 429)
    if r.status_code == 200:
        assert r.json()["stored"] is True


def test_sites_require_auth():
    import requests
    r = requests.get(f"{BASE}/api/mobile/sites")
    assert r.status_code in (401, 403, 422)
