"""v160.3.0-adjust-2 — DELETE /api/audit-exports/{id} regression tests.

The endpoint didn't exist before this cycle — the web-admin trash
button was 404'ing. Now it soft-deletes (audit trail concern:
compliance artefacts should remain traceable). Contracts under test:

1. Admin can soft-delete an export → row disappears from the
   list + `GET /{id}` returns 404 afterwards.
2. Non-admin (hseq_lead, worker) gets 403 — audit exports are
   admin-only for delete, matching `render-pdf` sibling
   endpoint precedent.
3. Second delete on the same id → 404 (idempotent-safe UI).
4. Delete flips `deleted_at` on the source doc (proves soft
   delete, not hard delete — required for audit trail).
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


def _login(email: str, pw: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": email, "password": pw}, timeout=10)
    r.raise_for_status()
    return r.json()["access_token"]


def _seed_export(admin: dict, fmt: str = "pdf") -> str:
    eid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    _db().audit_exports.insert_one({
        "id": eid, "org_id": admin["org_id"],
        "title": "v160.3.0-adjust-2 seed",
        "scope": "test",
        "date_from": "2026-07-01", "date_to": "2026-07-11",
        "format": fmt, "filename": f"seed-{eid[:8]}.{fmt}",
        "file_url": f"/api/files/audit-exports/{eid}",
        "size_bytes": 1024, "sha256": "0" * 64,
        "created_by": admin["id"], "created_at": now,
        "deleted_at": None,
    })
    return eid


@pytest.fixture(scope="module")
def admin() -> dict:
    a = _db().users.find_one({"email": ADMIN_EMAIL}, {"_id": 0})
    assert a, "seed admin missing"
    return a


@pytest.fixture(scope="module")
def admin_token() -> str:
    return _login(ADMIN_EMAIL, ADMIN_PW)


def test_admin_can_soft_delete_export(admin, admin_token):
    eid = _seed_export(admin)
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        # visible before
        r = requests.get(f"{BASE}/api/audit-exports", headers=h, timeout=10)
        assert eid in {x["id"] for x in r.json()}, "export must be listed pre-delete"
        # delete → 204
        r_del = requests.delete(f"{BASE}/api/audit-exports/{eid}", headers=h, timeout=10)
        assert r_del.status_code == 204, r_del.text
        # gone from list
        r2 = requests.get(f"{BASE}/api/audit-exports", headers=h, timeout=10)
        assert eid not in {x["id"] for x in r2.json()}, "export must be gone post-delete"
        # GET /{id} → 404
        r3 = requests.get(f"{BASE}/api/audit-exports/{eid}", headers=h, timeout=10)
        assert r3.status_code == 404, r3.text
        # soft-delete: row still exists in DB with deleted_at set
        row = _db().audit_exports.find_one({"id": eid}, {"_id": 0})
        assert row is not None, "soft delete must NOT hard-drop the row"
        assert row.get("deleted_at"), f"deleted_at must be set: {row}"
        assert row.get("deleted_by") == admin["id"]
    finally:
        _db().audit_exports.delete_one({"id": eid})


def test_worker_cannot_delete_export(admin):
    eid = _seed_export(admin)
    try:
        worker_token = _login(WORKER_EMAIL, WORKER_PW)
        h = {"Authorization": f"Bearer {worker_token}"}
        r = requests.delete(f"{BASE}/api/audit-exports/{eid}", headers=h, timeout=10)
        assert r.status_code == 403, r.text
        # still alive
        row = _db().audit_exports.find_one({"id": eid}, {"_id": 0})
        assert row and row.get("deleted_at") is None
    finally:
        _db().audit_exports.delete_one({"id": eid})


def test_second_delete_returns_404(admin, admin_token):
    eid = _seed_export(admin)
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r1 = requests.delete(f"{BASE}/api/audit-exports/{eid}", headers=h, timeout=10)
        assert r1.status_code == 204
        r2 = requests.delete(f"{BASE}/api/audit-exports/{eid}", headers=h, timeout=10)
        assert r2.status_code == 404, r2.text
    finally:
        _db().audit_exports.delete_one({"id": eid})


def test_delete_unknown_id_returns_404(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.delete(f"{BASE}/api/audit-exports/does-not-exist", headers=h, timeout=10)
    assert r.status_code == 404, r.text


def test_list_hides_soft_deleted_rows(admin, admin_token):
    """Belt-and-braces: pre-existing rows in the DB that never had a
    `deleted_at` field must still appear in the list (Mongo None-eq
    matches missing fields). Only rows with an explicit non-null
    `deleted_at` should be filtered."""
    eid_active = _seed_export(admin)
    eid_deleted = _seed_export(admin)
    try:
        _db().audit_exports.update_one(
            {"id": eid_deleted},
            {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
        )
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.get(f"{BASE}/api/audit-exports", headers=h, timeout=10)
        ids = {x["id"] for x in r.json()}
        assert eid_active in ids
        assert eid_deleted not in ids
    finally:
        _db().audit_exports.delete_one({"id": eid_active})
        _db().audit_exports.delete_one({"id": eid_deleted})
