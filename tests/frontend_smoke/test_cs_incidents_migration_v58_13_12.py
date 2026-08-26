"""v58.13.12 — CS Incident → Submissions migration smoke checks.

Static-grep checks that every seam of the nav/route migration
actually landed. Runtime behaviour is out of scope for pytest here —
these guard against half-landed refactors where App.js has the route
but AppShell doesn't have the nav item (or vice versa).

Location: `/app/tests/frontend_smoke/` — outside `--reload-dir
/app/backend`, per the v58.13.10 hard rule.
"""
from __future__ import annotations

from pathlib import Path

APP_JS = Path("/app/frontend/src/App.js")
APP_SHELL = Path("/app/frontend/src/components/layout/AppShell.jsx")
RISK_PAGE = Path("/app/frontend/src/pages/RiskAssessments.jsx")
NEW_PAGE = Path("/app/frontend/src/pages/CsIncidentsList.jsx")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ─── Route seam ────────────────────────────────────────────────────────

def test_route_registered_in_app_js():
    src = _read(APP_JS)
    assert 'path="submissions/cs-incidents"' in src, (
        "App.js must register the new `/app/submissions/cs-incidents` "
        "route."
    )
    assert 'CsIncidentsList' in src, (
        "App.js must import the new CsIncidentsList page."
    )


def test_bare_submissions_redirects_to_cs_incidents():
    src = _read(APP_JS)
    assert 'path="submissions"' in src and \
        'to="/app/submissions/cs-incidents"' in src, (
            "A bare `/app/submissions` must redirect to "
            "`/app/submissions/cs-incidents`."
        )


# ─── Nav seam ──────────────────────────────────────────────────────────

def test_nav_item_present_in_appshell():
    src = _read(APP_SHELL)
    assert "nav-submissions-cs-incidents" in src, (
        "AppShell must expose a `nav-submissions-cs-incidents` "
        "NavLink."
    )
    assert "/app/submissions/cs-incidents" in src, (
        "AppShell NavLink must point at the new route."
    )


# ─── RiskAssessments cleanup seam ──────────────────────────────────────

def test_risk_assessments_no_longer_renders_cs_incident_tab():
    src = _read(RISK_PAGE)
    assert "CsIncidentTab" not in src, (
        "RiskAssessments.jsx must no longer import or render "
        "CsIncidentTab — the tab has moved to its own page."
    )
    # Structural check: the TABS array must not contain a
    # `{ key: 'cs_incident', ... }` entry. The bare token
    # `cs_incident` still legitimately appears inside the legacy-URL
    # redirect (`tab === 'cs_incident'`) so we can't grep for the
    # bare identifier.
    assert "key: 'cs_incident'" not in src, (
        "RiskAssessments TABS array must not contain the "
        "`cs_incident` key any more."
    )


def test_risk_assessments_redirects_old_bookmarks():
    src = _read(RISK_PAGE)
    assert "tab=cs_incident" in src, (
        "RiskAssessments must detect the legacy `?tab=cs_incident` "
        "query and redirect."
    )
    assert "/app/submissions/cs-incidents" in src, (
        "The redirect target must be the new route."
    )


# ─── New page contract ─────────────────────────────────────────────────

def test_new_page_uses_grouped_tiles_view():
    src = _read(NEW_PAGE)
    assert "GroupedTilesView" in src, (
        "The new list page must render via GroupedTilesView — "
        "matching the Inspections / Incidents / Site Sign-In UX."
    )
    assert "groupBy" in src and "renderTile" in src, (
        "GroupedTilesView must be invoked with groupBy + renderTile "
        "props."
    )


def test_tile_view_button_stops_propagation():
    # v58.13.10 flash-bug guardrail. If a future edit accidentally
    # drops `e.stopPropagation()` on the tile's View trigger, the
    # detail modal will flash and close because the same click will
    # bubble into the freshly-mounted backdrop.
    src = _read(NEW_PAGE)
    assert "e.stopPropagation()" in src, (
        "Every tile action button in the new page must "
        "e.stopPropagation() to avoid the v58.13.10 flash-bug "
        "regression."
    )


def test_new_page_preserves_import_endpoint():
    # The XLSX Import modal must POST to the same endpoint the old
    # tab used — no data path change.
    src = _read(NEW_PAGE)
    assert "/cs-incident/reimport" in src


def test_new_page_reuses_shared_crud_modal():
    src = _read(NEW_PAGE)
    assert "useCrudModal" in src, (
        "Add / Edit / Delete must continue to run through the "
        "shared `useCrudModal` — the create/edit flow is intentionally "
        "unchanged this ship."
    )
