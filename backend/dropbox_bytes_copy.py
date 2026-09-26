"""v58.13.132lm — Dropbox → NAS bytes-copy engine (Phase 2b Ship 2).

Reads the `dropbox_files_enum` collection populated by Ship 1
(`.132lj`), applies Stephen's confirmed exclusion list, calls
`dbx.files.get_temporary_link(path)` per file to get a
direct-download URL, and enqueues a `fetch_and_put` op targeting
`paneltec-files/<dropbox_path>` on the NAS. HMAC-signed via
`nas_client.fetch_and_put`. Idempotent: files whose target
already exists on the NAS with a matching sha256 are skipped.

Progress persisted to `dropbox_migration_run` (one doc per run)
every ~2 s + on every state transition. `GET /api/dropbox/
migration/status` reads the latest doc.

Locked-in decisions (Stephen 2026-09-23):
    · Auto-exclude subtrees:
        - Bevs PC Backup June 2020
        - Jago Crt CCTV (all Line Viewer dumps)
        - Scoyttsdale CCTV Investigation10022025 folder (exact 2 files)
    · KEEP the 5 Pitt & Sherry / Arthurs Lake SWMS PDFs
    · KEEP the Taswater Line Viewer dumps (Cutten St / Frankland St)
    · No depth cap.
    · Migrate the 13.7 GB Callibration Certificates.zip through the
      agent (resumable transport can handle it now).
    · `next_ops_for_agent(limit=32)` — 4× the .132lk throughput.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db import db

log = logging.getLogger("paneltec.dropbox.copy")

# ── v58.13.132n8 — Hard NAS-write lockdown ────────────────────
# Belt-and-braces on top of `.132n0`:
#   · `.132n0` cancelled all running migration_run docs,
#     flipped `migration_watchdog_settings.enabled=False`, and
#     removed the APScheduler watchdog job.
#   · `.132n8` (this) makes the CODE refuse to write even if
#     someone flips the DB flag back to True via Mongo directly,
#     or hits `POST /api/dropbox/migration/{start,resume,watchdog/resume}`
#     with a valid admin token.
#
# To re-enable Dropbox → NAS writes an ops engineer must:
#   1. Set this constant to `False`
#   2. Delete this guard
#   3. Redeploy
#   4. Flip `migration_watchdog_settings.enabled=True` via
#      `POST /api/dropbox/migration/watchdog/resume` (which is
#      ALSO 503-guarded below in integrations_dropbox.py).
# All three steps are intentional friction — the user explicitly
# asked for NO more writes to the UGREEN NAS.
MIGRATION_DISABLED: bool = True


# ── Exclusion prefixes (ALL confirmed by Stephen) ─────────────
# Every entry is an EXACT prefix match against `dropbox_path`
# (case-sensitive, since Dropbox paths from `path_display` are
# case-preserving). Directory-boundary safe: pattern must be
# followed by `/` or end-of-path.
EXCLUSION_PREFIXES: List[Dict[str, str]] = [
    {
        "reason": "Bevs PC Backup — Windows filesystem dump",
        "prefix": (
            "/Paneltec-General Administration/General Administration/"
            "Viatec Traffic Solutions/Bevs PC Backup June 2020"
        ),
    },
    {
        "reason": "Jago Crt CCTV — Line Viewer raw dumps",
        "prefix": "/Paneltec-General Administration/CCTV/Jago Crt",
    },
    {
        "reason": "Scoyttsdale CCTV Investigation — 2-file folder",
        "prefix": (
            "/Paneltec-General Administration/Customers/TasWater CDO/"
            "Scoyttsdale CCTV Investigation10022025"
        ),
    },
]

_STATUS_COLL = "dropbox_migration_run"
_ENUM_COLL = "dropbox_files_enum"

# NAS destination root — files land at
# `<NAS_ROOT>/paneltec-files/<dropbox_path>` (agent side maps this
# under its `paneltec-files/` bind). The leading slash from the
# Dropbox path is preserved so the NAS layout mirrors Dropbox 1:1
# (no dropbox namespace prefix stripping).
_NAS_REL_PREFIX = "dropbox"   # → paneltec-files/dropbox/<dropbox_path>


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_excluded(path: str) -> Optional[str]:
    """Return the excluded reason if `path` falls under any
    confirmed exclusion prefix, else None. Directory-boundary
    safe: `/foo/bar` doesn't get excluded by prefix `/foo/ba`."""
    for e in EXCLUSION_PREFIXES:
        p = e["prefix"]
        if path == p or path.startswith(p + "/"):
            return e["reason"]
    return None


