"""v58.13.132gf — Shared GridFS-backed upload storage.

Wraps `AsyncIOMotorGridFSBucket` so every module that previously wrote
to `/app/backend/uploads/<subdir>/…` can migrate with a single line
change. Stores bytes in the `upload_storage.files` / `upload_storage.chunks`
bucket and tags each blob with `{module, subdir, name, org_id}` metadata
so lookups + audits are cheap.

Migration strategy is INCREMENTAL:
  · New writes go to GridFS via `save_upload()`.
  · Reads try GridFS first via `open_upload_stream()`; if the blob
    doesn't exist yet (legacy path), the caller falls back to
    `_serve()`'s pre-.132gf local-disk lookup so files already on
    disk keep serving until `scripts/migrate_ephemeral_to_gridfs.py`
    sweeps them into the bucket.
"""
from __future__ import annotations

import mimetypes
from typing import Iterable, Optional, Tuple

from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from db import db

BUCKET_NAME = "upload_storage"


def _bucket() -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db, bucket_name=BUCKET_NAME)


def _key(subdir: str, parts: Iterable[str]) -> str:
    """The lookup key stored in `metadata.key`. Full posix-style
    path relative to the pre-`.132gf` `uploads/` root — makes drift
    audits easy (`db.upload_storage.files.metadata.key == subdir/name`)."""
    return "/".join([subdir, *parts])


async def save_upload(
    subdir: str,
    parts: Iterable[str],
    data: bytes,
    *,
    module: str,
    org_id: Optional[str] = None,
    mime: Optional[str] = None,
    orig_filename: Optional[str] = None,
) -> str:
    """Write `data` to GridFS under `{subdir}/{parts...}`. Returns the
    filename portion (last element of `parts`) so callers can persist
    the same `file_url` shape they used pre-.132gf."""
    fs = _bucket()
    parts = list(parts)
    key = _key(subdir, parts)
    guessed_mime, _ = mimetypes.guess_type(key)
    md = {
        "module": module,
        "subdir": subdir,
        "parts": parts,
        "key": key,
        "org_id": org_id,
        "mime": mime or guessed_mime or "application/octet-stream",
        "orig_filename": orig_filename or (parts[-1] if parts else key),
    }
    await fs.upload_from_stream(parts[-1] if parts else subdir, data,
                                  metadata=md)
    return parts[-1] if parts else subdir


async def read_upload(
    subdir: str, parts: Iterable[str],
) -> Optional[Tuple[bytes, str]]:
    """Return `(bytes, mime)` for the newest matching GridFS blob, or
    None if not found. Callers that still have a local-disk copy
    should fall back to their pre-`.132gf` path on `None`."""
    fs = _bucket()
    key = _key(subdir, parts)
    doc = await db.upload_storage.files.find_one(
        {"metadata.key": key}, sort=[("uploadDate", -1)],
    )
    if not doc:
        return None
    stream = await fs.open_download_stream(doc["_id"])
    data = await stream.read()
    mime = (doc.get("metadata") or {}).get("mime") or "application/octet-stream"
    return data, mime


async def has_upload(subdir: str, parts: Iterable[str]) -> bool:
    key = _key(subdir, parts)
    return bool(await db.upload_storage.files.find_one(
        {"metadata.key": key}, {"_id": 1}))
