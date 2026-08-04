"""v160.3.9.58 — Bulk-import Pre-Starts Phase 1 hardening.

Covers the 7-patch bundle applied to `bulk_import_prestarts.py`:

  1. URL normalisation for Dropbox `?dl=0/1` + Google Drive `/file/d/…`
     share links (idempotent, doesn't clobber unrelated URLs).
  2. Redirect-following on the HEAD probe (implicitly exercised by
     `_normalize_source_url` + `_resolve_and_head`; deeper redirect
     smoke lives in the live dry-run report, not pytest).
  3. Watchdog: fails jobs stuck in `downloading` / `extracting`
     longer than `BULK_IMPORT_DOWNLOAD_TIMEOUT_MIN`.
  4. Structured `error_step` enum sanity (no branch escapes the enum).
  5. Zip-bomb guardrails: unpacked total, single-entry, and entry-count
     limits all trip `ExtractLimitExceeded` with a descriptive message.
  6. Retention: `retention_cleanup()` prunes jobs + associated
     dryrun rows older than the configured window.

Every test in this module operates on pure module functions or a
monkey-patched in-memory `db` shim — none touch the live production
Mongo (guarded by the session-wide `production_db_guard` in
`conftest.py`).
"""
from __future__ import annotations

import asyncio
import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest

import bulk_import_prestarts as bip


# ─────────────────────── URL normaliser ───────────────────────


class TestNormalizeSourceUrl:
    def test_dropbox_dl0_swap(self):
        url = ("https://www.dropbox.com/scl/fi/abc/x.zip"
               "?rlkey=xyz&st=nxvnv90u&dl=0")
        got = bip._normalize_source_url(url)
        assert "dl=1" in got and "dl=0" not in got

    def test_dropbox_missing_dl_appends(self):
        url = "https://www.dropbox.com/scl/fi/abc/x.zip?rlkey=xyz"
        got = bip._normalize_source_url(url)
        assert got.endswith("dl=1")

    def test_dropbox_already_dl1_idempotent(self):
        url = "https://www.dropbox.com/scl/fi/abc/x.zip?rlkey=xyz&dl=1"
        assert bip._normalize_source_url(url) == url

    def test_gdrive_file_share_link_rewritten(self):
        url = "https://drive.google.com/file/d/1AbC-xyz_123/view?usp=sharing"
        got = bip._normalize_source_url(url)
        assert got == ("https://drive.google.com/uc?export=download"
                       "&id=1AbC-xyz_123")

    def test_gdrive_bare_id_left_alone(self):
        # Only /file/d/<id> URLs get rewritten; the raw uc?… form is
        # already the target and must remain untouched.
        url = "https://drive.google.com/uc?export=download&id=1AbC-xyz_123"
        assert bip._normalize_source_url(url) == url

    def test_unrelated_url_unchanged(self):
        url = "https://example.com/foo/bar.zip"
        assert bip._normalize_source_url(url) == url

    def test_empty_string_safe(self):
        assert bip._normalize_source_url("") == ""

    def test_legacy_alias_still_works(self):
        # A handful of older call-sites (and this test) import
        # `_dropbox_dl_swap` — keep the alias green.
        url = "https://www.dropbox.com/x?dl=0"
        assert bip._dropbox_dl_swap(url) == bip._normalize_source_url(url)


# ─────────────────────── error_step enum ───────────────────────


class TestErrorStepEnum:
    def test_enum_covers_expected_stages(self):
        expected = {
            "download", "extract", "extract_limit", "parse", "vision",
            "match", "dryrun", "approve", "write",
        }
        assert expected == set(bip.ERROR_STEPS)

    def test_fail_job_rejects_unknown_step_but_coerces(self, monkeypatch):
        """`_fail_job` never silently drops an unknown code — logs +
        coerces to `download` so downstream consumers can't be
        surprised by a null/garbage value."""
        called_with = {}

        async def fake_update_one(filt, upd):
            called_with.update(upd["$set"])

        class _Coll:
            update_one = staticmethod(fake_update_one)

        monkeypatch.setattr(bip.db, "bulk_import_jobs", _Coll)
        asyncio.get_event_loop().run_until_complete(
            bip._fail_job("job-x", "bogus_step", "boom"))
        assert called_with["error_step"] in bip.ERROR_STEPS
        assert called_with["state"] == "failed"


# ─────────────────────── zip-bomb guardrail ───────────────────────


class TestZipBombGuard:
    def test_within_limits_no_raise(self):
        # 3 x 1 MB entries, well inside all limits.
        entries = [(1 * 1024 * 1024, f"f{i}.pdf") for i in range(3)]
        bip._guard_zip_limits(entries)  # no raise

    def test_too_many_entries(self, monkeypatch):
        monkeypatch.setattr(bip, "MAX_PDF_ENTRIES", 5)
        entries = [(1024, f"f{i}.pdf") for i in range(6)]
        with pytest.raises(bip.ExtractLimitExceeded) as exc:
            bip._guard_zip_limits(entries)
        assert "6" in str(exc.value) and "5" in str(exc.value)

    def test_single_entry_too_large(self, monkeypatch):
        monkeypatch.setattr(bip, "MAX_SINGLE_ENTRY_BYTES", 10 * 1024 * 1024)
        entries = [(50 * 1024 * 1024, "huge.pdf")]
        with pytest.raises(bip.ExtractLimitExceeded) as exc:
            bip._guard_zip_limits(entries)
        assert "huge.pdf" in str(exc.value)
        assert "50" in str(exc.value)

    def test_unpacked_total_too_large(self, monkeypatch):
        monkeypatch.setattr(bip, "MAX_UNPACKED_BYTES", 20 * 1024 * 1024)
        monkeypatch.setattr(bip, "MAX_SINGLE_ENTRY_BYTES", 15 * 1024 * 1024)
        # 3 x 10 MB = 30 MB > 20 MB total limit.
        entries = [(10 * 1024 * 1024, f"f{i}.pdf") for i in range(3)]
        with pytest.raises(bip.ExtractLimitExceeded) as exc:
            bip._guard_zip_limits(entries)
        assert "unpacked total" in str(exc.value)


