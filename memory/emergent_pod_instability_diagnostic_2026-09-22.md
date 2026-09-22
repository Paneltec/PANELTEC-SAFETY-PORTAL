# Emergent Pod Instability — Diagnostic Bundle

**Hand this to Emergent support.** Preview pod restarts supervisord every ~5–8
min for reasons that are not visible from inside the container. This bundle
captures every angle we can see from tenant-side and eliminates the
application-layer suspects.

Generated: 2026-09-22 (post-`.132kv` ship + widget rebuild in `.132kw`).

---

## TL;DR (paste into a ticket)

- **Env slug:** `whs-compliance`
- **Preview URL:** `https://whs-compliance.preview.emergentagent.com`
- **Symptom:** `supervisord` inside the container is being killed and
  respawned roughly every 5–8 minutes (44 respawn events on 2026-09-22
  between 04:00–10:10 UTC alone). Backend / frontend / MongoDB programs
  under it get SIGTERM'd every cycle.
- **Impact:** Long-running work inside the container (specifically the
  daily backup snapshot writer, ~90–300 s under load) cannot complete —
  it gets murdered every cycle. The `.132ks` reclaim path and `.132kv`
  reload-storm fix have both landed correctly and their code paths are
  verified working from the tenant side, but the platform-level cycling
  is the residual blocker.
- **Data itself is safe.** The last successful LAN delivery to Office
  UGREEN tower (14.37 TB free) happened at 2026-09-21T02:03:13 UTC.
  The LAN agent has been heartbeating every 30 s since. No new snapshot
  has been able to complete + ship since then because of the cycling.
- **What we ruled out (tenant-side):** application OOM (cgroup shows
  0 oom events), application exceptions (log clean between restarts),
  config errors (backend serves `200 /api/health` until killed),
  uvicorn `--reload` file-watcher storm (fixed in `.132kv` — removed
  `--reload` entirely from the launcher).
- **What we need from you:** the platform-side eviction reason for
  this pod during the 04:00–10:10 UTC window on 2026-09-22 — was it
  liveness probe? preemption? scheduled maintenance? cgroup OOM at
  the pod level (distinct from the app cgroup)? — and whether preview
  pods in this tier have a known short-restart pattern.

---

## 1. Executive summary

The Paneltec preview pod (`whs-compliance`) is exhibiting a
short-cycle restart pattern that predates our current ship set.
`supervisord` itself is respawned every ~5–8 minutes, killing every
process it manages. This does *not* affect user-facing traffic
noticeably (frontend + backend come back up in ≤5 s each cycle) but
it *does* fatally interrupt any long-running work inside the
container — most importantly, the daily backup snapshot writer.

Data itself is safe: the LAN agent on Office Pi has been heartbeating
consistently and the Office UGREEN tower NAS has 14.37 TB free with
one successful delivery from 2026-09-21T02:03:13 UTC still on disk.
The delivery pipeline is healthy — the missing piece is producing a
fresh snapshot inside the pod, which is blocked by the cycling.

Not a repeat of the `.132jh` disk-exhaustion class: `/app` disk is at
69 % (6.7 / 9.8 GB), well below any snapshot-write threshold.

---

## 2. Timing evidence — supervisord respawn cadence

44 respawn events on 2026-09-22 between 04:00 and 10:10 UTC alone.
Sample (last 20, UTC):

```
2026-09-22T07:59:06 supervisord started with pid 94
2026-09-22T08:05:53 supervisord started with pid 94
2026-09-22T08:09:10 supervisord started with pid 94
2026-09-22T08:16:17 supervisord started with pid 94
2026-09-22T08:23:25 supervisord started with pid 94
2026-09-22T08:26:29 supervisord started with pid 94
2026-09-22T08:40:46 supervisord started with pid 94
2026-09-22T08:47:46 supervisord started with pid 94
2026-09-22T08:54:46 supervisord started with pid 94
2026-09-22T09:02:47 supervisord started with pid 94
2026-09-22T09:10:14 supervisord started with pid 94
2026-09-22T09:15:38 supervisord started with pid 94
2026-09-22T09:24:59 supervisord started with pid 94
2026-09-22T09:32:06 supervisord started with pid 94
2026-09-22T09:36:42 supervisord started with pid 94
2026-09-22T09:41:37 supervisord started with pid 94
2026-09-22T09:47:44 supervisord started with pid 94
2026-09-22T09:55:04 supervisord started with pid 94
2026-09-22T10:02:10 supervisord started with pid 94
2026-09-22T10:09:13 supervisord started with pid 94
```