def _nas_rel_path(dropbox_path: str) -> str:
    """Map a Dropbox path to the NAS-side path handed to
    `fetch_and_put` (relative to `paneltec-files/`).
    `/Paneltec-General Administration/foo/bar.pdf`
    → `dropbox/Paneltec-General Administration/foo/bar.pdf`."""
    dp = dropbox_path.lstrip("/")
    return f"{_NAS_REL_PREFIX}/{dp}"


# ── Status helpers ────────────────────────────────────────────
async def _status_upsert(run_id: str, patch: Dict[str, Any]) -> None:
    patch["updated_at"] = _now_iso()
    await db[_STATUS_COLL].update_one(
        {"run_id": run_id},
        {"$set": patch},
        upsert=True,
    )


async def latest_status() -> Optional[Dict[str, Any]]:
    return await db[_STATUS_COLL].find_one(
        {}, {"_id": 0}, sort=[("started_at", -1)],
    )


async def get_run(run_id: str) -> Optional[Dict[str, Any]]:
    """v58.13.132mg — Look up a specific migration run doc by
    id. Used by the resume endpoint to fetch the agent_id + state
    of an interrupted run before firing a fresh task."""
    return await db[_STATUS_COLL].find_one(
        {"run_id": run_id}, {"_id": 0},
    )


# ── Idempotency: check the NAS-side sidecar for existing file ─
async def _agent_has_file(agent_id: str, nas_path: str,
                             expected_size: int,
                             expected_sha256: str) -> bool:
    """Cheap `stat` check via the queue. Returns True if the
    file already exists at the target path with matching size +
    sha. Uses the existing `stat` op type (from .132lf) — no new
    op needed. Costs ~one poll cycle per checked file, so callers
    should batch."""
    import nas_client
    try:
        info = await nas_client.stat(nas_path)
    except Exception:   # noqa: BLE001 — treat any error as "unknown"
        return False
    if not info or not info.get("exists"):
        return False
    if int(info.get("size") or -1) != expected_size:
        return False
    if info.get("sha256") and expected_sha256:
        return info["sha256"] == expected_sha256
    # If the sidecar didn't record a sha but the size matches,
    # trust it — the .part-then-atomic-rename pattern means a
    # correctly-sized file on disk came from a successful write.
    return True


