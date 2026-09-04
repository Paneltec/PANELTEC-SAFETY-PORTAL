"""v58.13.118a / v58.13.119 — matched/unmatched scrub + deep-link wiring.

.118a locks the removal of the three remaining matched/unmatched
surfaces from PlantMaintenanceTab.jsx:
  · The ⚠ rose PlantChip variant in the flat-view maintenance table
    (`bg-rose-100 text-rose-800` on rows with a null `plant_id`).
  · The pink "⚠ N unmatched regos" toolbar toggle + the drill-down
    panel it opened (`pm-unmatched-toggle`, `pm-unmatched-panel`,
    the entire `showUnmatched` gating).
  · The "Unknown vehicles" phantom-rego section in the grouped view
    (`pm-grouped-unmatched-section`, unmatched groups rendered as
    `matched={false}` GroupCards, the `unmatchedGroup` filter).
Plus the `/plant-maintenance/unmatched` API fetch that seeded the
retired panel is dropped from the tab's load() call.

.119 locks the `?open=<id>` deep-link wiring on the 7 pages Ask
Intelligence citations point at:
  · Incidents.jsx / Hazards.jsx / Inspections.jsx / PreStarts.jsx /
    SiteDiary.jsx — use the shared `useDeepLinkOpen` hook and pass
    `openInitially={deepLinkId === row.id}` to their CaptureCards.
  · UsersManagement.jsx — uses `useDeepLinkOpen` + an effect that
    sets `active` (the existing UserDrawer trigger) when the id
    resolves.
  · Workers.jsx — pre-existing wire from v160.3.4a (`sp.get('open')`
    + `setViewingId`); locked here as a regression pin.

The shared helper `frontend/src/lib/useDeepLinkOpen.js` strips
`open` (and optional extraParams) from the URL on mount via
`setSearchParams({...}, {replace: true})` and toasts once when the
id can't be found among the loaded items.

CaptureCard gains an `openInitially` prop that fires
`setViewerOpen(true)` on mount when truthy (one-shot; empty deps
so a re-render can't re-open a closed viewer).

Version-sync forward-safe pin >= .119.
"""
from __future__ import annotations
import re
from pathlib import Path

import pytest

PMT = Path("/app/frontend/src/pages/PlantMaintenanceTab.jsx").read_text()
CAPTURE_CARD = Path("/app/frontend/src/components/CaptureCard.jsx").read_text()
HOOK = Path("/app/frontend/src/lib/useDeepLinkOpen.js").read_text()


# ── .118a: PlantMaintenanceTab scrub ───────────────────────────────
def test_pm_tab_no_rose_plant_chip():
    # Warning-styled variant (`bg-rose-100 text-rose-800`) must be
    # gone from the file — with the amber pill retired in .118 and
    # the rose PlantChip retired in .118a, no rose classes should
    # style live UI elements.
    # The class combo is Tailwind so we look for its exact literal
    # inside a JSX className, not inside a comment.
    for m in re.finditer(r'bg-rose-100 text-rose-800', PMT):
        # Comments won't contain the exact JSX pattern — they'd wrap
        # the phrase differently. Fail on any survivor.
        line_start = PMT.rfind('\n', 0, m.start()) + 1
        line = PMT[line_start:PMT.find('\n', m.start())]
        assert line.lstrip().startswith('//'), \
            f"live rose PlantChip styling survived at: {line[:120]}"
    # The ⚠ symbol on the rego chip is gone.
    assert '⚠ {row.registration_no' not in PMT
    # The scrub note is source-pinned.
    assert 'Neutral rego chip' in PMT or 'v58.13.118a' in PMT


def test_pm_tab_no_unknown_vehicles_grouped_section():
    assert 'pm-grouped-unmatched-section' not in PMT
    # Live JSX cannot contain the phrase "Unknown vehicles" — comments
    # can, but not rendered strings.
    for m in re.finditer(r'Unknown vehicles', PMT):
        line_start = PMT.rfind('\n', 0, m.start()) + 1
        line = PMT[line_start:PMT.find('\n', m.start())]
        stripped = line.lstrip()
        assert stripped.startswith('//') or stripped.startswith('*'), (
            f"live 'Unknown vehicles' string survived at: {line[:120]}"
        )
    # The retired `unmatchedGroup` client-side filter is gone.
    assert 'const unmatchedGroup' not in PMT


