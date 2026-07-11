"""v160.2.9-delete — Regression tests for the Capture delete flow +
mirrored-row `template_name` fallback.

The bug: Capture list pages (Pre-Starts, Site Diary, Hazards, Incidents,
Inspections) mirror `form_submissions` rows via `crud.build_router`'s
`mirror_categories` (shipped in v160.2.5a). Those mirrored rows carry
the source submission id in `id`, so the web-admin `DELETE
/api/pre-starts/{id}` (etc.) 404'd — it only searches the legacy
per-entity collection. Additionally the Inspections list rendered
`it.template_name` which the mirror projection was NOT filling — so
the TEMPLATE column read blank for every mirrored row.

Fixes tested:
  A. Delete flow — mirrored submissions must be deletable via
     `DELETE /api/forms/submissions/{id}` and disappear from the
     mirroring Capture list.
  B. Legacy delete path still works.
  C. RBAC — non-writer / non-submitter is 403.
  D. Second delete is 404 (idempotent-safe for the UI).
  E. Mirror projection now populates `template_name` on every
     mirrored row so Inspections' TEMPLATE column never blanks.
  F. Missing `template_name_snapshot` falls back to a live
     `form_templates` lookup, then to "Deleted template".

Follows the project's sync-`requests` test style (matches
`test_v160_2_7_worker_perms.py`).
"""
from __future__ import annotations

import asyncio
import os

import pytest
import requests

BASE = os.environ.get("PANELTEC_API", "http://localhost:8001")
ADMIN_EMAIL = "stephen@paneltec.com.au"
ADMIN_PW = "Mcgstephen50#"
WORKER_EMAIL = os.environ.get("WORKER_EMAIL", "worker_stephen@paneltec.com.au")
WORKER_PW = os.environ.get("WORKER_PW", "WorkerTest123!")


def _login(email: str, pw: str) -> str:
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": pw},
        timeout=10,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("access_token") or body.get("token")


def _db():
    """Return a synchronous handle to the same Mongo the server uses."""
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _admin_user() -> dict:
    return _db().users.find_one({"email": ADMIN_EMAIL}, {"_id": 0})


def _new_id() -> str:
    import uuid
    return str(uuid.uuid4())


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _seed_mirror(admin: dict, category: str = "inspection", *,
                 template_name_snapshot: str | None = "Test template") -> str:
    """Insert a synthetic `form_submissions` row tagged for a Capture tab."""
    sid = _new_id()
    ts = _now_iso()
    doc = {
        "id": sid,
        "org_id": admin["org_id"],
        "workspace_id": (admin.get("workspace_ids") or [None])[0],
        "template_id": "test-template-v160-2-9",
        "template_category_snapshot": category,
        "submitted_by": admin["id"],
        "submitted_at": ts,
        "fields": [],
        "deleted_at": None,
    }
    if template_name_snapshot is not None:
        doc["template_name_snapshot"] = template_name_snapshot
    _db().form_submissions.insert_one(doc)
    return sid


def _seed_legacy_prestart(admin: dict) -> str:
    """Insert a legacy `pre_starts` row so we can delete it via the legacy path."""
    pid = _new_id()
    ts = _now_iso()
    _db().pre_starts.insert_one({
        "id": pid,
        "org_id": admin["org_id"],
        "workspace_id": (admin.get("workspace_ids") or [None])[0],
        "date": ts[:10],
        "crew_lead": "Test Crew",
        "work_summary": "v160.2.9-delete legacy row",
        "sign_ons": [],
        "linked_swms_ids": [],
        "linked_permits": [],
        "created_by": admin["id"],
        "created_at": ts,
        "updated_at": ts,
        "deleted_at": None,
    })
    return pid


# ────────────────────────────── Fixtures ──────────────────────────────

@pytest.fixture(scope="module")
def admin() -> dict:
    a = _admin_user()
    assert a, "seed admin missing"
    return a


@pytest.fixture(scope="module")
def admin_token() -> str:
    return _login(ADMIN_EMAIL, ADMIN_PW)


# ─────────────────────────────── Tests ────────────────────────────────

def test_mirrored_submission_delete_removes_from_capture_list(admin, admin_token):
    sid = _seed_mirror(admin, category="pre_start")
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        # Row is visible in the Capture list (mirrored).
        r = requests.get(f"{BASE}/api/pre-starts", headers=h, timeout=10)
        ids = [x["id"] for x in r.json()]
        assert sid in ids, "mirror row must be visible before delete"
        # Legacy path 404s — this WAS the original bug.
        r_legacy = requests.delete(f"{BASE}/api/pre-starts/{sid}", headers=h, timeout=10)
        assert r_legacy.status_code == 404, r_legacy.text
        # Correct path succeeds.
        r_ok = requests.delete(f"{BASE}/api/forms/submissions/{sid}", headers=h, timeout=10)
        assert r_ok.status_code == 204, r_ok.text
        # And now the row is gone from the Capture list.
        r2 = requests.get(f"{BASE}/api/pre-starts", headers=h, timeout=10)
        ids2 = [x["id"] for x in r2.json()]
        assert sid not in ids2, "mirror row should disappear after delete"
    finally:
        _db().form_submissions.delete_one({"id": sid})