# ── Dry-run walker ────────────────────────────────────────────
async def _run_dry(run_id: str) -> Dict[str, Any]:
    """Walk `dropbox_files_enum` and count what WOULD be copied.
    Never touches the NAS or Dropbox APIs."""
    await _status_upsert(run_id, {
        "run_id": run_id,
        "state": "dry-run-running",
        "started_at": _now_iso(),
        "dry_run": True,
    })

    counts = {
        "raw_files": 0, "raw_bytes": 0,
        "would_copy_files": 0, "would_copy_bytes": 0,
        "excluded_by_reason": {},   # reason → {files, bytes}
    }
    # Sanity-check tickets for Stephen's must-KEEP + must-COPY.
    keep_probes = {
        "swms_pitt_sherry_geotech": (
            "/Paneltec-General Administration/Customers/"
            "Pitt & Sherry/Geotechnical Investigation - "
            "TasWater CDO - 11 06 2021/SWMS/CCTV Survey - "
            "Safe Operation - Geotechnical Investigations - "
            "TERHAP - TWCDO - 30 06 2021.pdf"
        ),
        "arthurs_lake_swms_pdf": (
            "/Paneltec-General Administration/Customers/"
            "TasWater/Projects - Taswater/2023/"
            "Arthurs Lake - CCTV & Drain Cleaning - "
            "Intrusion Investigation/"
            "Safe Work Method Statement - Combination Vacuum "
            "Truck - CCTV Inspection -Flintstone Drive Arthurs "
            "Lake - 20 12 2022.pdf"
        ),
    }
    keep_hits: Dict[str, bool] = {k: False for k in keep_probes}
    line_viewer_taswater_hits = 0
    calibration_zip_found: Optional[int] = None

    async for row in db[_ENUM_COLL].find({}, {
        "_id": 0, "dropbox_path": 1, "size": 1, "content_hash": 1,
    }):
        path = row["dropbox_path"]
        size = int(row.get("size") or 0)
        counts["raw_files"] += 1
        counts["raw_bytes"] += size

        reason = _is_excluded(path)
        if reason:
            b = counts["excluded_by_reason"].setdefault(
                reason, {"files": 0, "bytes": 0},
            )
            b["files"] += 1
            b["bytes"] += size
            continue

        counts["would_copy_files"] += 1
        counts["would_copy_bytes"] += size

        # Probes
        for k, p in keep_probes.items():
            if path == p:
                keep_hits[k] = True
        if (
            path.startswith("/Paneltec-General Administration/CCTV/"
                              "Taswater ")
            and "/DISK1/" in path
        ):
            line_viewer_taswater_hits += 1
        if path.endswith("/Callibration Certificates.zip"):
            calibration_zip_found = size

    # 5-PDF verification: enumerate all files matching the
    # regex from .132lj so we can definitively report count.
    swms_kept: List[Dict[str, Any]] = []
    async for row in db[_ENUM_COLL].find(
        {"unresolved_wildcard": {"$ne": None}, "excluded": False},
        {"_id": 0, "dropbox_path": 1, "size": 1, "unresolved_wildcard": 1},
    ):
        p = row["dropbox_path"]
        if _is_excluded(p):
            continue
        if p.startswith(
            "/Paneltec-General Administration/Customers/"
            "Pitt & Sherry/"
        ) or (
            p.startswith(
                "/Paneltec-General Administration/Customers/"
                "TasWater/Projects - Taswater/2023/"
                "Arthurs Lake - CCTV & Drain Cleaning - "
                "Intrusion Investigation/"
            )
        ):
            swms_kept.append({
                "path": p, "size": row.get("size"),
            })

    result = {
        "run_id": run_id,
        "state": "dry-run-complete",
        "dry_run": True,
        "completed_at": _now_iso(),
        "counts": counts,
        "sanity_probes": {
            "kept_pitt_sherry_swms_seen": keep_hits[
                "swms_pitt_sherry_geotech"
            ],
            "kept_arthurs_lake_swms_seen": keep_hits[
                "arthurs_lake_swms_pdf"
            ],
            "swms_kept_count": len(swms_kept),
            "swms_kept_paths": [s["path"] for s in swms_kept],
            "taswater_line_viewer_files_kept": line_viewer_taswater_hits,
            "callibration_certificates_zip_bytes": calibration_zip_found,
            "callibration_certificates_zip_migrated": (
                calibration_zip_found is not None
            ),
        },
    }
    await _status_upsert(run_id, result)
    return result


