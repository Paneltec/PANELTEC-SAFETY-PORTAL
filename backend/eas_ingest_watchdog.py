"""v58.13.132p2a — EAS APK auto-ingest watchdog.

Persistent APScheduler job that keeps the DOWNLOAD APP dropdown
current. Every 5 minutes:

  1. Reads the `eas_watchdog_settings` doc → skips the tick if
     `enabled=False`.
  2. Calls
     :func:`mobile_downloads._ingest_latest_finished_android` with
     `source="watchdog"`. That function is idempotent — it hits the
     EAS GraphQL API, picks the newest FINISHED internal Android
     build for the `stephenguy/paneltec-civil-field` project, and:

       · if the newest FINISHED build id already matches our
         on-disk manifest → returns action="same-build" → this tick
         is a cheap no-op (no APK download).

       · if newer → downloads the APK, sha256's it, atomic-swaps
         into `latest.apk`, rewrites `android_manifest.json`,
         inserts an audit row.

  3. Records the tick outcome in `eas_watchdog_settings.last_tick_*`
     for debugging (never causes a crash — Mongo blips are
     swallowed).

Boot check (`run_boot_check()`): call this from the deferred startup
hook so we don't wait 5 minutes for the first ingest after a
backend restart. Skips if the watchdog is disabled.

Kill switch (`enable_watchdog(bool)`): flips
`eas_watchdog_settings.enabled` in Mongo. Same pattern as
`migration_watchdog_settings.enabled` — checked at both scheduler-
registration time (in `server.py`) and inside `watchdog_tick`.

Never crashes the scheduler. All failure modes are logged and
recorded in `last_tick_*` fields on the settings doc.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from db import db

log = logging.getLogger("paneltec.eas_watchdog")


# ─────────────── Settings ───────────────

_SETTINGS_COLLECTION = "eas_watchdog_settings"
_SETTINGS_KEY = "watchdog"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def watchdog_enabled() -> bool:
    """Read the enabled flag. Default: True (opt-out, not opt-in)."""
    try:
        doc = await db[_SETTINGS_COLLECTION].find_one(
            {"key": _SETTINGS_KEY}, {"_id": 0, "enabled": 1},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("eas_watchdog.settings_read_failed: %s", exc)
        return True
    if not doc:
        return True
    return bool(doc.get("enabled", True))


async def enable_watchdog(enabled: bool) -> dict:
    """Flip the kill switch. Returns the new settings doc."""
    doc = {
        "key": _SETTINGS_KEY,
        "enabled": bool(enabled),
        "updated_at": _now_iso(),
    }
    await db[_SETTINGS_COLLECTION].update_one(
        {"key": _SETTINGS_KEY},
        {"$set": doc},
        upsert=True,
    )
    return doc


async def _record_tick(*, source: str, result: dict) -> None:
    """Best-effort audit — persist the last tick outcome so we can
    inspect the watchdog's health from Mongo without tailing logs."""
    try:
        patch = {
            "last_tick_at": _now_iso(),
            "last_tick_source": source,
            "last_tick_ok": bool(result.get("ok")),
            "last_tick_action": result.get("action"),
            "last_tick_reason": result.get("reason"),
            "last_tick_build_id": (result.get("manifest") or {}).get("eas_build_id")
                                  or result.get("build_id"),
            "last_tick_version": (result.get("manifest") or {}).get("version")
                                  or result.get("version"),
        }
        await db[_SETTINGS_COLLECTION].update_one(
            {"key": _SETTINGS_KEY},
            {"$set": patch},
            upsert=True,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("eas_watchdog.record_tick_failed: %s", exc)


# ─────────────── Main tick ───────────────

async def watchdog_tick(*, source: str = "watchdog") -> Optional[dict]:
    """Run one ingest attempt. Never raises.

    Returns the ingest result dict, or None if the tick was skipped
    (disabled). Safe to invoke from APScheduler AND manually (e.g.
    from tests, from the admin-triggered `run-once` endpoint if we
    ever add one)."""
    if not await watchdog_enabled():
        log.debug("eas_watchdog.skipped source=%s (settings.enabled=False)", source)
        return None

    if not os.environ.get("EXPO_TOKEN"):
        # Not a scheduler crash — surface it via last_tick_reason so
        # ops can see it without tailing logs. The ingest function
        # ALSO reports this, but recording it here avoids invoking a
        # useless EAS round-trip.
        result = {
            "ok": False,
            "reason": "EXPO_TOKEN not set in backend env — skipping tick.",
        }
        log.warning("eas_watchdog.no_token source=%s", source)
        await _record_tick(source=source, result=result)
        return result

    # Import lazily so the module still loads if mobile_downloads is
    # mid-hot-reload.
    try:
        from mobile_downloads import _ingest_latest_finished_android
    except Exception as exc:  # noqa: BLE001
        log.warning("eas_watchdog.import_failed: %s", exc)
        return {"ok": False, "reason": f"import failed: {exc}"}

    try:
        result = await _ingest_latest_finished_android(
            source=source,
            actor_user_id=None,
        )
    except Exception as exc:  # noqa: BLE001
        # Belt-and-braces: the ingest function is documented to
        # never raise, but wrap it anyway.
        log.warning("eas_watchdog.tick_raised: %s", exc)
        result = {"ok": False, "reason": f"tick raised: {exc}"}

    action = result.get("action")
    if result.get("ok") and action == "ingested":
        log.warning(
            "eas_watchdog.ingested source=%s build_id=%s version=%s",
            source, result.get("build_id"), result.get("version"),
        )
    elif result.get("ok") and action == "same-build":
        log.debug(
            "eas_watchdog.no_change source=%s build_id=%s",
            source, result.get("build_id"),
        )
    else:
        log.info(
            "eas_watchdog.no_op source=%s reason=%r",
            source, result.get("reason"),
        )

    await _record_tick(source=source, result=result)
    return result


async def run_boot_check() -> Optional[dict]:
    """Run one iteration at backend startup so we don't wait for the
    first 5-minute tick. Blocks briefly (single EAS GraphQL call +
    optional APK download) — call from a deferred startup hook to
    keep the boot fast for the case where an ingest is actually
    needed."""
    log.info("eas_watchdog.boot_check.starting")
    return await watchdog_tick(source="boot_check")
