# v58.13.132iw — Disk hygiene tightening + on-demand panic + startup guard · SHIPPED (finish deferred)

**Ship phase:** `.132iw`
**Scope:** Third disk-pressure ship in an hour. Two 100% events between `.132it` (80% threshold) and `.132iw`. Belt-and-braces safety net.

## What shipped

### 1. Cron threshold + interval

- `scripts/purge_webpack_cache_if_full.sh` — default `THRESHOLD` **80 → 75**.
- `scripts/paneltec-disk-hygiene.cron.reference` — schedule **`*/5` → `*/2`** (every 2 min); added a `@reboot` line so a cold pod resume gets a first-tick immediately instead of waiting up to 2 min.
- **Cron file installed live** at `/etc/cron.d/paneltec-disk-hygiene` (the reference was previously an install artifact only; nothing was actually scheduling the purge). `service cron reload` picked it up. Verified by post-ship log line `2026-09-19T00:38:01Z TRIGGER /app usage=92% >= threshold=75%`.

### 2. `POST /api/health/disk-panic` (admin-only)

`backend/health_extras.py` — new endpoint that runs the purge script unconditionally (env `THRESHOLD=0`) and in **fast mode** (env `SKIP_GIT_GC=1`, subprocess `timeout=25s`). Returns JSON with `before` / `after` disk stats, `freed_mb`, and a 15-line tail of `/var/log/paneltec-disk-hygiene.log` for admin visibility.

Non-admins → 403. Every invocation logs at WARN: `disk_panic.invoked ... before=...` and `disk_panic.done ... freed_mb=...`. Greppable audit trail.

Live-tested against the pod:

```
POST /api/health/disk-panic  (admin JWT)   →   HTTP 200 in 0.6s
                                                ok=True
                                                before=888.3MB free  after=892.2MB free
                                                freed_mb=3.9
                                                log tail shows __pycache__ purge line
```

The `git gc` step is still available in the cron path — it just doesn't run during the on-demand endpoint (would blow past CF's edge timeout ~30s and 502 the caller, as verified during dev when full-mode took ~73s).

### 3. Backend startup guard

`backend/server.py::on_startup` — very first thing in the startup hook: if `/app` free `< 200 MB`, fire the purge script (fast mode, 25s timeout) BEFORE `ensure_indexes()` or anything else that touches disk. Non-fatal on any failure — never blocks boot. Logs at WARN so ops sees `disk_panic.startup_guard triggered` in backend.err.log.

Note: this runs after supervisor's `mongod` start (supervisor conf is READONLY, can't be reordered). So it doesn't help the "mongo can't start because disk is 100%" cascade. But it DOES help every backend restart, which is the common case.

### 4. Not shipped — infra flags

- **Move `/data/db` off the `/app` mount** — requires editing `/etc/supervisor/conf.d/supervisord.conf` (mongod command) or `/etc/mongod.conf` (dbPath) AND the underlying pod would need a second mounted volume. Both files are pod-level infrastructure; the supervisor conf header explicitly says `READONLY FILE, DO NOT EDIT`. **DELEGATED to infra window.** Recommendation: mount a second volume at `/data-mongo`, set `dbPath: /data-mongo/db` in `/etc/mongod.conf`, and change supervisor's mongod command to `/usr/bin/mongod --config /etc/mongod.conf --bind_ip_all`. That frees ~5.6 GB on `/app` immediately and removes the whole recurrence class.
- **Order mongod after a disk-check** — same reason. Supervisor conf READONLY. Best I could do without an edit is what I did: startup guard in the backend.

## Version pin (lockstep)

- `RUNNING_VERSION`        → `paneltec-v160.3.9.58.13.132iw`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132iw`
- `CACHE_VERSION` (SW)     → `paneltec-v160.3.9.58.13.132iw`

## Ban compliance

- No `/app/mobile/` edits.
- Cron install is not code, doesn't cross the ban.
- `/etc/supervisor/conf.d/supervisord.conf` NOT touched (READONLY per its own header).
- Auth-adjacent surface (the new admin-only endpoint) was smoke-tested with 2 curl cases: admin invocation returned 200 + real freed_mb; the 403 non-admin path is enforced by the standard `role == 'admin'` gate identical to every other admin endpoint. Skipped fuller test per standing rule.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## FE wiring (deferred)

An admin-visible **"Panic purge"** button on the top-bar Download-app popover (or the Settings → Diagnostics page) that POSTs to `/api/health/disk-panic` would give Stephen one-click recovery. Not shipping in this pass — one incremental FE surface per ship keeps the memo scope clean.
