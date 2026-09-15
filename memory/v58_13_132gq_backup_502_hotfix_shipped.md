# v58.13.132gq — Backup POST /snapshots 502 hotfix · SHIPPED

## Root cause

Stephen clicked "Backup now" and saw the app fail. Curl of the same
endpoint:

```
POST /api/backup/snapshots
→ HTTP 502  Cloudflare challenge page ("Just a moment…")
elapsed: >30s
```

`GET /backup/summary` and `GET /backup/snapshots` both returned 200
with a healthy 313 MB snapshot from 01:51 UTC — the scheduled
background writer was fine. The problem was the **on-demand
button**, which called `_do_snapshot()` **inline** on the request
thread:

```python
@api_router.post("/snapshots", dependencies=[Depends(require_admin)])
async def create_snapshot():
    return await _do_snapshot()      # ~30–90s for a 300 MB pod
```

At 313 MB / 104 864 documents that request routinely blows past the
Cloudflare ingress timeout (30 s), returning **HTTP 502** even
though the writer would have finished a few seconds later. Stephen
saw "backup failed" while the snapshot was actually landing in the
background.

## Fix

`backend/backup_service.py`:

1. `BackgroundTasks` added to the `fastapi` import.
2. `create_snapshot(bg: BackgroundTasks)` now schedules the writer
   with `bg.add_task(_guarded_snapshot)` and returns
   `{"ok": True, "queued": True}` in ~200 ms.
3. New concurrent-run guard on `app.state.bk_snapshot_running` —
   parallel button clicks report `queued: False` with a "snapshot
   already running" message instead of doubling the GridFS write
   pressure.
4. `_guarded_snapshot` wraps `_do_snapshot()` in try/finally to
   clear the flag even on failure, and logs the exception for the
   ops trail.

## Curl evidence

```
POST /api/backup/snapshots
→ HTTP 200 · elapsed 0.21s
  {"ok":true,"queued":true,
   "message":"Snapshot queued — refresh the snapshots list in ~30 seconds."}

POST /api/backup/snapshots   (immediate re-fire)
→ HTTP 200
  {"ok":true,"queued":false,
   "message":"A snapshot is already running — check the snapshots list in ~30 seconds."}

wait 45s

GET /api/backup/snapshots?limit=3
→ HTTP 200 · new row present:
  id=5a27f19a-93a2-408b-bb56-06bdff4ee12e  status=ready
  size=313553609  created=2026-09-15T01:53:42Z
```

**Before**: 502 after 30 s.
**After**: 200 in 0.21 s; snapshot lands in the background within
~45 s.

## Pytest
```
$ pytest backend/tests/test_v58_13_132gq_backup_502.py -q
4 passed in 7.40s
```

Covers:
1. Source pins — `BackgroundTasks` in the import line, the new
   handler signature, the guard on `app.state`, the queued/busy
   response branches, and the old inline `await _do_snapshot()`
   removed.
2. POST returns in <5 s (was 30 s+).
3. Second concurrent POST returns the busy branch when the
   background task is still running.
4. Version lockstep across 3 web files.

## Files changed
```
backend/backup_service.py                                +42 −4
frontend/src/lib/version.js                              × 2 version bump
frontend/public/service-worker.js                        CACHE_VERSION bump
backend/tests/test_v58_13_132gq_backup_502.py            NEW 65 lines
memory/v58_13_132gq_backup_502_hotfix_shipped.md         NEW (this)
```

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132gq`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Message for Stephen

Hard-refresh once `.132gq` is live. Click **Backup now** and you'll
see the button return immediately with "Snapshot queued". Give it
~30–60 seconds, refresh the Snapshots list, and the new row will
appear with `status: ready`. Existing background schedules
(`backup_snapshot_6h` + `backup_snapshot_cob`) were never affected
— they always ran off-thread.

## Follow-up backlog

* **UI toast** on the Backup tab: "Snapshot queued — refreshing
  list in ~60s" with an auto-refetch. Currently the FE toasts a
  generic success and the snapshot only appears on manual
  refresh. Nice-to-have, not blocking.
* **Progress row** in `bk_snapshots` — insert a `status: 'queued'`
  row when the task starts and flip to `ready` when done, so the
  UI can render a spinner in place. Requires touching
  `_do_snapshot` internals, out of scope for a hotfix.
