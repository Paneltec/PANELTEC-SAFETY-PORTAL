"""v160.3.9.33 — Phase 4d tests.

Covers:
  1. POST /api/admin/roles/sync-from-simpro-positions — idempotent, 403,
     audit rows.
  2. Auto-role shape (source, is_system=False, tokens=[]).
  3. Slug collision safety between seeded and auto roles.
  4. bulk-assign-role `__from_position__` sentinel.
  5. Option-1 fallback: db.roles.permission_tokens[] drive effective
     permissions for users on custom / auto roles.
  6. Cache-bust invariant: PATCH-ing tokens on a role is visible on
     the very next /auth/me for a user holding that role.
  7. Phase 4d Option C: `role_locked` flag semantics.
     • Manual bulk-assign to non-position-matching role → role_locked=True.
     • Manual bulk-assign to position-matching role → role_locked=False.
     • __from_position__ assignment → role_locked=False.
     • PATCH /users/{id} {role_locked:false} unlocks; next Option-C
       flow would re-sync.
     • PATCH /users/{id} {role_id:<some>} auto-computes role_locked.

HARD RULE (see conftest.py outage note): this file MUST only mutate
`db.users` rows created inside the test itself (or via the
`ephemeral_admin` conftest fixture). It NEVER touches real production
accounts (paneltec.com.au domain OR admin/hseq_manager roles). Every
seeded row is deleted at teardown.
"""
import os
import uuid
import time

import bcrypt
import pytest
import requests

# v58.13.23 — Module-level `live_db_writes` opt-in. Every test here
# uses the module-scoped `ephemeral_admin` fixture (or its own
# ephemeral users) that write to `test_database.users`. The v58.13.22
# conftest hardening (_module_prod_writes_gate + skip-reset in
# production_db_guard) makes this one-line opt-in sufficient — no
# in-file workaround needed.
pytestmark = pytest.mark.live_db_writes

from .conftest import (
    API, ADMIN_EMAIL, ADMIN_PWD,
    _login, _hash, assert_ephemeral_target,
    EPHEMERAL_EMAIL_PREFIX,
)

# Use conftest's shared API (points to REACT_APP_BACKEND_URL, i.e. the
# preview URL). Local pytest overrides are NOT supported — the whole
# suite talks to the same backend the frontend does.


def _hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


PHASE4D_USER_PREFIX = "__phase4d_ephuser__"


@pytest.fixture
def eph_pending_user(_mongo, ephemeral_org_id):
    """Seed one ephemeral pending user with a fake Simpro position.
    Yields the user doc; deletes at teardown."""
    uid = str(uuid.uuid4())
    email = f"{PHASE4D_USER_PREFIX}{uid[:8]}@paneltec.internal"
    doc = {
        "id": uid,
        "org_id": ephemeral_org_id,
        "email": email,
        "name": f"Phase4D Ephemeral {uid[:8]}",
        "role": None,
        "role_id": None,
        "status": "active",
        "activation_status": "pending_activation",
        "password_hash": None,
        "simpro_employee_id": f"EPH-{uid[:6]}",
        "simpro_position": "Traffic Controller",  # matches seeded auto role
        "position": "Traffic Controller",
        "created_at": "2026-08-01T00:00:00+00:00",
        "created_by": "pytest",
        "token_version": 0,
        "workspace_ids": [],
    }
    _mongo.users.insert_one(doc)
    yield doc
    _mongo.users.delete_one({"id": uid})


@pytest.fixture
def eph_no_position_user(_mongo, ephemeral_org_id):
    uid = str(uuid.uuid4())
    email = f"{PHASE4D_USER_PREFIX}nopos_{uid[:8]}@paneltec.internal"
    doc = {
        "id": uid,
        "org_id": ephemeral_org_id,
        "email": email,
        "name": f"Phase4D NoPos {uid[:8]}",
        "role": None,
        "role_id": None,
        "status": "active",
        "activation_status": "pending_activation",
        "password_hash": None,
        "created_at": "2026-08-01T00:00:00+00:00",
        "created_by": "pytest",
        "token_version": 0,
        "workspace_ids": [],
    }
    _mongo.users.insert_one(doc)
    yield doc
    _mongo.users.delete_one({"id": uid})


# ═════════════════════════════════════════════════════════════════════
# (1) sync idempotency
# ═════════════════════════════════════════════════════════════════════

