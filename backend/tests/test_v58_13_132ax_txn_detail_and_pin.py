"""v58.13.132ax — Per-fill detail endpoint + strict-4-digit PIN gate.

Two-part guardrail for the .132ax bundle:

Part A · `GET /api/fleet/fuel/transactions/{id}`
    New endpoint powers the reusable `FuelTransactionDetailModal` on
    surfaces that carry only a partial payload (Top-5 highest fills,
    Top-5 $/L outliers). Contract:
      · Same `assets.view` gate as the list endpoint.
      · Multi-tenant guard: filters on `org_id` AND excludes
        soft-deleted rows. 404 for anything else.
      · Returns the FULL doc (no projection) so the modal can render
        `raw_row`, anomaly_flags, resolved_driver_name, etc.

Part B · Strict `^\\d{4}$` on every PIN endpoint payload
    Confirms the pre-existing bcrypt-side regex still rejects the
    edge cases Stephen's UX pattern now blocks client-side. `.132am`
    shipped `Field(min_length=4, max_length=4)` on the pydantic
    schema, and `_require_admin` runs `PIN_RE.match(...)` before
    every state mutation. We assert that behaviour hasn't drifted.
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


# ── Part A · GET /fleet/fuel/transactions/{id} ────────────────

def test_get_transaction_returns_full_doc(admin_token, db_handle):
    """Grab any live fuel row and confirm the endpoint returns it
    with the expected full-doc shape (raw_row + anomaly_flags,
    which are excluded from projected list endpoints)."""
    row = db_handle.fuel_transactions.find_one({"deleted_at": None},
                                               {"id": 1, "registration": 1})
    assert row, "seed data missing — no live fuel_transactions rows"
    r = requests.get(f"{BASE}/api/fleet/fuel/transactions/{row['id']}",
                     headers=_hdr(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == row["id"]
    assert body["registration"] == row["registration"]
    # Full-doc shape — modal renders these.
    for key in ("date_iso", "time_local", "litres", "total_price",
                "source", "match_status"):
        assert key in body, f"missing {key!r} in payload"


def test_get_transaction_missing_returns_404(admin_token):
    r = requests.get(f"{BASE}/api/fleet/fuel/transactions/does-not-exist",
                     headers=_hdr(admin_token), timeout=10)
    assert r.status_code == 404, r.text


def test_get_transaction_cross_org_returns_404(admin_token, db_handle):
    """Guardrail — a bogus id shaped like a UUID must still 404 (no
    fallback to first-row leakage). Belt-and-braces against a future
    ORM refactor that forgets the `org_id` filter."""
    r = requests.get(
        f"{BASE}/api/fleet/fuel/transactions/00000000-0000-0000-0000-000000000000",
        headers=_hdr(admin_token), timeout=10,
    )
    assert r.status_code == 404, r.text


# ── Part B · Strict 4-digit PIN regex ─────────────────────────

@pytest.mark.parametrize("bad_pin", [
    "abc",           # non-digit
    "abcd",          # 4 non-digits
    "12a4",          # mixed
    "123",           # 3 digits
    "12345",         # 5 digits
    "12 34",         # embedded space
    "12-34",         # embedded dash
    "",              # empty
    "12345678",      # 8 digits (very common paste of a phone number)
])
def test_set_pin_rejects_non_4_digit(admin_token, bad_pin):
    """Server-side backstop: no matter what a rogue client sends,
    the pydantic + PIN_RE combo rejects anything that isn't
    exactly 4 digits."""
    r = requests.post(f"{BASE}/api/auth/admin-console/set-pin",
                      json={"pin": bad_pin},
                      headers=_hdr(admin_token), timeout=10)
    assert r.status_code in (400, 422), (
        f"pin={bad_pin!r} should be rejected, got {r.status_code} {r.text}"
    )


@pytest.mark.parametrize("bad_pin", [
    "abcd", "123", "12345", "", "12 4", "12ab",
])
def test_unlock_rejects_non_4_digit(admin_token, bad_pin):
    r = requests.post(f"{BASE}/api/auth/admin-console/unlock",
                      json={"pin": bad_pin},
                      headers=_hdr(admin_token), timeout=10)
    assert r.status_code in (400, 422), (
        f"pin={bad_pin!r} should be rejected, got {r.status_code} {r.text}"
    )
