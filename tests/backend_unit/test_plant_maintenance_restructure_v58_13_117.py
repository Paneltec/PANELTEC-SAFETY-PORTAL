"""v58.13.117 — Plant Maintenance tab restructure + detail drawer tests.

Locks:
  · `PlantVehicles.jsx` no longer registers the top-level Unmatched
    TabsTrigger or its TabsContent.
  · `PlantMaintenanceTab.jsx` renders a two-row chip layout: primary
    category row driven by maintenance_type + secondary match row.
  · Category filter state (`categoryFilter`) drives the visible rows
    via the useMemo(filter) block.
  · "Other" chip label + amber styling when maintenance_type is null
    ("__none" key); tooltip "Category not set on import".
  · Chip counts recompute off the loaded `items` array so any filter
    change / edit / import re-renders live counts.
  · Row click opens the new right-side drawer via `setDrawerRow(row)`
    — the pre-.117 inline expansion (`isOpen && <div>…</div>`) is
    gone. Drawer carries Print + Close, Esc-to-close wired, and an
    Unmatched amber "coming in v58.13.117a" note.
  · Version-sync forward-safe pin >= .117.
"""
from __future__ import annotations
import re
from pathlib import Path


PV = Path("/app/frontend/src/pages/PlantVehicles.jsx").read_text()
PMT = Path("/app/frontend/src/pages/PlantMaintenanceTab.jsx").read_text()
DRAWER = Path("/app/frontend/src/components/vehicles/PlantMaintenanceDrawer.jsx").read_text()


# ── PlantVehicles: Unmatched top tab removed ────────────────────────
def test_unmatched_tabtrigger_removed():
    assert 'value="unmatched"' not in PV
    assert 'vehicles-tab-unmatched' not in PV
    assert 'vehicles-tab-unmatched-count' not in PV


def test_unmatched_tabcontent_removed():
    assert 'vehicles-tab-unmatched-content' not in PV
    assert 'initialPlantFilter="unmatched"' not in PV


# ── PlantMaintenanceTab: two-row chip layout ────────────────────────
def test_category_chip_row_present():
    assert 'data-testid="pm-chip-rows"' in PMT
    assert 'data-testid="pm-category-chip-row"' in PMT
    assert 'data-testid="pm-cat-all"' in PMT
    # Category row lives ABOVE the Match state chip row.
    assert PMT.index('pm-category-chip-row') < PMT.index('pm-match-chip-row')


def test_match_state_chip_row_demoted_but_kept():
    assert 'data-testid="pm-match-chip-row"' in PMT
    # The three canonical match filters still exist.
    for tid in ("pm-filter-all", "pm-filter-matched", "pm-filter-unmatched"):
        assert f'data-testid={{`{tid}`}}' in PMT or f'data-testid="{tid}"' in PMT \
            or f"data-testid={{`pm-filter-${{opt.k}}`}}" in PMT
    # Match-row is labelled "Match state" so admins recognise its
    # demoted role.
    assert '>Match state<' in PMT


def test_category_filter_state_and_effect():
    assert "const [categoryFilter, setCategoryFilter] = useState('all')" in PMT
    assert "categoryFilter !== 'all'" in PMT
    assert "categoryFilter === '__none'" in PMT
    # Filter memo re-runs when categoryFilter changes.
    assert re.search(r"}, \[items, q, plantFilter, categoryFilter\]\)", PMT)


def test_none_bucket_labelled_other_with_tooltip():
    assert "'Category not set on import'" in PMT
    assert "'__none'" in PMT
    assert "label: 'Other'" in PMT
    assert "missing: true" in PMT


def test_category_counts_computed_from_items():
    # useMemo whose deps are [items] — that guarantees counts live-
    # update after every load / import / edit.
    assert "categoryCounts" in PMT
    assert re.search(r"const categoryCounts = useMemo\(", PMT)
    assert re.search(r"}, \[items\]\)", PMT)


# ── Row click → drawer, no more inline expansion ────────────────────
def test_row_click_opens_drawer_not_inline():
    # Old inline expansion is GONE.
    assert 'expanded === row.id' not in PMT
    assert re.search(r"pm-detail-\$\{row\.maintenance_id\}", PMT) is None
    # New onClick sets drawerRow.
    assert 'onClick={() => setDrawerRow(row)}' in PMT
    # Drawer mounted at the end of the tab JSX.
    assert '<PlantMaintenanceDrawer' in PMT
    assert 'row={drawerRow}' in PMT
    assert 'onClose={() => setDrawerRow(null)}' in PMT


# ── PlantMaintenanceDrawer contract ─────────────────────────────────
def test_drawer_testids_present():
    for tid in ("pm-drawer-backdrop", "pm-drawer-close", "pm-drawer-print",
                "pm-printable"):
        assert f'data-testid="{tid}"' in DRAWER, f"missing {tid}"
    # Drawer aside itself has a dynamic testid keyed by maintenance_id.
    assert re.search(r'data-testid=\{`pm-drawer-\$\{row\.maintenance_id\}`\}', DRAWER)


def test_drawer_esc_key_closes():
    assert "'Escape'" in DRAWER
    assert "window.addEventListener('keydown'" in DRAWER
    # Cleanup on unmount so a stale listener can't keep firing.
    assert "removeEventListener('keydown'" in DRAWER


def test_drawer_print_reuses_113_portal():
    # Reuse the risk-print-root CSS class from .113.
    assert 'risk-print-root' in DRAWER
    assert 'window.print()' in DRAWER
    assert 'afterprint' in DRAWER
    # Portal to document.body (same defence-in-depth pattern as .113).
    assert 'createPortal(card, document.body)' in DRAWER


def test_drawer_shows_unmatched_flag_and_117a_note():
    # Amber unmatched pill in the header when plant_id is falsy.
    assert 'const unmatched = !row.plant_id' in DRAWER
    # And the coming-in-.117a note in the body when unmatched.
    assert 'Link to asset — coming in v58.13.117a' in DRAWER


def test_drawer_renders_all_expected_fields():
    # Field labels source-pinned so a schema drift or accidental rename
    # gets caught by CI.
    for lbl in ('label="Category"', 'label="Asset kind"', 'label="Sub-type"',
                'label="Status"', 'label="Completed"', 'label="Due"',
                'label="Description"', 'label="Notes"', 'label="Registration"',
                'label="Asset code"', 'label="Manufacturer"',
                'label="Latest usage reading"', 'label="Linked asset id"',
                'label="Performed by"', 'label="Company"', 'label="Cost"',
                'label="Imported at"', 'label="Imported by"',
                'label="Created at"', 'label="Updated at"'):
        assert lbl in DRAWER, f"missing drawer field {lbl}"


# ── Version sync forward-safe pin ────────────────────────────────────
_VERSION_TAIL_RE = re.compile(r"paneltec-v[\d.]+\.58\.13\.(\d+)([a-z]?)")


def test_version_bumps_meet_117():
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
        assert highest >= (117, ""), f"{label} latest tail={highest} < (117, '')"