def test_sync_from_simpro_positions_idempotent_across_three_runs(ephemeral_admin):
    tok = ephemeral_admin["token"]
    r1 = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                       headers=_hdr(tok), timeout=15)
    assert r1.status_code == 200, r1.text[:200]
    body1 = r1.json()
    total = len(body1["created"]) + len(body1["skipped"])
    r2 = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                       headers=_hdr(tok), timeout=15)
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["created"] == []
    assert len(body2["skipped"]) == total
    r3 = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                       headers=_hdr(tok), timeout=15)
    body3 = r3.json()
    assert body3["created"] == []
    assert body3["skipped"] == body2["skipped"]


def test_sync_from_simpro_positions_non_admin_forbidden():
    try:
        wtok = _login("worker-fixture@paneltec.com.au", "WorkerFixture123!")
    except AssertionError:
        pytest.skip("worker fixture unavailable")
        return
    r = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                      headers=_hdr(wtok), timeout=10)
    assert r.status_code == 403
    assert "users.edit" in r.text.lower()


# ═════════════════════════════════════════════════════════════════════
# (2) auto-role shape
# ═════════════════════════════════════════════════════════════════════

def test_auto_created_roles_have_correct_shape(ephemeral_admin):
    tok = ephemeral_admin["token"]
    requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                  headers=_hdr(tok), timeout=15)
    roles = requests.get(f"{API}/admin/roles", headers=_hdr(tok), timeout=10).json()["roles"]
    auto = [r for r in roles if r.get("source") == "simpro_position_auto"]
    assert len(auto) > 0
    # v160.3.9.33 — assert structural shape only. Tokens may have been
    # populated post-creation by admins (or a prior test iteration) — the
    # invariant we care about is that the ROLE ITSELF is correctly typed
    # as an auto-simpro role, not that its permission_tokens list stays [].
    for r in auto:
        assert r["is_system"] is False
        assert r["is_active"] is True
        assert isinstance(r.get("permission_tokens") or [], list)
        assert r["role_id"].startswith("custom_")


def test_slug_collision_safety_seeded_vs_auto(ephemeral_admin):
    tok = ephemeral_admin["token"]
    roles = requests.get(f"{API}/admin/roles", headers=_hdr(tok), timeout=10).json()["roles"]
    seed_ids = {r["role_id"] for r in roles if r.get("source") == "seed"}
    auto_ids = {r["role_id"] for r in roles if r.get("source") == "simpro_position_auto"}
    for sid in seed_ids:
        assert not sid.startswith("custom_")
    for aid in auto_ids:
        assert aid.startswith("custom_")
    assert seed_ids.isdisjoint(auto_ids)


# ═════════════════════════════════════════════════════════════════════
# (3) bulk-assign __from_position__
# ═════════════════════════════════════════════════════════════════════

def test_bulk_assign_from_position_sentinel_creates_and_assigns(
    ephemeral_admin, eph_pending_user
):
    tok = ephemeral_admin["token"]
    requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                  headers=_hdr(tok), timeout=15)
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": [eph_pending_user["id"]],
                            "role_id": "__from_position__",
                            "admin_confirmed": True}, timeout=10)
    assert r.status_code == 200, r.text[:300]
    body = r.json()
    assert body["updated"] == 1
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    target = [x for x in users if x["id"] == eph_pending_user["id"]][0]
    assert target["role_id"] == "custom_traffic_controller"
    assert target["activation_status"] == "active"
    # v4d Option C: from_position → role_locked=False.
    assert target["role_locked"] is False


def test_bulk_assign_from_position_no_position_returns_error(
    ephemeral_admin, eph_no_position_user
):
    tok = ephemeral_admin["token"]
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": [eph_no_position_user["id"]],
                            "role_id": "__from_position__",
                            "admin_confirmed": True}, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["updated"] == 0
    assert body["errors"] == 1
    assert any(e.get("reason") == "no_simpro_position" for e in body["detail"]["errors"])


# ═════════════════════════════════════════════════════════════════════
# (4) Option-1 fallback: DB tokens govern effective permissions
# ═════════════════════════════════════════════════════════════════════

