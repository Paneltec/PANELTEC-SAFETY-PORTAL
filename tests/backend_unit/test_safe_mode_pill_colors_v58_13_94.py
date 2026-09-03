"""v58.13.94 — Pill/state-card colors flipped so ON=green, OFF=amber.

Regression pins so a future edit that accidentally re-flips the
color semantics fails CI. Complements
`test_safe_mode_pill_v58_13_92.py` (structural DOM/routing pins) and
`test_safe_mode_pill_count_v58_13_93.py` (badge/count pins) —
those files have been updated in-place to match the new copy; this
file exists to make the color intent itself explicit.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"

APPSHELL_JSX = (FRONTEND / "src" / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")
SAFE_MODE_JSX = (FRONTEND / "src" / "pages" / "CommsSafeMode.jsx").read_text(encoding="utf-8")


# ── Top-bar pill ────────────────────────────────────────────────

def test_pill_on_branch_is_green_not_amber():
    """ON branch must map to emerald classes, not amber. The regex
    isolates the ternary that lives inside the IIFE for the pill so
    other amber/emerald mentions in the file don't leak in."""
    m = re.search(
        r"const cls\s*=\s*isOn\s*\n?\s*\?\s*'([^']+)'\s*\n?\s*:\s*'([^']+)'",
        APPSHELL_JSX,
    )
    assert m, "cls ternary for pill not found"
    on_cls, off_cls = m.group(1), m.group(2)
    assert "emerald" in on_cls and "amber" not in on_cls, (
        f"ON branch is not green: {on_cls!r}"
    )
    assert "amber" in off_cls and "emerald" not in off_cls, (
        f"OFF branch is not amber: {off_cls!r}"
    )


def test_pill_icon_classes_track_the_flip():
    """`iconCls` mirrors the color flip so the shield fill matches
    the pill it's in."""
    m = re.search(
        r"const iconCls\s*=\s*isOn\s*\n?\s*\?\s*'([^']+)'\s*\n?\s*:\s*'([^']+)'",
        APPSHELL_JSX,
    )
    assert m, "iconCls ternary not found"
    on_icon, off_icon = m.group(1), m.group(2)
    assert "emerald" in on_icon
    assert "amber" in off_icon


def test_pill_focus_ring_tracks_the_flip():
    """focus ring emerald on ON, amber on OFF."""
    assert re.search(
        r"isOn\s*\?\s*'focus:ring-emerald-400'\s*:\s*'focus:ring-amber-400'",
        APPSHELL_JSX,
    ), "focus:ring ternary is not `emerald on ON, amber on OFF`"


def test_env_lock_icon_is_emerald_now():
    """The nested Lock badge stays inside the (green) ON pill, so
    its text-color must be emerald-700, not amber-700."""
    m = re.search(
        r'<Lock size=\{10\} className="([^"]+)"[^>]*data-testid="comms-safe-mode-chip-env-lock"',
        APPSHELL_JSX,
    )
    assert m, "Lock icon in env-lock badge not found"
    assert "emerald" in m.group(1) and "amber" not in m.group(1), (
        f"env-lock Lock icon is not emerald-tinted: {m.group(1)!r}"
    )


def test_count_badge_uses_high_contrast_chip_on_green():
    """Badge chrome is white + emerald-800 (with an emerald-300
    border) — not the pre-.94 amber-500 + white."""
    m = re.search(
        r'data-testid="comms-safe-mode-chip-count"[\s\S]{0,400}?'
        r'bg-white[\s\S]{0,400}?text-emerald-800[\s\S]{0,400}?border-emerald-300',
        APPSHELL_JSX,
    )
    assert m, (
        "count badge classes do not match the .94 flipped chrome "
        "(expected `bg-white text-emerald-800 border-emerald-300`)"
    )
    # Old amber-500 chrome must be gone from the badge element.
    m2 = re.search(
        r'data-testid="comms-safe-mode-chip-count"[\s\S]{0,400}?bg-amber-500',
        APPSHELL_JSX,
    )
    assert m2 is None, "count badge still uses the old amber-500 chrome"


# ── Admin page state accent card ────────────────────────────────

def test_admin_state_card_on_branch_is_green():
    """`CommsSafeMode.jsx` state card at the top of the page maps
    eff='on' to the emerald palette (was amber pre-.94)."""
    m = re.search(
        r"eff === 'on'\s*\n?\s*\?\s*'([^']*emerald[^']*)'\s*\n?\s*:\s*'([^']*amber[^']*)'",
        SAFE_MODE_JSX,
    )
    assert m, (
        "admin state card ternary does not map ON→emerald and "
        "OFF→amber"
    )
    on_pal, off_pal = m.group(1), m.group(2)
    assert "emerald" in on_pal and "amber" not in on_pal
    assert "amber" in off_pal and "emerald" not in off_pal


def test_admin_state_card_icon_tile_flip():
    """The 40x40 rounded icon tile beside the "Safe Mode is ON/OFF"
    heading also flips."""
    m = re.search(
        r"eff === 'on' \? '(bg-emerald-200[^']+)' : '(bg-amber-200[^']+)'",
        SAFE_MODE_JSX,
    )
    assert m, "admin state card icon tile ternary not flipped"


def test_admin_state_card_zap_fill_flip():
    """The Zap icon inside the tile now has a fill on both branches
    (was outline-only on OFF)."""
    assert "fill-emerald-600 text-emerald-600" in SAFE_MODE_JSX
    assert "fill-amber-600 text-amber-600" in SAFE_MODE_JSX


# ── Version-sync forward-safe pin >= 94 ─────────────────────────

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (ROOT / "mobile" / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_94():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 94


def test_cache_version_gte_94():
    assert _tail(SW_JS, "CACHE_VERSION") >= 94


def test_mobile_bundle_version_gte_94():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 94