# ── Real copy walker ──────────────────────────────────────────
async def _run_copy(run_id: str, agent_id: str) -> None:
    """Real bytes-copy. Never crashes the run on a per-file error
    — collect + continue. Status updated every batch."""
    # v58.13.132md — Use the TEAM-NAMESPACE-scoped Dropbox client
    # (via `dropbox_folder_mirror._get_dbx_root_client`, which applies
    # `with_path_root(namespace_id=$DROPBOX_ROOT_NAMESPACE_ID)`). The
    # `dropbox_files_enum` collection was populated by `.132lj` using
    # this same team-namespace client, so every stored path is a
    # team-space path. The default `integrations_dropbox._get_dbx_client`
    # resolves paths through the *personal* namespace instead — which
    # is why 40/40 sampled enum paths returned `not_found` during the
    # first real run (.132lm/.132mb attempt). Personal namespace shows
    # a synthetic `/Paneltec-General Administration (Team folder
    # conflict)` folder that doesn't contain the same subtree; team
    # namespace shows the real `/Paneltec-General Administration`
    # tree that the enum captured.
    from dropbox_folder_mirror import _get_dbx_root_client
    import nas_client
    client = _get_dbx_root_client()
    if not client:
        await _status_upsert(run_id, {
            "state": "failed",
            "completed_at": _now_iso(),
            "errors": [{"phase": "init",
                          "error": "Dropbox not connected"}],
        })
        return

    await _status_upsert(run_id, {
        "run_id": run_id,
        "state": "running",
        "dry_run": False,
        "agent_id": agent_id,
        "started_at": _now_iso(),
        "files_copied": 0,
        "files_skipped_existing": 0,
        "files_failed": 0,
        "bytes_transferred": 0,
        "current_file": None,
        "errors": [],
    })

    files_copied = 0
    files_skipped = 0
    files_failed = 0
    bytes_transferred = 0
    errors: List[Dict[str, Any]] = []
    started_ts = time.time()
    last_flush = started_ts

    async def _maybe_flush(current: Optional[str]) -> None:
        # v58.13.132mb — hoisted so BOTH `continue` paths (excluded
        # + temp-link fail) still write heartbeats to the status doc.
        # Previously the flush lived at the bottom of the loop body
        # and every `continue` skipped it, so a stale-enum failure
        # burst looked identical to a healthy silent run.
        nonlocal last_flush
        now = time.time()
        if now - last_flush <= 2.0:
            return
        elapsed = max(now - started_ts, 1.0)
        fph = int((files_copied + files_skipped) * 3600.0 / elapsed)
        total_target = files_copied + files_skipped + files_failed
        await _status_upsert(run_id, {
            "state": "running",
            "files_copied": files_copied,
            "files_skipped_existing": files_skipped,
            "files_failed": files_failed,
            "bytes_transferred": bytes_transferred,
            "current_file": current,
            "throughput_files_per_hour": fph,
            "errors": errors,
            "elapsed_s": int(elapsed),
            "progress_files": total_target,
        })
        last_flush = now

    async for row in db[_ENUM_COLL].find({
        # v58.13.132mg — resume support: skip rows already copied
        # in a previous (possibly interrupted) run. `copy_state` is
        # stamped after each successful `fetch_and_put` below.
        "copy_state": {"$ne": "copied"},
    }, {
        "_id": 0, "dropbox_id": 1, "dropbox_path": 1,
        "dropbox_rev": 1, "size": 1, "content_hash": 1,
    }).sort("size", 1):   # small files first — quick wins
        path = row["dropbox_path"]
        size = int(row.get("size") or 0)
        if _is_excluded(path):
            await _maybe_flush(path)
            continue

        nas_path = _nas_rel_path(path)
        # v58.13.132lm (amended) — DO NOT stat-per-file. The
        # original design added a `stat` op before each
        # `fetch_and_put` for idempotency — that turned 98,520
        # copies into 98,520 stat round-trips through the
        # queue, adding 40+ hours before any bytes moved.
        # Idempotency instead relies on:
        #   · Agent-side `.part`-then-atomic-rename discipline
        #     — no half-written destinations survive a crash.
        #   · Cheap size-only overwrite: `fetch_and_put` on the
        #     agent writes into `.part` regardless; final
        #     rename is idempotent (same bytes, same sha).
        #   · A resumed run of a partially-migrated tree will
        #     re-download files but never leave the NAS in a
        #     torn state — worst case is extra bandwidth.
        # Resume-safe stat sweep will land as a separate ship
        # after the first full run completes.

        # Fresh Dropbox temp link per file — expires after ~4 h,
        # but we consume it immediately.
        try:
            tmp_link = client.files_get_temporary_link(path).link
        except Exception as e:   # noqa: BLE001
            files_failed += 1
            errors.append({"path": path, "phase": "temp-link",
                             "error": f"{type(e).__name__}: {e}"})
            errors = errors[-100:]
            await _maybe_flush(path)
            continue

        try:
            wr = await nas_client.fetch_and_put(
                path=nas_path,
                source_url=tmp_link,
                # Dropbox doesn't advertise sha256; skip verify
                # (helper trusts size from GET Content-Length).
                expected_sha256="",
                expected_size=size,
                meta={
                    "source": "dropbox",
                    "dropbox_id": row.get("dropbox_id"),
                    "dropbox_path": path,
                    "dropbox_rev": row.get("dropbox_rev"),
                    "content_hash": row.get("content_hash"),
                    "bytes": size,
                    "migrated_at": _now_iso(),
                    "run_id": run_id,
                },
                # Generous timeout for the 13.7 GB zip; agent's
                # own resumable helper does its own retry chain.
                timeout_s=6 * 3600.0,
                # v58.13.132mg — target ugreen-nas explicitly so the
                # freshest-wins default in `enqueue_op` doesn't
                # route ops to a stale Office Pi that can't serve
                # `fetch_and_put`.
                agent_id=agent_id,
            )
            files_copied += 1
            bytes_transferred += int(wr.get("size") or size)
            # v58.13.132mg — mark enum row as copied for resume idempotency.
            await db[_ENUM_COLL].update_one(
                {"dropbox_id": row["dropbox_id"]},
                {"$set": {"copy_state": "copied",
                             "copied_at": _now_iso(),
                             "copied_by_run_id": run_id}},
            )
        except Exception as e:   # noqa: BLE001
            files_failed += 1
            errors.append({"path": path, "phase": "fetch_and_put",
                             "error": f"{type(e).__name__}: {str(e)[:250]}"})
            errors = errors[-100:]

        await _maybe_flush(path)

    await _status_upsert(run_id, {
        "state": "complete",
        "completed_at": _now_iso(),
        "files_copied": files_copied,
        "files_skipped_existing": files_skipped,
        "files_failed": files_failed,
        "bytes_transferred": bytes_transferred,
        "current_file": None,
        "errors": errors,
    })
    log.info("[copy] run %s complete copied=%d skipped=%d failed=%d "
                "bytes=%d", run_id, files_copied, files_skipped,
                files_failed, bytes_transferred)


