"""v58.13.17 — Asset-service overnight generation cron.

Scans every non-soft-deleted `asset_service_schedules` doc with an
hours/km trigger (primary OR secondary), checks whether the asset's
current meter has crossed `next_due_value`, and if so inserts an
`asset_service_records` row (schedule_id-linked, snapshot of current
meters, task_type from the schedule). Both primary and secondary
counters advance in lockstep on any trigger fire — matches how
service shops actually operate: you don't repeat the 250 h service
when km catches up two months later.

Idempotency: natural via `last_done_value` advancement (post-fire
the schedule's next_due moves forward, so the same cycle cannot
re-trigger). Belt-and-braces via a compound-unique index
`(schedule_id, generated_by_run_id)` on `asset_service_records`.

Env-var gated OFF by default (`ASSET_SERVICE_GENERATE_CRON=1` to
enable). Manual invocation via `scripts/run_asset_service_generate_v58_13_17.py`.
"""
from __future__ import annotations
import asyncio
import logging
import os
import time
import uuid
from datetime import datetime, timezone

from db import db
from models import now_iso

log = logging.getLogger("paneltec.cron.asset_service_generate")

STALE_HOURS = int(os.environ.get("ASSET_SERVICE_GENERATE_STALE_HOURS", "48"))
GENERATED_BY = "cron:v58.13.17"


async def ensure_indexes() -> None:
    """Idempotent compound-unique index for retry/restart safety."""
    try:
        await db.asset_service_records.create_index(
            [("schedule_id", 1), ("generated_by_run_id", 1)],
            unique=True,
            partialFilterExpression={"generated_by_run_id": {"$exists": True}},
            name="uniq_schedule_generated_run",
        )
    except Exception as e:
        log.warning("index create failed (may already exist): %s", e)


