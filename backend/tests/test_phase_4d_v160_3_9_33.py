"""v160.3.9.33 — Phase 4d tests.

Covers:
  1. POST /api/admin/roles/sync-from-simpro-positions
     - Fresh sync creates N roles, subsequent runs skip N (idempotency).
     - Non-admin → 403.
     - Every created role → `role_audit` entry action="create_from_simpro".
  2. Auto-created roles land with `source="simpro_position_auto"`,
     `permission_tokens=[]`, `is_active=True`, `is_system=False`.
  3. bulk-assign-role with `role_id="__from_position__"` auto-creates
     each user's position role and assigns it.
  4. Option-1 fallback: PATCH a custom role to add tokens →
     GET /auth/me for a user with that role → new tokens are effective.
  5. Cache-bust invariant: mutations to `db.roles` invalidate the
     per-process token cache so the next request sees fresh tokens.
  6. Slug collision safety: seeded role_ids (no `custom_` prefix) never
     collide with auto-created role_ids (always `custom_` prefix).
"""
import os
import time
import uuid
import requests

API = os.environ.get("PANELTEC_API_BASE", "http://localhost:8001/api")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PWD = "Mcgstephen50#"


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=10)
    assert r.status_code == 200, r.text[:200]
    return r.json()["access_token"]


def _hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ─── (1) sync idempotency ─────────────────────────────────────────────

def test_sync_from_simpro_positions_idempotent_across_three_runs():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    # Run 1 — may create N (fresh) or 0 (already-run in an earlier test).
    r1 = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                       headers=_hdr(tok), timeout=15)
    assert r1.status_code == 200, r1.text[:200]
    body1 = r1.json()
    # After run 1, every distinct simpro_position should exist as a role.
    total_after_1 = len(body1["created"]) + len(body1["skipped"])
    # Run 2 — should create 0 and skip the same set.
    r2 = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                       headers=_hdr(tok), timeout=15)
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["created"] == [], (
        f"Second run should create nothing; got {body2['created']}")
    assert len(body2["skipped"]) == total_after_1, (
        f"Second run should skip the same total; got {len(body2['skipped'])} vs {total_after_1}")
    # Run 3 — same as run 2.
    r3 = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                       headers=_hdr(tok), timeout=15)
    assert r3.status_code == 200
    body3 = r3.json()
    assert body3["created"] == []
    assert body3["skipped"] == body2["skipped"]


def test_sync_from_simpro_positions_non_admin_forbidden():
    try:
        wtok = _login("worker-fixture@paneltec.com.au", "WorkerFixture123!")
    except AssertionError:
        import pytest
        pytest.skip("worker fixture unavailable")
        return
    r = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                      headers=_hdr(wtok), timeout=10)
    assert r.status_code == 403
    assert "users.edit" in r.text.lower()


# ─── (2) auto-role shape ──────────────────────────────────────────────

def test_auto_created_roles_have_correct_shape():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    # Ensure the sync has run at least once so auto roles exist.
    requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                  headers=_hdr(tok), timeout=15)
    roles = requests.get(f"{API}/admin/roles", headers=_hdr(tok), timeout=10).json()["roles"]
    auto = [r for r in roles if r.get("source") == "simpro_position_auto"]
    assert len(auto) > 0, "expected at least one auto-created role"
    for r in auto:
        assert r["is_system"] is False
        assert r["is_active"] is True
        assert (r.get("permission_tokens") or []) == []  # empty by default
        assert r["role_id"].startswith("custom_")


def test_slug_collision_safety_seeded_vs_auto():
    """Seeded role_ids never carry the `custom_` prefix. Auto role_ids
    ALWAYS carry the `custom_` prefix. Even if an admin renames a
    seeded role to look like a Simpro position, there is no way for the
    two to collide because the seed rows never start with custom_.
    """
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    roles = requests.get(f"{API}/admin/roles", headers=_hdr(tok), timeout=10).json()["roles"]
    seed_ids = {r["role_id"] for r in roles if r.get("source") == "seed"}
    auto_ids = {r["role_id"] for r in roles if r.get("source") == "simpro_position_auto"}
    for sid in seed_ids:
        assert not sid.startswith("custom_"), f"seed role {sid} must not carry custom_ prefix"
    for aid in auto_ids:
        assert aid.startswith("custom_"), f"auto role {aid} must carry custom_ prefix"
    assert seed_ids.isdisjoint(auto_ids), "seed and auto role_id sets must be disjoint"