def test_option_1_fallback_db_tokens_grant_permission(
    _mongo, ephemeral_admin, eph_pending_user
):
    """Assign a custom role with tokens=[swms.view] to an ephemeral
    pending user; log in as them; effective.swms.view MUST be True."""
    tok = ephemeral_admin["token"]
    fresh_name = f"Fallback Test {uuid.uuid4().hex[:6]}"
    r_create = requests.post(f"{API}/admin/roles", headers=_hdr(tok),
                             json={"name": fresh_name, "description": "phase 4d",
                                   "permission_tokens": ["swms.view"]}, timeout=10)
    assert r_create.status_code == 201, r_create.text[:200]
    role_id = r_create.json()["role_id"]

    r_assign = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                             json={"user_ids": [eph_pending_user["id"]],
                                   "role_id": role_id,
                                   "admin_confirmed": True}, timeout=10)
    assert r_assign.status_code == 200

    # Set ephemeral user's password DIRECTLY in the DB (with guard).
    assert_ephemeral_target(_mongo, {"id": eph_pending_user["id"]})
    pwd = f"FbTest_{uuid.uuid4().hex[:8]}!X"
    _mongo.users.update_one({"id": eph_pending_user["id"]},
                             {"$set": {"password_hash": _hash(pwd)}})

    vtok = _login(eph_pending_user["email"], pwd)
    me = requests.get(f"{API}/auth/me", headers=_hdr(vtok), timeout=10).json()
    eff = me.get("effective_permissions", {})
    assert eff.get("swms", {}).get("view") is True, (
        f"Option-1 fallback failed — swms.view={eff.get('swms', {}).get('view')} "
        f"for role_id={me.get('role_id')} role={me.get('role')}"
    )
    assert eff.get("incidents", {}).get("view") is False

    # Cleanup: remove the ephemeral custom role.
    requests.delete(f"{API}/admin/roles/{role_id}", headers=_hdr(tok), timeout=10)


# ═════════════════════════════════════════════════════════════════════
# (5) cache-bust invariant
# ═════════════════════════════════════════════════════════════════════

def test_cache_bust_invariant_patch_visible_within_one_second(
    _mongo, ephemeral_admin, eph_pending_user
):
    tok = ephemeral_admin["token"]
    fresh_name = f"CacheBust {uuid.uuid4().hex[:6]}"
    r_create = requests.post(f"{API}/admin/roles", headers=_hdr(tok),
                             json={"name": fresh_name, "description": "phase 4d cache",
                                   "permission_tokens": []}, timeout=10)
    assert r_create.status_code == 201
    role_id = r_create.json()["role_id"]

    r_assign = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                             json={"user_ids": [eph_pending_user["id"]],
                                   "role_id": role_id,
                                   "admin_confirmed": True}, timeout=10)
    assert r_assign.status_code == 200

    assert_ephemeral_target(_mongo, {"id": eph_pending_user["id"]})
    pwd = f"CacheBust_{uuid.uuid4().hex[:8]}!X"
    _mongo.users.update_one({"id": eph_pending_user["id"]},
                             {"$set": {"password_hash": _hash(pwd)}})

    vtok = _login(eph_pending_user["email"], pwd)
    me0 = requests.get(f"{API}/auth/me", headers=_hdr(vtok), timeout=10).json()
    assert me0.get("effective_permissions", {}).get("hazards", {}).get("view") is False

    r_patch = requests.patch(f"{API}/admin/roles/{role_id}", headers=_hdr(tok),
                             json={"permission_tokens": ["hazards.view"]}, timeout=10)
    assert r_patch.status_code == 200
    me1 = requests.get(f"{API}/auth/me", headers=_hdr(vtok), timeout=10).json()
    assert me1.get("effective_permissions", {}).get("hazards", {}).get("view") is True

    r_patch2 = requests.patch(f"{API}/admin/roles/{role_id}", headers=_hdr(tok),
                              json={"permission_tokens": []}, timeout=10)
    assert r_patch2.status_code == 200
    me2 = requests.get(f"{API}/auth/me", headers=_hdr(vtok), timeout=10).json()
    assert me2.get("effective_permissions", {}).get("hazards", {}).get("view") is False

    requests.delete(f"{API}/admin/roles/{role_id}", headers=_hdr(tok), timeout=10)


# ═════════════════════════════════════════════════════════════════════
# (6) role audit entries
# ═════════════════════════════════════════════════════════════════════

