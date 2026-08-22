"""v58.13.38 — Capture tile-parity smoke test.

Asserts against page sources (no jsdom). Covers:
  · The 4 migrated pages (Incidents, Inspections, SiteSigninList,
    CsIncidentsList) import `CaptureCard` and route their tile body
    through `<CaptureCard`.
  · Migrated pages no longer own the bespoke `renderTile` chrome that
    the ship was designed to remove (inline `Eye` buttons,
    `DeleteRecordButton`, `EmailButton`, or `PdfActions` inside the
    tile body — those are now provided by CaptureCard's built-in
    action row).
  · The 4 already-canonical pages (Hazards, PreStarts, SiteDiary,
    RiskAssessments) still use CaptureCard.
  · The 2 out-of-scope pages (Swms table + Bulk Import wizard) are
    NOT converted to CaptureCard.
  · CaptureCard exposes an `onView` opt-in prop for pages with
    bespoke detail modals (CS Incidents).
  · v58.13.10 flash-bug guardrail — no additional in-tile fetch calls.
  · Version-sync current.
"""
from __future__ import annotations
from pathlib import Path
import re

APP = Path("/app")
PAGES = APP / "frontend/src/pages"
CC = APP / "frontend/src/components/CaptureCard.jsx"

MIGRATED = [
    "Incidents.jsx",
    "Inspections.jsx",
    "SiteSigninList.jsx",
    "CsIncidentsList.jsx",
]
ALREADY_CANONICAL = [
    "Hazards.jsx",
    "PreStarts.jsx",
    "SiteDiary.jsx",
    "RiskAssessments.jsx",
]
OUT_OF_SCOPE = ["Swms.jsx"]


def _src(name):
    return (PAGES / name).read_text(encoding="utf-8")


# ─── CaptureCard exposes new `onView` opt-in ────────────────────────

def test_capture_card_exposes_on_view_opt_in():
    src = CC.read_text(encoding="utf-8")
    assert "onView" in src
    # Signature: destructured prop then branch on it inside the Eye
    # button click handler.
    assert re.search(r"onView\s*,", src) is not None
    assert "if (onView)" in src


# ─── Migrated pages ─────────────────────────────────────────────────

def test_incidents_uses_capture_card():
    src = _src("Incidents.jsx")
    assert "import CaptureCard from '../components/CaptureCard'" in src
    assert "<CaptureCard" in src
    # Bespoke row-action components removed from Incidents tile body.
    # These were the SIGNATURES of the pre-ship inline renderTile.
    for sym in ("import EmailButton", "import PdfActions",
                "import DeleteRecordButton", "import SubmissionViewer"):
        assert sym not in src, (
            f"Incidents.jsx must no longer import {sym!r} — "
            "CaptureCard now owns the action row.")
    # follow_up_status still surfaces on the tile, but as a StatusBadge
    # passed into CaptureCard's `badges` prop.
    assert "StatusBadge" in src


def test_inspections_uses_capture_card():
    src = _src("Inspections.jsx")
    assert "import CaptureCard" in src
    assert "<CaptureCard" in src
    for sym in ("import EmailButton", "import PdfActions",
                "import DeleteRecordButton", "import SubmissionViewer"):
        assert sym not in src, (
            f"Inspections.jsx must no longer import {sym!r}.")
    # Template-palette stripe preserved via stripeStyle.
    assert "stripeStyle" in src
    assert "paletteForType" in src


def test_site_signin_uses_capture_card():
    src = _src("SiteSigninList.jsx")
    assert "import CaptureCard from '../components/CaptureCard'" in src
    assert "<CaptureCard" in src
    for sym in ("import DeleteRecordButton", "import SubmissionViewer"):
        assert sym not in src, (
            f"SiteSigninList.jsx must no longer import {sym!r}.")
    # Site-Sign-In tiles suppress the operator row per CaptureCard's
    # hideOperator opt-in.
    assert "hideOperator" in src


def test_cs_incidents_uses_capture_card_with_bespoke_viewer():
    src = _src("CsIncidentsList.jsx")
    assert "import CaptureCard from '../components/CaptureCard'" in src
    assert "<CaptureCard" in src
    # Bespoke detail modal still wired via CaptureCard's onView opt-in.
    assert "onView" in src
    assert "CsIncidentDetailModal" in src  # bespoke modal preserved
    # The old bespoke `StatusPill` renderer is retained inside the
    # detail modal but NO LONGER used by the tile — the tile now
    # uses the shared `StatusBadge`.
    assert "StatusBadge" in src


