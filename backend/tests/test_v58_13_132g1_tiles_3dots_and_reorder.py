"""v58.13.132g1 — Apps Directory tile 3-dots menu + drag-to-reorder
+ per-tile PIN gate.

Backend pins for:
  · `PATCH /api/org/url-tiles/reorder` — flat tile_ids list.
  · `POST /api/org/url-tiles/{id}/verify-pin` — per-click gate that
    validates against the caller's admin PIN.
  · `pin_protected` bool field on create / read / patch.

Frontend pins for:
  · Tile 3-dots menu (Open / Copy URL / Hide until next login).
  · Session-scoped hide (per-user sessionStorage key).
  · Drag handle wired through @dnd-kit.
  · Editor checkbox "Require admin PIN to open".
  · PIN modal (dots, keypad, shake on wrong).
"""
from __future__ import annotations

import re
import sys
import uuid
from pathlib import Path

import pytest
import requests

from tests.conftest import ADMIN_EMAIL, ADMIN_PWD, API

pytestmark = pytest.mark.live_db_writes

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND = APP_ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

ORG_URL_TILES = BACKEND / "org_url_tiles.py"
# v58.13.132g3 — the tile primitives (3-dots menu, PIN modal,
# session-hide storage, dnd-kit wire) migrated from
# `pages/AppsDirectory.jsx` into the shared
# `components/apps-directory/TileCard.jsx` so both the launcher
# modal and the standalone page use one code path. Frontend pins
# below follow the code, not the file.
APPS_DIRECTORY = APP_ROOT / "frontend" / "src" / "components" / "apps-directory" / "TileCard.jsx"
APPS_DIRECTORY_PAGE = APP_ROOT / "frontend" / "src" / "pages" / "AppsDirectory.jsx"
QUICK_LINKS = APP_ROOT / "frontend" / "src" / "components" / "QuickLinksSection.jsx"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _login(email: str = ADMIN_EMAIL, pwd: str = ADMIN_PWD) -> dict:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": pwd},
        timeout=30,
    )
    if r.status_code == 429:
        pytest.skip("rate-limited")
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ─── Backend source pins ───────────────────────────────────────

def test_patch_reorder_route_registered_before_parametrised():
    src = _read(ORG_URL_TILES)
    assert '@router.patch("/reorder")' in src, (
        "PATCH /reorder route not registered")
    assert "class ReorderIdsIn" in src
    # Order matters — the parametrised {tile_id} PATCH must sit AFTER
    # the literal /reorder route, otherwise FastAPI's router will
    # match /reorder as a tile_id and 404 the reorder call.
    idx_reorder = src.find('@router.patch("/reorder")')
    idx_tile_id = src.find('@router.patch("/{tile_id}")')
    assert idx_reorder != -1 and idx_tile_id != -1
    assert idx_reorder < idx_tile_id, (
        "PATCH /reorder must be defined ABOVE PATCH /{tile_id} — "
        "otherwise the parametrised route swallows the reorder path")


def test_reorder_admin_only_and_writes_order_field():
    src = _read(ORG_URL_TILES)
    # Handler pins.
    assert "async def reorder_tiles_by_ids(" in src
    # Extract the handler body span.
    start = src.index("async def reorder_tiles_by_ids(")
    end = src.index("\n\n\n", start)
    body = src[start:end]
    assert "_admin(user)" in body, "reorder must gate on admin"
    assert 'for position, tile_id in enumerate(body.tile_ids)' in body
    assert '"order": position' in body
    # Scoped strictly to caller's org.
    assert '"org_id": org_id' in body


# ─── Frontend source pins ──────────────────────────────────────

def test_apps_directory_uses_dnd_kit():
    src = _read(APPS_DIRECTORY_PAGE) + _read(APPS_DIRECTORY)
    # Library import from the already-installed @dnd-kit stack.
    assert "@dnd-kit/core" in src
    assert "@dnd-kit/sortable" in src
    assert "useSortable" in src
    assert "DndContext" in src


