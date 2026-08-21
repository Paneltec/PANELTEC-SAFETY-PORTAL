"""v58.13.28 — Worker soft-delete cascade handler-level pytests.

When a worker is soft-deleted, every `hr_employees.linked_worker_id`
pointing at it must be cleared (both id AND denormalised name), an
audit row must be written per affected employee, and the cascade must
be idempotent + regression-safe (never touches unrelated employees).

Placed under /app/tests/backend_unit/ per v58.13.10.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

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

import workers as workers_mod  # noqa: E402
import hr_employees  # noqa: E402


ORG = "org-1"
USER = {"id": "u-1", "org_id": ORG, "role": "admin",
        "email": "a@a", "team_scope": None}


def _worker(**over):
    base = {"id": "w-1", "org_id": ORG, "deleted_at": None,
            "active": True,
            "first_name": "ROBERT", "last_name": "SMITH",
            "email": "rs@x"}
    base.update(over); return base


def _emp(**over):
    base = {"id": "e-1", "org_id": ORG, "employee_id": "EMP-1",
            "deleted_at": None,
            "first_name": "Robert", "last_name": "Smith",
            "linked_worker_id": None, "linked_worker_name": None}
    base.update(over); return base


class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def __aiter__(self): return self._iter()
    async def _iter(self):
        for r in self._rows: yield r


class _FakeUpdateResult:
    def __init__(self, matched, modified):
        self.matched_count = matched
        self.modified_count = modified


class _FakeDB:
    def __init__(self, workers, employees):
        self._workers = {w["id"]: w for w in workers}
        self._emps = {e["id"]: e for e in employees}
        self.workers = MagicMock()
        self.workers.find_one = AsyncMock(side_effect=self._find_one_worker)
        self.workers.update_one = AsyncMock(side_effect=self._update_worker)
        self.hr_employees = MagicMock()
        self.hr_employees.find = MagicMock(side_effect=self._find_emps)
        self.hr_employees.update_many = AsyncMock(side_effect=self._update_many_emps)
        self.hr_employees_audit = MagicMock()
        self.hr_employees_audit.insert_one = AsyncMock()

    async def _find_one_worker(self, filt, _proj=None):
        w = self._workers.get(filt.get("id"))
        if not w or w.get("org_id") != filt.get("org_id"):
            return None
        if filt.get("deleted_at") is None and w.get("deleted_at") is not None:
            return None
        return w

    async def _update_worker(self, filt, update):
        w = self._workers.get(filt.get("id"))
        if not w or w.get("org_id") != filt.get("org_id"):
            return _FakeUpdateResult(0, 0)
        if filt.get("deleted_at") is None and w.get("deleted_at") is not None:
            return _FakeUpdateResult(0, 0)
        for k, v in (update.get("$set") or {}).items():
            w[k] = v
        return _FakeUpdateResult(1, 1)

    def _find_emps(self, filt, _proj=None):
        target_wid = filt.get("linked_worker_id")
        rows = []
        for e in self._emps.values():
            if e.get("deleted_at") is not None:
                continue
            if e.get("linked_worker_id") != target_wid:
                continue
            rows.append(e)
        return _Cursor(rows)

    async def _update_many_emps(self, filt, update):
        target_wid = filt.get("linked_worker_id")
        modified = 0
        for e in self._emps.values():
            if e.get("deleted_at") is not None:
                continue
            if e.get("linked_worker_id") != target_wid:
                continue
            for k, v in (update.get("$set") or {}).items():
                e[k] = v
            modified += 1
        return _FakeUpdateResult(modified, modified)


class _Req:
    def __init__(self): self.headers = {}
    @property
    def client(self): return type("c", (), {"host": "127.0.0.1"})()


@pytest.fixture
def _patch(monkeypatch):
    def _apply(workers, employees):
        fake = _FakeDB(workers, employees)
        monkeypatch.setattr(workers_mod, "db", fake)
        # hr_employees._audit is imported inside delete_worker via
        # a deferred `from hr_employees import _audit as _hr_audit`, so
        # patching the source module is enough.
        monkeypatch.setattr(hr_employees, "_audit", AsyncMock())
        monkeypatch.setattr(hr_employees, "db", fake)
        # Neutralise the require_scoped_access guard for handler-level tests.
        monkeypatch.setattr(workers_mod, "require_scoped_access",
                            lambda *a, **k: None)
        return fake
    return _apply


# ---------------------------------------------------------------------------
# 1. Zero linked employees — cascade path is a no-op
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_soft_delete_with_zero_linked_employees(_patch):
    fake = _patch([_worker()], [_emp(linked_worker_id=None)])
    r = await workers_mod.delete_worker(
        worker_id="w-1", request=_Req(), user=USER)
    assert r is None
    # Worker is now soft-deleted.
    assert fake._workers["w-1"]["deleted_at"] is not None
    # Cascade never fired.
    fake.hr_employees.update_many.assert_not_called()
    hr_employees._audit.assert_not_awaited()


# ---------------------------------------------------------------------------
# 2. One linked employee — pointer + name cleared, audit written
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_soft_delete_with_one_linked_employee(_patch):
    fake = _patch(
        [_worker()],
        [_emp(id="e-1", linked_worker_id="w-1",
              linked_worker_name="Robert Smith")],
    )
    await workers_mod.delete_worker(
        worker_id="w-1", request=_Req(), user=USER)
    assert fake._emps["e-1"]["linked_worker_id"] is None
    assert fake._emps["e-1"]["linked_worker_name"] is None
    # Exactly one audit row.
    assert hr_employees._audit.await_count == 1
    call = hr_employees._audit.await_args
    assert call.kwargs["action"] == "worker_unlinked_via_cascade"
    assert call.kwargs["employee_id"] == "EMP-1"
    assert call.kwargs["target_uid"] == "e-1"
    extra = call.kwargs["extra"]
    assert extra["prev_worker_id"] == "w-1"
    assert extra["reason"] == "worker_soft_deleted"


# ---------------------------------------------------------------------------
# 3. Multiple linked employees — all cleared, defensive against uniqueness
#    loosening (current linker enforces 1-1 but the cascade must handle N-1)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_soft_delete_with_three_linked_employees(_patch):
    fake = _patch(
        [_worker()],
        [
            _emp(id="e-1", employee_id="EMP-1", linked_worker_id="w-1",
                 linked_worker_name="Robert Smith"),
            _emp(id="e-2", employee_id="EMP-2", linked_worker_id="w-1",
                 linked_worker_name="Robert Smith"),
            _emp(id="e-3", employee_id="EMP-3", linked_worker_id="w-1",
                 linked_worker_name="Robert Smith"),
        ],
    )
    await workers_mod.delete_worker(
        worker_id="w-1", request=_Req(), user=USER)
    for eid in ("e-1", "e-2", "e-3"):
        assert fake._emps[eid]["linked_worker_id"] is None
        assert fake._emps[eid]["linked_worker_name"] is None
    assert hr_employees._audit.await_count == 3


# ---------------------------------------------------------------------------
# 4. Regression — cascade only touches THE targeted worker's links
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_soft_delete_does_not_touch_unrelated_links(_patch):
    fake = _patch(
        [_worker(id="w-1"), _worker(id="w-2")],
        [
            _emp(id="e-1", linked_worker_id="w-1",
                 linked_worker_name="w1 name"),
            _emp(id="e-2", employee_id="EMP-2", linked_worker_id="w-2",
                 linked_worker_name="w2 name"),
        ],
    )
    await workers_mod.delete_worker(
        worker_id="w-1", request=_Req(), user=USER)
    # e-1 cleared, e-2 untouched.
    assert fake._emps["e-1"]["linked_worker_id"] is None
    assert fake._emps["e-2"]["linked_worker_id"] == "w-2"
    assert fake._emps["e-2"]["linked_worker_name"] == "w2 name"
    # Exactly one audit row (for e-1).
    assert hr_employees._audit.await_count == 1


# ---------------------------------------------------------------------------
# 5. Idempotency — if link somehow gets cleared elsewhere between the
#    initial find and the update_many (race), no crash, no ghost audit.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_soft_delete_cascade_idempotent(_patch):
    """After a first successful cascade, re-running against the same
    (now-soft-deleted) worker via a repeat call must 404 without
    crashing the audit path."""
    fake = _patch(
        [_worker()],
        [_emp(id="e-1", linked_worker_id="w-1",
              linked_worker_name="Robert Smith")],
    )
    await workers_mod.delete_worker(
        worker_id="w-1", request=_Req(), user=USER)
    # e-1 now cleared. Worker is soft-deleted.
    assert fake._emps["e-1"]["linked_worker_id"] is None
    # Second call — worker no longer visible (deleted_at set).
    with pytest.raises(HTTPException) as ei:
        await workers_mod.delete_worker(
            worker_id="w-1", request=_Req(), user=USER)
    assert ei.value.status_code == 404
    # Still only one audit row — the second call bailed before cascade.
    assert hr_employees._audit.await_count == 1


# ---------------------------------------------------------------------------
# 6. 404 path — deleting a worker that doesn't exist raises WITHOUT
#    firing the cascade (defence-in-depth against ordering bugs).
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_soft_delete_unknown_worker_404_no_cascade(_patch):
    fake = _patch([], [_emp(linked_worker_id="w-99")])
    with pytest.raises(HTTPException) as ei:
        await workers_mod.delete_worker(
            worker_id="w-99", request=_Req(), user=USER)
    assert ei.value.status_code == 404
    fake.hr_employees.update_many.assert_not_called()
    hr_employees._audit.assert_not_awaited()
