"""v160.3.9.58.8 — Contract tests for `auto_resume_orphaned_jobs`.

Covers the three invariants that matter for the startup hook:
  1. A `processing` job with stale `last_progress_at` (older than
     `AUTO_RESUME_GRACE_SECONDS`) is picked up.
  2. A `processing` job with FRESH `last_progress_at` (< grace) is
     LEFT ALONE — we must not step on a live worker.
  3. A `complete` job is NEVER touched.

Also validates: `dry_run` mode jobs are excluded (they're user-driven
review loops), and the `auto_resume_count` is bumped so we can track
repeated resurrections in logs.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import bulk_import_prestarts as bip


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _iso(secs_ago=0):
    return (datetime.now(timezone.utc)
            - timedelta(seconds=secs_ago)).isoformat()


class _FakeJobsColl:
    """Minimal Motor-shaped stub for `bulk_import_jobs`. Supports the
    ops `auto_resume_orphaned_jobs` uses: `find(filter).to_list`,
    `update_one(filter, update)`."""

    def __init__(self, seed):
        self._docs = list(seed)
        self.updates = []

    def find(self, filt, projection=None):
        docs = self._docs
        def _match(d, k, v):
            cur = d.get(k)
            if isinstance(v, dict):
                if "$in" in v and cur not in v["$in"]:
                    return False
                if "$lt" in v and not (cur is not None and cur < v["$lt"]):
                    return False
                return True
            return cur == v

        def _or_match(d, or_clauses):
            for clause in or_clauses:
                if all(_match(d, k, v) for k, v in clause.items()):
                    return True
            return False

        matched = []
        for d in docs:
            ok = True
            for k, v in filt.items():
                if k == "$or":
                    if not _or_match(d, v):
                        ok = False; break
                elif not _match(d, k, v):
                    ok = False; break
            if ok:
                matched.append(d)

        class _Cursor:
            def __init__(self, items):
                self._items = items
            async def to_list(self, length=None):
                return list(self._items)
        return _Cursor(matched)

    async def update_one(self, filt, update):
        for d in self._docs:
            if all(d.get(k) == v for k, v in filt.items() if not isinstance(v, dict)):
                for k, v in update.get("$set", {}).items():
                    d[k] = v
                self.updates.append((filt, update))
                return


class TestAutoResume:
    """Every test mocks BOTH `db.bulk_import_jobs` (for reads/writes)
    AND `_run_job` (to capture which jobs would have been resumed)
    AND `_notify_admins` (to avoid touching the notifications
    collection)."""

    def _patch_deps(self, monkeypatch, coll):
        monkeypatch.setattr(bip.db, "bulk_import_jobs", coll)
        resumed_ids = []
        async def fake_run_job(job_id, mode):
            resumed_ids.append((job_id, mode))
        async def fake_notify(*args, **kwargs):
            pass
        monkeypatch.setattr(bip, "_run_job", fake_run_job)
        monkeypatch.setattr(bip, "_notify_admins", fake_notify)
        # Awaiting the tasks so the test doesn't leak coroutines.
        real_create_task = asyncio.create_task
        created = []
        def spy_create_task(coro):
            t = real_create_task(coro)
            created.append(t)
            return t
        monkeypatch.setattr(asyncio, "create_task", spy_create_task)
        return resumed_ids, created

    def test_stale_processing_job_is_resumed(self, monkeypatch):
        coll = _FakeJobsColl([{
            "id": "job-stale", "org_id": "o1", "state": "processing",
            "mode": "full_run", "processed": 1234,
            "last_progress_at": _iso(secs_ago=600),  # 10 min stale
        }])
        resumed, created = self._patch_deps(monkeypatch, coll)
        res = _run(bip.auto_resume_orphaned_jobs())
        _run(asyncio.gather(*created, return_exceptions=True))
        assert res["resumed"] == 1
        assert "job-stale" in res["job_ids"]
        assert resumed == [("job-stale", "full_run")]
        # `auto_resume_count` bumped + `last_progress_at` refreshed.
        d = coll._docs[0]
        assert d.get("auto_resume_count") == 1
        assert d.get("auto_resumed_at") is not None

    def test_fresh_processing_job_is_left_alone(self, monkeypatch):
        coll = _FakeJobsColl([{
            "id": "job-live", "org_id": "o1", "state": "processing",
            "mode": "full_run", "processed": 500,
            # 10 s ago — well inside the 90 s grace window.
            "last_progress_at": _iso(secs_ago=10),
        }])
        resumed, created = self._patch_deps(monkeypatch, coll)
        res = _run(bip.auto_resume_orphaned_jobs())
        _run(asyncio.gather(*created, return_exceptions=True))
        assert res["resumed"] == 0
        assert resumed == []
        # Original doc unchanged.
        assert coll._docs[0].get("auto_resume_count", 0) == 0

    def test_complete_job_never_touched(self, monkeypatch):
        coll = _FakeJobsColl([{
            "id": "job-done", "org_id": "o1", "state": "complete",
            "mode": "full_run", "processed": 10000,
            "last_progress_at": _iso(secs_ago=99999),
        }])
        resumed, created = self._patch_deps(monkeypatch, coll)
        res = _run(bip.auto_resume_orphaned_jobs())
        _run(asyncio.gather(*created, return_exceptions=True))
        assert res["resumed"] == 0
        assert resumed == []

    def test_dry_run_mode_excluded(self, monkeypatch):
        """User-driven dry_run reviews must not be silently continued."""
        coll = _FakeJobsColl([{
            "id": "job-dryrun", "org_id": "o1", "state": "processing",
            "mode": "dry_run", "processed": 20,
            "last_progress_at": _iso(secs_ago=600),
        }])
        resumed, created = self._patch_deps(monkeypatch, coll)
        res = _run(bip.auto_resume_orphaned_jobs())
        _run(asyncio.gather(*created, return_exceptions=True))
        assert res["resumed"] == 0

    def test_multiple_orphans_all_resumed(self, monkeypatch):
        coll = _FakeJobsColl([
            {"id": "j1", "org_id": "o1", "state": "processing",
             "mode": "full_run", "last_progress_at": _iso(secs_ago=500)},
            {"id": "j2", "org_id": "o1", "state": "downloading",
             "mode": "full_run", "last_progress_at": _iso(secs_ago=200)},
            {"id": "j3", "org_id": "o1", "state": "processing",
             "mode": "full_run", "last_progress_at": _iso(secs_ago=5)},  # fresh
        ])
        resumed, created = self._patch_deps(monkeypatch, coll)
        res = _run(bip.auto_resume_orphaned_jobs())
        _run(asyncio.gather(*created, return_exceptions=True))
        assert res["resumed"] == 2
        assert sorted(res["job_ids"]) == ["j1", "j2"]
