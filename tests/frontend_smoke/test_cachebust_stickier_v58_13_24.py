"""v58.13.24 — CacheBusterBanner stickier UX smoke.

Static-grep verification. Placed under `/app/tests/frontend_smoke/`.
"""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
BANNER = APP / "frontend/src/components/CacheBusterBanner.jsx"


def test_auto_hide_ms_is_30000():
    src = BANNER.read_text(encoding="utf-8")
    assert "const AUTO_HIDE_MS = 30_000" in src, (
        "AUTO_HIDE_MS must be 30_000 (was 8_000 pre-v58.13.24)"
    )
    # Regression guard — the old 8_000 value must not linger.
    assert "AUTO_HIDE_MS = 8_000" not in src


def test_dismiss_button_present_with_expected_handler():
    src = BANNER.read_text(encoding="utf-8")
    assert 'data-testid="cache-buster-dismiss"' in src
    # The rename from "Later" to "Dismiss" — user-visible label.
    # (Whitespace-tolerant: JSX may put the text on its own line.)
    assert re.search(r">\s*Dismiss\s*<", src)
    # Regression: old "Later" link label must be gone.
    assert re.search(r">\s*Later\s*<", src) is None
    # X-close button still uses the same dismiss handler.
    assert 'data-testid="cache-buster-close"' in src
    # Both buttons call the shared `dismiss` helper.
    assert re.search(r"onClick=\{dismiss\}[\s\S]{0,120}data-testid=\"cache-buster-dismiss\"", src)
    assert re.search(r"onClick=\{dismiss\}[\s\S]{0,200}data-testid=\"cache-buster-close\"", src)


def test_reload_button_calls_window_location_reload():
    src = BANNER.read_text(encoding="utf-8")
    assert 'data-testid="cache-buster-reload"' in src
    # Relabelled per approved plan.
    assert "'Reload now'" in src or '"Reload now"' in src
    # Full hard-reload preserves the pre-v58.13.24 SW-unregister +
    # caches-delete path before `window.location.reload()`.
    assert "window.location.reload()" in src
    assert "navigator.serviceWorker" in src or "navigator?.serviceWorker" in src
    assert "caches.delete" in src


def test_version_scoped_localstorage_key():
    src = BANNER.read_text(encoding="utf-8")
    assert "paneltec_cachebust_dismissed_" in src, (
        "Version-scoped dismiss key prefix missing"
    )
    # Prefix is composed with the ACTUAL serverVersion — not
    # RUNNING_VERSION (would suppress the toast for the wrong side
    # of the mismatch).
    assert re.search(
        r"DISMISS_KEY_PREFIX\s*\+\s*version",
        src,
    ), "dismiss key must be constructed with the server version"
    # Read + write helpers.
    assert "readDismissed" in src
    assert "writeDismissed" in src
    # Safari-private-mode friendly.
    assert "try {" in src


def test_stop_propagation_on_both_button_handlers():
    """v58.13.10 flash-bug guardrail — every action handler on this
    banner must stop propagation and prevent default."""
    src = BANNER.read_text(encoding="utf-8")
    # `dismiss` handler.
    dismiss_body = re.search(
        r"const dismiss\s*=\s*\(e\)\s*=>\s*\{([\s\S]*?)\};",
        src,
    )
    assert dismiss_body, "dismiss handler not resolvable"
    assert "e?.stopPropagation?.()" in dismiss_body.group(1)
    assert "e?.preventDefault?.()" in dismiss_body.group(1)
    # `forceReload` handler.
    reload_body = re.search(
        r"const forceReload\s*=\s*async\s*\(e\)\s*=>\s*\{([\s\S]*?)\};",
        src,
    )
    assert reload_body, "forceReload handler not resolvable"
    assert "e?.stopPropagation?.()" in reload_body.group(1)
    assert "e?.preventDefault?.()" in reload_body.group(1)


def test_pulse_animation_first_five_seconds():
    src = BANNER.read_text(encoding="utf-8")
    assert "PULSE_MS = 5_000" in src
    # keyframes for the pulse ring.
    assert "@keyframes pulseRing" in src
    # `pulsing` state toggles the CSS animation class.
    assert "pulsing" in src
    assert "animate-[pulseRing_" in src


def test_version_sync_current():
    """Dynamic RUNNING_VERSION read — survives future ships."""
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'", running)
    assert m
    current = m.group(1)
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
