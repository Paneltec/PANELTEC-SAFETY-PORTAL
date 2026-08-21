"""v58.13.21 — Simpro ZIP photo-replace zero-orphan invariant.

Handler-level pytests driving `simpro_zip_import._commit_zip(...)`
directly with a fake `db` + fake GridFS bucket. Follows the same
handler-level pattern as v58.13.17/.18 backend_unit tests (target
module imported, `db` attribute monkeypatched). Location under
`/app/tests/backend_unit/` per the v58.13.10 hard rule.

Coverage
  1. Pre-existing `photo_gridfs_id` on the worker → `fs.delete` is
     called EXACTLY ONCE with the old ObjectId → new blob uploaded →
     worker doc updated with new id.
  2. No pre-existing photo → `fs.delete` NOT called → upload +
     doc update still proceed.
  3. `fs.delete` raising an exception (mimics the ObjectNotFound
     race) → the fix must log-and-continue: upload + doc update
     STILL happen.
  4. Two independent `_commit_zip` invocations (proxy for two
     workers in one ZIP run): each replaces its own photo with no
     cross-contamination; A's old blob is not deleted when B is
     processed.

Structural guard
  Even if `_commit_zip`'s signature drifts, a source-level assertion
  proves the fix's key invariants remain in the file (delete before
  upload, log.warning-on-failure).
"""
from __future__ import annotations
import asyncio
import io
import os
import sys
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# /app/backend importable + .env loaded before importing target.
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

import simpro_zip_import  # noqa: E402
from bson import ObjectId  # noqa: E402


# Real 24-hex strings so `ObjectId(old)` in the SUT succeeds.
OLD_GID = "507f1f77bcf86cd799439011"
OLD_GID_B = "507f1f77bcf86cd799439022"
NEW_OID = ObjectId("507f1f77bcf86cd799439033")
NEW_OID_B = ObjectId("507f1f77bcf86cd799439044")


