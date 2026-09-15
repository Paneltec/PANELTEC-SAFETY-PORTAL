"""v58.13.132gn — SSRA business-date column."""
from __future__ import annotations
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
FE = APP_ROOT / "frontend" / "src"
HELPER = FE / "lib" / "deriveAssessmentDate.js"
CAPTURE = FE / "components" / "CaptureCard.jsx"
FORMSUBS = FE / "pages" / "FormSubmissions.jsx"
VJS = FE / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"


def _read(p): return p.read_text(encoding="utf-8")


def test_helper_exists_and_scans_fields():
    src = _read(HELPER)
    assert "export default function deriveAssessmentDate" in src
    assert "type !== 'date'" in src
    assert "/^\\d{4}-\\d{2}-\\d{2}/" in src
    assert "record.assessment_date" in src  # backend override wins


def test_capture_card_prefers_derived_date():
    src = _read(CAPTURE)
    assert "import deriveAssessmentDate" in src
    assert "deriveAssessmentDate(r)\n    || r.date" in src


def test_form_submissions_column_relabelled_and_uses_derived():
    src = _read(FORMSUBS)
    assert "import deriveAssessmentDate" in src
    assert '>Date</th>' in src
    assert '>When</th>' not in src
    assert 'submission-date-' in src  # new data-testid
    assert 'deriveAssessmentDate(r)' in src


def test_version_bumped_to_132gn():
    js, sw = _read(VJS), _read(SW)
    assert re.search(r"RUNNING_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gn'", js)
    assert re.search(r"EXPECTED_CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gn'", js)
    assert re.search(r"CACHE_VERSION = 'paneltec-v160\.3\.9\.58\.13\.132gn'", sw)
