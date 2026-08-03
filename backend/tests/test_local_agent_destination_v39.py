"""v160.3.9.39 — `local_agent` backup destination kind.

Coverage (5 required cases):
  1. POST /destinations with kind=local_agent creates a row that
     stores `local_path` and has NO SMB fields (host/share/username/
     password_encrypted/password/password_set).
  2. GET /agent/pending returns the local_agent destination with
     SMB fields OMITTED, plus `mode: "local"` + `local_path`.
  3. GET /agent/pending returns SMB destinations unchanged
     (mode:"smb" + decrypted password field passes through).
  4. POST /agent/report with kind=local_agent + matching target_path
     prefix + status=ok BUMPS `last_written_at`.
  5. POST /agent/report with kind=local_agent + mismatched target_path
     + status=ok does NOT bump `last_written_at`.

Also covers the 400-reject contract:
  6. POST /destinations with kind=local_agent + host/share/username
     rejected with 400.
  7. PUT /destinations/{did} with kind=local_agent + password query
     rejected with 400.

Guardrails:
  • All rows use UUID-suffixed names and are cleaned up in `finally`.
  • No production user is mutated.
  • Ephemeral agents cleaned up after each test.
"""
from __future__ import annotations

import uuid
import pytest
import requests

from .conftest import API


def _admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=10,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: HTTP {r.status_code}")
    return r.json().get("access_token") or r.json().get("token")


def _register_ephemeral_agent(tok):
    """Register an ephemeral agent; returns (agent_id, agent_token).
    Caller MUST delete the agent in a finally block."""
    r = requests.post(
        f"{API}/backup/agents/register",
        json={"name": f"__v39_agent_{uuid.uuid4().hex[:8]}"},
        headers={"Authorization": f"Bearer {tok}"}, timeout=10,
    )
    assert r.status_code == 200, f"agent register failed: {r.status_code} {r.text[:200]}"
    return r.json()["id"], r.json()["token"]


