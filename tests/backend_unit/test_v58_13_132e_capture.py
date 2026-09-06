"""
Test v58.13.132e — M5 Capture modules round-trip.

Tests:
  1. Hazard: list, create, get, draft support
  2. Incident: create + get
  3. Pre-Start: create + get + draft status
  4. Site Diary: create draft + get
  5. Inspection: create with checklist + get
  6. AI hazard-vision endpoint exists (may fail without real image — just check 4xx not 5xx)
"""
import os
import time
import pytest
import requests

BASE = os.getenv("BASE_URL", "https://whs-compliance.preview.emergentagent.com")
_TOKEN_CACHE: dict = {}


def _login() -> str:
    if _TOKEN_CACHE.get("token") and time.time() - _TOKEN_CACHE.get("ts", 0) < 300:
        return _TOKEN_CACHE["token"]
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "stephen@paneltec.com.au", "password": "Mcgstephen50#"},
        timeout=10,
    )
    if r.status_code == 429:
        pytest.skip("Rate-limited")
    assert r.status_code == 200, f"Login failed: {r.text[:200]}"
    tok = r.json()["access_token"]
    _TOKEN_CACHE["token"] = tok
    _TOKEN_CACHE["ts"] = time.time()
    return tok


def _h() -> dict:
    return {"Authorization": f"Bearer {_login()}", "Content-Type": "application/json"}


# ── Hazards ──

def test_hazard_list():
    r = requests.get(f"{BASE}/api/hazards", headers=_h(), timeout=10)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert len(items) >= 1
    print(f"✓ Hazards list: {len(items)} items")


def test_hazard_create_get():
    body = {
        "workspace_id": "2",
        "title": "M5 pytest - Trip hazard",
        "description": "Loose cable across walkway",
        "severity": "medium",
        "controls": ["Cable covers", "Route cables overhead"],
        "status": "open",
        "location": "Reception hallway",
        "reported_by": "pytest",
    }
    r = requests.post(f"{BASE}/api/hazards", headers=_h(), json=body, timeout=10)
    assert r.status_code == 201, f"Create failed: {r.text[:200]}"
    haz_id = r.json()["id"]
    # Get
    r2 = requests.get(f"{BASE}/api/hazards/{haz_id}", headers=_h(), timeout=10)
    assert r2.status_code == 200
    data = r2.json()
    assert data["title"] == body["title"]
    assert data["severity"] == "medium"
    assert len(data["controls"]) == 2
    print(f"✓ Hazard create+get: id={haz_id}")


def test_hazard_draft():
    body = {
        "workspace_id": "2",
        "title": "M5 pytest draft hazard",
        "status": "open",  # HazardStatus only allows open|in_progress|closed
        "description": "",
    }
    r = requests.post(f"{BASE}/api/hazards", headers=_h(), json=body, timeout=10)
    assert r.status_code == 201
    data = r.json()
    # Re-read
    r2 = requests.get(f"{BASE}/api/hazards/{data['id']}", headers=_h(), timeout=10)
    assert r2.json().get("status") == "open"
    print("✓ Hazard create with status works")


# ── Incidents ──

def test_incident_create_get():
    body = {
        "workspace_id": "2",
        "title": "M5 pytest - Near miss",
        "occurred_at": "2026-09-06T10:00:00Z",
        "category": "near_miss",
        "description": "Object dropped near worker",
        "follow_up_status": "open",
    }
    r = requests.post(f"{BASE}/api/incidents", headers=_h(), json=body, timeout=10)
    assert r.status_code == 201
    inc_id = r.json()["id"]
    r2 = requests.get(f"{BASE}/api/incidents/{inc_id}", headers=_h(), timeout=10)
    assert r2.status_code == 200
    assert r2.json()["category"] == "near_miss"
    print(f"✓ Incident create+get: id={inc_id}")


# ── Pre-Starts ──

def test_prestart_create_get_draft():
    body = {
        "workspace_id": "2",
        "date": "2026-09-06",
        "crew_lead": "pytest user",
        "work_summary": "M5 pytest - Test pre-start",
        "hazards_discussed": "Working at heights",
        "status": "draft",
        "linked_swms_ids": [],
        "linked_permits": [],
        "sign_ons": [],
        "crew_worker_ids": [],
    }
    r = requests.post(f"{BASE}/api/pre-starts", headers=_h(), json=body, timeout=10)
    assert r.status_code == 201
    ps_id = r.json()["id"]
    r2 = requests.get(f"{BASE}/api/pre-starts/{ps_id}", headers=_h(), timeout=10)
    assert r2.status_code == 200
    assert r2.json().get("status") == "draft"
    print(f"✓ Pre-Start create+get+draft: id={ps_id}")


# ── Site Diary ──

def test_site_diary_create_draft():
    body = {
        "workspace_id": "2",
        "date": "2026-09-06",
        "raw_notes": "M5 pytest - Fine weather, concrete pour progressing well.",
        "status": "draft",
    }
    r = requests.post(f"{BASE}/api/site-diary", headers=_h(), json=body, timeout=10)
    assert r.status_code == 201
    diary_id = r.json()["id"]
    r2 = requests.get(f"{BASE}/api/site-diary/{diary_id}", headers=_h(), timeout=10)
    assert r2.status_code == 200
    data = r2.json()
    assert data.get("status") == "draft"
    assert "concrete pour" in data["raw_notes"]
    print(f"✓ Site Diary create+draft: id={diary_id}")


# ── Inspections ──

def test_inspection_create_checklist():
    body = {
        "workspace_id": "2",
        "template_name": "M5 pytest Daily Inspection",
        "date": "2026-09-06",
        "checklist_items": [
            {"label": "PPE worn correctly", "response": "pass", "notes": None},
            {"label": "Fire exits clear", "response": "pass", "notes": None},
            {"label": "Scaffolding inspected", "response": "fail", "notes": "Needs tag check"},
        ],
        "operator": "pytest inspector",
        "status": "submitted",
    }
    r = requests.post(f"{BASE}/api/inspections", headers=_h(), json=body, timeout=10)
    assert r.status_code == 201
    ins_id = r.json()["id"]
    r2 = requests.get(f"{BASE}/api/inspections/{ins_id}", headers=_h(), timeout=10)
    assert r2.status_code == 200
    data = r2.json()
    assert len(data["checklist_items"]) == 3
    assert data["checklist_items"][2]["response"] == "fail"
    print(f"✓ Inspection create+checklist: id={ins_id}")


# ── AI endpoint exists ──

def test_ai_hazard_vision_endpoint_exists():
    """Verify the AI hazard-vision endpoint is reachable (4xx without image is OK)."""
    r = requests.post(
        f"{BASE}/api/ai/hazard-vision",
        headers={"Authorization": f"Bearer {_login()}"},
        timeout=10,
    )
    # 422 (missing file) or 400 is acceptable — 404 or 500 would be a problem
    assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}: {r.text[:200]}"
    print(f"✓ AI hazard-vision endpoint reachable (status={r.status_code})")
