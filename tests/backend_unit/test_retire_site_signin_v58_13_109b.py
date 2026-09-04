"""v58.13.109b — Retire legacy /app/site-signin flow.

Pins the deletion + redirect + migration script so a future refactor
can't silently resurrect the old route or lose the mapping logic.
"""
from __future__ import annotations
import asyncio
import importlib
import os
import re
import sys
import uuid
from pathlib import Path

import pytest
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))
load_dotenv(str(BACKEND / ".env"))

mig = importlib.import_module("migrate_legacy_signins_v58_13_109b")


# ── Deletion + redirect pins ───────────────────────────────

def test_site_signin_list_component_deleted():
    assert not (FRONTEND / "src" / "pages" / "SiteSigninList.jsx").exists(), (
        "SiteSigninList.jsx must be deleted in v58.13.109b"
    )


def test_app_js_redirects_site_signin_to_admin_visitors():
    src = (FRONTEND / "src" / "App.js").read_text(encoding="utf-8")
    assert re.search(
        r'path="site-signin"\s+element=\{<Navigate\s+to="/app/admin/visitors"\s+replace\s*/>',
        src,
    ), "App.js must register /site-signin as a Navigate replace to /app/admin/visitors"


def test_migration_script_exists_and_module_loads():
    p = BACKEND / "scripts" / "migrate_legacy_signins_v58_13_109b.py"
    assert p.exists(), "migration script must exist"
    assert hasattr(mig, "_map_row"), "migration must expose _map_row"
    assert hasattr(mig, "_migrate"), "migration must expose _migrate"
    assert mig.LEGACY_TEMPLATE_ID == "e8873f7e-6fd4-44c9-961a-d68e6ffecd8d"


# ── _map_row pure-fn coverage ──────────────────────────────

def test_map_row_produces_expected_shape():
    src = {
        "id": "sub-1",
        "org_id": "org-x",
        "template_id": mig.LEGACY_TEMPLATE_ID,
        "submitted_by": "u1",
        "submitted_by_name": "Fallback Name",
        "submitted_at": "2026-01-15T14:00:00+00:00",
        "fields": [
            {"id": "site", "value": {"id": "site-9", "name": "Site 9"}},
            {"id": "visitor_name", "value": {"id": "w1", "name": "Alice"}},
            {"id": "visitor_company", "value": "Acme"},
            {"id": "visitor_phone", "value": "0400"},
            {"id": "vehicle_rego", "value": "ABC123"},
            {"id": "purpose", "value": "Delivery"},
            {"id": "host_name", "value": "Stephen"},
            {"id": "ppe_briefed", "value": "Yes"},
            {"id": "time_in", "value": "09:30"},
            {"id": "f_location_7b61ee", "value": {"lat": -33.86, "lng": 151.20}},
        ],
    }
    out = mig._map_row(src)
    assert out["name"] == "Alice"
    assert out["company"] == "Acme"
    assert out["phone"] == "0400"
    assert out["vehicle_rego"] == "ABC123"
    assert out["purpose"] == "Delivery"
    assert out["visiting_person"] == "Stephen"
    assert out["induction_acknowledged"] is True
    assert out["site_id"] == "site-9"
    assert out["gps_lat"] == -33.86
    assert out["gps_lng"] == 151.20
    assert out["legacy_form_submission_id"] == "sub-1"
    assert out["source"] == "legacy_signin_migration"
    # time_in HH:MM composed onto submitted_at date.
    assert out["signed_in_at"].startswith("2026-01-15T09:30")


def test_map_row_falls_back_to_submitted_by_name_when_picker_empty():
    src = {"id": "sub-2", "org_id": "o", "submitted_by_name": "Bob",
            "submitted_at": "2026-01-01T00:00:00+00:00", "fields": []}
    out = mig._map_row(src)
    assert out["name"] == "Bob"
    assert out["induction_acknowledged"] is False


