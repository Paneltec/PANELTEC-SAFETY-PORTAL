"""Off-site copy of every backup snapshot → Dropbox.

Why: the LAN agent on the office NAS is the only thing that moved
snapshots off the server. When that container stops (power cut, NAS
update, someone stops it) nothing leaves the server and nobody notices
for days. This module pushes each finished snapshot straight from the
server to the Dropbox account already connected under Settings →
Dropbox — no agent, nothing to keep running in the office.

Where: `/Paneltec Portal Backups/` in the connected account's own
(private) space — NOT the shared team folder, because snapshots hold
staff personal data. Override with BACKUP_DROPBOX_FOLDER.

Keeps the newest BACKUP_DROPBOX_KEEP copies (default 14 ≈ 3½ days at
4 a day); older ones are deleted from Dropbox.

Switch off with BACKUP_OFFSITE_DROPBOX=false.

Every attempt is recorded on the snapshot row (`offsite`) and in
`app_state` (_id="backup_offsite") so the Backup page can show it.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

log = logging.getLogger("backup.offsite")

CHUNK = 8 * 1024 * 1024
STATE_ID = "backup_offsite"


def _folder() -> str:
    f = os.environ.get("BACKUP_DROPBOX_FOLDER", "/Paneltec Portal Backups").strip() or "/Paneltec Portal Backups"
    return "/" + f.strip("/")


def _keep() -> int:
    try:
        return max(2, int(os.environ.get("BACKUP_DROPBOX_KEEP", "14")))
    except ValueError:
        return 14


def offsite_enabled() -> bool:
    if os.environ.get("BACKUP_OFFSITE_DROPBOX", "true").strip().lower() in ("0", "false", "no", "off"):
        return False
    return bool(os.environ.get("DROPBOX_REFRESH_TOKEN", "").strip()
                or os.environ.get("DROPBOX_ACCESS_TOKEN", "").strip())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _upload_sync(filepath: str, dest_path: str) -> int:
    """Chunked upload (works for multi-GB files). Returns bytes sent."""
    import dropbox
    from dropbox.files import CommitInfo, UploadSessionCursor, WriteMode
    from integrations_dropbox import _get_dbx_client

    dbx = _get_dbx_client()
    size = os.path.getsize(filepath)
    with open(filepath, "rb") as fh:
        if size <= CHUNK:
            dbx.files_upload(fh.read(), dest_path, mode=WriteMode.overwrite, mute=True)
            return size
        start = dbx.files_upload_session_start(fh.read(CHUNK))
        cursor = UploadSessionCursor(session_id=start.session_id, offset=fh.tell())
        commit = CommitInfo(path=dest_path, mode=WriteMode.overwrite, mute=True)
        while True:
            remaining = size - fh.tell()
            if remaining <= CHUNK:
                dbx.files_upload_session_finish(fh.read(CHUNK), cursor, commit)
                break
            dbx.files_upload_session_append_v2(fh.read(CHUNK), cursor)
            cursor.offset = fh.tell()
    _ = dropbox  # keep import (raises early if the SDK is missing)
    return size


def _prune_sync(folder: str, keep: int) -> int:
    from dropbox.files import FileMetadata
    from integrations_dropbox import _get_dbx_client

    dbx = _get_dbx_client()
    res = dbx.files_list_folder(folder)
    entries = list(res.entries)
    while res.has_more:
        res = dbx.files_list_folder_continue(res.cursor)
        entries.extend(res.entries)
    zips = sorted(
        (e for e in entries if isinstance(e, FileMetadata) and e.name.endswith(".zip")),
        key=lambda e: e.server_modified, reverse=True,
    )
    removed = 0
    for e in zips[keep:]:
        try:
            dbx.files_delete_v2(e.path_lower)
            removed += 1
        except Exception as ex:  # noqa: BLE001
            log.warning("offsite prune: could not delete %s: %s", e.name, ex)
    return removed


async def push_snapshot(db, snap_id: str, filepath: str, created_at: Optional[str] = None) -> Dict[str, Any]:
    """Upload one snapshot file. Never raises — the result is recorded."""
    if not offsite_enabled():
        return {"ok": False, "skipped": True, "reason": "dropbox_not_connected"}
    if not filepath or not os.path.exists(filepath):
        return {"ok": False, "skipped": True, "reason": "file_missing"}
    stamp = (created_at or _now())[:16].replace(":", "").replace("T", "_")
    dest = f"{_folder()}/paneltec-backup-{stamp}-{snap_id[:8]}.zip"
    started = _now()
    await db.bk_snapshots.update_one({"id": snap_id}, {"$set": {"offsite": {
        "status": "uploading", "provider": "dropbox", "path": dest, "started_at": started}}})
    try:
        size = await asyncio.to_thread(_upload_sync, filepath, dest)
        removed = 0
        try:
            removed = await asyncio.to_thread(_prune_sync, _folder(), _keep())
        except Exception as e:  # noqa: BLE001
            log.warning("offsite prune failed: %s", e)
        done = _now()
        await db.bk_snapshots.update_one({"id": snap_id}, {"$set": {"offsite": {
            "status": "ok", "provider": "dropbox", "path": dest, "bytes": size,
            "started_at": started, "at": done}}})
        await db.app_state.update_one({"_id": STATE_ID}, {"$set": {
            "last_ok_at": done, "last_ok_snapshot_id": snap_id, "last_ok_path": dest,
            "last_ok_bytes": size, "last_error": None, "last_error_at": None,
            "pruned_last_run": removed}}, upsert=True)
        log.info("offsite: snapshot %s → Dropbox %s (%d bytes, pruned %d)", snap_id, dest, size, removed)
        return {"ok": True, "path": dest, "bytes": size}
    except Exception as e:  # noqa: BLE001
        msg = f"{type(e).__name__}: {str(e)[:300]}"
        log.warning("offsite: upload of %s failed: %s", snap_id, msg)
        now = _now()
        await db.bk_snapshots.update_one({"id": snap_id}, {"$set": {"offsite": {
            "status": "failed", "provider": "dropbox", "path": dest, "error": msg,
            "started_at": started, "at": now}}})
        await db.app_state.update_one({"_id": STATE_ID}, {"$set": {
            "last_error": msg, "last_error_at": now}}, upsert=True)
        return {"ok": False, "error": msg}


async def push_latest_pending(db) -> Dict[str, Any]:
    """Retry: upload the newest snapshot that is still on disk and has
    no successful off-site copy. Used hourly and by the Retry button."""
    row = await db.bk_snapshots.find_one(
        {"status": "ready", "filepath": {"$ne": None}, "offsite.status": {"$ne": "ok"}},
        {"_id": 0, "id": 1, "filepath": 1, "created_at": 1},
        sort=[("created_at", -1)],
    )
    if not row:
        return {"ok": True, "nothing_to_do": True}
    full = await db.bk_snapshots.find_one({"id": row["id"]}, {"_id": 0, "offsite": 1}) or {}
    off = full.get("offsite") or {}
    if off.get("status") == "uploading":
        try:
            began = datetime.fromisoformat(str(off.get("started_at")).replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - began).total_seconds() < 3 * 3600:
                return {"ok": True, "in_progress": True}
        except Exception:  # noqa: BLE001
            pass
    if not os.path.exists(row.get("filepath") or ""):
        return {"ok": False, "skipped": True, "reason": "file_missing"}
    return await push_snapshot(db, row["id"], row["filepath"], row.get("created_at"))


async def status(db) -> Dict[str, Any]:
    st = await db.app_state.find_one({"_id": STATE_ID}, {"_id": 0}) or {}
    return {
        "enabled": offsite_enabled(),
        "provider": "dropbox",
        "folder": _folder(),
        "keep": _keep(),
        "last_ok_at": st.get("last_ok_at"),
        "last_ok_path": st.get("last_ok_path"),
        "last_ok_bytes": st.get("last_ok_bytes"),
        "last_error": st.get("last_error"),
        "last_error_at": st.get("last_error_at"),
    }
