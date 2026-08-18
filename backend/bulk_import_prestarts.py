"""v160.3.9.58.0.1 — Bulk-import Daily Pre-Start PDFs.

Backend + endpoints only. Wizard UI comes in v160.3.9.58.1.

Flow:
  POST /pre-starts/bulk-import/init      → create job, resolve URL
  POST /pre-starts/bulk-import/{id}/start → kick off async worker
  GET  /pre-starts/bulk-import/{id}/status → poll progress
  GET  /pre-starts/bulk-import/{id}/report → final per-PDF results
  POST /pre-starts/bulk-import/{id}/approve → after dry-run OK, resume full run

Job state machine:
  init → downloading → extracting → dryrun → awaiting_approval
                                          → processing → complete
                                          → failed

v58 hardening bundle (2026-02):
  · Persist `src_url` on `/init` (mirrors `url_input` for the wizard).
  · URL normalizer covers Dropbox + Google Drive share links.
  · Zip-bomb guardrails on `extract_limit`.
  · Watchdog reaps stuck jobs; structured `error_step` enum.
  · Nightly 30-day retention sweep.

v58.0.1 scaling bundle (2026-02):
  · **Streaming walker**: enumerate ONE nested archive at a time, close
    handles as we advance, never hold the full tree in memory. Fail-fast
    on running-total entry/bytes breaches (still trips `extract_limit`).
  · **Lifted limits**: 15 000 entries / 20 GB unpacked / 100 MB single
    entry — sized for a real 10 000+ PDF back-fill.
  · **Vision concurrency**: bounded producer/consumer pool
    (`BULK_IMPORT_VISION_CONCURRENCY`, default 4). Per-call exponential
    backoff on Claude 429/5xx with configurable retries.
  · **PDF hash cache** (`bulk_import_pdf_cache`): sha256 → extracted
    payload, 30-day TTL. Turns "died at PDF 7 234" into "restart, first
    7 234 skip in seconds, resume at 7 235".
  · **Progress tracking**: `progress = {total, extracted, matched,
    failed, failed_pdfs[], estimated_cost_usd}` — written every
    25 PDFs OR 5 s (whichever hits first) so the wizard can render a
    live progress bar.
  · **Stage-specific watchdogs** — separate timeouts for
    downloading / extracting, plus a *vision-stall* check that keys off
    `processed` DELTA (not wall-clock) so multi-hour runs are healthy.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from typing import AsyncIterator, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from auth import get_current_user

log = logging.getLogger("paneltec.bulk_import_prestarts")
router = APIRouter(prefix="/pre-starts/bulk-import", tags=["bulk-import"])

_WRITE_ROLES = {"admin", "manager", "hseq_lead"}

# ────────────────── v58 / v58.0.1 configuration + enums ──────────────────
#
# Configurable via env for future ops tuning without a code deploy.

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name) or default)
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    """Parse an env var as bool. Accepts on/true/1/yes as truthy."""
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("on", "true", "1", "yes")


# ── Stage-specific watchdog timeouts (v58.0.1) ──
#   downloading   → too slow to fetch the archive
#   extracting    → walker can't get through the outer + nested archives
#   dryrun/processing → vision pipeline has stalled (no `processed` delta
#                       for this long; the wall-clock of a 10k-PDF run
#                       can be many hours, that's fine as long as we're
#                       making forward progress)
DOWNLOAD_TIMEOUT_MIN = _env_int("BULK_IMPORT_DOWNLOAD_TIMEOUT_MIN", 10)
EXTRACT_TIMEOUT_MIN = _env_int("BULK_IMPORT_EXTRACT_TIMEOUT_MIN", 30)
VISION_STALL_TIMEOUT_MIN = _env_int("BULK_IMPORT_VISION_STALL_TIMEOUT_MIN", 15)

# v58.8 — Every N successful commits, write a checkpoint line to the
# logs and append a `{batch, processed, at}` entry to `job.checkpoints`.
# `0` = disabled. Default `2000` gives Stephen a visible milestone
# roughly every ~50 min at ~0.5 PDF/s. No process-level restart, no
# sleep, purely a logging + audit-trail hook.
BATCH_CHECKPOINT_SIZE = _env_int("BULK_IMPORT_BATCH_SIZE", 2000)

# v58.8 — Auto-resume guard. On backend boot, any job whose
# `last_progress_at` is older than this many seconds is a candidate for
# auto-resume. Set high enough not to trip over healthy workers on a
# graceful restart (uvicorn typically hands off in < 3 s).
AUTO_RESUME_GRACE_SECONDS = _env_int("BULK_IMPORT_AUTO_RESUME_GRACE_SEC", 90)

# ── Zip-bomb / oversized-archive guardrails (v58.0.1 lifted defaults) ──
# Ceilings sized for the intentional 10k+ pre-start backfill; still
# provide runway against a hostile input.
MAX_UNPACKED_BYTES = _env_int("BULK_IMPORT_MAX_UNPACKED_MB", 20000) * 1024 * 1024
MAX_PDF_ENTRIES = _env_int(
    "BULK_IMPORT_MAX_ENTRIES",
    # Backwards-compat: honour the v58.0 name if the new one isn't set.
    _env_int("BULK_IMPORT_MAX_PDF_ENTRIES", 15000),
)
MAX_SINGLE_ENTRY_BYTES = _env_int("BULK_IMPORT_MAX_SINGLE_ENTRY_MB", 100) * 1024 * 1024

# Retention: purge jobs (and their dryrun rows) after this many days.
RETENTION_DAYS = _env_int("BULK_IMPORT_RETENTION_DAYS", 30)

# ── Vision pipeline knobs (v58.0.1) ──
VISION_CONCURRENCY = _env_int("BULK_IMPORT_VISION_CONCURRENCY", 4)
VISION_MAX_RETRIES = _env_int("BULK_IMPORT_VISION_MAX_RETRIES", 5)
VISION_BACKOFF_CAP_SEC = _env_int("BULK_IMPORT_VISION_BACKOFF_CAP_SEC", 30)
# v58.5.1 — Per-attempt wall-clock timeout on each Claude call.
# The upstream `LlmChat.send_message()` has NO client-side timeout, so a
# silently-hung request could park a consumer indefinitely. This turns
# that indefinite hang into a bounded retriable failure. 90s covers a
# comfortable 3σ of real classify+extract latencies (p99 ≈ 22s observed).
VISION_CALL_TIMEOUT_SEC = _env_int("BULK_IMPORT_VISION_CALL_TIMEOUT_SEC", 90)
# Rough per-PDF cost estimate. Two Claude calls per PDF (classify +
# extract) at ~$0.003 each → $0.006. Env-overridable so ops can tune.
VISION_PER_PDF_COST_USD = _env_float("BULK_IMPORT_VISION_PER_PDF_COST_USD", 0.006)

# Progress-write cadence — every N PDFs OR every M seconds, whichever hits
# first. Batching keeps Mongo write pressure sane on 10k-PDF runs.
PROGRESS_WRITE_EVERY_N = _env_int("BULK_IMPORT_PROGRESS_EVERY_N", 25)
PROGRESS_WRITE_EVERY_SEC = _env_int("BULK_IMPORT_PROGRESS_EVERY_SEC", 5)

# Producer/consumer queue depth — bounded so memory stays flat regardless
# of archive size. 32 × ~1 MB avg PDF ≈ 32 MB ceiling.
QUEUE_MAXSIZE = _env_int("BULK_IMPORT_QUEUE_MAXSIZE", 32)

# PDF hash cache — TTL for idempotent resume. 30-day default matches
# `bulk_import_jobs` retention so a completed run's cache is still warm
# for a retry inside the same window.
PDF_CACHE_TTL_DAYS = _env_int("BULK_IMPORT_PDF_CACHE_TTL_DAYS", 30)

# Log a WARN line once cumulative extract passes this many PDFs — signals
# to ops that a big job is running, but not an error.
BIG_JOB_LOG_THRESHOLD = _env_int("BULK_IMPORT_BIG_JOB_LOG_THRESHOLD", 5000)

# error_step enum — every failure branch stamps EXACTLY one of these.
# The wizard uses these to render "which stage broke?" copy.
ERROR_STEPS = frozenset({
    "download",       # HTTP GET / redirect / DNS failure fetching the archive
    "extract",        # ZipFile.open / read failed on a corrupt archive
    "extract_limit",  # zip-bomb guardrail tripped (bytes / entries / single-entry)
    "parse",          # pdftoppm / PDF decode failed for a specific PDF
    "vision",         # Claude classify/extract call failed (all retries exhausted)
    "match",          # worker / site fuzzy-match failed (currently soft-fail)
    "dryrun",         # dry-run persistence layer failed
    "approve",        # /approve endpoint side-effects failed
    "write",          # form_submissions insert failed during full run
})


async def ensure_indexes() -> None:
    """Idempotent index setup — called from server startup."""
    try:
        await db.bulk_import_jobs.create_index("id", unique=True)
        await db.bulk_import_jobs.create_index([("org_id", 1), ("created_at", -1)])
        await db.bulk_import_dryrun.create_index([("job_id", 1), ("filename", 1)],
                                                 unique=True)
        await db.bulk_import_dryrun.create_index([("job_id", 1), ("status", 1)])
        # v58.0.1 — PDF hash cache: (org_id, pdf_hash) unique + a TTL
        # on `cached_at` so entries age out without a manual sweep.
        await db.bulk_import_pdf_cache.create_index(
            [("org_id", 1), ("pdf_hash", 1)], unique=True,
            name="uniq_org_pdfhash",
        )
        # `expireAfterSeconds` requires a Date field. `cached_at` is
        # ISO string, so we rely on `retention_cleanup()` to prune —
        # skip the TTL index to avoid Mongo errors on string fields.
        # (Deliberate: we already have a nightly sweep and TTL rows
        # would need `created_at` migrated to Date, which is Phase 2.)

        # v58.7.2 — Optional unique index on
        # `(org_id, source='bulk_import', metadata.pdf_hash)` for
        # `form_submissions`. Complements the v58.7.2 upsert patch by
        # rejecting any concurrent-writer duplicate. Held behind a
        # feature flag because it CANNOT be built on a collection that
        # still contains duplicate rows — the dedupe cleanup script
        # (`scripts/dedupe_bulk_import_submissions_v58_7_2.py --commit`)
        # must run FIRST. Once ops confirms zero duplicates, set
        # `BULK_IMPORT_ENFORCE_UNIQUE_INDEX=true` and restart backend.
        if _env_bool("BULK_IMPORT_ENFORCE_UNIQUE_INDEX", False):
            try:
                await db.form_submissions.create_index(
                    [("org_id", 1), ("source", 1), ("metadata.pdf_hash", 1)],
                    unique=True,
                    name="uniq_bulk_import_pdfhash",
                    # v58.7.3 — restrict the unique constraint to
                    # ACTIVE rows only. Soft-deleted duplicates
                    # (deleted_at != None) intentionally share the
                    # same `pdf_hash` as their survivor — including
                    # them in the index would immediately fail on the
                    # first cleanup sweep.
                    partialFilterExpression={
                        "source": "bulk_import",
                        "metadata.pdf_hash": {"$exists": True},
                        "deleted_at": None,
                    },
                )
            except Exception as e:
                log.warning(
                    "form_submissions unique index blocked (likely "
                    "residual duplicates — run the dedupe script): %s", e)
    except Exception as e:  # pragma: no cover — bootstrap only
        log.warning("bulk_import index setup: %s", e)

# All 6 pre-start template names + their labels (used by the classifier prompt).
_TEMPLATE_HINTS = {
    "536805af-e397-451f-94f0-30296d8f3a97": "Daily Pre-Start",
    "d9008c00-e3b1-4de1-a909-bdf7db4f262a": "CVT Daily Pre-Start",
    "388c3c70-4cd6-4b7b-9ed1-067fae0fa8f9": "Weekly Pre-Start",
    "915f2303-71ca-4735-adc1-1e798d74851d": "Tip Truck Daily Pre-Start",
    "e62bee35-1769-455d-8c30-6200a3c6eb08": "Vacuum Truck (VT) Daily Pre-Start",
    "225cd097-2c2d-4963-9b92-1f8554894db8": "Plant Pre-Start Checklist (Heavy Equipment)",
}


def _require_admin(user: dict) -> None:
    if (user.get("role") or "").lower() not in _WRITE_ROLES:
        raise HTTPException(403, "Admin / manager / HSEQ lead only.")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _audit(user: dict, action: str, payload: dict) -> None:
    try:
        await db.audit_logs.insert_one({
            "org_id": user.get("org_id"), "actor_id": user.get("id"),
            "actor_name": user.get("name") or user.get("email"),
            "action": action, "at": _now_iso(), **payload,
        })
    except Exception as e:
        log.warning("audit write failed: %s", e)


# ────────────────── URL resolver ──────────────────

def _normalize_source_url(url: str) -> str:
    """Rewrite share-link URLs so they stream the raw bytes directly.

    Supports:
      · Dropbox    — flips `?dl=0` → `?dl=1` (or appends `dl=1` when the
                     query string is present but the flag is missing);
                     also swaps `www.dropbox.com` → `dl.dropboxusercontent.com`
                     is intentionally NOT done here because `dl=1` on the
                     canonical host already 302s through to the CDN and
                     httpx follows redirects.
      · Google Drive — rewrites `/file/d/<id>[/view]` share links to the
                     confirmable download endpoint
                     `https://drive.google.com/uc?export=download&id=<id>`.

    Idempotent — running twice returns the same string.
    """
    if not url:
        return url
    u = url.strip()

    # Dropbox
    if "dropbox.com" in u:
        if "dl=0" in u:
            u = u.replace("dl=0", "dl=1")
        elif "dl=1" not in u:
            # `?rlkey=…` share links: append the flag rather than
            # replacing existing params.
            u = u + ("&" if "?" in u else "?") + "dl=1"
        return u

    # Google Drive
    m = re.search(r"drive\.google\.com/file/d/([A-Za-z0-9_-]+)", u)
    if m:
        return f"https://drive.google.com/uc?export=download&id={m.group(1)}"

    return u


# Legacy alias — a handful of pytests import this name.
def _dropbox_dl_swap(url: str) -> str:
    return _normalize_source_url(url)


async def _resolve_and_head(url: str) -> tuple[str, Optional[int]]:
    """Follow redirects to the final CDN URL and return (final_url, size)."""
    url = _normalize_source_url(url)
    async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as c:
        r = await c.head(url)
        r.raise_for_status()
        size = int(r.headers.get("content-length") or 0) or None
        final = str(r.url)
    return final, size


# ────────────────── v58 zip-bomb guardrail ──────────────────

class ExtractLimitExceeded(Exception):
    """Raised when a ZIP archive exceeds one of the configured limits."""


class _RunningExtractStats:
    """Mutable counter carried through the streaming walker.

    Every candidate PDF entry funnels through `.observe(size, name)`
    which increments the running totals and trips
    :class:`ExtractLimitExceeded` on the first breach.
    """

    __slots__ = ("entries", "unpacked_bytes", "big_job_logged")

    def __init__(self) -> None:
        self.entries: int = 0
        self.unpacked_bytes: int = 0
        self.big_job_logged: bool = False

    def observe(self, size: int, name: str) -> None:
        if size > MAX_SINGLE_ENTRY_BYTES:
            raise ExtractLimitExceeded(
                f"single entry too large ({name}: "
                f"{size/1024/1024:.1f} MB > "
                f"{MAX_SINGLE_ENTRY_BYTES/1024/1024:.0f} MB limit)"
            )
        self.entries += 1
        self.unpacked_bytes += size
        if self.entries > MAX_PDF_ENTRIES:
            raise ExtractLimitExceeded(
                f"too many PDF entries ({self.entries} > "
                f"{MAX_PDF_ENTRIES} limit)"
            )
        if self.unpacked_bytes > MAX_UNPACKED_BYTES:
            raise ExtractLimitExceeded(
                f"unpacked total too large "
                f"({self.unpacked_bytes/1024/1024:.1f} MB > "
                f"{MAX_UNPACKED_BYTES/1024/1024:.0f} MB limit)"
            )
        # v58.0.1 — friendly signal to ops that a "big" job is under way.
        # Not an error; just a WARN so it shows up in dashboards.
        if (not self.big_job_logged
                and self.entries >= BIG_JOB_LOG_THRESHOLD):
            log.warning(
                "bulk_import: large job in flight — %d PDFs enumerated "
                "so far (BIG_JOB_LOG_THRESHOLD=%d)",
                self.entries, BIG_JOB_LOG_THRESHOLD,
            )
            self.big_job_logged = True


def _guard_zip_limits(entries: list[tuple[int, str]]) -> None:
    """Legacy bulk-check kept for the v58 pytests.

    v58.0.1 uses :class:`_RunningExtractStats` inline in the streaming
    walker — this bulk helper only runs when a caller already has the
    full entry list (e.g. legacy tests).
    """
    stats = _RunningExtractStats()
    for size, name in entries:
        stats.observe(size, name)


# ────────────────── v58 job-failure helper ──────────────────

async def _fail_job(job_id: str, error_step: str, err_msg: str) -> None:
    """Stamp a job as failed with a structured `error_step` from the
    ERROR_STEPS enum. Idempotent — safe to call from a watchdog even
    if the job already transitioned."""
    if error_step not in ERROR_STEPS:
        # Defensive — never silently drop unknown codes. Log and coerce.
        log.warning("bulk_import: unknown error_step %r → 'download'",
                    error_step)
        error_step = "download"
    await db.bulk_import_jobs.update_one(
        {"id": job_id, "state": {"$nin": ["complete", "failed", "cancelled"]}},
        {"$set": {"state": "failed", "error_step": error_step,
                  "error": err_msg, "finished_at": _now_iso()}},
    )
    # v58.8 — Emit an admin bell notification so ops sees a reap
    # without tailing supervisor logs. Best-effort — swallows errors.
    try:
        j = await db.bulk_import_jobs.find_one(
            {"id": job_id}, {"_id": 0, "org_id": 1, "processed": 1,
                              "mode": 1, "auto_resume_count": 1})
        if j and j.get("org_id"):
            await _notify_admins(
                j["org_id"],
                kind="bulk_import_stalled",
                severity="warning",
                title=f"Bulk import stalled at {j.get('processed', 0)} records",
                body=(f"Job {job_id} failed at stage '{error_step}': "
                      f"{err_msg}. On the next backend restart, "
                      f"v58.8 auto-resume will pick it up automatically "
                      f"unless you 'Start over' first."),
            )
        # v58.8.2 — In-process auto-restart. If the reap was a vision
        # stall (not a permanent bad-input error) AND the job has made
        # progress AND we haven't already retried too many times,
        # spawn a fresh `_run_job` immediately. Cache-skip + v58.7.2
        # upsert make this cost-safe. Capped by
        # `BULK_IMPORT_MAX_AUTO_RESUME` (default 5) so a truly stuck
        # job doesn't loop forever.
        # v58.10.1 — Broaden auto-restart to `dry_run` jobs. Historically
        # this guard required `mode == "full_run"` on the theory that
        # dry-runs are user-initiated review loops. In practice, ALL
        # jobs in production are `dry_run` (the approve endpoint only
        # flips mode to `full_run` at commit time), and a watchdog reap
        # of a `processing`/`dryrun` job is by definition NOT a
        # mid-review event — the user hasn't yet clicked approve.
        # Job `a90eff90-…` stalled at 4,563 records with the old guard
        # silently skipping the restart because `mode='dry_run'`. Fix:
        # allow both modes, and preserve the ORIGINAL mode on the
        # respawned worker so a dry_run stays a dry_run (no silent
        # upgrade to full_run).
        max_retries = _env_int("BULK_IMPORT_MAX_AUTO_RESUME", 5)
        resume_mode = j.get("mode") if j else None
        if (j and error_step == "vision"
                and (j.get("processed") or 0) > 0
                and (j.get("auto_resume_count") or 0) < max_retries
                and resume_mode in ("full_run", "dry_run")):
            new_count = (j.get("auto_resume_count") or 0) + 1
            await db.bulk_import_jobs.update_one(
                {"id": job_id},
                {"$set": {
                    "state": "processing",
                    "error_step": None, "error": None,
                    "finished_at": None,
                    "last_progress_at": _now_iso(),
                    "auto_resumed_at": _now_iso(),
                    "auto_resume_count": new_count,
                }},
            )
            log.info(
                "bulk_import[%s] watchdog reap → in-process "
                "auto-restart (count=%d/%d, mode=%s)",
                job_id, new_count, max_retries, resume_mode,
            )
            asyncio.create_task(_run_job(job_id, mode=resume_mode))
    except Exception as _:  # pragma: no cover
        pass


async def _notify_admins(org_id: str, *, kind: str, severity: str,
                          title: str, body: str) -> None:
    """v58.8 — Fan out a header-bell notification. Mirrors the shape
    used by `cron_simpro_delta.py` so the existing UI consumer picks
    it up with no schema change. Swallows exceptions — a failed
    notification must never take down the pipeline."""
    try:
        import uuid
        await db.notifications.insert_one({
            "id": f"bulk-import-{kind}-{uuid.uuid4().hex[:12]}",
            "org_id": org_id,
            "kind": kind,
            "severity": severity,
            "title": title[:180],
            "body": body[:800],
            "created_at": _now_iso(),
            "read_by": [],
        })
    except Exception as e:  # pragma: no cover
        log.warning("notify_admins failed (kind=%s): %s", kind, e)


async def auto_resume_orphaned_jobs() -> dict:
    """v58.8 — Scan for jobs whose worker died mid-flight (backend
    restart, uvicorn OOM, supervisor bounce) and re-fire `_run_job`
    for each.

    Selection criteria:
      · `state IN {downloading, extracting, dryrun, processing}`
      · `mode IN {full_run, dry_run}` — v58.10.1: the state filter
         already excludes `awaiting_approval` (the review checkpoint),
         so restricting by mode was redundant AND missed dry_runs that
         died mid-flight. Broadened to both modes; the resumed worker
         preserves the ORIGINAL mode.
      · `last_progress_at < now - AUTO_RESUME_GRACE_SECONDS`  (the
         grace prevents us from stepping on a live worker during a
         graceful supervisor reload)

    Cache-skip on the pdf_hash cache means the resumed run replays
    already-processed PDFs at zero Claude cost, then continues from
    the first uncached PDF. v58.7.2 upsert-on-pdf_hash guarantees no
    duplicate `form_submissions` rows.

    Called ONCE from `on_startup` in server.py. Idempotent — reruns
    on the same DB state see zero orphans."""
    from datetime import timedelta
    grace = timedelta(seconds=AUTO_RESUME_GRACE_SECONDS)
    threshold = (datetime.now(timezone.utc) - grace).isoformat()
    orphaned = await db.bulk_import_jobs.find({
        "state": {"$in": ["downloading", "extracting", "dryrun", "processing"]},
        "mode": {"$in": ["full_run", "dry_run"]},
        "$or": [
            {"last_progress_at": {"$lt": threshold}},
            {"last_progress_at": None},
        ],
    }).to_list(length=None)
    resumed_ids: list = []
    for job in orphaned:
        job_id = job["id"]
        resume_mode = job.get("mode") or "full_run"
        log.info(
            "bulk_import auto-resume: job=%s state=%s last_progress=%s "
            "processed=%s — re-firing _run_job(%s)",
            job_id, job.get("state"), job.get("last_progress_at"),
            job.get("processed"), resume_mode,
        )
        # Bump `last_progress_at` NOW so a concurrent watchdog tick
        # doesn't reap the job before the resumed worker writes its
        # first progress line.
        await db.bulk_import_jobs.update_one(
            {"id": job_id},
            {"$set": {"last_progress_at": _now_iso(),
                      "auto_resumed_at": _now_iso(),
                      "auto_resume_count": (job.get("auto_resume_count", 0) + 1)}},
        )
        asyncio.create_task(_run_job(job_id, mode=resume_mode))
        resumed_ids.append(job_id)
        # Emit a header-bell notification for admin visibility.
        await _notify_admins(
            job.get("org_id", ""),
            kind="bulk_import_auto_resume",
            severity="warning",
            title=f"Bulk import auto-resumed at {job.get('processed', 0)} records",
            body=(f"Job {job_id} was stalled in state '{job.get('state')}' "
                  f"and has been automatically resumed on backend startup. "
                  f"Cache will skip already-processed PDFs. No action needed."),
        )
    if resumed_ids:
        log.info("bulk_import auto-resume: %d job(s) restarted: %s",
                 len(resumed_ids), resumed_ids)
    return {"resumed": len(resumed_ids), "job_ids": resumed_ids}


# ────────────────── v58 watchdog + retention ──────────────────

async def watchdog_tick() -> dict:
    """Fail any job whose current stage has stalled beyond its limit.

    v58.0.1 stage-specific policy:
      · state=downloading → `stage_started_at` older than
        `BULK_IMPORT_DOWNLOAD_TIMEOUT_MIN` → `error_step=download`
      · state=extracting  → `stage_started_at` older than
        `BULK_IMPORT_EXTRACT_TIMEOUT_MIN`  → `error_step=extract`
      · state in {dryrun, processing} → `last_progress_at` older than
        `BULK_IMPORT_VISION_STALL_TIMEOUT_MIN` → `error_step=vision`

    The vision check keys off `last_progress_at` (bumped every time the
    `processed` counter is written), NOT wall-clock. A 4-hour job that
    steadily increments is healthy and will NOT be reaped.

    Intended to be called from APScheduler on a ~60 s interval.
    Idempotent — reruns on the same DB state are no-ops.
    """
    now = datetime.now(timezone.utc).timestamp()
    thresholds = {
        "downloading": (DOWNLOAD_TIMEOUT_MIN, "stage_started_at", "download"),
        "extracting":  (EXTRACT_TIMEOUT_MIN,  "stage_started_at", "extract"),
        "dryrun":      (VISION_STALL_TIMEOUT_MIN, "last_progress_at", "vision"),
        "processing":  (VISION_STALL_TIMEOUT_MIN, "last_progress_at", "vision"),
    }
    reaped = 0
    async for job in db.bulk_import_jobs.find(
        {"state": {"$in": list(thresholds.keys())}},
        {"_id": 0, "id": 1, "state": 1,
         "stage_started_at": 1, "last_progress_at": 1, "started_at": 1},
    ):
        state = job["state"]
        cap_min, ref_field, step = thresholds[state]
        # Preferred ref field with graceful fallbacks so pre-v58.0.1
        # rows (which only have `started_at`) don't wedge the watchdog.
        ref = (job.get(ref_field)
               or job.get("stage_started_at")
               or job.get("started_at"))
        try:
            ts = datetime.fromisoformat(ref).timestamp() if ref else 0
        except (TypeError, ValueError):
            ts = 0
        if ts and (now - ts) > cap_min * 60:
            elapsed_min = int((now - ts) / 60)
            await _fail_job(
                job["id"], step,
                f"watchdog: no {'progress' if ref_field == 'last_progress_at' else 'stage change'} "
                f"for {elapsed_min} min in state '{state}' "
                f"(cap={cap_min}m)",
            )
            reaped += 1
    if reaped:
        log.info("bulk_import watchdog reaped %d stuck job(s)", reaped)
    return {
        "reaped": reaped,
        "caps_min": {
            "downloading": DOWNLOAD_TIMEOUT_MIN,
            "extracting": EXTRACT_TIMEOUT_MIN,
            "vision_stall": VISION_STALL_TIMEOUT_MIN,
        },
    }


async def retention_cleanup() -> dict:
    """Purge `bulk_import_jobs` rows older than `RETENTION_DAYS`, plus
    their associated `bulk_import_dryrun` rows and any PDF cache entries
    older than `PDF_CACHE_TTL_DAYS`.

    Called nightly by APScheduler (03:00 Sydney) — see `server.py`.
    Also removes any orphan dryrun rows whose parent job has already
    been swept.
    """
    from datetime import timedelta as _td
    now = datetime.now(timezone.utc).replace(microsecond=0)
    jobs_cutoff = (now - _retention_delta()).isoformat()
    cache_cutoff = (now - _td(days=PDF_CACHE_TTL_DAYS)).isoformat()

    # Find IDs first so we can prune the dryrun sidecar deterministically.
    old_ids: list[str] = []
    async for j in db.bulk_import_jobs.find(
            {"created_at": {"$lt": jobs_cutoff}}, {"_id": 0, "id": 1}):
        old_ids.append(j["id"])
    dryrun_deleted = 0
    if old_ids:
        r = await db.bulk_import_dryrun.delete_many({"job_id": {"$in": old_ids}})
        dryrun_deleted = r.deleted_count
    jobs_deleted = 0
    if old_ids:
        r = await db.bulk_import_jobs.delete_many({"id": {"$in": old_ids}})
        jobs_deleted = r.deleted_count

    # v58.0.1 — PDF-cache TTL sweep. Independent of job retention so a
    # long-lived org keeps warm hashes even if their jobs age out.
    cache_deleted = 0
    try:
        r = await db.bulk_import_pdf_cache.delete_many(
            {"cached_at": {"$lt": cache_cutoff}})
        cache_deleted = r.deleted_count
    except Exception as e:  # non-fatal
        log.warning("pdf_cache retention sweep failed: %s", e)

    # v58.2 — PDF GridFS purge: nuke any blob whose parent job just
    # got swept, plus any orphan blob older than the cache TTL.
    pdfs_deleted = 0
    try:
        bucket = _pdf_bucket()
        # Blobs tied to a purged job.
        if old_ids:
            async for f in db[f"{_PDF_BUCKET_NAME}.files"].find(
                    {"metadata.job_id": {"$in": old_ids}}, {"_id": 1}):
                try:
                    await bucket.delete(f["_id"])
                    pdfs_deleted += 1
                except Exception as pe:
                    log.debug("gridfs delete failed for %s: %s", f["_id"], pe)
        # Orphan blobs older than the cache cutoff (defensive).
        async for f in db[f"{_PDF_BUCKET_NAME}.files"].find(
                {"metadata.stored_at": {"$lt": cache_cutoff}}, {"_id": 1}):
            try:
                await bucket.delete(f["_id"])
                pdfs_deleted += 1
            except Exception as pe:
                log.debug("gridfs delete failed for %s: %s", f["_id"], pe)
    except Exception as e:
        log.warning("failed-pdf retention sweep failed: %s", e)

    if jobs_deleted or cache_deleted or pdfs_deleted:
        log.info("bulk_import retention: %d job(s) + %d dryrun + %d cache + "
                 "%d pdf row(s) purged (jobs>%dd, cache>%dd)",
                 jobs_deleted, dryrun_deleted, cache_deleted, pdfs_deleted,
                 RETENTION_DAYS, PDF_CACHE_TTL_DAYS)
    return {
        "jobs_deleted": jobs_deleted,
        "dryrun_deleted": dryrun_deleted,
        "cache_deleted": cache_deleted,
        "pdfs_deleted": pdfs_deleted,
        "jobs_cutoff": jobs_cutoff,
        "cache_cutoff": cache_cutoff,
        "retention_days": RETENTION_DAYS,
    }


def _retention_delta():
    """`timedelta` for the configured retention window. Extracted so
    tests can monkeypatch it independently of the env var."""
    from datetime import timedelta
    return timedelta(days=RETENTION_DAYS)


# ────────────────── v58.2 · GridFS storage for failed-row PDFs ──────────────────
#
# When the vision pipeline can't extract a PDF (pdftoppm crashed on a
# malformed file, Claude returned no fields, etc.) we still commit the
# row into the review queue with `needs_review=True`. The reviewer
# needs to be able to look at the PDF that broke; the raw bytes are
# stashed in this GridFS bucket keyed by the returned `ObjectId`
# (persisted as a string on `form_submissions.metadata.gridfs_id`).
#
# Successful rows do NOT get their bytes persisted — the extractor
# already produced usable fields and re-storing multi-GB of clean PDFs
# would be wasteful. The retention sweep purges these blobs alongside
# their parent job.

_PDF_BUCKET_NAME = "bulk_import_failed_pdfs"


def _pdf_bucket():
    """Lazy singleton. Motor bucket construction is cheap but stashing
    the reference avoids repeated attribute lookups during hot loops."""
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket
    if not hasattr(_pdf_bucket, "_bucket"):
        _pdf_bucket._bucket = AsyncIOMotorGridFSBucket(
            db, bucket_name=_PDF_BUCKET_NAME)
    return _pdf_bucket._bucket


async def _store_failed_pdf(pdf_bytes: bytes, filename: str,
                            org_id: str, job_id: str) -> Optional[str]:
    """Upload the PDF bytes to GridFS and return the resulting id as a
    string. On any error returns `None` and logs — this is best-effort,
    the primary flow (row → form_submissions) never fails on a storage
    hiccup."""
    try:
        oid = await _pdf_bucket().upload_from_stream(
            filename,
            pdf_bytes,
            metadata={"org_id": org_id, "job_id": job_id,
                      "stored_at": _now_iso()},
        )
        return str(oid)
    except Exception as e:  # non-fatal
        log.warning("failed-pdf upload failed for %s: %s", filename, e)
        return None


# ────────────────── v58.0.1 · Claude retry wrapper ──────────────────


def _is_retriable_claude_error(exc: Exception) -> bool:
    """True for rate-limit / transient server errors worth retrying.

    The upstream `_claude_json` wraps every failure as
    `HTTPException(503, detail="LLM call failed: <original>")`, so we
    inspect the detail string for the tell-tale tokens. Falls open on
    unknown shapes — better to retry a false positive than to abandon
    a run at PDF 5 000.
    """
    detail = getattr(exc, "detail", None) or str(exc)
    txt = str(detail).lower()
    return any(tok in txt for tok in (
        "429", "rate limit", "rate_limit", "overloaded",
        "quota", "timeout", "timed out", "502", "503", "504",
        "temporarily", "try again",
    ))


async def _claude_call_with_backoff(fn, *args, counters: Optional[dict] = None,
                                    **kwargs):
    """Retry `fn(*args, **kwargs)` up to `VISION_MAX_RETRIES` times with
    exponential backoff (1, 2, 4, 8, 16 s, capped at
    `VISION_BACKOFF_CAP_SEC`). Only retries transient errors — everything
    else raises immediately.

    v58.5.1 — Each attempt is wrapped in `asyncio.wait_for(...,
    VISION_CALL_TIMEOUT_SEC)` so a silent hang in the underlying LLM
    client becomes a retriable `asyncio.TimeoutError`. Optional
    `counters` dict is mutated in-place to record `429s / 5xxs /
    timeouts / retries` for per-batch telemetry."""
    delays = [1, 2, 4, 8, 16]
    last_exc: Optional[Exception] = None
    attempts = min(VISION_MAX_RETRIES + 1, len(delays) + 1)
    for i in range(attempts):
        try:
            return await asyncio.wait_for(
                fn(*args, **kwargs), timeout=VISION_CALL_TIMEOUT_SEC)
        except asyncio.TimeoutError as exc:
            last_exc = exc
            if counters is not None:
                counters["timeouts"] = counters.get("timeouts", 0) + 1
            if i == attempts - 1:
                # Wrap as a plain Exception so upstream `except` clauses
                # (which look for `str(e)`) get a stable error string.
                raise Exception(
                    f"claude call timeout after {VISION_CALL_TIMEOUT_SEC}s") from exc
            delay = min(delays[i], VISION_BACKOFF_CAP_SEC)
            log.info("claude retry %d/%d after %ds (timeout %ds)",
                     i + 1, attempts - 1, delay, VISION_CALL_TIMEOUT_SEC)
            if counters is not None:
                counters["retries"] = counters.get("retries", 0) + 1
            await asyncio.sleep(delay)
        except Exception as exc:
            last_exc = exc
            if counters is not None:
                txt = str(getattr(exc, "detail", None) or exc).lower()
                if "429" in txt or "rate" in txt or "overloaded" in txt or "quota" in txt:
                    counters["429s"] = counters.get("429s", 0) + 1
                elif "502" in txt or "503" in txt or "504" in txt:
                    counters["5xxs"] = counters.get("5xxs", 0) + 1
            if not _is_retriable_claude_error(exc) or i == attempts - 1:
                raise
            delay = min(delays[i], VISION_BACKOFF_CAP_SEC)
            log.info("claude retry %d/%d after %ds (%s)",
                     i + 1, attempts - 1, delay, str(exc)[:120])
            if counters is not None:
                counters["retries"] = counters.get("retries", 0) + 1
            await asyncio.sleep(delay)
    # Defensive — the loop above always either returns or re-raises.
    raise last_exc  # pragma: no cover


# ────────────────── v58.0.1 · PDF hash cache ──────────────────


def _pdf_hash(pdf_bytes: bytes) -> str:
    """Content hash used as the cache key. sha256 of the raw PDF bytes.
    Fast (~200 MB/s single-core) and collision-resistant well beyond
    our practical needs."""
    return hashlib.sha256(pdf_bytes).hexdigest()


async def _cache_lookup(org_id: str, pdf_hash: str) -> Optional[dict]:
    """Return the cached extraction payload for this (org, hash), or
    `None` on miss. Bumps `last_hit_at` on hits so the TTL sweep
    prioritises truly-cold entries."""
    doc = await db.bulk_import_pdf_cache.find_one(
        {"org_id": org_id, "pdf_hash": pdf_hash}, {"_id": 0})
    if doc:
        # Refresh the last-hit timestamp so a "warm" hash stays warm.
        try:
            await db.bulk_import_pdf_cache.update_one(
                {"org_id": org_id, "pdf_hash": pdf_hash},
                {"$set": {"last_hit_at": _now_iso()}},
            )
        except Exception as e:  # non-fatal
            log.debug("cache lookup bump failed: %s", e)
    return doc


async def _cache_put(org_id: str, pdf_hash: str, payload: dict) -> None:
    """Insert (or refresh) a cache row. Idempotent via upsert on
    (org_id, pdf_hash). `cached_at` is used by the TTL index."""
    now_iso = _now_iso()
    doc = {
        "org_id": org_id,
        "pdf_hash": pdf_hash,
        "classifier": payload.get("classifier"),
        "extracted": payload.get("extracted"),
        "template_id": payload.get("template_id"),
        "template_name": payload.get("template_name"),
        "worker_match": payload.get("worker_match"),
        "site_match": payload.get("site_match"),
        "cached_at": now_iso,
        "last_hit_at": now_iso,
    }
    try:
        await db.bulk_import_pdf_cache.replace_one(
            {"org_id": org_id, "pdf_hash": pdf_hash}, doc, upsert=True)
    except Exception as e:  # non-fatal — cache is best-effort
        log.warning("cache put failed for %s: %s", pdf_hash[:12], e)


# ────────────────── Claude helpers ──────────────────

async def _claude_classify(png_b64: str) -> dict:
    """Ask Claude which of the 6 templates this PDF page best matches."""
    from ai import _claude_json  # reuse the existing helper
    names = list(_TEMPLATE_HINTS.values())
    system = ("You classify photos of Australian pre-start check-sheets. "
              "Return JSON only.")
    user = ("Which of these template names best matches this form? "
            f"Options: {json.dumps(names)}. "
            'Respond as {"template_name": "…", "confidence": 0.0-1.0}.')
    return await _claude_json(system, user, image_b64=png_b64)


async def _claude_extract(png_b64: str, template: dict) -> dict:
    """Extract structured values keyed by field label from the PDF page."""
    from ai import _claude_json
    labels = [f["label"] for f in template.get("fields", [])]
    system = "You extract filled pre-start check-sheet values. Return JSON only."
    user = (
        f"Template: {template.get('name')}. "
        f"For each of these field labels, extract the filled value: "
        f"{json.dumps(labels)}. "
        'Return {"date":"YYYY-MM-DD","worker_name":"…","plant_or_vehicle":"…",'
        '"site":"…","gps_map_present":true|false,"signature_present":true|false,'
        '"checklist":{"<label>":"Pass|Fail|N/A|Yes|No|<text>"},"notes":"…"}. '
        "Use exact label strings as keys. Omit fields you cannot see."
    )
    return await _claude_json(system, user, image_b64=png_b64)


# ────────────────── Fuzzy match ──────────────────

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _norm_label(s: str) -> str:
    """Whitespace-normalised, case-insensitive label key for map lookups."""
    return re.sub(r"\s+", " ", (s or "").strip().lower())


async def _match_worker(name: str, org_id: str) -> tuple[Optional[str], float]:
    if not name: return None, 0.0
    target = _norm(name)
    best_id, best_score = None, 0.0
    async for w in db.workers.find({"org_id": org_id, "deleted_at": None},
                                    {"_id": 0, "id": 1, "first_name": 1, "last_name": 1}):
        cand = _norm(f"{w.get('first_name','')} {w.get('last_name','')}")
        if not cand: continue
        # Simple containment score; production could use rapidfuzz.
        score = 1.0 if cand == target else (
            0.9 if target in cand or cand in target else 0.0)
        if score > best_score:
            best_id, best_score = w["id"], score
    return (best_id, best_score) if best_score >= 0.85 else (None, best_score)


async def _match_site(name: str, org_id: str) -> Optional[str]:
    if not name: return None
    target = _norm(name)
    async for s in db.sites.find({"org_id": org_id, "deleted_at": None},
                                  {"_id": 0, "id": 1, "name": 1}):
        if _norm(s.get("name", "")) == target: return s["id"]
    return None


# ────────────────── Label → field mapper ──────────────────
#
# v160.3.9.12a-live — Maps a Claude extraction payload back onto a
# template's positional `fields[]` array. The web/mobile form submission
# schema stores answers positionally (one entry per template field, in
# order), so this mapper produces the same shape:
#
#     [{"label": "", "type": "text", "value": <mapped>}, ...]
#
# Any Claude checklist keys that don't line up with a template label are
# collected into a `_unmapped` sidecar for reviewer follow-up. Any
# template field the extractor couldn't fill gets a null value.
#
# Special handlers dispatch by field TYPE + LABEL — e.g. `worker_picker`
# takes the fuzzy-matched worker_id; `vehicle_navixy` takes a rego-shaped
# object; radio fields consume the checklist dict; the "Fault / Hazard"
# radio comes from `extracted.fault_reported`; textarea for fault details
# from `extracted.fault_description`; date fields from `extracted.date`.
#
# GPS fields are intentionally left null — legacy paper Pre-Starts have
# no lat/lng attached; we don't want to fabricate coordinates from the
# scanned "Location" string.

# Label substrings that indicate a specific extraction target.
_DATE_HINTS = ("date",)
_ODO_HINTS = ("odometer",)
_FAULT_RADIO_HINTS = ("fault / hazard", "fault/hazard", "submitting a service request")
_FAULT_DETAIL_HINTS = ("details of fault", "details of hazard")
_FAULT_PHOTO_HINTS = ("photos of defect", "photo of defect")
_COMPLETE_HINTS = ("pre-start complete", "prestart complete")


def _map_extraction_to_fields(
    template: dict,
    extracted: dict,
    worker_match: dict,
    site_id: Optional[str],
) -> tuple[list[dict], list[dict], int]:
    """Return (fields, unmapped, mapped_count).

    `fields` is positional and safe to persist as `form_submissions.fields`.
    `unmapped` collects Claude checklist entries whose labels did not
    line up with any template field label.
    `mapped_count` is how many template fields received a non-null value.
    """
    template_fields = template.get("fields") or []
    checklist = extracted.get("checklist") or {}
    # Precompute normalised checklist keys for fuzzy-ish lookups.
    norm_checklist = {_norm_label(k): v for k, v in checklist.items()}
    consumed_checklist_keys: set[str] = set()

    def _pop_checklist(label: str):
        key = _norm_label(label)
        if key in norm_checklist:
            consumed_checklist_keys.add(key)
            return norm_checklist[key]
        return None

    fields: list[dict] = []
    mapped_count = 0

    for tf in template_fields:
        ftype = (tf.get("type") or "").lower()
        label = tf.get("label") or ""
        low = _norm_label(label)
        value = None

        if ftype == "date" or any(h in low for h in _DATE_HINTS):
            date_str = extracted.get("date")
            if date_str:
                value = str(date_str)
        elif ftype == "worker_picker":
            wid = (worker_match or {}).get("id")
            wname = extracted.get("worker_name") or ""
            if wid or wname:
                value = [{
                    "worker_id": wid,
                    "name": wname or None,
                    "company_label": None,
                    "match_confidence": (worker_match or {}).get("confidence"),
                    "match_source": "bulk_import_claude",
                }]
        elif ftype == "gps":
            # Legacy PDFs carry no coordinates. Store the extractor's
            # site string as `address` so the reviewer can eyeball it.
            addr = extracted.get("site")
            if addr:
                value = {"lat": None, "lng": None, "accuracy": None,
                         "address": addr, "source": "bulk_import_ocr"}
        elif ftype == "vehicle_navixy" or ftype == "vehicle_picker":
            raw = extracted.get("plant_or_vehicle") or ""
            if raw:
                # Best-effort rego pull: first alphanumeric token that
                # looks like an AU rego (5-7 chars, letters+digits).
                m = re.search(r"[A-Z0-9]{4,7}", raw.upper())
                rego = m.group(0) if m else None
                value = {"id": None, "label": raw, "plate": rego,
                         "registration": rego, "source": "bulk_import_ocr"}
        elif any(h in low for h in _FAULT_RADIO_HINTS):
            fr = extracted.get("fault_reported")
            if fr is not None:
                value = "Yes" if bool(fr) else "No"
            else:
                # Some extractors flatten this into the checklist dict.
                v = _pop_checklist(label)
                if v is not None:
                    value = v
        elif any(h in low for h in _FAULT_DETAIL_HINTS):
            fd = extracted.get("fault_description")
            if fd:
                value = fd
        elif any(h in low for h in _FAULT_PHOTO_HINTS):
            # Legacy PDFs don't carry embedded evidence photos.
            value = None
        elif any(h in low for h in _ODO_HINTS):
            odo = extracted.get("odometer")
            if odo is not None:
                value = odo
        elif any(h in low for h in _COMPLETE_HINTS):
            v = _pop_checklist(label)
            if v is not None:
                value = v
            elif extracted.get("signature_present"):
                value = "Yes"
        else:
            # Default path — try the checklist dict by normalised label.
            v = _pop_checklist(label)
            if v is not None:
                value = v

        # Field submission shape — matches the existing form_submissions
        # positional schema. `label` is intentionally blank because the
        # canonical label lives on the template, not on the submission.
        fields.append({"label": "", "type": "text", "value": value})
        if value is not None:
            mapped_count += 1

    # Any checklist keys Claude produced that we couldn't line up with a
    # template field become sidecar entries.
    unmapped = [
        {"label": k, "value": v}
        for k, v in checklist.items()
        if _norm_label(k) not in consumed_checklist_keys
    ]
    return fields, unmapped, mapped_count



# ────────────────── PDF → PNG ──────────────────

def _pdf_first_page_png_b64(pdf_bytes: bytes) -> Optional[str]:
    """pdftoppm the first page of `pdf_bytes` → PNG → base64."""
    with tempfile.TemporaryDirectory() as td:
        pdf_path = os.path.join(td, "in.pdf")
        with open(pdf_path, "wb") as f:
            f.write(pdf_bytes)
        try:
            subprocess.run(
                ["pdftoppm", "-png", "-r", "110", "-f", "1", "-l", "1",
                 pdf_path, os.path.join(td, "page")],
                check=True, capture_output=True, timeout=30,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            log.warning("pdftoppm failed: %s", e)
            return None
        for fn in sorted(os.listdir(td)):
            if fn.startswith("page") and fn.endswith(".png"):
                return base64.b64encode(open(os.path.join(td, fn), "rb").read()).decode()
    return None


# ────────────────── Models ──────────────────

class InitBody(BaseModel):
    source: str  # "url" | "upload"
    url: Optional[str] = None
    filename: Optional[str] = None


class ApproveBody(BaseModel):
    approve: bool = True
    # v58.2 — When True (default), also commit rows whose vision
    # extraction failed. They land in `form_submissions` with
    # `metadata.needs_review=True` and `metadata.error_step` set to
    # the failing stage. A `metadata.gridfs_id` points to the raw PDF
    # stored in GridFS so a reviewer can open it later. When False,
    # failed rows are dropped entirely (legacy pre-v58.2 behaviour).
    include_failed_rows: bool = True


# ────────────────── Endpoints ──────────────────

# ────────────────── v58.1 test fixture ──────────────────
#
# Publicly served small ZIP for smoke-testing the wizard without
# pointing it at real customer data. Gated by `ENABLE_TEST_FIXTURES=on`
# env (default `on`) so prod deployments can flip it off.

_FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures",
                             "prestart-sample.zip")


@router.api_route("/fixture/prestart-sample.zip", methods=["GET", "HEAD"],
                  include_in_schema=False)
async def fixture_zip():
    from fastapi.responses import FileResponse
    if os.environ.get("ENABLE_TEST_FIXTURES", "on").lower() != "on":
        raise HTTPException(404, "test fixtures disabled")
    if not os.path.exists(_FIXTURE_PATH):
        raise HTTPException(404, "fixture missing")
    return FileResponse(_FIXTURE_PATH, media_type="application/zip",
                        filename="prestart-sample.zip")


# v58.2 — Stream a failed-row PDF back from GridFS. Auth-gated. The
# reviewer's review-queue UI wires up to this route (Phase 2 of the
# wizard). Content-Disposition is inline so the browser previews it.
@router.get("/pdf/{gridfs_id}", include_in_schema=False)
async def get_failed_pdf(gridfs_id: str,
                        user: dict = Depends(get_current_user)):
    from bson import ObjectId
    from bson.errors import InvalidId
    from fastapi.responses import StreamingResponse
    try:
        oid = ObjectId(gridfs_id)
    except (InvalidId, TypeError):
        raise HTTPException(400, "invalid gridfs id")
    try:
        stream = await _pdf_bucket().open_download_stream(oid)
    except Exception as e:
        # gridfs raises `NoFile` on miss — bucket the failure as 404
        # rather than exposing the internal exception.
        raise HTTPException(404, f"pdf not found: {e}")
    # Same-org check: `metadata.org_id` was set on upload.
    if (stream.metadata or {}).get("org_id") != user["org_id"]:
        raise HTTPException(404, "pdf not found")
    filename = getattr(stream, "filename", None) or "prestart.pdf"

    async def _iter():
        while True:
            chunk = await stream.readchunk()
            if not chunk:
                break
            yield chunk

    return StreamingResponse(
        _iter(), media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/init", status_code=201)
async def init_job(body: InitBody, user: dict = Depends(get_current_user)):
    _require_admin(user)
    if body.source == "url":
        if not body.url:
            raise HTTPException(400, "url required for source='url'")
        # v58: normalize before the HEAD so we don't burn a redirect on
        # a link the CDN would reject.
        normalized = _normalize_source_url(body.url)
        try:
            final_url, size = await _resolve_and_head(normalized)
        except Exception as e:
            log.warning("bulk_import init HEAD failed: %s", e)
            raise HTTPException(
                400,
                f"Could not resolve source URL: {e}. "
                f"Check the link is publicly accessible.",
            )
    else:
        normalized, final_url, size = None, None, None

    job_id = str(uuid.uuid4())
    now = _now_iso()
    doc = {
        "id": job_id, "org_id": user["org_id"], "actor_id": user.get("id"),
        "source": body.source,
        # v58 — persist BOTH the raw input (audit trail) and the
        # normalised URL (`src_url`, used by the download worker and
        # the wizard's "retry" affordance).
        "url_input": body.url,
        "src_url": normalized,
        "url_final": final_url,
        "filename": body.filename, "size_bytes": size,
        "state": "init",
        "error_step": None,  # v58 — set to one of ERROR_STEPS on failure.
        "processed": 0, "failed": 0, "total": None,
        "errors": [], "template_hits": {},
        "created_at": now,
        # v58.0.1 — seed the stage/progress clocks so the watchdog has
        # a defensible reference even before `/start` fires.
        "stage_started_at": now,
        "last_progress_at": now,
        "progress": {
            "total": None, "extracted": 0, "matched": 0,
            "cached_hits": 0, "failed": 0, "failed_pdfs": [],
            "estimated_cost_usd": 0.0,
        },
    }
    await db.bulk_import_jobs.insert_one(doc)
    await _audit(user, "bulk_import.init",
                 {"job_id": job_id, "source": body.source, "size": size})
    return {"job_id": job_id, "size_bytes": size,
            "url_final": final_url, "src_url": normalized}


@router.get("/last")
async def last_resumable_job(
    within_days: int = 30,
    states: str = "failed,awaiting_approval",
    user: dict = Depends(get_current_user),
):
    """v58.6 — Return the most-recent bulk-import job for the caller's
    org that is in a resumable state. Powers the wizard's "Resume last
    import" button.

    Query params:
      · `within_days` — cap on `created_at` age (default 30d).
      · `states`      — comma-separated list of states to consider
                        (default `failed,awaiting_approval`).

    Returns `null` when no matching job exists — the wizard hides the
    button entirely so first-time users don't see clutter. When a job
    is returned, only the fields the wizard needs are projected —
    stripping `errors`, `url_final`, `_id` etc keeps the payload small
    and the shape stable.
    """
    _require_admin(user)
    within_days = max(1, min(within_days, 365))
    state_list = [s.strip() for s in (states or "").split(",") if s.strip()]
    if not state_list:
        state_list = ["failed", "awaiting_approval"]
    # `created_at` is stored as ISO string, so use string comparison
    # against a computed cutoff ISO string (lexicographic ordering
    # matches chronological ordering for ISO-8601 with UTC offsets).
    cutoff = (datetime.now(timezone.utc)
              - timedelta(days=within_days)).isoformat()
    doc = await db.bulk_import_jobs.find_one(
        {
            "org_id": user["org_id"],
            "state": {"$in": state_list},
            "created_at": {"$gte": cutoff},
        },
        sort=[("created_at", -1)],
        projection={"_id": 0},
    )
    if not doc:
        return None
    return {
        "id": doc.get("id"),
        "src_url": doc.get("src_url") or doc.get("url_input"),
        "url_input": doc.get("url_input"),
        "filename": doc.get("filename"),
        "batch_label": doc.get("filename"),  # wizard alias
        "notes": doc.get("notes"),
        "include_failed_rows": doc.get("include_failed_rows", True),
        "state": doc.get("state"),
        "progress": doc.get("progress") or {},
        "total": doc.get("total"),
        "total_pdfs_discovered": doc.get("total_pdfs_discovered"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("last_progress_at") or doc.get("finished_at")
                       or doc.get("created_at"),
        "error": doc.get("error"),
        "error_step": doc.get("error_step"),
    }


@router.post("/{job_id}/start", status_code=202)
async def start_job(job_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    job = await db.bulk_import_jobs.find_one({"id": job_id, "org_id": user["org_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "job not found")
    if job["state"] not in {"init", "awaiting_approval"}:
        raise HTTPException(400, f"job in state {job['state']}, cannot start")

    mode = "full_run" if job["state"] == "awaiting_approval" else "dry_run"
    # v58.0.1 — always start in `downloading` with a fresh stage clock
    # so the download watchdog measures the RIGHT elapsed time.
    now = _now_iso()
    await db.bulk_import_jobs.update_one({"id": job_id},
        {"$set": {"state": "downloading",
                  "started_at": now,
                  "stage_started_at": now,
                  "last_progress_at": now,
                  "mode": mode,
                  "error_step": None}})
    # Fire the worker in the background — do NOT await.
    asyncio.create_task(_run_job(job_id, mode))
    await _audit(user, "bulk_import.start", {"job_id": job_id, "mode": mode})
    return {"job_id": job_id, "mode": mode}


@router.get("/{job_id}/status")
async def status(job_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    job = await db.bulk_import_jobs.find_one({"id": job_id, "org_id": user["org_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "job not found")
    return job


@router.get("/{job_id}/report")
async def report(job_id: str, user: dict = Depends(get_current_user)):
    _require_admin(user)
    job = await db.bulk_import_jobs.find_one({"id": job_id, "org_id": user["org_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "job not found")
    dryrun = []
    async for r in db.bulk_import_dryrun.find({"job_id": job_id}, {"_id": 0}):
        dryrun.append(r)
    return {"job": job, "dryrun_results": dryrun}


@router.post("/{job_id}/approve")
async def approve(job_id: str, body: ApproveBody, user: dict = Depends(get_current_user)):
    _require_admin(user)
    job = await db.bulk_import_jobs.find_one({"id": job_id, "org_id": user["org_id"]}, {"_id": 0})
    if not job:
        raise HTTPException(404, "job not found")
    if job["state"] != "awaiting_approval":
        raise HTTPException(400, "job not awaiting approval")
    if not body.approve:
        await db.bulk_import_jobs.update_one({"id": job_id},
            {"$set": {"state": "cancelled", "cancelled_at": _now_iso()}})
        return {"job_id": job_id, "state": "cancelled"}
    # Kick off the full run.
    # v58.0.1 — re-download + reset both watchdog clocks.
    # v58.2 — persist `include_failed_rows` on the job doc so
    # `_run_job` knows whether to commit failed rows too.
    now = _now_iso()
    await db.bulk_import_jobs.update_one({"id": job_id},
        {"$set": {"state": "downloading",
                  # v58.10.1 — Canonically flip `mode` to `full_run` on
                  # approval so downstream watchdog reaps that read
                  # `mode` from the DB doc see the effective mode (not
                  # the stale `dry_run` from init). Prevents the
                  # in-process auto-restart from silently downgrading
                  # an approved full-run back to a 20-PDF dry_run.
                  "mode": "full_run",
                  "resumed_at": now,
                  "started_at": now,
                  "stage_started_at": now,
                  "last_progress_at": now,
                  "include_failed_rows": bool(body.include_failed_rows),
                  "error_step": None}})
    asyncio.create_task(_run_job(job_id, "full_run"))
    await _audit(user, "bulk_import.approve", {"job_id": job_id})
    return {"job_id": job_id, "state": "downloading"}


# ────────────────── Worker ──────────────────

async def _stream_download(url: str, dest_path: str) -> int:
    """Streaming download to disk. Returns bytes written."""
    total = 0
    async with httpx.AsyncClient(follow_redirects=True, timeout=None) as c:
        async with c.stream("GET", url) as r:
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                async for chunk in r.aiter_bytes(chunk_size=1 << 20):
                    f.write(chunk); total += len(chunk)
    return total


async def _process_one_pdf(job: dict, filename: str, pdf_bytes: bytes,
                           templates_by_id: dict, org_id: str,
                           counters: Optional[dict] = None) -> dict:
    """Classifier + extractor + fuzzy match for one PDF. Persists to
    `bulk_import_dryrun`. Returns the persisted record dict.

    v58.0.1 changes:
      · Content-hash lookup against `bulk_import_pdf_cache` BEFORE any
        Claude call — cache hits skip both classifier and extractor.
      · Claude calls wrapped in `_claude_call_with_backoff` — 429/5xx
        errors get up to `VISION_MAX_RETRIES` retries with exponential
        backoff (1, 2, 4, 8, 16 s, capped 30 s).
      · Cache hits are marked with `cached: True` in the returned
        record so the wizard can render a "resumed" pill.
    """
    png_b64 = await asyncio.to_thread(_pdf_first_page_png_b64, pdf_bytes)
    if not png_b64:
        # v58.2 — pdftoppm failed. Stash the raw PDF in GridFS so a
        # reviewer can open it from the review queue and figure out
        # what's wrong with the file.
        gid = await _store_failed_pdf(pdf_bytes, filename, org_id, job["id"])
        rec = {"job_id": job["id"], "filename": filename,
               "status": "failed", "reason": "pdftoppm failed",
               "error_step": "parse",
               "gridfs_id": gid,
               "pdf_hash": _pdf_hash(pdf_bytes),
               "at": _now_iso()}
        await db.bulk_import_dryrun.replace_one(
            {"job_id": job["id"], "filename": filename}, rec, upsert=True)
        return rec

    # v58.0.1 — check the content-hash cache first. On hit we bypass
    # BOTH Claude calls, saving ~5 s + ~$0.006 per PDF.
    pdf_hash = _pdf_hash(pdf_bytes)
    cached = await _cache_lookup(org_id, pdf_hash)
    try:
        if cached:
            cls = cached.get("classifier") or {}
            ext = cached.get("extracted") or {}
            tpl_id = cached.get("template_id")
            tpl_name = cached.get("template_name") or "Daily Pre-Start"
            worker_match = cached.get("worker_match") or {
                "id": None, "confidence": 0.0, "needs_review": True}
            site_match = cached.get("site_match") or {"id": None}
            template = templates_by_id.get(tpl_id) or {}
        else:
            cls = await _claude_call_with_backoff(
                _claude_classify, png_b64, counters=counters)
            tpl_name = (cls or {}).get("template_name") or "Daily Pre-Start"
            tpl_id = next((k for k, v in _TEMPLATE_HINTS.items() if v == tpl_name),
                          "536805af-e397-451f-94f0-30296d8f3a97")
            template = templates_by_id.get(tpl_id) or {}
            ext = await _claude_call_with_backoff(
                _claude_extract, png_b64, template, counters=counters)
            worker_id, worker_conf = await _match_worker(
                ext.get("worker_name", ""), org_id)
            site_id = await _match_site(ext.get("site", ""), org_id)
            worker_match = {"id": worker_id, "confidence": worker_conf,
                            "needs_review": worker_id is None}
            site_match = {"id": site_id}
            # Populate cache for the next run.
            await _cache_put(org_id, pdf_hash, {
                "classifier": cls, "extracted": ext,
                "template_id": tpl_id, "template_name": tpl_name,
                "worker_match": worker_match, "site_match": site_match,
            })

        mapped_fields, unmapped, mapped_count = _map_extraction_to_fields(
            template, ext, worker_match, site_match.get("id"),
        )
        rec = {
            "job_id": job["id"], "filename": filename,
            "status": "ok",
            "classifier": cls, "extracted": ext,
            "template_id": tpl_id, "template_name": tpl_name,
            "worker_match": worker_match,
            "site_match": site_match,
            "mapped_fields": mapped_fields,
            "unmapped_labels": unmapped,
            "mapped_count": mapped_count,
            "template_field_count": len(template.get("fields") or []),
            "cached": bool(cached),
            "pdf_hash": pdf_hash,
            "at": _now_iso(),
        }
    except Exception as e:
        # v58.2 — Claude classify/extract failed. Same treatment as
        # a parse failure: stash the raw PDF so the reviewer has it.
        gid = await _store_failed_pdf(pdf_bytes, filename, org_id, job["id"])
        rec = {"job_id": job["id"], "filename": filename,
               "status": "failed",
               "reason": f"claude: {e}",
               "error_step": "vision",
               "gridfs_id": gid,
               "pdf_hash": pdf_hash,
               "at": _now_iso()}
    await db.bulk_import_dryrun.replace_one(
        {"job_id": job["id"], "filename": filename}, rec, upsert=True)
    return rec


# ────────────────── v58.0.1 · streaming walker ──────────────────

async def _stream_pdfs_from_archive(
    zip_path: str, stats: _RunningExtractStats,
) -> AsyncIterator[tuple[str, str, bytes]]:
    """Async generator yielding `(archive_label, pdf_name, pdf_bytes)`.

    Streaming contract:
      · Opens exactly ONE nested archive at a time.
      · Extracts nested archives to a tempfile, iterates their entries,
        closes and deletes the tempfile before moving to the next.
      · Enforces limits (`_RunningExtractStats.observe`) DURING iteration
        so a hostile archive fails fast on the first breach — no need to
        enumerate the whole tree before deciding to reject.
      · `__MACOSX/` sidecar entries are silently skipped.

    Consumers push each yielded tuple into a bounded queue so producer
    memory stays flat regardless of archive size (see `_run_job`).
    """
    # Load the ZipFile lazily on a worker thread — reading the central
    # directory of a 5 GB archive can take seconds and we don't want to
    # block the event loop.
    outer_zf = await asyncio.to_thread(zipfile.ZipFile, zip_path, "r")
    try:
        for info in outer_zf.infolist():
            entry = info.filename
            low = entry.lower()
            if low.startswith("__macosx") or low.endswith("/"):
                continue
            if low.endswith(".pdf"):
                stats.observe(info.file_size, entry)
                data = await asyncio.to_thread(outer_zf.read, entry)
                yield ("<outer>", entry, data)
            elif low.endswith(".zip"):
                nested_path: Optional[str] = None
                inner_zf: Optional[zipfile.ZipFile] = None
                try:
                    with tempfile.NamedTemporaryFile(
                            delete=False, suffix=".zip") as tf:
                        nested_path = tf.name
                    # Stream the nested zip to disk — never load its
                    # bytes into RAM. Chunk size = 8 MB.
                    def _copy_nested():
                        with outer_zf.open(entry) as src, \
                                open(nested_path, "wb") as dst:
                            shutil.copyfileobj(src, dst, length=8 * 1024 * 1024)
                    await asyncio.to_thread(_copy_nested)
                    try:
                        inner_zf = await asyncio.to_thread(
                            zipfile.ZipFile, nested_path, "r")
                    except zipfile.BadZipFile as ze:
                        log.warning("nested zip %s unreadable: %s", entry, ze)
                        continue
                    inner_pdf_count = 0
                    for sub_info in inner_zf.infolist():
                        sub = sub_info.filename
                        sub_low = sub.lower()
                        if sub_low.startswith("__macosx") or sub_low.endswith("/"):
                            continue
                        if sub_low.endswith(".pdf"):
                            stats.observe(sub_info.file_size, sub)
                            data = await asyncio.to_thread(
                                inner_zf.read, sub)
                            yield (entry, sub, data)
                            inner_pdf_count += 1
                    log.info("bulk_import: nested zip %s contributed %d PDFs",
                             entry, inner_pdf_count)
                finally:
                    # Close and delete tempfile BEFORE moving to next
                    # nested archive — this is the whole point of the
                    # streaming walker.
                    if inner_zf is not None:
                        try:
                            inner_zf.close()
                        except Exception:  # noqa: BLE001
                            pass
                    if nested_path:
                        try:
                            os.unlink(nested_path)
                        except OSError:
                            pass
    finally:
        try:
            outer_zf.close()
        except Exception:  # noqa: BLE001
            pass


# ────────────────── v58.2 · form_submission builder ──────────────────


def _build_form_submission(job: dict, rec: dict, display_name: str) -> dict:
    """Produce the `form_submissions` doc for both the `ok` and the
    v58.2 failed-row commit paths.

    For failed rows we deliberately still supply `template_id` and
    `template_name_snapshot` — falling back to a generic pre-start
    label — so the review queue can render the row in the same table
    as everything else. `metadata.needs_review=True` is the signal
    that a human needs to act on it.
    """
    is_failed = rec.get("status") == "failed"
    metadata: dict = {
        "imported_via": "bulk_import_v160.3.9.58.2",
        "job_id": job["id"],
        "src_filename": display_name,
        "pdf_hash": rec.get("pdf_hash"),
        "cached": rec.get("cached", False),
        "classifier_confidence":
            (rec.get("classifier") or {}).get("confidence"),
        "mapped_count": rec.get("mapped_count"),
        "template_field_count": rec.get("template_field_count"),
        "unmapped_labels": rec.get("unmapped_labels") or [],
        "worker_match": dict(rec.get("worker_match")
            or {"id": None, "confidence": 0.0, "needs_review": True}),
        "site_match": rec.get("site_match") or {"id": None},
    }
    if is_failed:
        # v58.2 — flag the review queue and preserve the raw PDF handle.
        metadata["needs_review"] = True
        metadata["error_step"] = rec.get("error_step")
        metadata["failure_reason"] = rec.get("reason")
        # If the extractor got partial fields before crashing, keep
        # them — the reviewer can salvage the date / worker name / etc.
        metadata["partial_extraction"] = rec.get("extracted") or {}
        gid = rec.get("gridfs_id")
        if gid:
            metadata["gridfs_id"] = gid
        # `worker_match` above already carries `needs_review=True` — this
        # is a belt-and-braces flag so the query
        # `metadata.worker_match.needs_review=True` also lights up on
        # failed rows.
        metadata["worker_match"]["needs_review"] = True

    return {
        "id": str(uuid.uuid4()),
        "org_id": job["org_id"],
        "template_id": rec.get("template_id"),
        "template_name_snapshot": rec.get("template_name")
            or ("Daily Pre-Start (needs review)" if is_failed else "Daily Pre-Start"),
        "fields": rec.get("mapped_fields") or [],
        "source": "bulk_import",
        "submitted_at": _now_iso(),
        "submitted_by_id": job.get("actor_id"),
        "metadata": metadata,
        "deleted_at": None,
    }



async def _run_job(job_id: str, mode: str):
    """The async worker. Downloads zip, iterates PDFs, runs classifier +
    extractor per PDF, updates job progress.

    v58 — every failure branch now stamps a structured `error_step` on
    the job row so the wizard can render actionable copy.
    """
    job = await db.bulk_import_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        return
    org_id = job["org_id"]
    dry_limit = 20 if mode == "dry_run" else None
    # v58.2 — for full runs, whether to also commit failed rows into
    # `form_submissions` with `needs_review=True`. Default True.
    include_failed = bool(job.get("include_failed_rows", True)) \
        if mode == "full_run" else False
    download_url = job.get("src_url") or job.get("url_input")
    zip_path: Optional[str] = None
    try:
        # ─── 1. Download ───────────────────────────────────────
        # `start_job` already stamped state=downloading + stage_started_at,
        # so the watchdog is running against the right clock.
        try:
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tf:
                zip_path = tf.name
            await _stream_download(download_url, zip_path)
        except Exception as e:
            log.exception("bulk_import job %s download failed", job_id)
            await _fail_job(job_id, "download", f"download: {e}")
            return

        # ─── 2. Load templates ─────────────────────────────────
        templates_by_id: dict = {}
        async for t in db.form_templates.find(
                {"org_id": org_id, "deleted_at": None, "category": "pre_start"},
                {"_id": 0}):
            templates_by_id[t["id"]] = t

        # ─── 3. Transition to extracting ───────────────────────
        await _set_stage(job_id, "extracting")

        # Validate the outer ZIP up front so a corrupt archive fails
        # with a clean error_step rather than blowing up the walker.
        try:
            with zipfile.ZipFile(zip_path, "r"):
                pass
        except zipfile.BadZipFile as e:
            await _fail_job(job_id, "extract", f"corrupt ZIP: {e}")
            return

        # ─── 4. Producer / consumer processing ─────────────────
        # Bounded queue + N-way vision concurrency (default 4).
        # Producer streams PDFs from the archive; consumers call Claude
        # under a semaphore and persist per-PDF records.
        stats = _RunningExtractStats()
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        SENTINEL = None

        # Shared mutable progress snapshot — kept in a dict so the
        # closure captures a single reference. Persisted to Mongo on a
        # batched cadence (every N PDFs OR every M seconds).
        prog = {
            "total": None,          # set once the producer finishes
            "extracted": 0,
            "matched": 0,
            "failed": 0,
            "cached_hits": 0,
            "failed_pdfs": [],
            "estimated_cost_usd": 0.0,
            # v58.5.1 — per-run telemetry for silent-hang debugging.
            # Mutated in place by `_claude_call_with_backoff`.
            "429s": 0,
            "5xxs": 0,
            "timeouts": 0,
            "retries": 0,
        }
        last_write_ts = time.monotonic()
        run_started_ts = time.monotonic()

        async def _flush_progress(force: bool = False) -> None:
            nonlocal last_write_ts
            now = time.monotonic()
            if not force and (
                (prog["extracted"] + prog["failed"]) % PROGRESS_WRITE_EVERY_N != 0
                and (now - last_write_ts) < PROGRESS_WRITE_EVERY_SEC
            ):
                return
            last_write_ts = now
            processed = prog["extracted"] + prog["failed"]
            update = {
                "$set": {
                    "processed": processed,
                    "failed": prog["failed"],
                    # Preserve only the last 100 failed filenames — the
                    # full list lives in `bulk_import_dryrun`.
                    "progress": {
                        "total": prog["total"],
                        "extracted": prog["extracted"],
                        "matched": prog["matched"],
                        "cached_hits": prog["cached_hits"],
                        "failed": prog["failed"],
                        "failed_pdfs": prog["failed_pdfs"][-100:],
                        "estimated_cost_usd": round(
                            prog["estimated_cost_usd"], 4),
                    },
                    "last_progress_at": _now_iso(),
                },
            }
            try:
                await db.bulk_import_jobs.update_one({"id": job_id}, update)
            except Exception as e:  # non-fatal
                log.debug("progress write failed: %s", e)
            # v58.5.1 — per-batch telemetry so a future stall is
            # diagnosable from the logs alone (no MongoDB probe needed).
            elapsed = int(time.monotonic() - run_started_ts)
            log.info(
                "bulk_import[%s] batch processed=%d cached=%d matched=%d "
                "failed=%d 429s=%d 5xxs=%d timeouts=%d retries=%d elapsed=%ds",
                job_id, processed, prog["cached_hits"], prog["matched"],
                prog["failed"], prog["429s"], prog["5xxs"],
                prog["timeouts"], prog["retries"], elapsed,
            )
            # v58.8 — Batch checkpoint. When `BATCH_CHECKPOINT_SIZE > 0`
            # (default 2000), emit a distinctive log line + append a
            # checkpoint entry to `job.checkpoints` every N processed
            # rows. Purely informative — no throttle, no restart, no
            # sleep. Stephen sees a visible "batch 2 complete" milestone
            # in logs + the pill can render "Batch 3/5 committed".
            if BATCH_CHECKPOINT_SIZE > 0 and processed > 0:
                bucket = processed // BATCH_CHECKPOINT_SIZE
                last_bucket = prog.get("_last_checkpoint_bucket", -1)
                if bucket > last_bucket and bucket > 0:
                    log.info(
                        "bulk_import[%s] BATCH CHECKPOINT batch=%d "
                        "total=%d matched=%d cached=%d",
                        job_id, bucket, processed,
                        prog["matched"], prog["cached_hits"],
                    )
                    prog["_last_checkpoint_bucket"] = bucket
                    try:
                        await db.bulk_import_jobs.update_one(
                            {"id": job_id},
                            {"$push": {"checkpoints": {
                                "batch": bucket, "processed": processed,
                                "at": _now_iso(),
                                "matched": prog["matched"],
                                "cached": prog["cached_hits"],
                            }}},
                        )
                    except Exception as _:  # pragma: no cover
                        pass

        producer_done = asyncio.Event()
        producer_error: dict[str, Optional[Exception]] = {"err": None}

        async def producer() -> None:
            try:
                async for archive_label, pdf_name, pdf_bytes in \
                        _stream_pdfs_from_archive(zip_path, stats):
                    if dry_limit and stats.entries > dry_limit:
                        break
                    await q.put((archive_label, pdf_name, pdf_bytes))
            except ExtractLimitExceeded as e:
                producer_error["err"] = e
            except Exception as e:  # any other walker failure → extract
                log.exception("bulk_import job %s walker failed", job_id)
                producer_error["err"] = e
            finally:
                producer_done.set()
                # Feed sentinels so consumers unblock.
                for _ in range(VISION_CONCURRENCY):
                    await q.put(SENTINEL)

        async def consumer() -> None:
            while True:
                item = await q.get()
                if item is SENTINEL:
                    q.task_done()
                    return
                archive_label, pdf_name, data = item
                try:
                    display_name = (f"{archive_label}::{pdf_name}"
                                    if archive_label != "<outer>" else pdf_name)
                    rec = await _process_one_pdf(job, display_name, data,
                                                 templates_by_id, org_id,
                                                 counters=prog)

                    # Book-keeping counters (all rows contribute to
                    # progress; separate `ok` vs `failed` accounting).
                    if rec["status"] == "ok":
                        prog["extracted"] += 1
                        if rec.get("worker_match", {}).get("id"):
                            prog["matched"] += 1
                        if rec.get("cached"):
                            prog["cached_hits"] += 1
                        else:
                            prog["estimated_cost_usd"] += VISION_PER_PDF_COST_USD
                    else:
                        prog["failed"] += 1
                        prog["failed_pdfs"].append(display_name)

                    # v58.2 — Full-run insert path. On `ok` we always
                    # insert. On `failed` we ALSO insert when the job
                    # was approved with `include_failed_rows=True`
                    # (default) — the row lands in the review queue
                    # with `needs_review=True` and a `gridfs_id` link
                    # to the raw PDF.
                    # v58.7.2 — Upsert-by-pdf_hash to prevent duplicate
                    # rows on cache-hit inserts during a resume. Keyed
                    # on `(org_id, source='bulk_import', metadata.pdf_hash)`
                    # so a re-run against the same Dropbox URL replays
                    # the extraction path (cheap, cache-driven) without
                    # producing 2 form_submissions for the same PDF.
                    # `$setOnInsert` preserves any post-import edits on
                    # a row that already exists (reviewer notes, worker
                    # matches manually corrected, etc). Legacy paths
                    # that don't carry a `pdf_hash` fall through to the
                    # original `insert_one`.
                    if mode == "full_run" and (
                        rec["status"] == "ok"
                        or (rec["status"] == "failed" and include_failed)
                    ):
                        try:
                            _doc = _build_form_submission(job, rec, display_name)
                            _hash = (_doc.get("metadata") or {}).get("pdf_hash")
                            if _hash:
                                await db.form_submissions.update_one(
                                    {
                                        "org_id": _doc["org_id"],
                                        "source": "bulk_import",
                                        "metadata.pdf_hash": _hash,
                                    },
                                    {"$setOnInsert": _doc},
                                    upsert=True,
                                )
                                # v58.10 — Dual-write into `pre_starts`
                                # for the Pre-Start template family so
                                # Daily Pre-Starts renders records live.
                                # `form_submissions` remains source of
                                # truth (rich `fields` array, audit).
                                # `pre_starts` shim is a lightweight
                                # visibility layer keyed on pdf_hash.
                                _tpl = (_doc.get("template_name_snapshot") or "").lower()
                                if "pre-start" in _tpl or "pre start" in _tpl or "checklist" in _tpl:
                                    _fname = (_doc.get("metadata") or {}).get("src_filename") or "unknown.pdf"
                                    _wname = (((_doc.get("metadata") or {}).get("worker_match") or {}).get("name")) or "Imported from PDF"
                                    _shim = {
                                        "id": _doc["id"],
                                        "org_id": _doc["org_id"],
                                        "workspace_id": _doc.get("workspace_id") or "",
                                        "date": (_doc.get("submitted_at") or _now_iso())[:10],
                                        "crew_lead": _wname,
                                        "work_summary": f"Imported: {_fname}",
                                        "linked_swms_ids": [],
                                        "linked_permits": [],
                                        "hazards_discussed": "",
                                        "sign_ons": [],
                                        "notes": "Auto-written by v58.10 dual-write.",
                                        "created_by": _doc.get("submitted_by_id"),
                                        "created_at": _doc.get("created_at") or _now_iso(),
                                        "updated_at": _now_iso(),
                                        "deleted_at": None,
                                        "imported": True,
                                        "source_form_submission_id": _doc["id"],
                                        "pdf_hash": _hash,
                                    }
                                    await db.pre_starts.update_one(
                                        {"org_id": _doc["org_id"],
                                         "pdf_hash": _hash, "imported": True},
                                        {"$setOnInsert": _shim},
                                        upsert=True,
                                    )
                            else:
                                await db.form_submissions.insert_one(_doc)
                        except Exception as we:
                            log.warning("bulk_import: write failed for %s: %s",
                                        display_name, we)
                            prog["failed"] += 1
                            prog["failed_pdfs"].append(display_name)
                            await db.bulk_import_dryrun.update_one(
                                {"job_id": job_id, "filename": display_name},
                                {"$set": {"status": "failed",
                                          "reason": f"write: {we}",
                                          "error_step": "write"}},
                            )
                    await _flush_progress()
                except Exception as e:
                    log.exception("consumer failed on %s: %s", pdf_name, e)
                    prog["failed"] += 1
                    prog["failed_pdfs"].append(pdf_name)
                    await _flush_progress()
                finally:
                    q.task_done()

        # ─── 5. Kick off producer + consumers ──────────────────
        # We transition to `dryrun`/`processing` immediately so the
        # vision-stall watchdog uses `last_progress_at` rather than
        # `stage_started_at`. First real progress write lands within
        # `PROGRESS_WRITE_EVERY_SEC` seconds.
        await _set_stage(job_id,
                          "dryrun" if mode == "dry_run" else "processing")
        producer_task = asyncio.create_task(producer())
        consumers = [asyncio.create_task(consumer())
                     for _ in range(VISION_CONCURRENCY)]
        await asyncio.gather(producer_task, *consumers)

        # ─── 6. Post-run checks ────────────────────────────────
        if producer_error["err"] is not None:
            err = producer_error["err"]
            if isinstance(err, ExtractLimitExceeded):
                log.warning("bulk_import job %s tripped extract_limit: %s",
                            job_id, err)
                await _fail_job(job_id, "extract_limit", str(err))
            else:
                await _fail_job(job_id, "extract", f"walker: {err}")
            return

        prog["total"] = prog["extracted"] + prog["failed"]
        await _flush_progress(force=True)

        # ─── 7. Final state transition ─────────────────────────
        new_state = "awaiting_approval" if mode == "dry_run" else "complete"
        await db.bulk_import_jobs.update_one(
            {"id": job_id},
            {"$set": {
                "state": new_state,
                "total": prog["total"],
                "total_pdfs_discovered": stats.entries,
                "finished_at": _now_iso(),
            }},
        )
        log.info("bulk_import job %s → %s: extracted=%d, cached_hits=%d, "
                 "failed=%d, cost≈$%.2f",
                 job_id, new_state, prog["extracted"], prog["cached_hits"],
                 prog["failed"], prog["estimated_cost_usd"])
    except Exception as e:
        log.exception("bulk_import job %s failed (unclassified)", job_id)
        await _fail_job(job_id, "parse", str(e))
    finally:
        if zip_path:
            try:
                os.unlink(zip_path)
            except OSError:
                pass


async def _set_stage(job_id: str, new_state: str) -> None:
    """Atomically transition a job's state and refresh the
    stage-watchdog / progress-watchdog reference timestamps."""
    now = _now_iso()
    await db.bulk_import_jobs.update_one(
        {"id": job_id},
        {"$set": {
            "state": new_state,
            "stage_started_at": now,
            "last_progress_at": now,
        }},
    )
