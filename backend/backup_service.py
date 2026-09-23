"""
Paneltec Hub — Backup Service
=============================

This module exposes a small API that lets the Paneltec Hub take
full-snapshot backups of its data and ship them out to a destination
the operator controls.

Architecture decision (LAN-based UGREEN tower)
----------------------------------------------
The Hub runs in Emergent's cloud — it cannot reach a private RFC1918
IP like `192.168.15.165` directly. So we use a **pull model**:

    [ Hub backend ] ─── creates snapshot ──→ [ /api/backup/snapshots ]
                                                         │
                                                         │  HTTPS pull
                                                         ▼
              [ Agent on the office LAN ] ── writes to ──→ UGREEN NAS
                                                            (SMB share)

The operator runs the small Python "agent" (see
`/app/scripts/paneltec_backup_agent.py`) on a Raspberry Pi, an
always-on PC, or directly on the NAS itself. The agent:
  • Polls this API every N seconds (default 60).
  • mDNS-discovers `_smb._tcp` services on the LAN (so the UI in
    Settings can show the operator which SMB targets are visible
    from inside the network without us needing to reach them
    ourselves).
  • Downloads each new snapshot and writes it onto the UGREEN's
    SMB share at the path the operator configured.

Data scope: FULL SNAPSHOT.
  • MongoDB dump (every collection except heavy ephemeral logs)
  • Configuration documents (integrations, settings, manifests)
  • Uploaded files / attachments / signatures (base64 in Mongo)
  • Metadata: app version, snapshot id, server timestamp, sha256

Storage: snapshots are stored in GridFS (the `bk_fs.*` buckets) so we
aren't capped by MongoDB's 16 MiB single-document limit. The metadata
manifest still lives in `bk_snapshots` for fast listing.

Mirroring cadence:
  • The operator picks the agent's poll interval (default 60s).
    Effective lag from action → backup-on-NAS = (poll interval +
    snapshot size / agent bandwidth). On a 100 Mbit/s LAN with a
    200 MB snapshot that's ≈ 16 seconds, so effectively "real time".

Security
--------
Each agent registers ONCE and receives a long-lived agent token.
That token must be presented on every poll. Tokens are stored
hashed in `bk_agents` (sha256) so DB compromise doesn't leak
credentials.
"""
import io
import json
import os
import uuid
import zipfile
import hashlib
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Tuple

from cryptography.fernet import Fernet, InvalidToken

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Header, Query, UploadFile, File
from fastapi.responses import StreamingResponse, PlainTextResponse
from pydantic import BaseModel, Field, ConfigDict
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from auth_helpers import verify_bearer_token  # shared helper — breaks the
                                              # legacy `server.py` ↔
                                              # `backup_service.py` import cycle

logger = logging.getLogger("backup")

# ─────────────────────────────────────────────────────────────
# v58.13.132jh — Backup routine circuit-breaker + retention caps.
#
# Emergent's infra team traced the recurring `/app` disk-full outages
# to THIS module: `_do_snapshot` writes full-DB ZIPs (~400 MB each)
# via GridFS into `bk_fs.files` + `bk_fs.chunks` — on the same 9.8 GB
# partition it is dumping. Combined with a 4-way trigger fan-out
# (POST /snapshots, APScheduler 6h, APScheduler COB, startup catch-up,
# hourly watchdog) it fired 5+ times in a 10-minute window during boot
# storms, and age-only retention couldn't cap the accumulated footprint.
#
# Circuit breaker: `BACKUPS_ENABLED` (default false). When false the
# core snapshot routine short-circuits at the top of `_do_snapshot`
# and every wrapper (guarded background task, HTTP endpoint,
# scheduler jobs in server.py) logs a warning + returns without
# writing anything.
#
# Trigger dedupe: 60-minute lock via a single-doc `system.backup_lock`
# collection carrying `{last_run_at, in_progress, started_at}`.
# Stale-lock reclaim after 2 h emits a distinct log line
# (`backup_lock.stale_reclaimed after=2h`) so we can spot recurring
# hangs in future.
#
# Retention caps: alongside the existing GFS age tiers we now enforce
# a MAX_COUNT cap and a MAX_TOTAL_MB cap, both env-driven. Strictest
# of {age, count, size} wins.
# ─────────────────────────────────────────────────────────────
def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default

# Read on every access so a live `.env` edit + supervisor restart
# takes effect without a code redeploy. Wrapped in helpers so the
# behaviour is unit-testable via monkeypatch of `os.environ`.
def _backups_enabled() -> bool:
    return _env_bool("BACKUPS_ENABLED", default=False)

def _snapshot_max_count() -> int:
    return _env_int("SNAPSHOT_MAX_COUNT", default=7)

def _snapshot_max_total_mb() -> int:
    return _env_int("SNAPSHOT_MAX_TOTAL_MB", default=2000)

# v58.13.132jh — LAN delivery drop-zone (filesystem, NOT Mongo).
# Snapshots are written as `<uuid>.zip` under this directory. The Pi
# agent downloads them via the existing `/api/backup/snapshots/{id}/data`
# endpoint (now filesystem-backed) and posts back via `/agent/report`,
# at which point we mark the row `shipped_at` and delete the on-disk
# copy. This keeps the on-disk footprint bounded (≤ MAX_UNSHIPPED
# unshipped ZIPs at any time; ~800 MB peak).
def _lan_delivery_enabled() -> bool:
    return _env_bool("LAN_DELIVERY_ENABLED", default=True)

def _lan_drop_zone() -> str:
    return os.environ.get("LAN_DELIVERY_DROP_ZONE", "/app/backups/outgoing")

def _lan_max_unshipped() -> int:
    return _env_int("LAN_DELIVERY_MAX_UNSHIPPED", default=2)

def _lan_max_pending_hours() -> int:
    return _env_int("LAN_DELIVERY_MAX_PENDING_HOURS", default=24)

# Trigger-dedupe lock window. 60 min covers back-to-back reboots and
# APScheduler misfire storms. Stale-lock reclaim tightened from 2 h
# to 30 min in v58.13.132ks — a real snapshot completes in ~90 s
# (see /app/memory/v58_13_132ks_backup_scheduler_stale_lock.md), so
# 30 min gives ~20× grace over the typical duration while dramatically
# shortening the outage window when a backend restart kills a writer
# mid-flight (the exact class of bug that stalled the scheduler for
# 26.2 h on 2026-09-21).
_BACKUP_LOCK_WINDOW_MIN = 60
_BACKUP_LOCK_STALE_MINUTES = 30
_BACKUP_LOCK_DOC_ID = "backup_lock"


