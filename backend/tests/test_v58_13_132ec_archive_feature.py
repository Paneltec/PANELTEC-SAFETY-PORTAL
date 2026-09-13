"""v58.13.132ec — Archive feature (Phase 1: backend + per-row + list toggle).

Locks the FIRST HALF of the archive ship. Bulk-archive dialog +
auto-archive rules ship in `.132ed` (see the memo).

Coverage
--------
· Backend `POST /{module}/{id}/archive` on the 6 build_router-backed
  modules (pre-starts, site-diary, hazards, incidents, inspections,
  risk-assessments) + `admin_router` on `site-visitors`.
· `POST /{module}/{id}/unarchive` and `POST /{module}/unarchive-batch/{id}`.
· `?include_archived=true` on every list endpoint.
· `X-Total-Count` header still fires (regression guard on `.132ea`).
· `archive_audit` collection captures every archive/unarchive.
· 403 for non-admins.
· Idempotent — double-archive is a no-op.
· FE: `TotalCountChip` + `ShowArchivedToggle` + archive/unarchive icon
  buttons on the 4 primary list pages. Card greys out when archived.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / "backend"))

CRUD_PY = APP_ROOT / "backend" / "crud.py"
VISITORS_PY = APP_ROOT / "backend" / "visitor_signins.py"
INDEX_SCRIPT = APP_ROOT / "backend" / "scripts" / "enable_archive_fields_v58_13_132ec.py"
CAPTURE_CARD = APP_ROOT / "frontend" / "src" / "components" / "CaptureCard.jsx"
SHOW_TOGGLE = APP_ROOT / "frontend" / "src" / "components" / "ShowArchivedToggle.jsx"
HOOK_JS = APP_ROOT / "frontend" / "src" / "lib" / "useArchiveActions.js"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

INCIDENTS = APP_ROOT / "frontend" / "src" / "pages" / "Incidents.jsx"
HAZARDS = APP_ROOT / "frontend" / "src" / "pages" / "Hazards.jsx"
RISK_ASS = APP_ROOT / "frontend" / "src" / "pages" / "RiskAssessments.jsx"
INSPECT = APP_ROOT / "frontend" / "src" / "pages" / "Inspections.jsx"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _admin_token():
    r = requests.post(
        f"{API}/api/auth/login",
        json={"email": "stephen@paneltec.com.au",
              "password": "Mcgstephen50#"},
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {tok}"}


# ─── Source-pin: backend wiring ────────────────────────────────

def test_crud_include_archived_query_param_wired():
    src = CRUD_PY.read_text(encoding="utf-8")
    assert "include_archived: bool = Query(False)" in src
    # Both native + mirror queries filter by archived_at.
    assert re.search(r'q\["archived_at"\]\s*=\s*None', src)
    assert re.search(r'mq\["archived_at"\]\s*=\s*None', src)


def test_crud_archive_endpoints_defined():
    src = CRUD_PY.read_text(encoding="utf-8")
    assert '@r.post("/{item_id}/archive")' in src
    assert '@r.post("/{item_id}/unarchive")' in src
    assert '@r.post("/unarchive-batch/{batch_id}")' in src
    # Admin gate + audit write present.
    assert 'user.get("role") != "admin"' in src
    assert "db.archive_audit.insert_one" in src


def test_visitors_archive_endpoints_defined():
    src = VISITORS_PY.read_text(encoding="utf-8")
    assert '@admin_router.post("/{visitor_id}/archive")' in src
    assert '@admin_router.post("/{visitor_id}/unarchive")' in src
    assert 'include_archived: bool = False' in src
    assert 'db.archive_audit.insert_one' in src


def test_index_script_covers_all_seven_modules():
    src = INDEX_SCRIPT.read_text(encoding="utf-8")
    for coll in ["pre_starts", "site_diary_entries", "hazards",
                 "incidents", "inspections", "site_visitors",
                 "risk_assessments", "form_submissions"]:
        assert coll in src, f"index script missing collection {coll!r}"
    # Two indexes per collection + one for the audit trail.
    assert "idx_archived_at" in src
    assert "idx_archive_batch_id" in src


# ─── Source-pin: FE wiring ────────────────────────────────────

def test_capture_card_renders_archive_button_and_grey_state():
    src = CAPTURE_CARD.read_text(encoding="utf-8")
    # Import + prop wire-up.
    assert "Archive, ArchiveRestore" in src
    assert "onArchive" in src and "onUnarchive" in src
    # Archived badge + testid.
    assert 'capture-archived-' in src
    # Icon buttons + testids.
    assert 'capture-archive-' in src
    assert 'capture-unarchive-' in src
    # Grey/opacity state when archived.
    assert 'saturate-50' in src
    assert 'isArchived' in src
    # Passes archive state to data attr for FE testing hooks.
    assert 'data-archived=' in src


def test_show_archived_toggle_component_exists():
    src = SHOW_TOGGLE.read_text(encoding="utf-8")
    assert "export default function ShowArchivedToggle" in src
    assert "value" in src and "onChange" in src
    # Distinguishes on/off visually.
    assert "bg-amber-50" in src


def test_use_archive_actions_hook_exists():
    src = HOOK_JS.read_text(encoding="utf-8")
    assert "export default function useArchiveActions" in src
    assert "/archive" in src and "/unarchive" in src
    # Optimistic update path.
    assert "setItems" in src


def _list_page_wires_toggle(page: Path, testid_prefix: str) -> None:
    src = page.read_text(encoding="utf-8")
    assert "import ShowArchivedToggle" in src, page.name
    assert "import useArchiveActions" in src, page.name
    assert "useArchiveActions" in src, page.name
    assert f'testid="{testid_prefix}-show-archived-toggle"' in src, page.name
    # v58.13.132ed — the fetch param name may be `showArchived` (Phase 1
    # wire-up) OR `includeArchivedInFetch` (Phase 2 superseded it so
    # the search bar can lift archived rows into the client-side
    # search pool without needing Show archived to be ON). Either
    # form still passes `include_archived` on the axios `params`.
    # v58.13.132ee — Phase 3 introduces a shared `load(includeArchived)`
    # callback so the FE can refetch both counts after archive; that
    # form uses `include_archived: includeArchived` inside `load`.
    assert (
        "include_archived: showArchived" in src
        or "include_archived: includeArchivedInFetch" in src
        or "include_archived: includeArchived" in src
    ), page.name
    assert "onArchive={isAdmin ? onArchive : undefined}" in src, page.name
    assert "onUnarchive={isAdmin ? onUnarchive : undefined}" in src, page.name


def test_incidents_page_wires_archive_toggle():
    _list_page_wires_toggle(INCIDENTS, "incidents")


def test_hazards_page_wires_archive_toggle():
    _list_page_wires_toggle(HAZARDS, "hazards")


def test_risk_assessments_page_wires_archive_toggle():
    _list_page_wires_toggle(RISK_ASS, "risk-assessments")


def test_inspections_page_wires_archive_toggle():
    _list_page_wires_toggle(INSPECT, "inspections")


# ─── Live HTTP behavioural ─────────────────────────────────────

@pytest.mark.live_db_writes
def test_end_to_end_archive_unarchive_round_trip():
    """Archive an incident, prove it disappears from the default list,
    prove it reappears with `include_archived=true`, unarchive it,
    prove it's back in the default list."""
    hdr = _admin_token()
    r = requests.get(f"{API}/api/incidents", headers=hdr,
                     params={"limit": 1}, timeout=30)
    assert r.status_code == 200
    items = r.json()
    if not items:
        pytest.skip("no incidents to archive")
    target_id = items[0]["id"]
    r_arch = requests.post(f"{API}/api/incidents/{target_id}/archive",
                            headers=hdr,
                            json={"reason": "pytest-round-trip"}, timeout=30)
    assert r_arch.status_code == 200, r_arch.text
    body = r_arch.json()
    assert body["ok"] is True
    batch_id = body["batch_id"]
    assert batch_id
    # Default list excludes it.
    r_list = requests.get(f"{API}/api/incidents?limit=5000", headers=hdr,
                          timeout=30)
    assert not any(i["id"] == target_id for i in r_list.json())
    # With include_archived=true it's back.
    r_arch_list = requests.get(
        f"{API}/api/incidents?include_archived=true&limit=5000",
        headers=hdr, timeout=30)
    found = [i for i in r_arch_list.json() if i["id"] == target_id]
    assert found and found[0]["archived_at"], "archived row not restored to view"
    assert found[0]["archive_batch_id"] == batch_id
    assert found[0]["archived_reason"] == "pytest-round-trip"
    # Unarchive.
    r_un = requests.post(f"{API}/api/incidents/{target_id}/unarchive",
                          headers=hdr, timeout=30)
    assert r_un.status_code == 200
    assert r_un.json()["restored_from_batch"] == batch_id
    # Default list has it again.
    r_final = requests.get(f"{API}/api/incidents?limit=5000",
                            headers=hdr, timeout=30)
    assert any(i["id"] == target_id for i in r_final.json())


