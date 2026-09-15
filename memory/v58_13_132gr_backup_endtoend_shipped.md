# v58.13.132gr — Backup end-to-end (polling + retry + disk incident) · SHIPPED

## What was still broken after `.132gq`

`.132gq` moved the snapshot writer to a background task and returned
200 immediately with `{queued: true}`. That closed the 502 timeout,
but the Backup tab **still looked broken to Stephen** because:

1. **FE ran `refresh()` immediately** after POST, saw the same list
   as before (background writer hadn't finished), showed no
   in-progress state, and turned the button back on. Zero visual
   feedback → "backup does nothing".
2. **Background writer was silently failing** on this pod with
   `pymongo.errors.AutoReconnect: [Errno 104] Connection reset by
   peer` mid-snapshot. No retry, no visible error.
3. **Download endpoint crashed** for a legacy snapshot row missing
   the `sha256` field (`KeyError: 'sha256'` at line 1334).
4. **/app volume was at 98–100 %** because 6+ old 313 MB snapshots
   sat in `bk_snapshots` GridFS without hitting the retention
   policy — this was the root cause of the AutoReconnect
   (WiredTiger refuses writes when disk is critically low).

## Fixes shipped

### Backend — `backend/backup_service.py`

1. **Queued placeholder row on POST.** New `bk_snapshots` doc with
   `status: "queued"`, `queued_at`, `size: 0` inserted before the
   background task fires. Response carries `queued_id` so the FE
   knows exactly which row to watch.
2. **Retry loop in `_guarded_snapshot`.** Up to 3 attempts with a
   5 s backoff on any exception. Motor re-connects on the next
   await so subsequent tries run against a fresh socket — handles
   the AutoReconnect case exactly.
3. **Placeholder lifecycle.** On success → placeholder is deleted
   (real ready row replaces it in the list). On final failure →
   placeholder flipped to `status: "failed"` with a truncated
   error message, so the FE can render "backup failed" instead of
   spinning forever.
4. **Concurrent POST protection.** Second click returns
   `{queued: false, existing_queued_id: ...}` pointing at the
   currently-running row so the FE watches the same task rather
   than double-firing.
5. **Download endpoint guards `sha256` / `size`.** Legacy rows
   without those fields now serve 200 with `X-Snapshot-SHA256: ""`
   instead of 500-ing on `KeyError`.

### Frontend — `pages/settings/BackupTab.jsx`

`snapshotNow` now:

* POSTs, captures `queued_id`.
* Enters a polling loop (5 s cadence, 3-min timeout).
* Each tick fetches `GET /snapshots` and checks:
  * Placeholder gone → real snapshot ready → toast + break.
  * Placeholder `status: "failed"` → surface `error` to the UI + break.
  * Placeholder still queued → keep spinner up.
* Deadline exceeded → error banner "Backup didn't complete in 3
  minutes — check the ops log."

`busy` stays `true` for the whole loop so the button shows the
spinner + copy the entire time.

### Ops — pod disk incident (external cause)

`df -h /app` showed **9.6 G used / 215 MB free (98 %)** on
`/dev/nvme0n2`. That's what caused every AutoReconnect in the
`.132gq` era: Mongo enters safe mode when the data volume is
critically low. Two large offenders:

```
/data/db/collection-31--…wt  → 2.0 GB   (bk_snapshots.chunks — 6+ old 313 MB dumps)
/data/db/collection-228-…wt  →  205 MB  (upload_storage.chunks — the .132gh sweep artefacts)
/app/frontend/node_modules/.cache → 2.0 GB (webpack build cache — reclaimable)
```

Cleared the frontend build cache (regenerates automatically on
next dev-server rebuild) — disk dropped to **1.5 G free (86 %)**.
Mongo recovered and the very next POST completed the full
snapshot cycle end-to-end.

## Curl / behavioural proof

```
Cleanup: rm -rf /app/frontend/node_modules/.cache  →  freed 2 GB
Mongo restart: sudo supervisorctl restart mongodb  →  RUNNING

POST /api/backup/snapshots
→ 200 · {queued: true, queued_id: 788cf86c-df8d-40a0-bac9-f74a83abdf42}

wait 75 s

GET /api/backup/snapshots?limit=4
→ [
    { id: cb5a5c12…, status: ready, size: 313562614 },   ← NEW
    { id: 7be59d2f…, status: ready, size: 313554458 },
    { id: 142d4104…, status: ready, size: 313554248 },
  ]
placeholder 788cf86c… → GONE (deleted by _guarded_snapshot on success)
ready snapshots: 3
disk: 8.4G / 9.8G (86 %)
```

## Pytest

```
$ pytest backend/tests/test_v58_13_132gr_backup_retry_and_polling.py -q
5 passed in 0.03s
```

## Files changed
```
backend/backup_service.py                        +85 −18
frontend/src/pages/settings/BackupTab.jsx        +45 −4
frontend/src/lib/version.js                      × 2 version bump
frontend/public/service-worker.js                CACHE_VERSION bump
backend/tests/test_v58_13_132gr_backup_retry_and_polling.py   NEW 55 lines
memory/v58_13_132gr_backup_endtoend_shipped.md   NEW (this)
```

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132gr`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Message for Stephen

Hard-refresh once `.132gr` is live. Click **Backup now** and:

* The button will show a spinner + "Snapshot in progress…" for the
  full ~30–90 s.
* When the snapshot lands, a toast appears and the new row shows in
  the list with `status: ready`.
* If it fails, you'll see an error banner with the reason instead
  of a silent hang.

**Ops note** — your pod's `/app` volume filled to 98 % because old
snapshots were not being pruned. I reclaimed 2 GB by clearing the
webpack build cache (regenerates automatically) and Mongo came
back. To prevent recurrence:

1. Run **Settings → Backup → Retention** and set a hard cap
   (e.g. keep last 4 snapshots + last 7 days). The current default
   is generous enough that a busy week fills the disk.
2. Consider bumping the pod's `/app` PV from 10 GB → 30 GB. At
   313 MB per snapshot plus GridFS document library growth, 10 GB
   is very tight.

## Follow-up backlog

* **Retention auto-trigger after each snapshot.** Currently the
  retention policy runs on a schedule. Firing `_apply_retention_policy`
  at the end of `_guarded_snapshot` would prevent the disk from
  ever climbing above the retention setting.
* **Disk-usage guard.** Fail the POST with a clear "disk full,
  please prune snapshots first" error when `df -h /app` shows <10 %
  free, rather than letting Mongo silently reject the write.
