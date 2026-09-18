"""v58.13.132ia — Merge Hazard Reports INTO Incidents.

Locks:
    · IncidentCategory Literal grows a 'hazard' value in models.py.
    · incidents_router mirror_categories unions incident|hazard|near_miss.
    · Migration script exists with --commit + dry-run default + audit
      stamps (_migrated_from_hazard_id, _migrated_at, _promoted_to_incident_id).
    · Sidebar retires the 'Hazard Reports' entry.
    · App.js redirects /app/hazards → /app/incidents?type=hazard.
    · Incidents.jsx adds the 6-chip type filter + Upload PDF button +
      per-card "Source:" line. "New incident" record button retired
      from the header (per Stephen's redesign brief).
    · Version-pin `.132ia` on version.js + service-worker.js.
"""
from __future__ import annotations
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.live_db_writes

MODELS = Path("/app/backend/models.py")
CRUD = Path("/app/backend/crud.py")
MIGR = Path("/app/backend/migrations/merge_hazards_into_incidents_v58_13_132ia.py")
INC_JSX = Path("/app/frontend/src/pages/Incidents.jsx")
APP_JS = Path("/app/frontend/src/App.js")
APP_SHELL = Path("/app/frontend/src/components/layout/AppShell.jsx")
VJS = Path("/app/frontend/src/lib/version.js")
SW = Path("/app/frontend/public/service-worker.js")


def _r(p: Path) -> str:
    return p.read_text()


def test_incident_category_gains_hazard():
    src = _r(MODELS)
    assert '"near_miss", "first_aid", "medical", "ltc", "env", "property", "hazard"' in src


def test_incidents_router_unions_hazard_and_near_miss():
    src = _r(CRUD)
    assert 'mirror_categories=["incident", "hazard", "near_miss"]' in src


def test_migration_script_exists_with_commit_flag():
    assert MIGR.is_file()
    src = _r(MIGR)
    assert "--commit" in src
    assert "_migrated_from_hazard_id" in src
    assert "_promoted_to_incident_id" in src
    assert "_migration_ship" in src


def test_sidebar_hazard_reports_retired():
    src = _r(APP_SHELL)
    # nav-hazards testid gone; comment references .132ia.
    assert "'nav-hazards'" not in src
    assert "v58.13.132ia" in src


def test_app_js_redirects_hazards_to_incidents_with_type_chip():
    src = _r(APP_JS)
    assert 'to="/app/incidents?type=hazard"' in src
    # Legacy HazardsList render gone.
    assert "<HazardsList" not in src or 'element={<HazardsList' not in src


def test_incidents_page_has_type_chip_filter_and_upload_button():
    src = _r(INC_JSX)
    # Chip filter container + 6 chips.
    assert 'data-testid="incidents-type-filter"' in src
    for k in ("all", "hazard", "near_miss", "injury", "property", "env"):
        assert f'incidents-type-filter-${{c.key}}' in src or f"incidents-type-filter-{k}" in src
    assert "TYPE_CHIPS" in src
    # Upload PDF button + PdfImportModal wire-up.
    assert 'data-testid="incidents-upload-pdf-btn"' in src
    assert "<PdfImportModal" in src
    # "New incident" record button retired from header (retained on empty state).
    assert 'testid="incident-create-btn"' not in src
    # Per-card source-doc affordance.
    assert 'incidents-original-doc-' in src


def test_type_chip_url_persistence():
    src = _r(INC_JSX)
    # ?type=<chip> URL param persistence.
    assert "useSearchParams" in src
    assert "sp.get('type')" in src


def test_version_pin_v132ia():
    js = _r(VJS)
    sw = _r(SW)
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.132ia'" in js
    assert "EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ia'" in js
    assert "CACHE_VERSION = 'paneltec-v160.3.9.58.13.132ia'" in sw


# ── Migration behavioural ─────────────────────────────────────────

def test_migration_promotes_hazards_and_is_idempotent(_mongo, ephemeral_admin, ephemeral_org_id):
    """Seed 2 hazards, run the migration, confirm 2 incidents appear
    with _migrated_from_hazard_id + hazards get _promoted_to_incident_id.
    Second run finds 0 eligible rows (idempotent)."""
    import uuid
    import subprocess
    org = ephemeral_org_id
    hids = []
    for i in range(2):
        hid = f"pytest-ia-{uuid.uuid4().hex[:8]}"
        _mongo.hazards.insert_one({
            "id": hid, "org_id": org,
            "title": f"Pytest hazard #{i}", "description": "seed",
            "workspace_id": "default", "occurred_at": "2026-01-01T00:00:00Z",
            "category": "hazard", "deleted_at": None,
        })
        hids.append(hid)
    try:
        r = subprocess.run(
            ["python", str(MIGR), "--commit"],
            capture_output=True, text=True, timeout=30,
        )
        assert r.returncode == 0, r.stderr
        # 2 incidents created with the audit stamp.
        promoted = list(_mongo.incidents.find({
            "_migrated_from_hazard_id": {"$in": hids}
        }))
        assert len(promoted) == 2
        assert all(p["category"] == "hazard" for p in promoted)
        # Hazards stamped in place.
        stamped = list(_mongo.hazards.find({"id": {"$in": hids}}))
        assert all(s.get("_promoted_to_incident_id") for s in stamped)
        # Idempotent re-run — no new inserts.
        r2 = subprocess.run(
            ["python", str(MIGR), "--commit"],
            capture_output=True, text=True, timeout=30,
        )
        assert r2.returncode == 0
        count = _mongo.incidents.count_documents({
            "_migrated_from_hazard_id": {"$in": hids}
        })
        assert count == 2, f"idempotency broke: expected 2, got {count}"
    finally:
        _mongo.incidents.delete_many({"_migrated_from_hazard_id": {"$in": hids}})
        _mongo.hazards.delete_many({"id": {"$in": hids}})
