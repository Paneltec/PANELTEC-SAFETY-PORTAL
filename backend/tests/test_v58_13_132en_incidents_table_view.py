"""v58.13.132en — Incident Reports · Cards | Table view toggle.

Source-pin lock for the new `<IncidentsTable />` component + the
`[Cards | Table]` segmented toggle wired into `Incidents.jsx`.
Table view supplies the same items array as Cards (no new API);
mode persists to `localStorage.incidents.viewMode`.
"""
from __future__ import annotations

import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
TABLE = FE / "components" / "IncidentsTable.jsx"
INCIDENTS = FE / "pages" / "Incidents.jsx"
VERSION_JS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


# ── IncidentsTable component ──────────────────────────────────────

def test_incidents_table_exists_and_default_exports():
    src = _read(TABLE)
    assert "export default function IncidentsTable" in src
    assert "export function usePersistedViewMode" in src


def test_incidents_table_has_all_8_columns():
    """CS # · Date · Type · Severity · Site · Reporter · Status · Actions"""
    src = _read(TABLE)
    for label in ("'CS #'", "'Date'", "'Type'", "'Severity'",
                  "'Site'", "'Reporter'", "'Status'"):
        assert label in src, f"Table column label {label} missing"
    # Actions header is not in the COLS array — it's rendered as a
    # dedicated <th>Actions</th> at the end of the thead row.
    assert ">Actions<" in src


def test_incidents_table_zebra_and_archived():
    """Alternating bg-white / bg-slate-100 zebra + archived greyed out."""
    src = _read(TABLE)
    assert "idx % 2 === 1 ? 'bg-slate-100 ' : 'bg-white '" in src
    assert "isArchived ? 'opacity-60 saturate-50 ' : ''" in src


def test_incidents_table_sticky_header():
    src = _read(TABLE)
    assert "sticky top-0" in src
    assert "max-h-[70vh]" in src


def test_incidents_table_sortable_columns():
    """Each column header is clickable + toggles asc/desc."""
    src = _read(TABLE)
    assert "onClick={() => toggleSort(c.key)}" in src
    assert "setSortDir(sortDir === 'asc' ? 'desc' : 'asc')" in src
    # Every column emits a testid
    assert "incidents-table-th-${c.key}" in src


def test_incidents_table_actions_include_view_pdf_and_archive():
    src = _read(TABLE)
    # View
    assert "incidents-table-view-${r.id}" in src
    assert "navigate(`/app/incidents/${r.id}`)" in src
    # Download PDF via shared <PdfActions resourceKind="incidents" />
    assert "import PdfActions from './PdfActions'" in src
    assert 'resourceKind="incidents"' in src
    # Archive / Restore (admin-only)
    assert "incidents-table-archive-${r.id}" in src
    assert "incidents-table-unarchive-${r.id}" in src


def test_persisted_view_mode_hook_uses_localStorage():
    src = _read(TABLE)
    assert "localStorage.getItem(key)" in src
    assert "localStorage.setItem(key, mode)" in src
    assert "'cards'" in src and "'table'" in src


# ── Incidents.jsx wiring ──────────────────────────────────────────

def test_incidents_page_imports_table_and_hook():
    src = _read(INCIDENTS)
    assert (
        "import IncidentsTable, { usePersistedViewMode } "
        "from '../components/IncidentsTable';"
    ) in src


def test_incidents_page_persists_view_mode_to_localStorage_key():
    src = _read(INCIDENTS)
    assert "usePersistedViewMode('incidents.viewMode', 'cards')" in src


def test_incidents_page_renders_view_mode_toggle_with_testids():
    src = _read(INCIDENTS)
    assert 'data-testid="incidents-view-mode-toggle"' in src
    assert 'data-testid="incidents-view-mode-cards"' in src
    assert 'data-testid="incidents-view-mode-table"' in src


def test_incidents_page_conditional_render_table_vs_cards():
    """Table branch feeds `searchFiltered` (same source as Cards)."""
    src = _read(INCIDENTS)
    assert "{viewMode === 'table' ? (" in src
    assert "<IncidentsTable" in src
    assert "items={searchFiltered}" in src
    # Cards branch preserved (GroupedTilesView still consumes searchFiltered)
    assert "<GroupedTilesView" in src


# ── Version-sync ──────────────────────────────────────────────────

def test_version_pinned_to_132en_or_higher():
    v = _read(VERSION_JS)
    sw = _read(SW)
    m_v = re.search(r"RUNNING_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", v)
    m_sw = re.search(r"CACHE_VERSION\s*=\s*'paneltec-v[\d.]+\.132([a-z]{2})'", sw)
    assert m_v and m_v.group(1) >= "en", f"RUNNING_VERSION suffix must be >= 132en, got {m_v and m_v.group(1)}"
    assert m_sw and m_sw.group(1) >= "en", f"CACHE_VERSION suffix must be >= 132en, got {m_sw and m_sw.group(1)}"
