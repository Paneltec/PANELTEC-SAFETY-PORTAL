"""v160.3.0-adjust-5 — Active-sessions revoke endpoint contract tests.

Endpoint already existed pre-cycle; this cycle added:
  1. Self-revoke block (400) — admin can't revoke their own current session.
  2. Confirmation dialog + trash icon on frontend (not exercised here).

Contracts covered:
  A. Admin CAN revoke another user's session (204) → row disappears
     from `/admin/active-sessions` list.
  B. Non-admin (worker) CANNOT revoke any session (403).
  C. Admin CANNOT revoke their own current jti (400).
  D. Revoke unknown jti (404).
  E. Second revoke on the same jti (404 — session already gone).
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PW = "Mcgstephen50#"
WORKER_EMAIL = os.environ.get("WORKER_EMAIL", "worker_stephen@paneltec.com.au")
WORKER_PW = os.environ.get("WORKER_PW", "WorkerTest123!")


def _db():
    from pymongo import MongoClient
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _login(email: str, pw: str) -> dict:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": pw}, timeout=10)
    r.raise_for_status()
    return r.json()  # {access_token, ...}


def _admin() -> dict:
    return _db().users.find_one({"email": ADMIN_EMAIL}, {"_id": 0})


def _seed_active_session(admin: dict, user_id: str) -> str:
    """Insert a fake active_session row for a specific user."""
    jti = str(uuid.uuid4())
    _db().active_sessions.insert_one({
        "jti": jti, "org_id": admin["org_id"], "user_id": user_id,
        "user_name": "Seed User", "user_email": "seed@example.com",
        "role": "worker",
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "last_activity_at": datetime.now(timezone.utc).isoformat(),
    })
    return jti


@pytest.fixture(scope="module")
def admin() -> dict:
    a = _admin()
    assert a, "admin seed missing"
    return a


@pytest.fixture(scope="module")
def admin_token() -> str:
    return _login(ADMIN_EMAIL, ADMIN_PW)["access_token"]


def test_admin_can_revoke_another_users_session(admin, admin_token):
    worker = _db().users.find_one({"email": WORKER_EMAIL}, {"_id": 0})
    if not worker:
        pytest.skip("worker seed missing")
    jti = _seed_active_session(admin, worker["id"])
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.delete(f"{BASE}/api/admin/active-sessions/{jti}",
                            headers=h, timeout=10)
        assert r.status_code == 204, r.text
        assert _db().active_sessions.find_one({"jti": jti}) is None
    finally:
        _db().active_sessions.delete_one({"jti": jti})


def test_worker_cannot_revoke_session(admin):
    worker = _db().users.find_one({"email": WORKER_EMAIL}, {"_id": 0})
    if not worker:
        pytest.skip("worker seed missing")
    jti = _seed_active_session(admin, worker["id"])
    try:
        worker_token = _login(WORKER_EMAIL, WORKER_PW)["access_token"]
        r = requests.delete(f"{BASE}/api/admin/active-sessions/{jti}",
                            headers={"Authorization": f"Bearer {worker_token}"},
                            timeout=10)
        assert r.status_code == 403, r.text
        # Row untouched.
        assert _db().active_sessions.find_one({"jti": jti}) is not None
    finally:
        _db().active_sessions.delete_one({"jti": jti})


def test_admin_cannot_revoke_own_current_session():
    """Login mints a jti + registers an active_session for it. Attempting
    to DELETE that same jti must 400 with a helpful message."""
    body = _login(ADMIN_EMAIL, ADMIN_PW)
    token = body["access_token"]
    # Decode our own jti from the fresh access token.
    import jwt as _jwt
    import sys
    sys.path.insert(0, "/app/backend")
    from auth import JWT_ALGORITHM, _secret
    payload = _jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    my_jti = payload.get("jti")
    assert my_jti, "login must mint a jti"
    r = requests.delete(f"{BASE}/api/admin/active-sessions/{my_jti}",
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=10)
    assert r.status_code == 400, r.text
    assert "own current session" in r.text.lower() or "sign out" in r.text.lower()
    # The session must still be alive.
    assert _db().active_sessions.find_one({"jti": my_jti}) is not None


def test_revoke_unknown_jti_returns_404(admin_token):
    r = requests.delete(f"{BASE}/api/admin/active-sessions/does-not-exist",
                        headers={"Authorization": f"Bearer {admin_token}"},
                        timeout=10)
    assert r.status_code == 404, r.text


def test_second_revoke_is_404(admin, admin_token):
    worker = _db().users.find_one({"email": WORKER_EMAIL}, {"_id": 0})
    if not worker:
        pytest.skip("worker seed missing")
    jti = _seed_active_session(admin, worker["id"])
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r1 = requests.delete(f"{BASE}/api/admin/active-sessions/{jti}",
                             headers=h, timeout=10)
        assert r1.status_code == 204
        r2 = requests.delete(f"{BASE}/api/admin/active-sessions/{jti}",
                             headers=h, timeout=10)
        assert r2.status_code == 404, r2.text
    finally:
        _db().active_sessions.delete_one({"jti": jti})
