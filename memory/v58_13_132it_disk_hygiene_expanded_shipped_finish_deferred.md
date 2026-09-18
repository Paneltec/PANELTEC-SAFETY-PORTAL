# v58.13.132it — Expanded disk hygiene + threshold 85% → 80% · SHIPPED (finish deferred)

**Ship phase:** `.132it`
**Scope:** Tighten `/app` disk hygiene after the `.132is` outage where the pod hit 100% and MongoDB went FATAL before the 85%-threshold cron could fire.

## What shipped

### `scripts/purge_webpack_cache_if_full.sh` — full rewrite

- **Threshold lowered:** `85 → 80` (default). Overridable via `THRESHOLD` env var.
- **Static targets** (unchanged): `/app/frontend/node_modules/.cache`, `/app/mobile/node_modules/.cache`.
- **NEW — pattern sweeps** (`find` under `/app`):
  - `__pycache__/`
  - `.pytest_cache/`
- **NEW — /tmp targets** (wipe contents):
  - `/tmp/lo_scratch/` (was already there)
  - `/tmp/metro-cache/` (was already there)
  - `/tmp/.pw-*` (Playwright temp dirs — new)
- **NEW — rotated log archives**:
  - `/var/log/supervisor/*.log.*`
  - `/var/log/supervisor/*.gz`
- **NEW — `git gc --aggressive --prune=now`** on `/app/.git`, wrapped in a 120s `timeout`. Only runs if the earlier cheap steps didn't get us under threshold, since gc is expensive.

### Per-target MB accounting

Every purged path now writes an explicit MB-freed line to `/var/log/paneltec-disk-hygiene.log`, plus a summary line with `free_before`, `free_after`, and `total_freed` in MB.

Example from the ship-time trigger (93% → 97% because Metro was rebuilding in parallel, but the accounting is honest):

```
2026-09-18T23:47:49Z TRIGGER /app usage=93% >= threshold=80% free_before=737.5MB
2026-09-18T23:47:49Z   purged /app/frontend/node_modules/.cache (1.6MB)
2026-09-18T23:47:49Z   purged __pycache__/* under /app (3.9MB)
2026-09-18T23:49:06Z   git gc /app/.git (78.0MB reclaimed, 248868K → 168972K)
2026-09-18T23:49:06Z DONE /app usage=97% free_after=362.4MB total_freed=83.5MB
```

`git gc` reclaimed **78 MB** — biggest single win, previously unreleased.

### `scripts/paneltec-disk-hygiene.cron.reference`

Header comment bumped to reflect the new 80% threshold (schedule unchanged: `*/5 * * * *`).

## Behavioural summary

| Trigger scenario                          | Before `.132it`          | After `.132it`                             |
|-------------------------------------------|--------------------------|--------------------------------------------|
| Usage crosses 80%                         | no-op                    | **purge fires**                            |
| Usage crosses 85%                         | purge fires              | purge fires (5 min earlier at 80%)         |
| Purge frees only cache dirs               | ~500–700 MB typical      | + `__pycache__` + `.pytest_cache` + Playwright + rotated logs |
| `.git` grows unboundedly                  | never reaped             | **gc + prune=now** when threshold breached |
| Log lacks per-target breakdown            | one summary line         | per-path MB line + before/after summary    |

## Version pin (lockstep)

- `RUNNING_VERSION`        → `paneltec-v160.3.9.58.13.132it`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132it`
- `CACHE_VERSION` (SW)     → `paneltec-v160.3.9.58.13.132it`

## Ban compliance

- No `/app/mobile/` edits.
- No pytest / Playwright per standing rule; `bash -n` syntax check only.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Follow-up (not blocking)

The pod's `/app` mount is 9.8 GB and hosts `/data/db` (5.6 GB) + `frontend/` (1.5 GB) + `mobile/` (557 MB) + `.git` (245 MB pre-gc). Structurally undersized — this ship gives us more headroom but a real fix means either (a) larger pod disk, (b) moving `/data/db` off the same mount, or (c) trimming the mobile bundle footprint. Flagging but not shipping.
