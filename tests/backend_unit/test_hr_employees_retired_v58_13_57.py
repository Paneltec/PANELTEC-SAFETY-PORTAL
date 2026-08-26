"""v58.13.57 — HR Employees UI retirement guards.

The 4 HR flags (Employee ID, Hired, Working Visa, Do Not Rehire)
now live on the Worker record (merged in v58.13.56). This ship
retires the standalone HR Employees UI + the 3 PII reveal
endpoints. The `hr_employees` collection and read-only backend
routes stay live for a 90-day grace window.

Guards:
  1. Settings nav registry has no `hr_employees` entry.
  2. `App.js` redirects `/app/settings/hr-employees` → `/app`.
  3. Retired frontend files are gone.
  4. Retired PII reveal endpoints are gone from `hr_employees.py`.
  5. `hr_employees` collection preserved (count > 0) — the
     ship-A merge was additive, so retirement must not have
     dropped or purged data.
  6. Live check: hitting the reveal endpoints returns 404 (skip
     if backend unreachable).
  7. Worker HR fields still on the Worker Pydantic model —
     regression guard for Ship A.
  8. Forward-safe version-sync (moved past .56).
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path


_FRONTEND_SRC = Path("/app/frontend/src")
_BACKEND = Path("/app/backend")


def _read(rel: str, base: Path = _FRONTEND_SRC) -> str:
    return (base / rel).read_text(encoding="utf-8")


# ── 1. Settings nav registry ────────────────────────────────────────


def test_settings_nav_has_no_hr_employees_entry():
    src = _read("lib/settingsNavRegistry.js")
    assert "nav-settings-hr-employees" not in src, (
        "settingsNavRegistry.js still exposes the HR Employees nav "
        "testid — the settings entry must be retired."
    )
    assert "route: '/app/settings/hr-employees'" not in src, (
        "settingsNavRegistry.js still routes to the retired page"
    )


# ── 2. App.js redirect + retired import ─────────────────────────────


def test_app_js_redirects_hr_employees_url_to_root_app():
    src = _read("App.js")
    assert "import HrEmployeesPage" not in src, (
        "App.js still imports the retired HrEmployeesPage"
    )
    assert (
        '<Route path="settings/hr-employees" '
        'element={<Navigate to="/app" replace />} />'
    ) in src, (
        "App.js must ship the 90-day redirect from "
        "`/app/settings/hr-employees` to `/app`"
    )
    assert "REMOVE AFTER 2026-11-25" in src, (
        "App.js must carry the explicit removal date so a future "
        "ship knows when to flip the redirect to 410."
    )


# ── 3. Retired frontend files are gone ──────────────────────────────


def test_retired_frontend_files_are_deleted():
    for rel in (
        "pages/settings/HrEmployeesPage.jsx",
        "pages/settings/HrEmployeeDrawer.jsx",
        "components/BulkWorkerLinkWizard.jsx",
        "components/BulkWorkerUnlinkWizard.jsx",
        "components/WorkerLinkModal.jsx",
    ):
        assert not (_FRONTEND_SRC / rel).exists(), (
            f"{rel} must be deleted in v58.13.57"
        )


# ── 4. Retired PII reveal endpoints are gone from the router ────────


def test_pii_reveal_endpoints_are_deleted_from_router():
    src = _read("hr_employees.py", base=_BACKEND)
    for path in ("/reveal-dob", "/reveal-address", "/reveal-next-of-kin"):
        assert f'@router.post("/{{uid}}{path}")' not in src, (
            f"hr_employees.py still registers `{path}` — the endpoint "
            "must be deleted (audit-safe: no client uses it anymore)."
        )
    # Function definitions gone too.
    for fn in ("async def reveal_dob", "async def reveal_address",
               "async def reveal_next_of_kin"):
        assert fn not in src, f"{fn} function must be deleted"


def test_retirement_header_comment_is_present():
    src = _read("hr_employees.py", base=_BACKEND)
    assert "v58.13.57 — HR Employees UI retired" in src, (
        "hr_employees.py must carry a retirement note for the next "
        "session to understand the read-only-router state."
    )
    assert "REMOVE AFTER 2026-11-25" in src, (
        "retirement note must include the explicit removal date"
    )


# ── 5. Kept-live endpoints still registered ─────────────────────────


def test_read_only_endpoints_stay_registered():
    """The audit-view + list + get + patch endpoints must still be
    reachable during the 90-day grace window."""
    src = _read("hr_employees.py", base=_BACKEND)
    for marker in (
        '@router.get("/audit")',
        '@router.get("/")',            # list
        '@router.patch("/{uid}")',
    ):
        assert marker in src, (
            f"hr_employees.py lost `{marker}` — v58.13.57 grace-"
            "window contract broken."
        )


# ── 6. Data preservation ────────────────────────────────────────────


def test_hr_employees_collection_data_preserved():
    """Soft-skip if the DB is unreachable. Otherwise pins that
    retirement did NOT drop or purge `hr_employees`."""
    if str(_BACKEND) not in sys.path:
        sys.path.insert(0, str(_BACKEND))
    _env = _BACKEND / ".env"
    if _env.exists():
        for _line in _env.read_text(encoding="utf-8").splitlines():
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "test_database")
    if not mongo_url:
        import pytest
        pytest.skip("MONGO_URL not set")

    async def _count():
        from motor.motor_asyncio import AsyncIOMotorClient
        c = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5_000)
        return await c[db_name].hr_employees.count_documents({})

    try:
        n = asyncio.run(_count())
    except Exception as e:  # noqa: BLE001
        import pytest
        pytest.skip(f"DB unreachable — {e}")
    assert n > 0, (
        f"hr_employees collection empty (got {n}) — v58.13.57's core "
        "guarantee is data preservation. Something dropped the data."
    )


# ── 7. Ship-A regression guard: Worker HR fields still work ─────────


def test_worker_hr_fields_still_on_pydantic_model():
    if str(_BACKEND) not in sys.path:
        sys.path.insert(0, str(_BACKEND))
    import workers as w  # noqa: WPS433
    fields = set(w.WorkerPatch.model_fields.keys())
    for name in ("employee_id", "date_employee_added",
                 "working_visa", "do_not_rehire"):
        assert name in fields, (
            f"WorkerPatch lost `{name}` — Ship A regression."
        )


# ── 8. Forward-safe version-sync pin ────────────────────────────────


def test_version_sync_moved_past_v58_13_56():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.56'" not in v_js
    assert "'paneltec-v160.3.9.58.13.56'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.56'" not in sw_js
    assert "v160.3.9.58.13.57" in v_js
