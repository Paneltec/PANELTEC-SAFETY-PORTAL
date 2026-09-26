"""v58.13.132p0 — Phase 1 daily-jobs schema tests.

Covers the locked contract:
  · POST /api/mobile/daily-jobs — 7 SMS fields only
  · GET  /api/mobile/daily-jobs/today — clean payload, no legacy keys
  · POST /api/mobile/daily-jobs/{id}/accept — status flip
  · POST /api/mobile/daily-jobs/{id}/decline — status flip
  · POST /api/mobile/sms/parse — parses the exact SMS Stephen sent

The pytest+TestClient path collides with Motor's per-loop client cache
in this repo (Motor creates its client on import; TestClient spins up
a new loop per test — result: `got Future attached to a different
loop`). To sidestep this cleanly we hit the LIVE supervisor-managed
backend on http://localhost:8001 via a plain httpx sync client.
This matches how the rest of the shipping code exercises the API.
"""
from __future__ import annotations

import sys
import uuid
from pathlib import Path

import httpx
import pytest

# Ensure backend/ is importable when running under pytest from /app.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

# Parser is a pure module — safe to import at collect-time.
from sms_parser import parse_sms  # type: ignore


TEST_MARKER = f"132p0_test_{uuid.uuid4().hex[:8]}"

BACKEND = "http://localhost:8001"
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASSWORD = "Paneltec2026!"

# The exact SMS Stephen showed us (used by both API + parser tests).
EXAMPLE_SMS = """\
Cappellotto 2 - Volvo - XT48AK
15-09-26
78 Corin Street West Launceston
78 Corin Street West Launceston, TAS 7250
Shaw
Staff: DANIEL BUTLER, JARROD TARGETT, JASON DONNELLAN
Kroll to site to expose main, ring Jason to complete tapping when exposed
Tap 50mm connection to Main, all fittings to be supplied, after site visit"""


@pytest.fixture(scope="module")
def http():
    with httpx.Client(base_url=BACKEND, timeout=15.0) as c:
        yield c


