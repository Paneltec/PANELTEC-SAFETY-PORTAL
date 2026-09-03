"""v58.13.92 — Always-visible color-coded Comms Safe Mode pill.

Source-scan only. Guards against a future edit accidentally
reverting the pill to warning-only, and pins the DOM contract
(`data-mode`, `data-env-locked`, testids) that downstream playwright
tests can rely on.
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

APPSHELL_JSX = (FRONTEND / "src" / "components" / "layout" / "AppShell.jsx").read_text(encoding="utf-8")
SAFE_MODE_JSX = (FRONTEND / "src" / "pages" / "CommsSafeMode.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── Pill is always rendered (no `effective === 'on'` guard) ──

def test_pill_renders_regardless_of_effective_state():
    """The pill must be gated on `safeMode` being truthy (data
    loaded) — not on `safeMode.effective === 'on'`. The old
    warning-only pattern was the P0 UX regression this ship fixes."""
    # Old smoking-gun pattern gone.
    assert "safeMode?.effective === 'on' && (" not in APPSHELL_JSX
    # New guard is a plain truthiness check.
    m = re.search(r"\{safeMode\s*&&\s*\(\(\)\s*=>\s*\{", APPSHELL_JSX)
    assert m, "Pill IIFE not found — expected `{safeMode && (() => {`"


def test_pill_renders_both_on_and_off_branches():
    """Green (ON) and amber (OFF) code paths must both exist inside
    the IIFE. v58.13.94 flipped the semantics — ON=green, OFF=amber."""
    assert "bg-emerald-100" in APPSHELL_JSX  # ON branch (v58.13.94)
    assert "bg-amber-50" in APPSHELL_JSX  # OFF branch (v58.13.94)
    assert "ShieldCheck" in APPSHELL_JSX  # ON icon
    assert "ShieldOff" in APPSHELL_JSX  # OFF icon
    # Label ternary present.
    assert "Comms Safe Mode: ON" in APPSHELL_JSX
    assert "Comms Safe Mode: OFF" in APPSHELL_JSX


def test_pill_env_lock_badge_present():
    """The tiny Lock badge (rendered only when `env_locked === true`)
    lets the user distinguish "org toggled ON" from "operator env-
    locked ON" without opening the admin page."""
    assert 'data-testid="comms-safe-mode-chip-env-lock"' in APPSHELL_JSX
    assert re.search(r"\{locked\s*&&\s*\(\s*<Lock", APPSHELL_JSX), (
        "Lock icon is not gated by `locked &&`"
    )


def test_pill_carries_data_mode_and_env_lock_attributes():
    """DOM contract for playwright + testing agents."""
    assert 'data-mode={eff}' in APPSHELL_JSX
    assert re.search(r"data-env-locked=\{locked \? 'true' : 'false'\}", APPSHELL_JSX)


def test_pill_click_routes_to_admin_page():
    """`<Link to="/app/settings/comms-safe-mode">` must be the outer
    element so the whole pill area is clickable + keyboard-focusable."""
    # Find the chip's Link tag and confirm `to` is the admin route.
    m = re.search(
        r'<Link\s+to="/app/settings/comms-safe-mode"[\s\S]{0,400}?data-testid="comms-safe-mode-chip"',
        APPSHELL_JSX,
    )
    assert m, "chip Link does not route to /app/settings/comms-safe-mode"


def test_pill_has_focus_ring_and_aria_label():
    """Keyboard-accessible per spec."""
    # aria-label mirrors the tooltip copy.
    assert 'aria-label={tooltip}' in APPSHELL_JSX
    # focus:ring class present and color-matched.
    assert "focus:ring-amber-400" in APPSHELL_JSX
    assert "focus:ring-emerald-400" in APPSHELL_JSX


def test_pill_tooltips_match_spec():
    """Tooltip copy is asserted verbatim so a future edit can't drift
    the wording that ships in the UI. v58.13.94 flipped the copy to
    emphasise SAFETY on ON and RISK on OFF."""
    assert "Comms Safe Mode is ON — outbound comms are being captured safely, not delivered. Click to manage." in APPSHELL_JSX
    assert "Comms Safe Mode is OFF — real emails and SMS will fire on button clicks. Click to manage." in APPSHELL_JSX
    assert "Comms Safe Mode is ON (env-locked) —" in APPSHELL_JSX


# ── Live-update wiring ──

def test_appshell_refetches_on_route_change():
    """`useEffect` for the safeMode fetch must depend on
    `location.pathname` so nav events refresh the pill."""
    m = re.search(
        r"api\.get\('/admin/comms-safe-mode/status'\)[\s\S]+?\}, \[location\.pathname\]\);",
        APPSHELL_JSX,
    )
    assert m, (
        "safeMode useEffect must depend on `location.pathname` for "
        "live-update on nav"
    )


def test_appshell_listens_for_change_event():
    """`window.addEventListener('paneltec:comms-safe-mode-changed', …)`
    is registered so a same-tab toggle flips the pill."""
    assert "paneltec:comms-safe-mode-changed" in APPSHELL_JSX
    assert (
        "window.addEventListener('paneltec:comms-safe-mode-changed'" in APPSHELL_JSX
    )
    # And the listener is cleaned up on unmount.
    assert (
        "window.removeEventListener('paneltec:comms-safe-mode-changed'" in APPSHELL_JSX
    )


def test_safe_mode_page_dispatches_change_event_after_patch():
    """`CommsSafeMode.jsx::toggle()` must dispatch the same event
    after the PATCH resolves — otherwise the AppShell listener never
    fires and the pill lags behind by a route change."""
    m = re.search(
        r"await api\.patch\('/admin/comms-safe-mode'[\s\S]+?"
        r"window\.dispatchEvent\(\s*new CustomEvent\(\s*"
        r"'paneltec:comms-safe-mode-changed'",
        SAFE_MODE_JSX,
    )
    assert m, (
        "CommsSafeMode.jsx::toggle() no longer dispatches the "
        "`paneltec:comms-safe-mode-changed` event after a successful "
        "PATCH — the AppShell pill will lag."
    )


# ── Version-sync forward-safe pin >= 92 ─────────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_92():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 92


def test_cache_version_gte_92():
    assert _tail(SW_JS, "CACHE_VERSION") >= 92


def test_mobile_bundle_version_gte_92():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 92
