# v58.13.132my — Migration shutdown hardening

## Why
Post-`.132mv` diagnostic revealed that every backend restart during active
development killed the in-flight Dropbox migration `fetch_and_put` poll,
leaving the run doc as `state=running` with a stale `updated_at`. The
watchdog then auto-resumed on each 5-min tick, and 5 restart-caused
cancellations tripped the 5-strike cap into a **false**
`state=needs_attention`. Root cause was the fire-and-forget
`asyncio.create_task(bcopy.run_copy_job(...))` pattern with no
FastAPI-lifespan drain.

## Ship

### A — Graceful shutdown for the migration task
New `integrations_dropbox.shutdown_migration_jobs()`:

```
1. live = [t for t in _BACKGROUND_TASKS if not t.done()]
2. for t in live: t.cancel()
3. await asyncio.wait(live, timeout=2.0)                    # bounded
4. await db.dropbox_migration_run.update_many(              # motor
     {"state": {"$in": ["running", "dry-run-running"]}},
     {"$set": {"state": "interrupted",
               "interrupt_reason": "backend_restart",
               "interrupted_at": now, "updated_at": now}},
   )
```

Wired into `server.py::on_shutdown()` alongside `.132mq`'s
`mark_backup_lock_interrupted_on_shutdown()` and `.15`'s
`shutdown_bulk_import_jobs()`. Uses motor (async) — NOT sync
pymongo — so a SIGTERM-driven loop teardown can't cancel the write
mid-flight (which was the pre-`.132my` failure mode; see the
`concurrent/futures/thread.py` traceback in the diagnostic).

### B — Non-striking interrupt reasons
`_launch_resume_task` now checks `interrupt_reason` against a new set:

```python
_AUTO_RESUME_NON_STRIKING_REASON_PREFIXES = (
    "backend_restart",
    "backend restart",   # legacy string from sweep_zombie_migration_runs
)
```

When the reason matches (case-insensitive prefix):
- `auto_resume_count` **is NOT incremented**
- 5-strike cap check is **bypassed** (never trips false `needs_attention`)

Everything else (auto_resume timestamps, `last_progress_files_copied`,
`last_auto_resumed_into`) is still written for audit continuity. Real
failures (NAS put errors, Dropbox 5xx, unhandled exceptions) still
increment strikes and still hit the cap.

Log line differentiates:
```
[watchdog:tick] AUTO-RESUME copy-X -> copy-Y (strike 3/5 · non-striking (restart))
```

### C — One-shot cleanup of the pre-existing false flags
New `cleanup_false_needs_attention_on_startup()` runs on boot,
alongside the other `.132mw`/`.132hn`/`.132mm` startup seeds:

```python
query = {
    "$or": [
        {"run_id": "copy-25b404b74680"},
        {"needs_attention_reason": {"$regex": "^auto-resume hit", "$options": "i"}},
    ],
}
await db.dropbox_migration_run.update_many(
    query,
    {"$set": {"state": "interrupted",
              "interrupt_reason": "backend_restart",
              "updated_at": now_iso},
     "$unset": {"needs_attention_reason": "", "needs_attention": ""}},
)
```

Idempotent no-op after first successful run. Log line:
```
[cleanup-false-needs-attention] cleared N run(s) (matched=N)
```

## Version bumps
- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132my`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132my`

## Verification (this ship, live backend)
1. Boot log shows `[cleanup-false-needs-attention] cleared N run(s) (matched=N)`.
2. `db.dropbox_migration_run.count({needs_attention_reason: {$regex: "^auto-resume hit"}})` → 0 after boot.
3. Before-shutdown: current run `state=running`. After the `.132my`
   restart, the same doc's `state=interrupted, interrupt_reason=backend_restart`
   (not stale `running`).
4. Watchdog next tick auto-resumes it as strike 0 (log includes
   `· non-striking (restart)`). Real failures still strike as before.

## Non-goals
- `dropbox_bytes_copy.run_copy_job`'s own except handler unchanged —
  it still tries to write a final status via motor and still races
  SIGTERM. That's fine now: the shutdown-side `update_many` is the
  guaranteed final-state writer.
- No mobile touched.

## Ship discipline
- Defensive git-reset before commit.
- No `testing_agent`, no `finish` tool.
- No `git push`.
