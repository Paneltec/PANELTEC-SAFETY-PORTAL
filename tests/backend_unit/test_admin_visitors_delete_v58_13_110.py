"""v58.13.110 — Admin visitor delete + bulk-delete + list filter pins.

Combines regex source pins (structural — decorator ordering, param
declarations, model constraints) with a live DB integration path
that seeds three test rows, exercises DELETE + bulk-delete +
include_deleted list-toggle, and cleans up in a fixture teardown.

Uses a `TESTV110_` id prefix so the integration tests can't touch
real preview visitor data.
"""
from __future__ import annotations
import asyncio
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
load_dotenv(str(BACKEND / ".env"))

VS_SRC = (BACKEND / "visitor_signins.py").read_text(encoding="utf-8")
FE_SRC = (FRONTEND / "src" / "pages" / "AdminVisitors.jsx").read_text(encoding="utf-8")


# ── Source pins ─────────────────────────────────────────

def test_delete_endpoint_is_permission_gated_and_safe_wrapped():
    """`DELETE /admin/visitors/{visitor_id}` must go through the
    `sites_visitors.delete` permission dep AND @safe_admin_endpoint."""
    pat = re.compile(
        r'@admin_router\.delete\("/\{visitor_id\}"\)\s*\n'
        r'@safe_admin_endpoint\s*\n'
        r'async def admin_delete_visitor.*?'
        r'require_permission\("sites_visitors",\s*"delete"\)',
        re.S,
    )
    assert pat.search(VS_SRC), (
        "DELETE /admin/visitors/{id} must be decorated in order: "
        "@admin_router.delete → @safe_admin_endpoint → "
        "Depends(require_permission('sites_visitors','delete'))"
    )


def test_bulk_delete_endpoint_declares_min_and_max_length():
    """Pydantic constraints on the ids list are our first line of
    defence against a runaway payload. Cap = 500."""
    assert re.search(
        r"class BulkDeleteIn\(BaseModel\):.*?ids:\s*list\[str\]\s*=\s*Field\(.*?min_length=1.*?max_length=500",
        VS_SRC, re.S,
    ), "BulkDeleteIn must declare min_length=1 and max_length=500"


def test_bulk_delete_endpoint_permission_gated_and_safe_wrapped():
    pat = re.compile(
        r'@admin_router\.post\("/bulk-delete"\)\s*\n'
        r'@safe_admin_endpoint\s*\n'
        r'async def admin_bulk_delete_visitors.*?'
        r'require_permission\("sites_visitors",\s*"delete"\)',
        re.S,
    )
    assert pat.search(VS_SRC), (
        "POST /admin/visitors/bulk-delete must be decorated + "
        "permission-gated in the correct order"
    )


def test_bulk_delete_reports_deleted_skipped_requested():
    assert re.search(r'"deleted":\s*deleted', VS_SRC)
    assert re.search(r'"skipped":\s*skipped', VS_SRC)
    assert re.search(r'"requested":\s*len\(ids\)', VS_SRC)
    # Skipped reasons: `not_found` (fake id) and `already_deleted`.
    assert '"reason": "not_found"' in VS_SRC
    assert '"reason": "already_deleted"' in VS_SRC


def test_list_endpoint_carries_include_deleted_param():
    """Default MUST be False so the shipped page filters soft-deletes
    out on shell mount."""
    assert re.search(
        r"include_deleted:\s*bool\s*=\s*False",
        VS_SRC,
    ), "admin_list_visitors must declare `include_deleted: bool = False`"
    # The $or filter is applied when include_deleted is False.
    assert re.search(
        r"if\s+not\s+include_deleted:\s*\n\s*q\[\"\$or\"\]\s*=\s*\[\{\"deleted_at\":\s*None\}",
        VS_SRC,
    ), "list must $or-filter deleted_at when include_deleted is False"


def test_list_and_get_enrich_with_site_name():
    """Detail drawer + main table lean on `site_name` — the API must
    populate it via a per-window join on `simpro_sites`."""
    assert "r[\"site_name\"] = site_meta[\"name\"]" in VS_SRC
    assert "v[\"site_name\"] = s.get(\"name\")" in VS_SRC


def test_delete_endpoint_stamps_deleted_at_and_deleted_by():
    assert re.search(
        r'"deleted_at":\s*now,\s*"deleted_by":\s*user\["id"\]',
        VS_SRC,
    ), "single-row delete must stamp deleted_at + deleted_by"


# ── Frontend source pins ───────────────────────────────

def test_frontend_uses_bulk_delete_endpoint():
    assert re.search(
        r"api\.post\(\s*['\"]/admin/visitors/bulk-delete['\"]",
        FE_SRC,
    ), "AdminVisitors.jsx must call POST /admin/visitors/bulk-delete"


def test_frontend_uses_single_delete_endpoint():
    assert re.search(
        r"api\.delete\(\s*`/admin/visitors/\$\{row\.id\}`",
        FE_SRC,
    ), "AdminVisitors.jsx must call DELETE /admin/visitors/{id}"


def test_frontend_declutters_main_table_columns():
    """Main table now shows Name / Company / Site / Signed in / Status
    / Actions — everything else moved into the detail drawer."""
    for header in ["Name", "Company", "Site", "Signed in", "Status", "Actions"]:
        assert f">{header}<" in FE_SRC, f"main table must render <th>{header}</th>"
    # Phone / Purpose / Visiting / Vehicle rego / etc. must be in the
    # drawer, not the table. Ensure the KV labels appear.
    for drawer_field in ["Phone", "Purpose", "Visiting person", "Vehicle rego",
                          "Induction acknowledged", "Source IP", "User agent"]:
        assert f'label="{drawer_field}"' in FE_SRC, (
            f"detail drawer must expose {drawer_field!r}"
        )


