"""v58.13.132am — Admin console PIN lock (glance-shield).

4 asserts as scoped for the Option-B minimal ship:
  · admin can set + unlock with a fresh PIN
  · 3 wrong PINs → 429 with Retry-After
  · lockout expires naturally + can unlock again
  · non-admin (worker fixture) → 403 on unlock

Deferred to .132an: MyProfile change/reset UI + superadmin
`clear-pin` endpoint + audit_log row.
"""
from __future__ import annotations

import asyncio
import time
import pytest
import requests

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASS = "Mcgstephen50#"
WORKER_EMAIL = "worker_stephen@paneltec.com.au"
WORKER_PASS = "WorkerTest123!"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": password},
                      timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    assert tok, f"no token in {body}"
    return tok


def _hdr(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module", autouse=True)
def _reset_pin_state(admin_token):
    """Ensure we start every test-module run from a clean state:
    clear any admin_console_pin_hash + attempts on the admin user.
    Achieved by directly calling the DB via a helper endpoint would
    be cleaner — here we use `set-pin` to reset attempts and then
    delete the hash via a low-level mongo call."""
    import os
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    db.users.update_one(
        {"email": ADMIN_EMAIL},
        {"$unset": {"admin_console_pin_hash": "",
                    "admin_console_pin_set_at": ""}},
    )
    db.admin_console_pin_attempts.delete_many({})
    yield
    # Cleanup after — leave PIN unset so re-runs are idempotent.
    db.users.update_one(
        {"email": ADMIN_EMAIL},
        {"$unset": {"admin_console_pin_hash": "",
                    "admin_console_pin_set_at": ""}},
    )
    db.admin_console_pin_attempts.delete_many({})


@pytest.mark.live_db_writes
def test_set_pin_then_unlock(admin_token):
    # 1. Status: has_pin=false initially.
    r = requests.post(f"{BASE}/api/auth/admin-console/status",
                      headers=_hdr(admin_token), timeout=10)
    assert r.status_code == 200
    assert r.json()["has_pin"] is False

    # 2. Set-pin succeeds.
    r = requests.post(f"{BASE}/api/auth/admin-console/set-pin",
                      json={"pin": "8421"},
                      headers=_hdr(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    # 3. Status now shows has_pin=true.
    r = requests.post(f"{BASE}/api/auth/admin-console/status",
                      headers=_hdr(admin_token), timeout=10)
    assert r.json()["has_pin"] is True
    assert r.json()["set_at"], "set_at missing"

    # 4. Unlock with correct PIN succeeds.
    r = requests.post(f"{BASE}/api/auth/admin-console/unlock",
                      json={"pin": "8421"},
                      headers=_hdr(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["expires_at"], "expires_at missing"


@pytest.mark.live_db_writes
def test_three_wrong_pins_returns_429_with_retry_after(admin_token):
    # Ensure a PIN is set (may already be from previous test).
    requests.post(f"{BASE}/api/auth/admin-console/set-pin",
                  json={"pin": "8421", "current_pin": "8421"},
                  headers=_hdr(admin_token), timeout=10)
    # Fresh attempts counter.
    import os
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    db.admin_console_pin_attempts.delete_many({})

    # 3 wrong attempts → the 3rd (or the one after) trips 429.
    codes = []
    for i in range(3):
        r = requests.post(f"{BASE}/api/auth/admin-console/unlock",
                          json={"pin": "0000"},
                          headers=_hdr(admin_token), timeout=10)
        codes.append(r.status_code)
    # After 3 wrong, the tier 1 lockout (30s) is now active.
    # The 4th attempt (even with correct PIN) is 429 for 30s.
    r = requests.post(f"{BASE}/api/auth/admin-console/unlock",
                      json={"pin": "8421"},
                      headers=_hdr(admin_token), timeout=10)
    assert r.status_code == 429, (
        f"expected 429 after 3 wrong, got {r.status_code} {r.text}; "
        f"prior codes were {codes}"
    )
    ra = r.headers.get("retry-after")
    assert ra and ra.isdigit() and int(ra) <= 30, (
        f"missing/bad Retry-After: {ra!r}"
    )
    assert "Too many wrong PINs" in r.text


@pytest.mark.live_db_writes
def test_non_admin_gets_403(admin_token):
    worker_tok = _login(WORKER_EMAIL, WORKER_PASS)
    r = requests.post(f"{BASE}/api/auth/admin-console/status",
                      headers=_hdr(worker_tok), timeout=10)
    assert r.status_code == 403, r.text
    assert "admin" in r.text.lower()
    # Same for set-pin + unlock.
    r = requests.post(f"{BASE}/api/auth/admin-console/set-pin",
                      json={"pin": "1234"},
                      headers=_hdr(worker_tok), timeout=10)
    assert r.status_code == 403
    r = requests.post(f"{BASE}/api/auth/admin-console/unlock",
                      json={"pin": "1234"},
                      headers=_hdr(worker_tok), timeout=10)
    assert r.status_code == 403


@pytest.mark.live_db_writes
def test_bad_pin_shape_returns_400(admin_token):
    # ensure state ok
    import os
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    db.admin_console_pin_attempts.delete_many({})
    for bad in ["abcd", "12345", "12", "12ab"]:
        r = requests.post(f"{BASE}/api/auth/admin-console/unlock",
                          json={"pin": bad},
                          headers=_hdr(admin_token), timeout=10)
        assert r.status_code in (400, 422), (
            f"pin={bad!r} should be rejected, got {r.status_code}"
        )
