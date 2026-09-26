# v58.13.132n8 — Hard NAS-write lockdown

**Ship label:** `.132n8`
**Cut on top of:** `7f655efc` (`.132n7a`).
**No push.**

---

## Purpose

Belt-and-braces on the `.132n0` shutdown. `.132n0` did the *runtime*
disable (cancelled runs + flipped the DB flag + unregistered the
APScheduler job). This ship makes the *code* refuse to write, so a
rogue Mongo edit or a stray admin POST can't restart writes.

The user asked for **zero** more writes to the UGREEN NAS. This
delivers that with three independent layers of defence:

1. Runtime state: `.132n0` shutdown (still in force).
2. Config flag: `migration_watchdog_settings.enabled = False`.
3. **Code-level refusal (this ship)**: two independent
   `MIGRATION_DISABLED = True` module constants, six enforcement
   points across worker + route layers.

---

## The pre-audit finding that motivated this ship

From `.132n8` audit report:

* All 148 `dropbox_migration_run` docs in `state=cancelled` /
  `failed` / `dry-run-complete` / `interrupted`. Zero `running`.
* `migration_watchdog_settings.enabled=False` still holds.
* APScheduler startup log every backend restart since `.132n0`:
  `APScheduler job SKIPPED — dropbox_migration_watchdog
  (migration_watchdog_settings.enabled=False)`.
* `nas_ops` collection: 9 rows, all `done`. 0 queued, 0 in-flight.
* Last `run_copy_job crashed` traceback: 2026-09-25 22:24:54 UTC
  (during the `.132n0` shutdown drain — nothing since).

But — **three admin write routes were still bare** (no top-level
refusal check):

* `POST /api/dropbox/migration/start`
* `POST /api/dropbox/migration/{run_id}/resume`
* `POST /api/dropbox/migration/watchdog/resume`

Plus indirect: `watchdog_tick()` + `_launch_resume_task()` are
still importable Python functions. A rogue direct call bypasses the
APScheduler unregistration.

Passive verification is not enough. This ship adds the active
refusal.

---

## Changes

### `backend/dropbox_bytes_copy.py`

* New module constant `MIGRATION_DISABLED: bool = True` at the top
  of the file, with a prominent comment explaining the re-enable
  procedure.
* `run_copy_job()` grows an early-return guard: if
  `MIGRATION_DISABLED`, log a WARNING, persist a
  `state=disabled_lockdown` status doc via `_status_upsert` so
  admins can see the refusal via `GET /api/dropbox/migration/status`,
  and return without touching enum rows or NAS ops.

### `backend/integrations_dropbox.py`

* New module constant `MIGRATION_DISABLED: bool = True` at the top
  (independent of the copy-side one — both must be flipped to
  re-enable).
* `POST /migration/start` → early-return 503 with recovery hint.
* `POST /migration/{run_id}/resume` → early-return 503 with recovery hint.
* `POST /migration/watchdog/resume` → early-return 503 (refuses the
  DB flip so the safety flag can't drift back to True via the API).
* `watchdog_tick()` → early-return `{"skipped": "MIGRATION_DISABLED"}`
  before any state mutation.
* `_launch_resume_task()` → early-return `None` before any
  `asyncio.create_task` call.

### `frontend/src/lib/version.js` + `frontend/public/service-worker.js`

* Version + cache bumps to `.132n8`.
* Ship annotation block at the top of `version.js`.

---

## Live-probe verification

Backend restarted, all six guards confirmed refusing:

```
integrations_dropbox.MIGRATION_DISABLED = True
dropbox_bytes_copy.MIGRATION_DISABLED   = True

watchdog_tick()                → {'skipped': 'MIGRATION_DISABLED'}
_launch_resume_task()          → None
run_copy_job()                 → persists state=disabled_lockdown
                                 error: "MIGRATION_DISABLED — see
                                 dropbox_bytes_copy.py MIGRATION_DISABLED
                                 constant"

POST /migration/start          → HTTP 503 with body:
  "Migration lockdown active — Dropbox → NAS writes are permanently
  disabled. Contact ops to re-enable (edit MIGRATION_DISABLED in both
  dropbox_bytes_copy.py and integrations_dropbox.py, then redeploy)."
POST /migration/watchdog/resume→ HTTP 503 (same shape)
POST /migration/copy-abc/resume→ HTTP 503 (same shape)
GET  /migration/status         → HTTP 200 (unaffected — read-only)
```

The probe row (`probe-lockdown-run`) was cleaned up after the test.

---

## Re-enable procedure

Intentional friction — the user asked for NO more writes. To
restart Dropbox → NAS writes, an ops engineer MUST:

1. Set `MIGRATION_DISABLED = False` in
   `backend/dropbox_bytes_copy.py`.
2. Set `MIGRATION_DISABLED = False` in
   `backend/integrations_dropbox.py`.
3. Redeploy.
4. `POST /api/dropbox/migration/watchdog/resume` (flips the DB
   flag back to True).
5. Restart the backend so the APScheduler watchdog job
   re-registers.

Skipping any step leaves the writes disabled.

---

## Files touched

```
 M backend/dropbox_bytes_copy.py                    (+MIGRATION_DISABLED + run_copy_job guard)
 M backend/integrations_dropbox.py                  (+MIGRATION_DISABLED + 5 guards)
 M frontend/src/lib/version.js                      (RUNNING + EXPECTED bump + ship annotation)
 M frontend/public/service-worker.js                (CACHE_VERSION bump)
?? memory/v58_13_132n8_nas_lockdown.md              (this file)
```

## Not in this ship

* No FE UX changes — lockdown is server-side.
* No mobile touch.
* No Dropbox-browser changes.
* No housekeeping run (blocked on Dropbox OAuth reconnect —
  unchanged from `.132n7a`).

## Ship discipline

* Defensive `git reset HEAD -- .` before staging.
* Parallel-actor stowaways confirmed not in the commit.
* Backend restart applied so the new constant + guards are live
  in-process.
* Live probe confirmed all 6 refusals after restart.
* No push. No `testing_agent`. No `finish` tool.
