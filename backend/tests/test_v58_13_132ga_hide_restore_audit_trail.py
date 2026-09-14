"""v58.13.132ga — Hide / restore audit trail.

Every hide + restore of an `org_url_tiles` row now writes an
`archive_audit` entry with action `"tile_hidden"` or
`"tile_restored"`, denormalised tile name, actor identity, and a
`pin_verified: true` marker (the 3-dots menu that hosts these
actions is admin-PIN-gated by .132g6).

Schema (matches Stephen's brief):
  action        "tile_hidden" | "tile_restored"
  tile_id       str
  tile_name     str           # denormalised label at write time
  actor_id      str           # user.id
  actor_email   str
  timestamp     iso8601 UTC
  pin_verified  True
  org_id        str           # for cross-org queries
"""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BE = APP_ROOT / "backend"
FRONTEND = APP_ROOT / "frontend"
HELPERS = BE / "archive_audit_helpers.py"
ORG_URL_TILES = BE / "org_url_tiles.py"
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login() -> dict:
    r = requests.post(f"{API}/auth/login",
                        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
                        timeout=30)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _create_tile(h: dict, suffix: str) -> str:
    r = requests.post(
        f"{API}/org/url-tiles",
        headers={**h, "Content-Type": "application/json"},
        json={
            "label": f".132ga-{suffix}",
            "url": f"https://example.com/ga/{suffix}",
            "icon": "🌐", "enabled": True,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _delete(h: dict, tid: str) -> None:
    try: requests.delete(f"{API}/org/url-tiles/{tid}", headers=h, timeout=10)
    except Exception: pass


def _audit_rows_for(tile_id: str) -> list[dict]:
    """Reach into Mongo to fetch every audit row for this tile."""
    import motor.motor_asyncio as motor
    import asyncio

    async def _fetch():
        client = motor.AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        rows = await db.archive_audit.find(
            {"resource_id": tile_id,
             "module": "org_url_tiles"},
        ).to_list(length=None)
        client.close()
        return rows
    return asyncio.get_event_loop().run_until_complete(_fetch())


# ─── Source pins ───────────────────────────────────────────────

def test_helper_has_tile_visibility_recorder():
    src = _read(HELPERS)
    assert "async def record_tile_visibility_audit(" in src
    # Correct action set.
    assert "'tile_hidden'" in src or '"tile_hidden"' in src
    assert "'tile_restored'" in src or '"tile_restored"' in src
    # Guard on invalid action.
    assert 'if action not in ("tile_hidden", "tile_restored"):' in src
    # Required fields per Stephen's brief.
    for field in (
        '"tile_id":', '"tile_name":', '"actor_id":', '"actor_email":',
        '"action":', '"timestamp":', '"pin_verified":', '"org_id":',
    ):
        assert field in src, f"helper is missing field {field}"
    # pin_verified is unconditionally true — documented as an
    # attestation, not a cryptographic proof.
    assert '"pin_verified": True' in src


def test_helper_is_best_effort_never_raises():
    """A failed audit write MUST NOT block the PATCH. Verify the
    helper wraps the insert in try/except and just logs."""
    src = _read(HELPERS)
    fn_start = src.index("async def record_tile_visibility_audit(")
    body = src[fn_start:fn_start + 2000]
    assert "try:" in body
    assert "except Exception" in body
    assert "log.warning" in body


def test_patch_handler_writes_audit_on_hidden_change():
    src = _read(ORG_URL_TILES)
    # Import is lazy (avoids a top-of-file cycle).
    assert (
        "from archive_audit_helpers import record_tile_visibility_audit"
    ) in src
    # Idempotence guard — only writes when the value actually flips.
    assert 'if "hidden" in updates:' in src
    assert "prev_hidden != new_hidden" in src
    # Both directions emit the right action.
    assert (
        '"tile_hidden" if new_hidden else "tile_restored"' in src
    )
    # Denormalises tile name so admins can read the audit without
    # a follow-up lookup.
    assert 'tile_name=doc.get("label")' in src


# ─── Behavioural: live backend ────────────────────────────────

def test_hide_writes_tile_hidden_audit_row():
    h = _login()
    tid = _create_tile(h, uuid.uuid4().hex[:8])
    try:
        rows_before = _audit_rows_for(tid)
        assert not any(r["action"] == "tile_hidden" for r in rows_before)

        pr = requests.patch(
            f"{API}/org/url-tiles/{tid}",
            headers={**h, "Content-Type": "application/json"},
            json={"hidden": True}, timeout=15,
        )
        assert pr.status_code == 200, pr.text

        rows_after = _audit_rows_for(tid)
        hides = [r for r in rows_after if r["action"] == "tile_hidden"]
        assert len(hides) == 1, (
            f"expected exactly one tile_hidden audit row; got "
            f"{len(hides)} out of {len(rows_after)} total")

        row = hides[0]
        assert row["tile_id"] == tid
        assert row["tile_name"] and row["tile_name"].startswith(".132ga-")
        assert row["actor_email"] == ADMIN_EMAIL
        assert row["actor_id"], "actor_id must not be blank"
        assert row["pin_verified"] is True
        assert "timestamp" in row and row["timestamp"]
        assert row["org_id"], "org_id must not be blank"
    finally:
        _delete(h, tid)


def test_restore_writes_tile_restored_audit_row():
    h = _login()
    tid = _create_tile(h, uuid.uuid4().hex[:8])
    try:
        # Hide → restore round-trip.
        requests.patch(f"{API}/org/url-tiles/{tid}",
                        headers={**h, "Content-Type": "application/json"},
                        json={"hidden": True},
                        timeout=15).raise_for_status()
        requests.patch(f"{API}/org/url-tiles/{tid}",
                        headers={**h, "Content-Type": "application/json"},
                        json={"hidden": False},
                        timeout=15).raise_for_status()

        rows = _audit_rows_for(tid)
        hides = [r for r in rows if r["action"] == "tile_hidden"]
        restores = [r for r in rows if r["action"] == "tile_restored"]
        assert len(hides) == 1, f"expected 1 hide row; got {len(hides)}"
        assert len(restores) == 1, f"expected 1 restore row; got {len(restores)}"
        # Restore is later than hide (timestamps monotonically increase).
        assert restores[0]["timestamp"] >= hides[0]["timestamp"]
        # Restore row has the same denorm fields.
        assert restores[0]["tile_id"] == tid
        assert restores[0]["actor_email"] == ADMIN_EMAIL
        assert restores[0]["pin_verified"] is True
    finally:
        _delete(h, tid)


def test_idempotent_patch_does_not_spam_audit():
    """PATCH {hidden:true} twice → exactly ONE audit row. The second
    call is a no-op flip and must be skipped."""
    h = _login()
    tid = _create_tile(h, uuid.uuid4().hex[:8])
    try:
        requests.patch(f"{API}/org/url-tiles/{tid}",
                        headers={**h, "Content-Type": "application/json"},
                        json={"hidden": True},
                        timeout=15).raise_for_status()
        # Same value again — must NOT emit a second row.
        requests.patch(f"{API}/org/url-tiles/{tid}",
                        headers={**h, "Content-Type": "application/json"},
                        json={"hidden": True},
                        timeout=15).raise_for_status()

        rows = _audit_rows_for(tid)
        hides = [r for r in rows if r["action"] == "tile_hidden"]
        assert len(hides) == 1, (
            "idempotent PATCH must not spam the audit log — expected "
            f"1 tile_hidden row, got {len(hides)}")
    finally:
        _delete(h, tid)


def test_non_hidden_patch_does_not_write_visibility_audit():
    """A PATCH that changes `label` but leaves `hidden` alone must
    not write a tile_hidden/tile_restored row."""
    h = _login()
    tid = _create_tile(h, uuid.uuid4().hex[:8])
    try:
        requests.patch(f"{API}/org/url-tiles/{tid}",
                        headers={**h, "Content-Type": "application/json"},
                        json={"label": f".132ga-renamed-{uuid.uuid4().hex[:6]}"},
                        timeout=15).raise_for_status()
        rows = _audit_rows_for(tid)
        vis = [r for r in rows
               if r["action"] in ("tile_hidden", "tile_restored")]
        assert vis == [], (
            "PATCH that doesn't touch `hidden` must not write a "
            f"visibility audit; got {vis}")
    finally:
        _delete(h, tid)


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132ga():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ga'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ga'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132ga'", sw)
