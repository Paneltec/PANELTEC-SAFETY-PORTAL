"""Nightly Simpro delta cron.

v160.3.2 — Opt-in via `SIMPRO_DELTA_CRON=1`. Runs the same code path as
`POST /api/integrations/simpro/workers/refresh` (dry_run=0) but from an
APScheduler-triggered background job. Snapshot rows carry
`triggered_by: "cron"`.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from db import db
from integrations_simpro_workers import refresh_workers

log = logging.getLogger("paneltec.simpro.cron")


async def _pick_org_and_user() -> Optional[tuple[str, dict]]:
    """Return (org_id, synthetic_user_dict) for each connected Simpro org.
    We iterate all connected orgs; for now the single Paneltec tenant."""
    cfg = await db.integration_configs.find_one({"kind": "simpro", "status": "connected"})
    if not cfg:
        return None
    org_id = cfg["org_id"]
    admin = await db.users.find_one(
        {"org_id": org_id, "role": "admin", "disabled": {"$ne": True}},
        {"_id": 0, "id": 1, "email": 1, "role": 1, "org_id": 1},
    )
    if not admin:
        return None
    return org_id, admin


async def run_simpro_delta_cron() -> dict:
    """Job entrypoint. Safe to call directly for manual triggers."""
    picked = await _pick_org_and_user()
    if not picked:
        log.info("simpro_delta_cron skipped — no connected org / admin found")
        return {"skipped": True}
    org_id, user = picked
    # Monkey-patched user carries `triggered_by` tag via a per-request var
    user = {**user, "_cron_triggered_by": "cron"}
    try:
        result = await refresh_workers(dry_run=0, user=user)  # type: ignore[arg-type]
        # Tag the snapshot as cron-driven
        sid = result.get("snapshot_id") if isinstance(result, dict) else None
        if sid:
            await db.worker_import_snapshots.update_one(
                {"id": sid, "org_id": org_id},
                {"$set": {"triggered_by": "cron"}},
            )
        counts = (result or {}).get("counts") or {}
        log.info("simpro_delta_cron org=%s snapshot=%s counts=%s", org_id, sid, counts)
        # Emit an admin notification if the delta > 0
        new_workers = int(counts.get("workers_new_created") or 0)
        added_certs = int(counts.get("certs_added") or 0)
        if new_workers or added_certs:
            await db.notifications.insert_one({
                "id": (await db.command("hostInfo")).get("system", {}).get("hostname", "cron")
                       + "-simpro-delta",
                "org_id": org_id,
                "kind": "simpro_delta",
                "severity": "info",
                "title": f"Simpro delta sync: +{new_workers} workers, +{added_certs} certs",
                "body": f"Snapshot {sid}",
                "created_at": counts.get("run_at") or None,
                "read_by": [],
            })
        return {"ok": True, "snapshot_id": sid, "counts": counts}
    except Exception as e:  # pragma: no cover
        log.exception("simpro_delta_cron failed: %s", e)
        await db.notifications.insert_one({
            "id": "simpro-delta-error", "org_id": org_id,
            "kind": "simpro_delta", "severity": "warning",
            "title": "Simpro delta sync failed",
            "body": str(e)[:400], "read_by": [],
        })
        return {"ok": False, "error": str(e)[:400]}


def register_simpro_cron(scheduler) -> bool:
    """Register the nightly job if `SIMPRO_DELTA_CRON=1` and APScheduler
    is available. Returns True on registration."""
    if os.environ.get("SIMPRO_DELTA_CRON") != "1":
        return False
    hour = int(os.environ.get("SIMPRO_DELTA_CRON_HOUR", "2"))
    minute = int(os.environ.get("SIMPRO_DELTA_CRON_MINUTE", "0"))
    scheduler.add_job(
        run_simpro_delta_cron, "cron",
        hour=hour, minute=minute,
        id="simpro_delta_cron", max_instances=1, replace_existing=True,
    )
    log.info("APScheduler job registered — simpro_delta_cron at %02d:%02d daily", hour, minute)
    return True