def test_legacy_prestart_delete_still_works(admin, admin_token):
    pid = _seed_legacy_prestart(admin)
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.delete(f"{BASE}/api/pre-starts/{pid}", headers=h, timeout=10)
        assert r.status_code == 200, r.text
        doc = _db().pre_starts.find_one({"id": pid}, {"_id": 0})
        assert doc and doc.get("deleted_at") is not None
    finally:
        _db().pre_starts.delete_one({"id": pid})


def test_worker_cannot_delete_other_workers_submission(admin):
    """Non-WRITE_ROLES user can only delete submissions they submitted."""
    worker = _db().users.find_one({"email": WORKER_EMAIL}, {"_id": 0})
    if not worker:
        pytest.skip("worker seed missing")
    sid = _seed_mirror(admin, category="incident")  # admin submitted
    try:
        worker_token = _login(WORKER_EMAIL, WORKER_PW)
        h = {"Authorization": f"Bearer {worker_token}"}
        r = requests.delete(f"{BASE}/api/forms/submissions/{sid}", headers=h, timeout=10)
        assert r.status_code == 403, r.text
        doc = _db().form_submissions.find_one({"id": sid}, {"_id": 0})
        assert doc and doc.get("deleted_at") is None
    finally:
        _db().form_submissions.delete_one({"id": sid})


def test_second_delete_returns_404(admin, admin_token):
    sid = _seed_mirror(admin, category="hazard".replace("hazard", "near_miss"))
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r1 = requests.delete(f"{BASE}/api/forms/submissions/{sid}", headers=h, timeout=10)
        assert r1.status_code == 204, r1.text
        r2 = requests.delete(f"{BASE}/api/forms/submissions/{sid}", headers=h, timeout=10)
        assert r2.status_code == 404, r2.text
    finally:
        _db().form_submissions.delete_one({"id": sid})


def test_mirrored_row_carries_template_name_alias(admin, admin_token):
    """v160.2.9-delete — Inspections list reads `template_name`. The mirror
    projection must populate that alias so the TEMPLATE column never
    renders blank."""
    sid = _seed_mirror(admin, category="inspection",
                       template_name_snapshot="Plant inspection")
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.get(f"{BASE}/api/inspections", headers=h, timeout=10)
        row = next((x for x in r.json() if x["id"] == sid), None)
        assert row is not None, "mirrored inspection not in list"
        assert row.get("template_name") == "Plant inspection", (
            f"template_name alias missing on mirrored row: {row}"
        )
        assert row.get("source") == "form_submission"
    finally:
        _db().form_submissions.delete_one({"id": sid})


def test_mirrored_row_missing_snapshot_falls_back(admin, admin_token):
    """v160.2.9-delete — When a legacy submission never captured a
    `template_name_snapshot` and its `template_id` still exists, the
    mirror projection should fill it via a live `form_templates`
    lookup. When the template row itself is gone, fallback text
    'Deleted template' is used."""
    # Case A: template row exists → look up live.
    live_tpl_id = f"v160-2-9-tpl-{_new_id()[:8]}"
    _db().form_templates.insert_one({
        "id": live_tpl_id, "org_id": admin["org_id"], "name": "Live template ✓",
        "category": "inspection", "fields": [], "deleted_at": None,
    })
    sid_a = _new_id()
    _db().form_submissions.insert_one({
        "id": sid_a, "org_id": admin["org_id"],
        "workspace_id": (admin.get("workspace_ids") or [None])[0],
        "template_id": live_tpl_id, "template_category_snapshot": "inspection",
        "submitted_by": admin["id"], "submitted_at": _now_iso(),
        "fields": [], "deleted_at": None,
    })
    # Case B: template_id points at nothing → 'Deleted template'.
    sid_b = _new_id()
    _db().form_submissions.insert_one({
        "id": sid_b, "org_id": admin["org_id"],
        "workspace_id": (admin.get("workspace_ids") or [None])[0],
        "template_id": "does-not-exist",
        "template_category_snapshot": "inspection",
        "submitted_by": admin["id"], "submitted_at": _now_iso(),
        "fields": [], "deleted_at": None,
    })
    try:
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.get(f"{BASE}/api/inspections", headers=h, timeout=10)
        rows = r.json()
        a = next((x for x in rows if x["id"] == sid_a), None)
        b = next((x for x in rows if x["id"] == sid_b), None)
        assert a and a.get("template_name") == "Live template ✓", (
            f"live-template lookup broken: {a}"
        )
        assert b and b.get("template_name") == "Deleted template", (
            f"deleted-template fallback broken: {b}"
        )
    finally:
        _db().form_submissions.delete_one({"id": sid_a})
        _db().form_submissions.delete_one({"id": sid_b})
        _db().form_templates.delete_one({"id": live_tpl_id})
