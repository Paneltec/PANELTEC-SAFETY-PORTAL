"""v58.13.84 — Source-pin tests for the 4-YELLOW bundle.

A3:  `crud.py` list-endpoint max `limit` 50k → 5k.
A4:  `seed.py::ensure_indexes()` adds compound index on
     `form_submissions.{template_category_snapshot, org_id, submitted_at}`.
B7:  `server.py` gates /api/openapi.json + /docs + /redoc behind admin.
C13: `health_extras.py::health_backup` adds `snapshot_count`,
     `retention_last_run_at`, `ephemeral_last_run`, `next_scheduled_at`
     and returns 503 on truly stale/empty backup state.

Also asserts forward-safe version-sync `>= 84` on the three canonical
version-string files.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
MOBILE = ROOT / "mobile"

CRUD_PY = (BACKEND / "crud.py").read_text(encoding="utf-8")
SEED_PY = (BACKEND / "seed.py").read_text(encoding="utf-8")
SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
HEALTH_PY = (BACKEND / "health_extras.py").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


# ── A3 — max limit dropped ─────────────────────────────────────

def test_a3_limit_cap_dropped_to_5000():
    assert re.search(r"limit:\s*int\s*=\s*Query\(100,\s*ge=1,\s*le=5000\)", CRUD_PY)


def test_a3_no_50000_cap_remains():
    assert "le=50000" not in CRUD_PY


# ── A4 — compound index ─────────────────────────────────────────

def test_a4_form_submissions_compound_index_defined():
    m = re.search(
        r"db\.form_submissions\.create_index\(\s*\[\s*"
        r'\("template_category_snapshot",\s*1\)\s*,\s*'
        r'\("org_id",\s*1\)\s*,\s*'
        r'\("submitted_at",\s*-1\)\s*\]',
        SEED_PY,
    )
    assert m, "compound index on form_submissions not declared in seed.py"


def test_a4_index_has_stable_name():
    assert "form_submissions_mirrorset_v58_13_84" in SEED_PY


def test_a4_logging_import_present_in_seed():
    assert re.search(r"^import logging\s*$", SEED_PY, re.M)


def test_a4_index_creation_is_inside_ensure_indexes():
    # ensure_indexes() is the last function in seed.py; grab everything
    # from its declaration to end of file and assert the compound
    # index create_index call sits inside it.
    idx = SEED_PY.find("async def ensure_indexes() -> None:")
    assert idx != -1, "ensure_indexes() declaration not found"
    body = SEED_PY[idx:]
    assert "db.form_submissions.create_index" in body
    assert "template_category_snapshot" in body


# ── B7 — admin-gated OpenAPI + docs + redoc ─────────────────────

def test_b7_fastapi_disables_openapi_url_at_framework_level():
    m = re.search(
        r"FastAPI\(\s*[\s\S]+?openapi_url=None[\s\S]+?docs_url=None[\s\S]+?redoc_url=None",
        SERVER_PY,
    )
    assert m, "FastAPI init must disable openapi_url/docs_url/redoc_url"


def test_b7_admin_role_guard_defined():
    # Same pattern as admin_purge_test_data.py.
    assert re.search(
        r"def _require_admin_role\(user: dict = Depends\(get_current_user\)\).*:",
        SERVER_PY,
    )
    assert 'role"\\) != "admin"' in SERVER_PY.replace("(", "(").replace(")", ")") or \
           re.search(r'user\s+or\s+\{\}\)\.get\("role"\)\s*!=\s*"admin"', SERVER_PY)


def test_b7_admin_role_raises_403():
    assert "Admin role required" in SERVER_PY


def test_b7_openapi_route_present_with_admin_dep():
    m = re.search(
        r'@api\.get\("/openapi\.json"[\s\S]+?async def _admin_openapi\([\s\S]+?'
        r"Depends\(_require_admin_role\)",
        SERVER_PY,
    )
    assert m, "/api/openapi.json custom admin-gated route not present"


def test_b7_docs_and_redoc_routes_present_with_admin_dep():
    for route in ("/docs", "/redoc"):
        m = re.search(
            rf'@api\.get\("{re.escape(route)}"[\s\S]+?Depends\(_require_admin_role\)',
            SERVER_PY,
        )
        assert m, f"/api{route} custom admin-gated route not present"


def test_b7_openapi_returns_app_openapi():
    # The handler should call `app.openapi()` — not hardcode a JSON.
    assert re.search(r"async def _admin_openapi[\s\S]+?return app\.openapi\(\)", SERVER_PY)


# ── C13 — backup health probe additions ─────────────────────────

def test_c13_backup_response_carries_snapshot_count():
    assert "snapshot_count" in HEALTH_PY
    # Sourced from estimated_document_count for O(1) cost.
    assert "bk_snapshots.estimated_document_count" in HEALTH_PY


def test_c13_backup_response_carries_retention_fields():
    for field in ("retention_last_run_at", "ephemeral_last_run"):
        assert field in HEALTH_PY, f"missing {field}"
    # Sourced from app_state.backup_retention.
    m = re.search(
        r'db\.app_state\.find_one\(\s*\{"_id":\s*"backup_retention"\}',
        HEALTH_PY,
    )
    assert m, "backup_retention app_state lookup not present"


def test_c13_backup_response_carries_next_scheduled_at():
    assert "next_scheduled_at" in HEALTH_PY
    # Introspected from APScheduler `backup_snapshot_6h`.
    assert "backup_snapshot_6h" in HEALTH_PY
    assert "next_run_time" in HEALTH_PY


def test_c13_backup_returns_503_on_empty_or_stale():
    # No snapshots → 503 (empty-snapshots branch).
    assert re.search(r'No snapshots on record[\s\S]+?status_code=503', HEALTH_PY)
    # hours_since > 36 → 503 (stale branch).
    assert "hours_since is not None and hours_since > 36" in HEALTH_PY
    # And overall, at least TWO 503 branches present.
    assert HEALTH_PY.count("status_code=503") >= 2


def test_c13_backup_still_returns_200_on_amber():
    # Amber path (25h < hours_since <= 36) should still be a 200 —
    # the existing status="amber" logic isn't wrapped in a 503 branch.
    m = re.search(r'status\s*=\s*"amber"', HEALTH_PY)
    assert m


# ── Version-sync (forward-safe pin >= 84) ──────────────────────

def _tail(text: str, name: str) -> int:
    m = re.search(rf"{name}\s*=\s*['\"]paneltec-v[\d.]+\.(\d+)['\"]", text)
    assert m, f"{name} not found"
    return int(m.group(1))


def test_running_version_gte_84():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 84


def test_cache_version_gte_84():
    assert _tail(SW_JS, "CACHE_VERSION") >= 84


def test_mobile_bundle_version_gte_84():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 84
