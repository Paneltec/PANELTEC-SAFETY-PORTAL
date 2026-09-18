"""v58.13.132hz — Dedicated SSRA capture surface under Capture.

Locks the frontend source contract (backend unchanged — reuses
`/api/risk-assessments`):
    · `frontend/src/pages/capture/SsraCapture.jsx` exists with the
      right testids, filter regex, and PdfImportModal wire-up.
    · `App.js` mounts the `capture/ssra` route.
    · `AppShell.jsx` sidebar carries the `nav-capture-ssra` entry
      under the Capture section.
    · Version-pin `.132hz` on version.js + service-worker.js.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.live_db_writes

VJS = Path("/app/frontend/src/lib/version.js")
SW = Path("/app/frontend/public/service-worker.js")
APP_JS = Path("/app/frontend/src/App.js")
APP_SHELL = Path("/app/frontend/src/components/layout/AppShell.jsx")
SSRA_JSX = Path("/app/frontend/src/pages/capture/SsraCapture.jsx")


def _read(p: Path) -> str:
    return p.read_text()


def test_ssra_capture_page_exists():
    assert SSRA_JSX.is_file(), "SsraCapture.jsx missing"
    src = _read(SSRA_JSX)
    # Page mounts under `capture-ssra-page` testid.
    assert 'data-testid="capture-ssra-page"' in src
    # Upload PDF header button + PdfImportModal wired.
    assert 'data-testid="capture-ssra-upload-pdf-btn"' in src
    assert "import PdfImportModal" in src
    assert "<PdfImportModal" in src
    # SSRA classifier regex present.
    assert "SSRA_RE" in src
    assert "/ssra|site" in src
    # Data source is the shared risk-assessments endpoint.
    assert "api.get('/risk-assessments'" in src
    # "View original document" — source-doc affordance.
    assert 'capture-ssra-original-doc-' in src
    assert "imported_from_pdf" in src


def test_app_js_mounts_capture_ssra_route():
    src = _read(APP_JS)
    # Route + import both present.
    assert "import SsraCapture from '@/pages/capture/SsraCapture'" in src
    assert 'path="capture/ssra"' in src
    assert "<SsraCapture" in src


def test_sidebar_has_capture_ssra_entry():
    src = _read(APP_SHELL)
    # Sidebar entry present.
    assert "'nav-capture-ssra'" in src
    assert "/app/capture/ssra" in src
    # Sits under the Capture section (after the nav-risk-assessments entry).
    ssra_idx = src.index("'nav-capture-ssra'")
    risk_idx = src.index("'nav-risk-assessments'")
    assert risk_idx < ssra_idx, "SSRA sidebar entry must sit after Risk Assessments"


def test_version_pin_v132hz():
    js = _read(VJS)
    sw = _read(SW)
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132hz'" in js
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132hz'" in js
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132hz'" in sw


# ── Regex behaviour ───────────────────────────────────────────────

@pytest.mark.parametrize("name, expected", [
    ("Drain Cleaning SSRA", True),
    ("Viatec Traffic Solutions SSRA", True),
    ("Construction & Excavation SSRA", True),
    ("Site Specific Risk Assessment - Excavation", True),
    ("TTM Risk Assessment & Treatment Register", False),  # NOT an SSRA
    ("Master Risks", False),
    ("Trailer Pre-start", False),
    ("Incident Report", False),
])
def test_ssra_classifier_regex_matches_expected(name, expected):
    """v58.13.132hz — Client-side classifier: template names must
    match /ssra|site[\\s_-]*specific[\\s_-]*risk/i. TTM registers
    (canonical `risk_assessment` category) must NOT be classified
    as SSRA so the /capture/ssra list stays focused."""
    pat = re.compile(r"ssra|site[\s_-]*specific[\s_-]*risk", re.I)
    got = bool(pat.search(name))
    assert got == expected, f"{name!r}: got {got}, expected {expected}"
