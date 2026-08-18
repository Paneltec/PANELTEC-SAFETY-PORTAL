"""v160.3.9.58.6 — Contract tests for GET /api/pre-starts/bulk-import/last.

Covers the four invariants the wizard's Resume-button depends on:

  1. Returns `None` when no jobs match (first-time users see nothing).
  2. Returns the MOST RECENT job when several are eligible (wizard
     only ever shows one).
  3. Respects `within_days` cutoff — a very old failed job is ignored.
  4. Respects `states` filter — a `complete` job never shows up in the
     default filter.

The endpoint is a thin FastAPI wrapper around a single Mongo query, so
these tests monkey-patch the collection in-place rather than spinning
up a full app. That keeps the invariant surface small and readable,
and — critically — never touches the production DB (guarded by the
session-wide `production_db_guard` in `conftest.py`).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import bulk_import_prestarts as bip


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _FakeJobs:
    """Minimal Mongo-shaped stand-in for the `bulk_import_jobs`
    collection. Supports the exact `find_one(filter, sort=, projection=)`
    signature that `last_resumable_job` uses."""

    def __init__(self, docs):
        self._docs = list(docs)

    async def find_one(self, filt, sort=None, projection=None):
        def match(d):
            for k, v in filt.items():
                if isinstance(v, dict):
                    if "$in" in v and d.get(k) not in v["$in"]:
                        return False
                    if "$gte" in v and (d.get(k) is None or d.get(k) < v["$gte"]):
                        return False
                elif d.get(k) != v:
                    return False
            return True

        matched = [d for d in self._docs if match(d)]
        if sort:
            key, direction = sort[0]
            matched.sort(key=lambda d: d.get(key) or "",
                         reverse=(direction == -1))
        if not matched:
            return None
        out = dict(matched[0])
        if projection:
            for k, keep in projection.items():
                if keep == 0 and k in out:
                    del out[k]
        return out


ORG = "org-test"
USER = {"id": "u1", "org_id": ORG, "role_id": "admin", "role": "admin"}


def _iso(offset_days=0, offset_hours=0):
    return (datetime.now(timezone.utc)
            - timedelta(days=offset_days, hours=offset_hours)).isoformat()


def _job(state, offset_days=0, offset_hours=0, extracted=0, org_id=ORG,
         url="https://example.com/x.zip", **extra):
    base = {
        "id": f"job-{state}-{offset_days}d-{offset_hours}h",
        "org_id": org_id,
        "state": state,
        "src_url": url,
        "url_input": url,
        "filename": "batch",
        "created_at": _iso(offset_days, offset_hours),
        "last_progress_at": _iso(offset_days, offset_hours),
        "progress": {"extracted": extracted, "matched": 0, "cached_hits": 0,
                     "failed": 0, "total": None, "failed_pdfs": [],
                     "estimated_cost_usd": 0.0},
        "include_failed_rows": True,
    }
    base.update(extra)
    return base


class TestLastResumableJob:
    def test_returns_none_when_no_jobs(self, monkeypatch):
        monkeypatch.setattr(bip.db, "bulk_import_jobs", _FakeJobs([]))
        result = _run(bip.last_resumable_job(user=USER))
        assert result is None

    def test_returns_none_when_no_matching_state(self, monkeypatch):
        # Every job is `complete` — none match the default filter.
        monkeypatch.setattr(bip.db, "bulk_import_jobs", _FakeJobs([
            _job("complete", offset_hours=1),
            _job("complete", offset_days=2),
        ]))
        result = _run(bip.last_resumable_job(user=USER))
        assert result is None

    def test_returns_most_recent_of_many(self, monkeypatch):
        oldest = _job("failed", offset_days=10, extracted=100)
        middle = _job("failed", offset_days=5, extracted=200)
        newest = _job("awaiting_approval", offset_hours=2, extracted=592)
        # Order in the store is intentionally NOT the query order — the
        # endpoint must sort by `created_at` desc regardless.
        monkeypatch.setattr(bip.db, "bulk_import_jobs",
                            _FakeJobs([middle, newest, oldest]))
        result = _run(bip.last_resumable_job(user=USER))
        assert result is not None
        assert result["id"] == newest["id"]
        assert result["state"] == "awaiting_approval"
        assert result["progress"]["extracted"] == 592

    def test_respects_within_days_cutoff(self, monkeypatch):
        # Failed 45 days ago — outside the 30-day default window.
        stale = _job("failed", offset_days=45, extracted=999)
        monkeypatch.setattr(bip.db, "bulk_import_jobs", _FakeJobs([stale]))
        assert _run(bip.last_resumable_job(user=USER)) is None
        # Widening the window rescues the same doc.
        result = _run(bip.last_resumable_job(within_days=60, user=USER))
        assert result is not None
        assert result["id"] == stale["id"]

    def test_respects_states_filter(self, monkeypatch):
        awaiting = _job("awaiting_approval", offset_hours=1, extracted=20)
        failed = _job("failed", offset_hours=3, extracted=592)
        monkeypatch.setattr(bip.db, "bulk_import_jobs",
                            _FakeJobs([awaiting, failed]))
        # Default filter — awaiting is more recent, so it wins.
        default = _run(bip.last_resumable_job(user=USER))
        assert default["state"] == "awaiting_approval"
        # Ask for failed only — the older `failed` row wins.
        only_failed = _run(bip.last_resumable_job(states="failed", user=USER))
        assert only_failed["state"] == "failed"
        assert only_failed["progress"]["extracted"] == 592

    def test_scoped_to_caller_org(self, monkeypatch):
        # A newer failed job belongs to a DIFFERENT org — must be ignored.
        other = _job("failed", offset_hours=1, org_id="other-org",
                     extracted=999)
        mine = _job("failed", offset_hours=3, extracted=100)
        monkeypatch.setattr(bip.db, "bulk_import_jobs",
                            _FakeJobs([other, mine]))
        result = _run(bip.last_resumable_job(user=USER))
        assert result is not None
        assert result["id"] == mine["id"]

    def test_response_shape_projects_wizard_fields(self, monkeypatch):
        j = _job("failed", offset_hours=2, extracted=42,
                 url="https://drop/x.zip",
                 filename="July batch",
                 notes="context",
                 error="boom",
                 error_step="vision",
                 total_pdfs_discovered=100)
        monkeypatch.setattr(bip.db, "bulk_import_jobs", _FakeJobs([j]))
        r = _run(bip.last_resumable_job(user=USER))
        assert r is not None
        # Exactly the keys the frontend consumes.
        for k in ("id", "src_url", "url_input", "filename", "batch_label",
                  "notes", "include_failed_rows", "state", "progress",
                  "total", "total_pdfs_discovered", "created_at",
                  "updated_at", "error", "error_step"):
            assert k in r, f"missing key {k}"
        assert r["batch_label"] == "July batch"
        assert r["notes"] == "context"
        assert r["include_failed_rows"] is True
        assert r["error_step"] == "vision"
        assert r["total_pdfs_discovered"] == 100
