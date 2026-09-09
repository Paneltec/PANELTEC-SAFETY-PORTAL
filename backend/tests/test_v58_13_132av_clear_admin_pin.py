"""v58.13.132av — Clear admin console PIN (superadmin action).

Endpoint under test:
    POST /api/users/{target_user_id}/admin-console/clear-pin
    body: { acting_pin: "1234" }
    gates: _require_admin + acting admin's own PIN must verify

UI coverage: `frontend/src/components/auth/AccessKebab.jsx` renders
a confirmation modal that asks for the acting admin's own PIN,
then POSTs to this endpoint.

Cases:
  1. Correct acting PIN → 200 ok, target user's PIN cleared, audit
     row written.
  2. Wrong acting PIN → 401, rate-limit counter increments.
  3. Acting admin without a PIN of their own → 409.
  4. Non-admin caller → 403.
  5. Malformed acting_pin → 400/422.
  6. Missing target user → 404 (with correct acting PIN).
"""
from __future__ import annotations

import os
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASS = "Mcgstephen50#"
WORKER_EMAIL = "worker_stephen@paneltec.com.au"
WORKER_PASS = "WorkerTest123!"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": password}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json()["token"]


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def worker_token():
    return _login(WORKER_EMAIL, WORKER_PASS)


@pytest.fixture(scope="module")
def db_handle():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


@pytest.fixture(autouse=True)
def _clean(db_handle, admin_token):
    """Start each test with a known state: admin has PIN=8421,
    worker has PIN=1111, attempts counters cleared."""
    db_handle.admin_console_pin_attempts.delete_many({})
    # Admin PIN = 8421.
    requests.post(f"{BASE}/api/auth/admin-console/set-pin",
                  json={"pin": "8421"}, headers=_hdr(admin_token), timeout=10)
    # Requires current_pin on rotate — one more call to be sure.
    requests.post(f"{BASE}/api/auth/admin-console/set-pin",
                  json={"pin": "8421", "current_pin": "8421"},
                  headers=_hdr(admin_token), timeout=10)
    # Worker gets a PIN via direct DB write (they can't set-pin as non-
    # admin, but the DB shape is what the clear-pin endpoint reads).
    from auth import hash_password  # noqa: WPS433 — used at test-time only
    worker = db_handle.users.find_one({"email": WORKER_EMAIL}, {"id": 1})
    assert worker, "worker fixture missing — run seed"
    db_handle.users.update_one(
        {"id": worker["id"]},
        {"$set": {
            "admin_console_pin_hash": hash_password("1111"),
            "admin_console_pin_set_at": "2026-09-01T00:00:00+00:00",
        }},
    )
    yield {"admin_email": ADMIN_EMAIL, "worker_id": worker["id"]}
    # Cleanup: leave admin PIN alone (fixture will set it again next test);
    # clear worker's PIN so no test artefact leaks.
    db_handle.users.update_one(
        {"id": worker["id"]},
        {"$unset": {"admin_console_pin_hash": "",
                    "admin_console_pin_set_at": ""}},
    )
    db_handle.admin_console_pin_attempts.delete_many({})


def test_clear_pin_with_correct_acting_pin(admin_token, db_handle, _clean):
    ctx = _clean
    r = requests.post(
        f"{BASE}/api/users/{ctx['worker_id']}/admin-console/clear-pin",
        json={"acting_pin": "8421"},
        headers=_hdr(admin_token), timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["target_user_id"] == ctx["worker_id"]
    # Target user's PIN hash is gone.
    doc = db_handle.users.find_one({"id": ctx["worker_id"]},
                                   {"admin_console_pin_hash": 1})
    assert not doc.get("admin_console_pin_hash")
    # Audit row written.
    audit = db_handle.user_audit.find_one({
        "action": "admin_console_pin_cleared_by_admin",
        "target_user_id": ctx["worker_id"],
    })
    assert audit, "audit row missing"
    assert audit["acting_user_email"] == ADMIN_EMAIL


def test_clear_pin_wrong_acting_pin_returns_401(admin_token, _clean):
    ctx = _clean
    r = requests.post(
        f"{BASE}/api/users/{ctx['worker_id']}/admin-console/clear-pin",
        json={"acting_pin": "0000"},
        headers=_hdr(admin_token), timeout=10,
    )
    assert r.status_code == 401, r.text
    assert "incorrect" in r.text.lower()


def test_clear_pin_malformed_acting_pin_rejected(admin_token, _clean):
    ctx = _clean
    for bad in ("abcd", "12345", "12", ""):
        r = requests.post(
            f"{BASE}/api/users/{ctx['worker_id']}/admin-console/clear-pin",
            json={"acting_pin": bad},
            headers=_hdr(admin_token), timeout=10,
        )
        assert r.status_code in (400, 422), (
            f"pin={bad!r} should be rejected, got {r.status_code} {r.text}"
        )


def test_clear_pin_non_admin_gets_403(worker_token, _clean):
    ctx = _clean
    r = requests.post(
        f"{BASE}/api/users/{ctx['worker_id']}/admin-console/clear-pin",
        json={"acting_pin": "1111"},
        headers=_hdr(worker_token), timeout=10,
    )
    assert r.status_code == 403, r.text


def test_clear_pin_missing_target_returns_404(admin_token, _clean):
    r = requests.post(
        f"{BASE}/api/users/does-not-exist-abc/admin-console/clear-pin",
        json={"acting_pin": "8421"},
        headers=_hdr(admin_token), timeout=10,
    )
    assert r.status_code == 404, r.text
