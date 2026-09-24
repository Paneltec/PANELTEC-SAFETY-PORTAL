# v58.13.132mq — Backup pipeline hardening (F2 + F3 + F4 bundled)

**Ship class:** Backend hardening (streaming serializer + shutdown hooks
+ EXCLUDE_COLLECTIONS widening + housekeeping)
**Type:** Backend-only code + inline DB one-shot
**Status:** SHIPPED
**Baseline:** `.132mp`

## Root cause recap (from `.132mp+` diagnostic)

- Last good snapshot: `2026-09-23T01:28:35` (~29 h stale at ship time)
- Every subsequent attempt built the whole zip in `io.BytesIO()`, which
  ballooned a 1.5 GB DB into an 8.7 GB in-memory zip (GridFS chunks got
  JSON-str-escaped, ~7× inflation).
- Pod cgroup OOM-killed the writer silently. Lock left `in_progress=true`.
- 7 stale-reclaims logged over 29 h; each new attempt met the same fate.
- Orphaned `/tmp/tmp20d25t9r.zip` (8.7 GB) sat 55 min after its writer died.

## Ship contents

### F3 — Streaming serializer

`backend/backup_service.py`, `_write_snapshot` (~L1262 pre-fix). Changes:

1. **In-memory zip → temp file on /tmp.** `zbuf = io.BytesIO()` replaced
   with `tempfile.NamedTemporaryFile(dir='/tmp', suffix='.zip',
   prefix='bkzip-', delete=False)`. /tmp is on the 95 GB overlay
   filesystem; /app is only 9.8 GB and would ENOSPC.
2. **Per-collection streaming.** `cursor.to_list(length=None)` +
   `json.dumps(rows)` replaced with `async for row in cursor: zf.write(
   json.dumps(row, default=str).encode())` streaming into a JSON array
   `[…]` via `z.open(entry, 'w', force_zip64=True)`. Peak RAM per
   collection is now ONE doc, not the whole collection.
3. **Streaming SHA-256.** `hashlib.sha256(data).hexdigest()` on an 8 GB
   bytes object replaced with a 4 MB-block reader loop.
4. **Atomic rename.** `os.replace(temp_path, filepath)` swaps the temp
   file into the LAN drop-zone in one syscall. Old staging.part path
   removed (temp file already is the final payload).
5. **Finally-clause cleanup.** Best-effort `os.unlink(temp_path)` if we
   crashed before rename. Sets `temp_path=None` after successful rename
   so cleanup is a no-op on the happy path.

Zip layout unchanged: `manifest.json` + `mongo/<cname>.json`.
Manifest gains a `serializer_v2: true` marker (informational only —
no code reads it yet, added so future format shifts can detect).

Restore path (line ~2700) UNCHANGED — reads the same layout.

### F3.b — EXCLUDE_COLLECTIONS widened

Added 5 ephemeral / regeneratable collections:

| Collection | Size | Rationale |
|---|---|---|
| `bulk_import_failed_pdfs.chunks` | 325 MB | Per-run recovery bucket; replayable from source zip |
| `bulk_import_failed_pdfs.files` | small | Metadata for the above |
| `preview_pdf_cache` | 12 MB | pdftoppm render cache; regenerable on demand |
| `doc_files_pdf_cache` | 32 MB | pdftoppm render cache; regenerable on demand |
| `bulk_import_pdf_cache` | ~large | Claude vision extraction cache; regenerable (paid API but reproducible) |

Expected dump size after ship: **8.7 GB → ~600 MB** (dominated by
`upload_storage.chunks` which stays because it may hold active user
uploads).

### F2 — Shutdown-safe backup lock

`backend/backup_service.py` — new function:
```python
async def mark_backup_lock_interrupted_on_shutdown(db_) -> None
```

Called from `server.py on_shutdown` BEFORE `close_db()`. If a snapshot
is claimed `in_progress`, marks it `in_progress=false` +
`interrupted_at + interrupt_reason='backend restart during snapshot'`.

Silent-fail (broad `except`) so shutdown never blocks.

**Impact:** every future backend restart mid-snapshot will hand off
cleanly. Next scheduled fire (or `_backup_watchdog` tick) picks up
immediately, no 30-min stale-reclaim wait.

### F2.b + F4 — Orphan /tmp/*.zip sweep

`backend/backup_service.py` — new function:
```python
def sweep_orphan_snapshot_temps(max_age_hours: int = 24) -> Dict[str, int]
```

Globs `/tmp/bkzip-*.zip` (new-format) AND `/tmp/tmp*.zip` (legacy).
Unlinks anything older than 24 h. Called from `server.py on_startup`.
Returns `{scanned, unlinked, bytes_reclaimed}` — logged at INFO on
every boot.

**24 h cutoff, not 5 min or 1 h.** In-flight zips from a concurrent
worker (which our lock guards against, but belt-and-braces) are never
touched.

### F4 — Stale "Office Pi" agent deletion

Executed INLINE via python one-liner after backend restart:
```python
await db.bk_agents.delete_one({'id': 'a6767aa4-d280-40df-8bac-d48026b0afcb'})
```

Also stopped the `download failed` log spam it was emitting every
minute against snapshot `8a36365e`.

Not a code change — one-shot DB write. Documented here for the
audit trail.

## Post-ship recovery sequence (F1)

Executed after backend restart settles:

1. `db.system_backup_lock.updateOne({_id:'backup_lock'}, {$set:{in_progress:false, interrupt_reason:'manual-clear-post-132mq'}})`
2. `rm /tmp/tmp20d25t9r.zip` (8.7 GB orphan from `.132mp` era)
3. Fire "Backup Now" (`POST /api/backup/run`)
4. Watch: `bk_snapshots.find().sort({created_at:-1}).limit(1)` — expect a
   fresh row within ~2-5 min (much faster than pre-ship 15-30+ min).

## Ban discipline

- Explicit `git add <file>` per touched path.
- Defensive `git reset` between add and commit.
- No `/app/mobile/*` touch.
- No `testing_agent`, no `finish` tool.
- Migration + WHS ingest unaffected — backend restart triggers
  `.132mm` watchdog auto-resume on boot (verified pattern from prior ships).

## Verification checklist (in ship response)

- [ ] Commit clean, only 4 files staged
- [ ] Backend restart succeeds
- [ ] Boot sweep runs (unlinks the 8.7 GB orphan)
- [ ] Shutdown hook logs `backup_lock.marked_interrupted_on_shutdown` on next restart
- [ ] F1 lock clear + Backup Now fire produces a fresh `bk_snapshots` row
- [ ] New snapshot size is ~600 MB (not 8.7 GB)
- [ ] "Office Pi" agent deleted; `bk_agent_logs` stops logging `download failed`
- [ ] Migration `copy-*` state resumes healthy after backend restart
