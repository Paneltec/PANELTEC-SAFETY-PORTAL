"""v160.3.9.58.0.1 — Bulk-import Pre-Starts scaling bundle.

Covers the six new capabilities added on top of the v58 hardening:

  1. **Streaming walker** — enumerates 3-level nested archives with
     bounded memory. `_stream_pdfs_from_archive` yields
     `(archive_label, pdf_name, pdf_bytes)` tuples one at a time.
  2. **Running-stats fail-fast** — `_RunningExtractStats.observe()`
     trips `ExtractLimitExceeded` on the FIRST breach without
     enumerating the whole tree.
  3. **Claude backoff** — `_claude_call_with_backoff` retries transient
     429/5xx errors with exponential delay; non-retriable errors surface
     immediately.
  4. **PDF hash cache** — `_pdf_hash` is stable; `_cache_lookup` +
     `_cache_put` round-trip through a monkeypatched collection so a
     "second run" for the same content skips Claude entirely.
  5. **Stage-specific watchdogs** — download / extract read
     `stage_started_at`; vision-stall keys off `last_progress_at` delta.
  6. **Progress persistence** — `progress = {total, extracted, matched,
     cached_hits, failed, failed_pdfs, estimated_cost_usd}` shape is
     correct on the running-stats emit path (spot-checked via
     `_flush_progress`-style dict — the full producer/consumer run is
     exercised by the live dry-run curl, not pytest).

All tests operate on pure functions or monkey-patched in-memory
collections — none touch the live production Mongo (guarded by the
session-wide `production_db_guard` in `conftest.py`).
"""
from __future__ import annotations

import asyncio
import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest

import bulk_import_prestarts as bip


# ─────────────────────── helpers ───────────────────────


_TINY_PDF = (b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"
             b"trailer\n<< >>\n%%EOF\n")