def test_frontend_selection_toolbar_present():
    for tid in ("bulk-toolbar", "bulk-selected-count", "bulk-delete-open",
                "bulk-clear", "bulk-delete-confirm", "visitor-detail-drawer",
                "visitor-detail-delete", "admin-visitors-include-deleted"):
        assert f'"{tid}"' in FE_SRC, f"missing data-testid={tid!r}"


# ── DB-touching integration checks ─────────────────────

TEST_PREFIX = "TESTV110"
SEEDED_IDS = [f"{TEST_PREFIX}-{uuid.uuid4().hex[:8]}" for _ in range(3)]


def _sync_db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


@pytest.fixture
def clean_seed():
    sdb = _sync_db()
    sdb.site_visitors.delete_many({"id": {"$in": SEEDED_IDS}})
    yield sdb
    sdb.site_visitors.delete_many({"id": {"$in": SEEDED_IDS}})


def _seed(sdb, org_id: str):
    now = "2026-01-01T00:00:00+00:00"
    for vid in SEEDED_IDS:
        sdb.site_visitors.insert_one({
            "id": vid, "org_id": org_id, "site_id": "site-x",
            "site_scan_token": "test-token",
            "name": f"TestVisitor-{vid[-4:]}", "company": "PyCo",
            "phone": "+61400000000", "purpose": "Contractor",
            "visiting_person": "PyHost", "vehicle_rego": None,
            "induction_acknowledged": True,
            "signed_in_at": now, "signed_out_at": None,
            "source_ip": "127.0.0.1", "source_user_agent": "pytest",
            "created_at": now, "updated_at": now,
        })


def test_single_delete_soft_deletes_and_is_idempotent(clean_seed):
    """Behavioural check via the shared motor client — driven from a
    fresh event loop per test to sidestep the loop-binding issue seen
    in .109 orphan-vacuum tests."""
    sdb = clean_seed
    org_id = "org-testv110"
    _seed(sdb, org_id)

    async def _drive():
        from motor.motor_asyncio import AsyncIOMotorClient
        from visitor_signins import admin_delete_visitor
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        adb = client[os.environ["DB_NAME"]]
        # Patch the module-level `db` reference just for this test.
        import visitor_signins
        prev = visitor_signins.db
        visitor_signins.db = adb
        try:
            fake_user = {"id": "actor-1", "org_id": org_id, "role": "admin"}
            # Call the raw handler bypassing FastAPI dep injection.
            # The @safe_admin_endpoint wrapper needs a `request` shim,
            # but `.func` (or `__wrapped__`) exposes the inner coroutine.
            inner = admin_delete_visitor.__wrapped__ if hasattr(admin_delete_visitor, "__wrapped__") else admin_delete_visitor
            r1 = await inner(SEEDED_IDS[0], None, fake_user)
            r2 = await inner(SEEDED_IDS[0], None, fake_user)
            return r1, r2
        finally:
            visitor_signins.db = prev
            client.close()

    loop = asyncio.new_event_loop()
    try:
        r1, r2 = loop.run_until_complete(_drive())
    finally:
        loop.close()

    assert r1["already"] is False
    assert r1["deleted_at"]
    assert r2["already"] is True
    assert r2["deleted_at"] == r1["deleted_at"]
    row = sdb.site_visitors.find_one({"id": SEEDED_IDS[0]})
    assert row["deleted_at"] == r1["deleted_at"]
    assert row["deleted_by"] == "actor-1"


def test_bulk_delete_reports_deleted_and_not_found(clean_seed):
    sdb = clean_seed
    org_id = "org-testv110"
    _seed(sdb, org_id)

    async def _drive():
        from motor.motor_asyncio import AsyncIOMotorClient
        from visitor_signins import admin_bulk_delete_visitors, BulkDeleteIn
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        adb = client[os.environ["DB_NAME"]]
        import visitor_signins
        prev = visitor_signins.db
        visitor_signins.db = adb
        try:
            fake_user = {"id": "actor-1", "org_id": org_id, "role": "admin"}
            payload = BulkDeleteIn(ids=SEEDED_IDS + ["fake-id-xyz"])
            inner = admin_bulk_delete_visitors.__wrapped__ if hasattr(admin_bulk_delete_visitors, "__wrapped__") else admin_bulk_delete_visitors
            return await inner(None, payload, fake_user)
        finally:
            visitor_signins.db = prev
            client.close()

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(_drive())
    finally:
        loop.close()

    assert result["deleted"] == 3, result
    reasons = {s["id"]: s["reason"] for s in result["skipped"]}
    assert reasons == {"fake-id-xyz": "not_found"}, result
    assert result["requested"] == 4
    for vid in SEEDED_IDS:
        row = sdb.site_visitors.find_one({"id": vid})
        assert row["deleted_at"], f"row {vid} should be soft-deleted"


# ── Version-sync forward-safe pins ─────────────────────

VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_VERSION_TS = (ROOT / "mobile" / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


def _ge_110(version: str) -> bool:
    m = re.search(r"58\.13\.(\d+)([a-z]*)", version)
    if not m:
        return False
    return int(m.group(1)) >= 110


def test_running_version_ge_110():
    m = re.search(r"RUNNING_VERSION\s*=\s*'([^']+)'", VERSION_JS)
    assert m and _ge_110(m.group(1)), m and m.group(1)


def test_mobile_bundle_version_ge_110():
    m = re.search(r"MOBILE_BUNDLE_VERSION\s*=\s*'([^']+)'", MOBILE_VERSION_TS)
    assert m and _ge_110(m.group(1))


def test_service_worker_cache_version_ge_110():
    m = re.search(r"CACHE_VERSION\s*=\s*'([^']+)'", SW_JS)
    assert m and _ge_110(m.group(1))
