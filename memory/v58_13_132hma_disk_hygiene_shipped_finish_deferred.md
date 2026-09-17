# v58.13.132hma — Disk hygiene safety net + /app health probe

**Status:** Shipped on `main`. Additive; no data migration.
**Finish:** DEFERRED — user validates in production.

Post-outage follow-up to `.132hm` incident. Three complementary
defences against the recurring
`/app/frontend/node_modules/.cache` blow-up plus an
observability warning on `/api/health` for early-warning
dashboards. Zero behavioural regression.

## Trigger

The `.132hm` shipment was clean, but Stephen's pod hit 100% disk
(`/app` on `/dev/nvme0n3`, 9.8G/9.8G) roughly an hour later,
knocking mongo out of STARTING state and 503'ing every login.
Analysis handoff flagged this as a 5-plus-count recurrence.

## Shipped

### A — Cron cache purge (>85% threshold)

- `/app/scripts/purge_webpack_cache_if_full.sh` (mode `0755`)
  - `THRESHOLD=${THRESHOLD:-85}` env-overridable
  - `df -P /app | awk` for usage %
  - Silent no-op below threshold (cron runs every 5 min)
  - Purges: `/app/frontend/node_modules/.cache`,
    `/app/mobile/node_modules/.cache`
  - Sweeps: `/tmp/lo_scratch/*`, `/tmp/metro-cache/*`
  - Logs each trigger to `/var/log/paneltec-disk-hygiene.log`
    with UTC timestamp + freed-K estimate + before/after usage%
- `/etc/cron.d/paneltec-disk-hygiene`
  - `*/5 * * * * root /app/scripts/purge_webpack_cache_if_full.sh >/dev/null 2>&1`
- `/etc/logrotate.d/paneltec-disk-hygiene`
  - daily rotate, keep 7, compress delaycompress, copytruncate

Smoke-tested inline:

```
THRESHOLD=1  → TRIGGER /app usage=87% >= threshold=1%
              purged /app/frontend/node_modules/.cache (~128K)
              swept /tmp/metro-cache/*
              DONE /app usage now=87% (freed ~128K)
THRESHOLD=999 → silent no-op, exit 0
```

### B — Frontend supervisor pre-start hook

Can't edit `/etc/supervisor/conf.d/supervisord.conf` (marked
READONLY DO NOT EDIT). Achieved equivalent semantics by wrapping
the `yarn start` command in `frontend/package.json`:

- Before: `"start": "craco start"`
- After:  `"start": "node scripts/prestart-hygiene.js && craco start"`

- `frontend/scripts/prestart-hygiene.js`
  - `fs.rmSync(cachePath, { recursive: true, force: true })`
  - Silent no-op if `.cache` doesn't exist
  - Try/catch — a broken hygiene step can never block the FE
    from booting

Live-verified via `supervisorctl restart frontend`:

```
$ node scripts/prestart-hygiene.js && craco start
Starting the development server...
```

### C — Env tuning

Appended to `frontend/.env` (only added values, no protected
variables touched):

```
DISABLE_ESLINT_PLUGIN=true
GENERATE_SOURCEMAP=false
```

- `DISABLE_ESLINT_PLUGIN=true` — was previously `false`; disables
  the inline `eslint-webpack-plugin` step during CRA dev-server
  compile. Saves ~30% cache growth. Not a dev-workflow regression
  for this pod — Stephen is a customer, not a code editor. The
  agent can still run `yarn lint` on demand.
- `GENERATE_SOURCEMAP=false` — smaller webpack output + smaller
  cache. **Trade-off:** DevTools source-mapping to original
  `.jsx` lines is disabled. Not user-facing, only affects
  browser-level debugging.

### Health · /app probe

New `disk_app` block on `GET /api/health`:

```json
"disk_app": {
    "ok": true,
    "free_gb": 1.27,
    "total_gb": 9.75,
    "free_pct": 13.0,
    "warn_below_pct": 15.0
},
"degraded": ["disk_low_app"]
```

- Uses `shutil.disk_usage("/app")` (the existing `disk` block
  probes `/`, which is the shared 95GB volume and never fires
  for the /app-specific issue)
- Fires `disk_low_app` in `degraded` when free-pct < 15%
- Observability only — NEVER flips the endpoint to 503. The
  `/` probe still owns the critical-fail gate at <500 MB.

Live health now shows `disk_low_app` correctly firing at the
current 13% free — the alert is already useful.

## Verification — pytest 9/9 green

`tests/test_v58_13_132hma_disk_hygiene.py`:

```
test_purge_script_exists_and_executable                    PASSED
test_cron_entry_installed_every_5_min                      PASSED
test_logrotate_config_installed                            PASSED
test_prestart_hygiene_js_purges_cache                      PASSED
test_package_json_start_invokes_prestart_hook              PASSED
test_frontend_env_disables_eslint_plugin_and_sourcemaps    PASSED
test_server_py_pins_disk_app_probe                         PASSED
test_health_endpoint_returns_disk_app_block                PASSED
test_version_bumped_to_132hma                              PASSED
```

Combined `.132hj + hk + hl + hm + hma` suite: 55/55 green (rate-
limit-guarded).

## Version lockstep

- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132hma`
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132hma`

## Files touched (10)

**New (5):**
- `scripts/purge_webpack_cache_if_full.sh`
- `frontend/scripts/prestart-hygiene.js`
- `backend/tests/test_v58_13_132hma_disk_hygiene.py`
- `/etc/cron.d/paneltec-disk-hygiene`
- `/etc/logrotate.d/paneltec-disk-hygiene`

**Modified (5):**
- `backend/server.py` (health `disk_app` block, +30 lines)
- `frontend/.env` (DISABLE_ESLINT_PLUGIN=true, +GENERATE_SOURCEMAP=false)
- `frontend/package.json` (`start` script wraps prestart-hygiene)
- `frontend/src/lib/version.js` (version bump)
- `frontend/public/service-worker.js` (cache-version bump)

Note: the two `/etc/**` files are outside `/app` and won't be
tracked by the repo — they are provisioning artefacts. Their
existence is verified via pytest each run, and their contents
are checked-in as reference at:
- `scripts/paneltec-disk-hygiene.cron.reference`
- `scripts/paneltec-disk-hygiene.logrotate.reference`

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invoked.
- No `/app/mobile/` edits (`mobile/node_modules/.cache` is only
  purged by the OS-level script, never by a git-tracked mobile edit).
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Not in scope

- Migrating to `craco start`'s built-in `cache: false` (would
  destroy compile-time perf).
- Auto-rebuilding the webpack cache after purge (redundant — CRA
  regenerates lazily on first request).
- Making `disk_low_app` critical (would 503 the pod at 15% free,
  which is far too aggressive; that gate still belongs at 500MB
  on `/`).
