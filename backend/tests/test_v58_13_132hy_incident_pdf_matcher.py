"""v58.13.132hy — Legacy PDF matcher for incident reports.

Locks:
    · `imports.py::_FILENAME_MATCHERS` gains 6 incident-family
      patterns (near-miss, ICAM, incident investigation, incident
      report, injury report, first-aid injury).
    · Ordering: near-miss BEFORE the generic incident regex so a
      "Near Miss Report ...pdf" never mis-routes to Incident Report.
    · `_SEED_TARGETS` grows two entries (Incident Report + Near
      Miss Report). New `_seed_fallback_by_category` resolver lets
      the seed clone from any incident-category template when the
      exact clone_from name is missing in an org.
    · Version-pin `.132hy` on version.js + service-worker.js.
"""
from __future__ import annotations

import asyncio
import re
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.live_db_writes

VJS = Path("/app/frontend/src/lib/version.js")
SW = Path("/app/frontend/public/service-worker.js")
IMPORTS_PY = Path("/app/backend/imports.py")


def _read(p: Path) -> str:
    return p.read_text()


# ── Source pins ───────────────────────────────────────────────────

def test_incident_filename_matchers_present():
    src = _read(IMPORTS_PY)
    # All 6 new patterns exist.
    for needle in (
        r"near[\s_-]*miss",
        r"icam",
        r"incident[\s_-]*(?:hazard[\s_-]*)?investigation",
        r"incident[\s_-]*(?:hazard[\s_-]*)?report",
        r"injury[\s_-]*(?:report|register)",
        r"first[\s_-]*aid[\s_-]*(?:injury|report)",
    ):
        assert needle in src, f"missing matcher regex: {needle}"


def test_near_miss_matcher_ordered_before_incident():
    """Near-miss regex MUST appear before the generic incident
    regex in the tuple list — otherwise `Near Miss Report.pdf` would
    hit the incident pattern on the substring `incident` (via
    normalisation drift) and misroute."""
    src = _read(IMPORTS_PY)
    near_idx = src.index("near[\\s_-]*miss")
    incident_idx = src.index("incident[\\s_-]*(?:hazard[\\s_-]*)?report")
    assert near_idx < incident_idx, "near-miss matcher must precede incident-report matcher"


def test_seed_targets_include_incident_family():
    src = _read(IMPORTS_PY)
    # Both new seed targets present.
    assert '"Incident Report"' in src
    assert '"Near Miss Report"' in src
    # Fallback resolver defined.
    assert "async def _seed_fallback_by_category(" in src
    # Fallback wired into the seeder loop.
    assert "await _seed_fallback_by_category(" in src


def test_version_pin_v132hy():
    js = _read(VJS)
    sw = _read(SW)
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132hy'" in js
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132hy'" in js
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132hy'" in sw


# ── Behavioural — filename matcher unit tests ────────────────────

@pytest.fixture
def _templates():
    return [
        {"id": "t-incident",   "name": "Incident Report",       "category": "incident"},
        {"id": "t-near-miss",  "name": "Near Miss Report",       "category": "near_miss"},
        {"id": "t-preload",    "name": "Trailer Pre-start",      "category": "pre_start"},
        {"id": "t-other",      "name": "Some Other Template",    "category": "general"},
    ]


@pytest.mark.parametrize("filename, expected_id", [
    ("Incident Report (12345) - 20260921120101.pdf", "t-incident"),
    ("Incident_Hazard_Report_2025_SF-34.pdf",         "t-incident"),
    ("Incident Hazard Investigation Report V10.pdf",  "t-incident"),
    ("ICAM Report - Site A (7788).pdf",               "t-incident"),
    ("Incident Hazard Investigation ICAM Report.pdf", "t-incident"),
    ("Injury Report (55).pdf",                        "t-incident"),
    ("Register of Injury 2025.pdf",                   "t-incident"),
    ("First Aid Injury Report.pdf",                   "t-incident"),
    ("Near Miss Report (9876).pdf",                   "t-near-miss"),
    ("Near-Miss - 20260101.pdf",                      "t-near-miss"),
    # Pre-existing matchers still fire.
    ("Trailer - Pre-Start (4720) - 20260721.pdf",     "t-preload"),
    # Non-matching filenames fall through (return None from _match_by_filename).
    ("Random invoice.pdf",                            None),
])
def test_match_by_filename_routes_correctly(_templates, filename, expected_id):
    import sys
    sys.path.insert(0, "/app/backend")
    from imports import _match_by_filename
    hit = _match_by_filename(filename, _templates)
    if expected_id is None:
        assert hit is None
    else:
        assert hit is not None, f"filename {filename!r} did not match"
        assert hit["id"] == expected_id, (
            f"filename {filename!r} matched {hit['name']!r}, expected id {expected_id}"
        )


def test_seed_fallback_picks_shortest_incident_category_template(_mongo, ephemeral_admin, ephemeral_org_id):
    """Seed the org with 2 incident-category templates + verify
    `_seed_fallback_by_category` picks the shortest-named one."""
    org = ephemeral_org_id
    seeds = [
        {"id": f"pytest-hy-{uuid.uuid4().hex[:8]}", "org_id": org,
         "name": "Test Hot Work Permit — Very Long Name Variant",
         "category": "incident", "deleted_at": None, "fields": []},
        {"id": f"pytest-hy-{uuid.uuid4().hex[:8]}", "org_id": org,
         "name": "Incident Report Form", "category": "incident",
         "deleted_at": None, "fields": []},
    ]
    _mongo.form_templates.insert_many(seeds)
    try:
        import sys
        sys.path.insert(0, "/app/backend")
        from imports import _seed_fallback_by_category
        got = asyncio.get_event_loop().run_until_complete(
            _seed_fallback_by_category(org, "incident", ignore_name="Incident Report")
        )
        assert got is not None
        assert got["name"] == "Incident Report Form", (
            f"expected shortest incident template, got {got['name']!r}"
        )
    finally:
        _mongo.form_templates.delete_many({"org_id": org, "id": {"$in": [s["id"] for s in seeds]}})
