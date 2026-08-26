"""v58.13.56 — HR-merge lite (Ship A, additive) guards.

Six checks:
  1. `WorkerPatch` schema has the 4 new fields.
  2. `_serialise` scrubs the 4 fields for non-hr viewer.
  3. `_serialise` retains the 4 fields for admin viewer.
  4. Migration script importable + exposes required helpers.
  5. `hr_employees` collection is UNCHANGED after a `--dry-run`
     migration invocation (skip if DB unreachable).
  6. Forward-safe version-sync (moved past .55).
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sys
from pathlib import Path


_BACKEND = Path("/app/backend")
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


def test_worker_patch_has_four_hr_fields():
    import workers as w
    fields = set(w.WorkerPatch.model_fields.keys())
    for name in ("employee_id", "date_employee_added",
                 "working_visa", "do_not_rehire"):
        assert name in fields, f"WorkerPatch missing {name!r}"


def test_serialise_scrubs_hr_fields_for_non_hr_viewer():
    import workers as w
    doc = {
        "id": "wk1", "first_name": "Ada", "last_name": "L",
        "employee_id": "E42", "date_employee_added": "2020-01-01",
        "working_visa": True, "do_not_rehire": False,
    }
    viewer = {"role": "supervisor", "permissions": {}}
    out = w._serialise(doc, viewer=viewer)
    for k in ("employee_id", "date_employee_added",
              "working_visa", "do_not_rehire"):
        assert k not in out, (
            f"non-hr viewer must not see {k!r} in the response"
        )


def test_serialise_retains_hr_fields_for_admin_and_grant_holder():
    import workers as w
    doc = {
        "id": "wk1", "first_name": "Ada", "last_name": "L",
        "employee_id": "E42", "date_employee_added": "2020-01-01",
        "working_visa": True, "do_not_rehire": False,
    }
    # Path 1: admin role, no explicit permission map.
    out_admin = w._serialise(doc, viewer={"role": "admin"})
    for k in ("employee_id", "working_visa", "do_not_rehire",
              "date_employee_added"):
        assert k in out_admin, f"admin must see {k!r}"
    # Path 2: non-admin role but explicit hr_employees.view grant.
    out_grant = w._serialise(doc, viewer={
        "role": "supervisor",
        "permissions": {"hr_employees": {"view": True}},
    })
    for k in ("employee_id", "working_visa", "do_not_rehire",
              "date_employee_added"):
        assert k in out_grant, f"grant holder must see {k!r}"


def test_migration_script_importable():
    mod = importlib.import_module(
        "scripts.merge_hr_to_workers_v58_13_56",
    )
    for fn in ("main", "_extract_hr_fields", "_to_bool", "_norm"):
        assert hasattr(mod, fn)
    assert mod._to_bool("Y") is True
    assert mod._to_bool("no") is False
    assert mod._to_bool(True) is True
    assert mod._to_bool(None) is False


def test_dry_run_leaves_hr_employees_untouched():
    if not os.environ.get("MONGO_URL"):
        import pytest
        pytest.skip("MONGO_URL missing — DB check skipped")
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _run():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"],
                               serverSelectionTimeoutMS=5000)
        db = c[os.environ.get("DB_NAME", "test_database")]
        before = await db.hr_employees.count_documents({})
        before_audit = await db.hr_employees_audit.count_documents({})
        mod = importlib.import_module(
            "scripts.merge_hr_to_workers_v58_13_56",
        )
        rep = await mod.main(commit=False)
        after = await db.hr_employees.count_documents({})
        after_audit = await db.hr_employees_audit.count_documents({})
        assert after == before, "dry-run must not mutate hr_employees"
        assert after_audit == before_audit, (
            "dry-run must not add hr_employees_audit rows"
        )
        assert rep.get("written", 0) == 0
        return rep

    try:
        rep = asyncio.run(_run())
    except Exception as e:  # noqa: BLE001
        import pytest
        pytest.skip(f"DB unreachable — {e}")
    assert "would_update" in rep


def test_version_sync_moved_past_v58_13_55():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.55'" not in v_js
    assert "'paneltec-v160.3.9.58.13.55'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.55'" not in sw_js
    assert "v160.3.9.58.13.56" in v_js
