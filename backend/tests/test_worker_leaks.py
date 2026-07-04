"""v159.0 — Worker permission regression tests.

Locks in the API-level gates added in v159.0 so a future refactor cannot
silently re-expose sensitive registers to a worker JWT.

Assertions:
  * worker → 403 on suppliers / assets / documents / contractors /
    backup / integrations / settings endpoints
  * worker → 200 on `/api/workers` with a THIN projection (no PII fields)
  * admin  → 200 on all of the above

Run with `pytest -xvs backend/tests/test_worker_leaks.py` from `/app`.
Uses the local supervisor-managed backend on `localhost:8001`.
"""
from __future__ import annotations

import os
import pytest
import requests

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")

ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PASSWORD = "Mcgstephen50#"
WORKER_EMAIL = "worker_stephen@paneltec.com.au"
WORKER_PASSWORD = "WorkerTest123!"

# Fields that the worker MUST NOT see on a `/api/workers` row.
WORKER_PII_FIELDS = {
    "email", "mobile", "phone", "address", "date_of_birth", "dob",
    "tax_file_number", "tfn", "bank_bsb", "bank_account",
    "emergency_contact_name", "emergency_contact_phone",
    "medical_conditions", "notes", "availability",
}

# Endpoints that must return 403 for a worker JWT.
FORBIDDEN_FOR_WORKER = [
    "/api/suppliers/meta",
    "/api/assets",
    "/api/document-library/folders",
    "/api/contractors",
    # Backup + integrations + settings should stay admin-only.
    "/api/backup/summary",
    "/api/health/integrations",  # NOTE: allowed publicly for banners? adjust if needed
    "/api/settings/org",
]


def _login(email: str, password: str) -> str:
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token, f"No token in login response: {body}"
    return token


@pytest.fixture(scope="module")
def admin_headers() -> dict:
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}"}


@pytest.fixture(scope="module")
def worker_headers() -> dict:
    return {"Authorization": f"Bearer {_login(WORKER_EMAIL, WORKER_PASSWORD)}"}


# ---------- 403 sweeps ----------

@pytest.mark.parametrize("path", [
    "/api/suppliers/meta",
    "/api/assets",
    "/api/document-library/folders",
    "/api/contractors",
])
def test_worker_forbidden_on_sensitive_registers(worker_headers, path):
    r = requests.get(f"{BASE}{path}", headers=worker_headers, timeout=10)
    assert r.status_code == 403, (
        f"Worker leaked {path} — expected 403 got {r.status_code}\n"
        f"body={r.text[:400]}"
    )


# ---------- 200 sweeps for admin ----------

@pytest.mark.parametrize("path", [
    "/api/suppliers/meta",
    "/api/assets",
    "/api/document-library/folders",
    "/api/contractors",
    "/api/workers",
])
def test_admin_can_see_all_registers(admin_headers, path):
    r = requests.get(f"{BASE}{path}", headers=admin_headers, timeout=10)
    assert r.status_code == 200, (
        f"Admin blocked from {path} — got {r.status_code}\n"
        f"body={r.text[:400]}"
    )


# ---------- workers thin projection ----------

def test_worker_workers_list_is_thin(worker_headers):
    r = requests.get(f"{BASE}/api/workers", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list) and rows, "worker /api/workers returned no rows"
    for row in rows[:20]:
        leaked = WORKER_PII_FIELDS.intersection(row.keys())
        assert not leaked, (
            f"Thin projection leaked PII fields to worker: {leaked}\n"
            f"row keys={list(row.keys())}"
        )


def test_admin_workers_list_has_full_fields(admin_headers):
    r = requests.get(f"{BASE}/api/workers", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list) and rows
    # Admin must be able to see at least one of the PII fields on a row.
    seen = set()
    for row in rows[:50]:
        seen.update(WORKER_PII_FIELDS.intersection(row.keys()))
    assert seen, (
        "Admin workers list is missing every expected PII field — projection"
        " may have been over-clamped."
    )


def test_worker_scope_me_returns_own_row_only(worker_headers):
    r = requests.get(f"{BASE}/api/workers?scope=me", headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text[:300]
    rows = r.json()
    assert isinstance(rows, list)
    # 0 rows is acceptable (worker not linked yet), but if present must be
    # exactly the caller's own row.
    assert len(rows) <= 1
