"""v58.13.42 — Hotfix regression test.

The v58.13.41 extraction of the density segmented control into
`CaptureDensityControl.jsx` accidentally made the wrapper testid a
template literal, so pages that render the control inline with a
namespaced `testidPrefix` (SiteSignin, CsIncidents, PreStarts) emitted
`site-signin-density-control` etc. rather than the canonical
`capture-density-control` string the tester + v58.13.40 contract
depend on. This suite guards against a repeat by asserting that:

  1. `CaptureDensityControl` always emits the canonical wrapper testid
     and additionally emits `data-density-page` for scoped queries.
  2. Every one of the 8 Capture list pages either delegates via
     `CaptureListToolbar` (which imports and renders
     `CaptureDensityControl`) or imports and renders
     `CaptureDensityControl` directly. This guarantees the canonical
     wrapper testid will be present on every page at runtime.

Location: `/app/tests/frontend_smoke/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

from pathlib import Path

FRONTEND = Path("/app/frontend/src")
CONTROL = FRONTEND / "components" / "CaptureDensityControl.jsx"
TOOLBAR = FRONTEND / "components" / "CaptureListToolbar.jsx"

# Which pages use CaptureListToolbar (which delegates to the shared
# control) vs render CaptureDensityControl inline. Both paths must
# result in the canonical wrapper testid on the page.
_VIA_TOOLBAR = (
    "pages/Incidents.jsx",
    "pages/Inspections.jsx",
    "pages/Hazards.jsx",
    "pages/SiteDiary.jsx",
    "pages/RiskAssessments.jsx",
)
_INLINE = (
    "pages/SiteSigninList.jsx",
    # v58.13.54 — CsIncidentsList.jsx retired.
    "pages/PreStarts.jsx",
)


def test_control_emits_canonical_testid_always():
    src = CONTROL.read_text(encoding="utf-8")
    assert 'data-testid="capture-density-control"' in src, (
        "Wrapper testid regressed — v58.13.42 restored the canonical "
        "`capture-density-control` string. This is the string the "
        "tester + v58.13.40 contract rely on."
    )
    # Not the old dynamic form.
    assert "${testidPrefix}-density-control" not in src, (
        "Dynamic wrapper testid must not return — v58.13.41 broke the "
        "v58.13.40 contract."
    )
    # Per-page scoping is done via data-density-page.
    assert "data-density-page={testidPrefix}" in src, (
        "Wrapper must carry `data-density-page` so Playwright can "
        "still target a specific page when needed."
    )


def test_toolbar_still_imports_shared_control():
    src = TOOLBAR.read_text(encoding="utf-8")
    assert "import CaptureDensityControl" in src


def test_toolbar_consumers_wire_density_props():
    """Guards the 5 pages that expose density via CaptureListToolbar."""
    for rel in _VIA_TOOLBAR:
        src = (FRONTEND / rel).read_text(encoding="utf-8")
        # Toolbar can't render the control unless the parent passes
        # both `densityMode` and `onDensityChange`.
        assert "densityMode=" in src, (
            f"{rel}: expected `densityMode={{...}}` on CaptureListToolbar — "
            "without it the toolbar hides the density control and the "
            "canonical testid will be missing from this page."
        )
        assert "onDensityChange=" in src, (
            f"{rel}: expected `onDensityChange={{...}}` on CaptureListToolbar."
        )


def test_inline_pages_render_capture_density_control():
    """Guards the 3 pages that don't use CaptureListToolbar."""
    for rel in _INLINE:
        src = (FRONTEND / rel).read_text(encoding="utf-8")
        assert "import CaptureDensityControl" in src, (
            f"{rel}: must import CaptureDensityControl — this page "
            "does not use CaptureListToolbar, so the control has to "
            "be rendered inline."
        )
        assert "<CaptureDensityControl" in src, (
            f"{rel}: must render <CaptureDensityControl ...> so the "
            "canonical wrapper testid is present on the page."
        )


def test_sitesignin_hotfix_specifically():
    """Explicit re-assertion of the exact regression the tester
    flagged, so any future refactor of SiteSignin that drops the
    density control fails a clearly-named test."""
    src = (FRONTEND / "pages" / "SiteSigninList.jsx").read_text(encoding="utf-8")
    assert "useCaptureDensity('site-signin'" in src
    assert "<CaptureDensityControl" in src
    assert 'testidPrefix="site-signin"' in src


def test_version_sync_current_v58_13_42():
    # v58.13.43 note: same rationale as v58.13.41's version-sync
    # relaxation — `version.js` carries the append-only changelog,
    # so this guard checks the v58.13.42 changelog block remained
    # after subsequent bumps. `test_version_sync_v58_13_13.py`
    # enforces cross-file identity of the current version constant.
    v_js = (FRONTEND / "lib" / "version.js").read_text(encoding="utf-8")
    assert "v160.3.9.58.13.42 —" in v_js, (
        "The v58.13.42 changelog block must remain in version.js — "
        "history is append-only per the ship-checklist."
    )