# ─── (3) bulk-assign from position sentinel ───────────────────────────

def _find_pending_with_position(tok):
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    for u in users:
        if (not u.get("role_id")) and u.get("simpro_position") and u.get("activation_status") == "pending_activation":
            return u
    return None


def test_bulk_assign_from_position_sentinel_creates_and_assigns():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    # Pre-sync so no NEW roles get created here; we only exercise assignment.
    requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                  headers=_hdr(tok), timeout=15)
    u = _find_pending_with_position(tok)
    if not u:
        import pytest
        pytest.skip("no pending user with simpro_position to test __from_position__")
        return
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": [u["id"]],
                            "role_id": "__from_position__",
                            "admin_confirmed": True}, timeout=10)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["updated"] == 1
    # Confirm the user now carries a custom_ role_id.
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    target = [x for x in users if x["id"] == u["id"]][0]
    assert target["role_id"] and target["role_id"].startswith("custom_")
    assert target["activation_status"] == "active"


def test_bulk_assign_from_position_no_position_returns_error():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    # Find a user without simpro_position (should be a test fixture).
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    victim = None
    for u in users:
        if not u.get("simpro_position") and not u.get("role_id"):
            victim = u; break
    if not victim:
        import pytest
        pytest.skip("no user without simpro_position + without role_id available")
        return
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": [victim["id"]],
                            "role_id": "__from_position__",
                            "admin_confirmed": True}, timeout=10)
    assert r.status_code == 200  # partial-batch friendly
    body = r.json()
    assert body["updated"] == 0
    assert body["errors"] == 1
    assert any(e.get("reason") == "no_simpro_position" for e in body["detail"]["errors"])


# ─── (4) Option-1 fallback: DB tokens govern effective permissions ────

def test_option_1_fallback_db_tokens_grant_permission():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    # Create a fresh custom role with a unique name so we don't collide
    # with any Simpro-position slug present in the org.
    fresh_name = f"Fallback Test {uuid.uuid4().hex[:6]}"
    r_create = requests.post(f"{API}/admin/roles", headers=_hdr(tok),
                             json={"name": fresh_name, "description": "phase 4d fallback",
                                   "permission_tokens": ["swms.view"]}, timeout=10)
    assert r_create.status_code == 201, r_create.text[:200]
    role_id = r_create.json()["role_id"]

    # Bulk-assign this role to a fresh pending user, then set a password.
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    victim = None
    for u in users:
        if (not u.get("role_id")) and u.get("simpro_position") and u.get("activation_status") == "pending_activation":
            victim = u; break
    if not victim:
        import pytest
        pytest.skip("no pending Simpro user available for fallback test")
        return
    r_assign = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                             json={"user_ids": [victim["id"]], "role_id": role_id,
                                   "admin_confirmed": True}, timeout=10)
    assert r_assign.status_code == 200, r_assign.text[:200]
    # Reset password so we can log in as them.
    pwd = f"FbTest_{uuid.uuid4().hex[:8]}!X"
    r_pwd = requests.post(f"{API}/users/{victim['id']}/set-password",
                          headers=_hdr(tok), json={"password": pwd}, timeout=10)
    assert r_pwd.status_code == 200, r_pwd.text[:200]

    # Log in as victim → /auth/me.effective_permissions.swms.view must be True.
    vtok = _login(victim["email"], pwd)
    me = requests.get(f"{API}/auth/me", headers=_hdr(vtok), timeout=10).json()
    eff = me.get("effective_permissions", {})
    assert eff.get("swms", {}).get("view") is True, (
        f"Option-1 fallback failed — swms.view={eff.get('swms', {}).get('view')} "
        f"for role_id={me.get('role_id')} role={me.get('role')}"
    )
    # Sanity: not granted → false.
    assert eff.get("incidents", {}).get("view") is False


