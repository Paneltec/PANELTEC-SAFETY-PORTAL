"""v58.13.132n3 — SWMS visibility filter — asset_kinds branch (branch 6).

Adds the branch that pre-`.132n3` was missing: a worker whose
assigned assets have a `kind` (plant / trailer / vehicle) can see
SWMS tagged `applies_to.asset_kinds` matching that kind.

Live data (Paneltec Pty Ltd) has exactly one SWMS with an
`asset_kinds` tag today — "Concrete or Asphalt Cutting" with
`applies_to.asset_kinds: ['plant']`. Pre-`.132n3` plant operators
were silently missing that SWMS.

Test approach:
    · Sandbox everything in a throwaway `test-org-<uuid>` — never
      touches Paneltec data.
    · Uses the existing `_mongo` sync fixture from conftest.py to
      seed rows.
    · Calls the async `swms_visibility_filter` via `run_async`.
    · The `production_db_guard` fixture from conftest.py blocks
      any accidental writes to `*@paneltec.com.au` accounts.
"""
from __future__ import annotations

import uuid

import pytest

from tests.conftest import run_async

# Module-scoped opt-in: this file inserts test-org-prefixed sandbox
# rows into `assets`, `workers`, and `swms` and cleans them up in
# the fixture teardown. The `production_db_guard` in conftest.py
# blocks any accidental writes to real Paneltec accounts, and the
# sandbox teardown deletes every row it created.
pytestmark = pytest.mark.live_db_writes


@pytest.fixture
def sandbox(_mongo):
    """Isolated org + 2 assets (plant + vehicle). Cleaned on exit."""
    db = _mongo  # conftest returns a `Database`, not a `MongoClient`.
    org_id = f"test-org-{uuid.uuid4()}"
    user_id = f"test-user-{uuid.uuid4()}"
    plant_asset_id = f"asset-{uuid.uuid4()}"
    vehicle_asset_id = f"asset-{uuid.uuid4()}"

    db.assets.insert_many([
        {"id": plant_asset_id,   "org_id": org_id, "kind": "plant",
         "name": "Excavator X", "scan_token": f"tst-{uuid.uuid4()}"},
        {"id": vehicle_asset_id, "org_id": org_id, "kind": "vehicle",
         "name": "Ute Y",       "scan_token": f"tst-{uuid.uuid4()}"},
    ])
    ctx = {
        "org_id": org_id, "user_id": user_id,
        "plant_asset_id": plant_asset_id,
        "vehicle_asset_id": vehicle_asset_id,
        "db": db,
    }
    yield ctx
    # Teardown.
    db.assets.delete_many({"org_id": org_id})
    db.workers.delete_many({"org_id": org_id})
    db.swms.delete_many({"org_id": org_id})


def _make_worker(sandbox, *, asset_ids: list[str]) -> dict:
    db = sandbox["db"]
    db.workers.insert_one({
        "id":         f"worker-{uuid.uuid4()}",
        "user_id":    sandbox["user_id"],
        "org_id":     sandbox["org_id"],
        "assigned_asset_ids":      asset_ids,
        "assigned_asset_type_ids": [],
        "simpro_company_id":       None,
        "deleted_at":              None,
    })
    return {
        "id":      sandbox["user_id"],
        "org_id":  sandbox["org_id"],
        "role":    "worker",
        "role_id": "worker",
    }


def _make_plant_swms(sandbox, *, extra_applies_to: dict | None = None) -> str:
    db = sandbox["db"]
    swms_id = f"swms-{uuid.uuid4()}"
    applies_to = {
        "roles": [], "worker_ids": [], "company_ids": [],
        "asset_types": [], "asset_kinds": ["plant"],
    }
    if extra_applies_to:
        applies_to.update(extra_applies_to)
    db.swms.insert_one({
        "id":         swms_id,
        "org_id":     sandbox["org_id"],
        "title":      "Test plant SWMS",
        "code":       "TEST-PLANT",
        "status":     "active",
        "deleted_at": None,
        "applies_to": applies_to,
    })
    return swms_id


def _matched_ids(sandbox, user: dict) -> list[str]:
    """Compose `q = {org_id, deleted_at, **filter}` the same way
    `crud._list_impl` does and return matched SWMS ids. Isolates
    the visibility branch contract from the whole CRUD stack."""
    from permissions_scope import swms_visibility_filter
    f = run_async(swms_visibility_filter(user))
    q = {"org_id": user["org_id"], "deleted_at": None, **f}
    return [r["id"] for r in sandbox["db"].swms.find(q, {"_id": 0, "id": 1})]


# ── Test 1 — plant worker sees plant SWMS via branch 6 ────
def test_plant_worker_sees_plant_swms(sandbox):
    user = _make_worker(sandbox, asset_ids=[sandbox["plant_asset_id"]])
    swms_id = _make_plant_swms(sandbox)

    visible = _matched_ids(sandbox, user)
    assert swms_id in visible, "plant worker should see the plant-tagged SWMS"


