"""v160.3.9.31-4a — Phase 4a mutation & audit tests for
`/api/admin/roles`. Verifies:
  1. POST creates a custom role, audit row written.
  2. PATCH on a system role's `permission_tokens` → 400.
  3. PATCH on a system role's `is_active` → 200 (activation seam).
  4. DELETE on a system role → 400.
  5. PATCH on a custom role updates tokens + writes audit row.
  6. DELETE on a custom role soft-deletes (`is_active=False`,
     `deleted_at` populated).
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
    assert r.status_code == 200, f"login failed: {r.text[:200]}"
    return r.json()["access_token"]


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def test_patch_system_role_tokens_rejected():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    r = requests.patch(
        f"{API}/admin/roles/hseq_manager",
        headers=_hdr(tok),
        json={"permission_tokens": ["swms.view"]},
        timeout=10,
    )
    assert r.status_code == 400, r.text[:200]
    assert "system role" in (r.json().get("detail") or "").lower()


def test_patch_system_role_is_active_allowed():
    """The activation seam that Phase 3d used for contractor_rep must
    remain open — flipping is_active on a system role is allowed even
    though tokens/name/description are not."""
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    # Read current state, toggle it, toggle it back — idempotent test.
    r0 = requests.get(f"{API}/admin/roles/contractor_rep", headers=_hdr(tok), timeout=10)
    assert r0.status_code == 200
    was = bool(r0.json().get("is_active"))
    r1 = requests.patch(
        f"{API}/admin/roles/contractor_rep",
        headers=_hdr(tok),
        json={"is_active": not was},
        timeout=10,
    )
    assert r1.status_code == 200, r1.text[:200]
    assert r1.json().get("is_active") is (not was)
    # Restore
    r2 = requests.patch(
        f"{API}/admin/roles/contractor_rep",
        headers=_hdr(tok),
        json={"is_active": was},
        timeout=10,
    )
    assert r2.status_code == 200
    assert r2.json().get("is_active") is was


def test_delete_system_role_rejected():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    r = requests.delete(f"{API}/admin/roles/admin", headers=_hdr(tok), timeout=10)
    assert r.status_code == 400, r.text[:200]
    assert "system role" in (r.json().get("detail") or "").lower()


def test_create_patch_delete_custom_role_full_flow():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    suffix = uuid.uuid4().hex[:8]
    name = f"Test Auditor {suffix}"

    # POST create
    r = requests.post(
        f"{API}/admin/roles",
        headers=_hdr(tok),
        json={"name": name, "description": "pytest fixture",
              "permission_tokens": ["swms.view", "hazards.view"]},
        timeout=10,
    )
    assert r.status_code == 201, r.text[:200]
    created = r.json()
    role_id = created["role_id"]
    assert role_id.startswith("custom_")
    assert set(created["permission_tokens"]) == {"swms.view", "hazards.view"}
    assert created["is_system"] is False

    # PATCH tokens + description
    r = requests.patch(
        f"{API}/admin/roles/{role_id}",
        headers=_hdr(tok),
        json={"permission_tokens": ["swms.view", "hazards.view", "incidents.view"],
              "description": "updated"},
        timeout=10,
    )
    assert r.status_code == 200, r.text[:200]
    assert r.json()["description"] == "updated"
    assert "incidents.view" in r.json()["permission_tokens"]

    # Audit endpoint returns entries for this role.
    ra = requests.get(f"{API}/admin/roles/{role_id}/audit", headers=_hdr(tok), timeout=10)
    assert ra.status_code == 200, ra.text[:200]
    entries = ra.json().get("entries", [])
    actions = [e.get("action") for e in entries]
    assert "create" in actions
    assert "update" in actions

    # DELETE soft-deletes
    rd = requests.delete(f"{API}/admin/roles/{role_id}", headers=_hdr(tok), timeout=10)
    assert rd.status_code == 200, rd.text[:200]
    assert rd.json().get("soft") is True

    # Re-fetch — role still exists but is_active=False.
    rg = requests.get(f"{API}/admin/roles/{role_id}", headers=_hdr(tok), timeout=10)
    assert rg.status_code == 200
    body = rg.json()
    assert body.get("is_active") is False
    assert body.get("deleted_at") is not None


def test_create_role_rejects_schema_invalid_email_token():
    """`documents.email` is invalid per PERMISSIONS_SCHEMA (email_supported=False).
    The server should silently drop it — same rule as _t() in roles_catalogue."""
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    suffix = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/admin/roles",
        headers=_hdr(tok),
        json={"name": f"Schema Filter {suffix}",
              "permission_tokens": ["documents.email", "workers.email", "swms.view"]},
        timeout=10,
    )
    assert r.status_code == 201, r.text[:200]
    tokens = set(r.json()["permission_tokens"])
    assert "documents.email" not in tokens
    assert "workers.email" not in tokens
    assert "swms.view" in tokens
    # Cleanup
    requests.delete(f"{API}/admin/roles/{r.json()['role_id']}",
                    headers=_hdr(tok), timeout=10)
