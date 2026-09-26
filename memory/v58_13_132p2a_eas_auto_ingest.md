# v58.13.132p2a — Persistent EAS APK Auto-Ingest Scheduler

Replaces the fragile one-shot `eas_ingest_watcher_132n7d.sh` bash
watcher with an APScheduler job wired into the backend. The
DOWNLOAD APP dropdown now stays current automatically — every
future mobile ship is picked up within 5 minutes of the EAS build
finishing, no manual intervention needed.

## Part 1 — Immediate v1.0.50 ingest

At ship time the EAS build `9f9abe41-6b29-4082-b190-0b2a9088a6bb`
(v1.0.50 build 172) was **still IN_PROGRESS** — started
2026-09-26T10:48:55Z, elapsed ~20 min. The manifest correctly
stayed on v1.0.48 build 170 (the newest FINISHED build at that
moment). The watchdog will auto-ingest as soon as EAS flips
`9f9abe41` to FINISHED — no manual force-ingest was possible or
required.

## Part 2 — Persistent auto-ingest scheduler

### Architecture

  · `backend/eas_ingest_watchdog.py`   ← new module.
      Exposes `watchdog_tick()`, `run_boot_check()`,
      `watchdog_enabled()`, `enable_watchdog(bool)`.

  · `backend/mobile_downloads.py`      ← factored.
      The 130-line ingest routine that used to live inside the
      `POST /mobile/downloads/android/ingest-from-eas` handler is
      now a standalone
      `async def _ingest_latest_finished_android(*, source, actor_user_id)`.
      Returns a structured dict, never raises. The HTTP endpoint
      is a thin admin wrapper around it.

  · `backend/server.py`                ← +2 hooks.
      · Registers the APScheduler `eas_apk_ingest_watchdog` job
        (interval=5 min, `max_instances=1`, `coalesce=True`,
        `replace_existing=True`) alongside the existing
        `dropbox_migration_watchdog` + `bulk_import_watchdog`.
      · Kicks off `run_boot_check()` in the deferred startup task
        so the first ingest attempt fires ~immediately after
        backend restart (not 5 min later).

### Idempotency

`_ingest_latest_finished_android` short-circuits when the newest
FINISHED build's `id` already matches `android_manifest.json`'s
`eas_build_id` — returns `{"ok": True, "action": "same-build",
...}` without downloading the 141 MB APK. Log level demoted to
DEBUG for that path so we don't spam WARNINGs every 5 min in
steady state.

Version-code monotonicity guard: refuses to downgrade — if EAS
inexplicably picks a build with `versionCode < current manifest`,
returns 409 with a clear reason. Safety net for rollback typos.

### Kill switch

`eas_watchdog_settings` Mongo collection (same shape as
`migration_watchdog_settings`):

```json
{
  "key": "watchdog",
  "enabled": true,
  "last_tick_at":       "2026-09-26T11:06:55.799981+00:00",
  "last_tick_source":   "boot_check",
  "last_tick_ok":       true,
  "last_tick_action":   "same-build",
  "last_tick_reason":   null,
  "last_tick_build_id": "cf70a770-e7fa-4c6b-87d4-38a533946d98",
  "last_tick_version":  "1.0.48",
  "updated_at":         "2026-09-26T11:09:15.788237+00:00"
}
```

Flip via `enable_watchdog(False)` (Python) or by writing directly
in Mongo. Checked at BOTH scheduler-registration time (in
`server.py`) AND inside the tick — belt-and-braces.

### Edge cases

  · `EXPO_TOKEN` missing → tick returns
    `{"ok": False, "reason": "EXPO_TOKEN not set…"}`, records the
    reason on `last_tick_*`, logs at WARNING. Does NOT crash the
    scheduler; next 5-min tick tries again.
  · EAS 5xx / network error → structured error in the return dict,
    recorded on `last_tick_*`, no retries this tick. Next 5-min
    tick tries again.
  · `eas-cli` binary missing (container restart wipe) → not a
    concern here — we use the EAS GraphQL API directly via
    `httpx`, not the CLI. This is the whole point of preferring
    GraphQL over shelling out. Survives container restarts.

## Immediate + long-term wins

  · **Immediate**: killed the one-shot bash watcher (PID 10983).
    Its work is now handled by the scheduler.
  · **Long-term**: every future mobile ship auto-publishes within
    5 min of EAS finishing. Zero-touch for Stephen.
  · Manual "Sync latest from EAS" button in the dropdown still
    works — hits the same HTTP endpoint which now goes through the
    shared `_ingest_latest_finished_android`.

## Boot log — proof the scheduler is live

```
2026-09-26 11:06:55,583 | INFO | paneltec | APScheduler job registered — eas_apk_ingest_watchdog every 5 min
2026-09-26 11:06:55,585 | INFO | paneltec.eas_watchdog | eas_watchdog.boot_check.starting
```

Boot check outcome recorded in Mongo:

```
last_tick_source:   boot_check
last_tick_ok:       true
last_tick_action:   same-build   ← newest FINISHED is still cf70a770; no download
last_tick_build_id: cf70a770-e7fa-4c6b-87d4-38a533946d98
last_tick_version:  1.0.48
```

Which is exactly right: at boot time `9f9abe41` (v1.0.50) was
still IN_PROGRESS, so the newest FINISHED remained `cf70a770`
(v1.0.48). The scheduler correctly did nothing. The next tick
fires at ~11:12 UTC.

## Tests — 6/6 passing

`backend/tests/test_v58_13_132p2a_eas_watchdog.py`:

```
test_watchdog_skipped_when_disabled           PASSED
test_watchdog_no_op_same_build                PASSED
test_watchdog_ingests_when_newer_build        PASSED
test_watchdog_handles_missing_expo_token      PASSED
test_run_boot_check_invokes_one_tick          PASSED
test_enable_watchdog_persists                 PASSED
============================== 6 passed ==============================
```

Tests monkeypatch `_ingest_latest_finished_android` so they never
hit EAS. Each test gets a fresh Motor client on a fresh event
loop to sidestep the per-loop client cache issue documented in
the `.132p0` tests. Opted into the live-DB-write guard via
`pytestmark = pytest.mark.live_db_writes` since the whole point
is to persist the settings doc.

## Files touched

Backend:
  · `backend/eas_ingest_watchdog.py`                       **NEW**
  · `backend/mobile_downloads.py`                          factored — ingest lifted into standalone func
  · `backend/server.py`                                    +scheduler job, +boot check
  · `backend/tests/test_v58_13_132p2a_eas_watchdog.py`     **NEW** — 6 tests

Frontend:
  · `frontend/public/service-worker.js`                    CACHE_VERSION → 132p2a
  · `frontend/src/lib/version.js`                          RUNNING + EXPECTED → 132p2a

Memory:
  · `memory/v58_13_132p2a_eas_auto_ingest.md`              this file

## Follow-up housekeeping

  · **Removed dead script**: `scripts/eas_ingest_watcher_132n7d.sh`
    (was only useful for one-shot per-build monitoring — the
    scheduler now covers every future build automatically). Kept
    on disk for reference but no longer invoked; safe to delete
    in a future ship.

  · Manual "Sync latest from EAS" button behaviour unchanged —
    same HTTP endpoint, same behaviour. Users don't lose the
    manual override.

## Ship pointers

  · Not pushed. Defensive git reset kept parallel-actor files
    untouched.
  · Ship label: `.132p2a`.
  · No `/app/mobile/` edits.
  · Ran with `MOBILE_VERSION_SYNC_OPTIONAL=true` — web/backend only,
    no mobile version bump in this ship.