@pytest.mark.live_db_writes
def test_double_archive_is_idempotent():
    hdr = _admin_token()
    items = requests.get(f"{API}/api/incidents?limit=1", headers=hdr).json()
    if not items:
        pytest.skip("no incidents")
    target = items[0]["id"]
    r1 = requests.post(f"{API}/api/incidents/{target}/archive",
                       headers=hdr, json={"reason": "idempotency"})
    assert r1.status_code == 200
    r2 = requests.post(f"{API}/api/incidents/{target}/archive",
                       headers=hdr, json={"reason": "second call"})
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2["already_archived"] is True
    assert b2["batch_id"] == r1.json()["batch_id"]
    # Clean up so other tests aren't affected.
    requests.post(f"{API}/api/incidents/{target}/unarchive", headers=hdr)


@pytest.mark.live_db_writes
def test_batch_unarchive_restores_multiple():
    """Archive one row + a second, unarchive by batch — both restored."""
    hdr = _admin_token()
    items = requests.get(f"{API}/api/incidents?limit=2",
                          headers=hdr).json()
    if len(items) < 2:
        pytest.skip("need ≥2 incidents")
    id1, id2 = items[0]["id"], items[1]["id"]
    b1 = requests.post(f"{API}/api/incidents/{id1}/archive", headers=hdr,
                        json={"reason": "batch-test"}).json()["batch_id"]
    # Force the second row into the SAME batch by writing directly.
    # The row may live in either `incidents` (native) or
    # `form_submissions` (mirrored) — try both, one write will match.
    db = _db()
    for coll in ("incidents", "form_submissions"):
        db[coll].update_one({"id": id2},
                            {"$set": {"archive_batch_id": b1,
                                      "archived_at": "2020-01-01T00:00:00+00:00",
                                      "archived_by": "system",
                                      "archived_reason": "batch-test-2"}})
    r = requests.post(f"{API}/api/incidents/unarchive-batch/{b1}",
                       headers=hdr)
    assert r.status_code == 200
    assert r.json()["restored_count"] >= 2


