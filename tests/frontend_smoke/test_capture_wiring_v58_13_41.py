"""v58.13.41 — Capture wiring smoke tests.

Static-grep pytest suite guarding the two v58.13.41 shipped items:

1. Bug 1 fix — stripe hex threading. `GroupedTilesView` passes
   `stripeHex` into `renderTile(rec, ctx)` and every consumer page
   forwards it to `<CaptureCard stripeStyle={...}>`. Banner and tile
   stripe therefore cannot drift because they share the same hex.

2. Deferred wiring — visible density segmented control on 8 Capture
   list pages plus the shared `CaptureDensityControl` component,
   `CaptureCardGrid`'s new `gridClass` prop, and `GroupedTilesView`'s
   new external `density` prop.

Location: `/app/tests/frontend_smoke/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

import re
from pathlib import Path

FRONTEND = Path("/app/frontend/src")

# ─── Component contracts ───────────────────────────────────────────

def test_capture_density_control_component_exists():
    p = FRONTEND / "components" / "CaptureDensityControl.jsx"
    assert p.exists(), (
        f"Expected shared component at {p} — extracted from "
        "CaptureListToolbar in v58.13.41."
    )
    src = p.read_text()
    assert "role=\"radiogroup\"" in src
    assert "aria-label=\"Tile density\"" in src
    for mode in ("auto", "compact", "comfortable", "spacious"):
        assert f"m: '{mode}'" in src, f"missing option {mode!r}"
    # v58.13.42 — wrapper testid restored to the canonical
    # `capture-density-control` (v58.13.40 contract). Per-page
    # scoping is done via `data-density-page="${testidPrefix}"`
    # so Playwright can still target one instance when a page
    # renders more than one control (none currently do, but the
    # attribute is present for forward compatibility).
    assert 'data-testid="capture-density-control"' in src, (
        "Wrapper testid must be the canonical `capture-density-control` "
        "string — the v58.13.41 dynamic template was reverted in "
        "v58.13.42 after the tester flagged the missing testid on "
        "SiteSignin/CsIncidents/PreStarts."
    )
    assert "data-density-page={testidPrefix}" in src, (
        "Wrapper must also emit `data-density-page` for scoped queries."
    )
    # Radio buttons remain testidPrefix-namespaced.
    assert "${testidPrefix}-density-${m}" in src


def test_capture_list_toolbar_delegates_to_shared_control():
    src = (FRONTEND / "components" / "CaptureListToolbar.jsx").read_text()
    assert "import CaptureDensityControl" in src, (
        "CaptureListToolbar must import the shared density control "
        "so the pill visuals are a single source of truth."
    )
    # v58.13.42 — the toolbar must NOT emit its own copy of the
    # radiogroup wrapper (that would produce a duplicate canonical
    # testid on the page). It only renders <CaptureDensityControl>.
    assert 'data-testid="capture-density-control"' not in src, (
        "CaptureListToolbar must not emit `capture-density-control` "
        "itself — that string lives in <CaptureDensityControl>."
    )


def test_capture_card_grid_accepts_grid_class_prop():
    src = (FRONTEND / "components" / "CaptureCard.jsx").read_text()
    # Signature grew the new optional `gridClass`.
    assert re.search(
        r"export function CaptureCardGrid\(\{ *children, *testid, *gridClass *\}",
        src,
    ), "CaptureCardGrid must accept a `gridClass` prop in v58.13.41."
    # And the default must be applied only when the prop is falsy.
    assert "gridClass || 'grid gap-2.5" in src


def test_grouped_tiles_view_accepts_external_density():
    src = (FRONTEND / "components" / "capture" / "GroupedTilesView.jsx").read_text()
    # New prop signature.
    assert "density: densityProp" in src, (
        "GroupedTilesView must accept an external `density` prop so "
        "toolbars and tile grid share one hook instance."
    )
    # And the prop wins over the internal hook when provided.
    assert "const density = densityProp || internalDensity" in src


def test_grouped_tiles_view_still_threads_stripe_hex():
    """v58.13.41 Bug 1 — regression guard."""
    src = (FRONTEND / "components" / "capture" / "GroupedTilesView.jsx").read_text()
    # renderTile is called with a ctx object that includes stripeHex.
    assert "stripeHex:" in src


# ─── Page wiring — grouped pages consume ctx.stripeHex ─────────────

_GROUPED_STRIPE_CONSUMERS = (
    "pages/Incidents.jsx",
    "pages/Inspections.jsx",
    "pages/CsIncidentsList.jsx",
)


def test_grouped_pages_forward_ctx_stripe_hex():
    for rel in _GROUPED_STRIPE_CONSUMERS:
        src = (FRONTEND / rel).read_text()
        assert "ctx.stripeHex" in src, (
            f"{rel}: renderTile must consume `ctx.stripeHex` and "
            "forward it as `stripeStyle={{ background: ctx.stripeHex }}`."
        )
        assert "background: ctx.stripeHex" in src or \
               "background: stripe" in src, (
            f"{rel}: expected stripeStyle wired to the ctx-derived hex."
        )


# ─── Page wiring — density instance shared with GroupedTilesView ───

_GROUPED_DENSITY_SHARING = {
    "pages/Incidents.jsx":       "incidentsDensity",
    "pages/Inspections.jsx":     "inspectionsDensity",
    "pages/CsIncidentsList.jsx": "density",
}


def test_grouped_pages_share_density_with_grouped_tiles_view():
    for rel, ident in _GROUPED_DENSITY_SHARING.items():
        src = (FRONTEND / rel).read_text()
        # Instantiates the hook.
        assert f"const {ident} = useCaptureDensity(" in src, (
            f"{rel}: expected `const {ident} = useCaptureDensity(...)`."
        )
        # Passes it into GroupedTilesView.
        assert f"density={{{ident}}}" in src, (
            f"{rel}: expected `<GroupedTilesView density={{{ident}}} ...>` "
            "so the toolbar segmented control and the tile grid share "
            "one React state."
        )


# ─── Page wiring — flat pages consume gridClass + minH + subtitleLines

_FLAT_PAGES = (
    "pages/Hazards.jsx",
    "pages/PreStarts.jsx",
    "pages/SiteDiary.jsx",
    "pages/RiskAssessments.jsx",
)


def test_flat_pages_wire_density_into_grid():
    for rel in _FLAT_PAGES:
        src = (FRONTEND / rel).read_text()
        assert "useCaptureDensity" in src, f"{rel}: missing hook."
        assert "gridClass={density.gridClass}" in src, (
            f"{rel}: CaptureCardGrid must receive `density.gridClass`."
        )
        assert "minH={density.cardMinH}" in src, (
            f"{rel}: CaptureCard must receive `density.cardMinH`."
        )
        assert "subtitleLines={density.subtitleLines}" in src, (
            f"{rel}: CaptureCard must receive `density.subtitleLines`."
        )


def test_flat_pages_expose_density_control():
    """Hazards / Site Diary / Risk Assessments piggyback on
    CaptureListToolbar's `densityMode` + `onDensityChange` props.
    Pre-Starts has its own toolbar so it renders CaptureDensityControl
    inline."""
    for rel in ("pages/Hazards.jsx", "pages/SiteDiary.jsx", "pages/RiskAssessments.jsx"):
        src = (FRONTEND / rel).read_text()
        assert "densityMode={density.mode}" in src, (
            f"{rel}: CaptureListToolbar needs `densityMode` prop wired."
        )
        assert "onDensityChange={density.setMode}" in src, (
            f"{rel}: CaptureListToolbar needs `onDensityChange` prop wired."
        )
    prestarts = (FRONTEND / "pages" / "PreStarts.jsx").read_text()
    assert "CaptureDensityControl" in prestarts, (
        "PreStarts must render <CaptureDensityControl> inline in its "
        "custom toolbar row."
    )
    assert "testidPrefix=\"pre-starts\"" in prestarts


# ─── Version sync ───────────────────────────────────────────────────

def test_version_sync_current_v58_13_41():
    # v58.13.42 note: only `version.js` carries the append-only
    # changelog blocks; `version.ts` and `service-worker.js` only
    # hold the CURRENT version constant. So this guard just asserts
    # the v58.13.41 changelog header remained in `version.js` after
    # the hotfix bump.
    v_js = (FRONTEND / "lib" / "version.js").read_text()
    assert "v160.3.9.58.13.41 —" in v_js, (
        "The v58.13.41 changelog block must remain in version.js — "
        "history is append-only per the ship-checklist."
    )
