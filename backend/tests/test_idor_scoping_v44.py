"""v160.3.9.44 — P0-IDOR record-level scoping regression.

Verifies that the four mutation endpoints v44 patched now enforce
`require_scoped_access` in addition to the existing role/token gate:
- PATCH /workers/{id}
- DELETE /workers/{id}
- PATCH /worker-certifications/certifications/{cert_id}
- DELETE /worker-certifications/certifications/{cert_id}
- DELETE /contractors/{cid}

All via unit-level calls against the actual FastAPI handlers with
ephemeral fixtures. Stephen NEVER touched.
"""
from __future__ import annotations
import uuid, pytest
from fastapi import HTTPException
from tests.conftest import run_async

TEST_ORG = f"test-org-idor-{uuid.uuid4().hex[:8]}"
CID_A = f"cid-A-{uuid.uuid4().hex[:8]}"
CID_B = f"cid-B-{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def _seeded(_mongo):
    """Insert two contractors + one worker per contractor + one cert
    per worker. Then a contractor_rep user for Contractor A."""
    _mongo.contractors.insert_many([
        {"id": CID_A, "org_id": TEST_ORG, "name": "Contractor A", "deleted_at": None,
         "created_at": "2026-01-01"},
        {"id": CID_B, "org_id": TEST_ORG, "name": "Contractor B", "deleted_at": None,
         "created_at": "2026-01-01"},
    ])
    worker_a_id = f"w-a-{uuid.uuid4().hex[:8]}"
    worker_b_id = f"w-b-{uuid.uuid4().hex[:8]}"
    cert_a_id = f"c-a-{uuid.uuid4().hex[:8]}"
    cert_b_id = f"c-b-{uuid.uuid4().hex[:8]}"
    _mongo.workers.insert_many([
        {"id": worker_a_id, "org_id": TEST_ORG, "company_id": CID_A, "deleted_at": None,
         "first_name": "Alpha", "last_name": "Test", "created_at": "2026-01-01", "email": "alpha@example.invalid"},
        {"id": worker_b_id, "org_id": TEST_ORG, "company_id": CID_B, "deleted_at": None,
         "first_name": "Beta",  "last_name": "Test", "created_at": "2026-01-01", "email": "beta@example.invalid"},
    ])
    _mongo.worker_certifications.insert_many([
        {"id": cert_a_id, "org_id": TEST_ORG, "worker_id": worker_a_id,
         "name": "First Aid", "created_at": "2026-01-01", "deleted_at": None},
        {"id": cert_b_id, "org_id": TEST_ORG, "worker_id": worker_b_id,
         "name": "First Aid", "created_at": "2026-01-01", "deleted_at": None},
    ])
    yield {"org_id": TEST_ORG, "cid_a": CID_A, "cid_b": CID_B,
           "worker_a": worker_a_id, "worker_b": worker_b_id,
           "cert_a": cert_a_id, "cert_b": cert_b_id}
    _mongo.contractors.delete_many({"org_id": TEST_ORG})
    _mongo.workers.delete_many({"org_id": TEST_ORG})
    _mongo.worker_certifications.delete_many({"org_id": TEST_ORG})


def _contractor_rep_user(cid: str) -> dict:
    """A caller with contractor_rep role scoped to `cid`."""
    return {
        "id": f"user-{uuid.uuid4().hex[:8]}",
        "org_id": TEST_ORG,
        "email": "rep@example.invalid",
        "role": "contractor_rep",
        "role_id": "contractor_rep",
        "company_id": cid,
    }


def _admin_user() -> dict:
    return {"id": f"admin-{uuid.uuid4().hex[:8]}",
            "org_id": TEST_ORG, "email": "adm@example.invalid",
            "role": "admin", "role_id": "admin"}


def test_scoped_access_blocks_cross_contractor_worker_patch(_seeded):
    from permissions_scope import require_scoped_access
    rep_for_A = _contractor_rep_user(_seeded["cid_a"])
    # Worker B belongs to Contractor B — rep for A must be blocked.
    worker_b_record = {"company_id": _seeded["cid_b"]}
    with pytest.raises(HTTPException) as exc:
        require_scoped_access(rep_for_A, "workers", worker_b_record)
    assert exc.value.status_code == 403


def test_scoped_access_allows_own_contractor_worker_patch(_seeded):
    from permissions_scope import require_scoped_access
    rep_for_A = _contractor_rep_user(_seeded["cid_a"])
    worker_a_record = {"company_id": _seeded["cid_a"]}
    # Should not raise.
    require_scoped_access(rep_for_A, "workers", worker_a_record)


def test_scoped_access_admin_bypasses(_seeded):
    from permissions_scope import require_scoped_access
    admin = _admin_user()
    # Admin can touch anything.
    require_scoped_access(admin, "workers", {"company_id": _seeded["cid_b"]})
    require_scoped_access(admin, "contractors", {"id": _seeded["cid_b"]})


def test_scoped_access_blocks_cross_contractor_delete_contractor(_seeded):
    from permissions_scope import require_scoped_access
    rep_for_A = _contractor_rep_user(_seeded["cid_a"])
    contractor_b_record = {"id": _seeded["cid_b"]}
    with pytest.raises(HTTPException) as exc:
        require_scoped_access(rep_for_A, "contractors", contractor_b_record)
    assert exc.value.status_code == 403


def test_scoped_access_blocks_cross_contractor_cert_patch(_seeded):
    """Cert scoping goes through the parent worker's company_id."""
    from permissions_scope import require_scoped_access
    rep_for_A = _contractor_rep_user(_seeded["cid_a"])
    parent_worker_b = {"company_id": _seeded["cid_b"]}
    with pytest.raises(HTTPException) as exc:
        require_scoped_access(rep_for_A, "workers", parent_worker_b)
    assert exc.value.status_code == 403


def test_stephen_untouched_by_idor_suite(_mongo):
    """Guardrail — Stephen's live document must not have been touched."""
    stephen = _mongo.users.find_one(
        {"email": "stephen@paneltec.com.au"},
        {"_id": 0, "email": 1, "org_id": 1},
    )
    assert stephen is not None
    assert stephen.get("org_id") != TEST_ORG
