"""v58.13.132fv — Incident view route fix + date-fallback audit."""
from __future__ import annotations

from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
INCIDENTS_TBL = APP_ROOT / "frontend" / "src" / "components" / "IncidentsTable.jsx"
INCIDENTS_JSX = APP_ROOT / "frontend" / "src" / "pages" / "Incidents.jsx"
APP_JS = APP_ROOT / "frontend" / "src" / "App.js"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p): return p.read_text(encoding="utf-8")


def test_incident_view_button_uses_deep_link_not_broken_route():
    """`/app/incidents/${id}` isn't registered in App.js — only
    `/app/incidents` and `/app/incidents/new`. Mel's "can't view
    incident reports" reproduced from the table View button
    navigating to a non-existent route. .132fv swaps the target to
    `/app/incidents?open=${id}` which the existing deepLinkId flow
    on Incidents.jsx already honours."""
    src = _read(INCIDENTS_TBL)
    assert "/app/incidents?open=" in src, (
        "IncidentsTable View button must use the ?open=<id> deep-link "
        "form introduced in .132fv")
    assert "navigate(`/app/incidents/${r.id}`)" not in src, (
        "the broken /app/incidents/<id> route must not be used any more")
    app = _read(APP_JS)
    assert 'path="incidents"' in app or "path='incidents'" in app
    assert 'path="incidents/:' not in app and "path='incidents/:" not in app, (
        "if a /incidents/:id detail route is added later, revisit this pin.")


def test_incidents_date_column_falls_back_to_occurred_at():
    """The incidents card + table date should surface the business
    date (occurred_at) first, falling back to created_at."""
    tbl = _read(INCIDENTS_TBL)
    assert "r.occurred_at || r.created_at" in tbl, (
        "IncidentsTable date column must prefer occurred_at over created_at")
    page = _read(INCIDENTS_JSX)
    assert "i.occurred_at || i.created_at" in page, (
        "Incidents cards dateFn must prefer occurred_at over created_at")


def test_version_bumped_to_132fv():
    assert "paneltec-v160.3.9.58.13.132fv" in _read(VERSION_JS)
    assert "paneltec-v160.3.9.58.13.132fv" in _read(SW)
