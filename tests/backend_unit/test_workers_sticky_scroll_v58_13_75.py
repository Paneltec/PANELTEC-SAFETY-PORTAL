"""v58.13.75 — Settings / Workers: sticky H scrollbar + sticky header.

Static source-pins on the Workers grid container + header row and the
canonical version-sync invariant.
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


def _grid_block() -> str:
    """Return the source chunk covering the workers-table container
    + its sort header row."""
    marker = 'data-testid="workers-table"'
    assert marker in WORKERS_JSX, "Workers.jsx: workers-table container not found"
    start = WORKERS_JSX.index(marker)
    # Look back a bit to catch the enclosing `<div className="…" …>`.
    return WORKERS_JSX[max(0, start - 600):start + 1400]


# ─────────────────────────────────────────────────────────────
# Scroll container has bounded height + dual-axis overflow
# ─────────────────────────────────────────────────────────────
def test_workers_grid_container_has_overflow_auto():
    body = _grid_block()
    assert "overflow-auto" in body, (
        "Workers grid container must use `overflow-auto` (both axes) "
        "so the horizontal scrollbar is inside a bounded region "
        "and always visible."
    )
    # And the old x-only variant must be gone from the container.
    assert '"rounded-2xl border border-slate-200 bg-white overflow-x-auto"' not in body, (
        "Workers grid container must NOT use the old `overflow-x-auto`-only "
        "class list — that's the shape that caused the bottom-only H "
        "scrollbar bug."
    )


def test_workers_grid_container_has_bounded_height():
    body = _grid_block()
    # v58.13.75 shipped a static `max-h-[calc(100vh-260px)]`. v58.13.76
    # replaced that with a measured ref-driven max-height set from a
    # useLayoutEffect (`100dvh - getBoundingClientRect().top - 24px`).
    # Either mechanism satisfies the invariant: the container must be
    # height-bounded so the H scrollbar sits inside the visible
    # viewport.
    static_budget = "max-h-[calc(100vh-260px)]" in body
    measured_ref = ("ref={workersTableRef}" in body
                    and "useLayoutEffect" in WORKERS_JSX
                    and "100dvh" in WORKERS_JSX)
    assert static_budget or measured_ref, (
        "Workers grid container must be height-bounded — either via a "
        "static `max-h-[calc(100vh-260px)]` (v58.13.75) or via the "
        "measured ref + useLayoutEffect + 100dvh flex-fill (v58.13.76). "
        "Neither found."
    )


# ─────────────────────────────────────────────────────────────
# Sort-header row is sticky
# ─────────────────────────────────────────────────────────────
def test_sort_header_row_is_sticky():
    body = _grid_block()
    # The header row's className carries both `bg-slate-50` (opaque
    # background so sticky paint is clean) and the sticky utilities.
    header_snippet_pos = body.find("bg-slate-50 border-b border-slate-200")
    assert header_snippet_pos >= 0, (
        "Workers.jsx sort header row anchor `bg-slate-50 border-b "
        "border-slate-200` not found."
    )
    # Grab the header row's className string and prove sticky + top-0
    # + z-10 all landed in the same class list.
    header_context = body[header_snippet_pos:header_snippet_pos + 500]
    assert "sticky" in header_context, (
        "Workers.jsx sort header row must carry the `sticky` utility "
        "so column headers stay visible during vertical scroll."
    )
    assert "top-0" in header_context, (
        "Workers.jsx sort header row must anchor to `top-0` inside the "
        "scroll container."
    )
    assert "z-10" in header_context, (
        "Workers.jsx sort header row must have `z-10` so it paints "
        "above scrolling row content."
    )


# ─────────────────────────────────────────────────────────────
# Regression guard — min-inner-width preserved
# ─────────────────────────────────────────────────────────────
def test_grid_min_inner_width_preserved():
    """The `min-w-[980px]` inner rail was chosen in v160.3.6e to keep
    all 7 columns fully visible without clipping. Anyone tightening
    this value re-introduces the STATUS-truncation bug. Pin it."""
    body = _grid_block()
    assert "min-w-[980px]" in body, (
        "Workers grid inner rail must remain `min-w-[980px]` — "
        "regression guard from v160.3.6e (STATUS clipping bug)."
    )


# ─────────────────────────────────────────────────────────────
# Version sync — >= 75 (forward-safe)
# ─────────────────────────────────────────────────────────────
def _tail(text: str, needle: str) -> int:
    import re
    m = re.search(
        needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)['\"]",
        text,
    )
    assert m, f"{needle}: version literal not found"
    return int(m.group(1))


def test_running_version_bumped_to_at_least_75():
    n = _tail(VERSION_JS, "RUNNING_VERSION")
    assert n >= 75, f"RUNNING_VERSION tail must be >= 75 (got {n})"


def test_cache_version_bumped_to_at_least_75():
    n = _tail(SW_JS, "CACHE_VERSION")
    assert n >= 75, f"CACHE_VERSION tail must be >= 75 (got {n})"


def test_mobile_bundle_version_bumped_to_at_least_75():
    n = _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION")
    assert n >= 75, f"MOBILE_BUNDLE_VERSION tail must be >= 75 (got {n})"
