"""v58.13.40 — capture wiring smoke test."""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
GTV = APP / "frontend/src/components/capture/GroupedTilesView.jsx"
CC = APP / "frontend/src/components/CaptureCard.jsx"
TB = APP / "frontend/src/components/CaptureListToolbar.jsx"


# ─── GroupedTilesView wiring ────────────────────────────────────────

def test_grouped_tiles_view_imports_shared_helpers():
    src = GTV.read_text(encoding="utf-8")
    assert "resolveGroupPalette" in src
    assert "useCaptureDensity" in src
    assert "from '../../lib/groupPalette'" in src
    assert "from '../../lib/useCaptureDensity'" in src


def test_grouped_tiles_view_accepts_page_and_page_key_props():
    src = GTV.read_text(encoding="utf-8")
    # Function-signature destructuring includes both new props.
    assert re.search(r"page,\s*pageKey,?", src) is not None


def test_grouped_tiles_view_calls_resolve_group_palette_conditionally():
    src = GTV.read_text(encoding="utf-8")
    assert "resolveGroupPalette({ groupKey: key, page })" in src


def test_grouped_tiles_view_wires_density_hook():
    src = GTV.read_text(encoding="utf-8")
    assert "useCaptureDensity(pageKey || testidPrefix" in src
    assert "density.gridClass" in src
    assert "density.cardMinH" in src
    assert "density.subtitleLines" in src


def test_grouped_tiles_view_tile_min_height_applied():
    """v58.13.45: min-height moved off the outer wrapper (which no
    longer paints its own card chrome) into CaptureCard via the
    `minH` prop. The context object passed to `renderTile` still
    carries `density.cardMinH` — that's what this test guards."""
    src = GTV.read_text(encoding="utf-8")
    assert "minH: density.cardMinH" in src, (
        "renderTile ctx must still carry `minH: density.cardMinH` — "
        "CaptureCard reads that and applies `style={{ minHeight }}`."
    )


# ─── CaptureCard props ──────────────────────────────────────────────

def test_capture_card_accepts_min_h_and_subtitle_lines():
    src = CC.read_text(encoding="utf-8")
    # Both props declared in the destructured signature.
    assert "minH" in src
    assert "subtitleLines" in src


def test_capture_card_min_h_applied_as_inline_style():
    src = CC.read_text(encoding="utf-8")
    assert "minH ? { minHeight: minH }" in src


def test_capture_card_subtitle_lines_zero_hides_subtitle():
    src = CC.read_text(encoding="utf-8")
    # Conditional render — subtitle only shown when subtitleLines > 0.
    assert "subtitleLines > 0" in src
    # Line-clamp value comes from the prop.
    assert "line-clamp-${subtitleLines}" in src


# ─── CaptureListToolbar segmented control ───────────────────────────
# v58.13.41 note: the segmented control moved OUT of CaptureListToolbar
# into the shared `CaptureDensityControl` component. The toolbar now
# delegates to it. These tests were rewritten in v58.13.41 to guard
# the same contract at its new location.

DENSITY = APP / "frontend/src/components/CaptureDensityControl.jsx"


def test_toolbar_imports_density_icons():
    src = DENSITY.read_text(encoding="utf-8")
    for icon in ("Wand2", "Rows3", "LayoutGrid", "LayoutList"):
        assert icon in src, (
            f"CaptureDensityControl must import {icon} from lucide-react — "
            "the shared segmented control is the v58.13.41 delegation target."
        )


def test_toolbar_accepts_density_props():
    src = TB.read_text(encoding="utf-8")
    assert "densityMode" in src
    assert "onDensityChange" in src


def test_toolbar_renders_segmented_control_conditionally():
    tb_src = TB.read_text(encoding="utf-8")
    # Guard: control only renders when onDensityChange is a function.
    assert "typeof onDensityChange === 'function'" in tb_src
    # Delegation target imported.
    assert "import CaptureDensityControl" in tb_src
    ctrl_src = DENSITY.read_text(encoding="utf-8")
    # v58.13.42 — wrapper testid restored to the canonical literal
    # `capture-density-control` (v58.13.40 contract). Per-mode testids
    # remain namespaced by `testidPrefix`.
    assert 'data-testid="capture-density-control"' in ctrl_src
    # Per-mode testid.
    assert "${testidPrefix}-density-${m}" in ctrl_src


def test_toolbar_control_has_radiogroup_a11y():
    src = DENSITY.read_text(encoding="utf-8")
    assert 'role="radiogroup"' in src
    assert 'aria-label="Tile density"' in src
    assert 'role="radio"' in src
    assert "aria-checked={mode === m}" in src


# ─── Page wiring ────────────────────────────────────────────────────

INCIDENTS = APP / "frontend/src/pages/Incidents.jsx"
INSPECTIONS = APP / "frontend/src/pages/Inspections.jsx"
SITESIGNIN = APP / "frontend/src/pages/SiteSigninList.jsx"
# v58.13.54 — CSINCIDENTS constant removed with the retired page.


def test_incidents_page_full_wiring():
    src = INCIDENTS.read_text(encoding="utf-8")
    assert "useCaptureDensity" in src
    assert 'useCaptureDensity(\'incidents\',' in src
    assert 'page="incidents"' in src
    assert 'pageKey="incidents"' in src
    # Toolbar wired with density props.
    assert "densityMode={incidentsDensity.mode}" in src
    assert "onDensityChange={incidentsDensity.setMode}" in src


def test_grouped_pages_pass_page_and_page_key():
    for path, tag in (
        (INSPECTIONS, "inspections"),
        (SITESIGNIN, "site-signin"),
        # v58.13.54 — CsIncidentsList.jsx retired; entry removed.
    ):
        src = path.read_text(encoding="utf-8")
        assert f'page="{tag}"' in src, f"{path.name} missing page='{tag}'"
        assert f'pageKey="{tag}"' in src, f"{path.name} missing pageKey='{tag}'"


# ─── Version-sync ───────────────────────────────────────────────────
# v58.13.41 note: the strict `endswith('58.13.40')` check was retired
# because RUNNING_VERSION advances every ship. Cross-file identity is
# guarded by `test_version_sync_v58_13_13.py`; the assertion below
# just confirms that this ship's changelog block hasn't been torn out
# of `version.js` (a common merge-conflict casualty).

def test_version_sync_current():
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    assert "v160.3.9.58.13.40 —" in running, (
        "The v58.13.40 changelog block must remain in version.js — "
        "history is append-only per the ship-checklist."
    )