# ── DB-touching integration checks (isolated to TESTSIGNIN_ prefix) ──

TEST_SUB_ID_PREFIX = "TESTSIGNIN109b"
TEST_SUB_IDS = [f"{TEST_SUB_ID_PREFIX}-{i}" for i in range(1, 4)]


def _sync_db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _wipe():
    sdb = _sync_db()
    sdb.form_submissions.delete_many({"id": {"$in": TEST_SUB_IDS}})
    sdb.site_visitors.delete_many({"legacy_form_submission_id": {"$in": TEST_SUB_IDS}})


@pytest.fixture
def clean_seed():
    _wipe()
    yield
    _wipe()


def test_migration_backfills_three_seeded_rows_idempotently(clean_seed):
    sdb = _sync_db()
    for sid in TEST_SUB_IDS:
        sdb.form_submissions.insert_one({
            "id": sid, "org_id": "org-test", "template_id": mig.LEGACY_TEMPLATE_ID,
            "template_name_snapshot": "Site Sign-In / Visitor Register",
            "submitted_by": "u1", "submitted_by_name": f"Visitor {sid}",
            "submitted_at": "2026-01-15T14:00:00+00:00", "deleted_at": None,
            "fields": [
                {"id": "site", "value": {"id": "site-x", "name": "Site X"}},
                {"id": "visitor_name", "value": {"id": "w", "name": f"Visitor {sid}"}},
                {"id": "visitor_company", "value": "Acme"},
                {"id": "visitor_phone", "value": "0400"},
                {"id": "purpose", "value": "Contractor"},
                {"id": "host_name", "value": "Stephen"},
                {"id": "ppe_briefed", "value": "Yes"},
                {"id": "time_in", "value": "10:00"},
            ],
        })

    async def _drive():
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        adb = client[os.environ["DB_NAME"]]
        try:
            first = await mig._migrate(adb)
            second = await mig._migrate(adb)
            return first, second
        finally:
            client.close()

    loop = asyncio.new_event_loop()
    try:
        first, second = loop.run_until_complete(_drive())
    finally:
        loop.close()

    # First run inserts (all seeded rows are new). The preview DB may
    # contain the 1 pre-existing legacy row so we assert on the delta
    # rather than a hard `inserted == 3`.
    assert first["inserted"] >= 3, first
    assert first["already_migrated"] <= 1  # only the pre-existing prod row (if any)
    # Second run: everything is now already migrated — zero inserts.
    assert second["inserted"] == 0, second
    assert second["already_migrated"] >= 3

    # Verify the resulting site_visitors rows.
    n = sdb.site_visitors.count_documents(
        {"legacy_form_submission_id": {"$in": TEST_SUB_IDS}}
    )
    assert n == 3, f"expected 3 migrated rows; got {n}"
    for sid in TEST_SUB_IDS:
        v = sdb.site_visitors.find_one({"legacy_form_submission_id": sid})
        assert v is not None
        assert v["source"] == "legacy_signin_migration"
        assert v["induction_acknowledged"] is True
        assert v["name"] == f"Visitor {sid}"


# ── Version-sync forward-safe pins ──────────────────────────

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_VERSION_TS = (ROOT / "mobile" / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


def _ge_109b(version: str) -> bool:
    m = re.search(r"58\.13\.(\d+)([a-z]*)", version)
    if not m:
        return False
    major = int(m.group(1))
    suffix = m.group(2)
    if major > 109:
        return True
    if major == 109:
        return suffix >= "b"
    return False


def test_running_version_ge_109b():
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and _ge_109b(m.group(1)), f"RUNNING_VERSION {m and m.group(1)!r}"


def test_mobile_bundle_version_ge_109b():
    m = re.search(r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'", MOBILE_VERSION_TS)
    assert m and _ge_109b(m.group(1))


def test_service_worker_cache_version_ge_109b():
    m = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m and _ge_109b(m.group(1))