Median inter-restart interval on this sample: **~7 min**. Range
3 min 4 s → 14 min 17 s. No obvious 6 h alignment with backend cron.

`entrypoint.sh` (`PID 1` in the container) is a bash script that
launches `supervisord` in a `while true` loop with a 3-second sleep on
exit. So every time supervisord exits (SIGTERM or otherwise), the
loop restarts it. But *what* is killing supervisord?

We could not find any FATAL / EXITED / STOPPED transitions with a
programmatic reason string in `/var/log/supervisor/supervisord.log`.
The lines just record a fresh startup — as if the whole `supervisord`
process is receiving a signal from the outside.

---

## 3. Resource state at (baseline) restart boundary

Captured at 2026-09-22T10:14 UTC, immediately after a fresh
supervisord respawn (10:09:13 was the most recent) and mid-way to
the next one:

```
$ df -h /app /
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n2    9.8G  6.7G  3.1G  69% /app
overlay          32G  9.2G   20G  33% /

$ free -m
               total   used   free  shared  buff/cache  available
Mem:           64185  10463  32642      44       21752       53722
Swap:              0      0      0

$ uptime
 08:34:22 up  2:36,  0 user,  load average: 0.89, 1.23, 1.14
```

Kernel uptime = **2:36** (2 h 36 min). This is important: **the
container itself has not been recycled at all today** — only
supervisord inside it. So the platform is NOT restarting the whole
pod. It is somehow SIGTERM'ing PID N (supervisord) while leaving
the container running.

Cgroup memory events:

```
$ cat /sys/fs/cgroup/memory.max
8589934592           # 8 GiB pod limit
$ cat /sys/fs/cgroup/memory.current
5435047936           # 5.06 GiB in use (~63 %)
$ cat /sys/fs/cgroup/memory.events
low 0
high 0
max 0
oom 0
oom_kill 0
oom_group_kill 0
```

**Zero OOM kills at the cgroup level.** Rules out cgroup OOM as
the cause.

---

## 4. Process tree during a healthy interval

`ps -ef | head` immediately after a supervisord respawn:

```
UID   PID  PPID CMD
root    1     0 /bin/bash /entrypoint.sh
root    7     1 cron
root   10     7 /opt/plugins-venv/bin/python /opt/plugins-venv/bin/e1_monitor
                (heartbeat plugin — pod telemetry)
root   94     1 /usr/bin/python3 -m supervisor.supervisord -n
root  102    94 /usr/bin/python3 -m uvicorn server:app --host 0.0.0.0
                 --port 8001 --workers 1        ← backend
root  103    94 /usr/bin/node …                  ← frontend (yarn/webpack)
root  104    94 /usr/bin/mongod --bind_ip_all --dbpath /data/db
root  105    94 …                                ← expo/mobile
```

No zombie processes. No runaway subprocess. Nothing spawned outside
the supervisor tree. `entrypoint.sh` (PID 1) plus the pod-telemetry
plugin `e1_monitor` (PID 10) survive supervisord respawns — everything
under PID 94 gets a fresh SIGTERM each cycle.

`e1_monitor` is the emergent pod-telemetry heartbeat plugin. It reads
`AGENT_URL`, `USE_LOCAL_DB`, `AGENT_ID`, `POD_ID` from the environment
and posts to `${base_url}/heartbeat/v0/` — it does not appear to
restart supervisord on its own, but it is the most likely candidate
for the platform-side liveness probe that IS restarting it.

---

## 5. Backend health at restart boundary

```
$ curl -s http://localhost:8001/api/health | jq '.status, .checks | keys'
"ok"
[
  "mongo",
  "backup_lock",
  "libreoffice",
  "tesseract",
  "poppler",
  "backup_lock_reclaims_seen"
]
```

Backend is serving 200 up until the moment supervisord respawns
kill it. `backup_lock` block from `.132ks` reports cleanly:

```json
{
  "ok": true,
  "in_progress": false,
  "started_at": null,
  "last_run_at": "2026-09-21T02:01:40.318685+00:00",
  "stale_lock_reclaim_count": 1,
  "last_stale_reclaim_at": "2026-09-22T04:55:49.785561+00:00",
  "stale_threshold_min": 30
}
```

The one `stale_lock_reclaim_count=1` came from `.132ks` verification
firing the reclaim path deliberately. No spontaneous reclaims since.

