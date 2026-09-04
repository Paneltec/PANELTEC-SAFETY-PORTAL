"""v58.13.81 — Admin Purge Test Data endpoint + Admin Tools card."""
from __future__ import annotations
import importlib, sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent.parent
BACKEND = APP / "backend"
FRONTEND = APP / "frontend"
MOBILE = APP / "mobile"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

PURGE_PY = (BACKEND / "admin_purge_test_data.py").read_text(encoding="utf-8")
SERVER_PY = (BACKEND / "server.py").read_text(encoding="utf-8")
SYS_JSX  = (FRONTEND / "src" / "pages" / "SystemSettings.jsx").read_text(encoding="utf-8")
VERSION_JS = (FRONTEND / "src" / "lib" / "version.js").read_text(encoding="utf-8")
SW_JS   = (FRONTEND / "public" / "service-worker.js").read_text(encoding="utf-8")
MOBILE_TS = (MOBILE / "src" / "lib" / "version.ts").read_text(encoding="utf-8")


def test_endpoint_module_importable():
    m = importlib.import_module("admin_purge_test_data")
    assert hasattr(m, "router"), "admin_purge_test_data must expose `router`."
    # Route registered at the expected path.
    paths = {r.path for r in m.router.routes}
    assert "/admin/purge-test-data" in paths


def test_server_includes_purge_router():
    assert "from admin_purge_test_data import router as admin_purge_router" in SERVER_PY
    assert "api.include_router(admin_purge_router)" in SERVER_PY


def test_simpro_source_always_excluded():
    assert '"source": {"$ne": "simpro"}' in PURGE_PY, (
        "Every purge query must exclude Simpro-imported rows so real "
        "customer data can never be matched."
    )


def test_admin_role_guard_present():
    assert "def _require_admin(user: dict)" in PURGE_PY
    assert 'raise HTTPException(status_code=403, detail="Admin role required")' in PURGE_PY
    # And the handler calls the guard.
    assert "_require_admin(user)" in PURGE_PY


def test_pattern_whitelist_covers_spec():
    for p in (r'r"^TEST-v\d+\.\d+\.\d+-"',
              r'r"^TEST-"',
              r'r"^demo-"',
              r'r"^sample-"',
              r'r"^seed-"',
              r'r"pytest-"'):
        assert p in PURGE_PY, f"TEST_PATTERNS missing {p}"


def test_target_collections_covers_spec():
    for col in ("assets", "workers", "sites", "hazards", "swms",
                "incidents", "inspections", "site_diary_entries",
                "pre_starts", "doc_files", "doc_folders",
                "worker_certifications", "suppliers",
                "form_assignments", "form_submissions", "qr_codes",
                "bulk_import_jobs", "bulk_import_pdf_cache",
                "cs_incident_issues", "hr_employees", "workspaces"):
        assert f'"{col}"' in PURGE_PY, f"TARGET_COLLECTIONS missing {col!r}"


def test_asset_schedules_cascade_delete_present():
    assert "asset_service_schedules.delete_many" in PURGE_PY, (
        "Purge must cascade-delete asset_service_schedules for the "
        "matched asset ids."
    )


def test_audit_log_path_pinned():
    assert 'AUDIT_LOG = Path("/app/memory/purge_v58_13_81_log.txt")' in PURGE_PY
    assert 'AUDIT_LOG.open("a")' in PURGE_PY, (
        "Purge must APPEND to the audit log so re-runs don't overwrite history."
    )


def test_frontend_card_and_modal_testids():
    for tid in ("purge-test-data-card", "purge-test-data-open",
                "purge-test-data-modal", "purge-total", "purge-ack",
                "purge-cancel", "purge-confirm"):
        assert f'"{tid}"' in SYS_JSX, f"SystemSettings.jsx missing testid `{tid}`."


def test_frontend_calls_dryrun_then_commit():
    assert "'/admin/purge-test-data?dry_run=1'" in SYS_JSX, (
        "Purge card must call dry-run FIRST to populate the modal."
    )
    assert "'/admin/purge-test-data?dry_run=0'" in SYS_JSX, (
        "Purge card must call commit only after user confirms."
    )


def test_frontend_ack_gates_delete_button():
    # The Delete button is disabled until `ack` is true.
    assert "disabled={!ack || busy || dry.grand_total === 0}" in SYS_JSX, (
        "Delete button must be disabled unless the ack checkbox is "
        "ticked AND grand_total > 0."
    )


def _tail(text: str, needle: str) -> int:
    import re
    m = re.search(needle + r"\s*=\s*['\"]paneltec-v160\.3\.9\.58\.13\.(\d+)[a-z]*['\"]", text)
    assert m; return int(m.group(1))


def test_running_version_at_least_81():
    assert _tail(VERSION_JS, "RUNNING_VERSION") >= 81


def test_cache_version_at_least_81():
    assert _tail(SW_JS, "CACHE_VERSION") >= 81


def test_mobile_bundle_version_at_least_81():
    assert _tail(MOBILE_TS, "MOBILE_BUNDLE_VERSION") >= 81