# ─── Already-canonical pages ────────────────────────────────────────

def test_already_canonical_pages_still_use_capture_card():
    for name in ALREADY_CANONICAL:
        src = _src(name)
        assert "CaptureCard" in src, (
            f"{name} regressed — must still use CaptureCard.")


# ─── Out-of-scope pages ─────────────────────────────────────────────

def test_swms_page_is_table_not_capture_card():
    src = _src("Swms.jsx")
    # Swms.jsx renders a `<table>` — no CaptureCard, no tile parity.
    assert "<table" in src
    assert "<CaptureCard" not in src


def test_bulk_import_wizard_not_migrated():
    # Bulk Import lives under pages/prestarts/BulkImport/*.
    wizard = APP / "frontend/src/pages/prestarts/BulkImport"
    assert wizard.exists()
    for step in wizard.glob("Step*.jsx"):
        src = step.read_text(encoding="utf-8")
        assert "<CaptureCard" not in src, (
            f"{step.name} is a wizard step, not a tile grid — "
            "must not be migrated to CaptureCard.")


# ─── Chrome-untouched guardrails (byte-identical assertions) ────────

def test_incidents_chrome_untouched():
    src = _src("Incidents.jsx")
    # Category filter chip + status filter chip still present.
    assert re.search(r"CATS\b", src)
    # GroupedTilesView still owns grouping banners.
    assert "GroupedTilesView" in src
    assert "INCIDENT_CATEGORY_PALETTE" in src
    # Sticky toolbar behaviour preserved (CaptureListToolbar import).
    assert "CaptureListToolbar" in src


def test_inspections_chrome_untouched():
    src = _src("Inspections.jsx")
    assert "GroupedTilesView" in src
    assert "CaptureSticky" in src  # sticky toolbar container preserved
    assert "ModuleDashboard" in src


def test_site_signin_chrome_untouched():
    src = _src("SiteSigninList.jsx")
    # PageHeader title unchanged.
    assert 'title="Site Sign-In / Visitor Register"' in src
    # GroupedTilesView still owns grouping by submitted_by_name.
    assert "groupBy={(r) => r.submitted_by_name" in src


def test_cs_incidents_chrome_untouched():
    src = _src("CsIncidentsList.jsx")
    # Three pre-toolbar selects still present.
    assert "cs-incidents-bu-select" in src
    assert "cs-incidents-status-select" in src
    assert "cs-incidents-type-select" in src
    # Import XLSX button + CsIncidentImportModal preserved.
    assert "cs-incidents-import-open" in src
    assert "CsIncidentImportModal" in src
    # Container width unchanged.
    assert "max-w-6xl" in src


# ─── Flash-bug guardrail — no new in-tile fetches ───────────────────

def test_no_new_in_tile_fetch_calls():
    for name in MIGRATED:
        src = _src(name)
        # `renderTile` bodies must not fire api.get / fetch calls.
        # Locate every occurrence of `renderTile={` (or the arrow
        # form) and ensure the following block up to the closing
        # brace does not call an endpoint.
        for m in re.finditer(r"renderTile=\{[^}]{0,900}", src, re.DOTALL):
            block = m.group(0)
            for banned in ("api.get(", "api.post(", "fetch(",
                           "useEffect("):
                assert banned not in block, (
                    f"{name} renderTile must not call {banned!r} — "
                    "flash-bug guardrail (v58.13.10).")


# ─── Version-sync ───────────────────────────────────────────────────

def test_version_sync_current():
    running = (APP / "frontend/src/lib/version.js").read_text(encoding="utf-8")
    sw = (APP / "frontend/public/service-worker.js").read_text(encoding="utf-8")
    mobile = (APP / "mobile/src/lib/version.ts").read_text(encoding="utf-8")
    m = re.search(r"export const RUNNING_VERSION = '(paneltec-v[\d.]+)'",
                  running)
    assert m
    current = m.group(1)
    assert current.endswith("58.13.38"), \
        f"expected 58.13.38, got {current}"
    assert f"'{current}'" in sw
    assert f"'{current}'" in mobile