def _meter_stale(updated_at: str | None) -> bool:
    if not updated_at:
        return True
    try:
        dt = datetime.fromisoformat(str(updated_at).replace(" ", "T").replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
        return age_h > STALE_HOURS
    except Exception:
        return True


def _tracks(sched: dict) -> list[tuple[str, float]]:
    """Return [(kind, next_due_value)] for every hour/km track on the
    schedule — primary + optional secondary. Calendar tracks are OUT
    of scope for this cron (existing reminder cron handles them)."""
    out = []
    kind = sched.get("interval_kind")
    ndv = sched.get("next_due_value")
    if kind in ("hours", "km") and ndv is not None:
        out.append((kind, float(ndv)))
    sec = sched.get("secondary_interval") or {}
    sec_kind = sec.get("kind")
    sec_ndv = sched.get("next_due_value_secondary")
    if sec_kind in ("hours", "km") and sec_ndv is not None:
        out.append((sec_kind, float(sec_ndv)))
    return out


def _meter_for(kind: str, asset: dict) -> tuple[float | None, str | None]:
    if kind == "hours":
        return asset.get("hours_meter"), asset.get("hours_meter_updated_at")
    return asset.get("odo_km"), asset.get("odo_km_updated_at")


async def _process_schedule(sched: dict, run_id: str, commit: bool,
                            stats: dict) -> dict | None:
    """Returns the record dict that WOULD/DID get inserted, or None."""
    asset = await db.assets.find_one(
        {"id": sched["asset_id"], "org_id": sched["org_id"], "deleted_at": None},
    )
    if not asset:
        stats["skipped_no_asset"] += 1
        return None
    tracks = _tracks(sched)
    if not tracks:
        stats["skipped_no_track"] += 1
        return None
    fired_kind = None
    for kind, threshold in tracks:
        meter, updated = _meter_for(kind, asset)
        if meter is None:
            continue
        if _meter_stale(updated):
            stats["skipped_stale"] += 1
            return None
        if float(meter) >= threshold:
            fired_kind = kind
            break
    if fired_kind is None:
        stats["not_yet_due"] += 1
        return None
    now = now_iso()
    rec = {
        "id": str(uuid.uuid4()),
        "org_id": sched["org_id"],
        "workspace_id": sched.get("workspace_id"),
        "asset_id": sched["asset_id"],
        "schedule_id": sched["id"],
        "type": sched.get("task_type") or "Service",
        "title": sched.get("task_identification") or sched.get("name") or "Scheduled service",
        "description": sched.get("description_html") or sched.get("notes") or "",
        "performed_at": None,
        "performed_by": None,
        "performed_by_name": sched.get("assigned_to_worker_name") or "",
        "technician_name": sched.get("assigned_to_worker_name") or "",
        "hours_at": asset.get("hours_meter"),
        "km_at": asset.get("odo_km"),
        "generated_by": GENERATED_BY,
        "generated_by_run_id": run_id,
        "created_at": now,
        "deleted_at": None,
    }
    if commit:
        try:
            await db.asset_service_records.insert_one(dict(rec))
        except Exception as e:
            # Compound-unique violation → already generated this cycle.
            stats["errors"] += 1
            log.warning("insert failed sid=%s: %s", sched["id"], e)
            return None
        # Advance BOTH counters in lockstep.
        set_doc = {"updated_at": now, "last_done_at": now}
        hm, km = asset.get("hours_meter"), asset.get("odo_km")
        if hm is not None:
            set_doc["last_done_value"] = float(hm)
        # Advance secondary_last_done_value if the schedule has one.
        if sched.get("secondary_interval") and km is not None:
            set_doc["last_done_value_secondary"] = float(km)
        await db.asset_service_schedules.update_one(
            {"id": sched["id"]}, {"$set": set_doc},
        )
    stats["fired"] += 1
    return rec


async def run_generate(commit: bool = False, run_id: str | None = None) -> dict:
    """Public entrypoint — called by cron AND by the manual script.
    `commit=False` is the safe dry-run mode."""
    started = time.monotonic()
    run_id = run_id or f"asset_service_generate:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    stats = {
        "run_id": run_id, "commit": commit, "scanned": 0, "fired": 0,
        "skipped_stale": 0, "skipped_no_asset": 0, "skipped_no_track": 0,
        "not_yet_due": 0, "errors": 0,
    }
    generated: list[dict] = []
    if commit:
        await ensure_indexes()
    cursor = db.asset_service_schedules.find(
        {"deleted_at": None,
         "$or": [{"interval_kind": {"$in": ["hours", "km"]}},
                 {"secondary_interval.kind": {"$in": ["hours", "km"]}}]},
    )
    async for sched in cursor:
        stats["scanned"] += 1
        try:
            rec = await _process_schedule(sched, run_id, commit, stats)
            if rec:
                generated.append({"schedule_id": sched["id"], "asset_id": sched["asset_id"],
                                  "title": rec["title"], "hours_at": rec["hours_at"],
                                  "km_at": rec["km_at"]})
        except Exception as e:
            stats["errors"] += 1
            log.exception("schedule processing crashed sid=%s: %s", sched.get("id"), e)
    stats["duration_ms"] = int((time.monotonic() - started) * 1000)
    stats["generated"] = generated
    log.info(
        "asset_service_generate v58.13.17 run=%s scanned=%d fired=%d "
        "skipped_stale=%d skipped_no_asset=%d skipped_no_track=%d "
        "not_yet_due=%d errors=%d duration_ms=%d commit=%s",
        run_id, stats["scanned"], stats["fired"], stats["skipped_stale"],
        stats["skipped_no_asset"], stats["skipped_no_track"],
        stats["not_yet_due"], stats["errors"], stats["duration_ms"], commit,
    )
    if commit:
        try:
            await db.asset_service_generate_runs.insert_one({
                "id": str(uuid.uuid4()), "at": now_iso(), **{k: v for k, v in stats.items() if k != "generated"},
            })
        except Exception as e:
            log.warning("run-summary insert failed: %s", e)
    return stats


async def _cron_entrypoint():
    """APScheduler entrypoint. Wraps run_generate so any handler
    exception cannot take down the scheduler."""
    try:
        await run_generate(commit=True)
    except Exception as e:
        log.exception("asset_service_generate cron crashed: %s", e)


def register_asset_service_generate_cron(scheduler) -> bool:
    """Called from server.py on_startup. Returns True if registered,
    False if the env-var gate is off. Uses `Australia/Sydney` on the
    job so DST is handled automatically."""
    if os.environ.get("ASSET_SERVICE_GENERATE_CRON") != "1":
        log.info("v58.13.17 asset_service_generate cron NOT registered "
                 "(ASSET_SERVICE_GENERATE_CRON not set to 1)")
        return False
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Australia/Sydney")
    except Exception:
        tz = None
    scheduler.add_job(
        _cron_entrypoint, "cron", hour=2, minute=0,
        timezone=tz, id="asset_service_generate", max_instances=1,
        coalesce=True, misfire_grace_time=3600,
    )
    log.info("v58.13.17 asset_service_generate cron registered — "
             "02:00 Australia/Sydney daily")
    return True
