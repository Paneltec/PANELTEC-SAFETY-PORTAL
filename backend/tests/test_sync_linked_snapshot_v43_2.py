"""v160.3.9.43.2 — Assert that `POST /admin/simpro/sync-linked` writes
a fresh `worker_import_snapshots` row on completion. Prior to this ship
the "Synced X ago" pill on Settings → Users read from that collection
but the handler never wrote to it — so the pill showed stale ZIP-import
timestamps (up to 22 days old) after a successful manual sync.

Ephemeral: seeds one temporary simpro integration_config + one linked
user + monkey-patches `_fetch_simpro` to avoid hitting the real Simpro
API, then cleans everything up on teardown.
Stephen (`stephen@paneltec.com.au`) is NEVER touched by this test.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

import pytest

from tests.conftest import run_async


TEST_ORG = f"test-org-v43-2-{uuid.uuid4().hex[:8]}"
TEST_USER_ID = f"test-user-{uuid.uuid4().hex[:8]}"
TEST_SIMPRO_EMPLOYEE_ID = "TEST-EMP-1077"


@pytest.fixture(scope="module")
def _seeded(_mongo):
    """Insert one ephemeral simpro config + one linked user under a
    unique org_id. Uses a unique employee id + email so nothing collides
    with the live `stephen@paneltec.com.au` document."""
    _mongo.integration_configs.insert_one({
        "id": f"ic-{uuid.uuid4().hex[:8]}",
        "org_id": TEST_ORG,
        "kind": "simpro",
        "status": "connected",
        "config": {
            "api_base_url": "https://example.invalid",
            "api_token": "TEST-TOKEN",
        },
    })
    _mongo.users.insert_one({
        "id": TEST_USER_ID,
        "org_id": TEST_ORG,
        "email": f"{TEST_USER_ID}@example.invalid",
        "name": "Ephemeral Test User",
        "role_id": "admin",
        "simpro_employee_id": TEST_SIMPRO_EMPLOYEE_ID,
        "simpro_position": "OldRole",
        "position": "OldRole",
        "activation_status": "active",
        "is_archived": False,
        "role_locked": False,
    })
    yield {"org_id": TEST_ORG, "user_id": TEST_USER_ID}
    _mongo.integration_configs.delete_many({"org_id": TEST_ORG})
    _mongo.users.delete_many({"org_id": TEST_ORG})
    _mongo.worker_import_snapshots.delete_many({"org_id": TEST_ORG})
    _mongo.user_audit.delete_many({"user_id": TEST_USER_ID})


def test_sync_linked_writes_snapshot_v43_2(_seeded, monkeypatch, _mongo):
    """Handler must insert one `worker_import_snapshots` row per invocation
    with `kind='sync_linked'` and a `run_at` that matches the row's
    natural datetime.utcnow() window."""
    import simpro_import_users as mod

    async def _fake_fetch_simpro(cfg):
        # Return one employee whose data forces a Position change so the
        # `changes` branch fires and covers the mutation code path too.
        return [
            {"ID": TEST_SIMPRO_EMPLOYEE_ID,
             "Position": "NewRole",
             "Archived": False},
        ], {}

    monkeypatch.setattr(mod, "_fetch_simpro", _fake_fetch_simpro)

    before_iso = datetime.now(timezone.utc).isoformat()

    actor = {
        "id": "test-admin-actor",
        "org_id": TEST_ORG,
        "email": "test-admin@example.invalid",
        "role_id": "admin",
    }
    result = run_async(mod.sync_linked_users(user=actor))

    # Contract: handler returns the summary shape v42.3 shipped.
    assert result["scanned"] >= 1
    assert "changed" in result

    # v43.2 CONTRACT — the snapshot row exists.
    snap = _mongo.worker_import_snapshots.find_one(
        {"org_id": TEST_ORG, "kind": "sync_linked"},
        sort=[("run_at", -1)],
    )
    assert snap is not None, (
        "sync_linked handler did not insert a worker_import_snapshots row "
        "— the Settings → Users 'Synced X ago' pill would remain stale."
    )
    assert snap["triggered_by"] == actor["id"]
    assert "counts" in snap
    assert set(snap["counts"].keys()) == {"scanned", "changed", "role_updates", "lock_drifts"}
    assert isinstance(snap.get("run_at"), str), (
        f"expected ISO string run_at, got {snap.get('run_at')!r}"
    )
    assert snap["run_at"] >= before_iso, (
        f"snapshot.run_at ({snap['run_at']}) is older than the test's "
        f"start window ({before_iso}) — the pill would read stale."
    )


def test_stephen_untouched_by_v43_2_suite(_mongo):
    """Guardrail assertion — Stephen's live document must not have been
    touched by any fixture in this module."""
    stephen = _mongo.users.find_one(
        {"email": "stephen@paneltec.com.au"},
        {"_id": 0, "email": 1, "org_id": 1},
    )
    assert stephen is not None
    assert stephen.get("org_id") != TEST_ORG, (
        "Stephen was somehow moved into the ephemeral test org — "
        "conftest.py mutation invariant violated."
    )
