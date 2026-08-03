"""v160.3.9.35 (Phase 6) — token unification proof.

`_role_default()` is now DB-first for every role: it reads
`roles.permission_tokens[]` from Mongo keyed on the caller's
`role_id` (or legacy `role` string) and only falls back to the
hardcoded `ROLE_DEFAULTS` map when the DB has NO active doc for
that role_id. This test suite proves:

  Case 1  DB token exists         → DB wins over hardcoded map.
  Case 2  No active DB doc        → hardcoded ROLE_DEFAULTS fallback.
  Case 3  Custom role in DB       → still resolved from DB
                                     (regression check for the v4d
                                     Option-1 fallback path).
  Case 4  Doc exists, empty tokens → returns False for all actions
                                     (empty is an explicit admin
                                     choice, NOT a fallback trigger).
  Case 5  `effective_for()` full matrix → identical DB-first semantics.

Guardrails:
  * Zero mutation of production `users`, prod-role docs, or any
    `roles` doc whose `role_id` matches a real seeded/custom role.
  * All DB writes are to ephemeral role_ids stamped with a UUID.
  * `_bust_role_cache()` is called between phases so the module-
    level token cache never carries state across cases.
"""
from __future__ import annotations

import uuid
import pytest

# v160.3.9.36 — Share the session-scope event loop with the rest of
# the test suite (defined in `tests/conftest.py::_ASYNC_LOOP`) so
# Motor stays bound to a single loop across every test module.
from .conftest import run_async as _run


# Import lazily so pytest collection doesn't trigger the auth chain.
def _perm():
    import permissions as p
    return p


# ─── Case 1: DB token wins over hardcoded ────────────────────────────

def test_case1_db_token_overrides_hardcoded_fallback(_mongo):
    """When an active role doc exists in `roles` for the caller's
    role_id, its `permission_tokens[]` set is authoritative — even
    if a same-named entry sits in `ROLE_DEFAULTS`."""
    p = _perm()
    p._bust_role_cache()

    # Ephemeral role_id — cannot collide with any seeded/custom role.
    role_id = f"v35_case1_{uuid.uuid4().hex[:10]}"
    _mongo.roles.insert_one({
        "role_id": role_id,
        "label": "Phase-6 Case 1",
        "source": "admin_created",
        "is_active": True,
        "permission_tokens": ["workers.view"],
        "created_at": "2026-08-03T00:00:00+00:00",
        "created_by": "pytest-v35",
    })
    try:
        user = {"id": f"pytest-v35-{uuid.uuid4()}", "role": role_id, "role_id": role_id}
        # DB says only workers.view is granted.
        assert _run(p._role_default(user, "workers", "view")) is True
        # And explicitly NOT granted for other actions/resources on this role.
        assert _run(p._role_default(user, "workers", "edit")) is False
        assert _run(p._role_default(user, "swms",    "view")) is False
    finally:
        _mongo.roles.delete_one({"role_id": role_id})
        p._bust_role_cache()


# ─── Case 2: Fallback to hardcoded ROLE_DEFAULTS ─────────────────────

def test_case2_missing_db_doc_falls_back_to_hardcoded():
    """`worker` is in the hardcoded `ROLE_DEFAULTS` map but has no
    active doc in the seeded `roles` collection (verified by inspection
    at test-write time). `_role_default()` must therefore resolve
    against the hardcoded map for a user with role='worker'."""
    p = _perm()
    p._bust_role_cache()

    # ROLE_DEFAULTS["worker"]["swms"]["view"] is True (v25 shape).
    assert p.ROLE_DEFAULTS["worker"]["swms"]["view"] is True
    # And ROLE_DEFAULTS["worker"] does NOT contain the 'sites' resource,
    # so the fallback returns False.
    assert "sites" not in p.ROLE_DEFAULTS["worker"]

    user = {"id": f"pytest-v35-{uuid.uuid4()}", "role": "worker", "role_id": "worker"}
    # DB has no doc → hardcoded fallback answers.
    assert _run(p._role_default(user, "swms",  "view")) is True
    assert _run(p._role_default(user, "sites", "view")) is False


# ─── Case 3: Custom role still resolved from DB (regression) ─────────

def test_case3_custom_role_still_db_resolved(_mongo):
    """The v4d Option-1 semantics for custom_* roles must be preserved
    by the new unified path."""
    p = _perm()
    p._bust_role_cache()

    role_id = f"custom_v35_traffic_{uuid.uuid4().hex[:8]}"
    _mongo.roles.insert_one({
        "role_id": role_id,
        "label": "Phase-6 Case 3 · traffic controller",
        "source": "simpro_position_auto",
        "is_active": True,
        "permission_tokens": ["swms.view", "hazards.view", "hazards.edit"],
        "created_at": "2026-08-03T00:00:00+00:00",
        "created_by": "pytest-v35",
    })
    try:
        user = {"id": f"pytest-v35-{uuid.uuid4()}",
                "role": role_id, "role_id": role_id}
        assert _run(p._role_default(user, "swms",     "view")) is True
        assert _run(p._role_default(user, "hazards",  "edit")) is True
        assert _run(p._role_default(user, "workers",  "view")) is False
    finally:
        _mongo.roles.delete_one({"role_id": role_id})
        p._bust_role_cache()


