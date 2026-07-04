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

from fastapi import APIRouter, Depends, HTTPException, Header, Query, UploadFile, File
from fastapi.responses import StreamingResponse, PlainTextResponse
from pydantic import BaseModel, Field, ConfigDict
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from auth_helpers import verify_bearer_token  # shared helper — breaks the
                                              # legacy `server.py` ↔
                                              # `backup_service.py` import cycle

logger = logging.getLogger("backup")

# Wired up to the same Mongo connection server.py uses. We import lazily
# inside the router setup so this file can be imported before .env loads.
_db = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_token(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


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
    bytes_freed = 0
    for s in snapshots:
        if s["id"] not in drop_ids:
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
        "policy": policy,
        "debug": debug,
    }



# ============================================================
# Models
# ============================================================
class BackupDestination(BaseModel):
    """A target the operator has configured to RECEIVE snapshots.
    For UGREEN/Synology/QNAP we store the SMB-mount info that the
    AGENT will use; the cloud backend itself never connects."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str                                      # e.g. "Office UGREEN tower"
    kind: str = "smb_lan"                          # smb_lan | s3 | b2 | gdrive | local
    host: Optional[str] = None                     # 192.168.15.165
    share: Optional[str] = None                    # e.g. "Backups"
    path_prefix: Optional[str] = "/paneltec-hub"   # subfolder on share
    username: Optional[str] = None
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


# ============================================================
# Router
# ============================================================
api_router = APIRouter(prefix="/api/backup", tags=["backup"])


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

    # ------------------------------------------------------------
    # SNAPSHOT  — admin: trigger; agent: list & download.
    # ------------------------------------------------------------
    async def _do_snapshot() -> Dict[str, Any]:
        """Core snapshot routine — reusable by both the admin-triggered
        POST endpoint AND the daily scheduler. Returns the result dict
        that the HTTP endpoint serialises back to the operator."""
        snap_id = str(uuid.uuid4())
        zbuf = io.BytesIO()
        included: List[str] = []
        total_docs = 0

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
        gridfs_id = await fs.upload_from_stream(
            f"paneltec-snapshot-{snap_id}.zip",
            io.BytesIO(data),
            metadata={"snapshot_id": snap_id, "sha256": sha},
        )
        await db.bk_snapshots.insert_one({
            "id": snap_id,
            "created_at": _now_iso(),
            "size": len(data),
            "sha256": sha,
            "collections": included,
            "total_documents": total_docs,
            "gridfs_id": str(gridfs_id),
            "status": "ready",
        })

        # Apply retention policy (grandfather-father-son):
        # keeps recent snapshots dense, older ones sparse, configurable.
        await _apply_retention_policy(db, fs)

        return {"ok": True, "snapshot_id": snap_id,
                "size": len(data), "sha256": sha,
                "documents": total_docs}

    # Paneltec Civil (v143) — expose `_do_snapshot` on app.state so the
    # AsyncIOScheduler in server.py can register it as a cron job without
    # re-importing this module (which would rebuild the router).
    app.state.bk_do_snapshot = _do_snapshot

    @api_router.post("/snapshots", dependencies=[Depends(require_admin)])
    async def create_snapshot():
        """Build a full snapshot ZIP and stash a manifest row.
        The agent will pull the bytes via GET /snapshots/{id}/data."""
        return await _do_snapshot()

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
        delivery = await db.bk_agent_logs.find_one(
            {"status": "ok"}, {"_id": 0}, sort=[("received_at", -1)],
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

        # ---- Traffic-light health
        snap_age_h = _age_h(snap.get("created_at")) if snap else None
        del_age_h  = _age_h(delivery.get("received_at")) if delivery else None

        def _agent_silent(a):
            if a.get("last_seen_at") is None:
                return True   # never checked in
            age = _age_h(a.get("last_seen_at"))
            return age is not None and age > 25.0
        any_silent = agents and any(_agent_silent(a) for a in agents)

        if not setup["complete"]:
            health, why = "setup", "Backup setup is incomplete."
        elif (snap_age_h is not None and snap_age_h > 25) \
             or (del_age_h is not None and del_age_h > 25) \
             or any_silent:
            reasons = []
            if snap_age_h is not None and snap_age_h > 25:
                reasons.append(f"last snapshot is {snap_age_h:.1f}h old")
            if del_age_h is not None and del_age_h > 25:
                reasons.append(f"last delivery is {del_age_h:.1f}h old")
            if any_silent:
                silent = [a.get("name") or "agent" for a in agents if _agent_silent(a)]
                reasons.append(f"agent silent: {', '.join(silent)}")
            health = "down"
            why = "Down because " + "; ".join(reasons) + "."
        elif (snap_age_h is not None and snap_age_h > 7) \
             or (del_age_h is not None and del_age_h > 7):
            reasons = []
            if snap_age_h is not None and snap_age_h > 7:
                reasons.append(f"last snapshot is {snap_age_h:.1f}h old")
            if del_age_h is not None and del_age_h > 7:
                reasons.append(f"last delivery is {del_age_h:.1f}h old")
            health = "attention"
            why = "Attention: " + "; ".join(reasons) + "."
        else:
            health = "healthy"
            why = "Snapshots landing on the NAS as expected."

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
        from bson import ObjectId
        gridfs_id = ObjectId(snap["gridfs_id"])

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
                "X-Snapshot-SHA256": snap["sha256"],
                "Content-Length": str(snap["size"]),
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
        rows = await db.bk_destinations.find(
            {}, {"_id": 0, "password": 0}
        ).to_list(100)
        return rows

    @api_router.post("/destinations", dependencies=[Depends(require_admin)])
    async def create_destination(d: BackupDestination,
                                 password: Optional[str] = Query(None)):
        doc = d.model_dump()
        # Stash password separately so the snapshot agent token bundle
        # can fetch it on its first poll. UI never reads it back.
        if password:
            doc["password"] = password
            doc["password_set"] = True
        await db.bk_destinations.insert_one(doc)
        doc.pop("password", None)
        return doc

    @api_router.put("/destinations/{did}", dependencies=[Depends(require_admin)])
    async def update_destination(did: str,
                                 d: BackupDestination,
                                 password: Optional[str] = Query(None)):
        """Partial edit for an existing destination. Useful when the
        operator typed the wrong SMB username/password and needs to
        correct it without deleting + re-adding the row (which would
        wipe the destination history). Password is only overwritten
        when explicitly re-entered."""
        existing = await db.bk_destinations.find_one({"id": did}, {"_id": 0})
        if not existing:
            raise HTTPException(404, "destination not found")
        payload = d.model_dump()
        # Preserve immutables.
        payload["id"] = existing["id"]
        payload["created_at"] = existing.get("created_at") or _now_iso()
        # Preserve runtime telemetry written by the agent.
        payload["last_seen_at"] = existing.get("last_seen_at")
        payload["last_written_at"] = existing.get("last_written_at")
        # Preserve password unless explicitly re-entered.
        if password:
            payload["password"] = password
            payload["password_set"] = True
        else:
            # Keep the saved password.
            if "password" in existing:
                payload["password"] = existing["password"]
            payload["password_set"] = bool(existing.get("password_set"))
        await db.bk_destinations.replace_one({"id": did}, payload)
        payload.pop("password", None)
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
        dests = await db.bk_destinations.find(
            {"enabled": True}, {"_id": 0},
        ).to_list(100)
        return {
            "snapshot": latest,
            "destinations": dests,
            "agent_id": agent["id"],
            "server_time": _now_iso(),
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
        # Update destination ship status.
        if report.destination_id and report.status == "ok":
            await db.bk_destinations.update_one(
                {"id": report.destination_id},
                {"$set": {"last_written_at": _now_iso()}},
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
        STALE_AFTER_H = 6.0    # warn after 6 h with no delivery
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
        for i in 1 2 3 4 5; do
          echo "[paneltec-agent] fetch agent.py attempt $$i/5 …"
          if curl -fsSL --max-time 30 \\
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
