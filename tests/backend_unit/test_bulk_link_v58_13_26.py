"""v58.13.26 — Bulk Employee ↔ Worker link wizard handler-level pytests.

Covers the new composite normaliser + bulk endpoints + regression on
the single-record `/link-candidates` endpoint (which v58.13.25 shipped
with a raw-case SequenceMatcher — hence 0 hits at ≥0.75 on live data).

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
from name_matching import (  # noqa: E402
    find_matches,
    norm_basic,
    norm_last_first_initial,
)


ORG = "org-1"
USER = {"id": "u-1", "org_id": ORG, "role": "admin", "email": "a@a"}


# ---------------------------------------------------------------------------
# Fixtures — fake DB
# ---------------------------------------------------------------------------
def _emp(**over):
    base = {"id": "e-1", "org_id": ORG, "employee_id": "EMP-1",
            "deleted_at": None,
            "first_name": "Robert", "last_name": "Smith",
            "email": "robert.smith@paneltec.com.au",
            "linked_worker_id": None}
    base.update(over); return base


def _worker(**over):
    base = {"id": "w-1", "org_id": ORG, "deleted_at": None,
            "active": True,
            "first_name": "ROBERT", "last_name": "SMITH",
            "position": "Electrician",
            "email": "robert.smith@paneltec.com.au",
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
        if isinstance(filt.get("id"), str):
            e = self._emps.get(filt["id"])
            if not e: return None
            if "org_id" in filt and e.get("org_id") != filt["org_id"]:
                return None
            if filt.get("deleted_at") is None and e.get("deleted_at") is not None:
                return None
            return e
        # collision query {linked_worker_id, id:{$ne:eid}}
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
        if filt.get("deleted_at") is None and w.get("deleted_at") is not None:
            return None
        return w

    async def _update_emp(self, filt, update):
        e = self._emps.get(filt["id"])
        if not e: return
        for k, v in (update.get("$set") or {}).items(): e[k] = v

    def _find_emps(self, filt, _proj=None):
        # Bulk-candidates uses filt without linked_worker_id constraint too.
        rows = []
        for e in self._emps.values():
            if "org_id" in filt and e.get("org_id") != filt["org_id"]:
                continue
            if e.get("deleted_at") is not None:
                continue
            # Filter by linked_worker_id if the query specifies it.
            lw = filt.get("linked_worker_id")
            if isinstance(lw, dict):
                # {"$in": [None]} or {"$ne": None}
                if "$in" in lw:
                    if e.get("linked_worker_id") not in lw["$in"]:
                        continue
                elif "$ne" in lw:
                    if e.get("linked_worker_id") == lw["$ne"]:
                        continue
                    if e.get("linked_worker_id") in (None, ""):
                        continue
            rows.append(e)
        return _Cursor(rows)

    def _find_workers(self, filt, _proj=None):
        rows = []
        for w in self._workers.values():
            if w.get("org_id") != filt.get("org_id"): continue
            if w.get("deleted_at") is not None: continue
            if "active" in filt and w.get("active") != filt["active"]:
                continue
            rows.append(w)
        return _Cursor(rows)


@pytest.fixture
def _patch(monkeypatch):
    def _apply(employees, workers):
        fake = _FakeDB(employees, workers)
        monkeypatch.setattr(hr_employees, "db", fake)
        monkeypatch.setattr(hr_employees, "_audit", AsyncMock())
        return fake
    return _apply


class _Req:
    def __init__(self): self.headers = {}
    @property
    def client(self): return type("c", (), {"host": "127.0.0.1"})()


# ---------------------------------------------------------------------------
# 1. Composite normaliser — tier priority + collision guard
# ---------------------------------------------------------------------------
def test_normaliser_norm_basic_case_insensitive():
    # This is the exact bug v58.13.25 hit — cases differ, raw match fails.
    assert norm_basic("Robert", "Smith") == norm_basic("ROBERT", "SMITH")
    assert norm_basic("Robert", "Smith") == "robert smith"


def test_normaliser_strips_accents_and_punct():
    assert norm_basic("Ástrid", "O'Neill") == "astrid o neill"


def test_normaliser_last_first_initial_drops_middle():
    # Middle-name / initial drift absorbed.
    assert (norm_last_first_initial("Robert James", "Smith")
            == norm_last_first_initial("Robert", "Smith"))
    assert norm_last_first_initial("Robert", "Smith") == "smith r"


def test_find_matches_email_tier_wins_over_name():
    # Email wins even when names differ (nickname case).
    workers = [
        {"id": "w-1", "first_name": "Bob", "last_name": "Smith",
         "email": "robert.smith@paneltec.com.au"},
    ]
    r = find_matches("Robert", "Smith", "robert.smith@paneltec.com.au", workers)
    assert r is not None
    assert r["tier"] == "email"
    assert r["worker"]["id"] == "w-1"


def test_find_matches_norm_basic_when_no_email():
    workers = [{"id": "w-1", "first_name": "ROBERT", "last_name": "SMITH",
                "email": None}]
    r = find_matches("Robert", "Smith", None, workers)
    assert r is not None
    assert r["tier"] == "norm_basic"


def test_find_matches_lfi_when_middle_name_differs():
    workers = [{"id": "w-1", "first_name": "Robert", "last_name": "Smith",
                "email": None}]
    r = find_matches("Robert James", "Smith", None, workers)
    assert r is not None
    assert r["tier"] == "norm_lfi"


def test_find_matches_collision_returns_none():
    # Two workers with same normalised name → ambiguous, refuse.
    workers = [
        {"id": "w-1", "first_name": "Robert", "last_name": "Smith", "email": None},
        {"id": "w-2", "first_name": "Robert", "last_name": "Smith", "email": None},
    ]
    r = find_matches("Robert", "Smith", None, workers)
    assert r is None


def test_find_matches_no_match_returns_none():
    workers = [{"id": "w-1", "first_name": "Alice", "last_name": "Chen", "email": None}]
    r = find_matches("Robert", "Smith", None, workers)
    assert r is None


# ---------------------------------------------------------------------------
# 2. Single-record /link-candidates regression — case-mismatch fix
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_link_candidates_returns_case_mismatched_match(_patch):
    # v58.13.25 raw-case ratio on "Robert Smith" vs "ROBERT SMITH" was
    # ~0.5 → 0 candidates. Post-normalisation must return the match at 1.0.
    _patch([_emp(first_name="Robert", last_name="Smith",
                 email="robert.smith@paneltec.com.au")],
           [_worker(id="w-1", first_name="ROBERT", last_name="SMITH",
                    email="robert.smith@paneltec.com.au")])
    r = await hr_employees.link_candidates(eid="e-1", limit=10, user=USER)
    assert len(r["candidates"]) == 1
    c = r["candidates"][0]
    assert c["id"] == "w-1"
    assert c["similarity"] == 1.0
    assert c["tier"] in ("email", "norm_basic", "norm_lfi")


@pytest.mark.asyncio
async def test_link_candidates_no_fuzzy_returned(_patch):
    """REGRESSION GUARD: fuzzy tier is deliberately excluded.
    'Rob Smyth' should NOT match 'Robert Smith'."""
    _patch([_emp(first_name="Robert", last_name="Smith", email=None)],
           [_worker(id="w-1", first_name="ROB", last_name="SMYTH", email=None)])
    r = await hr_employees.link_candidates(eid="e-1", limit=10, user=USER)
    assert r["candidates"] == []
    assert r.get("reason") == "no_exact_match"
    assert r.get("suggestion") == "browse_all"


@pytest.mark.asyncio
async def test_link_candidates_empty_when_no_email_and_diff_names(_patch):
    _patch([_emp(first_name="Robert", last_name="Smith", email=None)],
           [_worker(id="w-1", first_name="ALICE", last_name="CHEN", email=None)])
    r = await hr_employees.link_candidates(eid="e-1", limit=10, user=USER)
    assert r["candidates"] == []


# ---------------------------------------------------------------------------
# 3. Bulk candidates endpoint — grouping + exclusions
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bulk_candidates_auto_matches_and_no_match(_patch):
    _patch(
        [
            _emp(id="e-1", first_name="Robert", last_name="Smith",
                 email="robert.smith@x", employee_id="EMP-1"),
            _emp(id="e-2", first_name="Alice", last_name="Chen",
                 email=None, employee_id="EMP-2"),
            _emp(id="e-3", first_name="No", last_name="Match",
                 email=None, employee_id="EMP-3"),
        ],
        [
            _worker(id="w-1", first_name="Bob", last_name="Smith",  # email-only match
                    email="robert.smith@x"),
            _worker(id="w-2", first_name="ALICE", last_name="CHEN", email=None),
            _worker(id="w-3", first_name="Zeb", last_name="Zed", email=None),
        ],
    )
    r = await hr_employees.link_candidates_bulk(user=USER)
    assert len(r["auto_matches"]) == 2
    ids = {row["employee_id"] for row in r["auto_matches"]}
    assert ids == {"e-1", "e-2"}
    # e-1 matches via email, e-2 via norm_basic.
    by_eid = {row["employee_id"]: row for row in r["auto_matches"]}
    assert by_eid["e-1"]["tier"] == "email"
    assert by_eid["e-1"]["worker_id"] == "w-1"
    assert by_eid["e-2"]["tier"] == "norm_basic"
    assert by_eid["e-2"]["worker_id"] == "w-2"
    # e-3 has no worker match.
    assert len(r["no_match"]) == 1
    assert r["no_match"][0]["employee_id"] == "e-3"


@pytest.mark.asyncio
async def test_bulk_candidates_excludes_already_linked_employees(_patch):
    _patch(
        [
            _emp(id="e-1", first_name="Robert", last_name="Smith",
                 email=None, linked_worker_id="w-9"),
            _emp(id="e-2", first_name="Alice", last_name="Chen", email=None),
        ],
        [
            _worker(id="w-1", first_name="ALICE", last_name="CHEN", email=None),
        ],
    )
    r = await hr_employees.link_candidates_bulk(user=USER)
    # e-1 is already linked → excluded from both lists.
    all_eids = ({row["employee_id"] for row in r["auto_matches"]} |
                {row["employee_id"] for row in r["no_match"]})
    assert "e-1" not in all_eids
    assert all_eids == {"e-2"}


@pytest.mark.asyncio
async def test_bulk_candidates_excludes_soft_deleted_workers(_patch):
    _patch(
        [_emp(first_name="Robert", last_name="Smith", email=None)],
        [_worker(id="w-1", first_name="ROBERT", last_name="SMITH",
                 email=None, deleted_at="2026-01-01T00:00:00+00:00")],
    )
    r = await hr_employees.link_candidates_bulk(user=USER)
    assert r["auto_matches"] == []
    assert len(r["no_match"]) == 1


@pytest.mark.asyncio
async def test_bulk_candidates_no_worker_double_proposal(_patch):
    """First-come-first-served — a worker can only be proposed for ONE
    employee even when two employees would both match it via the same tier."""
    _patch(
        [
            _emp(id="e-1", first_name="Robert", last_name="Smith", email=None,
                 employee_id="EMP-1"),
            _emp(id="e-2", first_name="Robert", last_name="Smith", email=None,
                 employee_id="EMP-2"),
        ],
        [
            _worker(id="w-1", first_name="ROBERT", last_name="SMITH", email=None),
        ],
    )
    r = await hr_employees.link_candidates_bulk(user=USER)
    proposed_wids = [row["worker_id"] for row in r["auto_matches"]]
    assert proposed_wids.count("w-1") <= 1


# ---------------------------------------------------------------------------
# 4. Bulk commit endpoint
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bulk_link_happy_path_all_succeed(_patch):
    fake = _patch(
        [_emp(id="e-1"), _emp(id="e-2", employee_id="EMP-2",
                               first_name="Alice", last_name="Chen",
                               email="ac@x")],
        [_worker(id="w-1"), _worker(id="w-2", first_name="Alice",
                                     last_name="Chen", email="ac@x")],
    )
    body = hr_employees.BulkLinkIn(links=[
        hr_employees.BulkLinkItem(employee_id="e-1", worker_id="w-1"),
        hr_employees.BulkLinkItem(employee_id="e-2", worker_id="w-2"),
    ])
    r = await hr_employees.link_worker_bulk(
        body=body, request=_Req(), user=USER)
    assert r["succeeded"] == 2
    assert r["failed"] == []
    assert fake._emps["e-1"]["linked_worker_id"] == "w-1"
    assert fake._emps["e-2"]["linked_worker_id"] == "w-2"


@pytest.mark.asyncio
async def test_bulk_link_mixed_success_and_failure(_patch):
    """One row collides with existing link → other rows should still succeed."""
    _patch(
        [
            _emp(id="e-1"),
            _emp(id="e-2", employee_id="EMP-2", first_name="Alice",
                 last_name="Chen", email="ac@x"),
            # e-3 is already linked to w-1 — creates the collision.
            _emp(id="e-3", employee_id="EMP-3", first_name="Existing",
                 last_name="Owner", email="eo@x", linked_worker_id="w-1"),
        ],
        [_worker(id="w-1"), _worker(id="w-2", first_name="Alice",
                                     last_name="Chen", email="ac@x")],
    )
    body = hr_employees.BulkLinkIn(links=[
        hr_employees.BulkLinkItem(employee_id="e-1", worker_id="w-1"),  # 409
        hr_employees.BulkLinkItem(employee_id="e-2", worker_id="w-2"),  # ok
    ])
    r = await hr_employees.link_worker_bulk(body=body, request=_Req(), user=USER)
    assert r["succeeded"] == 1
    assert len(r["failed"]) == 1
    assert r["failed"][0]["employee_id"] == "e-1"
    assert "worker-already-linked" in r["failed"][0]["error"] \
        or "already-linked" in r["failed"][0]["error"]


@pytest.mark.asyncio
async def test_bulk_link_audit_row_per_link(_patch):
    _patch([_emp(id="e-1"), _emp(id="e-2", employee_id="EMP-2",
                                  first_name="Alice", last_name="Chen")],
           [_worker(id="w-1"), _worker(id="w-2", first_name="Alice",
                                        last_name="Chen")])
    body = hr_employees.BulkLinkIn(links=[
        hr_employees.BulkLinkItem(employee_id="e-1", worker_id="w-1"),
        hr_employees.BulkLinkItem(employee_id="e-2", worker_id="w-2"),
    ])
    await hr_employees.link_worker_bulk(body=body, request=_Req(), user=USER)
    # 2 successful links → 2 audit rows.
    assert hr_employees._audit.await_count == 2


@pytest.mark.asyncio
async def test_bulk_link_missing_worker_recorded_as_failure(_patch):
    _patch([_emp(id="e-1")], [_worker(id="w-1")])
    body = hr_employees.BulkLinkIn(links=[
        hr_employees.BulkLinkItem(employee_id="e-1", worker_id="ghost"),
    ])
    r = await hr_employees.link_worker_bulk(body=body, request=_Req(), user=USER)
    assert r["succeeded"] == 0
    assert len(r["failed"]) == 1
    assert r["failed"][0]["employee_id"] == "e-1"


@pytest.mark.asyncio
async def test_bulk_link_empty_body_returns_zero(_patch):
    _patch([_emp()], [_worker()])
    body = hr_employees.BulkLinkIn(links=[])
    r = await hr_employees.link_worker_bulk(body=body, request=_Req(), user=USER)
    assert r == {"succeeded": 0, "failed": []}


# ---------------------------------------------------------------------------
# 5. Regression guard — fuzzy path never returned by bulk endpoint
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_bulk_candidates_no_fuzzy_ever(_patch):
    """0.60 <= ratio < 1.0 (post-normalisation typo) must NOT be returned."""
    _patch(
        [_emp(first_name="Robert", last_name="Smith", email=None)],
        [_worker(id="w-1", first_name="ROB", last_name="SMYTH", email=None)],
    )
    r = await hr_employees.link_candidates_bulk(user=USER)
    assert r["auto_matches"] == []
    assert len(r["no_match"]) == 1
