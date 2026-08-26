"""v58.13.43 — Capture density control CI sweep.

Iterates over every Capture list page and asserts each one either:
  (a) uses `CaptureListToolbar` AND wires both `densityMode` + `onDensityChange`
      props (the delegation path — toolbar renders the shared control),
  OR
  (b) imports `CaptureDensityControl` AND renders `<CaptureDensityControl ...>`
      inline (the direct path).

In either case, the runtime output MUST include the canonical
`data-testid="capture-density-control"` element the tester + v58.13.40
contract depend on. Would have caught the v58.13.41 dynamic-testid
regression automatically.

Location: `/app/tests/frontend_smoke/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

from pathlib import Path

import pytest

FRONTEND = Path("/app/frontend/src")

# Every Capture list page that MUST expose a density segmented control.
# `pageKey` matches the `useCaptureDensity(...)` scope used by the page.
_PAGES = [
    ("pages/Incidents.jsx",       "incidents"),
    ("pages/Inspections.jsx",     "inspections"),
    ("pages/Hazards.jsx",         "hazards"),
    ("pages/SiteDiary.jsx",       "site-diary"),
    ("pages/RiskAssessments.jsx", "risk-assessments"),
    ("pages/SiteSigninList.jsx",  "site-signin"),
    # v58.13.54 — CsIncidentsList.jsx retired.
    ("pages/PreStarts.jsx",       "pre-starts"),
]


def _uses_toolbar_delegation(src: str) -> bool:
    """Page path A — CaptureListToolbar renders the shared control."""
    if "import CaptureListToolbar" not in src:
        return False
    return "densityMode=" in src and "onDensityChange=" in src


def _renders_inline(src: str) -> bool:
    """Page path B — page renders <CaptureDensityControl> directly."""
    return (
        "import CaptureDensityControl" in src
        and "<CaptureDensityControl" in src
    )


@pytest.mark.parametrize("rel, page_key", _PAGES,
                         ids=[p[1] for p in _PAGES])
def test_page_exposes_density_control(rel: str, page_key: str):
    path = FRONTEND / rel
    assert path.exists(), f"Page file missing: {path}"
    src = path.read_text(encoding="utf-8")

    # Every page must instantiate the density hook. If this ever
    # disappears, the segmented control has no state to drive.
    assert "useCaptureDensity(" in src, (
        f"{rel}: expected `useCaptureDensity(...)` — the density hook "
        "is the source of truth for both the segmented control and "
        "the tile grid."
    )
    assert f"'{page_key}'" in src, (
        f"{rel}: expected `useCaptureDensity('{page_key}', ...)` — "
        "the pageKey scopes localStorage persistence per-page."
    )

    via_toolbar = _uses_toolbar_delegation(src)
    via_inline = _renders_inline(src)
    assert via_toolbar or via_inline, (
        f"{rel}: page does not expose a density control. Either wire "
        "CaptureListToolbar with `densityMode` + `onDensityChange` "
        "props, or render <CaptureDensityControl> inline. Otherwise "
        "the canonical `data-testid=\"capture-density-control\"` "
        "element will be missing at runtime."
    )
    # Sanity: if both paths are simultaneously wired, the runtime
    # would emit two canonical testids on the same page and break
    # Playwright's `wait_for_selector` uniqueness assumption.
    assert not (via_toolbar and via_inline), (
        f"{rel}: page wires BOTH the toolbar delegation AND the inline "
        "CaptureDensityControl — that would emit two "
        "`capture-density-control` elements on the same page. Pick one."
    )


def test_shared_control_still_emits_canonical_testid():
    """Belt-and-braces: the whole sweep only works if the shared
    component still emits `capture-density-control`. If someone
    accidentally reverts to the v58.13.41 dynamic form, this fails
    fast rather than letting the per-page test suite pass on
    empty selectors."""
    src = (FRONTEND / "components" / "CaptureDensityControl.jsx").read_text(
        encoding="utf-8"
    )
    assert 'data-testid="capture-density-control"' in src, (
        "CaptureDensityControl must emit the canonical testid string. "
        "The v58.13.41 dynamic form (`${testidPrefix}-density-control`) "
        "is banned — see v58.13.42 changelog for why."
    )


def test_pages_count_stays_at_seven():
    """If a new Capture list page is added, wire it up here + in the
    _PAGES parametrize list. Guarding the count prevents someone
    from silently landing an 8th page that skips density wiring.
    v58.13.54 dropped the count from 8 → 7 (CsIncidentsList retired)."""
    assert len(_PAGES) == 7, (
        "Expected exactly 7 Capture list pages. Update _PAGES + add "
        "the new page's `useCaptureDensity` wiring before landing."
    )


def test_version_sync_current_v58_13_43():
    # v58.13.44 note: same relaxation pattern as v58.13.41/42 —
    # append-only changelog block presence, not current-string
    # identity (that's `test_version_sync_v58_13_13.py`'s job).
    v_js = (FRONTEND / "lib" / "version.js").read_text(encoding="utf-8")
    assert "v160.3.9.58.13.43 —" in v_js, (
        "The v58.13.43 changelog block must remain in version.js — "
        "history is append-only per the ship-checklist."
    )
