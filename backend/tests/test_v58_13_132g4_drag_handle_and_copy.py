"""v58.13.132g4 — HOTFIX. `.132g3` extracted the tile primitives so
both surfaces used the shared TileCard, but Stephen reported "i
cant drag the tils around". Root cause: the `.132g3` drag handle
was a 14px slate-300 grip icon that was almost invisible on the
white tile background, AND the `PointerSensor { distance: 6 }`
threshold was too high for MacBook trackpad micro-drags — clicks
fired before the sensor activated.

This ship also folds in the Hide/PIN copy clarification Stephen
asked for after conflating "Hide until next login" with PIN
protection.

Pins cover:
  · Prominent drag handle (18px, slate-500 default → slate-800
    hover, white bg + border + shadow, `cursor-grab` /
    `cursor-grabbing` states) on the shared TileCard.
  · Both DnD contexts wired with
    `PointerSensor { distance: 3 }` (was 6) plus a new
    `TouchSensor { delay: 150, tolerance: 5 }` so iPad admins
    can drag too.
  · 3-dots tooltip copy: `"Actions for this tile"`.
  · Hide menu item label: `"Hide from my view (until logout)"` with
    a sub-label `"Only affects your view. Not secure."`.
  · PIN-protected tiles' top menu action is `"Unlock with PIN"`
    (unchanged from .132g1 but now unambiguously the ONLY launch
    affordance in the menu — the plain "Open" is not shown for
    pin-protected tiles).
  · Version lockstep to `.132g4`.
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


# ─── Drag handle — visible, prominent ──────────────────────────

def test_drag_handle_bumped_to_18px_with_bg_and_border():
    src = _read(TILECARD)
    # 14 → 18 (larger, easier to hit).
    assert "<GripVertical size={18}" in src, (
        "drag handle must be 18px in .132g4 — was 14px in .132g3 and "
        "Stephen couldn't spot it")
    # Contrast bump — visible on light + hover state.
    assert "text-slate-500 hover:text-slate-900" in src
    # White pill w/ border + shadow so it stands out against tile card.
    assert "bg-white/90 border border-slate-200 shadow-sm" in src
    # Cursor affordances retained.
    assert "cursor-grab" in src
    assert "active:cursor-grabbing" in src
    # touch-action:none per @dnd-kit docs so mobile Safari doesn't
    # steal the gesture.
    assert "touch-none" in src


def test_drag_handle_has_tooltip_and_aria_label():
    src = _read(TILECARD)
    assert 'title="Drag to reorder"' in src
    assert 'aria-label="Drag to reorder"' in src


# ─── Sensors ───────────────────────────────────────────────────

def test_pointersensor_distance_lowered_to_3():
    for path in (LAUNCHER, STANDALONE):
        src = _read(path)
        assert "PointerSensor, { activationConstraint: { distance: 3 } }" in src, (
            f"{path.name} must lower PointerSensor distance to 3 — "
            "the .132g3 value of 6 was too high for MacBook trackpad")
        # The pre-.132g4 threshold may still appear in a comment
        # explaining the change; we only care that it's not in the
        # ACTIVE useSensor call.
        assert "PointerSensor, { activationConstraint: { distance: 6" not in src, (
            f"{path.name} still calls PointerSensor with the pre-.132g4 "
            "distance: 6 threshold")


def test_touch_sensor_wired_for_ipad_admins():
    for path in (LAUNCHER, STANDALONE):
        src = _read(path)
        assert "TouchSensor" in src, (
            f"{path.name} must import TouchSensor so iPad admins can "
            "drag (v58.13.132g4)")
        assert "TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }" in src


# ─── Menu copy ─────────────────────────────────────────────────

def test_3dots_trigger_tooltip_rewrite():
    src = _read(TILECARD)
    # v58.13.132g4 introduced "Actions for this tile".
    # v58.13.132g5 made it conditional on pin_protected.
    # v58.13.132g6 collapsed the conditional back to a single
    # value: "PIN required · actions for this tile" (menu now
    # requires PIN on every tile). Accept any of the three.
    assert (
        "'Actions for this tile'" in src
        or 'title="Actions for this tile"' in src
        or 'title="PIN required · actions for this tile"' in src
    )
    # Pre-.132g4 label retired.
    assert 'title="Tile options"' not in src


def test_hide_menu_item_has_label_and_sublabel():
    src = _read(TILECARD)
    # v58.13.132g4 primary label was "Hide from my view (until
    # logout)". v58.13.132g9 rewrote it to "Hide tile for the whole
    # org" (hide is now org-wide). Accept either.
    assert (
        "Hide from my view (until logout)" in src
        or "Hide tile for the whole org" in src
    )
    # Sub-label italic hint. v58.13.132g9 rewrote the copy — accept
    # either.
    assert (
        "Only affects your view. Not secure." in src
        or "Removes this tile from every user's view" in src
    )
    # Pre-.132g4 label gone.
    assert "Hide until next login" not in src


def test_pin_tile_top_menu_action_is_unlock_with_pin_only():
    """PIN-protected tiles must NOT show a plain 'Open' item — the
    menu's top action for a pin_protected tile is exclusively
    'Unlock with PIN'."""
    src = _read(TILECARD)
    # The single conditional expression that swaps the label is
    # present.
    assert "pinProtected ? <><Lock size={13} /> Unlock with PIN</> : <><ExternalLink size={13} /> Open</>" in src


# ─── Version lockstep ──────────────────────────────────────────

def test_version_bumped_to_132g4():
    """Baseline pin — version has crossed `.132g4` at least once.
    Regex accepts later bumps so subsequent hotfixes don't
    retroactively fail this ship's assertion."""
    for path in (VERSION_JS, SW):
        s = _read(path)
        assert re.search(r"paneltec-v160\.3\.9\.58\.13\.132g\d", s), (
            f"version in {path.name} has not reached .132g4+")
