# v58.13.132jh — Backup snapshots off Mongo, LAN delivery contract fixed

## Emergent's letter (paraphrased)
Emergent's infra team traced the recurring `/app` disk-full crash cycle
to `backend/backup_service.py`. Snapshots (~400 MB each) were being
written INTO MongoDB via GridFS on the same 9.8 GB partition Mongo
itself was dumping. 41 archives were sitting in GridFS. The 7-day
age-based retention had no size or count cap. Trigger fan-out (POST +
6h cron + COB cron + startup catch-up + hourly watchdog) fired the
writer up to 5 times in a 10-minute window during hot-reload storms.
The existing `/etc/cron.d/paneltec-disk-hygiene` guard is wiped on
every pod rebuild — so mitigation kept regressing.

Emergent's ask was: externalize snapshot storage, cap retention by
size AND count, dedupe triggers, purge the 41 legacy archives, and
persist the disk-hygiene cron across pod rebuilds.

User course-correction (mid-ship): keep local NAS backups working
(the Pi + UGREEN pipeline the operator relies on), redirect snapshots
to a filesystem drop-zone instead of GridFS, aggressively cap the
pod-side footprint, and diagnose the 48-day "Last LAN Delivery"
STALE panel.

## Root cause 1 — disk-full recurrence (Emergent)
- 41 snapshots × ~130 MB compressed + 22,623 chunks + orphan blob
  overhead = **5.67 GB of storageSize inside `bk_fs.chunks`** at time
  of ship.
- `_apply_retention_policy` was running but the GFS defaults keep ALL
  from the last 7 days (28 snapshots × ~130 MB = ~3.6 GB just in the
  dense window). No count or size ceiling.
- Ceiling had no lock — 5 fires in 10 min was possible during hot
  reloads because the startup catch-up + 6h cron + COB cron all
  independently checked "last snapshot >25h old" and independently
  fired.

## Root cause 2 — 48-day "STALE" LAN Delivery ghost (user)
UI showed:
- Last write to `/data/paneltec-civil-<uuid>.zip` = 03/08/2026 19:55Z
- Backup agent alive (heartbeat 52 s ago)
- Pi disk 14.37 TB free (agent healthy)
- Panel verdict: STALE

Reality (`bk_agent_logs`):
- **120 successful ships between 03/08 and 20/09** including one at
  20/09 02:03Z (only 8.4 h before the panel screenshot).
- ZIP files consistently reaching `/data/paneltec-civil-*.zip` at
  400+ MB each.

Root cause: `agent_report()` line 2079 had
`if report.destination_id and report.status == "ok": …bump
last_written_at`. Post-.132ir migration (SMB→local_agent), the Pi
agent's report payload stopped setting `destination_id`. Every single
one of those 120 successful ships came through with
`destination_id=None`, so the guard skipped the destination-bump for
48 days straight even though the actual write to the NAS was fine.
The panel read `bk_destinations.last_written_at = 2026-08-03T09:55:39`
(the last successful pre-migration report) and dutifully reported
STALE.

Compounding: `lan_status.STALE_AFTER_H` was 6 h, but the backup cron
fires every 6 h — so EVERY inter-snapshot window read stale.

## What shipped

### 1. One-shot purge (executed before code changes)
`scripts/v58_13_132jh_purge_legacy_snapshots.py`

Deleted every row in `bk_snapshots`, `bk_fs.files`, `bk_fs.chunks`,
then ran `db.command(compact, <collection>)` on each. Emergent-managed
backups + PITR are the safety net for live data; these in-Mongo
snapshots were duplicative dumps of collections still in-place.

Results:
- **/app disk: 98% → 41%** (5.8 GB reclaimed to OS)
- **Mongo storageSize: 6065 MB → 390 MB**
- Snapshots evicted: 41 rows / 22,623 chunks / 4,943.4 MB
  (metadata-reported bytes)
- Compact times: bk_fs.chunks 2.9 s / bk_fs.files 1.4 s /
  bk_snapshots 0.9 s
- No live data touched.

### 2. Snapshot destination → filesystem drop-zone
`backend/backup_service.py::_do_snapshot`

- Writes ZIP to `os.path.join(LAN_DELIVERY_DROP_ZONE, "paneltec-
  snapshot-<uuid>.zip")` (default `/app/backups/outgoing`).
- Atomic write via `<path>.part` → `os.replace()` so a partial write
  never confuses the Pi.
- No GridFS write. `bk_snapshots` row now carries `filepath`,
  `storage="filesystem"`, `shipped_at`, `nas_path`. No `gridfs_id`.
- `bk_snapshots/{id}/data` endpoint prefers `filepath` (streaming
  1 MiB chunks) and falls back to GridFS ONLY for legacy pre-.132jh
  rows (none currently exist post-purge).

