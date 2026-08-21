"""v58.13.29 — Bulk unlink handler-level pytests.

Covers the new `GET /linked` enumerator + `POST /unlink-worker/bulk`
fan-out + the extracted `_unlink_worker_inner()` helper reuse.

Placed under /app/tests/backend_unit/ per v58.13.10.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

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

import hr_employees  # noqa: E402


ORG = "org-1"
USER = {"id": "u-1", "org_id": ORG, "role": "admin", "email": "a@a"}


def _emp(**over):
    base = {"id": "e-1", "org_id": ORG, "employee_id": "EMP-1",
            "deleted_at": None,
            "first_name": "Robert", "last_name": "Smith",
            "linked_worker_id": None, "linked_worker_name": None,
            "updated_at": "2026-02-01T00:00:00+00:00"}
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
    def __init__(self, employees):
        self._emps = {e["id"]: e for e in employees}
        self.hr_employees = MagicMock()
        self.hr_employees.find_one = AsyncMock(side_effect=self._find_one_emp)
        self.hr_employees.find = MagicMock(side_effect=self._find_emps)
        self.hr_employees.update_one = AsyncMock(side_effect=self._update_emp)
        self.hr_employees_audit = MagicMock()
        self.hr_employees_audit.insert_one = AsyncMock()

    async def _find_one_emp(self, filt, _proj=None):
        if isinstance(filt.get("id"), str):
            e = self._emps.get(filt["id"])
            if not e: return None
            if filt.get("deleted_at") is None and e.get("deleted_at") is not None:
                return None
            return e
        return None

    def _find_emps(self, filt, _proj=None):
        rows = []
        lw = filt.get("linked_worker_id")
        for e in self._emps.values():
            if e.get("deleted_at") is not None:
                continue
            if isinstance(lw, dict):
                # Match `{"$ne": None, "$exists": True}`
                if e.get("linked_worker_id") in (None, ""):
                    continue
            rows.append(e)
        return _Cursor(rows)

    async def _update_emp(self, filt, update):
        e = self._emps.get(filt.get("id"))
        if not e:
            return _FakeUpdateResult(0, 0)
        for k, v in (update.get("$set") or {}).items():
            e[k] = v
        return _FakeUpdateResult(1, 1)


class _Req:
    def __init__(self): self.headers = {}
    @property
    def client(self): return type("c", (), {"host": "127.0.0.1"})()


@pytest.fixture
def _patch(monkeypatch):
    def _apply(employees):
        fake = _FakeDB(employees)
        monkeypatch.setattr(hr_employees, "db", fake)
        monkeypatch.setattr(hr_employees, "_audit", AsyncMock())
        return fake
    return _apply


# ---------------------------------------------------------------------------
# 1. GET /linked shape + filtering
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_list_linked_returns_all_linked_with_correct_shape(_patch):
    _patch([
        _emp(id="e-1", employee_id="EMP-1",
             first_name="Robert", last_name="Smith",
             linked_worker_id="w-1", linked_worker_name="ROBERT SMITH"),
        _emp(id="e-2", employee_id="EMP-2",
             first_name="Alice", last_name="Chen",
             linked_worker_id="w-2", linked_worker_name="ALICE CHEN"),
        # Not linked — should be filtered out.
        _emp(id="e-3", employee_id="EMP-3",
             first_name="Zeb", last_name="Zed",
             linked_worker_id=None),
    ])
    r = await hr_employees.list_linked_employees(user=USER)
    assert r["total"] == 2
    assert len(r["items"]) == 2
    # Sorted by employee_name lowercase.
    names = [row["employee_name"] for row in r["items"]]
    assert names == sorted(names, key=str.lower)
    # Shape check on one row.
    row = r["items"][0]
    for key in ("employee_id", "employee_name", "worker_id", "worker_name"):
        assert key in row
    assert row["worker_name"]  # denormalised worker name preserved
    # `linked_at` is optional but should be present when updated_at was set.
    assert row.get("linked_at")


@pytest.mark.asyncio
async def test_list_linked_excludes_soft_deleted_employees(_patch):
    _patch([
        _emp(id="e-1", linked_worker_id="w-1",
             linked_worker_name="A", deleted_at="2026-01-01T00:00:00+00:00"),
        _emp(id="e-2", employee_id="EMP-2", first_name="Alice",
             last_name="Chen", linked_worker_id="w-2",
             linked_worker_name="Alice Chen"),
    ])
    r = await hr_employees.list_linked_employees(user=USER)
    ids = [row["employee_id"] for row in r["items"]]
    assert ids == ["e-2"]


@pytest.mark.asyncio
async def test_list_linked_empty_when_no_links(_patch):
    _patch([_emp(linked_worker_id=None)])
    r = await hr_employees.list_linked_employees(user=USER)
    assert r == {"items": [], "total": 0}


# ---------------------------------------------------------------------------
# 2. POST /unlink-worker/bulk — happy path, mixed, idempotent
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bulk_unlink_three_valid_ids(_patch):
    fake = _patch([
        _emp(id="e-1", employee_id="EMP-1",
             linked_worker_id="w-1", linked_worker_name="A"),
        _emp(id="e-2", employee_id="EMP-2",
             linked_worker_id="w-2", linked_worker_name="B"),
        _emp(id="e-3", employee_id="EMP-3",
             linked_worker_id="w-3", linked_worker_name="C"),
    ])
    body = hr_employees.BulkUnlinkIn(employee_ids=["e-1", "e-2", "e-3"])
    r = await hr_employees.unlink_worker_bulk(
        body=body, request=_Req(), user=USER)
    assert r["succeeded"] == 3
    assert r["failed"] == []
    for eid in ("e-1", "e-2", "e-3"):
        assert fake._emps[eid]["linked_worker_id"] is None
        assert fake._emps[eid]["linked_worker_name"] is None
    # One audit row per unlink (all had a `prev` value).
    assert hr_employees._audit.await_count == 3


@pytest.mark.asyncio
async def test_bulk_unlink_mixed_valid_and_invalid(_patch):
    _patch([
        _emp(id="e-1", employee_id="EMP-1",
             linked_worker_id="w-1", linked_worker_name="A"),
    ])
    body = hr_employees.BulkUnlinkIn(employee_ids=["e-1", "ghost", "phantom"])
    r = await hr_employees.unlink_worker_bulk(
        body=body, request=_Req(), user=USER)
    assert r["succeeded"] == 1
    assert len(r["failed"]) == 2
    failed_ids = sorted(f["employee_id"] for f in r["failed"])
    assert failed_ids == ["ghost", "phantom"]
    for f in r["failed"]:
        assert "employee-not-found" in f["error"] or "not-found" in f["error"]


@pytest.mark.asyncio
async def test_bulk_unlink_already_unlinked_is_idempotent_succeeded(_patch):
    """v58.13.29 — Passing an already-unlinked eid is a 200 no-op that
    counts as succeeded. No audit row is emitted for the no-op path
    (mirrors the single PATCH behaviour when `prev` is falsy)."""
    fake = _patch([
        _emp(id="e-1", employee_id="EMP-1", linked_worker_id=None),
        _emp(id="e-2", employee_id="EMP-2",
             linked_worker_id="w-2", linked_worker_name="B"),
    ])
    body = hr_employees.BulkUnlinkIn(employee_ids=["e-1", "e-2"])
    r = await hr_employees.unlink_worker_bulk(
        body=body, request=_Req(), user=USER)
    assert r["succeeded"] == 2
    assert r["failed"] == []
    # Only the real unlink got an audit row; the no-op didn't.
    assert hr_employees._audit.await_count == 1
    # e-2 cleared, e-1 stayed None.
    assert fake._emps["e-1"]["linked_worker_id"] is None
    assert fake._emps["e-2"]["linked_worker_id"] is None


@pytest.mark.asyncio
async def test_bulk_unlink_empty_body_returns_zero(_patch):
    _patch([_emp(linked_worker_id="w-1", linked_worker_name="A")])
    body = hr_employees.BulkUnlinkIn(employee_ids=[])
    r = await hr_employees.unlink_worker_bulk(
        body=body, request=_Req(), user=USER)
    assert r == {"succeeded": 0, "failed": []}


# ---------------------------------------------------------------------------
# 3. Single-record unlink still works via extracted helper
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_single_unlink_still_works_via_inner_helper(_patch):
    """Regression guard: extracting `_unlink_worker_inner()` mustn't
    break the existing single PATCH endpoint."""
    fake = _patch([
        _emp(id="e-1", employee_id="EMP-1",
             linked_worker_id="w-1", linked_worker_name="A"),
    ])
    r = await hr_employees.unlink_worker(
        eid="e-1", request=_Req(), user=USER)
    assert r == {"ok": True, "was_linked": True}
    assert fake._emps["e-1"]["linked_worker_id"] is None
    assert hr_employees._audit.await_count == 1