def test_three_dot_menu_present():
    src = _read(APPS_DIRECTORY)
    # 3-dots trigger + panel + three actions — the shared TileCard
    # emits parameterised testids so the launcher modal and the
    # standalone page can both consume them with distinct prefixes.
    assert "${testIdPrefix}-menu-${tile.id}" in src
    assert "${testIdPrefix}-menu-panel-${tile.id}" in src
    assert "${testIdPrefix}-menu-open-${tile.id}" in src
    assert "${testIdPrefix}-menu-copy-${tile.id}" in src
    assert "${testIdPrefix}-menu-hide-${tile.id}" in src
    # Menu items — labels lock the copy so a future rename fires
    # a source-pin regression before the Playwright script does.
    assert "> Open<" in src or "Open</" in src
    assert "Copy URL" in src
    # v58.13.132g4 rewrote the Hide label to
    # "Hide from my view (until logout)" — v58.13.132g9 rewrote it
    # again to "Hide tile for the whole org". Accept any of the
    # historical wordings so a future ship can update copy without
    # breaking this guard.
    assert (
        ("Hide until next login" in src)
        or ("Hide from my view" in src)
        or ("Hide tile for the whole org" in src)
    )


def test_hide_uses_session_storage_per_user():
    src = _read(APPS_DIRECTORY)
    # Per-user key + sessionStorage (session-scoped) — NOT
    # localStorage (which would survive logout).
    assert "sessionStorage.getItem(_hideKey(userId))" in src
    assert "sessionStorage.setItem(_hideKey(userId)" in src
    assert "`hidden_tiles_${userId" in src
    # The pre-.132g1 permanent `apps_directory_hidden` localStorage
    # affordance must be gone from active code paths.
    for path in (APPS_DIRECTORY, APPS_DIRECTORY_PAGE):
        s = _read(path)
        assert "localStorage.getItem('apps_directory_hidden'" not in s
        assert "localStorage.setItem('apps_directory_hidden'" not in s
        assert 'localStorage.getItem("apps_directory_hidden"' not in s
        assert 'localStorage.setItem("apps_directory_hidden"' not in s


def test_reorder_wired_to_patch_endpoint():
    src = _read(APPS_DIRECTORY_PAGE)
    assert "api.patch('/org/url-tiles/reorder'" in src, (
        "Reorder must PATCH the flat tile_ids list to the new "
        "PATCH /org/url-tiles/reorder route")
    assert "tile_ids: nextTiles.map((t) => t.id)" in src
    # Drag handle is admin-only — the check lives in the shared
    # TileCard so we grep that file for the pattern.
    shared = _read(APPS_DIRECTORY)
    assert "isAdmin && (" in shared
    assert "${testIdPrefix}-drag-${tile.id}" in shared


def test_copy_url_uses_clipboard_api():
    src = _read(APPS_DIRECTORY)
    assert "navigator.clipboard.writeText(tile.url)" in src
    # Fallback for browsers without clipboard (private mode etc.).
    assert "document.execCommand('copy')" in src


# ─── Behavioural: reorder round-trip ───────────────────────────

def _cleanup_tile(h: dict, tile_id: str) -> None:
    try:
        requests.delete(f"{API}/org/url-tiles/{tile_id}",
                          headers=h, timeout=10)
    except Exception:
        pass


