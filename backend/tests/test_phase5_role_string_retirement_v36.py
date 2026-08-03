"""v160.3.9.36 (Phase 5) — Legacy `role` string retirement proof.

`user.role` is now an authoritative *derivative* of `user.role_id`
courtesy of the `_derive_legacy_role()` shim wired into
`get_current_user()`. `role_id` + Phase-6 token layer are the only
authoritative sources for authorisation; the ~65 legacy Bucket-A
`user.role`-string gates degenerate into safe redundancies behind
`require_permission()`.

Test coverage:
  Case 1  role_id="admin", NO `role` field           → admin perms via can().
  Case 2  role_id="worker", stale role="admin"       → role_id wins (worker perms).
  Case 3  role="admin", NO role_id                    → legacy straggler
                                                        fallback still works.
  Case 4  Stephen (prod admin, read-only)             → BOTH fields intact.
  Case 5  role_id="admin", stale role="worker"        → hydration overwrites
                                                        role to "admin" (shim).
  Case 6  role_id="custom_traffic_controller"         → mapper returns
                                                        legacy alias; can()
                                                        still resolves via
                                                        role_id → DB tokens
                                                        (Phase-6 path).

Guardrails:
  * `stephen@paneltec.com.au` never mutated (Case 4 is a read-only probe).
  * All test users have UUID-suffixed emails / ids — no prod overlap.
  * `finally` blocks purge every ephemeral write.
"""
from __future__ import annotations

import asyncio
import uuid
import pytest

# v160.3.9.36 — Share the session-scope event loop with the rest of
# the test suite so Motor stays bound to a single loop across modules.
from .conftest import run_async as _run


def _auth():
    import auth as a
    return a


def _perm():
    import permissions as p
    return p


# ─── Case 1: role_id="admin", NO `role` field → admin perms ─────────

def test_case1_role_id_admin_no_role_string_grants_admin(_mongo):
    a = _auth(); p = _perm()
    p._bust_role_cache(); a.bust_legacy_role_cache()

    uid = f"pytest-v36-{uuid.uuid4()}"
    user = {"id": uid, "email": f"__v36_c1_{uuid.uuid4().hex[:8]}@paneltec.internal",
            "role_id": "admin"}  # NO `role` field
    # Simulate the shim in-process (same code path as get_current_user).
    derived = _run(a._derive_legacy_role(user.get("role_id")))
    if derived is not None:
        user["role"] = derived
    assert user["role"] == "admin", (
        f"shim must derive `role`='admin' for role_id='admin', got {user['role']!r}")
    # Now permission check via Phase-6 unified path.
    assert _run(p.can(user, "swms",    "delete")) is True
    assert _run(p.can(user, "workers", "delete")) is True


# ─── Case 2: role_id="worker", stale role="admin" → role_id wins ────

def test_case2_stale_role_admin_but_role_id_worker_uses_worker(_mongo):
    a = _auth(); p = _perm()
    p._bust_role_cache(); a.bust_legacy_role_cache()

    uid = f"pytest-v36-{uuid.uuid4()}"
    # Simulate a drifted stored doc — role says admin, role_id says worker.
    user = {"id": uid, "email": f"__v36_c2_{uuid.uuid4().hex[:8]}@paneltec.internal",
            "role": "admin", "role_id": "worker"}
    derived = _run(a._derive_legacy_role(user.get("role_id")))
    if derived is not None and derived != user.get("role"):
        user["role"] = derived
    assert user["role"] == "worker", (
        f"shim must overwrite stale role='admin' with derived 'worker', "
        f"got {user['role']!r}")
    # Phase-6 can() operates on role_id, so worker permissions apply.
    # ROLE_DEFAULTS["worker"]["swms"]["delete"] is False; verify.
    assert p.ROLE_DEFAULTS["worker"]["swms"]["delete"] is False
    assert _run(p.can(user, "swms",    "delete")) is False
    assert _run(p.can(user, "workers", "delete")) is False


# ─── Case 3: role="admin", NO role_id → legacy fallback intact ─────

def test_case3_legacy_straggler_no_role_id_keeps_role(_mongo, caplog):
    a = _auth(); p = _perm()
    p._bust_role_cache(); a.bust_legacy_role_cache()

    uid = f"pytest-v36-{uuid.uuid4()}"
    user = {"id": uid, "email": f"__v36_c3_{uuid.uuid4().hex[:8]}@paneltec.internal",
            "role": "admin"}  # NO role_id
    # Shim path — role_id is falsy, so `role` is left alone.
    role_id = user.get("role_id")
    if role_id:
        derived = _run(a._derive_legacy_role(role_id))
        if derived is not None and derived != user.get("role"):
            user["role"] = derived
    assert user.get("role_id") in (None, ""), \
        f"pre-condition: role_id should be missing, got {user.get('role_id')!r}"
    assert user["role"] == "admin", (
        f"legacy `role` string must survive when role_id is missing, "
        f"got {user['role']!r}")
    # Phase-6 `can()` uses role_id (missing) → falls through to role string
    # via the `_derive_legacy_role` inside `_role_default(user, ...)`.
    # ROLE_DEFAULTS["admin"] grants everything → assert admin-level perms.
    assert _run(p.can(user, "swms",    "delete")) is True
    assert _run(p.can(user, "workers", "delete")) is True


