"""v58.13.47 — Frontend telemetry contract for `useCaptureDensity`.

Guards the four rules the user brief laid out:
  1. Hook imports axios (or an equivalent HTTP client — we assert
     axios specifically to lock in the bare-client choice that
     bypasses the authed `/lib/api` 401-redirect interceptor).
  2. `setMode` fires a POST to `/api/metrics/capture-density`.
  3. 500 ms debounce is present.
  4. Failure is silently swallowed — no toast, no alert, no throw.
"""
from __future__ import annotations

import re
from pathlib import Path


HOOK = Path("/app/frontend/src/lib/useCaptureDensity.js")


def _hook_src() -> str:
    return HOOK.read_text(encoding="utf-8")


def test_hook_imports_axios_directly():
    src = _hook_src()
    assert re.search(r"^\s*import axios from 'axios';", src, re.MULTILINE), (
        "useCaptureDensity must import axios directly (NOT the "
        "authed `/lib/api` client) so telemetry pings don't trip a "
        "401-redirect interceptor for anonymous / preview users."
    )


def test_hook_posts_to_capture_density_endpoint():
    src = _hook_src()
    # The URL is composed from REACT_APP_BACKEND_URL — assert both
    # the env var and the path suffix are present.
    assert "REACT_APP_BACKEND_URL" in src
    assert "/api/metrics/capture-density" in src, (
        "Telemetry URL missing — expected `/api/metrics/capture-density`."
    )
    # And that `axios.post(...)` is actually invoked (not just an
    # unused constant).
    assert re.search(r"axios\.post\(\s*TELEMETRY_URL", src), (
        "useCaptureDensity must call `axios.post(TELEMETRY_URL, ...)` "
        "inside setMode."
    )


def test_hook_debounces_500ms():
    src = _hook_src()
    assert "TELEMETRY_DEBOUNCE_MS = 500" in src, (
        "Debounce constant missing or wrong. Rapid A/B/A clicks on "
        "the segmented control would spam the endpoint otherwise."
    )
    # Debounce plumbing — a ref + clearTimeout + setTimeout(_, DEBOUNCE)
    # pattern. Grep loosely so the test doesn't over-couple to
    # cosmetic refactors.
    assert "debounceRef" in src
    assert "clearTimeout(debounceRef.current)" in src
    assert "setTimeout(" in src
    assert "TELEMETRY_DEBOUNCE_MS" in src


def test_hook_silently_swallows_telemetry_failures():
    src = _hook_src()
    # The `_emit` helper must have a `.catch(() => {})` chain AND
    # the outer body must be wrapped in try/catch. Both together
    # guarantee analytics can never throw or surface a UI signal.
    assert ".catch(() => {})" in src, (
        "Telemetry POST must have a no-op `.catch(() => {})` — "
        "analytics MUST NOT surface failures to the user."
    )
    # And there must NOT be a toast / alert / notify call inside
    # the _emit helper.
    emit_block = re.search(
        r"function _emit\([^)]*\)\s*\{(?P<body>.*?)\n\}", src, re.DOTALL,
    )
    assert emit_block, "Couldn't locate `_emit` helper in useCaptureDensity."
    body = emit_block.group("body")
    for banned in ("toast.", "alert(", "notify(", "console.error"):
        assert banned not in body, (
            f"Telemetry emit block contains `{banned}` — analytics "
            "MUST be silent on failure."
        )


def test_hook_still_persists_to_local_storage():
    """Regression: telemetry is additive; persistence contract from
    v58.13.39 must still work so density choices survive reloads."""
    src = _hook_src()
    assert "captureDensity:" in src
    assert "window.localStorage.setItem(" in src
    assert "window.localStorage.getItem(" in src


def test_hook_initial_resolved_from_auto_ping_present():
    src = _hook_src()
    assert "resolved_from_auto" in src, (
        "Missing initial `event: 'resolved_from_auto'` ping — user "
        "brief requires capturing what auto picks even when the "
        "user never touches the toggle."
    )
    assert "initialPingSentRef" in src, (
        "Missing one-shot guard for the initial ping — without it "
        "we'd re-emit on every re-render."
    )


def test_version_sync_current_v58_13_47():
    # v58.13.48 note: relaxed to the append-only-changelog pattern
    # (same as v58.13.41/42/43/45/46). Cross-file identity of the
    # CURRENT version constant is enforced by `test_version_sync_v58_13_13.py`.
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    assert "v160.3.9.58.13.47 —" in v_js, (
        "The v58.13.47 changelog block must remain in version.js — "
        "history is append-only per the ship-checklist."
    )