def test_archive_endpoint_is_admin_only():
    """A non-admin token gets 403 on archive. This test synthesizes a
    non-admin by creating a user with `role=hseq_lead` if that's the
    baseline, but easier: rely on the mobile PIN login which returns a
    non-admin `role` for many users. Skip if no non-admin PIN in reach."""
    # Try mobile PIN login for a non-admin. If PIN 3310 (Stephen's) is
    # the only one available, we can only prove the code-path via source-pin.
    src = CRUD_PY.read_text(encoding="utf-8")
    assert 'user.get("role") != "admin"' in src, (
        "admin gate missing from archive endpoints"
    )
    assert re.search(
        r'status_code=403,\s*detail="Admin only"', src
    ), "admin gate must raise 403"


def test_archive_audit_collection_is_written():
    """The archive round-trip test above already exercises this; here
    we just confirm the audit collection exists + has recent rows."""
    db = _db()
    if "archive_audit" not in db.list_collection_names():
        pytest.skip("archive_audit collection not yet initialised")
    # Assumes prior tests in this file have exercised at least one action.
    total = db.archive_audit.count_documents({})
    assert total >= 1, "no archive_audit rows written yet"


def test_x_total_count_still_emitted_post_ship():
    """Regression guard on `.132ea` — must remain green."""
    hdr = _admin_token()
    r = requests.get(f"{API}/api/incidents", headers=hdr, timeout=30)
    assert r.status_code == 200
    assert r.headers.get("X-Total-Count") is not None
    # And with include_archived=true.
    r2 = requests.get(f"{API}/api/incidents?include_archived=true",
                       headers=hdr, timeout=30)
    assert r2.status_code == 200
    # Includes archived, so count ≥ default.
    assert int(r2.headers["X-Total-Count"]) >= int(r.headers["X-Total-Count"])


def test_index_script_idempotent():
    result = subprocess.run(
        ["python", "-m",
         "backend.scripts.enable_archive_fields_v58_13_132ec",
         "--commit"],
        capture_output=True, text=True, cwd=str(APP_ROOT), timeout=60,
    )
    assert result.returncode == 0, result.stderr[:300]


# ─── Version sync ──────────────────────────────────────────────

def test_three_way_sync_at_132ec_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "ec"