### 3. Aggressive pod-side retention
`backend/backup_service.py::_enforce_pod_side_retention`

- `LAN_DELIVERY_MAX_UNSHIPPED` (default 2) — never keep more than N
  unshipped ZIPs on disk. Evicted pre-write in `_do_snapshot` and
  hourly via APScheduler.
- `LAN_DELIVERY_MAX_PENDING_HOURS` (default 24) — any pending row
  older than N hours is evicted (row deleted + file unlinked). Logged
  as `backup.pod_retention EVICT id=… reason=age (pi didn't collect)`.
- Confirmed ship (`/agent/report` with `status=ok` +
  `bytes_written>=1MB` + matching `target_path`) triggers `os.unlink`
  of the local ZIP + stamps `shipped_at` + `nas_path`. Idempotent.

### 4. Trigger dedupe lock
`backend/backup_service.py::_acquire_backup_lock` + `_release_backup_lock`

- Singleton `system.backup_lock` doc `{in_progress, started_at,
  last_run_at}`.
- 60-min recency window: if a successful ship completed <60 min ago,
  skip with `backup.skipped reason=recent_run`.
- 2-h stale-lock reclaim: if `in_progress=True` and `started_at`
  older than 2 h, take over with a distinct log line
  `backup_lock.stale_reclaimed after=2h started_at=<iso>` for
  observability.
- Every entry point (POST /snapshots background task, APScheduler
  cron, startup catch-up, hourly watchdog) collapses to at most one
  snapshot per hour.

### 5. Retention size/count caps (GFS tier)
`backend/backup_service.py::_apply_retention_policy`

- `SNAPSHOT_MAX_COUNT` env var (default 7) — keep only N newest.
- `SNAPSHOT_MAX_TOTAL_MB` env var (default 2000) — walk newest first,
  evict oldest that push us over the budget.
- Strictest of {age tiers, count, total_mb} wins.

Note: with the filesystem drop-zone in .132jh these caps mostly guard
future re-enable of any GridFS retention — but they also apply on top
of the metadata-only rows now, so pod cannot slowly accumulate 1000s
of empty snapshot manifest rows either.

### 6. LAN Delivery contract fix — the ghost
`backend/backup_service.py::agent_report`

- When `report.destination_id` is absent but `report.status == "ok"`
  and `report.target_path` starts with the `local_path` of an enabled
  `local_agent` destination, correlate by longest matching
  `local_path` and bump that destination's `last_written_at` anyway.
- Log: `[.132jh] destination_id inferred by target_path: id=…
  target=…` on every inference so future contract drift is visible.
- Bumped `STALE_AFTER_H` from 6.0 → 8.0 in `/api/backup/lan-status`
  so the 6-h cron cadence has 2 h of slack before "stale".

### 7. Env vars introduced (`backend/.env`)
```
BACKUPS_ENABLED=true                    # circuit breaker
LAN_DELIVERY_ENABLED=true               # (reserved for future gating)
LAN_DELIVERY_DROP_ZONE=/app/backups/outgoing
LAN_DELIVERY_MAX_UNSHIPPED=2
LAN_DELIVERY_MAX_PENDING_HOURS=24
SNAPSHOT_MAX_COUNT=7
SNAPSHOT_MAX_TOTAL_MB=2000
```

### 8. Persistent disk-hygiene cron
- `.emergent/crons.yml` — canonical repo record of the 2-min
  cache-purge job. Serves as the single-source-of-truth spec.
- Backend startup hook `_v58_13_132jh_install_disk_hygiene_cron`
  (embedded in `on_startup` in `server.py`) idempotently re-installs
  `/etc/cron.d/paneltec-disk-hygiene` from the committed reference
  file `scripts/paneltec-disk-hygiene.cron.reference` on every boot.
  Only writes if the on-disk copy is missing or the SHA-256 differs.
- Emergent's pod rebuild wipes `/etc/cron.d/` — the startup hook
  restores the guard rail on every fresh pod.

### 9. Hourly pod-side retention sweep
- APScheduler `backup_pod_retention_sweep` runs
  `_enforce_pod_side_retention` every hour so a stopped Pi can't wedge
  `/app` back to full even if no snapshot creation is happening.

## Verification (before commit)

### Disk
| | Before | After |
|-|-|-|
| `/app` used | 9.5 G (98%) | 4.0 G (41%) |
| `/app` free | 253 M | 5.8 G |
| Mongo `storageSize` | 6065 MB | 390 MB |
| Mongo `dataSize` | 5032 MB | 469 MB |
| `bk_fs.chunks` rows | 22,623 | 0 |
| `bk_fs.files` rows | 30 | 0 |
| `bk_snapshots` rows | 41 | 0 (before test), 1 (after end-to-end test, now 0 shipped) |

