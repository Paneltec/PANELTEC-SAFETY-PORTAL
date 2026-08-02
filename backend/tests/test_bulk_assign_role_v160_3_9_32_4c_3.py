"""v160.3.9.32-4c.3 — Bulk assign role tests."""
import os, uuid, requests

API = os.environ.get("PANELTEC_API_BASE", "http://localhost:8001/api")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email":email,"password":pwd}, timeout=10)
    assert r.status_code == 200, r.text[:200]
    return r.json()["access_token"]

def _hdr(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _pending_ids(tok, limit=3):
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    return [u["id"] for u in users if u.get("activation_status") == "pending_activation" and not u.get("role_id")][:limit]


def test_bulk_assign_role_admin_bulk_rejected():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    ids = _pending_ids(tok, 2)
    if not ids:
        import pytest; pytest.skip("no pending users to test")
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": ids, "role_id": "admin"}, timeout=10)
    assert r.status_code == 400, r.text[:200]
    assert "admin" in r.text.lower()


def test_bulk_assign_valid_role_success_and_idempotent():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    ids = _pending_ids(tok, 2)
    if len(ids) < 2:
        import pytest; pytest.skip("need 2 pending users")
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": ids, "role_id": "general_user",
                            "admin_confirmed": True, "hint_matched": True}, timeout=10)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert body["updated"] == 2
    assert body["skipped"] == 0
    # Second call is idempotent — those users now have role_id → skipped.
    r2 = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": ids, "role_id": "general_user"}, timeout=10)
    assert r2.status_code == 200
    assert r2.json()["skipped"] == 2
    assert r2.json()["updated"] == 0


def test_bulk_assign_unknown_role_404():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": ["dummy"], "role_id": "does_not_exist"}, timeout=10)
    assert r.status_code == 404


def test_bulk_assign_non_admin_forbidden():
    try:
        wtok = _login("worker-fixture@paneltec.com.au", "WorkerFixture123!")
    except AssertionError:
        import pytest; pytest.skip("worker fixture unavailable")
        return
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(wtok),
                      json={"user_ids": ["x"], "role_id": "general_user"}, timeout=10)
    assert r.status_code == 403


def test_bulk_assign_empty_ids_400():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": [], "role_id": "general_user"}, timeout=10)
    assert r.status_code == 400
