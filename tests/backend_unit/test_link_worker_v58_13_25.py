"""v58.13.25 — Employee ↔ Worker linker handler-level pytests.

Fake `db` + monkeypatched permissions. Same style as v58.13.17/.18/.21.
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

import hr_employees  # noqa: E402


ORG = "org-1"
USER = {"id": "u-1", "org_id": ORG, "role": "admin", "email": "a@a"}


def _emp(**over):
    base = {"id": "e-1", "org_id": ORG, "deleted_at": None,
            "first_name": "Robert", "last_name": "Smith",
            "linked_worker_id": None}
    base.update(over); return base


def _worker(**over):
    base = {"id": "w-1", "org_id": ORG, "deleted_at": None,
            "first_name": "Robert", "last_name": "Smith",
            "position": "Electrician", "email": "rs@x",
            "simpro_employee_id": "S-1"}
    base.update(over); return base


class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def __aiter__(self): return self._iter()
    async def _iter(self):
        for r in self._rows: yield r


class _FakeDB:
    def __init__(self, employees, workers):
        self._emps = {e["id"]: e for e in employees}
        self._workers = {w["id"]: w for w in workers}
        self.hr_employees = MagicMock()
        self.hr_employees.find_one = AsyncMock(side_effect=self._find_one_emp)
        self.hr_employees.update_one = AsyncMock(side_effect=self._update_emp)
        self.hr_employees.find = MagicMock(side_effect=self._find_emps)
        self.workers = MagicMock()
        self.workers.find_one = AsyncMock(side_effect=self._find_one_worker)
        self.workers.find = MagicMock(side_effect=self._find_workers)
        self.hr_employees_audit = MagicMock()
        self.hr_employees_audit.insert_one = AsyncMock()

    async def _find_one_emp(self, filt, _proj=None):
        # First try id-based match (link/unlink lookup). Only when id
        # is a plain string — not the {"$ne": ...} dict used by the
        # collision query.
        if isinstance(filt.get("id"), str):
            e = self._emps.get(filt["id"])
            if not e: return None
            if "org_id" in filt and e.get("org_id") != filt["org_id"]:
                return None
            if filt.get("deleted_at") is None and e.get("deleted_at") is not None: return None
            return e
        # Collision query: {linked_worker_id, id:{$ne:eid}}
        target_wid = filt.get("linked_worker_id")
        exclude = filt.get("id", {}).get("$ne")
        for e in self._emps.values():
            if "org_id" in filt and e.get("org_id") != filt["org_id"]:
                continue
            if e.get("deleted_at") is not None: continue
            if e.get("linked_worker_id") != target_wid: continue
            if e["id"] == exclude: continue
            return e
        return None

    async def _find_one_worker(self, filt, _proj=None):
        w = self._workers.get(filt["id"])
        if not w or w.get("org_id") != filt.get("org_id"): return None
        if filt.get("deleted_at") is None and w.get("deleted_at") is not None: return None
        return w

    async def _update_emp(self, filt, update):
        e = self._emps.get(filt["id"])
        if not e: return
        for k, v in (update.get("$set") or {}).items(): e[k] = v

    def _find_emps(self, filt, _proj=None):
        rows = [e for e in self._emps.values()
                if ("org_id" not in filt or e.get("org_id") == filt["org_id"])
                and e.get("deleted_at") is None
                and e.get("linked_worker_id") not in (None, "")]
        return _Cursor(rows)

    def _find_workers(self, filt, _proj=None):
        rows = [w for w in self._workers.values()
                if w.get("org_id") == filt.get("org_id")
                and w.get("deleted_at") is None]
        return _Cursor(rows)


@pytest.fixture
def _patch(monkeypatch):
    def _apply(employees, workers):
        fake = _FakeDB(employees, workers)
        monkeypatch.setattr(hr_employees, "db", fake)
        monkeypatch.setattr(hr_employees, "_audit", AsyncMock())
        return fake
    return _apply


class _Req:  # minimal stand-in for FastAPI Request
    def __init__(self): self.headers = {}
    @property
    def client(self): return type("c", (), {"host": "127.0.0.1"})()


@pytest.mark.asyncio
async def test_link_happy_path(_patch):
    _patch([_emp()], [_worker()])
    r = await hr_employees.link_worker(
        eid="e-1", body=hr_employees.LinkWorkerIn(worker_id="w-1"),
        request=_Req(), user=USER)
    assert r["ok"] is True
    assert r["linked_worker_id"] == "w-1"
    assert r["linked_worker_name"] == "Robert Smith"
    hr_employees._audit.assert_awaited_once()


@pytest.mark.asyncio
async def test_link_worker_not_found(_patch):
    _patch([_emp()], [])
    with pytest.raises(HTTPException) as ei:
        await hr_employees.link_worker(
            eid="e-1", body=hr_employees.LinkWorkerIn(worker_id="ghost"),
            request=_Req(), user=USER)
    assert ei.value.status_code == 404


@pytest.mark.asyncio
async def test_link_employee_not_found(_patch):
    _patch([], [_worker()])
    with pytest.raises(HTTPException) as ei:
        await hr_employees.link_worker(
            eid="ghost", body=hr_employees.LinkWorkerIn(worker_id="w-1"),
            request=_Req(), user=USER)
    assert ei.value.status_code == 404


@pytest.mark.asyncio
async def test_link_uniqueness_collision_409(_patch):
    # e-1 is already linked to w-1. Try to link e-2 to w-1 → 409.
    _patch(
        [_emp(id="e-1", linked_worker_id="w-1"),
         _emp(id="e-2", first_name="Robert", last_name="Smyth")],
        [_worker()],
    )
    with pytest.raises(HTTPException) as ei:
        await hr_employees.link_worker(
            eid="e-2", body=hr_employees.LinkWorkerIn(worker_id="w-1"),
            request=_Req(), user=USER)
    assert ei.value.status_code == 409
    assert ei.value.detail["error"] == "worker-already-linked"
    assert ei.value.detail["linked_to_employee_id"] == "e-1"


@pytest.mark.asyncio
async def test_unlink_happy_path(_patch):
    fake = _patch([_emp(linked_worker_id="w-1",
                        linked_worker_name="Robert Smith")], [_worker()])
    r = await hr_employees.unlink_worker(
        eid="e-1", request=_Req(), user=USER)
    assert r == {"ok": True, "was_linked": True}
    assert fake._emps["e-1"]["linked_worker_id"] is None
    hr_employees._audit.assert_awaited_once()


@pytest.mark.asyncio
async def test_unlink_idempotent_when_already_null(_patch):
    _patch([_emp(linked_worker_id=None)], [_worker()])
    r = await hr_employees.unlink_worker(
        eid="e-1", request=_Req(), user=USER)
    assert r == {"ok": True, "was_linked": False}
    # No audit row when nothing was cleared.
    hr_employees._audit.assert_not_awaited()


@pytest.mark.asyncio
async def test_candidates_exact_match_similarity_10(_patch):
    _patch([_emp(first_name="Robert", last_name="Smith")],
           [_worker(id="w-1", first_name="Robert", last_name="Smith"),
            _worker(id="w-2", first_name="Alice", last_name="Chen")])
    r = await hr_employees.link_candidates(eid="e-1", limit=10, user=USER)
    top = r["candidates"][0]
    assert top["id"] == "w-1"
    assert top["similarity"] == 1.0
    # Alice Chen shouldn't clear the 0.75 threshold vs Robert Smith.
    assert not any(c["id"] == "w-2" for c in r["candidates"])


@pytest.mark.asyncio
async def test_candidates_typo_matched_via_lfi_tier(_patch):
    """v58.13.26 — 1-char first-name typo with an exact surname now
    matches at 1.0 via the `norm_last_first_initial` tier (both
    normalise to `smith r`). This is stronger than v58.13.25's fuzzy
    ratio ≥0.75 (which was noise-prone in the 0.60-0.79 band on live
    data) — the LFI tier is exact after normalisation."""
    _patch([_emp(first_name="Robert", last_name="Smith", email=None)],
           [_worker(id="w-1", first_name="Robet", last_name="Smith",
                    email=None)])
    r = await hr_employees.link_candidates(eid="e-1", limit=10, user=USER)
    assert len(r["candidates"]) == 1
    assert r["candidates"][0]["id"] == "w-1"
    assert r["candidates"][0]["similarity"] == 1.0
    assert r["candidates"][0]["tier"] == "norm_lfi"


@pytest.mark.asyncio
async def test_candidates_excludes_already_linked_workers(_patch):
    _patch(
        [_emp(id="e-1", first_name="Robert", last_name="Smith"),
         _emp(id="e-9", first_name="Someone", last_name="Else",
              linked_worker_id="w-1")],
        [_worker(id="w-1", first_name="Robert", last_name="Smith")],
    )
    r = await hr_employees.link_candidates(eid="e-1", limit=10, user=USER)
    assert r["candidates"] == []


@pytest.mark.asyncio
async def test_candidates_excludes_soft_deleted_workers(_patch):
    _patch([_emp()],
           [_worker(id="w-1", deleted_at="2026-01-01T00:00:00+00:00")])
    r = await hr_employees.link_candidates(eid="e-1", limit=10, user=USER)
    assert r["candidates"] == []
