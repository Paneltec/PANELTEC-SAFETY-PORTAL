"""v58.13.132g6 — HOTFIX. 3-dots menu now gated by admin PIN on
EVERY tile (not just pin_protected ones), and the button itself is
only rendered when the caller has an admin PIN configured.

Stephen: "why do you give every body the ability to log the view
and the ability to bring them back again and not password
control". `.132g5` gated the 3-dots on pin_protected tiles only —
public tiles still exposed Copy URL / Hide-from-my-view to any
authenticated user. `.132g6` closes that gap.

Model change:
  · toggleMenu on shared TileCard now ALWAYS pops the PIN modal
    (regardless of `tile.pin_protected`).
  · The 3-dots button renders only when `hasAdminPin === true`
    — a prop threaded down from the parent grid, populated by a
    one-shot POST /auth/admin-console/status probe on mount.
    Non-admins get 403 on that probe → flag stays false → button
    doesn't render.

Backend contract change:
  · POST /api/org/url-tiles/{id}/verify-pin no longer 400s when
    the tile isn't pin_protected. The endpoint is now the shared
    admin-PIN gate for both the URL launch (pin_protected tiles)
    AND the 3-dots menu (all tiles). Wrong PIN still 401; missing
    PIN still 403; 404 on unknown tile; 429 on lockout.
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


# ─── Backend: verify-pin now works on public tiles too ─────────

def test_verify_pin_endpoint_no_longer_400s_on_public_tile():
    src = _read(ORG_URL_TILES)
    # Handler still exists.
    assert "async def verify_tile_pin(" in src
    # The 400 "Tile is not PIN-protected" guard must be gone.
    assert 'detail="Tile is not PIN-protected"' not in src, (
        "verify_tile_pin must accept verification against a public "
        "tile in .132g6 — the endpoint is now the 3-dots gate too")
    # 4-digit shape guard still there.
    assert 'detail="PIN must be exactly 4 digits."' in src
    # Other error rungs preserved.
    assert 'detail="Tile not found"' in src
    assert 'detail="Wrong PIN."' in src
    assert 'No admin PIN set' in src


def test_verify_pin_behavioural_on_public_tile():
    """Round-trip: a public tile now accepts verify-pin calls with
    a shape-valid PIN (401 on wrong, not 400). Uses Stephen's real
    admin PIN behind the scenes — we deliberately submit a wrong
    PIN to observe the 401, since rotating the real PIN would
    break live login."""
    h = _login()
    stamp = uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/org/url-tiles",
        headers={**h, "Content-Type": "application/json"},
        json={
            "label": f".132g6-public-{stamp}",
            "url": f"https://example.com/public/{stamp}",
            "icon": "🌐",
            "enabled": True,
            "pin_protected": False,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    try:
        # Wrong PIN — expect 401 or 429 (if the account has been
        # hitting the lockout tiers), never 400 like pre-.132g6.
        vr = requests.post(
            f"{API}/org/url-tiles/{tid}/verify-pin",
            headers={**h, "Content-Type": "application/json"},
            json={"pin": "9876"},
            timeout=15,
        )
        assert vr.status_code in (401, 429, 403), (
            f"public-tile verify-pin returned {vr.status_code} "
            f"(expected 401 / 429 / 403; the pre-.132g6 400 must be "
            f"retired). Body: {vr.text}")
    finally:
        try: requests.delete(f"{API}/org/url-tiles/{tid}",
                                headers=h, timeout=10)
        except Exception: pass


# ─── Frontend: TileCard toggleMenu unconditionally prompts PIN ─

def test_toggle_menu_always_prompts_pin_regardless_of_pin_protected():
    src = _read(TILECARD)
    span_start = src.index("const toggleMenu = (e) =>")
    span = src[span_start:span_start + 800]
    # The pre-.132g6 `if (pinProtected)` branch inside toggleMenu
    # is gone.
    assert "if (pinProtected)" not in span, (
        "toggleMenu must NOT special-case pin_protected any more — "
        ".132g6 gates the menu on every tile")
    # Menu-open path still fires the PIN modal.
    assert "setPinIntent('menu')" in span
    assert "setPinModalOpen(true)" in span
    # The fall-through setMenuOpen(true) path is retired — every
    # non-toggle-close path goes through the PIN modal.
    assert "setMenuOpen(true)" not in span, (
        "toggleMenu must not open the menu directly — every path "
        "goes through the PIN modal in .132g6")


# ─── Frontend: 3-dots render gated on hasAdminPin ──────────────

def test_three_dots_rendered_only_when_hasAdminPin():
    src = _read(TILECARD)
    # Prop threaded through the JSDoc + destructure.
    assert "hasAdminPin" in src
    # Conditional render guard around the 3-dots button.
    assert "{hasAdminPin && (" in src
    # Tooltip is unconditional now.
    assert 'title="PIN required · actions for this tile"' in src


def test_parents_probe_admin_console_status():
    for path in (LAUNCHER, STANDALONE):
        src = _read(path)
        assert "api.post('/auth/admin-console/status')" in src, (
            f"{path.name} must probe admin-console/status on mount")
        assert "const [hasAdminPin, setHasAdminPin] = useState(false)" in src
        # Prop wired through to SortableTileCard.
        assert "hasAdminPin={hasAdminPin}" in src, (
            f"{path.name} must forward hasAdminPin to SortableTileCard")


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g6():
    for path in (VERSION_JS, SW):
        s = _read(path)
        assert "paneltec-v160.3.9.58.13.132g6" in s
