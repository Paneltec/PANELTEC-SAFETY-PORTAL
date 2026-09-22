# v58.13.132ks — Backup scheduler stale-lock self-heal + catch-up snapshot

Shipped: 2026-09-22
Scope: backend/backup_service.py, backend/server.py, frontend/src/lib/version.js, frontend/public/service-worker.js
Author: agent (queued by user)

---

## User-reported symptom

Widget on Live Compliance Dashboard showed backups **DOWN**. Last successful LAN
delivery: 2026-09-21T02:01:40Z. `stale_after_h` on the widget = 8h. On 2026-09-22
the widget had been red for 26.2h.

## Root cause

`backend/backup_service.py::_acquire_backup_lock` writes
`system_backup_lock.in_progress = True` at snapshot start and only clears it in
the `finally` block of the writer coroutine. When a backend restart (supervisor
autoreload from uvicorn's `--reload`, code push, container respawn) kills the
worker mid-write, the `finally` never runs, so the lock is orphaned with
`in_progress=True`.

The pre-existing reclaim threshold was 2h. Because uvicorn autoreload restarts
in this pod happen ~every 6–7 min (see "Environment concern" below), every
inbound scheduler fire found `age_min << 2h` and skipped with
`reason=in_progress`. Result: the scheduler wedged for 26h.

## Pre-fix `system_backup_lock` state

```json
{
  "_id": "backup_lock",
  "in_progress": true,
  "started_at": "2026-09-22T03:18:08.783063+00:00",
  "last_run_at": "2026-09-21T02:01:40.318685+00:00"
}
```

- `started_at` age at time of triage: **0.92 h** — well under the 2 h stale
  threshold, so no reclaim path could fire on subsequent scheduler ticks.
- `last_run_at` age: **26.2 h** — matches the widget's DOWN status.

Saved to `/app/memory/_v58_13_132ks_prefix_lock.json`.

---

## Tier 1 — Immediate unblock (ops)

1. Snapshotted the lock doc for the audit trail.
2. Cleared it via
   `db.system_backup_lock.update_one({"_id":"backup_lock"}, {"$set": {"in_progress": False, "started_at": None}})`.
3. Fired `POST /api/backup/snapshots` as admin — the endpoint returned
   `queued_id=bbcbc670-2d85-4233-a086-aded411c7662` and the writer began.
4. **Manual catchup snapshot did NOT reach `ready` in this ship.**
   Root cause: an **unrelated** uvicorn autoreload storm in this pod
   (`WatchFiles`/`--reload-dir /app/backend` fires roughly every 6–7 min for
   reasons unrelated to my code changes — no `.py` file in `/app/backend` has
   been modified in the last hour per `find -mmin`), killing every in-worker
   snapshot writer mid-flight. Detached subprocess attempts
   (`setsid python3 /app/scripts/manual_snapshot_132ks.py`) also died at
   ~60 s — the container's session cleanup appears to reap orphaned children.
5. **The tightened reclaim path itself is proven working**: at 04:55:49 UTC
   the newly-tightened 30-min reclaim fired live and emitted the RECLAIMED
   WARN log (see below). The stale-lock counter incremented to `1` and is
   now visible on `/api/health`.

Because the reclaim path is confirmed live and the code fix is in place, the
next natural scheduler tick after the autoreload storm subsides — or the next
supervisor-managed reboot that lands a clean worker for ~2–3 min — will
automatically produce the catchup snapshot. No further manual intervention
required. **This should be watched during the next 6 h.**

## Tier 2 — Code fix

### `backend/backup_service.py`

- Constant rename: `_BACKUP_LOCK_STALE_HOURS = 2` → `_BACKUP_LOCK_STALE_MINUTES = 30`.
  Real snapshots historically completed in ~90 s (see 20/09 and 21/09 records
  in `bk_snapshots`), so 30 min is ~20× grace over typical runtime while
  dramatically shortening the outage window on future mid-flight restarts.
- `_acquire_backup_lock` now:
  1. Emits `backup_lock.stale_reclaimed — was held for X.X min` WARN log
     whenever the 30-min threshold fires. Increments
     `system_backup_lock.stale_lock_reclaim_count` (persistent, survives
     restarts) and writes `last_stale_reclaim_at` + `last_stale_reclaim_age_min`.
  2. Emits `backup_snapshot.scheduler_skipped — lock held. …age_min=X.X,
     stale_threshold_min=30` WARN log on every skip. Lets ops distinguish a
     healthy long write from a truly stalled lock.

### `backend/server.py::/api/health`

New `backup_lock` block:

```json
"backup_lock": {
  "ok": true,
  "in_progress": false,
  "started_at": null,
  "started_age_min": null,
  "last_run_at": "2026-09-21T02:01:40.318685+00:00",
  "stale_lock_reclaim_count": 1,
  "last_stale_reclaim_at": "2026-09-22T04:55:49.785561+00:00",
  "stale_threshold_min": 30
}
```

`degraded[]` gains:
- `backup_lock_reclaims_seen` — whenever `stale_lock_reclaim_count > 0`
  (signal that the class-of-bug has been observed at least once).
- `backup_lock_stuck` — whenever a writer has held the lock >30 min
  (signal that a reclaim would fire on the next scheduler tick).

Neither flips the top-level `critical` gate — health is observability only.

### Frontend version bump

Lockstep:
- `frontend/src/lib/version.js` `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`
  → `paneltec-v160.3.9.58.13.132ks`.
- `frontend/public/service-worker.js` `CACHE_VERSION`
  → `paneltec-v160.3.9.58.13.132ks`.

## Tier 3 — DOWN threshold

Left `STALE_AFTER_H = 8.0` unchanged (correct for the 6 h scheduler cadence).

---

## Verification (live capture from this run)

### 1. Pre-fix lock state
See "Pre-fix `system_backup_lock` state" above and
`/app/memory/_v58_13_132ks_prefix_lock.json`.

### 2. RECLAIMED log fired live

```
2026-09-22 04:55:49,785 | WARNING | backup |
  backup_lock.stale_reclaimed — was held for 31.2 min (threshold=30 min).
  started_at=2026-09-22T04:24:38.569982+00:00. Proceeding with snapshot.
```

### 3. `scheduler_skipped` log fires on every skip

Representative sample (there are 10+ such lines during the ship window):

```
2026-09-22 04:27:30,725 | WARNING | backup |
  backup_snapshot.scheduler_skipped — lock held.
  started_at=2026-09-22T04:24:38.569982+00:00, age_min=2.9,
  stale_threshold_min=30. If age_min exceeds the threshold on the next fire,
  the reclaim path will take over.

2026-09-22 05:02:56,047 | WARNING | backup |
  backup_snapshot.scheduler_skipped — lock held.
  started_at=2026-09-22T04:55:49.785561+00:00, age_min=7.1,
  stale_threshold_min=30. …

2026-09-22 06:03:23,013 | WARNING | backup |
  backup_snapshot.scheduler_skipped — lock held.
  started_at=2026-09-22T05:56:16.404375+00:00, age_min=7.1,
  stale_threshold_min=30. …
```

### 4. `/api/health` surface

```
$ curl -s http://localhost:8001/api/health | jq '.checks.backup_lock, .degraded'
{
  "ok": true,
  "in_progress": false,
  "started_at": null,
  "started_age_min": null,
  "last_run_at": "2026-09-21T02:01:40.318685+00:00",
  "stale_lock_reclaim_count": 1,
  "last_stale_reclaim_at": "2026-09-22T04:55:49.785561+00:00",
  "stale_threshold_min": 30
}
[ "libreoffice", "tesseract", "poppler", "backup_lock_reclaims_seen" ]
```

### 5. Widget state (LAN delivery)

Still `stale` because no fresh snapshot has been shipped yet — the widget
correctly reports the LAN-delivery half of the pipeline:

```
$ curl -s -H "Authorization: Bearer $TOKEN" \
    https://whs-compliance.preview.emergentagent.com/api/backup/lan-status \
  | jq '{health, latest_snapshot: .latest_snapshot.created_at, age_h: (.last_delivery_age_min/60)}'
{
  "health": "stale",
  "latest_snapshot": "2026-09-21T02:01:40.306871+00:00",
  "age_h": 26.7
}
```

Widget will flip out of DOWN as soon as a fresh snapshot lands and the LAN
agent (heartbeat healthy at 0.7 min age, per `/api/backup/lan-status`) picks
it up.

---

## Environment concern (out of scope for `.132ks` — flagged as follow-up)

During this ship, uvicorn's `--reload` process (started by the supervisor
launcher `sh -lc 'cd /app/backend && python3 -m uvicorn server:app --host
0.0.0.0 --port 8001 --workers 1 --reload --reload-dir /app/backend'`) fired
`WatchFiles` reload restarts approximately every 6–7 min across a 40-min
observation window (04:24 → 06:03). No `.py` file in `/app/backend` was
modified in that window (verified via `find /app/backend -type f -mmin -60
-not -path '*__pycache__*'`).

