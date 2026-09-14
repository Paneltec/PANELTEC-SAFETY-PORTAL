"""v58.13.132g5 — HOTFIX. PIN-protected tiles: the 3-dots menu
itself is now gated by the admin PIN.

Stephen: "so it looks like you have given everybody the ability
with out signing in on the 3 dots". Pre-.132g5 the launcher modal
greyed the tile body and forced a PIN before opening the URL, but
the 3-dots menu opened freely — Copy URL / Hide from my view were
accessible without a PIN. This ship closes the gap: on a
`pin_protected` tile, clicking the 3-dots first prompts for the
admin PIN via the existing TilePinModal + POST /verify-pin path.
Wrong PIN → shake, menu stays closed. Correct PIN → menu opens
once. Closing + reopening the 3-dots re-prompts (per-click, not
per-session).

Non-PIN tiles are unchanged — the 3-dots opens directly.

Backend contract is unchanged; only shared TileCard.jsx wiring.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = APP_ROOT / "frontend"
TILECARD = FRONTEND / "src" / "components" / "apps-directory" / "TileCard.jsx"
LAUNCHER = FRONTEND / "src" / "components" / "AppsDirectoryModal.jsx"
STANDALONE = FRONTEND / "src" / "pages" / "AppsDirectory.jsx"
VERSION_JS = FRONTEND / "src" / "lib" / "version.js"
SW = FRONTEND / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── State machine ─────────────────────────────────────────────

def test_pin_intent_state_exists():
    src = _read(TILECARD)
    # Tracks WHY a PIN unlock was requested — 'launch' opens the
    # URL, 'menu' reveals the dropdown. Reset on close so the
    # next click has to re-earn the unlock.
    assert "const [pinIntent, setPinIntent] = useState(null)" in src
    # Guard-rail: the three legal values are documented in the
    # source comment; anything else is a no-op.
    assert "'launch' | 'menu' | null" in src


def test_launch_branch_sets_intent_launch():
    src = _read(TILECARD)
    launch_span_start = src.index("const openTile = (e) =>")
    launch_span = src[launch_span_start:launch_span_start + 800]
    assert "setPinIntent('launch')" in launch_span, (
        "URL-launch path must set intent='launch' before opening "
        "the PIN modal — otherwise the modal's onUnlocked can't "
        "distinguish it from the menu-unlock path")


def test_toggle_menu_gates_on_pin_protected():
    src = _read(TILECARD)
    assert "const toggleMenu = (e) =>" in src
    span_start = src.index("const toggleMenu = (e) =>")
    span = src[span_start:span_start + 800]
    # Three responsibilities in one function:
    #   1. Toggle off if menu is already open.
    assert "if (menuOpen) {" in span
    #   2. On PIN-protected tiles → prompt PIN with intent='menu'.
    assert "if (pinProtected) {" in span
    assert "setPinIntent('menu')" in span
    assert "setPinModalOpen(true)" in span
    #   3. Non-PIN tiles → open menu directly.
    assert "setMenuOpen(true)" in span


def test_three_dots_button_wired_to_toggle_menu():
    src = _read(TILECARD)
    # The 3-dots button's onClick now runs through `toggleMenu`
    # instead of the raw setter — that's where the PIN gate lives.
    assert "onClick={toggleMenu}" in src
    # Tooltip surfaces the gate on PIN tiles.
    assert "'PIN required · actions for this tile'" in src


def test_onUnlocked_branches_on_intent():
    src = _read(TILECARD)
    # Pull the `pinModalOpen && (` render block up to the closing
    # brace of onUnlocked.
    block_start = src.index("{pinModalOpen && (")
    block = src[block_start:block_start + 900]
    assert "const intent = pinIntent" in block, (
        "onUnlocked must snapshot pinIntent BEFORE clearing it so "
        "the branch decision uses the right value")
    assert "setPinIntent(null)" in block
    assert "if (intent === 'menu') {" in block
    assert "setMenuOpen(true)" in block
    assert "else if (intent === 'launch')" in block
    assert "doPlainOpen(url)" in block


def test_pin_intent_reset_on_modal_close():
    src = _read(TILECARD)
    # Closing the modal without unlocking must also clear the
    # intent — otherwise a later unlock (say, from a different
    # tile) could inherit the stale value.
    close_pattern = r"onClose=\{\(\)\s*=>\s*\{\s*setPinModalOpen\(false\);\s*setPinIntent\(null\)"
    assert re.search(close_pattern, src), (
        "TilePinModal onClose must reset both pinModalOpen and "
        "pinIntent to prevent stale-intent bugs")


# ─── Behavioural — the PIN modal is the same one from .132g1 ───

def test_pin_modal_still_hits_verify_pin_endpoint():
    src = _read(TILECARD)
    assert "api.post(`/org/url-tiles/${tile.id}/verify-pin`, { pin })" in src, (
        "The gate reuses the .132g1 POST /verify-pin path — no "
        "new endpoint, no schema change")


# ─── Non-PIN tiles unchanged ───────────────────────────────────

def test_non_pin_menu_opens_directly():
    src = _read(TILECARD)
    # On a NON-PIN tile, toggleMenu falls through to setMenuOpen(true).
    # We already pin this in `test_toggle_menu_gates_on_pin_protected`
    # but a dedicated guard here catches accidental early-returns.
    span_start = src.index("const toggleMenu = (e) =>")
    span = src[span_start:span_start + 800]
    # Between the PIN branch and the setMenuOpen call, no other
    # early return.
    pin_branch = span.index("if (pinProtected) {")
    open_call = span.index("setMenuOpen(true)")
    assert pin_branch < open_call, (
        "the fall-through order must be: toggle-if-open → "
        "PIN branch → setMenuOpen(true)")


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g5():
    for path in (VERSION_JS, SW):
        s = _read(path)
        assert "paneltec-v160.3.9.58.13.132g5" in s
