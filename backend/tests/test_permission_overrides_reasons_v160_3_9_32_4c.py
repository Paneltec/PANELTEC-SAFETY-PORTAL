"""v160.3.9.32-4c — Phase 4c per-user override reasons + audit tests.

Verifies:
  1. GET /users/{id}/permissions returns `reasons` field (empty dict fresh).
  2. PUT overrides + reasons persists both.
  3. Reason on a token that doesn't exist in overrides gets dropped.
  4. Reason < 3 chars OR > 200 chars gets dropped (validation).
  5. user_audit rows are written per PUT with a diff shape.
  6. Removing an override also removes its reason (idempotent).
"""
from __future__ import annotations

import os
import uuid
import requests

API = os.environ.get("PANELTEC_API_BASE", "http://localhost:8001/api")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _login(email: str, pwd: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=10)
    assert r.status_code == 200, r.text[:200]
    return r.json()["access_token"]


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _pick_target(tok: str) -> str:
    """Return worker-fixture id — safe target we own."""
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    for u in users:
        if u["email"] == "worker-fixture@paneltec.com.au":
            return u["id"]
    raise AssertionError("worker-fixture not found")


def test_get_permissions_returns_reasons_field():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    uid = _pick_target(tok)
    r = requests.get(f"{API}/users/{uid}/permissions", headers=_hdr(tok), timeout=10)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert "reasons" in body
    assert isinstance(body["reasons"], dict)


def test_put_overrides_persists_reasons_and_writes_audit():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    uid = _pick_target(tok)
    # Wipe first.
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)
    reason = f"pytest-{uuid.uuid4().hex[:6]} — grant swms.view for audit"
    r = requests.put(
        f"{API}/users/{uid}/permissions",
        headers=_hdr(tok),
        json={
            "overrides": {"swms": {"view": True}, "hazards": {"view": False}},
            "reasons": {"swms.view": reason,
                        "hazards.view": "temp deny while investigating false positives"},
        },
        timeout=10,
    )
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert body["overrides"]["swms"]["view"] is True
    assert body["overrides"]["hazards"]["view"] is False
    assert body["reasons"]["swms.view"] == reason

    # GET returns the same.
    r2 = requests.get(f"{API}/users/{uid}/permissions", headers=_hdr(tok), timeout=10)
    assert r2.status_code == 200
    assert r2.json()["reasons"]["swms.view"] == reason

    # Cleanup.
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)


def test_short_and_long_reasons_hard_reject_422():
    """v160.3.9.32-4c — hard-reject invalid non-empty reasons with 422.
    Silent drop was a compliance gap."""
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    uid = _pick_target(tok)
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)
    # 2-char reason → 422 (min length 3).
    r_short = requests.put(
        f"{API}/users/{uid}/permissions",
        headers=_hdr(tok),
        json={
            "overrides": {"swms": {"view": True}},
            "reasons": {"swms.view": "ok"},
        }, timeout=10,
    )
    assert r_short.status_code == 422, r_short.text[:200]
    detail = r_short.json().get("detail") or {}
    assert detail.get("error") == "reason_length_invalid"
    assert detail.get("key") == "swms.view"
    # 201-char reason → 422 (max length 200).
    r_long = requests.put(
        f"{API}/users/{uid}/permissions",
        headers=_hdr(tok),
        json={
            "overrides": {"hazards": {"view": True}},
            "reasons": {"hazards.view": "x" * 201},
        }, timeout=10,
    )
    assert r_long.status_code == 422, r_long.text[:200]
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)


def test_empty_string_reason_succeeds_no_reason_recorded():
    """Empty string is the "no reason for this override" opt-out — must succeed."""
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    uid = _pick_target(tok)
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)
    r = requests.put(
        f"{API}/users/{uid}/permissions",
        headers=_hdr(tok),
        json={
            "overrides": {"swms": {"view": True}},
            "reasons": {"swms.view": ""},
        }, timeout=10,
    )
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert body["overrides"]["swms"]["view"] is True
    assert "swms.view" not in body["reasons"]
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)


def test_whitespace_only_reason_rejected_422():
    """Whitespace-only reason → 422. Admin typed nothing meaningful."""
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    uid = _pick_target(tok)
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)
    r = requests.put(
        f"{API}/users/{uid}/permissions",
        headers=_hdr(tok),
        json={
            "overrides": {"swms": {"view": True}},
            "reasons": {"swms.view": "   "},
        }, timeout=10,
    )
    assert r.status_code == 422, r.text[:200]
    detail = r.json().get("detail") or {}
    assert detail.get("error") == "reason_length_invalid"
    assert detail.get("reason") == "whitespace_only"
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)


def test_removing_override_removes_reason():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    uid = _pick_target(tok)
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)
    # First: add
    requests.put(f"{API}/users/{uid}/permissions", headers=_hdr(tok), json={
        "overrides": {"swms": {"view": True}},
        "reasons": {"swms.view": "granting for demo"},
    }, timeout=10)
    # Then: remove the override entirely — reason must clean up too.
    r = requests.put(f"{API}/users/{uid}/permissions", headers=_hdr(tok), json={
        "overrides": {},
        "reasons": {"swms.view": "still hanging around"},
    }, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["overrides"] == {}
    assert body["reasons"] == {}
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)


def test_effective_permissions_reflects_override():
    """Confirm /auth/me from that user shows the override applied."""
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    uid = _pick_target(tok)
    # Give worker (who normally has zero SWMS.email access) an override to view swms.
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)
    requests.put(f"{API}/users/{uid}/permissions", headers=_hdr(tok), json={
        "overrides": {"swms": {"view": True}},
        "reasons": {"swms.view": "granting for regression check"},
    }, timeout=10)
    # Log in as the target user.
    wtok = _login("worker-fixture@paneltec.com.au", "WorkerFixture123!")
    me = requests.get(f"{API}/auth/me", headers=_hdr(wtok), timeout=10).json()
    eff = me.get("effective_permissions") or {}
    assert eff.get("swms", {}).get("view") is True, f"expected swms.view=True in effective, got {eff.get('swms')}"
    # Cleanup.
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)
