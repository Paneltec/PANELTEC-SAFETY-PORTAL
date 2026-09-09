"""v58.13.131m — SmartFill auto-sync daily cron.

Runs at 06:00 Australia/Brisbane daily (env-configurable). Pulls
yesterday's transactions via `Transactions:Read` and pipes them
through the SAME import pipeline as the CSV path — same dedupe on
`Transaction Id`, same R1–R7 anomaly evaluation, same Navixy
enrichment. Auto-sync is OFF by default per user directive; guarded
by both `SMARTFILL_AUTO_SYNC_CRON=1` (registration gate) AND
`org_settings.fuel_smartfill_auto_sync_enabled == True` (per-org
gate).

Snapshot rows carry `triggered_by: "cron"`.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from db import db
from fleet_fuel import sync_from_smartfill

log = logging.getLogger("paneltec.smartfill.cron")

_DEFAULT_TZ = "Australia/Brisbane"


async def _pick_orgs_with_auto_sync() -> list[tuple[str, dict]]:
    """Return list of `(org_id, admin_user)` for every org that has
    the auto-sync toggle ON. Currently the Paneltec tenant is the
    only one wired; the shape leaves room for multi-tenant.
    """
    out: list[tuple[str, dict]] = []
    async for cfg in db.org_settings.find(
        {"fuel_smartfill_auto_sync_enabled": True},
        {"_id": 0, "org_id": 1},
    ):
        org_id = cfg.get("org_id")
        if not org_id:
            continue
        admin = await db.users.find_one(
            {"org_id": org_id, "role": "admin", "disabled": {"$ne": True}},
            {"_id": 0, "id": 1, "email": 1, "role": 1, "org_id": 1},
        )
        if admin:
            out.append((org_id, admin))
    return out


async def run_smartfill_auto_sync_cron() -> dict:
    """Job entrypoint. Safe to call directly for manual triggers.

    Returns a summary dict describing all org-level runs. Never
    raises — swallows exceptions so a bad tenant doesn't take down
    the scheduler.
    """
    picks = await _pick_orgs_with_auto_sync()
    if not picks:
        log.info("smartfill_auto_sync_cron skipped — no orgs with auto_sync_enabled")
        return {"skipped": True, "reason": "no_orgs_enabled"}

    tz = ZoneInfo(_DEFAULT_TZ)
    now_local = datetime.now(tz)
    # Yesterday's window in local time.
    from_local = (now_local - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    to_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    # Serialised as `YYYY-MM-DD HH:MM:SS` (the shape Tank:Read
    # returned; Transactions:Read tolerates the same).
    from_iso = from_local.strftime("%Y-%m-%d %H:%M:%S")
    to_iso = to_local.strftime("%Y-%m-%d %H:%M:%S")

    results: list[dict] = []
    for org_id, admin in picks:
        try:
            result = await sync_from_smartfill(
                org_id=org_id,
                workspace_id=admin.get("workspace_id"),
                user_id=admin["id"],
                from_iso=from_iso,
                to_iso=to_iso,
                triggered_by="cron",
            )
            counts = {
                "inserted": result.rows_inserted,
                "duplicate": result.rows_duplicate,
                "anomalous": result.rows_anomalous,
                "rejected": result.rows_rejected,
            }
            log.info("smartfill_auto_sync_cron org=%s batch=%s counts=%s",
                     org_id, result.batch_id, counts)
            # Notify on non-trivial batches.
            if result.rows_inserted or result.rows_anomalous:
                await db.notifications.insert_one({
                    "id": f"smartfill-sync-{result.batch_id}",
                    "org_id": org_id,
                    "kind": "smartfill_auto_sync",
                    "severity": "info" if not result.rows_anomalous else "warning",
                    "title": (f"SmartFill auto-sync · +{result.rows_inserted} txn, "
                              f"{result.rows_anomalous} anomalous"),
                    "body": (f"Window {from_iso} → {to_iso}. Batch {result.batch_id}."),
                    "created_at": None,
                    "read_by": [],
                })
            results.append({"org_id": org_id, "ok": True, "batch_id": result.batch_id, "counts": counts})
        except Exception as e:  # noqa: BLE001
            log.exception("smartfill_auto_sync_cron org=%s failed: %s", org_id, e)
            await db.notifications.insert_one({
                "id": f"smartfill-sync-error-{org_id}",
                "org_id": org_id,
                "kind": "smartfill_auto_sync",
                "severity": "warning",
                "title": "SmartFill auto-sync failed",
                "body": str(e)[:400],
                "read_by": [],
            })
            results.append({"org_id": org_id, "ok": False, "error": str(e)[:400]})
    return {"ok": True, "runs": results, "window": {"from": from_iso, "to": to_iso}}


def register_smartfill_auto_sync_cron(scheduler) -> bool:
    """Register the daily job if `SMARTFILL_AUTO_SYNC_CRON=1`.

    Two-gate design:
      1. Env var flip — enables the registration at process start.
      2. Per-org toggle — cron itself skips any org whose
         `org_settings.fuel_smartfill_auto_sync_enabled` is not True.
    """
    if os.environ.get("SMARTFILL_AUTO_SYNC_CRON") != "1":
        return False
    hour = int(os.environ.get("SMARTFILL_AUTO_SYNC_CRON_HOUR", "6"))
    minute = int(os.environ.get("SMARTFILL_AUTO_SYNC_CRON_MINUTE", "0"))
    scheduler.add_job(
        run_smartfill_auto_sync_cron, "cron",
        hour=hour, minute=minute,
        timezone=_DEFAULT_TZ,
        id="smartfill_auto_sync_cron",
        max_instances=1, replace_existing=True, coalesce=True,
    )
    log.info("APScheduler job registered — smartfill_auto_sync_cron at %02d:%02d Australia/Brisbane daily",
             hour, minute)
    return True
