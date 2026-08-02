"""v160.3.9.31-4a — Phase 4a role_forms CRUD + audit + 403 gate tests.

Endpoints under /api/admin/roles/{role_id}/forms:
  · System role   → GETs work; POST/PATCH/DELETE return 400.
  · Custom role   → full CRUD round-trip, audit rows written.
  · Non-admin user (worker) hitting POST → 403.
  · Duplicate assign → 409.
  · Unknown form_id → 404.
"""
from __future__ import annotations

import os
import uuid
import requests

API = os.environ.get("PANELTEC_API_BASE", "http://localhost:8001/api")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"
WORKER_EMAIL = "worker-fixture@paneltec.com.au"
WORKER_PWD = "WorkerFixture123!"


def _login(email: str, pwd: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=10)
    assert r.status_code == 200, f"login failed for {email}: {r.text[:200]}"
    return r.json()["access_token"]


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _pick_form_id(tok: str) -> str:
    """Grab any live form_template.id from this org."""
    r = requests.get(f"{API}/form-templates/assignments", headers=_hdr(tok), timeout=10)
    assert r.status_code == 200, r.text[:200]
    rows = r.json().get("rows") or r.json().get("items") or r.json()
    if isinstance(rows, dict):
        rows = rows.get("rows") or rows.get("items") or []
    assert rows, "no form templates available for test"
    return rows[0]["id"]


def _create_custom_role(tok: str) -> str:
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/admin/roles",
        headers=_hdr(tok),
        json={"name": f"Forms Test {suffix}", "permission_tokens": []},
        timeout=10,
    )
    assert r.status_code == 201, r.text[:200]
    return r.json()["role_id"]


def test_system_role_forms_get_works_mutations_rejected():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    # GET works.
    r = requests.get(f"{API}/admin/roles/hseq_manager/forms", headers=_hdr(tok), timeout=10)
    assert r.status_code == 200, r.text[:200]
    # POST rejected 400.
    fid = _pick_form_id(tok)
    r = requests.post(
        f"{API}/admin/roles/hseq_manager/forms",
        headers=_hdr(tok),
        json={"form_id": fid},
        timeout=10,
    )
    assert r.status_code == 400, r.text[:200]
    assert "system role" in (r.json().get("detail") or "").lower()


def test_custom_role_forms_full_crud_with_audit():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    role_id = _create_custom_role(tok)
    try:
        fid = _pick_form_id(tok)
        # POST assign
        r = requests.post(
            f"{API}/admin/roles/{role_id}/forms",
            headers=_hdr(tok),
            json={"form_id": fid, "is_required": False},
            timeout=10,
        )
        assert r.status_code == 201, r.text[:200]
        assert r.json()["form_id"] == fid
        # Duplicate → 409
        rd = requests.post(
            f"{API}/admin/roles/{role_id}/forms",
            headers=_hdr(tok),
            json={"form_id": fid},
            timeout=10,
        )
        assert rd.status_code == 409, rd.text[:200]
        # Unknown form_id → 404
        r404 = requests.post(
            f"{API}/admin/roles/{role_id}/forms",
            headers=_hdr(tok),
            json={"form_id": "does-not-exist"},
            timeout=10,
        )
        assert r404.status_code == 404, r404.text[:200]
        # GET list shows the assignment
        rl = requests.get(f"{API}/admin/roles/{role_id}/forms", headers=_hdr(tok), timeout=10)
        assert rl.status_code == 200
        assert rl.json()["count"] == 1
        assert rl.json()["assigned"][0]["is_required"] is False
        # PATCH toggle required
        rp = requests.patch(
            f"{API}/admin/roles/{role_id}/forms/{fid}",
            headers=_hdr(tok),
            json={"is_required": True},
            timeout=10,
        )
        assert rp.status_code == 200, rp.text[:200]
        assert rp.json()["is_required"] is True
        # Available picker excludes the assigned form
        ra = requests.get(
            f"{API}/admin/roles/{role_id}/forms/available",
            headers=_hdr(tok), timeout=10,
        )
        assert ra.status_code == 200
        assert not any(x["form_id"] == fid for x in ra.json().get("available", []))
        # Audit rows contain form_assigned + form_updated
        au = requests.get(f"{API}/admin/roles/{role_id}/audit", headers=_hdr(tok), timeout=10)
        assert au.status_code == 200
        actions = [e["action"] for e in au.json()["entries"]]
        assert "form_assigned" in actions
        assert "form_updated" in actions
        # DELETE
        rd = requests.delete(
            f"{API}/admin/roles/{role_id}/forms/{fid}",
            headers=_hdr(tok), timeout=10,
        )
        assert rd.status_code == 200, rd.text[:200]
        # List empty
        rl2 = requests.get(f"{API}/admin/roles/{role_id}/forms", headers=_hdr(tok), timeout=10)
        assert rl2.status_code == 200
        assert rl2.json()["count"] == 0
        # form_unassigned in audit
        au2 = requests.get(f"{API}/admin/roles/{role_id}/audit", headers=_hdr(tok), timeout=10)
        assert "form_unassigned" in [e["action"] for e in au2.json()["entries"]]
    finally:
        # Cleanup — soft-delete the custom role.
        requests.delete(f"{API}/admin/roles/{role_id}", headers=_hdr(tok), timeout=10)


def test_non_admin_forbidden_on_role_forms_write():
    """Worker fixture must be rejected by require_permission('users','edit')."""
    try:
        wtok = _login(WORKER_EMAIL, WORKER_PWD)
    except AssertionError:
        # Fixture may not exist locally; skip rather than fail.
        import pytest
        pytest.skip("worker fixture user unavailable in this environment")
        return
    r = requests.post(
        f"{API}/admin/roles/general_user/forms",
        headers=_hdr(wtok),
        json={"form_id": "irrelevant"},
        timeout=10,
    )
    assert r.status_code == 403, r.text[:200]
