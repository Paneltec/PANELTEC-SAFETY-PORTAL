"""v58.13.132lj — Dropbox → NAS file enumeration engine (Phase 2b/1).

Read-only. Does NOT copy bytes. Purpose:

  1. Walk the full Dropbox tree that Phase 1 (.132le) already
     mirrored into `doc_folders`, but this time enumerate FILES
     (list_folder recursive=True).
  2. Persist every file's metadata to `dropbox_files_enum` —
     `{dropbox_id, dropbox_path, dropbox_rev, size, content_hash,
       client_modified, mime, excluded, excluded_reason, ...}`.
  3. Apply the confirmed exclusion list (Bevs PC Backup) and
     compute two totals side-by-side: `raw` (everything) and
     `post_exclusion` (what Phase 2b would actually copy).
  4. Report unresolved wildcard candidates for Jago Crt / Taswater
     CCTV Investigation so the operator can confirm before Ship 2
     treats them as excluded.
  5. Once we detect at least one file > 100 MB, fire a single
     streaming-transport probe via `nas_client.fetch_and_put`
     (synthetic 128 MB blob served from the pod) to prove the
     new transport handles large files before Ship 2 relies on it.

Progress is persisted to `dropbox_migration_status` (single row
keyed on `job_id`) so `GET /api/dropbox/enum/status` is stateless.

Never writes bytes to the NAS. Never mutates `doc_files`. The only
NAS-side write is the ephemeral probe file which is deleted at
end of probe.
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db

log = logging.getLogger("paneltec.dropbox.enum")


# ── Exclusion patterns (confirmed by Stephen 2026-09-23) ──────
# Each entry: (kind, pattern, reason).
#   kind="prefix" → dropbox_path startswith pattern
#   kind="regex_report_only" → surfaces candidate folders in
#     `unresolved_wildcards`; does NOT auto-exclude files.
EXCLUSIONS: List[Dict[str, str]] = [
    {
        "kind": "prefix",
        "pattern": (
            "/Paneltec-General Administration/General Administration/"
            "Viatec Traffic Solutions/Bevs PC Backup June 2020"
        ),
        "reason": "Bevs PC Backup — Windows filesystem dump (Stephen exclude)",
    },
    {
        "kind": "regex_report_only",
        "pattern": r"/CCTV/Jago[^/]*Crt",
        "reason": "Jago Crt CCTV recording dumps — pending Stephen confirm",
    },
    {
        "kind": "regex_report_only",
        "pattern": r"Taswater.*CCTV.*(Investigation|Cutten|Frankland|Queenstown)",
        "reason": "Taswater CCTV investigation dumps — pending Stephen confirm",
    },
]

_PROBE_LARGE_THRESHOLD_BYTES = 100 * 1024 * 1024   # 100 MB
_PROBE_SYNTH_BYTES = 128 * 1024 * 1024             # 128 MB synthetic blob
_STATUS_COLL = "dropbox_migration_status"
_FILES_COLL = "dropbox_files_enum"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Exclusion matcher ─────────────────────────────────────────
def _classify(path: str) -> Dict[str, Any]:
    """Return `{excluded: bool, excluded_reason: str|None,
    unresolved_wildcard: str|None}`. Prefix matches auto-exclude;
    regex_report_only matches are surfaced separately but NOT
    auto-excluded — Stephen decides in Ship 2."""
    import re
    for e in EXCLUSIONS:
        if e["kind"] == "prefix":
            if path.startswith(e["pattern"] + "/") or path == e["pattern"]:
                return {"excluded": True, "excluded_reason": e["reason"],
                        "unresolved_wildcard": None}
        elif e["kind"] == "regex_report_only":
            if re.search(e["pattern"], path, flags=re.IGNORECASE):
                return {"excluded": False, "excluded_reason": None,
                        "unresolved_wildcard": e["pattern"]}
    return {"excluded": False, "excluded_reason": None,
            "unresolved_wildcard": None}


# ── Status helpers ────────────────────────────────────────────
async def _status_upsert(job_id: str, patch: Dict[str, Any]) -> None:
    patch["updated_at"] = _now_iso()
    await db[_STATUS_COLL].update_one(
        {"job_id": job_id},
        {"$set": patch},
        upsert=True,
    )


async def _status_get(job_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Latest status by job_id, or globally latest if job_id omitted."""
    if job_id:
        return await db[_STATUS_COLL].find_one({"job_id": job_id}, {"_id": 0})
    return await db[_STATUS_COLL].find_one(
        {}, {"_id": 0}, sort=[("started_at", -1)],
    )


