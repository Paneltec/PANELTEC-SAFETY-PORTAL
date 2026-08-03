"""v160.3.9.34.1 — Phase 4b parity for workers.

The public `POST /api/workers` endpoint no longer creates workers.
It returns 410 Gone with detail "worker create disabled: use Simpro
ZIP import" — but only AFTER the auth gate has passed. This mirrors
the Phase 4b `POST /api/users` behaviour exactly.

Expected matrix:
    unauth caller          → 401
    caller w/o workers.edit → 403
    admin caller            → 410 with the stable detail string
    PATCH /api/workers/{id} → still 200 (only *create* is disabled)

Ephemeral-worker fixture pattern — no production worker or user is
ever mutated.
"""
import uuid
import requests
import pytest

from .conftest import API, _login


DETAIL = "worker create disabled: use Simpro ZIP import"


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture
def eph_worker(_mongo, ephemeral_admin):
    """Seed one ephemeral worker in the admin's org and delete on
    teardown. Used only by the PATCH regression test — the create
    tests don't need an existing worker."""
    org_id = _mongo.users.find_one(
        {"id": ephemeral_admin["id"]}, {"_id": 0, "org_id": 1})["org_id"]
    wid = str(uuid.uuid4())
    doc = {
        "id": wid, "org_id": org_id,
        "first_name": "Deprecated", "last_name": f"Test {wid[:6]}",
        "email": f"__v34_1_create410_{wid[:8]}@paneltec.internal",
        "active": True,
        "availability": {},
        "client_ids": [],
        "source": "manual",
        "created_at": "2026-08-01T00:00:00+00:00",
        "created_by": "pytest",
        "updated_at": "2026-08-01T00:00:00+00:00",
        "deleted_at": None,
    }
    _mongo.workers.insert_one(doc)
    yield doc
    _mongo.workers.delete_one({"id": wid})


# ─── 1. Unauth POST /api/workers → 401 ───────────────────────────────

def test_create_worker_unauth_returns_401():
    r = requests.post(
        f"{API}/workers",
        json={"first_name": "Nope"},
        timeout=10,
    )
    assert r.status_code == 401, (
        f"expected 401 for unauth caller, got {r.status_code} {r.text[:200]}")


# ─── 2. Worker-role caller (no workers.edit) → 403 ───────────────────

def test_create_worker_worker_role_returns_403(tokens):
    """`ephemeral_users` seeds a `worker`-role account. Workers must
    not carry the `workers.edit` permission token."""
    tok = tokens.get("worker")
    if not tok:
        pytest.skip("worker-role ephemeral user unavailable")
    r = requests.post(
        f"{API}/workers",
        json={"first_name": "Nope"},
        headers=_hdr(tok),
        timeout=10,
    )
    assert r.status_code == 403, (
        f"expected 403 for worker-role caller, got {r.status_code} "
        f"{r.text[:200]}")


# ─── 3. Admin caller → 410 with stable detail ────────────────────────

def test_create_worker_admin_returns_410_with_stable_detail(ephemeral_admin):
    tok = ephemeral_admin["token"]
    r = requests.post(
        f"{API}/workers",
        json={"first_name": "Nope"},
        headers=_hdr(tok),
        timeout=10,
    )
    assert r.status_code == 410, (
        f"expected 410 for admin caller, got {r.status_code} {r.text[:200]}")
    payload = r.json()
    # FastAPI HTTPException surfaces as {"detail": "..."}.
    assert payload.get("detail") == DETAIL, (
        f"stable detail string drifted — got {payload!r}")


# ─── 4. PATCH still works (only *create* is disabled) ────────────────

def test_patch_worker_still_returns_200(ephemeral_admin, eph_worker):
    tok = ephemeral_admin["token"]
    r = requests.patch(
        f"{API}/workers/{eph_worker['id']}",
        json={"position": "Site Supervisor (patched)"},
        headers=_hdr(tok),
        timeout=10,
    )
    assert r.status_code == 200, (
        f"PATCH must still work post-410, got {r.status_code} {r.text[:200]}")
    body = r.json()
    assert body.get("position") == "Site Supervisor (patched)"


# ─── 5. Login regression — admin can still authenticate ──────────────

def test_login_regression_admin_still_authenticates():
    from .conftest import ADMIN_EMAIL, ADMIN_PWD
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=10,
    )
    assert r.status_code == 200, (
        f"REGRESSION HTTP={r.status_code} {r.text[:200]}")