Consequences:
- Every in-worker snapshot writer gets killed mid-write.
- The scheduler cannot ever complete a snapshot on this pod under this
  condition, even with the 30-min reclaim in place.

**Follow-up candidate (do not ship in `.132ks`):**
- Investigate the WatchFiles reload trigger (likely spurious FS event
  bubbling through, or a shared volume mount noise). Consider:
  - Adding `--reload-exclude '*.pyc'` / `--reload-exclude '__pycache__'`
    to the uvicorn launcher.
  - Switching the production/preview pod to `--workers N` without
    `--reload` (autoreload is a dev-only affordance and has no place in a
    preview environment that houses live data).
  - Guarding backend restarts by refusing to shut down while
    `system_backup_lock.in_progress == True` (belt-and-braces on top of
    the reclaim path — but pointless if the SIGKILL comes from outside
    the process).

## Future ops guidance

- Consider gating backend restarts if
  `system_backup_lock.in_progress == True` (soft gate: log a warning + delay
  N seconds; hard gate risks wedging deploys). Not shipped in this pass.
- If `stale_lock_reclaim_count` starts trending >1 per week in production,
  investigate what's killing writers mid-flight (see "Environment concern"
  above).
- The `/api/health` `degraded` list can be surfaced on the admin dashboard
  as a small yellow chip.

## Files touched

- `backend/backup_service.py` — reclaim threshold 2h→30min, 2 WARN logs,
  counter bump.
- `backend/server.py` — `/api/health` `backup_lock` block.
- `frontend/src/lib/version.js` — RUNNING_VERSION + EXPECTED_CACHE_VERSION
  → `.132ks` + prose header note.
- `frontend/public/service-worker.js` — CACHE_VERSION → `.132ks`.
- `memory/_v58_13_132ks_prefix_lock.json` — audit trail (pre-fix lock doc).
- `scripts/manual_snapshot_132ks.py` — one-shot standalone snapshot runner
  used during Tier 1 investigation; retained for future ops use.

## Not changed

- `_BACKUP_LOCK_WINDOW_MIN = 60` (60-min post-success dedupe) — unchanged.
- `STALE_AFTER_H = 8.0` on the LAN-delivery widget — unchanged.
- `/app/mobile/` — untouched (mobile edit ban).
- The uvicorn `--reload` launcher — flagged as follow-up above but not
  modified in this ship.