def _make_zip(entries: dict[str, bytes]) -> bytes:
    """Serialise a minimal in-memory ZIP that the SUT can open via
    `zipfile.ZipFile(io.BytesIO(zip_bytes))`."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


class _FakeFsBucket:
    """Minimal AsyncIOMotorGridFSBucket surface used by _commit_zip:
    `delete(oid)` and `upload_from_stream(name, blob, metadata=...)`.
    Records every call so tests can assert ordering + counts."""

    def __init__(self, *, upload_returns=NEW_OID, delete_raises=None):
        self._upload_returns = upload_returns
        self._delete_raises = delete_raises
        self.delete_calls: list[str] = []
        self.upload_calls: list[dict] = []
        self.op_log: list[str] = []  # ordering: "delete:<oid>" / "upload:<name>"

    async def delete(self, oid):
        self.delete_calls.append(str(oid))
        self.op_log.append(f"delete:{oid}")
        if self._delete_raises is not None:
            raise self._delete_raises

    async def upload_from_stream(self, name, blob, metadata=None):
        self.upload_calls.append(
            {"name": name, "blob_len": len(blob), "metadata": metadata or {}}
        )
        self.op_log.append(f"upload:{name}")
        return self._upload_returns


class _EmptyCursor:
    """Async iterator that yields nothing — for db.*.find(...) calls
    inside the pre-snapshot block that iterate over cert / hr rows."""
    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


def _make_fake_db(worker_doc: dict):
    """Build a MagicMock() standing in for `simpro_zip_import.db`.
    Only the surface `_commit_zip` touches for the empty-files +
    photo-only path."""
    db_ = MagicMock()

    async def find_one(filt, _proj=None):
        # `_commit_zip` calls db.workers.find_one({id, org_id}, {...}).
        if filt.get("id") == worker_doc["id"]:
            return worker_doc
        return None

    db_.workers.find_one = AsyncMock(side_effect=find_one)
    db_.workers.update_one = AsyncMock()
    db_.worker_certifications.find = MagicMock(return_value=_EmptyCursor())
    db_.worker_hr_documents.find = MagicMock(return_value=_EmptyCursor())
    db_.worker_certifications.insert_one = AsyncMock()
    db_.worker_certifications.update_one = AsyncMock()
    db_.worker_hr_documents.insert_one = AsyncMock()
    db_.worker_unmatched_documents.insert_one = AsyncMock()
    db_.worker_import_snapshots.insert_one = AsyncMock()
    db_.worker_import_snapshots.update_one = AsyncMock()
    db_.induction_columns.find_one = AsyncMock(return_value=None)
    return db_


def _plan_photo_only() -> dict:
    """A commit plan carrying only a photo — no cert/HR files."""
    return {"files": [], "photo": {"filename": "worker.jpg", "zip_path": "photo/worker.jpg"}}


def _plan_no_photo() -> dict:
    return {"files": [], "photo": None}


def _run(coro):
    """Small runner so tests can be plain functions rather than
    async — keeps this file uniform with the v58.13.17/.18 style."""
    return asyncio.get_event_loop().run_until_complete(coro) \
        if not asyncio.get_event_loop().is_closed() else asyncio.run(coro)


@pytest.mark.asyncio
async def test_replace_deletes_old_blob_before_upload(monkeypatch):
    """Scenario 1 — worker already has a photo_gridfs_id. The fix
    must call fs.delete(OLD) exactly once BEFORE fs.upload_from_stream,
    then update the worker doc with the new id."""
    worker = {
        "id": "w-1", "org_id": "org-1",
        "photo_url": f"/api/workers/w-1/photo/{OLD_GID}",
        "photo_gridfs_id": OLD_GID,
    }
    db_ = _make_fake_db(worker)
    monkeypatch.setattr(simpro_zip_import, "db", db_)
    fs = _FakeFsBucket(upload_returns=NEW_OID)
    zip_bytes = _make_zip({"photo/worker.jpg": b"\xff\xd8\xff\xe0\x00\x10JFIF"})

    result = await simpro_zip_import._commit_zip(
        zip_bytes=zip_bytes, plan=_plan_photo_only(),
        worker_id="w-1", org_id="org-1", user_id="u-1", fs=fs,
    )

    # OLD blob deleted exactly once.
    assert fs.delete_calls == [OLD_GID], f"delete calls: {fs.delete_calls}"
    # Upload happened AFTER delete.
    assert fs.op_log[0].startswith("delete:")
    assert fs.op_log[1].startswith("upload:")
    # Doc update carries the NEW id.
    call = db_.workers.update_one.await_args
    assert call is not None
    filt, update = call.args[0], call.args[1]
    assert filt == {"id": "w-1", "org_id": "org-1"}
    assert update["$set"]["photo_gridfs_id"] == str(NEW_OID)
    assert update["$set"]["photo_url"].endswith(str(NEW_OID))
    # Handler return shape.
    assert result["photo"]["gridfs_id"] == str(NEW_OID)


@pytest.mark.asyncio
async def test_first_upload_does_not_call_delete(monkeypatch):
    """Scenario 2 — no pre-existing photo. fs.delete MUST NOT be
    called; upload + doc update still happen."""
    worker = {"id": "w-2", "org_id": "org-1",
              "photo_url": None, "photo_gridfs_id": None}
    db_ = _make_fake_db(worker)
    monkeypatch.setattr(simpro_zip_import, "db", db_)
    fs = _FakeFsBucket(upload_returns=NEW_OID)
    zip_bytes = _make_zip({"photo/worker.jpg": b"\xff\xd8\xff\xe0\x00\x10JFIF"})

    result = await simpro_zip_import._commit_zip(
        zip_bytes=zip_bytes, plan=_plan_photo_only(),
        worker_id="w-2", org_id="org-1", user_id="u-1", fs=fs,
    )

    assert fs.delete_calls == [], f"unexpected delete: {fs.delete_calls}"
    assert len(fs.upload_calls) == 1
    assert result["photo"]["gridfs_id"] == str(NEW_OID)


@pytest.mark.asyncio
async def test_delete_failure_is_swallowed_and_upload_still_proceeds(monkeypatch):
    """Scenario 3 — fs.delete raises (e.g. blob already gone /
    ObjectNotFound race). The fix must log-and-continue: upload +
    doc update MUST still happen so the worker gets its new photo."""
    worker = {
        "id": "w-3", "org_id": "org-1",
        "photo_url": f"/api/workers/w-3/photo/{OLD_GID}",
        "photo_gridfs_id": OLD_GID,
    }
    db_ = _make_fake_db(worker)
    monkeypatch.setattr(simpro_zip_import, "db", db_)
    fs = _FakeFsBucket(upload_returns=NEW_OID,
                       delete_raises=RuntimeError("mock: blob already gone"))
    zip_bytes = _make_zip({"photo/worker.jpg": b"\xff\xd8\xff\xe0\x00\x10JFIF"})

    result = await simpro_zip_import._commit_zip(
        zip_bytes=zip_bytes, plan=_plan_photo_only(),
        worker_id="w-3", org_id="org-1", user_id="u-1", fs=fs,
    )

    # Delete WAS attempted (log-and-continue means we tried).
    assert fs.delete_calls == [OLD_GID]
    # Upload STILL happened.
    assert len(fs.upload_calls) == 1
    # Doc still updated with new id.
    call = db_.workers.update_one.await_args
    assert call.args[1]["$set"]["photo_gridfs_id"] == str(NEW_OID)
    assert result["photo"]["gridfs_id"] == str(NEW_OID)


@pytest.mark.asyncio
async def test_two_workers_each_replace_their_own_photo(monkeypatch):
    """Scenario 4 — process two workers back-to-back (proxy for two
    workers in one ZIP run). Each must delete its OWN old blob and
    not touch the other's."""
    worker_a = {"id": "wA", "org_id": "org-1",
                "photo_url": f"/api/workers/wA/photo/{OLD_GID}",
                "photo_gridfs_id": OLD_GID}
    worker_b = {"id": "wB", "org_id": "org-1",
                "photo_url": f"/api/workers/wB/photo/{OLD_GID_B}",
                "photo_gridfs_id": OLD_GID_B}

    # First worker.
    db_a = _make_fake_db(worker_a)
    monkeypatch.setattr(simpro_zip_import, "db", db_a)
    fs_a = _FakeFsBucket(upload_returns=NEW_OID)
    zip_bytes_a = _make_zip({"photo/worker.jpg": b"\xff\xd8\xff\xe0\x00\x10JFIF-A"})
    await simpro_zip_import._commit_zip(
        zip_bytes=zip_bytes_a, plan=_plan_photo_only(),
        worker_id="wA", org_id="org-1", user_id="u-1", fs=fs_a,
    )
    assert fs_a.delete_calls == [OLD_GID], (
        f"worker A deleted the wrong blob(s): {fs_a.delete_calls}"
    )

    # Second worker — fresh db + fs (each per-worker `_commit_zip`
    # call in production reads its own `pre_worker`, so there's no
    # shared state to contaminate).
    db_b = _make_fake_db(worker_b)
    monkeypatch.setattr(simpro_zip_import, "db", db_b)
    fs_b = _FakeFsBucket(upload_returns=NEW_OID_B)
    zip_bytes_b = _make_zip({"photo/worker.jpg": b"\xff\xd8\xff\xe0\x00\x10JFIF-B"})
    await simpro_zip_import._commit_zip(
        zip_bytes=zip_bytes_b, plan=_plan_photo_only(),
        worker_id="wB", org_id="org-1", user_id="u-2", fs=fs_b,
    )
    assert fs_b.delete_calls == [OLD_GID_B], (
        f"worker B deleted the wrong blob(s): {fs_b.delete_calls}"
    )

    # Cross-check: neither bucket saw the other worker's OLD id.
    assert OLD_GID_B not in fs_a.delete_calls
    assert OLD_GID not in fs_b.delete_calls


def test_delete_before_upload_invariant_in_source():
    """Belt-and-braces string-level guard: even under aggressive
    refactor, the '# Photo' block in `simpro_zip_import.py` MUST
    keep the delete-before-upload ordering + log-and-continue
    guard. Runs statically — no async, no db, no fs."""
    src = Path("/app/backend/simpro_zip_import.py").read_text(encoding="utf-8")
    idx = src.find("    # Photo\n")
    assert idx >= 0, "'# Photo' marker missing"
    tail = src[idx: idx + 1500]
    assert 'pre_worker.get("photo_gridfs_id")' in tail
    del_idx = tail.find("await fs.delete(")
    up_idx = tail.find("await fs.upload_from_stream(")
    assert 0 <= del_idx < up_idx, (
        f"fs.delete must precede upload (delete@{del_idx}, upload@{up_idx})"
    )
    assert "log.warning" in tail
    assert "except Exception" in tail
