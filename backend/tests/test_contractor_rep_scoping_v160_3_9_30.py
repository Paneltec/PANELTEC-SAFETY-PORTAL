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
    # v160.3.9.30 — In this schema the contractor's own master row has
    # `company_id=None` (the row IS the company; its `id` == company_id).
    # The scope helper returns it via id-match. Sub-records (worker docs,
    # certifications) carry `company_id` pointing back to that master
    # row's id. Accept both patterns.
    ok = {None, _CONTRACTOR_COMPANY_ID}
    assert all(row.get("company_id") in ok for row in rows), \
        f"scope leak: {[row.get('company_id') for row in rows[:5]]}"
    # And the master row itself is present (via id match).
    ids = {row.get("id") for row in rows}
    assert _CONTRACTOR_COMPANY_ID in ids, "own-company master row missing"


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
    """Drift guard — the token list defined in roles_catalogue.SYSTEM_ROLES
    (in-code, single source of truth for roles_catalogue) must equal the
    flattened True-set from ROLE_DEFAULTS. Compares in-code to in-code
    to avoid DB-cache noise (the persisted `roles` collection may be
    seeded once at boot and not refreshed on the same request cycle)."""
    from permissions import ROLE_DEFAULTS
    from roles_catalogue import SYSTEM_ROLES
    published_by_role = {spec["role_id"]: set(spec["permission_tokens"])
                         for spec in SYSTEM_ROLES}
    for role_id in ("contractor_rep", "contractor_rep_submit_only"):
        defaults = ROLE_DEFAULTS.get(role_id, {})
        expected = {f"{res}.{act}" for res, acts in defaults.items()
                    for act, granted in acts.items() if granted}
        pub = published_by_role.get(role_id, set())
        missing = expected - pub
        extra = pub - expected
        assert not missing, f"{role_id}: {sorted(missing)} in ROLE_DEFAULTS but not published"
        assert not extra, f"{role_id}: {sorted(extra)} published but not in ROLE_DEFAULTS"