def test_pm_tab_grouped_count_strip_matched_only():
    # Live JSX count strip mustn't mention "unmatched regos". Comments
    # can reference the retired string as ship history.
    for m in re.finditer(r'unmatched regos', PMT):
        line_start = PMT.rfind('\n', 0, m.start()) + 1
        line = PMT[line_start:PMT.find('\n', m.start())]
        stripped = line.lstrip()
        assert stripped.startswith('//') or stripped.startswith('*'), (
            f"live 'unmatched regos' text survived at: {line[:120]}"
        )
    # Flat-view count is untouched.
    assert 'maintenance records' in PMT


def test_pm_tab_dropped_unmatched_api_fetch():
    # The load() function no longer parallel-fetches the retired
    # `/plant-maintenance/unmatched` endpoint.
    assert "'/plant-maintenance/unmatched'" not in PMT
    assert 'Dropped the `/plant-maintenance/unmatched` fetch' in PMT


def test_pm_tab_import_toast_no_matched_unmatched_split():
    # The import-result toast no longer parrots the backend's
    # matched/unmatched split; only the neutral counters remain.
    assert '${resp.matched}' not in PMT
    assert '${resp.unmatched}' not in PMT
    assert 'Total records' in PMT


# ── .119: shared hook + CaptureCard prop ──────────────────────────
def test_use_deep_link_open_hook_present():
    assert Path("/app/frontend/src/lib/useDeepLinkOpen.js").exists()
    assert "useSearchParams" in HOOK
    assert "sp.get('open')" in HOOK
    assert 'setSp(next, { replace: true })' in HOOK
    assert 'clearDeepLink' in HOOK


def test_capture_card_open_initially_prop():
    assert 'openInitially = false' in CAPTURE_CARD
    assert 'if (openInitially) setViewerOpen(true)' in CAPTURE_CARD


# ── .119: per-page wiring pins ────────────────────────────────────
@pytest.mark.parametrize("page,label", [
    ("/app/frontend/src/pages/Incidents.jsx",       "Linked incident not found"),
    ("/app/frontend/src/pages/Hazards.jsx",         "Linked hazard not found"),
    ("/app/frontend/src/pages/Inspections.jsx",     "Linked inspection not found"),
    ("/app/frontend/src/pages/PreStarts.jsx",       "Linked pre-start not found"),
    ("/app/frontend/src/pages/SiteDiary.jsx",       "Linked diary entry not found"),
    ("/app/frontend/src/pages/UsersManagement.jsx", "Linked user not found"),
])
def test_page_uses_deep_link_hook(page, label):
    src = Path(page).read_text()
    assert "useDeepLinkOpen" in src, f"{page} missing useDeepLinkOpen import/call"
    assert label in src, f"{page} missing not-found message '{label}'"


@pytest.mark.parametrize("page", [
    "/app/frontend/src/pages/Incidents.jsx",
    "/app/frontend/src/pages/Hazards.jsx",
    "/app/frontend/src/pages/Inspections.jsx",
    "/app/frontend/src/pages/PreStarts.jsx",
    "/app/frontend/src/pages/SiteDiary.jsx",
])
def test_capture_card_page_passes_open_initially(page):
    src = Path(page).read_text()
    # Every CaptureCard-based page threads deepLinkId → openInitially.
    assert re.search(r"openInitially=\{deepLinkId === [a-zA-Z_]+\.id\}", src), (
        f"{page} does not pass openInitially={{deepLinkId === row.id}} to CaptureCard"
    )


def test_users_management_wires_active_from_deep_link():
    src = Path("/app/frontend/src/pages/UsersManagement.jsx").read_text()
    # On deep-link resolve, the drawer trigger (`setActive`) fires.
    assert "if (!deepLinkId || active) return;" in src
    assert "users.find((u) => u.id === deepLinkId)" in src
    assert "setActive(row);" in src


def test_workers_page_preserves_pre_existing_deep_link():
    # v160.3.4a wire — regression pin. Workers.jsx already reads
    # `?open=<id>&tab=` from useSearchParams and pins it to
    # `viewingId`.
    src = Path("/app/frontend/src/pages/Workers.jsx").read_text()
    assert "useSearchParams" in src
    assert "sp.get('open')" in src
    assert "setViewingId(openId)" in src


# ── Version sync forward-safe pin ─────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_119():
    for label, path in (
        ("frontend/version.js", "/app/frontend/src/lib/version.js"),
        ("service-worker.js", "/app/frontend/public/service-worker.js"),
        ("mobile/version.ts", "/app/mobile/src/lib/version.ts"),
    ):
        blob = Path(path).read_text()
        tails = [(int(m.group(1)), m.group(2))
                 for m in _VERSION_TAIL_RE.finditer(blob)]
        assert tails, f"{label} has no version tail"
        highest = max(tails)
        assert highest >= (119, ""), f"{label} latest tail={highest} < (119, '')"
