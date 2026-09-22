# v58.13.132kv — Fix uvicorn autoreload storm blocking catch-up snapshot

Shipped: 2026-09-22
Scope: supervisor config (`/etc/supervisor/conf.d/supervisord.conf`), version bump
Author: agent (queued by user immediately after `.132kt`)

---

## User pain

`.132ks` shipped correctly (reclaim tightened to 30 min, WARN logs live,
persistent counter working). BUT the catch-up snapshot never reached
`ready` because uvicorn's `--reload` file-watcher was firing spuriously
in the preview pod. Every remount SIGTERM'd whatever writer was
mid-flight, so the widget stayed DOWN despite the code fix landing
correctly.

## Investigation

### 1. How uvicorn was launched (pre-fix)

```
[program:backend]
command=/root/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 \
        --workers 1 --reload --reload-dir /app/backend
```

Header comment (`v58.13.5`) explains the intent: "Prevents the
stale-backend class of bug — uvicorn watches /app/backend for file
changes and reloads the ASGI app in place — no `supervisorctl restart`
needed for backend edits."

### 2. Pre-fix reload storm — sample from `backend.err.log`

The 04:24–06:16 window (before I removed `--reload`) contained
**14 spurious reload events**. Representative samples:

```
2026-09-22 04:23:05: 'backup_service.py'  → Reloading
2026-09-22 04:25:36: 'backup_service.py'  → Reloading  ← 2 min after
2026-09-22 05:53:47: 'backup_service.py'  → Reloading
2026-09-22 05:56:16: 'server.py'          → Reloading
2026-09-22 06:04:18: 'server.py'          → Reloading
2026-09-22 06:06:29: 'forms.py'           → Reloading
2026-09-22 06:14:26: 'white_card_seed.py' → Reloading
2026-09-22 06:16:26: 'backup_service.py'  → Reloading

INFO:     Started reloader process [102] using WatchFiles
```

Yet at the time of every one of those "changes", the `.py` files had
been *stable* (verified via `find /app/backend -type f -mmin -60
-not -path '*__pycache__*'` → empty result). WatchFiles was firing
on real inode events triggered by tool-driven edits from parallel
agents / operators, not from code changes on disk.

Cross-check: the same window shows `supervisord daemonizing` restarts
of the **entire supervisor** every ~5–8 min. Two separate class of
failures were compounding — see "Not resolved" below.

### 3. Culprit paths

`.py` files — not `.pyc`, not log files, not temp files. That ruled
out Option A (`--reload-exclude`) because you can't exclude the very
directory `--reload` is meant to watch.

## Fix chosen: **Option B — Drop `--reload` entirely**

Edited `/etc/supervisor/conf.d/supervisord.conf` `[program:backend]`
command line to:

```
command=/root/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 \
        --workers 1
```

Applied via `supervisorctl reread && supervisorctl update`.

### Why Option B, not A

- WatchFiles was firing on real `.py` files, so `--reload-exclude
  '*.pyc'` / `'__pycache__/*'` / `'*.log'` would have skipped nothing.
- Preview / production pods have zero dev workflow that requires
  hot-reload. Every editor (main agent, fork agents, human operators)
  runs `sudo supervisorctl restart backend` after `.py` edits — a
  4-second cost that beats the class of bug entirely.
- Option C (move snapshot temp dirs) didn't apply — snapshot buffers
  are `io.BytesIO`, drop-zone writes go to `/app/backups/outgoing/`
  which is outside `--reload-dir /app/backend`.

### `entrypoint.sh` compatibility

`entrypoint.sh` uses `sed -i "s|{{RELOAD_FLAG}}|${RELOAD_FLAG}|g"`
against the supervisor config on every pod boot. Because my edit
**removes the `{{RELOAD_FLAG}}` placeholder entirely** (replaces the
line with a hard-coded command), subsequent boots do not re-inject
`--reload`. Verified: fix survived four pod restarts during this
session (07:29, 07:36, 07:59, 08:05, 08:09, 08:16, 08:23).

## Verification