# ── Main enum walk ────────────────────────────────────────────
async def _walk_and_persist(job_id: str) -> Dict[str, Any]:
    """Full recursive walk of `/Paneltec-General Administration`
    via one cursor-paginated `files_list_folder(recursive=True)`
    call. For each file entry: classify, upsert into
    `dropbox_files_enum`, update per-batch progress counters."""
    from dropbox_folder_mirror import _get_dbx_root_client  # namespace-scoped
    import dropbox as _dbx

    client = _get_dbx_root_client()
    if not client:
        raise RuntimeError("Dropbox not connected — /oauth/start first")

    root_path = "/Paneltec-General Administration"

    raw_files = 0
    raw_bytes = 0
    post_files = 0
    post_bytes = 0
    excluded_files = 0
    excluded_bytes = 0
    unresolved: Dict[str, List[str]] = {}     # pattern → sample paths
    errors: List[Dict[str, Any]] = []
    max_size = 0
    max_size_path = ""

    # Clear prior enum rows for this job start — full re-enum every
    # run (idempotent by design, small enough to rewrite).
    await db[_FILES_COLL].delete_many({})

    result = client.files_list_folder(
        root_path, recursive=True, include_deleted=False,
        include_mounted_folders=True,
    )
    last_flush = time.time()

    while True:
        batch_rows: List[Dict[str, Any]] = []
        for entry in result.entries:
            if not isinstance(entry, _dbx.files.FileMetadata):
                continue  # skip folder + deleted entries
            path = entry.path_display or entry.path_lower
            size = int(entry.size or 0)
            cls = _classify(path)

            raw_files += 1
            raw_bytes += size
            if cls["excluded"]:
                excluded_files += 1
                excluded_bytes += size
            else:
                post_files += 1
                post_bytes += size

            if cls["unresolved_wildcard"]:
                bucket = unresolved.setdefault(cls["unresolved_wildcard"], [])
                if len(bucket) < 20:
                    bucket.append(path)

            if size > max_size:
                max_size = size
                max_size_path = path

            batch_rows.append({
                "id": entry.id,
                "dropbox_id": entry.id,
                "dropbox_path": path,
                "dropbox_path_lower": entry.path_lower,
                "dropbox_rev": entry.rev,
                "size": size,
                "content_hash": entry.content_hash,
                "client_modified": (
                    entry.client_modified.isoformat()
                    if entry.client_modified else None
                ),
                "server_modified": (
                    entry.server_modified.isoformat()
                    if entry.server_modified else None
                ),
                "excluded": cls["excluded"],
                "excluded_reason": cls["excluded_reason"],
                "unresolved_wildcard": cls["unresolved_wildcard"],
                "enumerated_at": _now_iso(),
            })

        if batch_rows:
            try:
                await db[_FILES_COLL].insert_many(batch_rows, ordered=False)
            except Exception as e:   # noqa: BLE001 — never crash the walk
                errors.append({"phase": "insert", "error": str(e)[:200]})

        # Persist progress every ~2 s so the status endpoint is live.
        if time.time() - last_flush > 2.0:
            await _status_upsert(job_id, {
                "state": "running",
                "files_enumerated": raw_files,
                "bytes_total": raw_bytes,
                "raw": {"files": raw_files, "bytes": raw_bytes},
                "post_exclusion": {"files": post_files, "bytes": post_bytes},
                "excluded_running": {"files": excluded_files, "bytes": excluded_bytes},
                "max_size_seen": max_size,
                "max_size_path": max_size_path,
                "errors": errors[-50:],
                "cursor_has_more": True,
            })
            last_flush = time.time()

        if not result.has_more:
            break
        result = client.files_list_folder_continue(result.cursor)

    return {
        "raw_files": raw_files,
        "raw_bytes": raw_bytes,
        "post_files": post_files,
        "post_bytes": post_bytes,
        "excluded_files": excluded_files,
        "excluded_bytes": excluded_bytes,
        "unresolved": unresolved,
        "errors": errors,
        "max_size": max_size,
        "max_size_path": max_size_path,
    }


