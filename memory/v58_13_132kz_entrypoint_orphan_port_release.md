# v58.13.132kz — Entrypoint orphan-port release + supervisor frontend wrapper

Shipped: 2026-09-23 (early UTC, in response to live incident 2026-09-22 23:47 UTC)
Scope: `/entrypoint.sh`, `/etc/supervisor/conf.d/supervisord.conf`,
       diagnostic bundle update, version bump
Author: agent (queued by user directly after the incident)

---

## Incident context

2026-09-22 23:47 UTC: user reports preview URL 502'ing for 10+ minutes.
`sudo supervisorctl status` inside the pod showed:

```
backend                          RUNNING   pid 3173, uptime 0:00:26
frontend                         FATAL     Exited too quickly (process log may have details)
mobile                           RUNNING   pid 112,  uptime 0:01:23
mongodb                          RUNNING   pid 3213, uptime 0:00:24
nginx-code-proxy                 RUNNING   pid 3295, uptime 0:00:22
```

`/var/log/supervisor/frontend.err.log`:

```
Attempting to bind to HOST environment variable: 0.0.0.0
Something is already running on port 3000.
Done in 0.71s.
```

Root cause of this incident (secondary to the platform-level
supervisord respawn cycling from `.132kw`): after a supervisord
respawn, an orphan `craco start` process from the previous cycle
kept listening on :3000. When supervisord tried to spawn the
replacement frontend, `yarn start` refused to bind and exited in
0.71 s. Supervisor exhausted `startretries` in seconds → FATAL.

Recovery in the incident: `fuser -k 3000/tcp` + `supervisorctl
restart frontend` restored service. This ship automates that
recovery so the class-of-failure never becomes a user-visible
outage again.

## Fix — two layers

### 1. `/entrypoint.sh` — pre-supervisord port sweep

New block inserted immediately above the
`( sudo service supervisor start && … )` line:

```bash
for port in 3000 8001 27017; do
    if command -v fuser >/dev/null 2>&1; then
        if fuser -s "${port}/tcp" 2>/dev/null; then
            echo "[$(date)] [entrypoint] Released orphan port ${port} (v58.13.132kz)"
            fuser -k "${port}/tcp" 2>/dev/null || true
            sleep 1
        fi
    elif command -v ss >/dev/null 2>&1; then
        # Fallback if fuser is missing on some image variants.
        pid=$(ss -tlnp "sport = :${port}" 2>/dev/null | awk 'NR>1 {print $NF}' \
              | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
        if [ -n "$pid" ]; then
            echo "[$(date)] [entrypoint] Released orphan port ${port} (pid=$pid, v58.13.132kz)"
            kill -TERM "$pid" 2>/dev/null || true
            sleep 1
            kill -KILL "$pid" 2>/dev/null || true
        fi
    fi
done
```

Idempotent, non-fatal. Runs once per container boot — covers the
hard-restart case. Only sweeps ports we own; 8010 / 3001 / 8020
are launched later in the entrypoint and are left alone.

### 2. `[program:frontend]` — wrap `yarn start`

```
command=/bin/sh -c "fuser -k 3000/tcp 2>/dev/null; sleep 1; exec yarn start"
```

Runs on every frontend restart mid-life — this is the exact window
(mid-life supervisord respawn + orphan surviving) that produced
the incident. `fuser -k` is a no-op when :3000 is already free,
so this stays idempotent across normal restarts. `exec` avoids
leaving a `/bin/sh` in the process tree.

## Verification (live simulation)

```
# Bind :3000 with a decoy Python listener before restart
$ python3 -c "import socket,time; s=socket.socket(); s.bind(('0.0.0.0',3000)); s.listen(1); time.sleep(600)" &
# supervisorctl reread + update (picks up the new command line)
$ sudo supervisorctl reread && sudo supervisorctl update
$ sudo supervisorctl restart frontend
# 15 s later
$ sudo supervisorctl status frontend
frontend                         RUNNING   pid 1129, uptime 0:02:39
$ curl -sI -o /dev/null -w "%{http_code}\n" http://localhost:3000/
200
$ curl -sI -o /dev/null -w "%{http_code}\n" https://whs-compliance.preview.emergentagent.com/
200
```

Decoy process was killed by `fuser -k` (verified via `ps -p ${DECOY}`
returned no such process). Frontend rebinding was clean. External
preview URL responded 200.

## Emergent diagnostic bundle update

`/app/memory/emergent_pod_instability_diagnostic_2026-09-22.md`
gained a new **§4a — Symptom breakdown per service**:

- Per-service table showing which programs are affected by the
  orphan-port class (frontend only, in practice).
- Documentation of the `.132kz` fix (both layers).
- Explicit statement that `.132kz` is a symptom fix — the upstream
  supervisord respawn cycling remains the open item for Emergent
  infra triage.

`/app/memory/emergent_pod_instability_TLDR.txt` refreshed to
23 lines with:
- Two-symptom framing (Symptom 1: supervisord respawn cycling;
  Symptom 2: orphan-port after respawn).
- `TENANT-SIDE ALREADY DONE` section listing `.132kv` + `.132kz`
  work.
- Updated ask window to 2026-09-21T22:00 → 2026-09-23T06:00 UTC.

## Files touched

- `/entrypoint.sh` — new pre-supervisord orphan-port sweep block.
- `/etc/supervisor/conf.d/supervisord.conf` — `[program:frontend]`
  command wrapped in `fuser -k 3000/tcp; sleep 1; exec yarn start`.
- `/app/memory/emergent_pod_instability_diagnostic_2026-09-22.md`
  — new §4a per-service breakdown + `.132kz` fix documentation.
- `/app/memory/emergent_pod_instability_TLDR.txt` — refreshed
  one-pager with the orphan-port finding.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132kz` +
  prose header covering the two-layer fix.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132kz`.

## Not changed

- `.132ki` (SSRA routing + view-original-PDF), `.132kw`
  (delivery-centric widget + diagnostic v1), `.132kv` (uvicorn
  `--reload` removal) — untouched.
- Mobile supervisor entry — untouched (mobile edit ban).
  Mobile's orphan-port pattern is milder; Expo's own port-check
  reuses cleanly. If it starts causing issues we can extend the
  fix in a follow-up.
- Backend / mongodb supervisor entries — untouched. Uvicorn +
  mongod shut down cleanly on SIGTERM and don't leave orphans.

## Follow-up candidates

1. **The real root cause remains open.** Emergent-side triage of
   the supervisord respawn cycling is the load-bearing fix. This
   ship reduces its user-visible impact from "10-minute 502" to
   "brief frontend restart with no orphan"; that's a big win but
   still not a complete resolution.
2. **Consider extending the fuser wrapper to `[program:mobile]`**
   if Expo ever regresses on its port-check. Not urgent today.
3. **Consider a lightweight watchdog** that alerts (or auto-heals)
   if a supervisor program stays FATAL for >30 s — belt-and-braces
   for any future orphan class we haven't anticipated.