# ── Public entrypoint ─────────────────────────────────────────
async def run_copy_job(run_id: str, agent_id: str,
                          dry_run: bool = False) -> None:
    # v58.13.132n8 — Hard lockdown. Refuses to run under any
    # circumstance (dry_run or real). Writes a `disabled_lockdown`
    # status doc so admins can see the refusal via GET
    # /api/dropbox/migration/status. Does NOT touch enum rows or
    # NAS ops. See MIGRATION_DISABLED constant at top of file for
    # the re-enable procedure.
    if MIGRATION_DISABLED:
        log.warning(
            "[copy] run_id=%s REFUSED — MIGRATION_DISABLED (agent=%s, dry_run=%s)",
            run_id, agent_id, dry_run,
        )
        try:
            await _status_upsert(run_id, {
                "state": "disabled_lockdown",
                "agent_id": agent_id,
                "dry_run": dry_run,
                "started_at": _now_iso(),
                "completed_at": _now_iso(),
                "errors": [{"phase": "run_copy_job",
                              "error": "MIGRATION_DISABLED — see dropbox_bytes_copy.py "
                                       "MIGRATION_DISABLED constant"}],
            })
        except Exception:
            log.exception("[copy] failed to persist lockdown refusal doc")
        return

    # v58.13.132mb — outer safety net. Any exception that escapes
    # `_run_dry` / `_run_copy` used to vanish silently (the caller
    # in integrations_dropbox.py fire-and-forgets us). Now we
    # persist a `failed` status doc with the traceback so admins
    # can see what happened via GET /api/dropbox/migration/status.
    try:
        if dry_run:
            await _run_dry(run_id)
        else:
            await _run_copy(run_id, agent_id)
    except BaseException as e:   # noqa: BLE001 — reraise below
        import traceback
        tb = traceback.format_exc()
        log.exception("[copy] run_id=%s crashed: %s", run_id, e)
        try:
            await _status_upsert(run_id, {
                "state": "failed",
                "completed_at": _now_iso(),
                "errors": [{"phase": "run_copy_job",
                              "error": f"{type(e).__name__}: {str(e)[:400]}",
                              "traceback": tb[-2000:]}],
            })
        except Exception:   # noqa: BLE001 — best-effort
            log.exception("[copy] failed to record failure state")
        raise
