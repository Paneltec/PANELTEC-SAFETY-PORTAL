"""v160.2.2 — Regression tests for the worker-profile read-only endpoints.

Uses the live backend (http://localhost:8001) via `requests`, matching the
existing project convention.

Test accounts in this environment:
  · `stephen@paneltec.com.au` (role=admin) — HAS a linked worker record.
  · `worker_stephen@paneltec.com.au` (role=worker) — NO linked worker.

Coverage:
  1. `GET /api/workers/{id}` — admin can fetch any worker.
  2. `GET /api/workers/{id}` — 404 on missing id.
  3. `GET /api/workers/{id}` — non-privileged caller who does NOT own the
     row gets 403.
  4. `GET /api/me/worker-profile` — admin (linked) → returns worker + certs.
  5. `GET /api/me/worker-profile` — worker with no linked record → returns
     `{worker: null, certifications: [], clients: []}` with 200 (never 404).
  6. Every returned cert has a `status.key` in the known set so the mobile
     UI can pick the right amber/red highlight.
"""
from __future__ import annotations
import os
import pytest
import requests

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
ADMIN_EMAIL, ADMIN_PW = "stephen@paneltec.com.au", "Mcgstephen50#"
WORKER_EMAIL, WORKER_PW = "worker_stephen@paneltec.com.au", "WorkerTest123!"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def admin_headers() -> dict:
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PW)}"}


@pytest.fixture(scope="module")
def worker_headers() -> dict:
    return {"Authorization": f"Bearer {_login(WORKER_EMAIL, WORKER_PW)}"}


@pytest.fixture(scope="module")
def admin_worker_id(admin_headers: dict) -> str:
    """Admin's own linked worker id, discovered via /me/worker-profile."""
    r = requests.get(f"{BASE}/api/me/worker-profile",
                     headers=admin_headers, timeout=10)
    r.raise_for_status()
    body = r.json()
    w = body.get("worker")
    assert w is not None, (
        "Admin account has no linked worker — seed the environment first"
    )
    return w["id"]


# ─────────────────── GET /workers/{id} ─────────────────────────────────

def test_admin_can_fetch_any_worker(admin_headers, admin_worker_id):
    r = requests.get(f"{BASE}/api/workers/{admin_worker_id}",
                     headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == admin_worker_id
    for key in ("first_name", "last_name", "email", "active"):
        assert key in body, f"missing field {key} in admin worker row"


def test_missing_worker_returns_404(admin_headers):
    r = requests.get(f"{BASE}/api/workers/does-not-exist-{os.getpid()}",
                     headers=admin_headers, timeout=10)
    assert r.status_code == 404


def test_non_privileged_forbidden_on_other_row(worker_headers, admin_worker_id):
    """worker_stephen is role=worker and NOT the admin's worker owner →
    fetching that worker id must 403."""
    r = requests.get(f"{BASE}/api/workers/{admin_worker_id}",
                     headers=worker_headers, timeout=10)
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


# ─────────────────── GET /me/worker-profile ────────────────────────────

def test_me_profile_admin_returns_linked_worker(admin_headers):
    r = requests.get(f"{BASE}/api/me/worker-profile",
                     headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("worker") is not None
    assert isinstance(body.get("certifications"), list)
    assert isinstance(body.get("clients"), list)


def test_me_profile_unlinked_worker_returns_null_gracefully(worker_headers):
    """worker_stephen has no linked worker row — the endpoint must
    still return 200 with `{worker: null}`, never 404."""
    r = requests.get(f"{BASE}/api/me/worker-profile",
                     headers=worker_headers, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("worker") is None
    assert body.get("certifications") == []
    assert body.get("clients") == []


def test_me_profile_cert_status_shape(admin_headers):
    """Every cert row must carry a `status.key` in the known set so the
    mobile UI can pick the correct amber/red highlight."""
    r = requests.get(f"{BASE}/api/me/worker-profile",
                     headers=admin_headers, timeout=10)
    body = r.json()
    for c in body.get("certifications", []):
        assert "status" in c and isinstance(c["status"], dict), c
        assert c["status"].get("key") in {
            "valid", "expiring_soon", "expired", "no_expiry", "missing_file",
        }, c["status"]