async def _acquire_backup_lock(db_) -> Tuple[bool, str]:
    """Atomic-ish acquire of the singleton backup lock.

    Returns `(acquired, reason)`. Reason on skip is one of:
      - "recent_run"     — a successful backup completed <60 min ago
      - "in_progress"    — another writer is currently running
      - "acquired"       — lock is ours; caller must release it

    v58.13.132ks — Adds two WARN log lines so the operator can spot
    the class of bug that stalled the scheduler for 26.2 h on
    2026-09-21:
      · A "SKIPPED — lock held" line whenever an inbound fire is
        blocked by another writer (lets us see if legit long
        writes are being blocked vs. a stale lock).
      · A "RECLAIMED" line whenever the 30-min stale threshold
        fires (a persistent counter is also incremented on the
        lock doc so the health surface can flag recurring hangs).
    """
    now = datetime.now(timezone.utc)
    doc = await db_.system_backup_lock.find_one({"_id": _BACKUP_LOCK_DOC_ID}) or {}

    # Stale-lock reclaim: if a writer says it's in-progress but the
    # started_at is older than the stale threshold, treat it as
    # crashed and take over. v58.13.132ks: threshold 2h → 30min.
    started_raw = doc.get("started_at")
    reclaimed = False
    if doc.get("in_progress") and started_raw:
        try:
            started_dt = started_raw if isinstance(started_raw, datetime) else \
                datetime.fromisoformat(str(started_raw).replace("Z", "+00:00"))
            if started_dt.tzinfo is None:
                started_dt = started_dt.replace(tzinfo=timezone.utc)
            age_min = (now - started_dt).total_seconds() / 60
            if age_min >= _BACKUP_LOCK_STALE_MINUTES:
                logger.warning(
                    "backup_lock.stale_reclaimed — was held for %.1f min (threshold=%d min). "
                    "started_at=%s. Proceeding with snapshot.",
                    age_min, _BACKUP_LOCK_STALE_MINUTES, started_dt.isoformat(),
                )
                doc["in_progress"] = False  # fall through to acquire
                reclaimed = True
                # v58.13.132ks — persistent counter so recurring
                # stale-lock hangs show up in the health probe.
                try:
                    await db_.system_backup_lock.update_one(
                        {"_id": _BACKUP_LOCK_DOC_ID},
                        {"$inc": {"stale_lock_reclaim_count": 1},
                         "$set": {"last_stale_reclaim_at": now.isoformat(),
                                  "last_stale_reclaim_age_min": age_min}},
                        upsert=True,
                    )
                except Exception as _e:  # noqa: BLE001
                    logger.warning("backup_lock reclaim counter bump failed: %s", _e)
        except Exception as _e:  # noqa: BLE001
            logger.warning("backup_lock stale probe failed: %s", _e)

    if doc.get("in_progress"):
        # v58.13.132ks — surface WHY the fire was skipped so we can
        # distinguish "healthy long write" from "stalled lock".
        try:
            started_dt = started_raw if isinstance(started_raw, datetime) else \
                datetime.fromisoformat(str(started_raw).replace("Z", "+00:00"))
            if started_dt.tzinfo is None:
                started_dt = started_dt.replace(tzinfo=timezone.utc)
            skip_age_min = (now - started_dt).total_seconds() / 60
        except Exception:  # noqa: BLE001
            skip_age_min = -1.0
        logger.warning(
            "backup_snapshot.scheduler_skipped — lock held. "
            "started_at=%s, age_min=%.1f, stale_threshold_min=%d. "
            "If age_min exceeds the threshold on the next fire, the "
            "reclaim path will take over.",
            started_raw, skip_age_min, _BACKUP_LOCK_STALE_MINUTES,
        )
        return False, "in_progress"

    last_raw = doc.get("last_run_at")
    if last_raw:
        try:
            last_dt = last_raw if isinstance(last_raw, datetime) else \
                datetime.fromisoformat(str(last_raw).replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            age_min = (now - last_dt).total_seconds() / 60
            if age_min < _BACKUP_LOCK_WINDOW_MIN:
                return False, "recent_run"
        except Exception as _e:  # noqa: BLE001
            logger.warning("backup_lock recency probe failed: %s", _e)

    await db_.system_backup_lock.update_one(
        {"_id": _BACKUP_LOCK_DOC_ID},
        {"$set": {"in_progress": True, "started_at": now.isoformat()}},
        upsert=True,
    )
    return True, "acquired"


async def _release_backup_lock(db_, ok: bool):
    """Release the singleton backup lock. On success we stamp
    `last_run_at` so the 60-min recency window kicks in. On failure
    we clear `in_progress` but do NOT stamp `last_run_at` so a
    retry can fire immediately."""
    now = datetime.now(timezone.utc)
    updates: Dict[str, Any] = {"in_progress": False, "started_at": None}
    if ok:
        updates["last_run_at"] = now.isoformat()
    try:
        await db_.system_backup_lock.update_one(
            {"_id": _BACKUP_LOCK_DOC_ID},
            {"$set": updates},
            upsert=True,
        )
    except Exception as _e:  # noqa: BLE001
        logger.warning("backup_lock release failed: %s", _e)


# Wired up to the same Mongo connection server.py uses. We import lazily
# inside the router setup so this file can be imported before .env loads.
_db = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_token(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


# ─────────────────────────────────────────────────────────────
# v160.3.9.38 — SMB destination password at-rest encryption.
#
# BEFORE this patch the SMB password for LAN backup destinations was
# stored plaintext on `bk_destinations.password`, projected out of API
# responses but readable at rest to anyone with Mongo access, and
# copied verbatim into every backup snapshot ZIP. That is
# credentials-at-rest exposure — worse when the operator (as in the
# 2026-08-03 Paneltec deployment) uses their own app-admin
# credentials for the SMB share.
#
# This block adds Fernet AES-128-CBC + HMAC symmetric encryption. The
# key comes from env var `BACKUP_DEST_ENC_KEY` (32-byte urlsafe
# base64, mint via `Fernet.generate_key()`). Ciphertext lives on
# `bk_destinations.password_encrypted`. `password_set` remains the
# public boolean the UI reads. The GET endpoints continue to project
# BOTH secret fields out of responses. `agent/pending` decrypts at
# read time so the LAN agent contract is unchanged — it still sees a
# `password` string field.
#
# Fail-fast import-time guard: if the env var is missing AND
# `BACKUP_DEST_ENC_KEY_ALLOW_MISSING != "1"`, log a clear message and
# leave the module in degraded mode (writes will 500, reads still
# work). Existing tests that don't touch the destinations endpoint
# continue to run.
# ─────────────────────────────────────────────────────────────

_ENC_KEY_ENV = "BACKUP_DEST_ENC_KEY"
_DEGRADED_MSG = (
    "BACKUP_DEST_ENC_KEY missing — destination-password writes will 500. "
    "Mint a key with `python -c 'from cryptography.fernet import Fernet; "
    "print(Fernet.generate_key().decode())'` and add it to backend/.env."
)

try:
    _ENC_RAW = os.environ.get(_ENC_KEY_ENV, "").strip()
    if _ENC_RAW:
        _FERNET: Optional[Fernet] = Fernet(_ENC_RAW.encode("utf-8"))
    elif os.environ.get("BACKUP_DEST_ENC_KEY_ALLOW_MISSING") == "1":
        _FERNET = None
        logger.warning("[v38] %s (degraded-mode allow flag set)", _DEGRADED_MSG)
    else:
        _FERNET = None
        logger.error("[v38] %s", _DEGRADED_MSG)
except Exception as e:
    _FERNET = None
    logger.exception("[v38] Fernet init failed: %s", e)


def _encrypt_dest_password(plaintext: str) -> str:
    """Return Fernet ciphertext. Raises 500-mapped RuntimeError if the
    module is running degraded (missing/invalid key)."""
    if not _FERNET:
        raise RuntimeError("destination-password encryption unavailable — "
                           "BACKUP_DEST_ENC_KEY not configured")
    return _FERNET.encrypt(plaintext.encode("utf-8")).decode("ascii")


def _decrypt_dest_password(ciphertext: str) -> str:
    """Inverse of _encrypt_dest_password. Raises `InvalidToken` on
    tamper/corruption — callers must decide 500 vs skip-and-log."""
    if not _FERNET:
        raise RuntimeError("destination-password decryption unavailable — "
                           "BACKUP_DEST_ENC_KEY not configured")
    return _FERNET.decrypt(ciphertext.encode("ascii")).decode("utf-8")


async def _migrate_plaintext_dest_passwords(db_) -> Dict[str, int]:
    """Walk bk_destinations, encrypt any surviving plaintext `password`
    field, move it to `password_encrypted`, unset the plaintext key.
    Idempotent — safe to re-run. Returns a summary count dict.

    Reconciliation policy: if BOTH `password` and `password_encrypted`
    exist on a doc, keep `password_encrypted` (already migrated by an
    earlier run) and simply unset the surviving plaintext key. If only
    plaintext exists, encrypt it. If neither exists, no-op."""
    if not _FERNET:
        return {"migrated": 0, "already_encrypted_unset_plaintext": 0,
                "skipped_no_key": 1}
    migrated = 0
    reconciled = 0
    async for doc in db_.bk_destinations.find(
        {"password": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "id": 1, "password": 1, "password_encrypted": 1},
    ):
        did = doc["id"]
        if doc.get("password_encrypted"):
            # Both present → keep encrypted, drop plaintext.
            await db_.bk_destinations.update_one(
                {"id": did},
                {"$unset": {"password": ""}},
            )
            reconciled += 1
        else:
            ct = _encrypt_dest_password(doc["password"])
            await db_.bk_destinations.update_one(
                {"id": did},
                {"$set": {"password_encrypted": ct, "password_set": True},
                 "$unset": {"password": ""}},
            )
            migrated += 1
    logger.info("[v38] destination password migration: migrated=%d "
                "reconciled=%d", migrated, reconciled)
    return {"migrated": migrated,
            "already_encrypted_unset_plaintext": reconciled}


# Collections we DON'T want in the snapshot — too noisy, too big, or
# can be regenerated. Kept conservative: the goal of "full snapshot"
# is recoverability, not network frugality.
#
# Paneltec Civil (Stage A / v143) widened the excludes to cover the noisy
# per-request / ephemeral collections that would otherwise bloat every
# ZIP without contributing to recoverability:
#   • session_history       – rolling audit of login/logout events
#   • email_outbox          – already retried by the mail worker
#   • comms_outbox_blocked  – Safe-Mode-captured messages; regen on next send
#   • active_signons        – QR sign-on session heartbeats (short-lived)
EXCLUDE_COLLECTIONS = {
    # Library FTS cache — derived from documents, can be rebuilt.
    "library_bm25_chunks",
    # Action-log noise (we keep a rolled-up summary instead).
    "request_log",
    # Paneltec Civil ephemeral / churn-heavy collections.
    "session_history",
    "email_outbox",
    "comms_outbox_blocked",
    "active_signons",
}


# ============================================================
# Retention policy — Grandfather-Father-Son
# ============================================================
# Defaults (operator can override via PUT /api/backup/retention):
#   keep ALL snapshots from the last N days        (default 7)
#   then ONE per day for the next N days           (default 30)
#   then ONE per week for the next N weeks         (default 26 → ~6 mo)
#   then ONE per month forever                     (configurable months
#                                                   cap, default 0 = no cap)
#
# This keeps a Hub footprint of roughly:
#   • 5 × 7 = 35 daily snapshots from the dense window
#   • 30 daily from the medium window
#   • 26 weekly
#   • ~12 monthly per year
#   ≈ ~100 snapshots × ~185 MB = ~18 GB after a full year, stable
#   thereafter (provided the configurable monthly cap stays at 0).
RETENTION_DEFAULTS = {
    "keep_all_days":    7,
    "keep_daily_days":  30,
    "keep_weekly_weeks": 26,
    "keep_monthly_months": 0,    # 0 = forever
    "enabled": True,
}


async def _get_retention_policy(db_) -> Dict[str, Any]:
    """Returns the current retention policy with defaults filled in."""
    doc = await db_.app_state.find_one(
        {"_id": "backup_retention"}, {"_id": 0},
    ) or {}
    out = dict(RETENTION_DEFAULTS)
    for k in RETENTION_DEFAULTS:
        if k in doc:
            out[k] = doc[k]
    return out


def _compute_retention_decision(
    snapshots: List[Dict[str, Any]],
    policy: Dict[str, Any],
    now: Optional[datetime] = None,
) -> Tuple[List[str], List[str], Dict[str, Any]]:
    """Pure function — given a list of snapshot rows (each with `id`
    and `created_at`) and a policy dict, returns `(keep_ids, drop_ids,
    debug)` so the same logic can power both the real prune AND a
    dry-run preview the UI shows the operator BEFORE they enable it.

    No DB writes. No GridFS calls. Stable + unit-testable.
    """
    now = now or datetime.now(timezone.utc)
    keep_all_cutoff = now - timedelta(days=policy["keep_all_days"])
    daily_cutoff = keep_all_cutoff - timedelta(days=policy["keep_daily_days"])
    weekly_cutoff = daily_cutoff - timedelta(weeks=policy["keep_weekly_weeks"])
    monthly_cap_months = policy.get("keep_monthly_months", 0)
    monthly_cutoff: Optional[datetime] = None
    if monthly_cap_months and monthly_cap_months > 0:
        monthly_cutoff = weekly_cutoff - timedelta(days=30 * monthly_cap_months)

    keep_ids: List[str] = []
    drop_ids: List[str] = []
    daily_seen: set = set()
    weekly_seen: set = set()
    monthly_seen: set = set()

    # newest first
    sorted_snaps = sorted(
        [s for s in snapshots if s.get("created_at")],
        key=lambda s: s["created_at"],
        reverse=True,
    )
    for s in sorted_snaps:
        try:
            ca = datetime.fromisoformat(s["created_at"])
        except Exception:
            keep_ids.append(s["id"])
            continue
        if ca >= keep_all_cutoff:
            keep_ids.append(s["id"])
            continue
        if ca >= daily_cutoff:
            day_key = ca.strftime("%Y-%m-%d")
            if day_key not in daily_seen:
                daily_seen.add(day_key)
                keep_ids.append(s["id"])
            else:
                drop_ids.append(s["id"])
            continue
        if ca >= weekly_cutoff:
            # ISO calendar week
            yr, wk, _ = ca.isocalendar()
            week_key = f"{yr}-W{wk:02d}"
            if week_key not in weekly_seen:
                weekly_seen.add(week_key)
                keep_ids.append(s["id"])
            else:
                drop_ids.append(s["id"])
            continue
        # Monthly tier
        if monthly_cutoff is not None and ca < monthly_cutoff:
            drop_ids.append(s["id"])
            continue
        month_key = ca.strftime("%Y-%m")
        if month_key not in monthly_seen:
            monthly_seen.add(month_key)
            keep_ids.append(s["id"])
        else:
            drop_ids.append(s["id"])
    debug = {
        "now": now.isoformat(),
        "keep_all_cutoff": keep_all_cutoff.isoformat(),
        "daily_cutoff": daily_cutoff.isoformat(),
        "weekly_cutoff": weekly_cutoff.isoformat(),
        "monthly_cutoff": monthly_cutoff.isoformat() if monthly_cutoff else None,
        "tier_counts": {
            "kept_all":     sum(1 for s in sorted_snaps
                                if datetime.fromisoformat(s["created_at"]) >= keep_all_cutoff),
            "kept_daily":   len(daily_seen),
            "kept_weekly":  len(weekly_seen),
            "kept_monthly": len(monthly_seen),
        },
    }
    return keep_ids, drop_ids, debug


async def _apply_retention_policy(db_, fs_) -> Dict[str, Any]:
    """Runs the configured retention policy ONCE. Used both by the
    daily scheduler AND by the in-line call after a fresh snapshot.
    Returns a summary the caller can log."""
    from bson import ObjectId
    policy = await _get_retention_policy(db_)
    if not policy.get("enabled", True):
        return {"ok": True, "skipped": True, "reason": "policy disabled"}
    snapshots = await db_.bk_snapshots.find(
        {}, {"_id": 0, "id": 1, "created_at": 1, "gridfs_id": 1, "size": 1},
    ).to_list(None)
    keep_ids, drop_ids, debug = _compute_retention_decision(snapshots, policy)

    # v58.13.132jh — Enforce env-driven MAX_COUNT and MAX_TOTAL_MB
    # caps on top of the GFS age tiers. Strictest wins.
    max_count = _snapshot_max_count()
    max_total_bytes = _snapshot_max_total_mb() * 1024 * 1024
    # Rebuild "kept" as a list preserving age order (newest first).
    kept_rows = sorted(
        [s for s in snapshots if s["id"] in set(keep_ids) and s.get("created_at")],
        key=lambda s: s["created_at"],
        reverse=True,
    )
    # Apply MAX_COUNT cap.
    if max_count > 0 and len(kept_rows) > max_count:
        over_by = len(kept_rows) - max_count
        for s in kept_rows[max_count:]:
            if s["id"] not in drop_ids:
                drop_ids.append(s["id"])
        kept_rows = kept_rows[:max_count]
        debug["max_count_evicted"] = over_by
        debug["max_count_cap"] = max_count
    # Apply MAX_TOTAL_MB cap — walk newest first, evict oldest that
    # push us over the budget.
    if max_total_bytes > 0:
        running = 0
        cap_evicted = 0
        new_kept: List[Dict[str, Any]] = []
        for s in kept_rows:
            sz = int(s.get("size") or 0)
            if running + sz > max_total_bytes and new_kept:
                # Push this and all remaining to drop.
                if s["id"] not in drop_ids:
                    drop_ids.append(s["id"])
                cap_evicted += 1
                continue
            running += sz
            new_kept.append(s)
        kept_rows = new_kept
        debug["max_total_mb_cap"] = _snapshot_max_total_mb()
        debug["max_total_mb_evicted"] = cap_evicted
    keep_ids = [s["id"] for s in kept_rows]

    bytes_freed = 0
    drop_id_set = set(drop_ids)
    for s in snapshots:
        if s["id"] not in drop_id_set:
            continue
        gid = s.get("gridfs_id")
        if gid:
            try:
                await fs_.delete(ObjectId(gid))
            except Exception as e:
                logger.warning("GridFS prune for %s failed: %s", s["id"], e)
        await db_.bk_snapshots.delete_one({"id": s["id"]})
        bytes_freed += int(s.get("size") or 0)
    stamp = {
        "last_run_at": _now_iso(),
        "last_run_kept": len(keep_ids),
        "last_run_dropped": len(drop_ids),
        "last_run_bytes_freed": bytes_freed,
    }
    # v58.13.53 — Belt-and-braces: after processing metadata-driven
    # deletions, sweep any GridFS blob whose metadata row has
    # already been removed. This closes the "orphan chunks" leak
    # where a prior failed `fs_.delete()` left ~400 MB stranded.
    orphans_swept, orphan_bytes = await _sweep_orphan_gridfs_blobs(db_, fs_)
    stamp["last_run_orphans_swept"] = orphans_swept
    stamp["last_run_orphan_bytes_freed"] = orphan_bytes
    # v58.13.71 — Extended ephemeral-collection sweep (failed_pdfs,
    # dryrun, bk_snapshot 90d hard cap).
    ephemeral = await _sweep_ephemeral_collections(db_, fs_)
    stamp["last_run_ephemeral"] = ephemeral
    await db_.app_state.update_one(
        {"_id": "backup_retention"},
        {"$set": stamp},
        upsert=True,
    )
    return {
        "ok": True,
        "kept": len(keep_ids),
        "dropped": len(drop_ids),
        "bytes_freed": bytes_freed,
        "orphans_swept": orphans_swept,
        "orphan_bytes_freed": orphan_bytes,
        "ephemeral": ephemeral,
        "policy": policy,
        "debug": debug,
    }


async def _sweep_orphan_gridfs_blobs(db_, fs_) -> Tuple[int, int]:
    """v58.13.53 — Root-cause fix for the disk-bloat regression.
    v58.13.58 — Tightened to a POSITIVE filter: only sweep blobs
    that positively identify as backup snapshots (filename matches
    `paneltec-snapshot-*.zip` OR metadata carries `snapshot_id`).

    Prior to v58.13.58 this helper deleted every `bk_fs.files` blob
    whose `_id` was not in `bk_snapshots.gridfs_id` — but the same
    `bk_fs` bucket is also used by `workers.py::_fs_bucket()` for
    Worker profile photos (v160.3.9.34.3 moved them there to align
    with the Simpro-ZIP writer). Result: the sweep wiped 25 worker
    photos on preview and the avatar surface 404'd. This positive-
    filter version cannot repeat that mistake — a Worker photo has
    neither the snapshot filename shape nor the `snapshot_id`
    metadata field, so it never enters the deletion set.

    Idempotent. Returns `(deleted_count, bytes_freed)`.
    """
    valid = set()
    async for r in db_.bk_snapshots.find({}, {"_id": 0, "gridfs_id": 1}):
        gid = r.get("gridfs_id")
        if gid:
            valid.add(str(gid))
    if not valid:
        # Fail-safe: never sweep with empty metadata.
        return (0, 0)
    from bson import ObjectId  # noqa: F401  (kept for parity with older callers)
    deleted = 0
    bytes_freed = 0
    # POSITIVE FILTER: only enumerate blobs that positively look like
    # backup snapshots. Anything else (worker photos, future
    # non-backup consumers of this bucket) is inherently safe.
    snapshot_query = {
        "$or": [
            {"filename": {"$regex": r"^paneltec-snapshot-.*\.zip$"}},
            {"metadata.snapshot_id": {"$exists": True}},
        ],
    }
    async for r in db_["bk_fs.files"].find(
        snapshot_query, {"_id": 1, "length": 1},
    ):
        if str(r["_id"]) in valid:
            continue
        try:
            await fs_.delete(r["_id"])
            deleted += 1
            bytes_freed += int(r.get("length") or 0)
        except Exception as e:  # noqa: BLE001
            logger.warning("orphan GridFS sweep failed for %s: %s", r["_id"], e)
    if deleted:
        logger.info(
            "v58.13.53/.58 orphan-GridFS sweep: deleted %d orphaned "
            "bk_fs backup blob(s) totalling %d bytes",
            deleted, bytes_freed,
        )
    return (deleted, bytes_freed)


# ============================================================
# v58.13.71 — Hardened ephemeral-collection sweep
# ============================================================
# Following the preview-DB disk-pressure incident, three additional
# classes of ephemeral content are pruned on every retention run:
#   1. `bulk_import_failed_pdfs.*` — GridFS blobs older than 30 days
#      for jobs no longer in `processing`/`queued` state.
#   2. `bulk_import_dryrun` — plain-collection rows older than 30 days
#      (ISO-string `at` field, sorts lexicographically for year-first).
#   3. `bk_fs.files` backup snapshots older than 90 days — enforces a
#      HARD cap on top of the Grandfather-Father-Son policy so a
#      monthly-forever policy can never bloat the DB again. Always
#      retains at least 1 recent snapshot as a boot-fresh fail-safe.
#
# TTL indexes are NOT created here — the relevant timestamp fields
# on `bulk_import_dryrun` are ISO 8601 strings, not BSON Date, so a
# native TTL index would silently never fire. GridFS `uploadDate` IS
# a BSON Date but sits on a system collection (`*.files`) that we
# don't own the schema of. A follow-up ship (tracked in PRD) will
# migrate the ISO strings to BSON Date + add real TTL indexes.
_FAILED_PDF_TTL_DAYS = 30
_DRYRUN_TTL_DAYS = 30
_BK_SNAPSHOT_HARD_CAP_DAYS = 90
# From the PRD memory — never prune blobs belonging to this bulk-import
# job even if the DB marks it failed.
_KNOWN_RUNNING_BULK_IMPORT_JOB_ID = "14433131-29a9-4fa8-9d7e-af18f86145cf"


def _iso_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


async def _sweep_ephemeral_collections(db_, fs_) -> Dict[str, int]:
    """v58.13.71 — Prune the 3 classes of transient content documented
    in the module comment above. Idempotent; every path is guarded so
    a transient DB failure inside one branch doesn't stop the others.

    Returns a dict of counters the caller can log/stamp.
    """
    from bson import ObjectId  # local import — module already imports at top
    counters = {
        "failed_pdfs_deleted": 0,
        "failed_pdfs_bytes_freed": 0,
        "dryrun_rows_deleted": 0,
        "bk_snapshots_hard_capped": 0,
        "bk_snapshots_bytes_freed": 0,
    }

    # ── 1. bulk_import_failed_pdfs GridFS (30d) ─────────────────────
    try:
        protected: set = {_KNOWN_RUNNING_BULK_IMPORT_JOB_ID}
        async for j in db_.bulk_import_jobs.find(
            {"state": {"$in": ["processing", "queued"]}},
            {"_id": 0, "id": 1},
        ):
            if j.get("id"):
                protected.add(j["id"])
        fp_bucket = AsyncIOMotorGridFSBucket(db_, bucket_name="bulk_import_failed_pdfs")
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=_FAILED_PDF_TTL_DAYS)
        # uploadDate is a native BSON Date on GridFS files. Compare naive
        # to naive (Mongo stores as UTC-naive by default via motor).
        cutoff_naive = cutoff_dt.replace(tzinfo=None)
        async for r in db_["bulk_import_failed_pdfs.files"].find(
            {"uploadDate": {"$lt": cutoff_naive}},
            {"_id": 1, "length": 1, "metadata.job_id": 1},
        ):
            job_id = (r.get("metadata") or {}).get("job_id")
            if job_id in protected:
                continue
            try:
                await fp_bucket.delete(r["_id"])
                counters["failed_pdfs_deleted"] += 1
                counters["failed_pdfs_bytes_freed"] += int(r.get("length") or 0)
            except Exception as e:  # noqa: BLE001
                logger.warning("failed_pdfs prune delete failed for %s: %s", r["_id"], e)
    except Exception as e:  # noqa: BLE001
        logger.warning("v58.13.71 failed_pdfs branch aborted: %s", e)

    # ── 2. bulk_import_dryrun (30d, ISO string) ─────────────────────
    try:
        cutoff_iso = _iso_days_ago(_DRYRUN_TTL_DAYS)
        r = await db_.bulk_import_dryrun.delete_many({"at": {"$lt": cutoff_iso}})
        counters["dryrun_rows_deleted"] = int(r.deleted_count or 0)
    except Exception as e:  # noqa: BLE001
        logger.warning("v58.13.71 dryrun branch aborted: %s", e)

    # ── 3. bk_fs backup snapshots (90d hard cap, retain ≥1 recent) ──
    try:
        # Load all snapshot rows sorted newest-first so the fail-safe
        # "always keep at least 1" invariant is trivially enforceable.
        all_snaps: List[Dict[str, Any]] = await db_.bk_snapshots.find(
            {}, {"_id": 0, "id": 1, "created_at": 1, "gridfs_id": 1, "size": 1},
        ).to_list(None)

        def _parse_created(s: Dict[str, Any]) -> Optional[datetime]:
            v = s.get("created_at")
            if not v:
                return None
            try:
                return datetime.fromisoformat(v)
            except Exception:
                return None

        sorted_snaps = sorted(
            [s for s in all_snaps if _parse_created(s) is not None],
            key=lambda s: _parse_created(s),  # type: ignore[arg-type]
            reverse=True,
        )
        if not sorted_snaps:
            pass  # nothing to prune
        else:
            newest_id = sorted_snaps[0]["id"]  # always keep this one
            cutoff_dt = datetime.now(timezone.utc) - timedelta(days=_BK_SNAPSHOT_HARD_CAP_DAYS)
            for s in sorted_snaps:
                if s["id"] == newest_id:
                    continue  # fail-safe: never drop the most recent
                ca = _parse_created(s)
                if ca is None or ca >= cutoff_dt:
                    continue
                gid = s.get("gridfs_id")
                if gid:
                    try:
                        await fs_.delete(ObjectId(gid))
                    except Exception as e:  # noqa: BLE001
                        logger.warning(
                            "bk_snapshot hard-cap GridFS delete failed "
                            "for %s: %s", s["id"], e,
                        )
                await db_.bk_snapshots.delete_one({"id": s["id"]})
                counters["bk_snapshots_hard_capped"] += 1
                counters["bk_snapshots_bytes_freed"] += int(s.get("size") or 0)
    except Exception as e:  # noqa: BLE001
        logger.warning("v58.13.71 bk_snapshot hard-cap branch aborted: %s", e)

    if any(counters.values()):
        logger.info("v58.13.71 ephemeral sweep: %s", counters)
    return counters



# ============================================================
# Models
# ============================================================
class BackupDestination(BaseModel):
    """A target the operator has configured to RECEIVE snapshots.
    For UGREEN/Synology/QNAP we store the SMB-mount info that the
    AGENT will use; the cloud backend itself never connects.

    v160.3.9.39 — new `local_agent` kind. When the LAN agent is
    running INSIDE the NAS's own Docker environment, the SMB mirror
    step is redundant (the agent's `/data` is already the target
    filesystem). For `kind="local_agent"` the destination carries
    `local_path` (default `/data`) instead of `host/share/username/
    password_encrypted`, and the agent contract switches to
    `mode: "local"` — see `agent_pending` below."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str                                      # e.g. "Office UGREEN tower"
    kind: str = "smb_lan"                          # smb_lan | local_agent | s3 | b2 | gdrive | local
    host: Optional[str] = None                     # 192.168.15.165
    share: Optional[str] = None                    # e.g. "Backups"
    path_prefix: Optional[str] = "/paneltec-hub"   # subfolder on share
    username: Optional[str] = None
    # v160.3.9.39 — target directory on the agent's own filesystem
    # when kind == "local_agent". `None` for every other kind.
    local_path: Optional[str] = None               # e.g. "/data"
    # Password is never returned to the UI after first save.
    password_set: bool = False
    enabled: bool = True
    created_at: str = Field(default_factory=_now_iso)
    last_seen_at: Optional[str] = None             # agent last polled
    last_written_at: Optional[str] = None          # agent confirmed write


class AgentRegister(BaseModel):
    """Issued once when the operator hits 'Generate install command'."""
    model_config = ConfigDict(extra="ignore")
    name: str                                      # human label (e.g. "Pi @ office")


class AgentReport(BaseModel):
    """Submitted by the agent after each successful or failed write."""
    model_config = ConfigDict(extra="ignore")
    snapshot_id: str
    destination_id: Optional[str] = None
    status: str                                    # "ok" | "fail"
    bytes_written: Optional[int] = None
    target_path: Optional[str] = None
    mdns_services: Optional[List[Dict[str, Any]]] = None   # discovered SMB
    error: Optional[str] = None
    # Disk-usage snapshot the agent reports each poll so the Hub UI
    # can show "147 GB free of 4 TB" without the operator needing to
    # SSH into the NAS. All values in bytes.
    disk_usage: Optional[Dict[str, Any]] = None
    # v160.3.9.37 — Optional second disk-usage payload, this time
    # covering the NAS TOWER itself (the SMB target the agent mirrors
    # TO). Shape mirrors `disk_usage`: `{total, used, free}` in bytes.
    # Agent code has to opt-in to reporting it (e.g. by running a
    # `statvfs` on its already-mounted `//host/share` path). Absent
    # when the agent hasn't been updated to post it — the Hub UI
    # gracefully hides the second gauge in that case.
    nas_disk_usage: Optional[Dict[str, Any]] = None


# ============================================================
# Router
# ============================================================
api_router = APIRouter(prefix="/api/backup", tags=["backup"])


# v58.13.132jh — Pod-side aggressive retention. Keeps the on-disk
# drop-zone bounded by MAX_UNSHIPPED count AND MAX_PENDING_HOURS age.
# Any pending row over either cap is evicted (row deleted + on-disk
# file unlinked). Called before every new snapshot write and by a
# periodic sweep (see server.py APScheduler wiring).
async def _enforce_pod_side_retention(db_, reason: str = "") -> Dict[str, Any]:
    max_unshipped = _lan_max_unshipped()
    max_pending_h = _lan_max_pending_hours()
    evicted_count = 0
    evicted_bytes = 0
    reasons: List[str] = []

    # Pull all rows that carry a filepath and are not yet shipped.
    pending = await db_.bk_snapshots.find(
        {"filepath": {"$ne": None}, "shipped_at": None},
        {"_id": 0, "id": 1, "filepath": 1, "created_at": 1, "size": 1},
    ).sort("created_at", 1).to_list(None)  # oldest first

    now = datetime.now(timezone.utc)

    # 1. Age-based eviction: any pending row older than MAX_PENDING_HOURS.
    still_pending: List[Dict[str, Any]] = []
    for row in pending:
        ca = row.get("created_at")
        try:
            dt = datetime.fromisoformat(str(ca).replace("Z", "+00:00")) if ca else None
        except Exception:
            dt = None
        if dt and dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age_h = (now - dt).total_seconds() / 3600 if dt else None
        if age_h is not None and age_h >= max_pending_h:
            fp = row.get("filepath")
            try:
                if fp and os.path.exists(fp):
                    evicted_bytes += os.path.getsize(fp)
                    os.unlink(fp)
            except Exception as e:  # noqa: BLE001
                logger.warning("pod_retention unlink %s failed: %s", fp, e)
            await db_.bk_snapshots.delete_one({"id": row["id"]})
            evicted_count += 1
            reasons.append(f"age>{max_pending_h}h")
            logger.warning(
                "backup.pod_retention EVICT id=%s age_h=%.1f reason=age (pi didn't collect)",
                row["id"], age_h,
            )
        else:
            still_pending.append(row)

    # 2. Count-based eviction: keep only the newest N unshipped.
    if max_unshipped > 0 and len(still_pending) > max_unshipped:
        # Oldest-first list — evict the leading (len-N) entries.
        over = still_pending[: len(still_pending) - max_unshipped]
        for row in over:
            fp = row.get("filepath")
            try:
                if fp and os.path.exists(fp):
                    evicted_bytes += os.path.getsize(fp)
                    os.unlink(fp)
            except Exception as e:  # noqa: BLE001
                logger.warning("pod_retention unlink %s failed: %s", fp, e)
            await db_.bk_snapshots.delete_one({"id": row["id"]})
            evicted_count += 1
            reasons.append(f"count>{max_unshipped}")
            logger.warning(
                "backup.pod_retention EVICT id=%s reason=count (>%d unshipped)",
                row["id"], max_unshipped,
            )

    if evicted_count:
        logger.info(
            "backup.pod_retention.done reason=%s evicted=%d bytes=%d",
            reason or "sweep", evicted_count, evicted_bytes,
        )
    return {
        "evicted": evicted_count,
        "bytes_freed": evicted_bytes,
        "reasons": reasons,
    }


def install(app, db, require_admin):
    """Mount the backup endpoints. Called from server.py."""
    global _db
    _db = db
    # GridFS bucket for snapshot ZIPs (chunked storage; sidesteps the
    # 16 MiB per-document Mongo limit).
    fs = AsyncIOMotorGridFSBucket(db, bucket_name="bk_fs")
    # Expose the bucket on app.state so background tasks in server.py
    # (e.g. the retention scheduler) can reach it without re-importing.
    app.state.bk_fs = fs

    # v58.13.53 — Defensive orphan-GridFS sweep at startup so a
    # deployment inheriting a bloated DB self-heals on first boot.
    # Idempotent and no-op when no orphans exist. Guarded so a
    # transient failure never blocks backend boot.
    @app.on_event("startup")
    async def _v58_13_53_orphan_gridfs_sweep():
        try:
            deleted, bytes_freed = await _sweep_orphan_gridfs_blobs(db, fs)
            if deleted:
                logger.info(
                    "v58.13.53 boot-time orphan-GridFS sweep: freed "
                    "%d blob(s) / %d bytes",
                    deleted, bytes_freed,
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("v58.13.53 boot-time orphan sweep failed: %s", e)

    # v160.3.9.38 — Auto-run the plaintext-password migration ONCE at
    # startup, guarded by a marker doc in `bk_migrations`. Manual
    # re-run available at `POST /api/backup/admin/migrate-destination-
    # passwords`. Wrapped in try/except so a migration blip never
    # blocks backend boot.
    @app.on_event("startup")
    async def _v38_destination_password_migration():
        try:
            marker = await db.bk_migrations.find_one(
                {"id": "v160_3_9_38_dest_password_encryption"},
                {"_id": 0, "id": 1, "completed_at": 1},
            )
            if marker and marker.get("completed_at"):
                # Migration already ran successfully. Skip silently.
                return
            if not _FERNET:
                logger.warning("[v38] Skipping startup destination-password "
                               "migration — BACKUP_DEST_ENC_KEY not set.")
                return
            summary = await _migrate_plaintext_dest_passwords(db)
            await db.bk_migrations.update_one(
                {"id": "v160_3_9_38_dest_password_encryption"},
                {"$set": {"completed_at": _now_iso(), **summary}},
                upsert=True,
            )
        except Exception as e:
            logger.exception("[v38] destination-password migration failed "
                             "at startup: %s", e)

    # ─────────────────────────────────────────────────────────
    # v160.3.9.39 — One-shot migration: convert the "Office UGREEN
    # tower" destination (id `5e6a5346-2207-409d-ab11-c702651223fa`)
    # from `smb_lan` to `local_agent`. The LAN agent is running
    # inside the NAS's own Docker environment, so the SMB mirror
    # step is redundant AND failing on "Connection refused"
    # (UGREEN SMB service off). This migration:
    #   • sets kind → "local_agent", local_path → "/data"
    #   • $unset SMB fields: host, share, username,
    #                        password_encrypted, password, password_set
    #   • clears any stale mirror-error fields
    #     (last_mirror_status, last_mirror_error) so the UI
    #     doesn't ghost the old "Connection refused" text
    #   • idempotent via a `bk_migrations` marker
    # ─────────────────────────────────────────────────────────
    _V39_LOCAL_AGENT_DEST_ID = "5e6a5346-2207-409d-ab11-c702651223fa"

    @app.on_event("startup")
    async def _v39_local_agent_destination_migration():
        try:
            marker = await db.bk_migrations.find_one(
                {"id": "v160_3_9_39_local_agent_dest_migration"},
                {"_id": 0, "id": 1, "completed_at": 1},
            )
            if marker and marker.get("completed_at"):
                return
            dest = await db.bk_destinations.find_one(
                {"id": _V39_LOCAL_AGENT_DEST_ID}, {"_id": 0, "id": 1, "kind": 1},
            )
            if not dest:
                # Nothing to migrate on this environment. Record the
                # marker so we don't keep polling every boot.
                await db.bk_migrations.update_one(
                    {"id": "v160_3_9_39_local_agent_dest_migration"},
                    {"$set": {"completed_at": _now_iso(),
                              "outcome": "target_dest_absent"}},
                    upsert=True,
                )
                return
            if dest.get("kind") == "local_agent":
                # Already migrated by a prior run.
                await db.bk_migrations.update_one(
                    {"id": "v160_3_9_39_local_agent_dest_migration"},
                    {"$set": {"completed_at": _now_iso(),
                              "outcome": "already_local_agent"}},
                    upsert=True,
                )
                return
            await db.bk_destinations.update_one(
                {"id": _V39_LOCAL_AGENT_DEST_ID},
                {
                    "$set": {
                        "kind": "local_agent",
                        "local_path": "/data",
                    },
                    "$unset": {
                        "host": "",
                        "share": "",
                        "username": "",
                        "password_encrypted": "",
                        "password": "",
                        "password_set": "",
                        # Clear any stale SMB mirror telemetry so the
                        # UI doesn't render a ghost "Connection
                        # refused" error next to a green local-mount
                        # card.
                        "last_mirror_status": "",
                        "last_mirror_error": "",
                    },
                },
            )
            await db.bk_migrations.update_one(
                {"id": "v160_3_9_39_local_agent_dest_migration"},
                {"$set": {"completed_at": _now_iso(),
                          "outcome": "converted",
                          "dest_id": _V39_LOCAL_AGENT_DEST_ID}},
                upsert=True,
            )
            logger.info("[v39] destination %s converted to local_agent "
                        "(local_path=/data)", _V39_LOCAL_AGENT_DEST_ID)
        except Exception as e:
            logger.exception("[v39] local_agent destination migration "
                             "failed at startup: %s", e)

    # v58.13.132jh — Startup announcement so ops can immediately see
    # whether the in-app backup routine is armed or short-circuited.
    @app.on_event("startup")
    async def _v58_13_132jh_backup_status_log():
        try:
            if _backups_enabled():
                logger.info(
                    "backup.status ENABLED — writing snapshots to "
                    "filesystem drop-zone at %s. Pod-side retention: "
                    "max_unshipped=%d max_pending_h=%d. Historical "
                    "caps: max_count=%d max_total_mb=%d.",
                    _lan_drop_zone(),
                    _lan_max_unshipped(), _lan_max_pending_hours(),
                    _snapshot_max_count(), _snapshot_max_total_mb(),
                )
            else:
                logger.warning(
                    "backup.status DISABLED — BACKUPS_ENABLED=false. "
                    "All snapshot writes will short-circuit. Live-data "
                    "safety net is Emergent-managed backups + PITR."
                )
        except Exception as _e:  # noqa: BLE001
            logger.warning("backup status log failed: %s", _e)

    # ------------------------------------------------------------
    # SNAPSHOT  — admin: trigger; agent: list & download.
    # ------------------------------------------------------------
    async def _do_snapshot() -> Dict[str, Any]:
        """Core snapshot routine — reusable by both the admin-triggered
        POST endpoint AND the daily scheduler. Returns the result dict
        that the HTTP endpoint serialises back to the operator."""
        # v58.13.132jh — Circuit breaker. When BACKUPS_ENABLED=false
        # (default) short-circuit at the top; every entry point
        # (POST /snapshots background task, APScheduler cron jobs,
        # startup catch-up, hourly watchdog) collapses to a warning
        # log + no-op. Live data safety net is Emergent-managed
        # backups + PITR — see /app/memory/v58_13_132jh_backup_routine
        # _externalize.md for the audit trail.
        if not _backups_enabled():
            logger.warning(
                "backup.disabled — BACKUPS_ENABLED=false; skipping "
                "snapshot. Live-data safety net is Emergent managed "
                "backups + PITR. Flip BACKUPS_ENABLED=true in "
                "backend/.env and wire an external destination "
                "(S3-compatible or mount outside /app) to re-enable."
            )
            return {"ok": False, "skipped": True,
                    "reason": "backups_disabled"}

        # v58.13.132jh — Trigger dedupe. If a writer completed <60 min
        # ago, or another writer is currently running, skip with a
        # clear log line. Boot-storm scenarios (5 fires in 10 min
        # during hot-reload cascades) now collapse to at most one
        # write per hour.
        acquired, reason = await _acquire_backup_lock(db)
        if not acquired:
            logger.warning(
                "backup.skipped reason=%s window_min=%d — no snapshot written",
                reason, _BACKUP_LOCK_WINDOW_MIN,
            )
            return {"ok": False, "skipped": True, "reason": reason}

        snap_id = str(uuid.uuid4())
        zbuf = io.BytesIO()
        included: List[str] = []
        total_docs = 0

        try:
            with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                collections = await db.list_collection_names()
                for cname in sorted(collections):
                    if cname in EXCLUDE_COLLECTIONS or cname.startswith("system."):
                        continue
                    if cname.startswith("bk_fs."):
                        continue
                    cursor = db[cname].find({}, {"_id": 0})
                    rows = await cursor.to_list(length=None)
                    z.writestr(
                        f"mongo/{cname}.json",
                        json.dumps(rows, default=str, ensure_ascii=False),
                    )
                    included.append(cname)
                    total_docs += len(rows)

                manifest = {
                    "snapshot_id": snap_id,
                    "created_at": _now_iso(),
                    "scope": "full",
                    "collections": included,
                    "total_documents": total_docs,
                    "app": "paneltec-hub",
                }
                z.writestr("manifest.json", json.dumps(manifest, indent=2))

            data = zbuf.getvalue()
            sha = hashlib.sha256(data).hexdigest()

            # v58.13.132jh — Filesystem drop-zone. Write the ZIP under
            # LAN_DELIVERY_DROP_ZONE and register a metadata-only row
            # in `bk_snapshots`. No GridFS write. Pod-side footprint
            # is bounded by _enforce_pod_side_retention() below.
            drop_zone = _lan_drop_zone()
            os.makedirs(drop_zone, exist_ok=True)
            filepath = os.path.join(drop_zone,
                                    f"paneltec-snapshot-{snap_id}.zip")
            # Before writing this snapshot, enforce the "≤ MAX_UNSHIPPED
            # pending" cap by evicting the oldest pending file(s).
            evicted = await _enforce_pod_side_retention(db, reason="pre-write")
            if evicted:
                logger.warning(
                    "backup.pod_retention pre-write evicted=%s (max_unshipped=%d)",
                    evicted, _lan_max_unshipped(),
                )

            # Atomic write: staging .part → rename so a partial write
            # never confuses the Pi.
            staging = filepath + ".part"
            with open(staging, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(staging, filepath)

            await db.bk_snapshots.insert_one({
                "id": snap_id,
                "created_at": _now_iso(),
                "size": len(data),
                "sha256": sha,
                "collections": included,
                "total_documents": total_docs,
                # v58.13.132jh — new fields for filesystem drop-zone.
                # `gridfs_id` is intentionally absent — the download
                # endpoint prefers `filepath` and only falls back to
                # `gridfs_id` for legacy pre-.132jh rows.
                "filepath": filepath,
                "storage": "filesystem",
                "shipped_at": None,
                "nas_path": None,
                "status": "ready",
            })

            # Apply retention policy (grandfather-father-son) for
            # historical/metadata pruning + the size/count caps we
            # added in .132jh. This does NOT clean up on-disk ZIPs
            # for shipped snapshots — the /agent/report path does
            # that immediately after a successful ship.
            await _apply_retention_policy(db, fs)

            await _release_backup_lock(db, ok=True)
            return {"ok": True, "snapshot_id": snap_id,
                    "size": len(data), "sha256": sha,
                    "documents": total_docs,
                    "filepath": filepath}
        except Exception:
            # Release the lock on failure without stamping last_run_at
            # so an immediate retry is allowed. Re-raise so the caller
            # (guarded_snapshot's retry loop / direct HTTP path) sees
            # the original error.
            await _release_backup_lock(db, ok=False)
            raise

    # Paneltec Civil (v143) — expose `_do_snapshot` on app.state so the
    # AsyncIOScheduler in server.py can register it as a cron job without
    # re-importing this module (which would rebuild the router).
    app.state.bk_do_snapshot = _do_snapshot

    # v58.13.132gq — In-flight guard so multiple button clicks don't
    # spawn parallel snapshots (each ~313 MB / 100k docs — parallel
    # runs would double the GridFS write pressure and can race the
    # prune step). Backed by `app.state` so the flag survives across
    # requests handled by the same worker.
    app.state.bk_snapshot_running = False

    async def _guarded_snapshot(placeholder_id: str | None = None):
        if getattr(app.state, "bk_snapshot_running", False):
            return
        app.state.bk_snapshot_running = True
        import logging as _logging
        _log = _logging.getLogger("backup")
        # v58.13.132gr — Retry loop for transient
        # `pymongo.errors.AutoReconnect: [Errno 104] Connection reset
        # by peer` errors mid-snapshot. Observed on 300+ MB dumps
        # against the local Mongo when the network briefly hiccups
        # partway through the streaming write. Up to 3 attempts with
        # a 5 s backoff — subsequent attempts run against a fresh
        # Motor client (Motor auto-reconnects on the next await).
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                await _do_snapshot()
                last_err = None
                break
            except Exception as e:
                last_err = e
                _log.warning(
                    "background snapshot attempt %d failed: %s",
                    attempt + 1, e,
                )
                if attempt < 2:
                    import asyncio as _asyncio
                    await _asyncio.sleep(5)
        try:
            if last_err is None and placeholder_id:
                # Success — drop the placeholder row so the UI shows
                # only the ready snapshot on its next poll.
                try:
                    await db.bk_snapshots.delete_one({"id": placeholder_id})
                except Exception:
                    pass
            elif last_err is not None:
                _log.exception(
                    "background snapshot failed after 3 attempts: %s",
                    last_err,
                )
                if placeholder_id:
                    try:
                        await db.bk_snapshots.update_one(
                            {"id": placeholder_id},
                            {"$set": {"status": "failed",
                                      "error": str(last_err)[:500],
                                      "failed_at": _now_iso()}},
                        )
                    except Exception:
                        pass
        finally:
            app.state.bk_snapshot_running = False

    @api_router.post("/snapshots", dependencies=[Depends(require_admin)])
    async def create_snapshot(bg: BackgroundTasks):
        """Kick off a full snapshot ZIP in the background.

        v58.13.132gq — Previously ran inline (~30–90s for a 300 MB
        pod), which timed out the Cloudflare ingress at 30s and
        surfaced to Stephen as `HTTP 502` on the Backup tab. Now we
        return immediately; the manifest row appears in
        `GET /snapshots` once the writer finishes. The
        `app.state.bk_snapshot_running` guard prevents parallel runs.

        v58.13.132gr — Insert a `status: 'queued'` placeholder row in
        `bk_snapshots` at click time so the UI can render the
        in-progress state immediately (before the writer finishes
        ~30–60 s later). `_guarded_snapshot` deletes the placeholder
        when the real snapshot lands or flips it to `status: 'failed'`
        if the writer errors out. Placeholder ids are returned to the
        FE so a poller can watch the specific snapshot instead of
        just "any new row".

        v58.13.132gw — Pre-flight disk guard. Snapshots write a
        temporary ZIP under `/app` before streaming into GridFS, so
        a full-disk pod either truncates the ZIP mid-write or blows
        up the writer with `[Errno 28] No space left on device`.
        Return HTTP 507 (Insufficient Storage) if `/app` free-space
        drops below 10 % so the FE surfaces a clean error instead
        of a truncated snapshot manifest + a 502 from the writer.
        """
        # v58.13.132gw — Pre-flight disk guard.
        # v58.13.132jh — Circuit breaker: return 503 when backups
        # are disabled so the FE surfaces a clear "disabled" state
        # instead of a queued placeholder that never lands.
        if not _backups_enabled():
            raise HTTPException(
                status_code=503,
                detail=(
                    "Backups are disabled on this environment "
                    "(BACKUPS_ENABLED=false). Live data is protected "
                    "by Emergent-managed backups + PITR. To re-enable "
                    "the in-app snapshot routine, wire an external "
                    "destination (S3-compatible or a mount outside "
                    "/app) and set BACKUPS_ENABLED=true in "
                    "backend/.env."
                ),
            )
        try:
            import shutil as _shutil
            usage = _shutil.disk_usage("/app")
            free_pct = (usage.free / usage.total) * 100 if usage.total else 100
            if free_pct < 10:
                raise HTTPException(
                    status_code=507,
                    detail=(
                        f"Insufficient disk space on /app: "
                        f"{free_pct:.1f}% free "
                        f"({usage.free // (1024 * 1024)} MB / "
                        f"{usage.total // (1024 * 1024)} MB). "
                        "Free at least 10% before triggering a snapshot. "
                        "Common cleanups: purge old backups, clear "
                        "frontend/node_modules/.cache, rotate application logs."
                    ),
                )
        except HTTPException:
            raise
        except Exception as _disk_err:  # noqa: BLE001
            # If the disk-usage probe itself fails (unlikely — this
            # is a stdlib call), fall through and let the snapshot
            # run; better to attempt the backup than to hard-fail on
            # a probing error.
            logger.warning("disk-usage probe failed: %s", _disk_err)

        if getattr(app.state, "bk_snapshot_running", False):
            # Return the currently-running placeholder if one is on
            # disk so the FE can watch it instead of firing blind.
            existing = await db.bk_snapshots.find_one(
                {"status": "queued"},
                sort=[("created_at", -1)],
                projection={"_id": 0, "id": 1, "created_at": 1},
            )
            return {"ok": True, "queued": False,
                    "existing_queued_id": (existing or {}).get("id"),
                    "message": "A snapshot is already running — check "
                               "the snapshots list in ~30 seconds."}

        import uuid as _uuid
        placeholder_id = str(_uuid.uuid4())
        now = _now_iso()
        try:
            await db.bk_snapshots.insert_one({
                "id": placeholder_id,
                "created_at": now,
                "queued_at": now,
                "status": "queued",
                "size": 0,
                "total_documents": 0,
                "collections": [],
                "gridfs_id": None,
            })
        except Exception:
            # If the placeholder write fails, still queue the
            # background task — the user will just miss the
            # in-progress row and see the final ready row appear.
            placeholder_id = None

        bg.add_task(_guarded_snapshot, placeholder_id)
        return {"ok": True, "queued": True,
                "queued_id": placeholder_id,
                "message": "Snapshot queued — refresh the snapshots list "
                           "in ~60 seconds."}

    # Exposed for the scheduler (server.py) to call directly so the
    # daily auto-snapshot doesn't need a fake HTTP request + admin
    # session to fire.
    app.state.create_paneltec_snapshot = _do_snapshot


    @api_router.get("/snapshots", dependencies=[Depends(require_admin)])
    async def list_snapshots(limit: int = 50):
        rows = await db.bk_snapshots.find(
            {}, {"_id": 0}
        ).sort("created_at", -1).limit(limit).to_list(limit)
        return rows

    # ------------------------------------------------------------
    # SCHEDULE — read-only view of the live APScheduler cron jobs
    # that server.py registers on startup (backup_snapshot_6h +
    # backup_snapshot_cob). We introspect the running scheduler
    # rather than hard-coding cron strings so the panel stays
    # accurate if the cadence is ever changed in server.py.
    # ------------------------------------------------------------
    @api_router.get("/schedule", dependencies=[Depends(require_admin)])
    async def get_schedule():
        scheduler = getattr(app.state, "scheduler", None)
        job_ids = ["backup_snapshot_6h", "backup_snapshot_cob"]
        jobs_out: List[Dict[str, Any]] = []
        for jid in job_ids:
            entry: Dict[str, Any] = {
                "id": jid,
                "cron": None,
                "timezone": None,
                "next_run_at": None,
            }
            try:
                job = scheduler.get_job(jid) if scheduler else None
            except Exception:
                job = None
            if job is not None:
                trg = job.trigger
                # Build a human-readable cron string from the non-default
                # trigger fields. APScheduler's CronTrigger.fields carries
                # `is_default=True` on any field left at "*".
                try:
                    parts = []
                    for f in getattr(trg, "fields", []) or []:
                        if getattr(f, "is_default", False):
                            continue
                        parts.append(f"{f.name}={f}")
                    entry["cron"] = ", ".join(parts) if parts else None
                except Exception:
                    entry["cron"] = None
                try:
                    tz = getattr(trg, "timezone", None)
                    entry["timezone"] = str(tz) if tz else None
                except Exception:
                    entry["timezone"] = None
                nrt = getattr(job, "next_run_time", None)
                entry["next_run_at"] = nrt.isoformat() if nrt else None
            jobs_out.append(entry)

        # Retention last-run timestamp lives in the same app_state doc the
        # retention endpoints write to.
        doc = await db.app_state.find_one(
            {"_id": "backup_retention"}, {"_id": 0, "last_run_at": 1},
        ) or {}
        return {
            "jobs": jobs_out,
            "retention_last_run_at": doc.get("last_run_at"),
        }

    # ============================================================
    # v155b · /summary — traffic-light aggregator for the Backup
    # admin hero card.
    #
    # Composes read-only over bk_snapshots, bk_agent_logs, bk_agents,
    # bk_destinations and the live APScheduler `backup_snapshot_6h`
    # job. No schema changes, no new writes. Returns a single roll-up
    # the client uses to render the hero card + decide whether to
    # show the (future v155c) setup wizard.
    # ============================================================
    @api_router.get("/summary", dependencies=[Depends(require_admin)])
    async def get_summary():
        now = datetime.now(timezone.utc)

        def _parse(iso):
            if not iso: return None
            if isinstance(iso, datetime):
                return iso if iso.tzinfo else iso.replace(tzinfo=timezone.utc)
            try:
                s = str(iso).replace("Z", "+00:00")
                d = datetime.fromisoformat(s)
                return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
            except Exception:
                return None

        def _age_h(iso):
            d = _parse(iso)
            if not d: return None
            return (now - d).total_seconds() / 3600.0

        # ---- Latest snapshot on the Hub
        snap = await db.bk_snapshots.find_one(
            {}, {"_id": 0, "id": 1, "created_at": 1, "size": 1, "total_documents": 1},
            sort=[("created_at", -1)],
        )

        # ---- Latest successful LAN delivery
        # v58.13.132kw — Filter out heartbeat log rows so we don't
        # confuse a "container is alive" ping with an actual snapshot
        # landing on the NAS. Mirrors the filter already in
        # `/api/backup/lan-status` (see line ~2647):
        #   • `snapshot_id != "none"` — heartbeat rows use "none"
        #   • `bytes_written >= 1 MB` — a real snapshot ZIP is
        #     150-200 MB; anything under 1 MB is almost certainly
        #     a diagnostic or a truncated write.
        delivery = await db.bk_agent_logs.find_one(
            {"status": "ok",
             "snapshot_id": {"$ne": "none"},
             "bytes_written": {"$gte": 1_000_000}},
            {"_id": 0}, sort=[("received_at", -1)],
        )

        # ---- Agents + destinations
        agents = await db.bk_agents.find(
            {}, {"_id": 0, "token_hash": 0},
        ).to_list(50)
        dests = await db.bk_destinations.find(
            {}, {"_id": 0, "password": 0},
        ).to_list(50)

        # ---- Enrich last_delivery with dest_name + agent_name
        last_delivery_out = None
        if delivery:
            dest_name = None
            if delivery.get("destination_id"):
                d = next((x for x in dests if x.get("id") == delivery["destination_id"]), None)
                dest_name = d.get("name") if d else None
            # v155b.1 — fallback: if the agent report didn't carry a
            # destination_id (legacy agents pre-v155b), but the tenant
            # has exactly one enabled destination, attribute the
            # delivery to it. Makes the hero card read cleanly.
            if not dest_name:
                enabled = [x for x in dests if x.get("enabled")]
                if len(enabled) == 1:
                    dest_name = enabled[0].get("name")
            agent_name = None
            if delivery.get("agent_id"):
                a = next((x for x in agents if x.get("id") == delivery["agent_id"]), None)
                agent_name = a.get("name") if a else None
            last_delivery_out = {
                "received_at": delivery.get("received_at"),
                "bytes_written": delivery.get("bytes_written"),
                "target_path": delivery.get("target_path"),
                "dest_name": dest_name,
                "agent_name": agent_name,
            }

        # ---- Next scheduled snapshot
        next_snapshot_at = None
        scheduler = getattr(app.state, "scheduler", None)
        try:
            job = scheduler.get_job("backup_snapshot_6h") if scheduler else None
            nrt = getattr(job, "next_run_time", None) if job else None
            if nrt:
                next_snapshot_at = nrt.isoformat()
        except Exception:
            next_snapshot_at = None

        # ---- Setup completeness
        setup = {
            "destination_configured": any(d.get("enabled") for d in dests),
            "agent_registered": len(agents) > 0,
            "agent_first_seen": any(a.get("first_seen_at") for a in agents),
            "first_delivery_ok": delivery is not None,
        }
        setup["complete"] = all(setup.values())

        # ---- Traffic-light health (v58.13.132kw — delivery-centric)
        #
        # The pill previously flipped to `down` whenever the LOCAL
        # snapshot was >25h old, even if the LAN agent → NAS delivery
        # pipeline was healthy. That misled operators: on 2026-09-21/22
        # the local Hub snapshot got stuck (see `.132ks` reclaim
        # investigation) but the last delivery to Office UGREEN tower
        # was still fresh — the pill screamed "DOWN" while the data
        # itself was safe.
        #
        # New rule: **delivery age is the source of truth**. Snapshot
        # age is displayed but demoted to a secondary metric that
        # never triggers `down` on its own.
        #
        # Thresholds:
        #   • ok (green)     — last delivery <  DELIVERY_ATTENTION_H (8h)
        #   • attention (amber) — 8h <= delivery age < DELIVERY_DOWN_H (24h)
        #   • down (red)     — delivery age >= 24h OR agent silent >30 min
        #                      OR heartbeat missing entirely
        #   • setup          — one of the four setup checks incomplete
        DELIVERY_ATTENTION_H = 8.0     # amber threshold
        DELIVERY_DOWN_H      = 24.0    # red threshold
        AGENT_SILENT_H       = 25.0    # unchanged — matches prior "agent silent" behaviour
        snap_age_h = _age_h(snap.get("created_at")) if snap else None
        del_age_h  = _age_h(delivery.get("received_at")) if delivery else None

        def _agent_silent(a):
            if a.get("last_seen_at") is None:
                return True   # never checked in
            age = _age_h(a.get("last_seen_at"))
            return age is not None and age > AGENT_SILENT_H
        any_silent = agents and any(_agent_silent(a) for a in agents)

        # Helper to compose "last snapshot X — for context only" tails.
        def _snap_tail():
            if snap_age_h is None:
                return ""
            return f" Last local snapshot: {snap_age_h:.1f}h ago (this widget reflects delivery health, not snapshot cadence)."

        if not setup["complete"]:
            health, why = "setup", "Backup setup is incomplete."
        elif del_age_h is None:
            # No delivery ever recorded — genuine outage.
            health = "down"
            why = ("No LAN delivery has ever landed on the NAS. Check the "
                   "LAN agent and its destination configuration."
                   + _snap_tail())
        elif del_age_h >= DELIVERY_DOWN_H or any_silent:
            reasons = []
            if del_age_h >= DELIVERY_DOWN_H:
                reasons.append(f"last delivery is {del_age_h:.1f}h old (threshold {DELIVERY_DOWN_H:.0f}h)")
            if any_silent:
                silent = [a.get("name") or "agent" for a in agents if _agent_silent(a)]
                reasons.append(f"agent silent: {', '.join(silent)}")
            health = "down"
            # If BOTH pipelines are stale, surface both ages on the
            # first line so ops know the outage is real end-to-end.
            if snap_age_h is not None and snap_age_h >= DELIVERY_DOWN_H:
                why = (f"Both delivery ({del_age_h:.1f}h) and local snapshot "
                       f"({snap_age_h:.1f}h) are stale — check LAN agent + backend. "
                       + "; ".join(reasons) + ".")
            else:
                why = "Down because " + "; ".join(reasons) + "." + _snap_tail()
        elif del_age_h >= DELIVERY_ATTENTION_H:
            health = "attention"
            why = (f"Last delivery is {del_age_h:.1f}h old — approaching the "
                   f"{DELIVERY_DOWN_H:.0f}h down threshold." + _snap_tail())
        else:
            health = "healthy"
            # v58.13.132kw — Reference the actual destination in the OK
            # copy so the operator can see WHERE the data landed at a
            # glance, per the user's brief.
            dest_tag = ""
            if last_delivery_out and last_delivery_out.get("dest_name"):
                dest_tag = f" → {last_delivery_out['dest_name']}"
            why = (f"Backup pipeline OK — data delivered to NAS{dest_tag} "
                   f"{del_age_h:.1f}h ago." + _snap_tail())

        return {
            "health": health,
            "health_reason": why,
            "last_snapshot": snap,
            "last_delivery": last_delivery_out,
            "next_snapshot_at": next_snapshot_at,
            "setup": setup,
            "agent_count": len(agents),
            "destination_count": len(dests),
        }


    @api_router.get("/retention", dependencies=[Depends(require_admin)])
    async def get_retention():
        """Returns current retention policy + last-run telemetry so the
        Backup tab can render the card with timestamps + freed-bytes."""
        policy = await _get_retention_policy(db)
        doc = await db.app_state.find_one(
            {"_id": "backup_retention"}, {"_id": 0},
        ) or {}
        return {
            **policy,
            "last_run_at": doc.get("last_run_at"),
            "last_run_kept": doc.get("last_run_kept"),
            "last_run_dropped": doc.get("last_run_dropped"),
            "last_run_bytes_freed": doc.get("last_run_bytes_freed"),
        }

    @api_router.put("/retention", dependencies=[Depends(require_admin)])
    async def set_retention(payload: Dict[str, Any]):
        """Update retention policy. Validates numeric ranges; the
        defaults (7/30/26/0) are restored if a key isn't supplied."""
        update: Dict[str, Any] = {}
        clamps = {
            "keep_all_days":      (0, 90),
            "keep_daily_days":    (0, 365),
            "keep_weekly_weeks":  (0, 260),
            "keep_monthly_months": (0, 600),
        }
        for k, (lo, hi) in clamps.items():
            if k in payload:
                try:
                    v = int(payload[k])
                except (TypeError, ValueError):
                    raise HTTPException(400, f"{k} must be an integer")
                if v < lo or v > hi:
                    raise HTTPException(400, f"{k} must be in [{lo}, {hi}]")
                update[k] = v
        if "enabled" in payload:
            update["enabled"] = bool(payload["enabled"])
        if update:
            update["updated_at"] = _now_iso()
            await db.app_state.update_one(
                {"_id": "backup_retention"},
                {"$set": update}, upsert=True,
            )
        return await get_retention()

    @api_router.get("/retention/preview",
                    dependencies=[Depends(require_admin)])
    async def retention_preview():
        """Dry-run: returns the IDs the current policy would KEEP vs
        DROP, with per-tier counts. The UI uses this to show the
        operator the impact BEFORE they enable a tighter policy."""
        policy = await _get_retention_policy(db)
        snapshots = await db.bk_snapshots.find(
            {}, {"_id": 0, "id": 1, "created_at": 1, "size": 1},
        ).to_list(None)
        keep_ids, drop_ids, debug = _compute_retention_decision(
            snapshots, policy,
        )
        bytes_to_free = sum(int(s.get("size") or 0)
                            for s in snapshots if s["id"] in drop_ids)
        # Also include per-snapshot decisions sorted newest-first so
        # the UI can render a small "kept/dropped" pill per row.
        decisions = []
        keep_set = set(keep_ids)
        for s in sorted(snapshots, key=lambda x: x.get("created_at", ""),
                        reverse=True):
            decisions.append({
                "id": s["id"],
                "created_at": s.get("created_at"),
                "size": s.get("size"),
                "verdict": "keep" if s["id"] in keep_set else "drop",
            })
        return {
            "policy": policy,
            "total": len(snapshots),
            "kept": len(keep_ids),
            "dropped": len(drop_ids),
            "bytes_to_free": bytes_to_free,
            "tier_counts": debug["tier_counts"],
            "cutoffs": {
                "keep_all_cutoff": debug["keep_all_cutoff"],
                "daily_cutoff": debug["daily_cutoff"],
                "weekly_cutoff": debug["weekly_cutoff"],
                "monthly_cutoff": debug["monthly_cutoff"],
            },
            "decisions": decisions,
        }

    @api_router.post("/retention/run",
                     dependencies=[Depends(require_admin)])
    async def retention_run_now():
        """Manually trigger the retention sweep. Useful right after the
        operator tightens the policy and wants to apply it immediately
        instead of waiting for the daily scheduler."""
        return await _apply_retention_policy(db, fs)

    @api_router.get("/snapshots/{snap_id}/data")
    async def download_snapshot(snap_id: str,
                                authorization: Optional[str] = Header(None),
                                token: Optional[str] = Query(None)):
        """Either:
        * Authenticated admin (Bearer token from the Hub UI) — manual
          "Download Snapshot" button in Settings.
        * A registered agent (presents X-Agent-Token via Authorization:
          `Agent <token>` or ?token=).
        Both paths hit the same data."""
        agent = await _resolve_agent(authorization, token)
        if not agent:
            # Admin auth via header OR ?token= query param so a plain
            # `<a href>` download link works without a fetch dance. We
            # pass the query token through Authorization-style verify.
            ok, _ = await verify_bearer_token(db, authorization)
            if not ok and token:
                ok, _ = await verify_bearer_token(db, f"Bearer {token}")
            if not ok:
                raise HTTPException(401, "auth required")
        snap = await db.bk_snapshots.find_one({"id": snap_id})
        if not snap:
            raise HTTPException(404, "snapshot not found")

        # v58.13.132jh — Prefer filesystem drop-zone. GridFS fallback
        # kept for legacy pre-.132jh rows (which no longer exist after
        # the one-shot purge, but the branch is cheap insurance in
        # case a restore repopulates them).
        filepath = snap.get("filepath")
        if filepath and os.path.exists(filepath):
            async def _stream_fs():
                # Read in 1 MiB chunks so we don't materialize a 400 MB
                # bytes object in memory.
                with open(filepath, "rb") as f:
                    while True:
                        chunk = f.read(1024 * 1024)
                        if not chunk:
                            break
                        yield chunk
            return StreamingResponse(
                _stream_fs(),
                media_type="application/zip",
                headers={
                    "Content-Disposition": f'attachment; filename="paneltec-snapshot-{snap_id}.zip"',
                    "X-Snapshot-SHA256": snap.get("sha256") or "",
                    "Content-Length": str(snap.get("size") or 0),
                    "X-Snapshot-Storage": "filesystem",
                },
            )

        # Legacy GridFS fallback.
        gridfs_id_str = snap.get("gridfs_id")
        if not gridfs_id_str:
            raise HTTPException(
                410,
                "snapshot payload missing (no filepath or gridfs_id)",
            )
        from bson import ObjectId
        gridfs_id = ObjectId(gridfs_id_str)

        async def _stream():
            grid_out = await fs.open_download_stream(gridfs_id)
            while True:
                chunk = await grid_out.readchunk()
                if not chunk:
                    break
                yield chunk

        return StreamingResponse(
            _stream(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="paneltec-snapshot-{snap_id}.zip"',
                # v58.13.132gr — Guard legacy rows that predate the
                # sha256/size fields.
                "X-Snapshot-SHA256": snap.get("sha256") or "",
                "Content-Length": str(snap.get("size") or 0),
                "X-Snapshot-Storage": "gridfs-legacy",
            },
        )

    # ------------------------------------------------------------
    # RESTORE  — drag-and-drop a snapshot ZIP and repopulate DB.
    # ------------------------------------------------------------
    @api_router.post("/restore", dependencies=[Depends(require_admin)])
    async def restore_from_zip(
        file: UploadFile = File(...),
        mode: str = Query("replace", pattern=r"^(replace|merge|dry_run)$"),
        confirm: str = Query("", description="Type RESTORE to confirm"),
    ):
        """Repopulate Mongo collections from an uploaded snapshot ZIP.

        modes:
          • dry_run  – open the ZIP, count rows, return diff. Writes
                       NOTHING. Default for the UI's "Preview" button.
          • replace  – drop each collection in the ZIP, then re-insert
                       (destructive). Requires confirm=RESTORE.
          • merge    – insert rows that don't exist (by `id`), update
                       rows that do. Non-destructive — keeps anything
                       in the live DB that isn't in the ZIP.

        The collections we never touch (auth_sessions, anything
        starting with `system.`, GridFS internals) are skipped even
        if they're in the ZIP, so a restore can't lock the admin
        out of their own session.
        """
        if mode != "dry_run" and confirm != "RESTORE":
            raise HTTPException(
                400,
                "Restore requires ?confirm=RESTORE — this is destructive.",
            )

        # Read the upload into memory. Snapshots cap around 200 MB
        # (see retention rules above), so we can hold it in RAM.
        body = await file.read()
        if len(body) > 500 * 1024 * 1024:
            raise HTTPException(413, "Snapshot too large for restore (>500 MB).")
        try:
            z = zipfile.ZipFile(io.BytesIO(body))
        except zipfile.BadZipFile:
            raise HTTPException(415, "Not a valid ZIP file.")

        # Sanity-check the manifest if present.
        manifest: Dict[str, Any] = {}
        if "manifest.json" in z.namelist():
            try:
                manifest = json.loads(z.read("manifest.json"))
                if manifest.get("app") and manifest["app"] != "paneltec-hub":
                    raise HTTPException(
                        415, f"Snapshot is for a different app: {manifest['app']}",
                    )
            except json.JSONDecodeError:
                manifest = {}

        # Find every mongo/<coll>.json file.
        coll_files = [n for n in z.namelist()
                      if n.startswith("mongo/") and n.endswith(".json")]
        if not coll_files:
            raise HTTPException(415, "ZIP doesn't contain mongo/<collection>.json files.")

        # Collections we always leave alone — restoring them would
        # nuke the admin's current login session or system metadata.
        DO_NOT_TOUCH = {"auth_sessions"}

        per_coll: List[Dict[str, Any]] = []
        for path in sorted(coll_files):
            cname = path[len("mongo/"):-len(".json")]
            if cname in DO_NOT_TOUCH or cname.startswith("system.") \
               or cname.startswith("bk_fs."):
                per_coll.append({"collection": cname, "status": "skipped",
                                 "reason": "protected"})
                continue
            try:
                rows = json.loads(z.read(path))
            except Exception as e:
                per_coll.append({"collection": cname, "status": "fail",
                                 "error": str(e)})
                continue
            if not isinstance(rows, list):
                per_coll.append({"collection": cname, "status": "skip",
                                 "reason": "not a list"})
                continue

            existing = await db[cname].count_documents({})
            entry: Dict[str, Any] = {
                "collection": cname,
                "rows_in_zip": len(rows),
                "rows_existing": existing,
            }

            if mode == "dry_run":
                entry["status"] = "preview"
            elif mode == "replace":
                await db[cname].delete_many({})
                if rows:
                    await db[cname].insert_many(rows)
                entry["status"] = "replaced"
                entry["rows_after"] = await db[cname].count_documents({})
            elif mode == "merge":
                inserted = updated = 0
                for r in rows:
                    rid = r.get("id")
                    if rid and await db[cname].find_one({"id": rid}, {"_id": 0}):
                        await db[cname].update_one({"id": rid}, {"$set": r})
                        updated += 1
                    else:
                        await db[cname].insert_one(r)
                        inserted += 1
                entry["status"] = "merged"
                entry["inserted"] = inserted
                entry["updated"] = updated
                entry["rows_after"] = await db[cname].count_documents({})
            per_coll.append(entry)

        # Audit row.
        if mode != "dry_run":
            await db.bk_restore_log.insert_one({
                "id": str(uuid.uuid4()),
                "ran_at": _now_iso(),
                "mode": mode,
                "filename": file.filename,
                "manifest_id": manifest.get("snapshot_id"),
                "results": per_coll,
            })

        return {
            "ok": True,
            "mode": mode,
            "collections": per_coll,
            "manifest": manifest,
        }



    # ------------------------------------------------------------
    # DESTINATIONS
    # ------------------------------------------------------------
    @api_router.get("/destinations", dependencies=[Depends(require_admin)])
    async def list_destinations():
        # v160.3.9.38 — never expose either the legacy plaintext
        # `password` field NOR the encrypted `password_encrypted`
        # blob to the UI. `password_set` is the public signal.
        rows = await db.bk_destinations.find(
            {}, {"_id": 0, "password": 0, "password_encrypted": 0}
        ).to_list(100)
        return rows

    # ─────────────────────────────────────────────────────────
    # v160.3.9.39 — validators for the new `local_agent` kind.
    # A local_agent destination bypasses the SMB mirror step (the
    # LAN agent writes to its own `/data` mount instead), so its
    # shape MUST be different from smb_lan. We reject any incoming
    # SMB field on a local_agent destination with 400 rather than
    # silently ignoring it, so future admins get a clear error
    # instead of a mysteriously-inert config field.
    # ─────────────────────────────────────────────────────────
    _SMB_ONLY_FIELDS = ("host", "share", "username")

    def _validate_local_agent_shape(payload: Dict[str, Any],
                                    password: Optional[str]) -> None:
        """Raise HTTPException(400) if a local_agent destination carries
        any SMB-only field or a password. Called from both
        POST /destinations and PUT /destinations/{did}."""
        if payload.get("kind") != "local_agent":
            return
        bad: List[str] = []
        for k in _SMB_ONLY_FIELDS:
            if payload.get(k) not in (None, ""):
                bad.append(k)
        if password:
            bad.append("password")
        if bad:
            raise HTTPException(
                400,
                "local_agent destinations must not carry SMB fields; "
                f"remove: {', '.join(bad)}",
            )
        # Default the local_path so the agent doesn't have to.
        if not payload.get("local_path"):
            payload["local_path"] = "/data"

    @api_router.post("/destinations", dependencies=[Depends(require_admin)])
    async def create_destination(d: BackupDestination,
                                 password: Optional[str] = Query(None)):
        doc = d.model_dump()
        # v160.3.9.39 — enforce local_agent shape before touching Mongo.
        _validate_local_agent_shape(doc, password)
        # v160.3.9.38 — Password is now stored encrypted at rest
        # under `password_encrypted`. The plaintext key is never
        # written. `_encrypt_dest_password()` raises RuntimeError if
        # the module is running in degraded mode (missing key) — map
        # to a 500 so the operator sees the failure immediately
        # instead of silently storing plaintext.
        if password:
            try:
                doc["password_encrypted"] = _encrypt_dest_password(password)
            except RuntimeError as e:
                raise HTTPException(500, str(e))
            doc["password_set"] = True
        await db.bk_destinations.insert_one(doc)
        doc.pop("_id", None)
        doc.pop("password", None)
        doc.pop("password_encrypted", None)
        return doc

    @api_router.put("/destinations/{did}", dependencies=[Depends(require_admin)])
    async def update_destination(did: str,
                                 d: BackupDestination,
                                 password: Optional[str] = Query(None)):
        """Partial edit for an existing destination. Password is only
        overwritten when explicitly re-entered. v160.3.9.38 — password
        is encrypted at rest under `password_encrypted`; the legacy
        plaintext key is $unset on every write path."""
        existing = await db.bk_destinations.find_one({"id": did}, {"_id": 0})
        if not existing:
            raise HTTPException(404, "destination not found")
        payload = d.model_dump()
        # v160.3.9.39 — enforce local_agent shape (rejects SMB fields
        # + password with 400 before we touch Mongo).
        _validate_local_agent_shape(payload, password)
        # Preserve immutables.
        payload["id"] = existing["id"]
        payload["created_at"] = existing.get("created_at") or _now_iso()
        # Preserve runtime telemetry written by the agent.
        payload["last_seen_at"] = existing.get("last_seen_at")
        payload["last_written_at"] = existing.get("last_written_at")
        # Preserve nas_disk_usage (v37 forward-compat field).
        if "nas_disk_usage" in existing:
            payload["nas_disk_usage"] = existing["nas_disk_usage"]
            payload["nas_disk_usage_at"] = existing.get("nas_disk_usage_at")
        if password:
            try:
                payload["password_encrypted"] = _encrypt_dest_password(password)
            except RuntimeError as e:
                raise HTTPException(500, str(e))
            payload["password_set"] = True
        else:
            # Preserve the saved encrypted blob if the operator did
            # not re-enter the password.
            if existing.get("password_encrypted"):
                payload["password_encrypted"] = existing["password_encrypted"]
            payload["password_set"] = bool(
                existing.get("password_set")
                or existing.get("password_encrypted")
            )
        # Always $unset the legacy plaintext key on any write so a
        # migration miss doesn't linger.
        await db.bk_destinations.replace_one({"id": did}, payload)
        await db.bk_destinations.update_one(
            {"id": did}, {"$unset": {"password": ""}}
        )
        payload.pop("password", None)
        payload.pop("password_encrypted", None)
        return payload

    @api_router.delete("/destinations/{did}", dependencies=[Depends(require_admin)])
    async def delete_destination(did: str):
        r = await db.bk_destinations.delete_one({"id": did})
        return {"ok": True, "deleted": r.deleted_count}

    # ------------------------------------------------------------
    # AGENTS (the small process running inside the office LAN)
    # ------------------------------------------------------------
    @api_router.post("/agents/register", dependencies=[Depends(require_admin)])
    async def register_agent(reg: AgentRegister):
        agent_id = str(uuid.uuid4())
        token = "ag_" + secrets.token_urlsafe(32)
        await db.bk_agents.insert_one({
            "id": agent_id,
            "name": reg.name,
            "token_hash": _hash_token(token),
            "created_at": _now_iso(),
            "last_seen_at": None,
            "first_seen_at": None,  # v154 — set on the first agent/pending poll
            "mdns_services": [],
        })
        return {"id": agent_id, "token": token}     # plaintext shown ONCE

    @api_router.get("/agents", dependencies=[Depends(require_admin)])
    async def list_agents():
        rows = await db.bk_agents.find(
            {}, {"_id": 0, "token_hash": 0}
        ).to_list(100)
        return rows

    @api_router.delete("/agents/{aid}", dependencies=[Depends(require_admin)])
    async def delete_agent(aid: str):
        r = await db.bk_agents.delete_one({"id": aid})
        return {"ok": True, "deleted": r.deleted_count}

    @api_router.post("/admin/migrate-destination-passwords",
                     dependencies=[Depends(require_admin)])
    async def migrate_destination_passwords_route():
        """v160.3.9.38 — Manual re-trigger for the plaintext →
        Fernet-encrypted password migration. Idempotent. Also runs
        once automatically at backend startup (guarded by a marker
        doc in `bk_migrations`)."""
        summary = await _migrate_plaintext_dest_passwords(db)
        return {"ok": True, **summary}

    # ------------------------------------------------------------
    # AGENT-FACING (no admin guard — auth via Agent token only)
    # ------------------------------------------------------------
    @api_router.get("/agent/pending")
    async def agent_pending(authorization: Optional[str] = Header(None)):
        """Agent calls this every poll. We return the next snapshot
        it should pull (if any) AND the destinations it should ship
        to."""
        agent = await _resolve_agent(authorization)
        if not agent:
            raise HTTPException(401, "agent token required")
        # v154 — stamp first_seen_at on the very first successful poll
        # so the UI can distinguish "never polled" from "polled then
        # stopped". Idempotent: only writes when currently null.
        now = _now_iso()
        set_fields: Dict[str, Any] = {"last_seen_at": now}
        if not agent.get("first_seen_at"):
            set_fields["first_seen_at"] = now
        await db.bk_agents.update_one(
            {"id": agent["id"]},
            {"$set": set_fields},
        )
        # Latest snapshot.
        latest = await db.bk_snapshots.find_one(
            {}, {"_id": 0, "data": 0}, sort=[("created_at", -1)],
        )
        # All enabled destinations + credentials (one-time leak; the
        # agent caches them locally and only re-fetches on rotation).
        # v160.3.9.38 — decrypt `password_encrypted` at read time so
        # the LAN agent still sees a `password` string field (its
        # contract is unchanged). We swallow InvalidToken per-doc so
        # one corrupt row can't blackhole every other destination —
        # log the id and skip the field, agent will just fail to
        # authenticate to that one target and surface a
        # Connection-refused / auth-error like today.
        dests = await db.bk_destinations.find(
            {"enabled": True}, {"_id": 0},
        ).to_list(100)
        for d in dests:
            # v160.3.9.39 — for `local_agent` destinations the agent
            # writes to its OWN filesystem, so we strip every SMB
            # field (defensive: they should never be present on a
            # local_agent row, but a mid-migration row might still
            # carry them) and switch the contract to `mode: "local"`
            # + `local_path`. The agent code branches on `mode`.
            if d.get("kind") == "local_agent":
                for _smb_k in ("host", "share", "username",
                               "password", "password_encrypted"):
                    d.pop(_smb_k, None)
                d["mode"] = "local"
                d.setdefault("local_path", "/data")
                continue
            ct = d.pop("password_encrypted", None)
            # Belt: even if a legacy plaintext key survived a migration
            # miss, strip it before decrypt+re-emit.
            legacy_plain = d.pop("password", None)
            if ct:
                try:
                    d["password"] = _decrypt_dest_password(ct)
                except (InvalidToken, RuntimeError) as e:
                    logger.warning("[v38] destination %s password decrypt "
                                   "failed: %s", d.get("id"), type(e).__name__)
                    d["password"] = ""
            elif legacy_plain:
                # Not migrated yet — pass through so the agent still
                # works during rollout. Startup migration should have
                # cleaned this up; log so we notice stragglers.
                logger.warning("[v38] destination %s carrying legacy "
                               "plaintext password — startup migration "
                               "did not sweep it", d.get("id"))
                d["password"] = legacy_plain
            d["mode"] = "smb"
        # v58.13.132lf — piggyback NAS ops on the poll response.
        # Agent claims up to 8 ops per poll and drains them
        # back-to-back before its next idle poll. Each op carries an
        # HMAC signature over its canonical payload; the agent MUST
        # verify before executing.
        try:
            from nas_ops_service import next_ops_for_agent
            nas_ops = await next_ops_for_agent(agent["id"], limit=8)
        except Exception as e:
            logger.warning("[nas-ops] pending pickup failed: %s", e)
            nas_ops = []
        return {
            "snapshot": latest,
            "destinations": dests,
            "agent_id": agent["id"],
            "server_time": _now_iso(),
            "nas_ops": nas_ops,
        }

    @api_router.post("/agent/report")
    async def agent_report(report: AgentReport,
                           authorization: Optional[str] = Header(None)):
        agent = await _resolve_agent(authorization)
        if not agent:
            raise HTTPException(401, "agent token required")
        # Record the run.
        await db.bk_agent_logs.insert_one({
            "id": str(uuid.uuid4()),
            "agent_id": agent["id"],
            "received_at": _now_iso(),
            **report.model_dump(),
        })
        # Update agent's mDNS cache so the UI can show "I found 3
        # SMB targets on your LAN" without the cloud needing to scan.
        agent_update: Dict[str, Any] = {"last_seen_at": _now_iso()}
        # v154 — first_seen_at defensive backfill: normally set by
        # agent/pending but this ensures even a report-only agent
        # gets stamped once.
        if not agent.get("first_seen_at"):
            agent_update["first_seen_at"] = _now_iso()
        if report.mdns_services is not None:
            agent_update["mdns_services"] = report.mdns_services
        # Latest disk usage snapshot — overwritten every poll so we
        # never accumulate. Powers the Hub's "X GB free of Y TB" gauge.
        if report.disk_usage:
            agent_update["disk_usage"] = report.disk_usage
            agent_update["disk_usage_at"] = _now_iso()
        await db.bk_agents.update_one(
            {"id": agent["id"]},
            {"$set": agent_update},
        )
        # v160.3.9.37 — Forward-compat NAS-tower disk usage.
        # Stashed on the DESTINATION (not the agent) because a single
        # agent can mirror to multiple NAS targets. Latest wins.
        if report.destination_id and report.nas_disk_usage:
            await db.bk_destinations.update_one(
                {"id": report.destination_id},
                {"$set": {
                    "nas_disk_usage":    report.nas_disk_usage,
                    "nas_disk_usage_at": _now_iso(),
                }},
            )
        # Update destination ship status.
        # v160.3.9.39 — For `local_agent` destinations, the agent
        # writes into its own `local_path`. Only bump
        # `last_written_at` when `target_path` actually starts with
        # that configured prefix — protects against a
        # mis-configured agent silently reporting "delivered" for a
        # path outside the intended target. SMB destinations keep
        # the previous behaviour (any ok report → bump).
        #
        # v58.13.132jh — Diagnosed: the Pi agent's report payload has
        # NOT been setting `destination_id` since the .132ir SMB→
        # local_agent migration on 03/08/2026. That silently pinned
        # `bk_destinations.last_written_at` to that migration date
        # and the "Last LAN Delivery" UI panel has read STALE ever
        # since — even though 120 successful ships have happened.
        # Fix: when `destination_id` is absent BUT the report is
        # `status=ok` with a `target_path` that starts with an
        # enabled `local_agent` destination's `local_path`, bump
        # that destination anyway. Correlation is safe because there
        # is only one enabled `local_agent` destination per org.
        if report.status == "ok":
            dest_row = None
            if report.destination_id:
                dest_row = await db.bk_destinations.find_one(
                    {"id": report.destination_id},
                    {"_id": 0, "id": 1, "kind": 1, "local_path": 1},
                )
            if dest_row is None and report.target_path:
                # Correlate by longest matching local_path among
                # enabled local_agent destinations.
                candidates = await db.bk_destinations.find(
                    {"enabled": True, "kind": "local_agent"},
                    {"_id": 0, "id": 1, "kind": 1, "local_path": 1},
                ).to_list(50)
                best = None
                best_len = -1
                for c in candidates:
                    lp = c.get("local_path") or "/data"
                    if report.target_path.startswith(lp) and len(lp) > best_len:
                        best = c
                        best_len = len(lp)
                if best is not None:
                    dest_row = best
                    logger.info(
                        "[.132jh] destination_id inferred by target_path: "
                        "id=%s target=%s",
                        best["id"], report.target_path,
                    )
            _should_bump = True
            if dest_row and dest_row.get("kind") == "local_agent":
                _lp = dest_row.get("local_path") or "/data"
                _tp = report.target_path or ""
                _should_bump = bool(_tp) and _tp.startswith(_lp)
                if not _should_bump:
                    logger.info(
                        "[v39] local_agent report ignored — "
                        "target_path=%r does not start with local_path=%r",
                        _tp, _lp,
                    )
            if _should_bump and dest_row:
                await db.bk_destinations.update_one(
                    {"id": dest_row["id"]},
                    {"$set": {"last_written_at": _now_iso()}},
                )

            # v58.13.132jh — Mark snapshot as shipped AND delete the
            # pod-side ZIP now that the Pi has it on the NAS. Only
            # fires on ok reports with a real bytes_written payload
            # (≥ 1 MB filters heartbeat-only rows). Idempotent — a
            # second report for the same snapshot no-ops the unlink
            # if the file's already gone.
            snap_id_reported = report.snapshot_id
            bytes_ok = (report.bytes_written or 0) >= 1_000_000
            if (snap_id_reported
                    and snap_id_reported != "none"
                    and bytes_ok):
                snap_row = await db.bk_snapshots.find_one(
                    {"id": snap_id_reported},
                    {"_id": 0, "id": 1, "filepath": 1, "shipped_at": 1},
                )
                if snap_row:
                    updates: Dict[str, Any] = {
                        "shipped_at": _now_iso(),
                        "nas_path": report.target_path,
                    }
                    # Unlink the local ZIP so /app doesn't accumulate
                    # 400 MB every 6 h. Best-effort — a missing file
                    # is fine, we just log it.
                    fp = snap_row.get("filepath")
                    if fp:
                        try:
                            if os.path.exists(fp):
                                sz = os.path.getsize(fp)
                                os.unlink(fp)
                                logger.info(
                                    "backup.local_zip.deleted id=%s "
                                    "path=%s bytes=%d (shipped to NAS)",
                                    snap_id_reported, fp, sz,
                                )
                            updates["filepath"] = None
                        except Exception as _e:  # noqa: BLE001
                            logger.warning(
                                "backup.local_zip.unlink failed id=%s "
                                "path=%s err=%s",
                                snap_id_reported, fp, _e,
                            )
                    await db.bk_snapshots.update_one(
                        {"id": snap_id_reported},
                        {"$set": updates},
                    )
        return {"ok": True}

    # v58.13.132lf — NAS op result endpoint. Called by the agent
    # after it has drained a `nas_ops` batch from
    # `/agent/pending.nas_ops`. Each entry POSTs here with the op
    # id + status ("done" | "error") + result payload (base64
    # bytes for get_file, entry list for list_dir, etc).
    @api_router.post("/agent/nas-op-result")
    async def agent_nas_op_result(
        payload: Dict[str, Any] = Body(...),
        authorization: Optional[str] = Header(None),
    ):
        agent = await _resolve_agent(authorization)
        if not agent:
            raise HTTPException(401, "agent token required")
        op_id = (payload or {}).get("op_id")
        status = (payload or {}).get("status")
        if not op_id or status not in {"done", "error"}:
            raise HTTPException(
                400, "op_id + status ('done'|'error') required",
            )
        from nas_ops_service import store_agent_result
        ok = await store_agent_result(
            op_id=op_id,
            agent_id=agent["id"],
            status=status,
            result=payload.get("result"),
            error=payload.get("error"),
        )
        if not ok:
            # Not fatal — the row may already have been marked (dup
            # POST) or TTL-expired. Log and swallow.
            logger.info(
                "[nas-ops] result for op=%s not applied (already "
                "settled or expired)", op_id,
            )
        return {"ok": True}

    @api_router.get("/agent-logs", dependencies=[Depends(require_admin)])
    async def list_agent_logs(limit: int = 100):
        rows = await db.bk_agent_logs.find(
            {}, {"_id": 0},
        ).sort("received_at", -1).limit(limit).to_list(limit)
        return rows

    @api_router.post("/snapshots/{snap_id}/verify",
                     dependencies=[Depends(require_admin)])
    async def verify_snapshot(snap_id: str):
        """Proof-of-restore — pull the snapshot ZIP back out of GridFS,
        parse every collection listed in the manifest, and confirm the
        archive is self-consistent. Never touches the live DB — just
        streams + parses bytes.

        Check contract (all dynamic; no hardcoded collection list):
          1. manifest.json present, parseable, and snapshot_id matches
          2. sha256 integrity — recompute over ZIP bytes vs stored hash
          3. one row per manifest.collections[] → `mongo/<name>.json`
             is in the ZIP, parses as a JSON list
          4. document count parity — Σ len(rows) across all mongo/*.json
             equals manifest.total_documents
          5. unexpected files (warn-only) — any `mongo/*.json` in the
             ZIP that isn't listed in manifest.collections[]

        Stamps the result onto the bk_snapshots row so the UI can
        show "Last verified: 2 min ago · OK" next to the snapshot."""
        from bson import ObjectId
        snap = await db.bk_snapshots.find_one({"id": snap_id}, {"_id": 0})
        if not snap:
            raise HTTPException(404, "snapshot not found")

        started = datetime.now(timezone.utc)
        collection_checks: List[Dict[str, Any]] = []
        manifest_check = {"name": "manifest.json", "ok": False,
                          "detail": "not loaded"}
        sha_check = {"name": "sha256 integrity", "ok": False,
                     "detail": "not computed"}
        parity_check = {"name": "document count parity", "ok": False,
                        "detail": "not computed"}
        unexpected_check = {"name": "unexpected files", "ok": True,
                            "detail": "no extra archive members"}
        manifest: Optional[Dict[str, Any]] = None

        try:
            # Pull bytes from GridFS in chunks → SHA + ZIP parse in one pass.
            grid_out = await fs.open_download_stream(ObjectId(snap["gridfs_id"]))
            sha = hashlib.sha256()
            buf = io.BytesIO()
            while True:
                chunk = await grid_out.readchunk()
                if not chunk:
                    break
                sha.update(chunk)
                buf.write(chunk)
            buf.seek(0)
            computed_sha = sha.hexdigest()
            sha_ok = (computed_sha == snap.get("sha256"))
            sha_check = {
                "name": "sha256 integrity",
                "ok": sha_ok,
                "detail": (f"{computed_sha[:16]}… matches stored hash"
                           if sha_ok
                           else f"MISMATCH: got {computed_sha[:16]}…, stored "
                                f"{(snap.get('sha256') or '')[:16]}…"),
            }

            try:
                z = zipfile.ZipFile(buf, "r")
            except zipfile.BadZipFile as bz:
                raise HTTPException(500, f"snapshot is not a valid ZIP: {bz}")

            # ---- 1. manifest.json ----
            try:
                manifest_bytes = z.read("manifest.json")
                manifest = json.loads(manifest_bytes)
                if (manifest.get("snapshot_id") == snap_id
                        and manifest.get("scope") == "full"):
                    manifest_check = {
                        "name": "manifest.json",
                        "ok": True,
                        "detail": (f"scope=full, snapshot_id matches, "
                                   f"{manifest.get('total_documents','?')} docs, "
                                   f"{len(manifest.get('collections') or [])} collections"),
                    }
                else:
                    manifest_check = {
                        "name": "manifest.json", "ok": False,
                        "detail": f"manifest fields off: {manifest}",
                    }
            except KeyError:
                manifest_check = {"name": "manifest.json", "ok": False,
                                  "detail": "missing from ZIP"}
            except Exception as me:
                manifest_check = {"name": "manifest.json", "ok": False,
                                  "detail": f"parse error: {me}"}

            manifest_collections: List[str] = (
                list(manifest.get("collections") or [])
                if isinstance(manifest, dict) else []
            )

            # ---- 3. per-collection presence + parseability ----
            observed_totals = 0
            manifest_set = set(manifest_collections)
            for cname in manifest_collections:
                check: Dict[str, Any] = {
                    "name": f"collection · {cname}",
                    "ok": False,
                    "detail": "",
                    "rows": 0,
                }
                arcname = f"mongo/{cname}.json"
                try:
                    raw = z.read(arcname)
                except KeyError:
                    check["detail"] = f"missing from ZIP ({arcname})"
                    collection_checks.append(check)
                    continue
                try:
                    rows = json.loads(raw)
                except Exception as je:
                    check["detail"] = f"JSON parse error: {je}"
                    collection_checks.append(check)
                    continue
                if not isinstance(rows, list):
                    check["detail"] = f"expected list, got {type(rows).__name__}"
                    collection_checks.append(check)
                    continue
                n = len(rows)
                check["rows"] = n
                check["ok"] = True
                check["detail"] = f"{n} row(s) present"
                observed_totals += n
                collection_checks.append(check)

            # ---- 4. document count parity ----
            expected_total = (manifest.get("total_documents")
                              if isinstance(manifest, dict) else None)
            if expected_total is None:
                parity_check = {
                    "name": "document count parity",
                    "ok": False,
                    "detail": "manifest.total_documents missing",
                }
            elif observed_totals == expected_total:
                parity_check = {
                    "name": "document count parity",
                    "ok": True,
                    "detail": (f"{observed_totals} rows across "
                               f"{len(manifest_collections)} collections "
                               f"matches manifest"),
                }
            else:
                parity_check = {
                    "name": "document count parity",
                    "ok": False,
                    "detail": (f"MISMATCH: manifest says {expected_total}, "
                               f"ZIP has {observed_totals}"),
                }

            # ---- 5. unexpected files (warn-only) ----
            extras: List[str] = []
            for name in z.namelist():
                if not name.startswith("mongo/") or not name.endswith(".json"):
                    continue
                base = name[len("mongo/"):-len(".json")]
                if base not in manifest_set:
                    extras.append(name)
            if extras:
                sample = ", ".join(extras[:5])
                more = f" (+{len(extras)-5} more)" if len(extras) > 5 else ""
                unexpected_check = {
                    "name": "unexpected files",
                    "ok": True,   # warn-only, non-blocking
                    "warn": True,
                    "detail": f"{len(extras)} extra file(s) not in manifest: {sample}{more}",
                }

            all_checks = ([manifest_check, sha_check]
                          + collection_checks
                          + [parity_check, unexpected_check])
            # `ok` is a hard pass — treats warn-only rows as passing.
            ok = all(c["ok"] for c in all_checks)
            duration_ms = int(
                (datetime.now(timezone.utc) - started).total_seconds() * 1000
            )
            result = {
                "snapshot_id": snap_id,
                "verified_at": _now_iso(),
                "duration_ms": duration_ms,
                "ok": ok,
                "checks": all_checks,
                "manifest": manifest if manifest_check["ok"] else None,
            }
            # Persist on the snapshot row so the UI can show
            # "Last verified: 2 min ago" without re-running.
            await db.bk_snapshots.update_one(
                {"id": snap_id},
                {"$set": {
                    "last_verified_at": result["verified_at"],
                    "last_verified_ok": ok,
                    "last_verified_summary": (
                        f"{sum(1 for c in all_checks if c['ok'])}/{len(all_checks)} checks "
                        f"passed in {duration_ms} ms"
                    ),
                }},
            )
            return result
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("verify_snapshot %s failed", snap_id)
            raise HTTPException(500, f"verify failed: {e}")


    @api_router.get("/lan-status", dependencies=[Depends(require_admin)])
    async def lan_status():
        """Single-call health summary for the BackupTab "Last LAN
        delivery" widget. Combines:
          • Most recent successful snapshot delivery (status=ok AND
            snapshot_id != 'none' — heartbeat reports use 'none').
          • Most recent failed attempt with its error string.
          • Most recent agent heartbeat (any report — proves the
            container is alive even if no snapshot is flowing).
          • Latest snapshot in the Hub vs. the latest one actually
            delivered so we can spot "snapshot exists but never
            shipped" gaps.
        Computes a single rollup `health` field the UI can colour:
          • ok      — delivery within last `stale_after_h` hours
          • stale   — last delivery older than `stale_after_h`
          • behind  — delivery exists, but a newer snapshot is sitting
                      undelivered in the Hub
          • never   — agent has never delivered a snapshot
          • down    — agent hasn't reported (any kind) for >30 min
        """
        STALE_AFTER_H = 8.0    # v58.13.132jh — was 6.0. Snapshot cron
                               # fires every 6 h, so 6.0 flagged EVERY
                               # inter-snapshot window as stale. 8 h
                               # gives a ~2 h grace which absorbs a
                               # missed slot without a false alarm.
        DOWN_AFTER_MIN = 30    # agent heartbeat older than this = container down

        last_delivery = await db.bk_agent_logs.find_one(
            {"status": "ok",
             "snapshot_id": {"$ne": "none"},
             # A real snapshot ZIP is ~150-200 MB; anything under
             # 1 MB is almost certainly a diagnostic heartbeat or a
             # truncated write. Filter those out so the pill never
             # reports a fake "OK" again.
             "bytes_written": {"$gte": 1_000_000}},
            {"_id": 0}, sort=[("received_at", -1)],
        )
        last_failure = await db.bk_agent_logs.find_one(
            {"status": "fail"},
            {"_id": 0}, sort=[("received_at", -1)],
        )
        last_any_report = await db.bk_agent_logs.find_one(
            {}, {"_id": 0}, sort=[("received_at", -1)],
        )
        latest_snapshot = await db.bk_snapshots.find_one(
            {}, {"_id": 0, "id": 1, "created_at": 1, "size": 1},
            sort=[("created_at", -1)],
        )
        # Pick the freshest agent heartbeat across all registered agents.
        agents = await db.bk_agents.find(
            {}, {"_id": 0, "id": 1, "name": 1, "last_seen_at": 1,
                 "disk_usage": 1, "disk_usage_at": 1},
        ).to_list(100)
        freshest_agent = None
        for a in agents:
            if not a.get("last_seen_at"):
                continue
            if (freshest_agent is None
                    or a["last_seen_at"] > freshest_agent["last_seen_at"]):
                freshest_agent = a

        # v160.3.9.37 — Fetch the enabled destinations so the FE can
        # render a "Mirror failing / Mirror OK / Never mirrored"
        # status card per destination WITHOUT extra round-trips.
        # Password_hash intentionally excluded via projection.
        destinations = await db.bk_destinations.find(
            {"enabled": True},
            {"_id": 0, "id": 1, "name": 1, "kind": 1, "host": 1,
             "share": 1, "path_prefix": 1, "last_written_at": 1,
             "nas_disk_usage": 1, "nas_disk_usage_at": 1,
             # v160.3.9.39 — expose local_path so the FE's
             # <MirrorStatusCards> can label the "DELIVERED (local
             # mount)" chip with the actual target directory.
             "local_path": 1},
        ).to_list(50)

        now = datetime.now(timezone.utc)

        def _age_min(iso: Optional[str]) -> Optional[float]:
            if not iso:
                return None
            try:
                dt = datetime.fromisoformat(iso)
                return (now - dt).total_seconds() / 60.0
            except Exception:
                return None

        delivery_age_min = _age_min(last_delivery.get("received_at")
                                    if last_delivery else None)
        report_age_min = _age_min(last_any_report.get("received_at")
                                  if last_any_report else None)
        latest_snap_age_min = _age_min(latest_snapshot.get("created_at")
                                       if latest_snapshot else None)
        agent_age_min = _age_min(freshest_agent.get("last_seen_at")
                                 if freshest_agent else None)

        # Roll-up health
        # Prefer the agent's own `last_seen_at` if it's fresher than
        # the freshest log row — orphan log rows from deleted agents
        # would otherwise wrongly flag a healthy new agent as "down".
        heartbeat_age_min = report_age_min
        if (agent_age_min is not None
                and (heartbeat_age_min is None or agent_age_min < heartbeat_age_min)):
            heartbeat_age_min = agent_age_min

        if not last_delivery:
            health = "never"
        elif heartbeat_age_min is not None and heartbeat_age_min > DOWN_AFTER_MIN:
            health = "down"
        elif (last_delivery and latest_snapshot
              and last_delivery.get("snapshot_id") != latest_snapshot.get("id")
              and latest_snap_age_min is not None
              and latest_snap_age_min > 3):
            # Hub has a newer snapshot but the agent hasn't shipped it
            # yet (we allow 3 min for the agent's poll cycle).
            health = "behind"
        elif (delivery_age_min is not None
              and delivery_age_min > STALE_AFTER_H * 60):
            health = "stale"
        else:
            health = "ok"

        return {
            "health": health,
            "stale_after_h": STALE_AFTER_H,
            "down_after_min": DOWN_AFTER_MIN,
            "now": now.isoformat(),
            "last_delivery": last_delivery,
            "last_delivery_age_min": delivery_age_min,
            "last_failure": last_failure,
            "last_any_report_at": (last_any_report or {}).get("received_at"),
            "last_any_report_age_min": report_age_min,
            "latest_snapshot": latest_snapshot,
            "latest_snapshot_age_min": latest_snap_age_min,
            "agent": freshest_agent,
            "agent_last_seen_age_min": agent_age_min,
            # Most-recently-reported disk usage from the freshest
            # agent — drives the "147 GB free of 4 TB" gauge.
            "disk_usage": (freshest_agent or {}).get("disk_usage"),
            "disk_usage_at": (freshest_agent or {}).get("disk_usage_at"),
            # v160.3.9.37 — Full destination list so the FE can render
            # a mirror-state card per SMB target (green OK / red
            # failing / amber never-mirrored). `nas_disk_usage` on
            # each entry is populated when the agent posts it —
            # otherwise absent and the FE hides the second gauge.
            "destinations": destinations,
        }


    # ------------------------------------------------------------
    # mDNS DISCOVERY  (agent caches → UI shows visible SMB targets)
    # ------------------------------------------------------------
    @api_router.get("/discovered-smb", dependencies=[Depends(require_admin)])
    async def discovered_smb():
        """UI feed: list everything the agents have seen via mDNS."""
        agents = await db.bk_agents.find(
            {}, {"_id": 0, "name": 1, "id": 1, "mdns_services": 1, "last_seen_at": 1},
        ).to_list(100)
        out: List[Dict[str, Any]] = []
        for a in agents:
            for s in (a.get("mdns_services") or []):
                out.append({**s, "via_agent": a["name"],
                            "agent_last_seen_at": a.get("last_seen_at")})
        return out

    # ------------------------------------------------------------
    # Agent installer download — single-file Python script
    # ------------------------------------------------------------
    @api_router.get("/agent/install.py", response_class=PlainTextResponse)
    async def agent_install_script(
        token: str = Query(...),
        hub_url: str = Query(...),
        authorization: Optional[str] = Header(None),
    ):
        """Returns the agent script with token + hub URL substituted.

        Auth model: accept EITHER
          * Admin Bearer auth (operator clicks "Download installer" in
            the Settings UI), OR
          * the agent's own token in the ?token= query param (so a
            Docker container can curl its own script at startup using
            just the credentials baked into its env vars).
        Both paths return identical content. The token in the URL is
        what gets embedded in the script anyway, so the script is
        bound to that one agent regardless of who fetched it."""
        # First try the agent-token shortcut so the Docker pull-on-
        # start flow works without distributing an admin session.
        agent = await _resolve_agent(authorization, token)
        if not agent:
            # Fall back to Hub admin bearer.
            ok, _ = await verify_bearer_token(db, authorization)
            if not ok:
                raise HTTPException(401, "auth required")

        script_path = os.path.join(os.path.dirname(__file__), "..", "scripts",
                                   "paneltec_backup_agent.py")
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                source = f.read()
        except FileNotFoundError:
            raise HTTPException(500, "Agent template missing on server")
        source = source.replace("__HUB_URL__", hub_url.rstrip("/"))
        source = source.replace("__AGENT_TOKEN__", token)
        return PlainTextResponse(source, media_type="text/x-python")

    @api_router.get("/agent/docker-compose.yml",
                    response_class=PlainTextResponse,
                    dependencies=[Depends(require_admin)])
    async def agent_docker_compose(
        token: str = Query(...),
        hub_url: str = Query(...),
        data_path: str = Query(
            "/volume1/docker/paneltec-backups",
            description=(
                "Local filesystem path on the NAS where snapshot ZIPs "
                "are written. Default is the verified-working UGREEN "
                "path (UGOS shared folder: docker → paneltec-backups, "
                "owner PaneltecAdmin). Override only if your NAS uses "
                "a different volume root."
            ),
        ),
    ):
        """Generate a docker-compose.yml the operator can paste into
        their UGREEN / Synology / QNAP Docker app.

        The container:
          • Pulls a slim Python base.
          • On startup curls its own agent script from /agent/install.py
            (the token query param authenticates).
          • pip installs the runtime deps.
          • Runs the agent. Snapshots land in /data → the bind-mounted
            host folder the operator picked (Personal Folder/
            paneltec-backups by default for UGREEN's PaneltecAdmin).

        We deliberately DON'T bake credentials for SMB destinations
        here — the container writes directly to the bind-mounted host
        folder, so SMB isn't even needed. (The agent's local-fallback
        path kicks in when there are no destinations configured.)
        """
        yml = f"""# Paneltec Hub — Backup agent for UGREEN / Synology / QNAP Docker
# ────────────────────────────────────────────────────────────────────────
# Generated for agent token: {token[:8]}…  (rotate from Settings → Backup)
#
# What this does
#   • Runs a tiny Python container that polls the Hub every 60 seconds.
#   • Downloads any new snapshot ZIP and writes it to {data_path}
#     on this NAS — no SMB credentials needed, the container has
#     direct filesystem access to that folder.
#   • Auto-restarts forever (the `restart: unless-stopped` flag).
#   • If anything in the bootstrap fails the container STAYS ALIVE
#     so you can read the failure in the Docker app's Log tab.
#
# How to use (UGREEN):
#   1. Make sure the folder exists:  {data_path}
#   2. Docker app → Project → Create → paste this whole file
#   3. Click Deploy
#   4. Watch the "Log" tab — within a minute you'll see the first
#      snapshot land in your backups folder.
#
# To stop / remove: Docker app → Project → tick this project → Delete.
# ────────────────────────────────────────────────────────────────────────

services:
  paneltec-backup-agent:
    image: python:3.11-slim
    container_name: paneltec-backup-agent
    restart: unless-stopped
    volumes:
      - {data_path}:/data
    environment:
      HUB_URL: "{hub_url.rstrip('/')}"
      AGENT_TOKEN: "{token}"
      PANELTEC_LOCAL_DIR: "/data"
      PANELTEC_POLL: "60"
    # NOTE: we deliberately DO NOT use `set -e` here. We want every
    # step to log clearly even if a prior step had a transient
    # failure — and we want the container to STAY UP for inspection
    # if bootstrap fails, instead of thrash-looping every 5 seconds.
    command:
      - bash
      - -c
      - |
        echo "[paneltec-agent] ============================================"
        echo "[paneltec-agent]  Paneltec Hub LAN backup agent — bootstrap"
        echo "[paneltec-agent] ============================================"
        echo "[paneltec-agent] HUB_URL          = $$HUB_URL"
        echo "[paneltec-agent] PANELTEC_LOCAL_DIR = $$PANELTEC_LOCAL_DIR"
        echo "[paneltec-agent] POLL             = $$PANELTEC_POLL s"
        echo "[paneltec-agent] AGENT_TOKEN      = $${{AGENT_TOKEN:0:8}}…"
        mkdir -p /app /data

        # 1) System packages — retry up to 3 times for transient apt blips.
        for i in 1 2 3; do
          echo "[paneltec-agent] apt install attempt $$i/3 …"
          if apt-get update -qq && apt-get install -y -qq --no-install-recommends curl ca-certificates; then
            echo "[paneltec-agent] apt OK"
            break
          fi
          echo "[paneltec-agent] apt failed — sleeping 15s before retry"
          sleep 15
        done

        # 2) Python deps — retry up to 3 times.
        for i in 1 2 3; do
          echo "[paneltec-agent] pip install attempt $$i/3 …"
          if pip install --no-cache-dir --quiet requests pysmb zeroconf; then
            echo "[paneltec-agent] pip OK"
            break
          fi
          echo "[paneltec-agent] pip failed — sleeping 15s before retry"
          sleep 15
        done
        # `requests` is required; the others are optional.
        if ! python -c "import requests" 2>/dev/null; then
          echo "[paneltec-agent] FATAL: 'requests' not installed after 3 attempts."
          echo "[paneltec-agent] Container will stay alive for log inspection."
          exec sleep infinity
        fi

        # 3) Fetch the agent script from the Hub — retry up to 5 times.
        # v58.13.132li — force a browser-shaped User-Agent so Cloudflare's
        # curl-family bot rules don't 502 the request. Default curl UA
        # (`curl/8.x`) was consistently getting blocked at the preview
        # edge; a plain-text UA carrying our identifier passes cleanly
        # and stays honest about what's calling.
        for i in 1 2 3 4 5; do
          echo "[paneltec-agent] fetch agent.py attempt $$i/5 …"
          if curl -fsSL --max-time 30 \\
               -A "Mozilla/5.0 paneltec-agent" \\
               "$$HUB_URL/api/backup/agent/install.py?token=$$AGENT_TOKEN&hub_url=$$HUB_URL" \\
               -o /app/agent.py; then
            echo "[paneltec-agent] agent.py fetched OK ($(wc -c < /app/agent.py) bytes)"
            break
          fi
          echo "[paneltec-agent] curl failed — sleeping 10s before retry"
          sleep 10
        done
        if [ ! -s /app/agent.py ]; then
          echo "[paneltec-agent] FATAL: could not fetch agent.py from $$HUB_URL"
          echo "[paneltec-agent] Possible causes:"
          echo "[paneltec-agent]   • HUB_URL is wrong (no https://, typo)"
          echo "[paneltec-agent]   • AGENT_TOKEN was rotated in the Hub UI"
          echo "[paneltec-agent]   • Hub is offline / firewalled from this NAS"
          echo "[paneltec-agent] Container will stay alive for log inspection."
          exec sleep infinity
        fi

        # 4) Run the agent. If it ever crashes, restart it after 30 s
        # without exiting the container so logs stay tail-able.
        echo "[paneltec-agent] ============================================"
        echo "[paneltec-agent]  Starting agent loop"
        echo "[paneltec-agent] ============================================"
        while true; do
          python -u /app/agent.py
          rc=$$?
          echo "[paneltec-agent] agent exited with code $$rc — restarting in 30s"
          sleep 30
        done
"""
        return PlainTextResponse(yml, media_type="text/yaml")

    app.include_router(api_router)
    logger.info("Backup service mounted at /api/backup")


async def _resolve_agent(authorization: Optional[str],
                         token_qs: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Verify an `Authorization: Agent <token>` header (or ?token=)."""
    raw = None
    if authorization:
        if authorization.startswith("Agent "):
            raw = authorization.split(" ", 1)[1]
        elif authorization.startswith("Bearer "):
            raw = authorization.split(" ", 1)[1]
    if not raw and token_qs:
        raw = token_qs
    if not raw:
        return None
    h = _hash_token(raw)
    return await _db.bk_agents.find_one({"token_hash": h}, {"_id": 0})
