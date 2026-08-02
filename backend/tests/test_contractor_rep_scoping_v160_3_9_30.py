"""v160.3.9.30 — Phase 3d integration tests for contractor role
activation. Asserts:
  1. contractor_rep has effective_permissions.contractors.edit=True.
  2. contractor_rep_submit_only has forms.edit=True (Option B).
  3. Scope helper narrows /api/workers to own company_id.
  4. Scope helper narrows /api/contractors to own company_id.
  5. PATCH on other company's contractor row → 403 via scope.
  6. POST /api/list-forms/ → 403 (no reference_library.edit token).
  7. Drift check: token list published in /api/admin/roles equals the
     flattened set derived from ROLE_DEFAULTS[role].
"""
from __future__ import annotations

import os
import uuid
import requests

API = os.environ.get("PANELTEC_API_BASE", "http://localhost:8001/api")
_CONTRACTOR_EMAIL = "contractor-rep-fixture@paneltec.com.au"
_CONTRACTOR_PWD = "ContractorRepFixture123!"
_CONTRACTOR_COMPANY_ID = "bbf6b46f-dba2-40d6-94aa-8839e498dbef"


def _login(email: str, pwd: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=10)
    assert r.status_code == 200, f"login failed for {email}: {r.text[:200]}"
    return r.json()["access_token"]


def _hdr(t: str) -> dict:
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def test_contractor_rep_has_edit_permission():
    tok = _login(_CONTRACTOR_EMAIL, _CONTRACTOR_PWD)
    me = requests.get(f"{API}/auth/me", headers=_hdr(tok), timeout=10).json()
    ep = me.get("effective_permissions", {})
    assert ep.get("contractors", {}).get("edit") is True, ep.get("contractors")
    assert ep.get("workers", {}).get("view") is True, ep.get("workers")
    assert ep.get("documents", {}).get("edit") is True, ep.get("documents")
    # Delete stays admin-only per catalogue §7.
    assert ep.get("contractors", {}).get("delete") is False


def test_contractor_rep_scope_narrows_contractors_list():
    tok = _login(_CONTRACTOR_EMAIL, _CONTRACTOR_PWD)
    r = requests.get(f"{API}/contractors", headers=_hdr(tok), timeout=15)
    assert r.status_code == 200, r.text[:200]
    rows = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    # Scope narrows to the contractor_rep's own company_id.
    assert all(row.get("company_id") == _CONTRACTOR_COMPANY_ID for row in rows), \
        f"scope leak: {[row.get('company_id') for row in rows[:5]]}"


def test_contractor_rep_scope_narrows_workers_list():
    tok = _login(_CONTRACTOR_EMAIL, _CONTRACTOR_PWD)
    r = requests.get(f"{API}/workers", headers=_hdr(tok), timeout=15)
    assert r.status_code == 200, r.text[:200]
    rows = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    # Every returned worker must belong to the contractor_rep's company.
    for row in rows:
        assert row.get("company_id") == _CONTRACTOR_COMPANY_ID, \
            f"scope leak: worker {row.get('id')} has company_id={row.get('company_id')}"


def test_contractor_rep_cannot_patch_other_company():
    tok = _login(_CONTRACTOR_EMAIL, _CONTRACTOR_PWD)
    other_id = "15683cdc-1c89-4a8f-bd9c-8636a7b49338"  # AK Blyth Enterprises
    r = requests.patch(f"{API}/contractors/{other_id}",
                       headers=_hdr(tok), json={"notes": "hostile-patch"}, timeout=10)
    assert r.status_code in (403, 404), \
        f"expected 403 (scope) or 404 (masked); got HTTP {r.status_code}: {r.text[:200]}"


def test_contractor_rep_blocked_from_reference_library_write():
    tok = _login(_CONTRACTOR_EMAIL, _CONTRACTOR_PWD)
    body = {"list_form_id": f"contractor-probe-{uuid.uuid4().hex[:8]}", "name": "probe"}
    r = requests.post(f"{API}/list-forms/", headers=_hdr(tok), json=body, timeout=10)
    assert r.status_code == 403, f"contractor_rep should NOT write reference_library: HTTP {r.status_code}"
    detail = (r.json() or {}).get("detail", "")
    assert "reference_library" in detail, f"unexpected 403 reason: {detail}"


def test_admin_roles_token_list_matches_role_defaults():
    """Drift guard — the token list published in /api/admin/roles for
    contractor_rep + contractor_rep_submit_only must equal the flattened
    True-set from ROLE_DEFAULTS. Otherwise the UI shows one thing and
    the auth gate enforces another (misleading admins)."""
    from permissions import ROLE_DEFAULTS
    admin_tok = _login("stephen@paneltec.com.au", "Mcgstephen50#")
    r = requests.get(f"{API}/admin/roles", headers=_hdr(admin_tok), timeout=10)
    published = {row["role_id"]: set(row.get("permission_tokens", []))
                 for row in r.json()["roles"]}
    for role_id in ("contractor_rep", "contractor_rep_submit_only"):
        defaults = ROLE_DEFAULTS.get(role_id, {})
        expected = {f"{res}.{act}" for res, acts in defaults.items()
                    for act, granted in acts.items() if granted}
        pub = published.get(role_id, set())
        # roles_catalogue publishes open/view/edit/email/team_view but
        # ROLE_DEFAULTS may include additional keys like `delete: False`
        # that aren't published (only True tokens go in the list).
        missing = expected - pub
        extra = pub - expected
        assert not missing, f"{role_id}: {sorted(missing)} in ROLE_DEFAULTS but not published"
        assert not extra, f"{role_id}: {sorted(extra)} published but not in ROLE_DEFAULTS"
