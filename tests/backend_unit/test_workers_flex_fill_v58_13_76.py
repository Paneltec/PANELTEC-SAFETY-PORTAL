"""v58.13.76 — Workers table: measured flex-fill H scrollbar.

Static source-pins on the ResizeObserver-driven flex-fill logic that
replaced v58.13.75's static `max-h-[calc(100vh-260px)]` budget, plus
the sticky-header + min-inner-width regression guards and version sync.
"""
from __future__ import annotations
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"

WORKERS_JSX = (FRONTEND / "src" / "pages" / "Workers.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────
# Imports + ref
# ─────────────────────────────────────────────────────────────
def test_useLayoutEffect_imported_from_react():
    assert "useLayoutEffect" in WORKERS_JSX, (
        "Workers.jsx must import `useLayoutEffect` from React so the "
        "flex-fill measurement runs before browser paint."
    )
    # Sanity: make sure it's in the actual import line, not just prose.
    import_line = next(
        (ln for ln in WORKERS_JSX.splitlines()
         if ln.startswith("import React") and "'react'" in ln),
        None,
    )
    assert import_line is not None, "Workers.jsx must import from 'react'"
    assert "useLayoutEffect" in import_line, (
        "useLayoutEffect must be in the top-of-file React import "
        "line, not just in comment prose."
    )


def test_workers_table_ref_declared_and_attached():
    assert "const workersTableRef = useRef(null)" in WORKERS_JSX, (
        "Workers.jsx must declare `const workersTableRef = useRef(null)`."
    )
    assert "ref={workersTableRef}" in WORKERS_JSX, (
        "Workers.jsx workers-table container must attach "
        "`ref={workersTableRef}`."
    )


# ─────────────────────────────────────────────────────────────
# Measurement helper — dvh + ResizeObserver + cleanup
# ─────────────────────────────────────────────────────────────
def test_measurement_uses_dvh_not_vh_alone():
    """Regression guard: v58.13.75 used `100vh` and clipped on mobile
    Safari/Chrome when the URL bar was visible. `100dvh` (dynamic
    viewport height) is required."""
    assert "100dvh" in WORKERS_JSX, (
        "Workers.jsx measurement must use `100dvh` (dynamic viewport "
        "height) so mobile URL-bar show/hide doesn't clip the "
        "container. `100vh` alone re-introduces the mobile bug."
    )


def test_measurement_reads_bounding_rect_top():
    assert "getBoundingClientRect().top" in WORKERS_JSX, (
        "Workers.jsx measurement must read "
        "`getBoundingClientRect().top` to compute the actual top "
        "offset — no magic pixel budget."
    )


def test_resize_observer_used_and_cleaned_up():
    assert "new ResizeObserver(" in WORKERS_JSX, (
        "Workers.jsx must instantiate `new ResizeObserver(update)` so "
        "chrome changes (TopBar, hints, tab switches) trigger a "
        "re-measure."
    )
    assert "ro.disconnect()" in WORKERS_JSX, (
        "ResizeObserver must be disconnected in the useLayoutEffect "
        "cleanup — mandatory for React StrictMode + hot reload."
    )
    assert "ro.observe(document.documentElement)" in WORKERS_JSX, (
        "ResizeObserver must observe `document.documentElement` so "
        "any body-size change (Emergent host chrome show/hide, "
        "breakpoint crossing) triggers a re-measure."
    )


def test_window_resize_listener_registered_and_removed():
    assert "window.addEventListener('resize', update)" in WORKERS_JSX
    assert "window.removeEventListener('resize', update)" in WORKERS_JSX, (
        "window.resize listener must be removed in the cleanup."
    )


# ─────────────────────────────────────────────────────────────
# Container class list — v58.13.75 residue dropped
# ─────────────────────────────────────────────────────────────
def _grid_container_block() -> str:
    marker = 'data-testid="workers-table"'
    assert marker in WORKERS_JSX, (
        "Workers.jsx workers-table container not found."
    )
    start = WORKERS_JSX.index(marker)
    return WORKERS_JSX[max(0, start - 500):start + 600]


def test_container_drops_v75_static_max_height():
    body = _grid_container_block()
    assert "max-h-[calc(100vh-260px)]" not in body, (
        "Workers.jsx container must NOT retain the v58.13.75 static "
        "`max-h-[calc(100vh-260px)]` budget — that's the bug this "
        "ship fixes."
    )


def test_container_keeps_overflow_auto():
    body = _grid_container_block()
    assert "overflow-auto" in body, (
        "Workers.jsx container must keep `overflow-auto` (both axes) "
        "so the H scrollbar sits at the bottom of the measured region."
    )


# ─────────────────────────────────────────────────────────────
# v58.13.75 invariants preserved
# ─────────────────────────────────────────────────────────────
def test_sort_header_row_still_sticky():
    body = _grid_container_block()
    # Extend the window to catch the header row that follows.
    marker = "bg-slate-50 border-b border-slate-200"
    idx = WORKERS_JSX.index(marker)
    header_ctx = WORKERS_JSX[idx:idx + 500]
    assert "sticky" in header_ctx and "top-0" in header_ctx and "z-10" in header_ctx, (
        "Sort-header row must retain `sticky top-0 z-10` (v58.13.75 "
        "invariant, must survive .76)."
    )


def test_min_inner_width_preserved():
    body = _grid_container_block()
    assert "min-w-[980px]" in body, (
        "Workers grid inner rail must remain `min-w-[980px]` "
        "(v160.3.6e regression guard)."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — >= 76 (forward-safe)
# ─────────────────────────────────────────────────────────────
def _tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)[a-z]*['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_76():
    n = _tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 76, f"RUNNING_VERSION tail must be >= 76 (got {n})"


def test_cache_version_bumped_to_at_least_76():
    n = _tail(SW_JS, "CACHE_VERSION")
    assert n >= 76, f"CACHE_VERSION tail must be >= 76 (got {n})"


def test_mobile_bundle_version_bumped_to_at_least_76():
    n = _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 76, f"MOBILE_BUNDLE_VERSION tail must be >= 76 (got {n})"