# ── Case 1 · POST /destinations creates local_agent row without SMB
def test_case1_post_local_agent_destination_no_smb_fields(_mongo):
    tok = _admin_token()
    name = f"__v39_local_{uuid.uuid4().hex[:8]}"
    body = {
        "id": str(uuid.uuid4()),
        "name": name,
        "kind": "local_agent",
        "local_path": "/data",
        "path_prefix": "/paneltec-hub",
        "enabled": False,
        "password_set": False,
        "created_at": "2026-08-03T00:00:00+00:00",
    }
    try:
        r = requests.post(
            f"{API}/backup/destinations",
            json=body,
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
        resp = r.json()
        assert resp["kind"] == "local_agent"
        assert resp["local_path"] == "/data"

        doc = _mongo.bk_destinations.find_one({"name": name}, {"_id": 0})
        assert doc is not None
        assert doc["kind"] == "local_agent"
        assert doc["local_path"] == "/data"
        for f in ("host", "share", "username", "password",
                  "password_encrypted"):
            assert not doc.get(f), (
                f"local_agent row must not carry {f!r}: got {doc.get(f)!r}")
    finally:
        _mongo.bk_destinations.delete_many({"name": name})


# ── Case 2 · GET /agent/pending omits SMB fields for local_agent
def test_case2_agent_pending_local_agent_omits_smb(_mongo):
    tok = _admin_token()
    did = str(uuid.uuid4())
    name = f"__v39_pending_local_{uuid.uuid4().hex[:8]}"
    _mongo.bk_destinations.insert_one({
        "id": did,
        "name": name,
        "kind": "local_agent",
        "local_path": "/data",
        "path_prefix": "/paneltec-hub",
        "enabled": True,
        "created_at": "2026-08-03T00:00:00+00:00",
    })
    aid, atok = _register_ephemeral_agent(tok)
    try:
        r = requests.get(
            f"{API}/backup/agent/pending",
            headers={"Authorization": f"Agent {atok}"}, timeout=10,
        )
        assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
        payload = r.json()
        dests = [d for d in payload["destinations"] if d.get("id") == did]
        assert dests, "local_agent destination missing from pending payload"
        d = dests[0]
        assert d.get("mode") == "local", f"expected mode=local, got {d.get('mode')!r}"
        assert d.get("local_path") == "/data"
        for f in ("host", "share", "username", "password",
                  "password_encrypted"):
            assert f not in d, (
                f"agent/pending must NOT expose {f!r} for local_agent: "
                f"row={d!r}")
    finally:
        _mongo.bk_destinations.delete_one({"id": did})
        _mongo.bk_agents.delete_one({"id": aid})


# ── Case 3 · GET /agent/pending SMB path unchanged
def test_case3_agent_pending_smb_still_carries_password(_mongo):
    """Regression guard: adding local_agent branch must not have
    broken the SMB code path. SMB rows should still emit
    `mode: "smb"` + a decrypted `password` field."""
    from backup_service import _FERNET, _encrypt_dest_password
    if not _FERNET:
        pytest.skip("BACKUP_DEST_ENC_KEY not configured")
    tok = _admin_token()
    did = str(uuid.uuid4())
    name = f"__v39_pending_smb_{uuid.uuid4().hex[:8]}"
    sentinel = f"__v39_smb_pw_{uuid.uuid4().hex}"
    _mongo.bk_destinations.insert_one({
        "id": did,
        "name": name,
        "kind": "smb_lan",
        "host": "10.255.255.250",
        "share": "PytestBackups",
        "path_prefix": "/v39",
        "username": "pytest",
        "password_encrypted": _encrypt_dest_password(sentinel),
        "password_set": True,
        "enabled": True,
        "created_at": "2026-08-03T00:00:00+00:00",
    })
    aid, atok = _register_ephemeral_agent(tok)
    try:
        r = requests.get(
            f"{API}/backup/agent/pending",
            headers={"Authorization": f"Agent {atok}"}, timeout=10,
        )
        assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
        payload = r.json()
        dests = [d for d in payload["destinations"] if d.get("id") == did]
        assert dests, "SMB destination missing from pending payload"
        d = dests[0]
        assert d.get("mode") == "smb", f"expected mode=smb, got {d.get('mode')!r}"
        assert d.get("host") == "10.255.255.250"
        assert d.get("share") == "PytestBackups"
        assert d.get("username") == "pytest"
        assert d.get("password") == sentinel, (
            "SMB row should carry the decrypted password field")
        assert "password_encrypted" not in d, (
            "raw ciphertext must not leak to agent contract")
    finally:
        _mongo.bk_destinations.delete_one({"id": did})
        _mongo.bk_agents.delete_one({"id": aid})


# ── Case 4 · agent/report with matching prefix bumps last_written_at
def test_case4_agent_report_local_agent_matching_path_bumps_written(_mongo):
    tok = _admin_token()
    did = str(uuid.uuid4())
    name = f"__v39_report_ok_{uuid.uuid4().hex[:8]}"
    _mongo.bk_destinations.insert_one({
        "id": did,
        "name": name,
        "kind": "local_agent",
        "local_path": "/data",
        "enabled": True,
        "created_at": "2026-08-03T00:00:00+00:00",
        # deliberately NOT setting last_written_at
    })
    aid, atok = _register_ephemeral_agent(tok)
    try:
        # Sanity: precondition
        pre = _mongo.bk_destinations.find_one({"id": did}, {"_id": 0})
        assert not pre.get("last_written_at"), "precondition"

        r = requests.post(
            f"{API}/backup/agent/report",
            json={
                "snapshot_id": str(uuid.uuid4()),
                "destination_id": did,
                "status": "ok",
                "bytes_written": 12345,
                "target_path": "/data/paneltec-hub/snapshot.zip",
            },
            headers={"Authorization": f"Agent {atok}"}, timeout=10,
        )
        assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
        post = _mongo.bk_destinations.find_one({"id": did}, {"_id": 0})
        assert post.get("last_written_at"), (
            "matching target_path should have bumped last_written_at, "
            f"got: {post!r}"
        )
    finally:
        _mongo.bk_destinations.delete_one({"id": did})
        _mongo.bk_agents.delete_one({"id": aid})


# ── Case 5 · agent/report with mismatched path does NOT bump
def test_case5_agent_report_local_agent_mismatched_path_no_bump(_mongo):
    tok = _admin_token()
    did = str(uuid.uuid4())
    name = f"__v39_report_bad_{uuid.uuid4().hex[:8]}"
    _mongo.bk_destinations.insert_one({
        "id": did,
        "name": name,
        "kind": "local_agent",
        "local_path": "/data",
        "enabled": True,
        "created_at": "2026-08-03T00:00:00+00:00",
    })
    aid, atok = _register_ephemeral_agent(tok)
    try:
        pre = _mongo.bk_destinations.find_one({"id": did}, {"_id": 0})
        assert not pre.get("last_written_at"), "precondition"

        r = requests.post(
            f"{API}/backup/agent/report",
            json={
                "snapshot_id": str(uuid.uuid4()),
                "destination_id": did,
                "status": "ok",
                "bytes_written": 12345,
                # Path outside the configured local_path
                "target_path": "/mnt/other-mount/snapshot.zip",
            },
            headers={"Authorization": f"Agent {atok}"}, timeout=10,
        )
        assert r.status_code == 200, f"HTTP={r.status_code} {r.text[:200]}"
        post = _mongo.bk_destinations.find_one({"id": did}, {"_id": 0})
        assert not post.get("last_written_at"), (
            "mismatched target_path must NOT bump last_written_at, "
            f"got: {post!r}"
        )
    finally:
        _mongo.bk_destinations.delete_one({"id": did})
        _mongo.bk_agents.delete_one({"id": aid})


# ── Case 6 · create rejects SMB fields on local_agent with 400
def test_case6_post_local_agent_rejects_smb_fields_400(_mongo):
    tok = _admin_token()
    name = f"__v39_reject_smb_{uuid.uuid4().hex[:8]}"
    body = {
        "id": str(uuid.uuid4()),
        "name": name,
        "kind": "local_agent",
        "local_path": "/data",
        # These are the forbidden fields on a local_agent row.
        "host": "192.168.15.165",
        "share": "docker",
        "username": "stephen",
        "enabled": False,
        "password_set": False,
        "created_at": "2026-08-03T00:00:00+00:00",
    }
    try:
        r = requests.post(
            f"{API}/backup/destinations",
            json=body,
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        assert r.status_code == 400, (
            f"expected 400, got HTTP={r.status_code} {r.text[:200]}")
        detail = (r.json().get("detail") or "").lower()
        assert "local_agent" in detail
        for bad in ("host", "share", "username"):
            assert bad in detail, f"400 detail should mention {bad}: {detail!r}"
        # No row should have been created.
        assert _mongo.bk_destinations.find_one({"name": name}) is None
    finally:
        _mongo.bk_destinations.delete_many({"name": name})


# ── Case 7 · PUT rejects password on local_agent with 400
def test_case7_put_local_agent_rejects_password_400(_mongo):
    tok = _admin_token()
    did = str(uuid.uuid4())
    name = f"__v39_put_reject_{uuid.uuid4().hex[:8]}"
    _mongo.bk_destinations.insert_one({
        "id": did,
        "name": name,
        "kind": "local_agent",
        "local_path": "/data",
        "enabled": False,
        "created_at": "2026-08-03T00:00:00+00:00",
    })
    try:
        body = {
            "id": did,
            "name": name,
            "kind": "local_agent",
            "local_path": "/data",
            "enabled": False,
            "password_set": False,
            "created_at": "2026-08-03T00:00:00+00:00",
        }
        r = requests.put(
            f"{API}/backup/destinations/{did}",
            params={"password": "should-be-rejected"},
            json=body,
            headers={"Authorization": f"Bearer {tok}"},
            timeout=10,
        )
        assert r.status_code == 400, (
            f"expected 400, got HTTP={r.status_code} {r.text[:200]}")
        detail = (r.json().get("detail") or "").lower()
        assert "password" in detail, (
            f"400 detail should mention 'password': {detail!r}")
        # Row should be unchanged (no password_encrypted written).
        doc = _mongo.bk_destinations.find_one({"id": did}, {"_id": 0})
        assert "password_encrypted" not in doc
    finally:
        _mongo.bk_destinations.delete_one({"id": did})
