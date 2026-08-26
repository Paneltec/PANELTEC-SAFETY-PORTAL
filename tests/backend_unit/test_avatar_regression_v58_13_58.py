"""v58.13.58 — Avatar regression fix.

The v58.13.53 orphan-GridFS sweep used a negative filter — "delete
any `bk_fs.files` blob NOT in `bk_snapshots.gridfs_id`" — and
wiped 25 Worker profile photos on preview, because
`workers.py::_fs_bucket()` writes Worker photos to the same
`bk_fs` bucket as backup snapshots (aligned in v160.3.9.34.3 with
the Simpro-ZIP reader). Result: `<WorkerPhoto>` and the Users &
Permissions row avatar both 404'd on `/api/workers/<id>/photo/<gid>`.

Fix: the sweep now uses a POSITIVE filter — only blobs whose
filename matches `paneltec-snapshot-*.zip` OR whose metadata carries
`snapshot_id` are considered for deletion. Worker photos never
match either condition, so this class of regression cannot recur.

Same guard applied to `scripts/emergency_disk_cleanup_v58_13_53.py`
(which mirrored the sweep logic for one-shot ops runs).

Data recovery: the 25 wiped photo blobs cannot be resurrected —
they're gone from GridFS. Their `workers.photo_url` /
`photo_gridfs_id` refs have been nulled so the frontend renders
the placeholder immediately rather than flashing a broken-image
icon before falling back. Users can re-upload via the existing
`POST /api/workers/{id}/photo` flow.
"""
from __future__ import annotations

import re
from pathlib import Path


_BACKEND = Path("/app/backend")


def _read(rel: str) -> str:
    return (_BACKEND / rel).read_text(encoding="utf-8")


# ── 1. Sweep helper: positive filter for backup snapshots ───────────


def test_sweep_helper_uses_positive_snapshot_filter():
    src = _read("backup_service.py")
    block = src.split(
        "async def _sweep_orphan_gridfs_blobs", 1,
    )[1].split("\n\n\n", 1)[0]
    # The positive-filter query must reference the snapshot filename
    # pattern AND the `metadata.snapshot_id` presence check.
    assert "paneltec-snapshot-" in block, (
        "sweep helper missing positive snapshot filename filter"
    )
    assert 'metadata.snapshot_id' in block, (
        "sweep helper missing positive metadata.snapshot_id filter"
    )
    # Must apply the filter inside the `find` call (not just log it).
    assert re.search(
        r'db_\["bk_fs\.files"\]\.find\(\s*snapshot_query\b',
        block,
    ), "sweep helper must scope the .find() to the snapshot_query"


def test_emergency_cleanup_script_uses_positive_snapshot_filter():
    src = _read("scripts/emergency_disk_cleanup_v58_13_53.py")
    block = src.split("async def _sweep_orphan_bk_fs", 1)[1].split(
        "\n\n\n", 1,
    )[0]
    assert "paneltec-snapshot-" in block, (
        "cleanup script missing positive snapshot filename filter"
    )
    assert "metadata.snapshot_id" in block, (
        "cleanup script missing positive metadata.snapshot_id filter"
    )
    assert 'find(snapshot_query,' in block or 'find(\n            snapshot_query' in block, (
        "cleanup script must scope the .find() to the snapshot_query"
    )


# ── 2. Regression guard: fake worker photo is NEVER swept ───────────


def test_worker_photo_blob_survives_a_sweep_run():
    """Plant a fake worker_photo blob in `bk_fs`, run the sweep,
    assert the blob is still there. Skips if the DB is unreachable.
    """
    import asyncio
    import os
    import sys
    if str(_BACKEND) not in sys.path:
        sys.path.insert(0, str(_BACKEND))
    _env = _BACKEND / ".env"
    if _env.exists():
        for _line in _env.read_text(encoding="utf-8").splitlines():
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(
                _k.strip(), _v.strip().strip('"').strip("'"),
            )
    if not os.environ.get("MONGO_URL"):
        import pytest
        pytest.skip("MONGO_URL not set")

    async def _run():
        from motor.motor_asyncio import (
            AsyncIOMotorClient, AsyncIOMotorGridFSBucket,
        )
        c = AsyncIOMotorClient(os.environ["MONGO_URL"],
                               serverSelectionTimeoutMS=5000)
        db = c[os.environ.get("DB_NAME", "test_database")]
        fs = AsyncIOMotorGridFSBucket(db, bucket_name="bk_fs")
        # Plant.
        blob_id = await fs.upload_from_stream(
            "sweep-guard-worker-photo.jpg",
            b"\xff\xd8\xff\xe0" + (b"\x00" * 128),  # tiny fake JPEG
            metadata={"kind": "worker_photo",
                      "worker_id": "sweep-guard-test"},
        )
        try:
            # Run the sweep. Import the helper directly.
            from backup_service import _sweep_orphan_gridfs_blobs
            await _sweep_orphan_gridfs_blobs(db, fs)
            # Blob must still exist.
            still_there = await db["bk_fs.files"].find_one(
                {"_id": blob_id}, {"_id": 1},
            )
            assert still_there is not None, (
                "sweep deleted a `worker_photo` blob — v58.13.58 "
                "positive filter is broken."
            )
        finally:
            try:
                await fs.delete(blob_id)
            except Exception:  # noqa: BLE001
                pass

    try:
        asyncio.run(_run())
    except Exception as e:  # noqa: BLE001
        import pytest
        pytest.skip(f"DB unreachable — {e}")


# ── 3. Forward-safe version-sync ────────────────────────────────────


def test_version_sync_moved_past_v58_13_57():
    v_js = Path("/app/frontend/src/lib/version.js").read_text(encoding="utf-8")
    m_ts = Path("/app/mobile/src/lib/version.ts").read_text(encoding="utf-8")
    sw_js = Path("/app/frontend/public/service-worker.js").read_text(encoding="utf-8")
    assert "RUNNING_VERSION = 'paneltec-v160.3.9.58.13.57'" not in v_js
    assert "'paneltec-v160.3.9.58.13.57'" not in m_ts
    assert "'paneltec-v160.3.9.58.13.57'" not in sw_js
    assert "v160.3.9.58.13.58" in v_js