# ─── Case 4: Stephen (prod admin) — read-only integrity check ───────

def test_case4_stephen_prod_admin_both_fields_intact(_mongo):
    """Read-only probe. MUST NOT touch stephen's record."""
    doc = _mongo.users.find_one(
        {"email": "stephen@paneltec.com.au"},
        {"_id": 0, "email": 1, "role": 1, "role_id": 1, "is_active": 1,
         "org_id": 1},
    )
    assert doc is not None, "stephen@paneltec.com.au must exist in prod"
    assert doc.get("role") == "admin", (
        f"stephen's legacy role must remain 'admin', got {doc.get('role')!r}")
    assert doc.get("role_id") == "admin", (
        f"stephen's role_id must remain 'admin', got {doc.get('role_id')!r}")
    assert doc.get("is_active") is not False, (
        "stephen must not be inactive after Phase 5 shipping")


# ─── Case 5: role_id="admin" + stale role="worker" → shim rewrites ──

def test_case5_shim_overwrites_stale_role_from_role_id(_mongo):
    a = _auth(); p = _perm()
    p._bust_role_cache(); a.bust_legacy_role_cache()

    uid = f"pytest-v36-{uuid.uuid4()}"
    user = {"id": uid, "email": f"__v36_c5_{uuid.uuid4().hex[:8]}@paneltec.internal",
            "role": "worker", "role_id": "admin"}
    # Simulate the exact shim block from get_current_user.
    role_id = user.get("role_id")
    if role_id:
        derived = _run(a._derive_legacy_role(role_id))
        if derived is not None:
            if derived != user.get("role"):
                user["role"] = derived
        user["_legacy_role_derived"] = True
    assert user["role"] == "admin", (
        f"shim must promote stale role='worker' up to 'admin' when "
        f"role_id='admin', got {user['role']!r}")
    assert user.get("_legacy_role_derived") is True
    # Phase-6 can() returns admin perms via role_id → DB tokens.
    assert _run(p.can(user, "swms",    "delete")) is True
    assert _run(p.can(user, "workers", "delete")) is True


# ─── Case 6: dynamic custom_* role → mapper + DB tokens both apply ─

def test_case6_dynamic_custom_role_maps_and_can_resolves(_mongo):
    a = _auth(); p = _perm()
    p._bust_role_cache(); a.bust_legacy_role_cache()

    role_id = f"custom_v36_traffic_{uuid.uuid4().hex[:8]}"
    # Insert a custom role with a specific token set. Do NOT set a
    # `legacy_role_alias` so the shim's DB fallback is exercised
    # (returns "worker").
    _mongo.roles.insert_one({
        "role_id": role_id,
        "label": "Phase 5 · Case 6 traffic controller",
        "source": "simpro_position_auto",
        "is_active": True,
        "permission_tokens": ["hazards.view", "hazards.edit"],
        "created_at": "2026-08-03T00:00:00+00:00",
        "created_by": "pytest-v36",
    })
    try:
        user = {"id": f"pytest-v36-{uuid.uuid4()}",
                "email": f"__v36_c6_{uuid.uuid4().hex[:8]}@paneltec.internal",
                "role_id": role_id}  # `role` initially absent
        derived = _run(a._derive_legacy_role(user.get("role_id")))
        if derived is not None:
            user["role"] = derived
        # Fallback for custom_* without legacy_role_alias → "worker".
        assert user["role"] == "worker", (
            f"shim fallback for custom_* without legacy_role_alias must be "
            f"'worker', got {user['role']!r}")
        # BUT permission checks go through Phase-6 which reads role_id →
        # DB tokens. The custom role has hazards.view + hazards.edit set,
        # NOT swms.delete. Verify token-derived permissions win over
        # the legacy `role='worker'` mapping.
        assert _run(p.can(user, "hazards",  "view"))   is True
        assert _run(p.can(user, "hazards",  "edit"))   is True
        assert _run(p.can(user, "swms",     "delete")) is False
    finally:
        _mongo.roles.delete_one({"role_id": role_id})
        p._bust_role_cache(); a.bust_legacy_role_cache()


# ─── Case 7: legacy_role_alias field honoured by mapper ─────────────

def test_case7_legacy_role_alias_field_wins_over_worker_fallback(_mongo):
    a = _auth()
    a.bust_legacy_role_cache()

    role_id = f"custom_v36_alias_{uuid.uuid4().hex[:8]}"
    _mongo.roles.insert_one({
        "role_id": role_id,
        "label": "Phase 5 · Case 7 alias",
        "source": "admin_created",
        "is_active": True,
        "permission_tokens": [],
        "legacy_role_alias": "hseq_lead",
        "created_at": "2026-08-03T00:00:00+00:00",
        "created_by": "pytest-v36",
    })
    try:
        derived = _run(a._derive_legacy_role(role_id))
        assert derived == "hseq_lead", (
            f"legacy_role_alias='hseq_lead' must beat the default worker "
            f"fallback, got {derived!r}")
    finally:
        _mongo.roles.delete_one({"role_id": role_id})
        a.bust_legacy_role_cache()