@pytest.fixture(scope="module")
def admin_token(http):
    r = http.post("/api/auth/login",
                  json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def hdr(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(autouse=True)
def _cleanup():
    """Cleanup after each test — uses a subprocess so we get a
    guaranteed fresh event loop and no Motor loop-collision."""
    yield
    import subprocess
    import textwrap
    script = textwrap.dedent(f"""
        import asyncio, os
        from dotenv import load_dotenv
        load_dotenv('{ROOT / ".env"}')
        from motor.motor_asyncio import AsyncIOMotorClient
        async def go():
            c = AsyncIOMotorClient(os.environ['MONGO_URL'])
            d = c[os.environ['DB_NAME']]
            await d.daily_job_assignments.delete_many({{
                '$or': [
                    {{'meta.trial_marker': '{TEST_MARKER}'}},
                    {{'meta.source': '{TEST_MARKER}'}},
                    {{'customer': '{TEST_MARKER}'}},
                ],
            }})
            c.close()
        asyncio.run(go())
    """)
    try:
        subprocess.run([sys.executable, "-c", script], timeout=10, check=False)
    except Exception:
        pass


# ─────────────── Parser tests (no HTTP) ───────────────

def test_parser_extracts_exact_sms_shape():
    parsed = parse_sms(EXAMPLE_SMS).to_dict()
    assert parsed["truck"] == "Cappellotto 2 - Volvo - XT48AK"
    assert parsed["date"] == "2026-09-15"
    assert parsed["site_name"] == "78 Corin Street West Launceston"
    assert parsed["address"] == "78 Corin Street West Launceston, TAS 7250"
    assert parsed["customer"] == "Shaw"
    assert parsed["staff"] == ["DANIEL BUTLER", "JARROD TARGETT", "JASON DONNELLAN"]
    assert "Kroll to site to expose main" in (parsed["notes"] or "")
    assert "all fittings to be supplied" in (parsed["notes"] or "")


def test_parser_handles_labeled_format():
    text = """Truck: Ute 4 - GBH23K
Date: 2026-10-05
Site: Riverside Depot
Address: 12 River Rd, Devonport, TAS 7310
Customer: TasWater
Staff: A. Smith, B. Jones
Notes: bring the trench box"""
    parsed = parse_sms(text).to_dict()
    assert parsed["truck"] == "Ute 4 - GBH23K"
    assert parsed["date"] == "2026-10-05"
    assert parsed["site_name"] == "Riverside Depot"
    assert parsed["address"] == "12 River Rd, Devonport, TAS 7310"
    assert parsed["customer"] == "TasWater"
    assert parsed["staff"] == ["A. Smith", "B. Jones"]
    assert parsed["notes"] == "bring the trench box"


def test_parser_never_raises_on_junk():
    for text in ("", "   ", "not really a job", "\n\n\n"):
        parsed = parse_sms(text).to_dict()
        assert isinstance(parsed, dict)


# ─────────────── POST /api/mobile/sms/parse ───────────────

def test_sms_parse_endpoint_returns_seven_fields(http, hdr):
    r = http.post("/api/mobile/sms/parse",
                  json={"sms": EXAMPLE_SMS}, headers=hdr)
    assert r.status_code == 200, r.text
    body = r.json()
    p = body["parsed"]
    assert set(p.keys()) == {
        "truck", "date", "site_name", "address",
        "customer", "staff", "notes",
    }
    assert p["date"] == "2026-09-15"
    assert p["staff"] == ["DANIEL BUTLER", "JARROD TARGETT", "JASON DONNELLAN"]
    assert body["missing"] == []


# ─────────────── POST /api/mobile/daily-jobs ───────────────

def test_create_daily_job_with_seven_fields(http, hdr):
    payload = {
        "worker_email": ADMIN_EMAIL,
        "truck": "Test Truck - ABC123",
        "date": "2026-10-01",
        "site_name": "Test Site",
        "address": "1 Test Road, Launceston, TAS 7250",
        "customer": TEST_MARKER,
        "staff": ["ALICE", "BOB"],
        "notes": "tests only",
        "override": True,
    }
    r = http.post("/api/mobile/daily-jobs", json=payload, headers=hdr)
    assert r.status_code == 201, r.text
    doc = r.json()
    for k in ("id", "worker_id", "worker_email", "worker_name",
              "truck", "date", "site_name", "address", "customer",
              "staff", "notes", "status", "issued_at", "accepted_at",
              "declined_at", "signed_on_at", "signed_on_gps",
              "site_id", "site_lat", "site_lng",
              "truck_prestart_id", "site_prestart_id",
              "created_at", "updated_at"):
        assert k in doc, f"missing {k}"
    assert doc["status"] == "issued"
    assert doc["staff"] == ["ALICE", "BOB"]
    assert doc["truck"] == "Test Truck - ABC123"
    for legacy in ("task", "supervisor_id", "supervisor_name",
                   "supervisor_phone", "truck_name", "truck_reg",
                   "is_past_date_fallback"):
        assert legacy not in doc, f"legacy key {legacy!r} leaked into response"


def test_create_ignores_extra_legacy_keys(http, hdr):
    payload = {
        "worker_email": ADMIN_EMAIL,
        "truck": "T2",
        "date": "2026-10-02",
        "customer": TEST_MARKER,
        "site_name": "S2", "address": "A2", "notes": "",
        "staff": [],
        # Legacy keys — MUST be ignored:
        "task": "SHOULD BE DROPPED",
        "supervisor_name": "SHOULD BE DROPPED",
        "truck_name": "SHOULD BE DROPPED",
        "truck_reg": "XXX",
        "override": True,
    }
    r = http.post("/api/mobile/daily-jobs", json=payload, headers=hdr)
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["truck"] == "T2"
    assert "task" not in doc
    assert "supervisor_name" not in doc
    assert "truck_name" not in doc
    assert "truck_reg" not in doc


def test_today_endpoint_returns_clean_shape(http, hdr):
    http.post("/api/mobile/daily-jobs", json={
        "worker_email": ADMIN_EMAIL,
        "truck": "T-today", "date": "2026-10-03",
        "site_name": "S-today", "address": "A-today",
        "customer": TEST_MARKER, "staff": ["X", "Y"], "notes": "",
        "override": True,
    }, headers=hdr)
    r = http.get("/api/mobile/daily-jobs/today", headers=hdr)
    assert r.status_code == 200, r.text
    body = r.json()
    a = body.get("assignment") or {}
    assert body["status"] in {"issued", "accepted", "signed_on", "no_job"}
    if a:
        assert "is_past_date_fallback" not in a
        assert "task" not in a
        assert "supervisor_name" not in a


def test_accept_and_decline_transitions(http, hdr):
    r = http.post("/api/mobile/daily-jobs", json={
        "worker_email": ADMIN_EMAIL, "truck": "T-a", "date": "2026-10-04",
        "site_name": "S", "address": "A", "customer": TEST_MARKER,
        "staff": [], "notes": "", "override": True,
    }, headers=hdr)
    assert r.status_code == 201, r.text
    assignment_id = r.json()["id"]

    r2 = http.post(f"/api/mobile/daily-jobs/{assignment_id}/accept",
                   headers=hdr)
    assert r2.status_code == 200, r2.text
    assert r2.json()["assignment"]["status"] == "accepted"
    assert r2.json()["assignment"]["accepted_at"] is not None

    r3 = http.post(f"/api/mobile/daily-jobs/{assignment_id}/decline",
                   headers=hdr)
    assert r3.status_code == 200, r3.text
    assert r3.json()["assignment"]["status"] == "declined"
    assert r3.json()["assignment"]["declined_at"] is not None


def test_signon_stub_returns_501(http, hdr):
    r = http.post("/api/mobile/daily-jobs/does-not-exist/signon",
                  headers=hdr)
    assert r.status_code == 501, r.text
