"""v58.13.132g8 — HOTFIX. Restore ("Show them again") is now
PIN-gated + `.132g7` lockout UI + verify-script Stephen guards
folded in.

Stephen: "why do you give everybody the access to put the tile
back again". Pre-.132g8 the "Show them again" footer link
un-hid every tile without any PIN — a peer of the .132g6 3-dots
hole, one layer over.

Also in this ship (rolled up from the un-committed .132g7 work):
  · TilePinModal detects HTTP 429 and renders a live-countdown
    lockout banner instead of the generic Wrong PIN shake.
    Keypad + backspace disabled while locked.
  · scripts/verify_132g{1,5,6}.py guard the wrong-PIN branch
    against ADMIN_EMAIL == stephen@paneltec.com.au so future
    ships stop hammering his account.
  · memory/test_credentials.md carries the standing rule.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = APP_ROOT / "frontend"
TILECARD = FRONTEND / "src" / "components" / "apps-directory" / "TileCard.jsx"
LAUNCHER = FRONTEND / "src" / "components" / "AppsDirectoryModal.jsx"
STANDALONE = FRONTEND / "src" / "pages" / "AppsDirectory.jsx"
VERIFY_G1 = APP_ROOT / "scripts" / "verify_132g1.py"
VERIFY_G5 = APP_ROOT / "scripts" / "verify_132g5.py"
VERIFY_G6 = APP_ROOT / "scripts" / "verify_132g6.py"
TEST_CREDS = APP_ROOT / "memory" / "test_credentials.md"
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Restore is PIN-gated on both surfaces ─────────────────────

def test_launcher_restore_gates_on_admin_pin():
    src = _read(LAUNCHER)
    assert "const [restorePinOpen, setRestorePinOpen] = useState(false)" in src
    # v58.13.132g9 — footer no longer calls the (retired) resetHidden
    # session-clear. The PIN gate short-circuits to the reveal path
    # via setShowHidden(true) + loadTiles(true).
    assert 'onClick={resetHidden}' not in src, (
        "AppsDirectoryModal 'Show hidden' must not call resetHidden "
        "directly in .132g8+")
    # New path: open the PIN modal when tiles exist AND the caller
    # has an admin PIN; fall through to reveal otherwise so
    # non-admins / empty grids don't get stuck.
    assert "setRestorePinOpen(true)" in src
    assert "if (tiles.length && hasAdminPin) {" in src
    # PIN modal wired to reuse TilePinModal with a stand-in tile id.
    assert "TilePinModal" in src
    # .132g8 label was "Restore hidden tiles"; .132g9 renamed to
    # "Show hidden tiles" (label matches the footer button).
    assert ("'Restore hidden tiles'" in src) or ("'Show hidden tiles'" in src)


def test_standalone_restore_gates_on_admin_pin():
    src = _read(STANDALONE)
    assert "const [restorePinOpen, setRestorePinOpen] = useState(false)" in src
    assert 'onClick={resetHidden}' not in src, (
        "pages/AppsDirectory.jsx 'Show hidden' must not call "
        "resetHidden directly in .132g8+")
    assert "setRestorePinOpen(true)" in src
    assert ("'Restore hidden tiles'" in src) or ("'Show hidden tiles'" in src)
    assert "TilePinModal" in src


# ─── .132g7 rollup: lockout UI + verify-script guards ──────────

def test_tile_pin_modal_has_lockout_countdown():
    src = _read(TILECARD)
    # State slot + countdown derivation.
    assert "const [lockedUntil, setLockedUntil] = useState(0)" in src
    assert "const lockedRemaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000))" in src
    assert "const isLocked = lockedRemaining > 0" in src
    # 429 branch parses the "in Ns" from the detail (with header fallback).
    assert "if (status === 429) {" in src
    assert "/in\\s+(\\d+)\\s*s/i" in src or "in\\\\s+(\\\\d+)" in src
    assert "e?.response?.headers?.['retry-after']" in src
    # Lockout banner testid.
    assert "tile-pin-locked-${tile.id}" in src
    # Keypad + backspace refuse taps while locked.
    assert "if (busy || isLocked) return" in src
    assert "if (!busy && !isLocked)" in src


def test_verify_scripts_guard_stephen():
    """The .132g1 / .132g5 / .132g6 verify scripts must NOT hit
    Stephen's account with wrong PINs — the shared
    admin_console_pin_attempts collection locks him out of the
    header admin console AND every tile 3-dots gate."""
    for p in (VERIFY_G1, VERIFY_G5, VERIFY_G6):
        src = _read(p)
        assert 'ADMIN_EMAIL == "stephen@paneltec.com.au"' in src, (
            f"{p.name} must skip the wrong-PIN branch when the "
            "target account is Stephen's")


def test_test_credentials_carries_standing_rule():
    src = _read(TEST_CREDS)
    # The standing rule + rationale must survive future edits.
    assert "STANDING RULE" in src
    assert "NEVER submit wrong PIN attempts against" in src
    assert "stephen@paneltec.com.au" in src


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g8():
    """v58.13.132g8 was rolled into v58.13.132g9 — accept any g8+
    marker so the guard doesn't invert after subsequent bumps."""
    for path in (VERSION_JS, SW):
        s = _read(path)
        assert re.search(r"paneltec-v160\.3\.9\.58\.13\.132g[89a-z]", s), (
            f"{path.name}: version has not reached .132g8+")