# ── Large-file probe (synthetic, no Dropbox involvement) ──────
async def _run_streaming_probe(job_id: str, agent_id: str) -> Dict[str, Any]:
    """Prove the new `fetch_and_put` transport handles > 100 MB
    without OOMing the pod. Registers a signed probe blob with
    `backup_service.register_probe_blob(size)`, enqueues one
    `fetch_and_put` op targeting `.probe/streaming-<jobid>.bin`
    under `<NAS_ROOT>/paneltec-files/`, waits for result, then
    fires a `delete_file` op to sweep the file."""
    import nas_client
    from backup_service import register_probe_blob, PUBLIC_HUB_URL_FOR_AGENTS

    size = _PROBE_SYNTH_BYTES
    blob = register_probe_blob(size)
    source_url = (
        f"{PUBLIC_HUB_URL_FOR_AGENTS}/api/backup/agent/probe-blob/"
        f"{blob['id']}?sig={blob['sig']}"
    )

    rel_path = f".probe/streaming-{job_id}.bin"
    t0 = time.time()
    try:
        wr = await nas_client.fetch_and_put(
            path=rel_path,
            source_url=source_url,
            expected_sha256=blob["sha256"],
            expected_size=size,
            meta={"probe": True, "job_id": job_id},
        )
        dur_ms = int((time.time() - t0) * 1000)
        try:
            await nas_client.delete_file(rel_path)
        except Exception:
            pass  # sweep is best-effort
        return {
            "status": "ok",
            "bytes": size,
            "sha256": blob["sha256"],
            "duration_ms": dur_ms,
            "written_size": wr.get("size"),
        }
    except Exception as e:   # noqa: BLE001
        return {
            "status": "failed",
            "bytes": size,
            "duration_ms": int((time.time() - t0) * 1000),
            "error": str(e)[:400],
        }


# ── Public entrypoint ─────────────────────────────────────────
async def run_enum_job(job_id: str, agent_id: Optional[str] = None) -> None:
    """Background task. Never raises — all errors captured in the
    status doc. Steps: walk → summarise → probe (if large files
    seen) → mark complete."""
    await _status_upsert(job_id, {
        "job_id": job_id,
        "state": "running",
        "started_at": _now_iso(),
        "updated_at": _now_iso(),
        "completed_at": None,
        "files_enumerated": 0,
        "bytes_total": 0,
        "raw": {"files": 0, "bytes": 0},
        "post_exclusion": {"files": 0, "bytes": 0},
        "excluded_subtrees": [],
        "unresolved_wildcards": [],
        "large_file_probe": {"status": "not-run"},
        "errors": [],
    })

    try:
        summary = await _walk_and_persist(job_id)
    except Exception as e:   # noqa: BLE001
        log.exception("enum walk crashed")
        await _status_upsert(job_id, {
            "state": "failed",
            "completed_at": _now_iso(),
            "errors": [{"phase": "walk", "error": str(e)[:400]}],
        })
        return

    # Build the final excluded_subtrees breakdown from persisted rows.
    excluded_subtrees: List[Dict[str, Any]] = []
    for e in EXCLUSIONS:
        if e["kind"] != "prefix":
            continue
        match = await db[_FILES_COLL].aggregate([
            {"$match": {"excluded": True, "excluded_reason": e["reason"]}},
            {"$group": {"_id": None,
                        "files": {"$sum": 1},
                        "bytes": {"$sum": "$size"}}},
        ]).to_list(1)
        row = match[0] if match else {"files": 0, "bytes": 0}
        excluded_subtrees.append({
            "pattern": e["pattern"],
            "reason": e["reason"],
            "matched_files": row["files"],
            "matched_bytes": row["bytes"],
        })

    unresolved_out = [
        {"pattern": pat, "candidates": paths,
         "candidate_count": len(paths)}
        for pat, paths in summary["unresolved"].items()
    ]

    await _status_upsert(job_id, {
        "state": "walk-complete",
        "files_enumerated": summary["raw_files"],
        "bytes_total": summary["raw_bytes"],
        "raw": {"files": summary["raw_files"], "bytes": summary["raw_bytes"]},
        "post_exclusion": {"files": summary["post_files"],
                             "bytes": summary["post_bytes"]},
        "excluded_subtrees": excluded_subtrees,
        "unresolved_wildcards": unresolved_out,
        "max_size_seen": summary["max_size"],
        "max_size_path": summary["max_size_path"],
    })

    # Large-file probe — only if we saw at least one file worth probing.
    if summary["max_size"] >= _PROBE_LARGE_THRESHOLD_BYTES and agent_id:
        probe = await _run_streaming_probe(job_id, agent_id)
        await _status_upsert(job_id, {"large_file_probe": probe})
    else:
        await _status_upsert(job_id, {"large_file_probe": {
            "status": "skipped",
            "reason": (
                f"no file >= {_PROBE_LARGE_THRESHOLD_BYTES / (1024**2):.0f} MB "
                f"seen (max={summary['max_size']} bytes)"
                if summary["max_size"] < _PROBE_LARGE_THRESHOLD_BYTES
                else "no agent_id passed"
            ),
        }})

    await _status_upsert(job_id, {
        "state": "complete",
        "completed_at": _now_iso(),
    })


async def latest_status() -> Optional[Dict[str, Any]]:
    return await _status_get(None)