# ── Test 2 — vehicle-only worker does NOT see plant SWMS ──
def test_vehicle_only_worker_does_not_see_plant_swms(sandbox):
    user = _make_worker(sandbox, asset_ids=[sandbox["vehicle_asset_id"]])
    swms_id = _make_plant_swms(sandbox)

    visible = _matched_ids(sandbox, user)
    assert swms_id not in visible, (
        "vehicle-only worker should NOT match the plant SWMS via branch 6"
    )


# ── Test 3 — worker with no worker row → no branch 6 ─────
def test_no_worker_row_no_branch_6(sandbox):
    user = {
        "id":      sandbox["user_id"],
        "org_id":  sandbox["org_id"],
        "role":    "worker",
        "role_id": "worker",
    }
    # Do NOT insert a worker row. SWMS also has NO other matcher
    # facets — just asset_kinds. Branch 1 (legacy-null) doesn't
    # fire because applies_to isn't null/{}. Roles branch doesn't
    # fire because roles list is empty on the SWMS.
    swms_id = _make_plant_swms(sandbox)
    visible = _matched_ids(sandbox, user)
    assert swms_id not in visible, (
        "user with no worker row should not match via branch 6 even for a "
        "plant-tagged SWMS"
    )


# ── Test 4 — role match still works via branch 2 ─────────
def test_role_branch_still_matches(sandbox):
    user = _make_worker(sandbox, asset_ids=[sandbox["vehicle_asset_id"]])
    swms_id = _make_plant_swms(sandbox, extra_applies_to={"roles": ["worker"]})
    visible = _matched_ids(sandbox, user)
    assert swms_id in visible, "role match should override missing branch-6 match"


# ── Test 5 — empty `asset_kinds` list doesn't match ──────
def test_empty_asset_kinds_does_not_match(sandbox):
    """Applies-to present but every array empty. Branch 1 doesn't
    fire (applies_to isn't null/{}), branches 2-6 all have empty
    candidate sets → no match. This is the exact case the
    `.132n3` audit widget surfaces to admins as `count_effectively_null`."""
    user = _make_worker(sandbox, asset_ids=[sandbox["plant_asset_id"]])
    db = sandbox["db"]
    swms_id = f"swms-{uuid.uuid4()}"
    db.swms.insert_one({
        "id":         swms_id,
        "org_id":     sandbox["org_id"],
        "title":      "Empty applies_to arrays SWMS",
        "code":       "TEST-EMPTY",
        "status":     "active",
        "deleted_at": None,
        "applies_to": {
            "roles": [], "worker_ids": [], "company_ids": [],
            "asset_types": [], "asset_kinds": [],
        },
    })
    visible = _matched_ids(sandbox, user)
    assert swms_id not in visible


# ── Test 6 — asset_kinds branch appears in the returned filter ──
def test_filter_includes_asset_kinds_branch_for_plant_worker(sandbox):
    """Structural check on the returned Mongo filter — makes any
    future refactor that accidentally drops the branch fail loudly."""
    from permissions_scope import swms_visibility_filter
    user = _make_worker(sandbox, asset_ids=[sandbox["plant_asset_id"]])
    f = run_async(swms_visibility_filter(user))
    branches = f.get("$or", [])
    match = any(
        isinstance(b, dict)
        and b.get("applies_to.asset_kinds", {}).get("$in") == ["plant"]
        for b in branches
    )
    assert match, (
        "expected an `applies_to.asset_kinds: {$in: ['plant']}` branch "
        "in the returned filter — got: " + str(branches)
    )


# ── Test 7 — no plant assets → branch is omitted entirely ──
def test_filter_omits_asset_kinds_branch_when_no_kinds(sandbox):
    """Worker with no assigned assets must NOT get an
    `asset_kinds: {$in: []}` branch — that would match nothing
    but hurt performance and clutter the filter."""
    from permissions_scope import swms_visibility_filter
    user = _make_worker(sandbox, asset_ids=[])
    f = run_async(swms_visibility_filter(user))
    branches = f.get("$or", [])
    has_ak = any(
        isinstance(b, dict) and "applies_to.asset_kinds" in b
        for b in branches
    )
    assert not has_ak, (
        "no assets → no asset_kinds branch expected. Got: " + str(branches)
    )


# ── Test 8 — non-regression: existing role branch still works ──
def test_no_branch_6_regression_on_role_only_swms(sandbox):
    """Ensures the new branch doesn't accidentally break the existing
    role-based visibility for SWMS with no asset_kinds tag."""
    user = _make_worker(sandbox, asset_ids=[sandbox["plant_asset_id"]])
    db = sandbox["db"]
    swms_id = f"swms-{uuid.uuid4()}"
    db.swms.insert_one({
        "id":         swms_id,
        "org_id":     sandbox["org_id"],
        "title":      "Role-scoped SWMS (no asset_kinds)",
        "code":       "TEST-ROLE",
        "status":     "active",
        "deleted_at": None,
        "applies_to": {
            "roles": ["worker"], "worker_ids": [], "company_ids": [],
            "asset_types": [], "asset_kinds": [],
        },
    })
    visible = _matched_ids(sandbox, user)
    assert swms_id in visible, "role branch must still match"
