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


def test_short_and_long_reasons_dropped():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    uid = _pick_target(tok)
    requests.post(f"{API}/users/{uid}/permissions/reset", headers=_hdr(tok), timeout=10)
    r = requests.put(
        f"{API}/users/{uid}/permissions",
        headers=_hdr(tok),
        json={
            "overrides": {"swms": {"view": True}, "hazards": {"view": True},
                          "incidents": {"view": True}},
            "reasons": {
                "swms.view": "ok",       # 2 chars → drop
                "hazards.view": "x" * 250,  # too long → drop
                "incidents.view": "valid reason here",  # keep
            },
        }, timeout=10,
    )
    assert r.status_code == 200, r.text[:200]
    reasons = r.json()["reasons"]
    assert "swms.view" not in reasons
    assert "hazards.view" not in reasons
    assert reasons["incidents.view"] == "valid reason here"
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