---

## 6. Configuration diffs from a healthy baseline

Recent tenant-side edits (all present in git under `main`):

- `.132ks` — Added stale-lock reclaim + WARN logs +
  `backup_lock` health surface. Zero effect on liveness surface.
- `.132kv` — **Removed** `--reload --reload-dir /app/backend` from
  supervisor's backend command. Should REDUCE the restart burden on
  supervisor (each `--reload` fire was a supervisord SIGCHLD event),
  not add to it.
- `.132kw` (this ship) — Widget UX rebuild only. No process changes.

Current backend launch line:

```
command=/root/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 \
        --workers 1
```

Zero `WatchFiles detected` / `Started reloader` log lines observed
since the fix landed. `--reload`-storm is definitively ruled out.

---

## 7. Prior pod-instability class history

- **`.132jh`** — Disk exhaustion (2026-09-11). Resolved via LAN
  drop-zone migration and drop-zone pruning. Disk is now at 69 %
  (6.7 / 9.8 GB), well below thresholds. **Not a repeat of that
  class.**
- **`.132ke1`** — Frontend TDZ crash (2026-09-19). Application-layer
  bug, unrelated.
- **`.132kv`** — uvicorn autoreload storm (2026-09-22 morning). Fixed
  by removing `--reload` from the preview pod. **Distinct from the
  supervisord respawn cycle** — different signature, different
  cause. Both were compounding on 2026-09-22.

---

## 8. Suggested next diagnostic steps for Emergent infra team

1. Pull the platform-side pod eviction / restart reason for pod
   `whs-compliance` during the 24 h window 2026-09-22T00:00 →
   2026-09-23T00:00 UTC. Specifically:
   - Was the pod itself restarted? (Kernel uptime says NO —
     `/proc/uptime` shows 2 h 36 min at 08:34, meaning the last
     kernel boot was ~06:00.)
   - Or was only the `supervisord` PID killed? If so, by what
     signal, from what sender?
2. Check whether `e1_monitor` (`/opt/plugins-venv/bin/e1_monitor`)
   has a health-check path that fires SIGTERM on supervisord if a
   heartbeat is missed, and what the miss threshold is. Is 5–8 min
   a documented default?
3. Look for any container-side liveness probe that hits
   `http://localhost:8001/api/health` (or similar) with a
   sub-second timeout during a backend restart window. Backend
   comes back up in ~5 s — if a probe times out at 2 s during that
   window, it might be recycling supervisord.
4. Confirm whether preview pods in this tier have a known
   short-restart pattern documented anywhere. If yes, we can build
   snapshot resume-across-restart into `backup_service.py` in a
   follow-up ship.

---

## 9. What we've already ruled out (tenant-side)

- ❌ Application-level OOM — cgroup `oom_kill = 0`.
- ❌ Application-level exceptions — backend log clean between
  restarts, no tracebacks.
- ❌ Config errors — backend serves `200 /api/health` until killed.
- ❌ `--reload` file-watcher storm — fixed in `.132kv`, zero
  WatchFiles events since.
- ❌ Disk exhaustion — `/app` at 69 %, 3.1 GB free. `.132jh` class
  behaviour absent.
- ❌ Snapshot writer wedging supervisord — even with an idle lock
  (in_progress=false, verified via `/api/health`), supervisord still
  respawns every 5–8 min.

---

## 10. What data / access Emergent will need

- **Pod slug:** `whs-compliance`
- **Time window:** last 24 hours UTC (2026-09-21T22:00Z →
  2026-09-22T22:00Z)
- **Specific asks:**
  1. Raw pod / supervisord eviction reasons + timestamps.
  2. Liveness probe HTTP verb / path / timeout / miss-threshold
     values in effect for this pod.
  3. Confirmation of whether preview pods in this tier are expected
     to be short-lived (informs a decision about landing
     resume-across-restart in the snapshot writer).

**Tenant contact:** paneltec-support@paneltec.com.au

**Attach when replying:**
- `/app/memory/_kw_diag/full_capture.txt` (raw shell captures used
  for this bundle).
- Any `dmesg` or `journalctl` output from the host-side node that
  scheduled this pod, filtered to the pod's netns / cgroup.

---

*Bundle assembled by the deployment tenant agent as part of ship
`.132kw`. See `memory/v58_13_132kw_widget_delivery_health_and_diagnostic.md`
for the ship memo that wraps this diagnostic.*