### End-to-end functional test
1. Backend restarted with new code → boots green.
2. Admin POST `/api/backup/snapshots` → queued placeholder inserted.
3. ~90 s later: `paneltec-snapshot-<id>.zip` (423 MB) written to
   `/app/backups/outgoing/`, `bk_snapshots` row shows
   `status=ready storage=filesystem filepath=…`.
4. GET `/api/backup/snapshots/{id}/data?token=<admin>` → HTTP 200,
   `Content-Length: 423,253,007`, `X-Snapshot-Storage: filesystem`,
   downloaded SHA-256 matches on-disk SHA-256.
5. Registered a test agent + posted a Pi-shaped
   `POST /api/backup/agent/report` with `status=ok`,
   `bytes_written=423253007`, `target_path=/data/paneltec-civil-<id>.zip`,
   **no `destination_id`** (matches Pi's current payload).
6. Backend logs confirmed inference + delete:
   - `[.132jh] destination_id inferred by target_path: id=5e6a5346-… target=/data/…`
   - `backup.local_zip.deleted id=… bytes=423253007 (shipped to NAS)`
7. Post-test state:
   - `/app/backups/outgoing/` is EMPTY.
   - `bk_snapshots.{id}`: `shipped_at=2026-09-20T10:48:38Z`,
     `nas_path=/data/paneltec-civil-<id>.zip`, `filepath=None`.
   - `bk_destinations.Office UGREEN tower.last_written_at`:
     `2026-08-03T09:55:39` → `2026-09-20T10:48:38Z`. **48-day ghost
     fixed.**

## Pi agent impact
Zero. The Pi's existing contract (poll `/agent/pending`, download
`/snapshots/{id}/data`, POST `/agent/report`) works unchanged. All
fixes are hub-side. Pi does NOT need a config change or update to
receive the fix.

## Risks / decisions made
1. Chose `/app/backups/outgoing` for the drop-zone because no
   separate mount is available and overlayfs `/` is not writable in
   the way we'd want. With `MAX_UNSHIPPED=2`, worst-case footprint
   ≈ 800 MB — comfortable with the 5.8 GB free we now have.
2. Kept `_apply_retention_policy` running even though it's mostly
   dead code now (GridFS tier no longer receives writes). This
   preserves reversibility if we ever re-enable GridFS behind a flag.
3. `STALE_AFTER_H` bumped to 8 h (from 6 h) — the natural cron
   cadence + the `local_path` correlation fix means normal healthy
   ops now stays green.
4. The 41 pre-purge snapshots were duplicative dumps of live
   collections still in-place. Live data untouched — Emergent-managed
   backups + PITR remain the real safety net. User green-lit the
   full purge in writing.
5. Did NOT clean up the second (`enabled=false`) `local_agent`
   destination `1a35459b-…` — that's a leftover from the `.132ir`
   migration, harmless, leaving for a future housekeeping pass.

## Files touched
- `backend/backup_service.py` — guards, lock, retention caps,
  filesystem drop-zone, pod-side retention helper, agent/report
  correlation-by-target_path + on-disk unlink, /snapshots/{id}/data
  filesystem-first with GridFS fallback, STALE_AFTER_H 6→8.
- `backend/.env` — `BACKUPS_ENABLED=true` + `LAN_DELIVERY_*` +
  `SNAPSHOT_MAX_*` env vars.
- `backend/server.py` — startup hook that installs `/etc/cron.d/
  paneltec-disk-hygiene` from repo, hourly pod retention sweep,
  BACKUPS_ENABLED skip guard.
- `.emergent/crons.yml` — canonical cron registry (NEW).
- `scripts/v58_13_132jh_purge_legacy_snapshots.py` — one-shot purge
  (NEW).
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped to `paneltec-v160.3.9.58.13.132jh`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped to
  `paneltec-v160.3.9.58.13.132jh`.

## NOT changed
- `/app/mobile/` — untouched. `.132jg` build in flight.
- Pi agent code — untouched. Existing contract works.
- `restore` endpoint — untouched (accepts an uploaded ZIP, doesn't
  care where it came from).
- `MOBILE_BUNDLE_VERSION` — unchanged.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still
  parked for v58.14.x.

## Deferred / follow-up
- Housekeeping: delete the stray `enabled=false` `local_agent`
  destination `1a35459b-…` (harmless leftover).
- Optional Phase B: expose the drop-zone path in the BackupTab UI
  so the operator can see "3 unshipped waiting" at a glance.
- Optional Phase C: mount a dedicated persistent volume outside
  `/app` and move the drop-zone there so a `/app` outage can't
  starve the Pi of the latest ship.