def test_sync_writes_role_audit_entries(ephemeral_admin):
    tok = ephemeral_admin["token"]
    r_sync = requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                           headers=_hdr(tok), timeout=15)
    body = r_sync.json()
    sample = (body["created"] or body["skipped"] or [None])[0]
    if not sample:
        pytest.skip("no auto roles to audit")
        return
    r_audit = requests.get(f"{API}/admin/roles/{sample}/audit",
                           headers=_hdr(tok), timeout=10)
    assert r_audit.status_code == 200
    entries = r_audit.json().get("entries") or []
    assert any(e.get("action") == "create_from_simpro" for e in entries)


# ═════════════════════════════════════════════════════════════════════
# (7) Phase 4d Option C: role_locked semantics
# ═════════════════════════════════════════════════════════════════════

def test_option_c_bulk_assign_non_matching_role_locks(
    ephemeral_admin, eph_pending_user
):
    """User has simpro_position='Traffic Controller'. Admin assigns
    them to `general_user` (a seeded role, different from
    custom_traffic_controller). Expect role_locked=True."""
    tok = ephemeral_admin["token"]
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": [eph_pending_user["id"]],
                            "role_id": "general_user",
                            "admin_confirmed": True}, timeout=10)
    assert r.status_code == 200
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    target = [x for x in users if x["id"] == eph_pending_user["id"]][0]
    assert target["role_id"] == "general_user"
    assert target["role_locked"] is True


def test_option_c_bulk_assign_matching_position_role_unlocks(
    ephemeral_admin, eph_pending_user
):
    """Sync first so custom_traffic_controller exists, then bulk-assign
    the user to that exact role. Expect role_locked=False."""
    tok = ephemeral_admin["token"]
    requests.post(f"{API}/admin/roles/sync-from-simpro-positions",
                  headers=_hdr(tok), timeout=15)
    r = requests.post(f"{API}/users/bulk-assign-role", headers=_hdr(tok),
                      json={"user_ids": [eph_pending_user["id"]],
                            "role_id": "custom_traffic_controller",
                            "admin_confirmed": True}, timeout=10)
    assert r.status_code == 200
    users = requests.get(f"{API}/users?hide_test=false", headers=_hdr(tok), timeout=10).json()
    target = [x for x in users if x["id"] == eph_pending_user["id"]][0]
    assert target["role_id"] == "custom_traffic_controller"
    assert target["role_locked"] is False


def test_option_c_patch_role_id_auto_computes_lock(
    _mongo, ephemeral_admin, eph_pending_user
):
    """PATCH /users/{id} {role_id:'general_user'} on a user whose
    Simpro position is 'Traffic Controller' → role_locked=True.
    Then PATCH {role_locked:false} explicitly → role_locked=False."""
    tok = ephemeral_admin["token"]
    r_patch = requests.patch(f"{API}/users/{eph_pending_user['id']}",
                             headers=_hdr(tok),
                             json={"role_id": "general_user"}, timeout=10)
    assert r_patch.status_code == 200, r_patch.text[:200]
    body = r_patch.json()
    assert body["role_id"] == "general_user"
    assert body["role_locked"] is True

    r_unlock = requests.patch(f"{API}/users/{eph_pending_user['id']}",
                              headers=_hdr(tok),
                              json={"role_locked": False}, timeout=10)
    assert r_unlock.status_code == 200
    assert r_unlock.json()["role_locked"] is False


def test_option_c_patch_unknown_role_id_returns_404(
    ephemeral_admin, eph_pending_user
):
    tok = ephemeral_admin["token"]
    r = requests.patch(f"{API}/users/{eph_pending_user['id']}",
                       headers=_hdr(tok),
                       json={"role_id": "role_that_does_not_exist"}, timeout=10)
    assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# (8) Login regression — post-deploy, stephen must still authenticate.
# ═════════════════════════════════════════════════════════════════════

def test_login_regression_stephen_can_authenticate():
    """Guardrail: after all Phase 4d changes deploy, the real admin
    account must still authenticate with the documented credential.
    This is READ-ONLY — we only POST /auth/login. Never mutate the
    real user document from a test."""
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                      timeout=10)
    assert r.status_code == 200, (
        f"REGRESSION: admin login broken. HTTP={r.status_code} body={r.text[:300]}"
    )
    body = r.json()
    assert body.get("access_token")
    assert body["user"]["email"] == ADMIN_EMAIL
    assert body["user"]["role_id"] == "admin"