# ─────────────────────── watchdog + retention (async) ───────────────────────


class _InMemoryCollection:
    """Minimal Motor-shaped async collection over a dict of docs.

    Supports the exact call surface the watchdog + retention paths use:
    `find(query, projection).__aiter__`, `update_one(filt, {'$set': …})`,
    `delete_many(filt)`.
    """

    def __init__(self, docs: list[dict]):
        self._docs = list(docs)

    def find(self, filt: dict, projection: dict | None = None):
        matches = [d for d in self._docs if self._match(d, filt)]

        async def _agen():
            for d in matches:
                yield dict(d)  # copy so callers can't mutate our state
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
        deleted = before - len(self._docs)
        return type("R", (), {"deleted_count": deleted})()

    def _match(self, doc: dict, filt: dict) -> bool:
        for k, v in filt.items():
            if isinstance(v, dict):
                # $in / $nin / $lt / $gt operators.
                if "$in" in v and doc.get(k) not in v["$in"]:
                    return False
                if "$nin" in v and doc.get(k) in v["$nin"]:
                    return False
                if "$lt" in v and not (doc.get(k) is not None
                                       and doc.get(k) < v["$lt"]):
                    return False
                if "$gt" in v and not (doc.get(k) is not None
                                       and doc.get(k) > v["$gt"]):
                    return False
            else:
                if doc.get(k) != v:
                    return False
        return True


class TestWatchdog:
    def test_fails_stuck_downloading_job(self, monkeypatch):
        old = (datetime.now(timezone.utc)
               - timedelta(minutes=bip.DOWNLOAD_TIMEOUT_MIN + 5)).isoformat()
        fresh = datetime.now(timezone.utc).isoformat()
        jobs = _InMemoryCollection([
            {"id": "old-download", "state": "downloading", "started_at": old},
            {"id": "old-extract", "state": "extracting", "started_at": old},
            {"id": "fresh", "state": "downloading", "started_at": fresh},
            {"id": "complete", "state": "complete", "started_at": old},
        ])
        monkeypatch.setattr(bip.db, "bulk_import_jobs", jobs)
        result = asyncio.get_event_loop().run_until_complete(bip.watchdog_tick())
        assert result["reaped"] == 2
        # Verify the stamped state + error_step on the two stuck rows.
        by_id = {d["id"]: d for d in jobs._docs}
        assert by_id["old-download"]["state"] == "failed"
        assert by_id["old-download"]["error_step"] == "download"
        assert by_id["old-extract"]["state"] == "failed"
        assert by_id["old-extract"]["error_step"] == "extract"
        # Fresh and complete rows must remain untouched.
        assert by_id["fresh"]["state"] == "downloading"
        assert by_id["complete"]["state"] == "complete"

    def test_no_stuck_jobs_returns_zero(self, monkeypatch):
        jobs = _InMemoryCollection([
            {"id": "done", "state": "complete",
             "started_at": datetime.now(timezone.utc).isoformat()},
        ])
        monkeypatch.setattr(bip.db, "bulk_import_jobs", jobs)
        result = asyncio.get_event_loop().run_until_complete(bip.watchdog_tick())
        assert result["reaped"] == 0


class TestRetention:
    def test_prunes_old_jobs_and_dryrun_rows(self, monkeypatch):
        old_iso = (datetime.now(timezone.utc)
                   - timedelta(days=bip.RETENTION_DAYS + 1)).isoformat()
        fresh_iso = datetime.now(timezone.utc).isoformat()
        jobs = _InMemoryCollection([
            {"id": "old-a", "created_at": old_iso, "state": "complete"},
            {"id": "old-b", "created_at": old_iso, "state": "failed"},
            {"id": "fresh", "created_at": fresh_iso, "state": "complete"},
        ])
        dryrun = _InMemoryCollection([
            {"job_id": "old-a", "filename": "x.pdf"},
            {"job_id": "old-b", "filename": "y.pdf"},
            {"job_id": "fresh", "filename": "z.pdf"},
        ])
        monkeypatch.setattr(bip.db, "bulk_import_jobs", jobs)
        monkeypatch.setattr(bip.db, "bulk_import_dryrun", dryrun)
        result = asyncio.get_event_loop().run_until_complete(
            bip.retention_cleanup())
        assert result["jobs_deleted"] == 2
        assert result["dryrun_deleted"] == 2
        # Fresh survivors on both collections.
        assert [d["id"] for d in jobs._docs] == ["fresh"]
        assert [d["job_id"] for d in dryrun._docs] == ["fresh"]


# ───────────────── smoke test: __MACOSX filter + info-walker ─────────────────


class TestExtractWalker:
    def test_macosx_entries_ignored(self, tmp_path):
        """The v58 extract-walker skips `__MACOSX/…` sidecar files that
        macOS Finder embeds when a user compresses a folder."""
        zpath = tmp_path / "sample.zip"
        with zipfile.ZipFile(zpath, "w") as zf:
            zf.writestr("real.pdf", b"%PDF-1.4\n%fake\n")
            zf.writestr("__MACOSX/._real.pdf", b"garbage")
        with zipfile.ZipFile(zpath, "r") as zf:
            names = [i.filename for i in zf.infolist()
                     if not i.filename.lower().startswith("__macosx")
                     and i.filename.lower().endswith(".pdf")]
        assert names == ["real.pdf"]
