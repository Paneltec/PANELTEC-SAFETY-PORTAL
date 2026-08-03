"""v160.3.9.37 — Ticket A · Backup Dashboard clarity fix.

Covers the backend forward-compat changes to
`POST /api/backup/agent/report`:
  1. New optional `nas_disk_usage` field on the AgentReport payload
     (same shape as `disk_usage`: `{total, used, free}` in bytes).
  2. When present AND the report carries a `destination_id`, the
     value is stashed on the destination doc as `nas_disk_usage`
     + `nas_disk_usage_at`.
  3. `/api/backup/lan-status` now surfaces the enabled destinations
     list, and `nas_disk_usage` rides along on each entry.
  4. Legacy `disk_usage` handling (agent-local filesystem) is
     unchanged — it still lands on `bk_agents.disk_usage`.

Guardrails:
  * Zero mutation of real agents / destinations. All fixtures use
    UUID-suffixed ids and are torn down in `finally:` blocks.
  * `stephen@paneltec.com.au` is not touched.
"""
from __future__ import annotations

import uuid
import requests
import pytest

from .conftest import API, run_async  # noqa: F401


def _agent_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture
def eph_agent_and_dest(_mongo):
    """Insert one ephemeral backup agent + one ephemeral SMB
    destination. Yields ids + the agent's raw token. Deletes both
    on teardown."""
    import hashlib
    tok = f"v37tok-{uuid.uuid4().hex}"
    tok_hash = hashlib.sha256(tok.encode()).hexdigest()
    agent_id = str(uuid.uuid4())
    dest_id  = str(uuid.uuid4())
    _mongo.bk_agents.insert_one({
        "id": agent_id,
        "name": f"__v37_agent_{uuid.uuid4().hex[:6]}",
        "token_hash": tok_hash,
        "created_at": "2026-08-03T00:00:00+00:00",
        "first_seen_at": "2026-08-03T00:00:00+00:00",
        "last_seen_at":  "2026-08-03T00:00:00+00:00",
    })
    _mongo.bk_destinations.insert_one({
        "id": dest_id,
        "name": f"__v37_dest_{uuid.uuid4().hex[:6]}",
        "kind": "smb_lan",
        "host": "10.255.255.254",   # RFC5737-ish, unreachable — safe fake
        "share": "PytestBackups",
        "path_prefix": "/v37",
        "username": "",
        "password_set": False,
        "enabled": True,
        "created_at": "2026-08-03T00:00:00+00:00",
    })
    yield {"agent_id": agent_id, "dest_id": dest_id, "token": tok}
    _mongo.bk_agents.delete_one({"id": agent_id})
    _mongo.bk_destinations.delete_one({"id": dest_id})
    _mongo.bk_agent_logs.delete_many({"agent_id": agent_id})


def test_agent_report_accepts_nas_disk_usage_and_stashes_on_destination(
        eph_agent_and_dest, _mongo):
    """The v37 forward-compat: agent POSTs `nas_disk_usage` alongside
    the usual heartbeat; the Hub records it on the DESTINATION doc,
    not the agent (single agent → many destinations)."""
    payload = {
        "status": "ok",
        "destination_id": eph_agent_and_dest["dest_id"],
        "snapshot_id": "none",
        "bytes_written": None,
        # Agent's own filesystem (unchanged behaviour):
        "disk_usage": {"total": 100_000_000_000, "used": 20_000_000_000,
                       "free":  80_000_000_000},
        # NEW: NAS tower's filesystem, opt-in.
        "nas_disk_usage": {"total": 4_000_000_000_000,
                           "used":  1_500_000_000_000,
                           "free":  2_500_000_000_000},
    }
    r = requests.post(
        f"{API}/backup/agent/report",
        json=payload,
        headers=_agent_headers(eph_agent_and_dest["token"]),
        timeout=10,
    )
    assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
    assert r.json() == {"ok": True}
    # Assert the destination doc now carries the NAS payload.
    d = _mongo.bk_destinations.find_one(
        {"id": eph_agent_and_dest["dest_id"]},
        {"_id": 0, "nas_disk_usage": 1, "nas_disk_usage_at": 1},
    )
    assert d["nas_disk_usage"] == payload["nas_disk_usage"], (
        f"destination nas_disk_usage drifted: {d}")
    assert d["nas_disk_usage_at"] is not None
    # And the agent's own disk_usage still lives on the AGENT doc.
    a = _mongo.bk_agents.find_one(
        {"id": eph_agent_and_dest["agent_id"]},
        {"_id": 0, "disk_usage": 1},
    )
    assert a["disk_usage"] == payload["disk_usage"]


def test_agent_report_without_nas_disk_usage_leaves_destination_untouched(
        eph_agent_and_dest, _mongo):
    """Absent `nas_disk_usage` must NOT clear any existing destination
    payload — the FE relies on latest-wins semantics."""
    dest_id = eph_agent_and_dest["dest_id"]
    # Seed a stored value so we can prove it's preserved.
    _mongo.bk_destinations.update_one(
        {"id": dest_id},
        {"$set": {"nas_disk_usage": {"total": 1, "used": 1, "free": 0},
                  "nas_disk_usage_at": "2026-08-03T00:00:00+00:00"}},
    )
    payload = {
        "status": "ok",
        "destination_id": dest_id,
        "snapshot_id": "none",
        "disk_usage": {"total": 100, "used": 10, "free": 90},
        # nas_disk_usage intentionally absent
    }
    r = requests.post(
        f"{API}/backup/agent/report",
        json=payload,
        headers=_agent_headers(eph_agent_and_dest["token"]),
        timeout=10,
    )
    assert r.status_code == 200
    d = _mongo.bk_destinations.find_one(
        {"id": dest_id}, {"_id": 0, "nas_disk_usage": 1},
    )
    assert d["nas_disk_usage"] == {"total": 1, "used": 1, "free": 0}, (
        "absent nas_disk_usage in report must NOT clear the destination doc")


def test_lan_status_surfaces_destinations_and_nas_disk_usage(
        eph_agent_and_dest, _mongo):
    """`/api/backup/lan-status` must include the destinations list
    with the freshly-posted `nas_disk_usage` so the FE can render
    the second gauge."""
    # Post a report so the destination gets populated.
    payload = {
        "status": "ok",
        "destination_id": eph_agent_and_dest["dest_id"],
        "snapshot_id": "none",
        "nas_disk_usage": {"total": 999, "used": 111, "free": 888},
    }
    r = requests.post(
        f"{API}/backup/agent/report",
        json=payload,
        headers=_agent_headers(eph_agent_and_dest["token"]),
        timeout=10,
    )
    assert r.status_code == 200

    # Now fetch lan-status as admin.
    login = requests.post(
        f"{API}/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=10,
    )
    if login.status_code != 200:
        pytest.skip(f"admin login unavailable in this env: {login.status_code}")
    tok = login.json().get("access_token") or login.json().get("token")

    r = requests.get(
        f"{API}/backup/lan-status",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=10,
    )
    assert r.status_code == 200
    body = r.json()
    assert "destinations" in body, "lan-status must include destinations key"
    # Find our ephemeral destination — the response returns ALL enabled
    # destinations, not just ours.
    match = next(
        (d for d in body["destinations"]
         if d.get("id") == eph_agent_and_dest["dest_id"]),
        None,
    )
    assert match is not None, (
        f"ephemeral destination missing from response: "
        f"ids={[d.get('id') for d in body['destinations']]}")
    assert match.get("nas_disk_usage") == {"total": 999, "used": 111,
                                            "free": 888}