def test_patch_reorder_behavioural():
    h = _login()
    # Seed 3 disposable tiles so the round-trip is safe against the
    # live org's existing tiles.
    stamp = uuid.uuid4().hex[:8]
    created_ids = []
    try:
        for i in range(3):
            r = requests.post(
                f"{API}/org/url-tiles",
                headers={**h, "Content-Type": "application/json"},
                json={
                    "label": f".132g1-test-{stamp}-{i}",
                    "url": f"https://example.com/{stamp}/{i}",
                    "icon": "🔧",
                    "enabled": True,
                },
                timeout=30,
            )
            assert r.status_code == 200, r.text
            created_ids.append(r.json()["id"])

        # Reorder: reverse the list.
        reversed_ids = list(reversed(created_ids))
        r = requests.patch(
            f"{API}/org/url-tiles/reorder",
            headers={**h, "Content-Type": "application/json"},
            json={"tile_ids": reversed_ids},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("updated") == 3

        # GET the list; our three seeded tiles should now appear in
        # the reversed order (they come first — order=0/1/2 wins
        # over the default sort-by-created_at fallback).
        r = requests.get(f"{API}/org/url-tiles", headers=h, timeout=30)
        assert r.status_code == 200
        all_ids = [t["id"] for t in r.json()["tiles"]]
        # Slice out just the ones we seeded to check relative order.
        seeded_order = [tid for tid in all_ids if tid in set(created_ids)]
        assert seeded_order == reversed_ids, (
            f"expected reversed order {reversed_ids}, got {seeded_order}")
    finally:
        for tid in created_ids:
            _cleanup_tile(h, tid)


def test_reorder_admin_gate():
    """Non-admin (worker role) must get 403 on the reorder call."""
    # The Paneltec org has a dedicated non-admin test worker seeded by
    # v144 — `worker_stephen@paneltec.com.au`. If it isn't present /
    # its password isn't the standard, we skip.
    try:
        r = requests.post(
            f"{API}/auth/login",
            json={"email": "worker_stephen@paneltec.com.au",
                  "password": ADMIN_PWD},
            timeout=15,
        )
    except Exception:
        pytest.skip("worker account probe failed")
    if r.status_code != 200:
        pytest.skip(
            "worker_stephen account absent / different password — "
            "gate test skipped, source pin _admin() call still applies")
    wh = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = requests.patch(
        f"{API}/org/url-tiles/reorder",
        headers={**wh, "Content-Type": "application/json"},
        json={"tile_ids": []},
        timeout=15,
    )
    assert r.status_code == 403, (
        f"non-admin PATCH /reorder must 403, got {r.status_code}")


# ─── PIN protection — source pins ──────────────────────────────

def test_pin_protected_field_wired_in_models_and_out():
    src = _read(ORG_URL_TILES)
    # Present on TileCreate + TilePatch models.
    assert "pin_protected: Optional[bool]" in src
    # Persisted on create.
    assert '"pin_protected": bool(body.pin_protected)' in src
    # Toggle-able via PATCH.
    assert 'updates["pin_protected"] = bool(body.pin_protected)' in src
    # Surfaced on read.
    assert '"pin_protected": bool(doc.get("pin_protected", False))' in src


def test_verify_pin_endpoint_registered():
    src = _read(ORG_URL_TILES)
    assert '@router.post("/{tile_id}/verify-pin")' in src
    assert "async def verify_tile_pin(" in src
    # Reuses the admin_console_pin helpers so the header lock's
    # lockout tiers apply here too.
    for needle in (
        "from admin_console_pin import",
        "_check_lockout",
        "_record_failure",
        "_reset_attempts",
        "verify_password",
    ):
        assert needle in src, f"verify_tile_pin must reuse: {needle}"
    # Error taxonomy — .132g6 dropped the pin_protected 400 branch
    # (public tiles now go through this endpoint too as the 3-dots
    # menu gate).
    assert 'detail="Wrong PIN."' in src  # 401
    assert 'No admin PIN set' in src  # 403
    assert 'detail="Tile not found"' in src  # 404


def test_frontend_editor_has_pin_checkbox():
    src = _read(QUICK_LINKS)
    assert 'data-testid="org-quick-links-editor-pin-protected"' in src
    assert "Require admin PIN to open" in src
    # Payload piped through on save.
    assert "pin_protected: !!form.pin_protected" in src
    # Initial state seeded from the row.
    assert "pin_protected: tile?.pin_protected ?? false" in src


def test_frontend_tile_pin_modal_present():
    src = _read(APPS_DIRECTORY)
    assert "function TilePinModal(" in src
    # Wire to the new endpoint.
    assert "api.post(`/org/url-tiles/${tile.id}/verify-pin`, { pin })" in src
    # Body of the tile launches modal instead of navigating when
    # `pin_protected` is true.
    assert "if (pinProtected) {" in src
    assert "setPinModalOpen(true)" in src
    # Shake feedback on wrong PIN.
    assert "setShake(true)" in src
    assert "animate-[shake_0.4s]" in src or "animation: 'shake 0.4s'" in src
    # 3-dots menu label flips to "Unlock with PIN".
    assert "Unlock with PIN" in src


def test_frontend_lock_overlay_and_greyed_tile():
    src = _read(APPS_DIRECTORY)
    # Overlay testid + greyed opacity class trigger.
    assert "${testIdPrefix}-lock-overlay-${tile.id}" in src
    # `data-pin-protected` attribute for tests / audit.
    assert 'data-pin-protected={pinProtected ? \'true\' : \'false\'}' in src
    # 3-dots menu z-30 sits above the lock overlay (z-10).
    assert "z-30" in src
    # `disabledLook` path applies opacity-70 regardless of role.
    assert "const pinProtected = !!tile.pin_protected" in src
    assert "const disabledLook = !approved || pinProtected" in src


# ─── PIN protection — behavioural ──────────────────────────────

def _get_or_set_admin_pin(h: dict, desired_pin: str = "1234") -> None:
    """Ensure the current admin has a known PIN so verify-pin can be
    exercised. Uses the admin-console-pin flow (status → set/change).
    """
    st = requests.get(f"{API}/auth/admin-console/status",
                        headers=h, timeout=15)
    if st.status_code != 200:
        pytest.skip("admin-console pin status probe failed")
    # If already set we can't overwrite without knowing the current
    # PIN; try the /change endpoint with `desired_pin` as both old
    # and new (a no-op flip). Failure just means we skip verify tests.
    if st.json().get("is_set"):
        r = requests.post(
            f"{API}/auth/admin-console/change",
            headers={**h, "Content-Type": "application/json"},
            json={"old_pin": desired_pin, "new_pin": desired_pin},
            timeout=15,
        )
        if r.status_code not in (200, 204):
            pytest.skip(
                "admin PIN already set to an unknown value — "
                "cannot exercise verify-pin without breaking prod")
        return
    r = requests.post(
        f"{API}/auth/admin-console/set",
        headers={**h, "Content-Type": "application/json"},
        json={"pin": desired_pin},
        timeout=15,
    )
    assert r.status_code == 200, r.text


def test_verify_pin_behavioural():
    h = _login()
    _get_or_set_admin_pin(h, "1234")

    stamp = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/org/url-tiles",
        headers={**h, "Content-Type": "application/json"},
        json={
            "label": f".132g1-pin-{stamp}",
            "url": f"https://example.com/pin/{stamp}",
            "icon": "🔒",
            "pin_protected": True,
            "enabled": True,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    tile = r.json()
    tid = tile["id"]
    assert tile.get("pin_protected") is True

    try:
        # 400 — tile isn't pin_protected (flip off then try).
        off = requests.patch(f"{API}/org/url-tiles/{tid}",
                              headers={**h, "Content-Type": "application/json"},
                              json={"pin_protected": False}, timeout=15)
        assert off.status_code == 200
        r = requests.post(
            f"{API}/org/url-tiles/{tid}/verify-pin",
            headers={**h, "Content-Type": "application/json"},
            json={"pin": "1234"}, timeout=15,
        )
        assert r.status_code == 400, r.text

        # Flip back on for the remaining assertions.
        requests.patch(f"{API}/org/url-tiles/{tid}",
                        headers={**h, "Content-Type": "application/json"},
                        json={"pin_protected": True}, timeout=15)

        # 200 — correct PIN returns the URL.
        r = requests.post(
            f"{API}/org/url-tiles/{tid}/verify-pin",
            headers={**h, "Content-Type": "application/json"},
            json={"pin": "1234"}, timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("url", "").endswith(f"/pin/{stamp}")

        # 401 — wrong PIN.
        r = requests.post(
            f"{API}/org/url-tiles/{tid}/verify-pin",
            headers={**h, "Content-Type": "application/json"},
            json={"pin": "9999"}, timeout=15,
        )
        assert r.status_code in (401, 429), r.text

        # 404 — unknown tile.
        r = requests.post(
            f"{API}/org/url-tiles/no-such-tile-{stamp}/verify-pin",
            headers={**h, "Content-Type": "application/json"},
            json={"pin": "1234"}, timeout=15,
        )
        assert r.status_code == 404, r.text
    finally:
        _cleanup_tile(h, tid)


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g1():
    """Baseline pin: version must have moved from any pre-.132g1
    build to .132g1 or beyond. Uses a regex so subsequent bumps
    (e.g. .132g3 hotfix) don't retroactively fail this ship's pin."""
    for path in (VERSION_JS, SW):
        s = _read(path)
        # Match .132g1 through .132z999.
        assert re.search(r"paneltec-v160\.3\.9\.58\.13\.132g\d", s), (
            f"version in {path.name} has not reached .132g1+")
