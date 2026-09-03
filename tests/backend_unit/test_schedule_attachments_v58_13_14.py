"""v58.13.14 — Schedule attachments integration tests.

Uses `requests` against the LIVE local backend
(`http://localhost:8001`) — a schema-only pytest would not prove the
endpoint is actually mounted + returning the expected shape. Each
test operates on a per-run scratch asset + schedule created in
`setUp` and torn down in `tearDown` so no permanent DB state changes.

Location: `/app/tests/backend_unit/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule. Adding this file does
NOT trigger a uvicorn reload (asset_service.py edits in the same
ship do — that's expected).
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import pytest
import requests

API = "http://localhost:8001/api"
ADMIN_EMAIL = os.environ.get("PANELTEC_TEST_ADMIN_EMAIL", "stephen@paneltec.com.au")
ADMIN_PASS = os.environ.get("PANELTEC_TEST_ADMIN_PASS", "Mcgstephen50#")
SCHEDULE_STORAGE_ROOT = Path("/app/backend/uploads/schedule_attachments")

# ─── Auth + scratch-record fixtures ────────────────────────────────────


def _token() -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _authed(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def token() -> str:
    return _token()


@pytest.fixture
def scratch_schedule(token) -> dict[str, Any]:
    """Creates a scratch asset + schedule and cleans both up. Yields
    a dict with the asset_id + schedule_id so tests can hit the
    attachments endpoints without polluting the tenant's real
    records. All records are hard-deleted (via API soft-delete + a
    scratch marker in the `name` field) at teardown."""
    hdr = _authed(token)
    stamp = int(time.time() * 1000)
    # Scratch asset — full ownership by the test tenant.
    asset_r = requests.post(
        f"{API}/assets",
        json={
            "name": f"TEST-v58.13.14-{stamp}",
            "asset_number": f"TEST-v58.13.14-{stamp}",
            "description": f"v58.13.14 scratch asset {stamp}",
            "asset_type": "Vehicle",
        },
        headers=hdr, timeout=10,
    )
    assert asset_r.status_code in (200, 201), f"asset create failed: {asset_r.status_code} {asset_r.text[:200]}"
    asset_id = asset_r.json()["id"]
    # Scratch schedule on the asset.
    sched_r = requests.post(
        f"{API}/assets/{asset_id}/schedules",
        json={
            "name": f"v58.13.14 scratch schedule {stamp}",
            "interval_kind": "calendar",
            "interval_value": 7,
            "calendar_unit": "days",
        },
        headers=hdr, timeout=10,
    )
    assert sched_r.status_code in (200, 201), f"schedule create failed: {sched_r.status_code} {sched_r.text[:200]}"
    sid = sched_r.json()["id"]
    yield {"asset_id": asset_id, "sid": sid, "hdr": hdr}
    # Teardown.
    requests.delete(f"{API}/assets/{asset_id}/schedules/{sid}", headers=hdr, timeout=10)
    requests.delete(f"{API}/assets/{asset_id}", headers=hdr, timeout=10)


# ─── Tests ─────────────────────────────────────────────────────────────


def _post_attachment(scratch, filename: str, content: bytes,
                     mime: str = "text/plain") -> dict[str, Any]:
    r = requests.post(
        f"{API}/assets/{scratch['asset_id']}/schedules/{scratch['sid']}/attachments",
        headers=scratch["hdr"],
        files=[("files", (filename, content, mime))],
        data=[("names", filename), ("descriptions", "smoke")],
        timeout=15,
    )
    assert r.status_code == 201, f"upload failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    assert "attachments" in body and len(body["attachments"]) == 1
    return body["attachments"][0]


def test_post_attachment_returns_201_with_record_shape(scratch_schedule):
    rec = _post_attachment(scratch_schedule, "hello.txt", b"hello world")
    for k in ("file_id", "stored_name", "name", "description", "mime",
              "size", "url", "uploaded_by", "uploaded_at"):
        assert k in rec, f"attachment record missing key {k!r}"
    assert rec["name"] == "hello.txt"
    assert rec["mime"] == "text/plain"
    assert rec["size"] == len(b"hello world")
    disk = SCHEDULE_STORAGE_ROOT / scratch_schedule["sid"] / rec["stored_name"]
    assert disk.exists(), f"on-disk blob missing at {disk}"
    assert disk.read_bytes() == b"hello world"


def test_get_attachment_returns_bytes(scratch_schedule):
    payload = b"contents-of-file-42\n"
    rec = _post_attachment(scratch_schedule, "f42.txt", payload)
    r = requests.get(
        f"{API}/assets/{scratch_schedule['asset_id']}"
        f"/schedules/{scratch_schedule['sid']}/attachments/{rec['stored_name']}",
        headers=scratch_schedule["hdr"], timeout=10,
    )
    assert r.status_code == 200, f"GET failed: {r.status_code}"
    assert r.content == payload


def test_delete_attachment_removes_row_and_disk_blob(scratch_schedule):
    rec = _post_attachment(scratch_schedule, "gone.txt", b"tombstone-me")
    disk = SCHEDULE_STORAGE_ROOT / scratch_schedule["sid"] / rec["stored_name"]
    assert disk.exists()  # sanity
    d = requests.delete(
        f"{API}/assets/{scratch_schedule['asset_id']}"
        f"/schedules/{scratch_schedule['sid']}/attachments/{rec['stored_name']}",
        headers=scratch_schedule["hdr"], timeout=10,
    )
    assert d.status_code == 204, f"DELETE failed: {d.status_code} {d.text[:200]}"
    # Blob must be HARD-deleted, not just soft-flagged. Repeated
    # GET must 404.
    assert not disk.exists(), "blob still on disk after DELETE"
    g = requests.get(
        f"{API}/assets/{scratch_schedule['asset_id']}"
        f"/schedules/{scratch_schedule['sid']}/attachments/{rec['stored_name']}",
        headers=scratch_schedule["hdr"], timeout=10,
    )
    assert g.status_code == 404


def test_delete_is_idempotent(scratch_schedule):
    rec = _post_attachment(scratch_schedule, "twice.txt", b"once")
    hdr = scratch_schedule["hdr"]
    url = (f"{API}/assets/{scratch_schedule['asset_id']}"
           f"/schedules/{scratch_schedule['sid']}/attachments/{rec['stored_name']}")
    r1 = requests.delete(url, headers=hdr, timeout=10)
    r2 = requests.delete(url, headers=hdr, timeout=10)
    assert r1.status_code == 204
    # Second delete: 204 (row already gone, $pull is a no-op) — no
    # 500 from re-unlinking a missing file.
    assert r2.status_code == 204


def test_multi_upload_then_partial_delete(scratch_schedule):
    a = _post_attachment(scratch_schedule, "a.txt", b"AAA")
    b = _post_attachment(scratch_schedule, "b.txt", b"BBB")
    c = _post_attachment(scratch_schedule, "c.txt", b"CCC")
    hdr = scratch_schedule["hdr"]
    # Delete B → A + C survive.
    dr = requests.delete(
        f"{API}/assets/{scratch_schedule['asset_id']}"
        f"/schedules/{scratch_schedule['sid']}/attachments/{b['stored_name']}",
        headers=hdr, timeout=10,
    )
    assert dr.status_code == 204
    sched = requests.get(
        f"{API}/assets/{scratch_schedule['asset_id']}"
        f"/schedules/{scratch_schedule['sid']}",
        headers=hdr, timeout=10,
    ).json()
    remaining = [x["stored_name"] for x in (sched.get("attachments") or [])]
    assert a["stored_name"] in remaining
    assert c["stored_name"] in remaining
    assert b["stored_name"] not in remaining


def test_unauthenticated_upload_rejected(scratch_schedule):
    # No Authorization header.
    r = requests.post(
        f"{API}/assets/{scratch_schedule['asset_id']}"
        f"/schedules/{scratch_schedule['sid']}/attachments",
        files=[("files", ("x.txt", b"nope", "text/plain"))],
        timeout=10,
    )
    assert r.status_code in (401, 403), \
        f"expected 401/403 for unauthenticated upload; got {r.status_code}"


def test_openapi_lists_all_three_new_paths():
    # v58.13.88 — /api/openapi.json now admin-gated (v58.13.84 B7 fix).
    # Get an admin token from the shared login endpoint before fetching.
    login = requests.post(
        f"{API}/auth/login",
        json={"email": "stephen@paneltec.com.au", "password": "Mcgstephen50#"},
        timeout=15,
    )
    assert login.status_code == 200, f"admin login failed: {login.status_code}"
    token = login.json()["access_token"]
    r = requests.get(
        f"{API}/openapi.json",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    assert r.status_code == 200
    paths = r.json()["paths"]
    # FastAPI reports the actual server-side paths, which include the
    # `/api` prefix set on `app.include_router(..., prefix="/api")`
    # in server.py. External URLs strip it via the k8s ingress, but
    # OpenAPI does not.
    p = "/api/assets/{asset_id}/schedules/{sid}/attachments"
    q = "/api/assets/{asset_id}/schedules/{sid}/attachments/{stored_name}"
    assert p in paths and "post" in paths[p], f"POST {p} missing from openapi"
    assert q in paths, f"GET/DELETE {q} missing from openapi"
    assert "get" in paths[q], "GET on stored-name path missing"
    assert "delete" in paths[q], "DELETE on stored-name path missing"
