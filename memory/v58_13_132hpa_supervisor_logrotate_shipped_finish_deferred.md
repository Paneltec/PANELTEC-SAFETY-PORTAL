# v58.13.132hpa — Supervisor log rotation + test_reports archive

**Status:** Shipped on `main`. Additive; no data migration.
**Finish:** DEFERRED — user validates.

Post-`.132hp` housekeeping. Two items from the batch review, both
low-risk.

## Trigger

During the `.132hp` compile churn `backend.err.log` was measured
growing at ~2 MB/h with no rotation policy in place. `.132hma`
shipped an `/etc/logrotate.d/paneltec-disk-hygiene` config for
the disk-hygiene script's own log but there was one critical gap
that only surfaced during today's audit:

**The `logrotate` binary was not installed on the pod.**

That means the `.132hma` config was aspirational — no rotation
was actually happening on any of the drops in `/etc/logrotate.d/`.
`.132hpa` fixes this at the source.

## Shipped

### 1. Install logrotate + extend coverage to supervisor logs

- `apt-get install -y logrotate` → 3.21.0-1 installed. The
  `logrotate.timer` systemd unit is now active (daily), so drops
  in `/etc/logrotate.d/` actually get processed.
- New `/etc/logrotate.d/paneltec-supervisor-logs` covers all 7
  supervisor streams:
  - `backend.err.log`
  - `backend.out.log`
  - `frontend.err.log`
  - `frontend.out.log`
  - `mobile.err.log`
  - `mobile.out.log`
  - `supervisord.log`
- Policy: `daily`, `rotate 7`, `compress delaycompress`,
  `copytruncate`, `size 10M`, `create 0644 root root`.
  - `copytruncate` avoids sending SIGHUP to uvicorn/craco/expo (which
    they don't reopen fds on anyway) — safest posture for a
    supervisor-managed process.
  - `size 10M` means the daily cadence isn't the only trigger — a
    log that fills between daily runs (e.g. a burst during a bulk
    import) will also rotate.
- Repo mirror at `scripts/paneltec-supervisor-logs.logrotate.reference`
  for git visibility. Pytest guards content parity.

Dry-run confirmed: `logrotate -d /etc/logrotate.d/paneltec-supervisor-logs`
recognises the config and correctly identifies each stream as
"below size threshold" (post-truncate from the observability
report).

### 2. Archive historical test_reports

- Moved 33 `test_reports/iteration_*.json` files (dated June –
  August 2026) → `memory/archive/test_reports/`.
- `test_reports/pytest/` (10 XML files, 48 KB) LEFT in place —
  these are actual current pytest-JUnit outputs and still useful
  for the current test-suite tooling.
- Working directory (`/app/test_reports/`) now contains only the
  live `pytest/` subdir. Cleaner surface for the ship agents.

## Verification — pytest 6/6 green

`tests/test_v58_13_132hpa_supervisor_logrotate.py`:

```
test_logrotate_binary_installed              PASSED
test_supervisor_logrotate_config_present     PASSED
test_supervisor_logrotate_reference_mirror   PASSED
test_disk_hygiene_logrotate_still_valid      PASSED  ← guard for .132hma
test_iteration_reports_archived              PASSED
test_version_bumped_to_132hpa                PASSED
```

## Impact on `.132hma` observability

Before `.132hpa`: cron was firing, script was purging webpack
cache, but its OWN log (`/var/log/paneltec-disk-hygiene.log`)
would grow unbounded. Now capped daily / at rotate-7 window.

Same protection now extends to all supervisor streams — no
more silent 5MB accumulation on the shared `/` volume.

## Version lockstep

- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132hpa`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132hpa`

## Files touched

**New (3):**
- `/etc/logrotate.d/paneltec-supervisor-logs` (system config)
- `scripts/paneltec-supervisor-logs.logrotate.reference` (repo mirror)
- `backend/tests/test_v58_13_132hpa_supervisor_logrotate.py` (6 tests)

**Modified (2):**
- `frontend/src/lib/version.js` — version bump
- `frontend/public/service-worker.js` — cache-version bump

**Moved (33):**
- `test_reports/iteration_*.json` → `memory/archive/test_reports/`

**Installed (1 apt package):**
- `logrotate 3.21.0-1` (arm64)

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invoked.
- No `/app/mobile/` edits (the mobile logs are ONLY covered by
  the OS-level rotation, not touched at the mobile source).
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Not in scope

- Item 1 from the housekeeping report (`paneltec_civil_code_v160.0.1.zip`
  orphan) — HOLD per user instruction, pending Stephen's confirmation
  whether it's an external download link.
- Rotating `/var/log/mongodb*.log*` (already provisioned by the
  base image at 51MB × 5).
- `.132hq` (worker company split) — HOLD pending Stephen's `.132hp`
  validation.