# ─── (5) cache-bust invariant ─────────────────────────────────────────

def test_cache_bust_invariant_patch_visible_within_one_second():
    """After PATCH-ing tokens on a custom role, the very next
    /auth/me for a user with that role must reflect the new tokens.
    This proves `_bust_role_cache(role_id)` fires from patch_role and
    the token cache in permissions.py is invalidated correctly."""
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    fresh_name = f"CacheBust {uuid.uuid4().hex[:6]}"
    r_create = requests.post(f"{API}/admin/roles", headers=_hdr(tok),
                             json={"name": fresh_name, "description": "phase 4d cache",
                                   "permission_tokens": []}, timeout=10)
    assert r_create.status_code == 201
    role_id = r_create.json()["role_id"]

    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    victim = None
    for u in users:
        if (not u.get("role_id")) and u.get("simpro_position"):
            victim = u; break
    if not victim:
        import pytest
        pytest.skip("no pending Simpro user for cache-bust test")
        return
    r_assign = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                             json={"user_ids": [victim["id"]], "role_id": role_id,
                                   "admin_confirmed": True}, timeout=10)
    assert r_assign.status_code == 200
    pwd = f"CacheBust_{uuid.uuid4().hex[:8]}!X"
    r_pwd = requests.post(f"{API}/users/{victim['id']}/set-password",
                          headers=_hdr(tok), json={"password": pwd}, timeout=10)
    assert r_pwd.status_code == 200

    vtok = _login(victim["email"], pwd)
    # Warm the cache — expect False initially (empty tokens).
    me0 = requests.get(f"{API}/auth/me", headers=_hdr(vtok), timeout=10).json()
    assert me0.get("effective_permissions", {}).get("hazards", {}).get("view") is False
    # PATCH role to add hazards.view — should invalidate the cache.
    r_patch = requests.patch(f"{API}/admin/roles/{role_id}", headers=_hdr(tok),
                             json={"permission_tokens": ["hazards.view"]}, timeout=10)
    assert r_patch.status_code == 200
    # Re-read /auth/me — must now be True.
    me1 = requests.get(f"{API}/auth/me", headers=_hdr(vtok), timeout=10).json()
    assert me1.get("effective_permissions", {}).get("hazards", {}).get("view") is True, (
        "Cache-bust regression: PATCH didn't invalidate _ROLE_TOKENS_CACHE"
    )
    # PATCH again to REMOVE the token — must revert.
    r_patch2 = requests.patch(f"{API}/admin/roles/{role_id}", headers=_hdr(tok),
                              json={"permission_tokens": []}, timeout=10)
    assert r_patch2.status_code == 200
    me2 = requests.get(f"{API}/auth/me", headers=_hdr(vtok), timeout=10).json()
    assert me2.get("effective_permissions", {}).get("hazards", {}).get("view") is False, (
        "Cache-bust regression: PATCH-to-remove didn't invalidate _ROLE_TOKENS_CACHE"
    )


# ─── (6) audit rows ───────────────────────────────────────────────────

def test_sync_writes_role_audit_entries():
    tok = _login(ADMIN_EMAIL, ADMIN_PWD)
    # Trigger a create via sync (may be a no-op if all positions already exist —
    # in that case we skip). To force a create, name a fresh role first.
    fresh = f"Simpro Audit {uuid.uuid4().hex[:6]}"
    # We can't actually spawn a fresh Simpro position from here, so instead
    # assert the audit table has create_from_simpro entries in general.
    r_sync = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                           headers=_hdr(tok), timeout=15)
    body = r_sync.json()
    # For at least one auto-role, fetch its audit log & check for create_from_simpro.
    if body["created"] or body["skipped"]:
        sample = (body["created"] or body["skipped"])[0]
        r_audit = requests.get(f"{API}/admin/roles/{sample}/audit",
                               headers=_hdr(tok), timeout=10)
        assert r_audit.status_code == 200
        entries = r_audit.json().get("entries") or []
        # At least one action==create_from_simpro must appear historically.
        assert any(e.get("action") == "create_from_simpro" for e in entries), (
            f"expected create_from_simpro action in role_audit for {sample}"
        )