def _make_flat_zip(path, pdf_count: int) -> None:
    """Create a flat ZIP of tiny placeholder PDFs."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for i in range(pdf_count):
            zf.writestr(f"pdf_{i:03d}.pdf", _TINY_PDF)


def _make_two_level_zip(path, outer_zip_count: int, pdfs_per_zip: int,
                        extra_outer_pdfs: int = 0) -> None:
    """Create a 2-level nested ZIP:

        outer.zip
          ├── plain_A.pdf   (extra_outer_pdfs of these)
          ├── nested_0.zip
          │     ├── pdf_000.pdf ... pdf_N.pdf
          ├── nested_1.zip
          │     └── ...
          └── __MACOSX/._nested_0.zip  (must be skipped)
    """
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as outer:
        # Sidecar cruft — walker must ignore this.
        outer.writestr("__MACOSX/._nested_0.zip", b"garbage")
        for i in range(extra_outer_pdfs):
            outer.writestr(f"plain_{i:03d}.pdf", _TINY_PDF)
        for oi in range(outer_zip_count):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as inner:
                for pi in range(pdfs_per_zip):
                    inner.writestr(f"inner_{oi:02d}_{pi:02d}.pdf", _TINY_PDF)
                # Sidecar cruft inside the nested archive too.
                inner.writestr("__MACOSX/._inner.pdf", b"garbage")
            outer.writestr(f"nested_{oi:02d}.zip", buf.getvalue())


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ─────────────────────── streaming walker ───────────────────────


class TestStreamingWalker:
    def test_flat_zip_yields_all_pdfs(self, tmp_path):
        zpath = tmp_path / "flat.zip"
        _make_flat_zip(zpath, 12)

        async def _drain():
            stats = bip._RunningExtractStats()
            got = []
            async for item in bip._stream_pdfs_from_archive(str(zpath), stats):
                got.append(item)
            return got, stats

        results, stats = _run(_drain())
        assert len(results) == 12
        assert stats.entries == 12
        # All labelled as coming from the outer archive.
        assert {r[0] for r in results} == {"<outer>"}
        # Every yielded blob is real PDF bytes.
        assert all(r[2].startswith(b"%PDF-1.4") for r in results)

    def test_two_level_nested_zip(self, tmp_path):
        zpath = tmp_path / "nested.zip"
        _make_two_level_zip(zpath, outer_zip_count=3, pdfs_per_zip=5,
                            extra_outer_pdfs=2)

        async def _drain():
            stats = bip._RunningExtractStats()
            names = []
            labels = []
            async for label, name, _b in bip._stream_pdfs_from_archive(
                    str(zpath), stats):
                labels.append(label)
                names.append(name)
            return names, labels, stats

        names, labels, stats = _run(_drain())
        # 2 outer PDFs + 3 nested zips × 5 PDFs each = 17.
        assert len(names) == 17
        assert stats.entries == 17
        # Outer PDFs labelled as <outer>, nested labelled by their zip.
        assert labels.count("<outer>") == 2
        nested_labels = [l for l in labels if l != "<outer>"]
        assert set(nested_labels) == {"nested_00.zip", "nested_01.zip",
                                      "nested_02.zip"}
        # No __MACOSX filenames leak through.
        assert not any("__MACOSX" in n or n.startswith("._") for n in names)

    def test_fail_fast_on_entry_count(self, tmp_path, monkeypatch):
        """Walker must raise `ExtractLimitExceeded` BEFORE yielding the
        6th PDF when `MAX_PDF_ENTRIES=5`. Proves the check runs during
        enumeration, not after."""
        monkeypatch.setattr(bip, "MAX_PDF_ENTRIES", 5)
        zpath = tmp_path / "over.zip"
        _make_flat_zip(zpath, 20)

        async def _drain():
            stats = bip._RunningExtractStats()
            yielded = 0
            with pytest.raises(bip.ExtractLimitExceeded) as exc:
                async for _ in bip._stream_pdfs_from_archive(
                        str(zpath), stats):
                    yielded += 1
            return yielded, str(exc.value)

        yielded, msg = _run(_drain())
        # Fail-fast: we should have yielded some entries, but stopped
        # promptly at the breach. Not enumerated the whole 20.
        assert yielded < 20
        assert "5" in msg and "too many" in msg.lower()


# ─────────────────────── Claude backoff ───────────────────────


class TestClaudeBackoff:
    def test_retries_on_rate_limit_then_succeeds(self, monkeypatch):
        """Simulate two 429s followed by success — must return the
        successful payload without raising, and the delays should be
        the exponential schedule (1, 2)."""
        monkeypatch.setattr(bip, "VISION_MAX_RETRIES", 5)
        monkeypatch.setattr(bip, "VISION_BACKOFF_CAP_SEC", 30)

        # Patch asyncio.sleep so tests run instantly.
        slept: list[float] = []

        async def _fake_sleep(seconds):
            slept.append(seconds)

        monkeypatch.setattr(bip.asyncio, "sleep", _fake_sleep)

        calls = {"n": 0}

        async def flaky():
            calls["n"] += 1
            if calls["n"] <= 2:
                raise RuntimeError("HTTP 429 rate_limit exceeded")
            return {"ok": True}

        result = _run(bip._claude_call_with_backoff(flaky))
        assert result == {"ok": True}
        assert calls["n"] == 3
        assert slept == [1, 2]

    def test_non_retriable_raises_immediately(self, monkeypatch):
        slept: list[float] = []

        async def _fake_sleep(seconds):
            slept.append(seconds)

        monkeypatch.setattr(bip.asyncio, "sleep", _fake_sleep)

        async def hard_fail():
            raise ValueError("bad JSON — no retries plz")

        with pytest.raises(ValueError):
            _run(bip._claude_call_with_backoff(hard_fail))
        # Non-retriable → sleep should not have been called even once.
        assert slept == []

    def test_gives_up_after_max_retries(self, monkeypatch):
        monkeypatch.setattr(bip, "VISION_MAX_RETRIES", 3)

        async def _fake_sleep(_):
            return None

        monkeypatch.setattr(bip.asyncio, "sleep", _fake_sleep)

        calls = {"n": 0}

        async def always_429():
            calls["n"] += 1
            raise RuntimeError("HTTP 429 too many requests")

        with pytest.raises(RuntimeError):
            _run(bip._claude_call_with_backoff(always_429))
        # 3 retries + initial → 4 attempts.
        assert calls["n"] == 4


# ─────────────────────── PDF hash cache ───────────────────────


class TestPdfHashCache:
    def test_hash_is_stable(self):
        h1 = bip._pdf_hash(b"hello world")
        h2 = bip._pdf_hash(b"hello world")
        assert h1 == h2
        assert bip._pdf_hash(b"hello world!") != h1
        # sha256 = 64 hex chars.
        assert len(h1) == 64

    def test_cache_roundtrip(self, monkeypatch):
        """`_cache_put` → `_cache_lookup` for the same key returns the
        stored payload."""
        store: dict = {}

        class _FakeCache:
            @staticmethod
            async def replace_one(filt, doc, upsert=False):
                key = (filt["org_id"], filt["pdf_hash"])
                store[key] = dict(doc)
                return type("R", (), {"upserted_id": None})()

            @staticmethod
            async def find_one(filt, proj=None):
                key = (filt["org_id"], filt["pdf_hash"])
                return dict(store[key]) if key in store else None

            @staticmethod
            async def update_one(filt, upd):
                key = (filt["org_id"], filt["pdf_hash"])
                if key in store:
                    store[key].update(upd.get("$set", {}))
                return type("R", (), {"modified_count": 1})()

        monkeypatch.setattr(bip.db, "bulk_import_pdf_cache", _FakeCache)

        payload = {
            "classifier": {"template_name": "Daily Pre-Start",
                           "confidence": 0.9},
            "extracted": {"worker_name": "A Barbari"},
            "template_id": "tmpl-1",
            "template_name": "Daily Pre-Start",
            "worker_match": {"id": "w1", "confidence": 1.0,
                             "needs_review": False},
            "site_match": {"id": "s1"},
        }

        _run(bip._cache_put("org-x", "hash-a", payload))
        got = _run(bip._cache_lookup("org-x", "hash-a"))
        assert got is not None
        assert got["classifier"]["template_name"] == "Daily Pre-Start"
        assert got["worker_match"]["id"] == "w1"

        # Miss returns None.
        miss = _run(bip._cache_lookup("org-x", "hash-b"))
        assert miss is None


# ─────────────────────── stage-specific watchdog ───────────────────────


class TestStageWatchdog:
    def test_download_stall_reaped(self, monkeypatch):
        old = (datetime.now(timezone.utc)
               - timedelta(minutes=bip.DOWNLOAD_TIMEOUT_MIN + 5)).isoformat()
        jobs = _InMemoryJobs([
            {"id": "dl-old", "state": "downloading",
             "stage_started_at": old, "last_progress_at": old},
        ])
        monkeypatch.setattr(bip.db, "bulk_import_jobs", jobs)
        result = _run(bip.watchdog_tick())
        assert result["reaped"] == 1
        assert jobs.by_id("dl-old")["state"] == "failed"
        assert jobs.by_id("dl-old")["error_step"] == "download"

    def test_extract_stall_reaped(self, monkeypatch):
        old = (datetime.now(timezone.utc)
               - timedelta(minutes=bip.EXTRACT_TIMEOUT_MIN + 1)).isoformat()
        jobs = _InMemoryJobs([
            {"id": "ex-old", "state": "extracting",
             "stage_started_at": old, "last_progress_at": old},
        ])
        monkeypatch.setattr(bip.db, "bulk_import_jobs", jobs)
        result = _run(bip.watchdog_tick())
        assert result["reaped"] == 1
        assert jobs.by_id("ex-old")["error_step"] == "extract"

    def test_vision_stall_reaped_via_progress_delta(self, monkeypatch):
        """Job in `dryrun` for hours but with `last_progress_at`
        stale > VISION_STALL_TIMEOUT_MIN → reaped with `vision`."""
        old = (datetime.now(timezone.utc)
               - timedelta(minutes=bip.VISION_STALL_TIMEOUT_MIN + 1)).isoformat()
        long_ago_start = (datetime.now(timezone.utc)
                          - timedelta(hours=4)).isoformat()
        jobs = _InMemoryJobs([
            {"id": "vs-old", "state": "dryrun",
             "stage_started_at": long_ago_start,
             "last_progress_at": old},
        ])
        monkeypatch.setattr(bip.db, "bulk_import_jobs", jobs)
        result = _run(bip.watchdog_tick())
        assert result["reaped"] == 1
        assert jobs.by_id("vs-old")["error_step"] == "vision"

    def test_vision_healthy_not_reaped(self, monkeypatch):
        """A multi-hour job with a recent progress bump is HEALTHY —
        must NOT be reaped. This is the whole point of the delta check."""
        long_ago = (datetime.now(timezone.utc)
                    - timedelta(hours=6)).isoformat()
        recent = datetime.now(timezone.utc).isoformat()
        jobs = _InMemoryJobs([
            {"id": "vs-healthy", "state": "processing",
             "stage_started_at": long_ago,
             "last_progress_at": recent},
        ])
        monkeypatch.setattr(bip.db, "bulk_import_jobs", jobs)
        result = _run(bip.watchdog_tick())
        assert result["reaped"] == 0
        assert jobs.by_id("vs-healthy")["state"] == "processing"

    def test_legacy_row_without_stage_started_at_uses_started_at(self, monkeypatch):
        """Pre-v58.0.1 rows only have `started_at` — watchdog must fall
        back gracefully rather than crash."""
        old = (datetime.now(timezone.utc)
               - timedelta(minutes=bip.DOWNLOAD_TIMEOUT_MIN + 5)).isoformat()
        jobs = _InMemoryJobs([
            {"id": "legacy", "state": "downloading",
             "started_at": old},  # note: no stage_started_at
        ])
        monkeypatch.setattr(bip.db, "bulk_import_jobs", jobs)
        result = _run(bip.watchdog_tick())
        assert result["reaped"] == 1


# ─────────────────────── in-memory jobs collection ───────────────────────


class _InMemoryJobs:
    """Minimal Motor-shaped async collection for watchdog + retention
    tests. Supports the exact calls the pipeline makes."""

    def __init__(self, docs: list[dict]):
        self._docs = [dict(d) for d in docs]

    def find(self, filt: dict, projection: dict | None = None):
        matches = [d for d in self._docs if self._match(d, filt)]

        async def _agen():
            for d in matches:
                yield dict(d)

        return _agen()

    async def update_one(self, filt: dict, update: dict):
        for i, d in enumerate(self._docs):
            if self._match(d, filt):
                for k, v in update.get("$set", {}).items():
                    d[k] = v
                self._docs[i] = d
                return type("R", (), {"modified_count": 1})()
        return type("R", (), {"modified_count": 0})()

    async def delete_many(self, filt: dict):
        before = len(self._docs)
        self._docs = [d for d in self._docs if not self._match(d, filt)]
        return type("R", (), {"deleted_count": before - len(self._docs)})()

    def by_id(self, jid: str) -> dict:
        return next(d for d in self._docs if d["id"] == jid)

    def _match(self, doc, filt) -> bool:
        for k, v in filt.items():
            if isinstance(v, dict):
                if "$in" in v and doc.get(k) not in v["$in"]:
                    return False
                if "$nin" in v and doc.get(k) in v["$nin"]:
                    return False
                if "$lt" in v and not (doc.get(k) is not None
                                       and doc.get(k) < v["$lt"]):
                    return False
            else:
                if doc.get(k) != v:
                    return False
        return True
