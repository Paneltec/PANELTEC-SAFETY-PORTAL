"""v58.13.132g9 — Org-wide tile hide + restore.

Rolls up:
  · .132g7 — lockout UI countdown on `TilePinModal`.
  · .132g8 — restore action PIN-gated.
  · .132g9 — Hide is now a SERVER field (`org_url_tiles.hidden`)
    instead of per-user sessionStorage. Every user in the org sees
    the same visible/hidden set. Restore flips `hidden:false`. The
    "Show hidden tiles" toggle in each grid footer is PIN-gated
    for admins; per-tile Restore lives inside the 3-dots menu
    which is already PIN-gated by .132g6.

Backend contract:
  · PATCH /api/org/url-tiles/{id} accepts `{"hidden": bool}` (admin
    only). Persists to Mongo.
  · GET /api/org/url-tiles filters out `hidden:true` rows for every
    role by default.
  · GET /api/org/url-tiles?include_hidden=true surfaces hidden rows
    for admins only. Non-admins passing the flag get the filtered
    list back — flag is silently coerced to false.
  · Rows pre-dating .132g9 lack the `hidden` field — the read query
    treats missing = visible (`{"$or": [{"hidden": {"$ne": True}},
    {"hidden": {"$exists": False}}]}`).

Frontend contract:
  · TileCard exposes `onRestore(id)` prop; when `tile.hidden === true`
    the 3-dots menu shows "Restore" instead of "Hide".
  · AppsDirectoryModal + AppsDirectory both call
    `PATCH /org/url-tiles/{id} {hidden: true|false}` and refetch.
  · Footer "Show hidden tiles" is PIN-gated via `TilePinModal`.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = APP_ROOT / "frontend"
TILECARD = FRONTEND / "src" / "components" / "apps-directory" / "TileCard.jsx"
LAUNCHER = FRONTEND / "src" / "components" / "AppsDirectoryModal.jsx"
STANDALONE = FRONTEND / "src" / "pages" / "AppsDirectory.jsx"
ORG_URL_TILES = APP_ROOT / "backend" / "org_url_tiles.py"
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


def _create_tile(h: dict, label_suffix: str) -> str:
    r = requests.post(
        f"{API}/org/url-tiles",
        headers={**h, "Content-Type": "application/json"},
        json={
            "label": f".132g9-{label_suffix}",
            "url": f"https://example.com/g9/{label_suffix}",
            "icon": "🌐",
            "enabled": True,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _delete(h: dict, tid: str) -> None:
    try: requests.delete(f"{API}/org/url-tiles/{tid}", headers=h, timeout=10)
    except Exception: pass


# ─── Source pins ───────────────────────────────────────────────

def test_backend_patch_accepts_hidden_field():
    src = _read(ORG_URL_TILES)
    # Model field.
    assert "hidden: Optional[bool] = None" in src
    # PATCH handler branch that persists it.
    assert 'updates["hidden"] = bool(body.hidden)' in src
    # New-tile default = visible.
    assert '"hidden": bool(body.hidden) if body.hidden is not None else False' in src


def test_backend_get_filters_hidden_by_default():
    src = _read(ORG_URL_TILES)
    # Default read excludes hidden rows (and preserves pre-.132g9
    # rows without the field).
    assert (
        '{"$or": [{"hidden": {"$ne": True}}, {"hidden": {"$exists": False}}]}'
    ) in src
    # include_hidden flag exists.
    assert "include_hidden: bool = False" in src
    # Non-admin coercion — the flag is silently disabled for
    # non-admin roles so a stray query string can't leak hidden
    # tiles.
    assert "include_hidden = False" in src
    assert 'if include_hidden and role != "admin":' in src


def test_output_surfaces_hidden_boolean():
    src = _read(ORG_URL_TILES)
    # `_out()` echoes the `hidden` flag so the client can decide
    # which 3-dots action to show.
    assert '"hidden": bool(doc.get("hidden", False))' in src


def test_frontend_tilecard_swaps_hide_for_restore_when_hidden():
    src = _read(TILECARD)
    # Both the JSX branches exist behind `tile.hidden ? … : …`.
    assert "{tile.hidden ? (" in src
    assert "menu-restore-${tile.id}" in src
    assert "menu-hide-${tile.id}" in src
    # `onRestore` threaded through the props destructure.
    assert (
        "tile, isAdmin, hasAdminPin = false, onHide, onRestore, testIdPrefix,"
    ) in src


def test_frontend_grids_use_server_hide_and_pass_onRestore():
    for path in (LAUNCHER, STANDALONE):
        src = _read(path)
        # Server-backed hide handler.
        assert "await api.patch(`/org/url-tiles/${id}`, { hidden: true })" in src, (
            f"{path.name} must PATCH `hidden:true` (org-wide hide)")
        # Server-backed restore handler.
        assert "await api.patch(`/org/url-tiles/${id}`, { hidden: false })" in src, (
            f"{path.name} must PATCH `hidden:false` (org-wide restore)")
        # onRestore wired down.
        assert "onRestore={restoreTile}" in src, (
            f"{path.name} must forward restoreTile as onRestore")
        # `include_hidden=true` refetch path for the PIN-gated
        # "Show hidden" toggle.
        assert "include_hidden: 'true'" in src, (
            f"{path.name} must fetch with include_hidden=true when "
            f"admin unlocks the Show hidden toggle")


def test_frontend_show_hidden_footer_pin_gated():
    for path in (LAUNCHER, STANDALONE):
        src = _read(path)
        # Footer only renders when the user has an admin PIN.
        assert "isAdmin && hasAdminPin" in src, (
            f"{path.name} footer must gate on isAdmin && hasAdminPin")
        # PIN modal wired to the "Show hidden" flow.
        assert "setRestorePinOpen(true)" in src
        # Reveal happens only after PIN verified.
        assert "setShowHidden(true)" in src
        assert "loadTiles(true)" in src


def test_frontend_useHiddenTiles_shim_retained_no_op():
    """v58.13.132g9 kept `useHiddenTiles` as a no-op shim so any
    stray import (there shouldn't be any) doesn't break the build.
    This lock-in test prevents an accidental re-introduction of the
    old sessionStorage machinery."""
    src = _read(TILECARD)
    assert "export function useHiddenTiles(_userId)" in src
    assert "hidden: new Set()" in src
    assert "hideTile: () => {}" in src
    assert "resetHidden: () => {}" in src


def test_frontend_lockout_countdown_intact_g7():
    """v58.13.132g7 — TilePinModal renders a lockout countdown on
    429 responses. Guard against regression while the .132g9 ship
    rolls the g7/g8 fixes into the version bump."""
    src = _read(TILECARD)
    assert "const [lockedUntil, setLockedUntil]" in src
    assert "PIN locked" in src
    assert "tile-pin-locked-${tile.id}" in src
    assert "if (status === 429)" in src


# ─── Behavioural (live backend) ────────────────────────────────

def test_default_get_hides_org_wide_hidden_tile():
    h = _login()
    tid = _create_tile(h, uuid.uuid4().hex[:8])
    try:
        # Hide the tile.
        pr = requests.patch(f"{API}/org/url-tiles/{tid}",
                            headers={**h, "Content-Type": "application/json"},
                            json={"hidden": True}, timeout=15)
        assert pr.status_code == 200, pr.text
        assert pr.json()["hidden"] is True
        # Default GET must NOT list it.
        gr = requests.get(f"{API}/org/url-tiles", headers=h, timeout=15)
        assert gr.status_code == 200
        ids = [t["id"] for t in gr.json()["tiles"]]
        assert tid not in ids, (
            "default GET must filter out org-wide-hidden tiles")
    finally:
        _delete(h, tid)


def test_include_hidden_surfaces_hidden_tile_for_admin():
    h = _login()
    tid = _create_tile(h, uuid.uuid4().hex[:8])
    try:
        # Hide.
        requests.patch(f"{API}/org/url-tiles/{tid}",
                        headers={**h, "Content-Type": "application/json"},
                        json={"hidden": True}, timeout=15).raise_for_status()
        # include_hidden=true — admin sees it.
        gr = requests.get(f"{API}/org/url-tiles",
                          headers=h, params={"include_hidden": "true"},
                          timeout=15)
        assert gr.status_code == 200
        rows = {t["id"]: t for t in gr.json()["tiles"]}
        assert tid in rows, (
            "?include_hidden=true must surface org-wide-hidden tiles "
            "for admin callers")
        assert rows[tid]["hidden"] is True
    finally:
        _delete(h, tid)


def test_patch_hidden_false_restores_tile():
    h = _login()
    tid = _create_tile(h, uuid.uuid4().hex[:8])
    try:
        # Hide then restore.
        requests.patch(f"{API}/org/url-tiles/{tid}",
                        headers={**h, "Content-Type": "application/json"},
                        json={"hidden": True}, timeout=15).raise_for_status()
        rr = requests.patch(f"{API}/org/url-tiles/{tid}",
                            headers={**h, "Content-Type": "application/json"},
                            json={"hidden": False}, timeout=15)
        assert rr.status_code == 200
        assert rr.json()["hidden"] is False
        # Default GET now lists it again.
        gr = requests.get(f"{API}/org/url-tiles", headers=h, timeout=15)
        ids = [t["id"] for t in gr.json()["tiles"]]
        assert tid in ids, (
            "restored tile (hidden:false) must reappear in default GET")
    finally:
        _delete(h, tid)


def test_non_admin_cannot_patch_hidden():
    """Worker-role fixture cannot flip `hidden`. PATCH is admin-only
    at the endpoint level (_admin gate) — verify with a 403 or 404
    depending on role visibility of the tile."""
    # Log in as the worker fixture. If it doesn't exist, skip.
    r = requests.post(f"{API}/auth/login",
                        json={"email": "worker_stephen@paneltec.com.au",
                              "password": "WorkerTest123!"},
                        timeout=30)
    if r.status_code != 200:
        pytest.skip("worker fixture unavailable")
    worker_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    # Have admin create a tile first (worker cannot create tiles).
    admin_h = _login()
    tid = _create_tile(admin_h, uuid.uuid4().hex[:8])
    try:
        wr = requests.patch(f"{API}/org/url-tiles/{tid}",
                            headers={**worker_h, "Content-Type": "application/json"},
                            json={"hidden": True}, timeout=15)
        assert wr.status_code in (401, 403, 404), (
            f"worker PATCH hidden must be denied — got {wr.status_code}: "
            f"{wr.text}")
        # Confirm nothing changed on the backend.
        gr = requests.get(f"{API}/org/url-tiles?include_hidden=true",
                          headers=admin_h, timeout=15)
        rows = {t["id"]: t for t in gr.json()["tiles"]}
        assert rows[tid]["hidden"] is False, (
            "non-admin PATCH must be a no-op on `hidden`")
    finally:
        _delete(admin_h, tid)


def test_pre_g9_tile_without_hidden_field_still_lists():
    """Rows created before .132g9 don't carry a `hidden` field. The
    read query treats missing as visible via the `$exists` branch —
    validate the /_out helper coerces default to false and the row
    surfaces in the default GET."""
    h = _login()
    # Reach into Mongo directly to insert a raw pre-g9 doc (no
    # `hidden` key). Uses the same DB the API talks to.
    import os
    import motor.motor_asyncio as motor
    import asyncio
    from datetime import datetime, timezone

    dbname = os.environ["DB_NAME"]
    mongo_url = os.environ["MONGO_URL"]
    async def _write_raw(org_id: str) -> str:
        client = motor.AsyncIOMotorClient(mongo_url)
        db = client[dbname]
        tid = uuid.uuid4().hex
        await db.org_url_tiles.insert_one({
            "id": tid, "org_id": org_id,
            "label": f".132g9-legacy-{uuid.uuid4().hex[:6]}",
            "url": "https://example.com/legacy",
            "icon": "🌐", "enabled": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "order": 999999,
            # Deliberately NO `hidden` field.
        })
        client.close()
        return tid
    # Discover admin org_id via /auth/me.
    me = requests.get(f"{API}/auth/me", headers=h, timeout=15)
    assert me.status_code == 200, me.text
    org_id = me.json()["org_id"]
    tid = asyncio.get_event_loop().run_until_complete(_write_raw(org_id))
    try:
        gr = requests.get(f"{API}/org/url-tiles", headers=h, timeout=15)
        rows = {t["id"]: t for t in gr.json()["tiles"]}
        assert tid in rows, (
            "legacy tile without `hidden` field must be treated as visible")
        assert rows[tid]["hidden"] is False, (
            "_out() must coerce missing `hidden` to False")
    finally:
        _delete(h, tid)


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g9():
    js = _read(VERSION_JS)
    sw = _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132g9'", js), (
        "RUNNING_VERSION not bumped to .132g9")
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132g9'", js), (
        "EXPECTED_CACHE_VERSION not bumped to .132g9")
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132g9'", sw), (
        "service-worker CACHE_VERSION not bumped to .132g9")
