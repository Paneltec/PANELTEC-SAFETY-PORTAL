# v58.13.132gw — Backup POST pre-flight disk guard · SHIPPED (finish deferred)

## Scope

Pulled forward per Stephen's urgent ask after `.132gu` was
truncated on a 100 %-full `/app` mid-edit (third recurrence in a
row). Adds a pre-flight disk check to
`POST /api/backup/snapshots` — returns **HTTP 507 (Insufficient
Storage)** when `/app` free-space drops below 10 %.

Without this, the snapshot writer would either:

* Truncate the temporary ZIP mid-write and store a corrupt
  manifest row.
* Blow up with `[Errno 28] No space left on device`, surface as
  502 to the FE (because the writer runs post-`BackgroundTasks`
  handoff), and leave the FE polling forever on a
  `status: 'queued'` placeholder that will never flip to `ready`.

The 507 is caught cleanly by the existing Backup-tab error toast
so Stephen sees the actionable message instead of a mystery 502
or a stuck spinner.

## Files changed

```
backend/backup_service.py                                +40 −3
  · shutil.disk_usage("/app") probe at the top of create_snapshot.
  · Raises HTTPException(507, detail=...) when free_pct < 10.
  · Probe failure falls through with a warning log — defensive
    only, not authoritative gate.

backend/tests/test_v58_13_132gw_backup_disk_guard.py     NEW · 5 checks (4 pass + 1 skip on <10% pod)

frontend/src/lib/version.js                              RUNNING/EXPECTED → .132gw
frontend/public/service-worker.js                        CACHE_VERSION → .132gw
memory/v58_13_132gw_backup_disk_guard_shipped_finish_deferred.md   NEW (this)
```

## Behaviour

```python
usage = shutil.disk_usage("/app")
free_pct = (usage.free / usage.total) * 100 if usage.total else 100
if free_pct < 10:
    raise HTTPException(
        status_code=507,
        detail=(
            f"Insufficient disk space on /app: {free_pct:.1f}% free "
            f"({usage.free // (1024*1024)} MB / "
            f"{usage.total // (1024*1024)} MB). "
            "Free at least 10% before triggering a snapshot. "
            "Common cleanups: purge old backups, clear "
            "frontend/node_modules/.cache, rotate application logs."
        ),
    )
```

Probe target is `/app` (the writable snapshot volume) — NOT `/`
(overlay), which reports a wildly different free-pct on this pod
topology. Pinned by `test_disk_guard_probes_app_volume`.

The nested `except Exception` around the probe intentionally logs
+ falls through rather than re-raising. If the stdlib probe
itself regresses in a future Python version we'd rather attempt
the backup than fail-closed on a probing bug. Pinned by
`test_probe_failure_falls_through_not_raises`.

## Live verification (this pod)

```
$ df -h /app
Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n2    9.8G  9.2G  641M  94% /app

$ curl -X POST -H "Authorization: Bearer <admin>" \
       "$API/backup/snapshots"
HTTP/1.1 507 Insufficient Storage
{"detail":"Insufficient disk space on /app: 6.4% free
(640 MB / 9979 MB). Free at least 10% before triggering
a snapshot. Common cleanups: purge old backups, clear
frontend/node_modules/.cache, rotate application logs."}
```

Guard fires end-to-end. FE will surface the `detail` string
via the existing `apiError()` toast pipeline.

## Pytest

```
$ pytest backend/tests/test_v58_13_132gw_backup_disk_guard.py -v
4 passed, 1 skipped in 0.03s
```

Coverage:

* Guard block pinned inside `create_snapshot` (regex covers the
  `free_pct = (usage.free / usage.total) * 100` + `if free_pct < 10:`
  branch shape).
* `status_code=507` is used (not 500/503).
* Probe targets `/app` explicitly.
* Probe-failure fall-through path exists.
* Version pins on all three canonical files.
* **Skipped:** happy-path 200/202 verification — the pod is
  genuinely below 10 % free right now (6.4 %), which is
  exactly the failure mode the guard was built for. The skip is
  a clean signal (not a failure) that the branch under test
  is the one currently active.

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester` invoked.
* `/app/mobile/` untouched.
* CRA — no Vite migration.
* Version bumped in `version.js` (RUNNING + EXPECTED) and
  `service-worker.js` (CACHE_VERSION).
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Deferred / follow-ups

* **Phase 4 (bug fixes)** — Pre-start Select-Vehicle dropdown
  empty, SSRAs incorrectly in Risk Assessments tab. Ready to
  ship next as `.132gx`.
* **Retention auto-trigger after each snapshot** (`.132gr`
  backlog) — still worth doing but no longer urgent now that the
  pre-flight guard blocks the "snapshot corrupts on a full disk"
  regression path.

## Message for Stephen

Immediate action item (this pod is currently at 6.4 % free —
your next backup attempt will now hit **HTTP 507** with a clean
error toast instead of a 502 / truncated writer):

1. Clear the webpack cache: `rm -rf /app/frontend/node_modules/.cache`
2. Rotate backup snapshots to your UGREEN NAS via the existing
   Backup tab, then delete the local `bk_snapshots` rows older
   than 30 days.
3. Rotate `/var/log/supervisor/*.log` if any are >100 MB.

Once free-pct climbs above 10 %, the backup endpoint returns to
its normal 200/202 (queued) response. No FE change needed — the
existing error toast handles the 507 detail string.
