"""v58.13.16 — Schedule delete cascades to attachment blob rmtree.

Integration tests against the live backend. Uses the same
`scratch_schedule` pattern as v58.13.14 but adds an assertion that
the on-disk directory disappears when the schedule is soft-deleted.

Location: `/app/tests/backend_unit/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
import requests

# v58.13.125 — Env-gate: this file POSTs to the live backend and can
# leak scratch assets when a test errors. Skip unless the caller
# explicitly opts in via PANELTEC_ALLOW_LIVE_INTEGRATION=1.
if os.environ.get("PANELTEC_ALLOW_LIVE_INTEGRATION") != "1":
    pytest.skip(
        "Live-integration tests skipped. Set "
        "PANELTEC_ALLOW_LIVE_INTEGRATION=1 to run.",
        allow_module_level=True,
    )

API = "http://localhost:8001/api"
ADMIN_EMAIL = os.environ.get("PANELTEC_TEST_ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PASS = os.environ.get("PANELTEC_TEST_ADMIN_PASS", "Mcgstephen50#")
STORAGE = Path("/app/backend/uploads/schedule_attachments")


def _token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def hdr():
    return {"Authorization": f"Bearer {_token()}"}


def _mk_asset_and_sched(hdr):
    stamp = int(time.time() * 1000)
    a = requests.post(
        f"{API}/assets",
        json={"name": f"TEST-v58.13.16-{stamp}", "asset_number": f"TEST-v58.13.16-{stamp}",
              "description": "cascade delete test", "asset_type": "Vehicle"},
        headers=hdr, timeout=10,
    )
    assert a.status_code in (200, 201), a.text[:200]
    asset_id = a.json()["id"]
    s = requests.post(
        f"{API}/assets/{asset_id}/schedules",
        json={"name": f"cascade-sched-{stamp}", "interval_kind": "calendar",
              "interval_value": 7, "calendar_unit": "days"},
        headers=hdr, timeout=10,
    )
    assert s.status_code in (200, 201), s.text[:200]
    return asset_id, s.json()["id"]


def _upload(hdr, asset_id, sid, name, body=b"payload"):
    r = requests.post(
        f"{API}/assets/{asset_id}/schedules/{sid}/attachments",
        headers=hdr,
        files=[("files", (name, body, "text/plain"))],
        data=[("names", name), ("descriptions", "")],
        timeout=10,
    )
    assert r.status_code == 201, r.text[:200]
    return r.json()["attachments"][0]


# ─── Positive: cascade deletes the sid directory ──────────────────────

def test_schedule_delete_cascades_to_sid_directory(hdr):
    aid, sid = _mk_asset_and_sched(hdr)
    _upload(hdr, aid, sid, "one.txt", b"aaa")
    _upload(hdr, aid, sid, "two.txt", b"bbb")
    sid_dir = STORAGE / sid
    assert sid_dir.exists() and sum(1 for _ in sid_dir.iterdir()) == 2

    d = requests.delete(f"{API}/assets/{aid}/schedules/{sid}",
                        headers=hdr, timeout=10)
    assert d.status_code == 204, d.text[:200]
    assert not sid_dir.exists(), (
        f"sid dir {sid_dir} still exists after schedule DELETE — "
        "v58.13.16 cascade did not fire."
    )
    # Cleanup asset shell.
    requests.delete(f"{API}/assets/{aid}", headers=hdr, timeout=10)


# ─── Idempotent: second DELETE returns 404, does not crash ────────────

def test_repeat_delete_is_idempotent(hdr):
    aid, sid = _mk_asset_and_sched(hdr)
    _upload(hdr, aid, sid, "one.txt", b"x")

    d1 = requests.delete(f"{API}/assets/{aid}/schedules/{sid}",
                         headers=hdr, timeout=10)
    d2 = requests.delete(f"{API}/assets/{aid}/schedules/{sid}",
                         headers=hdr, timeout=10)
    assert d1.status_code == 204
    # Second delete finds the row already soft-deleted → 404 (not 500).
    # The rmtree half is trivially idempotent because the dir is gone.
    assert d2.status_code == 404
    assert not (STORAGE / sid).exists()
    requests.delete(f"{API}/assets/{aid}", headers=hdr, timeout=10)


# ─── Non-regression: attachment-DELETE alone does NOT remove sid dir ──

def test_attachment_delete_does_not_remove_sid_dir(hdr):
    """v58.13.14 hard-delete of a single attachment must NOT cascade
    to the whole sid directory. Only schedule DELETE cascades."""
    aid, sid = _mk_asset_and_sched(hdr)
    att = _upload(hdr, aid, sid, "solo.txt", b"y")
    sid_dir = STORAGE / sid
    assert sid_dir.exists()

    d = requests.delete(
        f"{API}/assets/{aid}/schedules/{sid}/attachments/{att['stored_name']}",
        headers=hdr, timeout=10,
    )
    assert d.status_code == 204
    # The sid dir remains (possibly empty) because the schedule is
    # still live. Cascade only fires on schedule DELETE.
    assert sid_dir.exists()
    # Teardown.
    requests.delete(f"{API}/assets/{aid}/schedules/{sid}", headers=hdr, timeout=10)
    requests.delete(f"{API}/assets/{aid}", headers=hdr, timeout=10)


# ─── Empty-schedule-delete: sid dir never created, no crash ───────────

def test_schedule_delete_with_no_attachments_no_crash(hdr):
    aid, sid = _mk_asset_and_sched(hdr)
    # No uploads → sid dir never created.
    assert not (STORAGE / sid).exists()

    d = requests.delete(f"{API}/assets/{aid}/schedules/{sid}",
                        headers=hdr, timeout=10)
    assert d.status_code == 204, d.text[:200]
    requests.delete(f"{API}/assets/{aid}", headers=hdr, timeout=10)
