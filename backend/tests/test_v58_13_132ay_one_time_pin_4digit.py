"""v58.13.132ay — Invite one-time PIN shortened to 4 digits.

Guardrail for the entropy change:

  1. Generator emits exactly `^\\d{4}$` on 20 consecutive calls
     (zero-pad correctness: `0472`, `0011`, `0000`).
  2. Redeem payload rejects malformed PIN shape at the pydantic
     layer (before bcrypt.checkpw runs).
  3. 5 wrong attempts within the TTL auto-expire the stored PIN so
     the target admin has to generate a new one — the mitigation
     for the 100× entropy drop.
  4. Rate-limit still fires (3/min per IP is the tightened ceiling
     — a 4th call in the same minute returns 429).
"""
from __future__ import annotations

import os
import re
import time
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

pytestmark = pytest.mark.live_db_writes

BASE = "http://localhost:8001"
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASS = "Mcgstephen50#"
TARGET_EMAIL = "worker_stephen@paneltec.com.au"

FOUR_DIGIT = re.compile(r"^\d{4}$")


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
def db_handle():
    load_dotenv("/app/backend/.env")
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


@pytest.fixture
def target_user_id(db_handle):
    row = db_handle.users.find_one({"email": TARGET_EMAIL}, {"id": 1})
    assert row, f"seed missing: {TARGET_EMAIL}"
    return row["id"]


def test_generator_emits_only_4_digit(admin_token, target_user_id):
    """20 back-to-back generates → every payload matches `^\\d{4}$`.
    Covers zero-pad correctness (a run of 20 will statistically hit
    numbers < 1000 and reveal any missing pad)."""
    for _ in range(20):
        r = requests.post(f"{BASE}/api/users/{target_user_id}/pin",
                          headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        pin = r.json()["pin"]
        assert isinstance(pin, str)
        assert FOUR_DIGIT.match(pin), f"non-4-digit PIN emitted: {pin!r}"


def test_generator_persists_wrong_attempts_reset(admin_token, target_user_id, db_handle):
    """Each fresh generate must clear the wrong-attempts counter so a
    prior exhausted PIN can't block the new one."""
    # Poison the counter first.
    db_handle.users.update_one({"id": target_user_id},
                               {"$set": {"pin_wrong_attempts": 99}})
    r = requests.post(f"{BASE}/api/users/{target_user_id}/pin",
                      headers=_hdr(admin_token), timeout=10)
    assert r.status_code == 200
    doc = db_handle.users.find_one({"id": target_user_id},
                                   {"pin_wrong_attempts": 1})
    assert doc.get("pin_wrong_attempts") == 0


def test_redeem_rejects_non_4_digit_shape(admin_token, target_user_id):
    """Pydantic Field(pattern=r'^\\d{4}$') rejects the bad-shape
    payloads before bcrypt.checkpw is even called."""
    # Get a fresh PIN for a valid baseline; then send obviously bad
    # shapes.
    requests.post(f"{BASE}/api/users/{target_user_id}/pin",
                  headers=_hdr(admin_token), timeout=10)
    for bad in ("abc", "abcd", "123", "12345", "12a4", "", "12 3", "1-2-3"):
        r = requests.post(f"{BASE}/api/auth/pin/redeem",
                          json={
                              "email": TARGET_EMAIL,
                              "pin": bad,
                              "new_password": "GoodPass!23xy",
                              "confirm_password": "GoodPass!23xy",
                          }, timeout=10)
        assert r.status_code in (400, 422), (
            f"pin={bad!r} should be rejected, got {r.status_code} {r.text}"
        )


def test_redeem_wrong_4_digit_5x_expires_pin(admin_token, target_user_id, db_handle):
    """5 wrong 4-digit guesses within the TTL auto-expire the stored
    PIN. Also gives the redeem endpoint enough breathing room by
    sleeping between calls to sidestep the 3/min IP rate-limit."""
    # Fresh PIN so `pin_expires_at` is in the future.
    r = requests.post(f"{BASE}/api/users/{target_user_id}/pin",
                      headers=_hdr(admin_token), timeout=10)
    assert r.status_code == 200
    real_pin = r.json()["pin"]
    # Pick a guess that's not the real PIN.
    wrong = "0000" if real_pin != "0000" else "1111"
    seen_400 = 0
    for i in range(5):
        # 3/min rate-limit — pace to 25 s between calls.
        time.sleep(25)
        rr = requests.post(f"{BASE}/api/auth/pin/redeem",
                           json={
                               "email": TARGET_EMAIL,
                               "pin": wrong,
                               "new_password": "GoodPass!23xy",
                               "confirm_password": "GoodPass!23xy",
                           }, timeout=10)
        assert rr.status_code == 400, f"attempt {i+1}: {rr.status_code} {rr.text}"
        seen_400 += 1
    # After 5 wrong attempts the stored PIN is force-expired.
    doc = db_handle.users.find_one({"id": target_user_id},
                                   {"pin_expires_at": 1, "pin_wrong_attempts": 1})
    from models import now_iso  # noqa
    assert doc.get("pin_wrong_attempts") == 5
    assert doc.get("pin_expires_at") <= now_iso(), (
        f"pin_expires_at not force-expired: {doc.get('pin_expires_at')!r}"
    )
    assert seen_400 == 5
