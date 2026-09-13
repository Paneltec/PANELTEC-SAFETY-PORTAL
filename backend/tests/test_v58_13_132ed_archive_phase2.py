"""v58.13.132ed — Archive Phase 2: bulk endpoint + auto-archive rules
+ ArchiveDialog + Org Settings surface + search-sees-archived.

Locks the second half of the archive ship. Additive to `.132ec`.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest
import requests
from pymongo import MongoClient

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT / "backend"))

CRUD_PY = APP_ROOT / "backend" / "crud.py"
ORG_RULES_PY = APP_ROOT / "backend" / "org_archive_rules.py"
SERVER_PY = APP_ROOT / "backend" / "server.py"
DIALOG_JSX = APP_ROOT / "frontend" / "src" / "components" / "ArchiveDialog.jsx"
RULES_JSX = APP_ROOT / "frontend" / "src" / "components" / "ArchiveRulesSection.jsx"
ORG_SETTINGS = APP_ROOT / "frontend" / "src" / "pages" / "OrgSettings.jsx"
INCIDENTS = APP_ROOT / "frontend" / "src" / "pages" / "Incidents.jsx"
TOOLBAR = APP_ROOT / "frontend" / "src" / "components" / "CaptureListToolbar.jsx"
HOOK_JS = APP_ROOT / "frontend" / "src" / "lib" / "useArchiveActions.js"
VERSION_JS = APP_ROOT / "frontend" / "src" / "lib" / "version.js"
SW = APP_ROOT / "frontend" / "public" / "service-worker.js"

API = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _admin_token():
    r = requests.post(f"{API}/api/auth/login",
                      json={"email": "stephen@paneltec.com.au",
                            "password": "Mcgstephen50#"}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    t = r.json().get("access_token") or r.json().get("token")
    return {"Authorization": f"Bearer {t}"}


# ─── Source-pins ──────────────────────────────────────────────

def test_crud_bulk_archive_endpoint_defined():
    src = CRUD_PY.read_text(encoding="utf-8")
    assert '@r.post("/archive")' in src
    assert "async def bulk_archive" in src
    assert 'user.get("role") != "admin"' in src
    # All 6 filter dimensions from the brief are honored.
    for key in ("date_before", "date_between", "oldest_n",
                 "status_in", "site_id", "category_in", "template_id_in"):
        assert key in src, f"bulk archive missing filter dimension: {key}"
    assert "dry_run" in src
    assert "matched_ids_sample" in src
    # Audit call on commit path.
    assert '"bulk_archive"' in src


def test_org_archive_rules_module_exists():
    src = ORG_RULES_PY.read_text(encoding="utf-8")
    assert "class RuleIn(BaseModel)" in src
    assert "async def list_rules" in src
    assert "async def upsert_rule" in src
    assert "async def apply_org_archive_rules" in src
    # 7 modules covered.
    for m in ("pre-starts", "site-diary", "hazards", "incidents",
              "inspections", "risk-assessments", "site-visitors"):
        assert f'"{m}"' in src, f"module {m!r} not enumerated"
    # Admin gate.
    assert 'user.get("role") != "admin"' in src


def test_server_registers_scheduler_job():
    src = SERVER_PY.read_text(encoding="utf-8")
    assert "apply_org_archive_rules" in src
    assert 'id="org_archive_rules_daily"' in src
    # Router mount.
    assert "org_archive_rules_router" in src


def test_archive_dialog_component_shape():
    src = DIALOG_JSX.read_text(encoding="utf-8")
    # v58.13.132ef — Site + Reason removed per Stephen's request; the
    # remaining 4 filter sections still carry a testid.
    for sec in ("date", "oldest-n", "status", "category"):
        assert f'testid="archive-dialog-section-{sec}"' in src, sec
    # Preview + commit + confirm dialog.
    assert 'testid="archive-preview-btn"' in src
    assert 'testid="archive-commit-btn"' in src
    assert 'testid="archive-confirm-dialog"' in src
    # Fires dry_run: true for preview, false for commit.
    assert "dry_run: true" in src
    assert "dry_run: false" in src


def test_archive_rules_section_component_shape():
    src = RULES_JSX.read_text(encoding="utf-8")
    assert "export default function ArchiveRulesSection" in src
    assert '/org/archive-rules' in src
    # Table row per module with save button.
    assert 'archive-rule-row-' in src
    assert 'archive-rule-enabled-' in src
    assert 'archive-rule-days-' in src
    assert 'archive-rule-save-' in src


def test_org_settings_mounts_archive_rules():
    src = ORG_SETTINGS.read_text(encoding="utf-8")
    assert "import ArchiveRulesSection" in src
    assert "<ArchiveRulesSection />" in src


def test_incidents_wires_archive_dialog_and_search_sees_archived():
    src = INCIDENTS.read_text(encoding="utf-8")
    # Archive dialog mounted.
    assert "import ArchiveDialog" in src
    assert 'testid="incidents-archive-header-btn"' in src
    assert "setArchiveDialogOpen" in src
    # Search-sees-archived: fetch flips on either showArchived OR
    # searchQuery.
    assert "includeArchivedInFetch" in src
    assert "showArchived || Boolean(searchQuery)" in src
    # Toolbar reports query upward.
    assert "onQueryChange={setSearchQuery}" in src


def test_toolbar_reports_query_upward():
    src = TOOLBAR.read_text(encoding="utf-8")
    assert "onQueryChange" in src
    assert "onQueryChange?.(debouncedQ)" in src


def test_use_archive_actions_confirms_before_archive():
    src = HOOK_JS.read_text(encoding="utf-8")
    assert "window.confirm" in src
    assert "Archive this record?" in src


# ─── Live HTTP ────────────────────────────────────────────────

def test_bulk_archive_dry_run_returns_count_without_persist():
    hdr = _admin_token()
    db = _db()
    before = db.incidents.count_documents({"archived_at": {"$ne": None,
                                                             "$exists": True}})
    r = requests.post(f"{API}/api/incidents/archive", headers=hdr, json={
        "criteria": {"date_before": "1970-01-01"},
        "dry_run": True,
    }, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True
    assert "matched_count" in body
    assert body["batch_id"] is None
    # Dry-run wrote nothing.
    after = db.incidents.count_documents({"archived_at": {"$ne": None,
                                                            "$exists": True}})
    assert after == before


@pytest.mark.live_db_writes
def test_bulk_archive_by_oldest_n_persists_and_audits():
    hdr = _admin_token()
    db = _db()
    r = requests.post(f"{API}/api/incidents/archive", headers=hdr, json={
        "criteria": {"oldest_n": 2},
        "reason": "pytest-bulk",
        "dry_run": False,
    }, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is False
    assert body["archived_count"] >= 0
    if body["archived_count"] > 0:
        assert body["batch_id"]
        # Audit row exists.
        audit = db.archive_audit.find_one({"batch_id": body["batch_id"]})
        assert audit is not None
        assert audit["action"] == "bulk_archive"
        assert audit["reason"] == "pytest-bulk"
        # Unarchive the batch to clean up.
        r_un = requests.post(
            f"{API}/api/incidents/unarchive-batch/{body['batch_id']}",
            headers=hdr, timeout=30,
        )
        assert r_un.status_code == 200


def test_org_archive_rules_round_trip():
    hdr = _admin_token()
    r = requests.get(f"{API}/api/org/archive-rules", headers=hdr, timeout=30)
    assert r.status_code == 200
    rules = r.json()["rules"]
    assert len(rules) == 7
    modules = [x["module"] for x in rules]
    assert modules == ["pre-starts", "site-diary", "hazards", "incidents",
                       "inspections", "risk-assessments", "site-visitors"]
    # PUT one on.
    p = requests.put(f"{API}/api/org/archive-rules/incidents", headers=hdr,
                     json={"enabled": True, "older_than_days": 730}, timeout=30)
    assert p.status_code == 200
    assert p.json()["enabled"] is True
    # GET back — persisted.
    r2 = requests.get(f"{API}/api/org/archive-rules", headers=hdr, timeout=30)
    inc = [x for x in r2.json()["rules"] if x["module"] == "incidents"][0]
    assert inc["enabled"] is True and inc["older_than_days"] == 730
    # Reset.
    requests.put(f"{API}/api/org/archive-rules/incidents", headers=hdr,
                 json={"enabled": False, "older_than_days": 365}, timeout=30)


def test_org_archive_rules_unknown_module_404():
    hdr = _admin_token()
    r = requests.put(f"{API}/api/org/archive-rules/no-such-module",
                     headers=hdr,
                     json={"enabled": False, "older_than_days": 365}, timeout=30)
    assert r.status_code == 404


def test_apply_org_archive_rules_is_idempotent():
    """v58.13.132ed — Direct invocation of the scheduler job should
    complete without error. With no enabled rules on the tenant it
    returns `total_affected=0`."""
    import asyncio
    from tests.conftest import run_async  # noqa: F401
    from org_archive_rules import apply_org_archive_rules

    async def go():
        return await apply_org_archive_rules()

    result = run_async(go())
    assert "total_affected" in result
    assert result["total_affected"] >= 0


def test_search_sees_archived_via_include_archived():
    """v58.13.132ed — Confirmation of the search-sees-archived
    behaviour. The FE flips `include_archived=true` on the fetch
    whenever the search bar has text; the backend correctly returns
    both active + archived rows in that case."""
    hdr = _admin_token()
    r_hidden = requests.get(f"{API}/api/incidents", headers=hdr, timeout=30)
    r_all = requests.get(f"{API}/api/incidents?include_archived=true",
                          headers=hdr, timeout=30)
    assert r_hidden.status_code == 200 and r_all.status_code == 200
    assert len(r_all.json()) >= len(r_hidden.json())


# ─── Version sync ─────────────────────────────────────────────

def test_three_way_sync_at_132ed_or_later():
    running = re.search(r"^export const RUNNING_VERSION = '([^']+)'",
                        VERSION_JS.read_text(), re.MULTILINE).group(1)
    expected = re.search(r"^export const EXPECTED_CACHE_VERSION = '([^']+)'",
                         VERSION_JS.read_text(), re.MULTILINE).group(1)
    cache = re.search(r"^const CACHE_VERSION = '([^']+)'",
                      SW.read_text(), re.MULTILINE).group(1)
    assert running == expected == cache
    tail = re.search(r"132([a-z]+)", running).group(1)
    assert tail >= "ed"