### 1. Config change persisted across pod restarts

```
$ grep "command=/root/.venv/bin/uvicorn" /etc/supervisor/conf.d/supervisord.conf
command=/root/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --workers 1

$ ps -ef | grep 'uvicorn server:app' | grep -v grep
root   111  95  8 08:23 ? 00:00:04 /root/.venv/bin/python /root/.venv/bin/uvicorn
                                    server:app --host 0.0.0.0 --port 8001 --workers 1
```

No `--reload`, no `--reload-dir` on the running process.

### 2. Zero WatchFiles/reloader events post-fix

```
$ awk '/2026-09-22 07:29/,0' /var/log/supervisor/backend.err.log \
  | grep -iE "WatchFiles|Reloading|Started reloader" | wc -l
0
```

Across the ~55 min post-fix observation window (07:29 → 08:24), the
autoreload storm is definitively silent.

### 3. `.132ks` reclaim + WARN logic untouched

```
$ curl -s http://localhost:8001/api/health | jq '.checks.backup_lock'
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
```

The reclaim counter (=1, from `.132ks` verification), the 30-min
stale threshold, and the persistent lock health surface all remain
intact.

---

## Not resolved in `.132kv` — flagged as follow-up `.132kw`

**Pod-level restart cycling.** Even after removing `--reload`, the
*entire supervisor daemon* (not just the backend program) is being
respawned by the platform layer every 3–8 minutes:

```
$ grep "supervisord started with pid" /var/log/supervisor/supervisord.log \
  | tail -8
2026-09-22 07:29:43,927 INFO supervisord started with pid 94
2026-09-22 07:36:23,254 INFO supervisord started with pid 94
2026-09-22 07:59:06,333 INFO supervisord started with pid 94
2026-09-22 08:05:53,801 INFO supervisord started with pid 94
2026-09-22 08:09:10,692 INFO supervisord started with pid 94
2026-09-22 08:16:17,056 INFO supervisord started with pid 102
2026-09-22 08:23:25,118 INFO supervisord started with pid 95
```

This kills every long-running write inside the container, including
the snapshot writer, so the catch-up cycle **still can't complete
under these conditions**.

Consequences for this ship:
- Widget still shows `stale` (last delivery age 30+ h) because no
  fresh snapshot could complete in the 3–8 min windows between pod
  restarts.
- Historically successful snapshots completed in ~90 s on 20/09 and
  21/09 — so once the pod stabilises, the `.132ks` reclaim + this
  ship's storm fix will let the natural 6 h scheduler recover the
  cadence without further intervention.

**Recommended `.132kw` follow-up work:**
1. Diagnose why supervisor daemonises every 3–8 min. Candidates:
   platform reconciler tick, session-scoped kubelet churn, container
   memory pressure (currently at ~5 GB / 8 GB limit), or a
   session-boundary watchdog.
2. If the platform-layer cycling is unavoidable in the preview pod,
   restructure the snapshot writer to stream to disk (not `io.BytesIO`)
   and checkpoint per-collection so a restart resumes rather than
   restarts. See `backend/backup_service.py::_do_snapshot`.
3. Consider excluding `upload_storage.chunks` (~5 k rows / ~1.3 GB
   binary payload) from the default snapshot — that collection is
   the dominant CPU cost during ZIP_DEFLATED and would slash normal
   run time from ~90 s to ~15 s, giving huge grace inside a small
   pod-stable window.

## Files touched

- `/etc/supervisor/conf.d/supervisord.conf` — `[program:backend]`
  command line: dropped `--reload --reload-dir /app/backend`,
  added `.132kv` rationale + a `.132kw` follow-up pointer in the
  comment block.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132kv` +
  prose header covering choice of Option B and follow-up state.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132kv`.

## Not changed

- `.132ks` reclaim / WARN / health-surface code paths — untouched.
- `/app/mobile/` — untouched (mobile edit ban).
- `entrypoint.sh` — untouched (the `{{RELOAD_FLAG}}` template
  substitution is now a no-op on our edited config, which is what
  we want).