# ─── Case 4: Empty DB tokens is an explicit choice, not fallback ────

def test_case4_empty_db_tokens_is_respected_not_fallback(_mongo):
    """If an admin edits a role in the Roles Matrix UI down to zero
    permissions, the resulting `permission_tokens: []` must be
    honoured — we must NOT silently fall back to the hardcoded map."""
    p = _perm()
    p._bust_role_cache()

    role_id = f"v35_case4_empty_{uuid.uuid4().hex[:10]}"
    _mongo.roles.insert_one({
        "role_id": role_id,
        "label": "Phase-6 Case 4 · empty",
        "source": "admin_created",
        "is_active": True,
        "permission_tokens": [],
        "created_at": "2026-08-03T00:00:00+00:00",
        "created_by": "pytest-v35",
    })
    try:
        user = {"id": f"pytest-v35-{uuid.uuid4()}", "role": role_id, "role_id": role_id}
        # Even for a resource/action that IS in ROLE_DEFAULTS["admin"],
        # empty DB tokens must yield False (no fallback).
        assert _run(p._role_default(user, "swms",    "view")) is False
        assert _run(p._role_default(user, "workers", "edit")) is False
    finally:
        _mongo.roles.delete_one({"role_id": role_id})
        p._bust_role_cache()


# ─── Case 5: effective_for() honours the same DB-first semantics ────

def test_case5_effective_for_uses_db_first(_mongo):
    """`effective_for()` builds the full matrix. Same rules apply:
    DB tokens win, hardcoded ROLE_DEFAULTS only if the doc is missing."""
    p = _perm()
    p._bust_role_cache()

    role_id = f"v35_case5_{uuid.uuid4().hex[:10]}"
    _mongo.roles.insert_one({
        "role_id": role_id,
        "label": "Phase-6 Case 5",
        "source": "admin_created",
        "is_active": True,
        "permission_tokens": ["swms.view", "swms.edit"],
        "created_at": "2026-08-03T00:00:00+00:00",
        "created_by": "pytest-v35",
    })
    try:
        user = {"id": f"pytest-v35-{uuid.uuid4()}", "role": role_id, "role_id": role_id}
        matrix = _run(p.effective_for(user))
        # DB-granted:
        assert matrix["swms"]["view"] is True
        assert matrix["swms"]["edit"] is True
        # Not in DB tokens → False, even though hardcoded 'admin' has it.
        assert matrix["swms"]["delete"] is False
        assert matrix["workers"]["edit"] is False
    finally:
        _mongo.roles.delete_one({"role_id": role_id})
        p._bust_role_cache()


# ─── Case 6: _role_tokens returns None for missing, set() for empty ──

def test_case6_role_tokens_sentinel_semantics(_mongo):
    """Interface contract for `_role_tokens()`:
      * `None`  = no active DB doc (signal to fall back)
      * `set()` = doc exists, tokens are empty (respect, don't fall back)
      * `set(x)`= populated tokens
    """
    p = _perm()
    p._bust_role_cache()

    missing_id = f"v35_case6_missing_{uuid.uuid4().hex[:10]}"
    # No insert → tokens should be None.
    assert _run(p._role_tokens(missing_id)) is None

    empty_id = f"v35_case6_empty_{uuid.uuid4().hex[:10]}"
    _mongo.roles.insert_one({
        "role_id": empty_id, "label": "empty", "source": "admin_created",
        "is_active": True, "permission_tokens": [],
        "created_at": "2026-08-03T00:00:00+00:00", "created_by": "pytest-v35",
    })
    pop_id = f"v35_case6_populated_{uuid.uuid4().hex[:10]}"
    _mongo.roles.insert_one({
        "role_id": pop_id, "label": "populated", "source": "admin_created",
        "is_active": True, "permission_tokens": ["hazards.view"],
        "created_at": "2026-08-03T00:00:00+00:00", "created_by": "pytest-v35",
    })
    try:
        empty_tokens = _run(p._role_tokens(empty_id))
        pop_tokens   = _run(p._role_tokens(pop_id))
        assert empty_tokens == set()
        assert empty_tokens is not None       # NOT the fallback sentinel
        assert pop_tokens == {"hazards.view"}
    finally:
        _mongo.roles.delete_many({"role_id": {"$in": [empty_id, pop_id]}})
        p._bust_role_cache()
