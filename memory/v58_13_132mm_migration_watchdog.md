# v58.13.132mm — Dropbox migration auto-resume watchdog

**Ship class:** Backend feature (small — 236 net lines in one file + scheduler wire)
**Type:** Backend + version pill bump
**Status:** SHIPPED — expected to self-heal the current `copy-19a839780d6f`
zombie on the very same backend restart that lands this ship (see
"Real-world proof point" below).

## What this ship does

Ends manual `POST /api/dropbox/migration/{run_id}/resume` firing. Two
triggers keep the copy job flowing without operator intervention:

### 1. Boot-time auto-resume
Extends the existing `.132mg` `sweep_zombie_migration_runs()` startup
hook. After marking stale `running`/`dry-run-running` runs (>5 min
without `updated_at` advance) as `interrupted`, iterates every
`interrupted` run — most-recent first — and fires a fresh resume for
one run per `agent_id` (dedupe so a fleet doesn't double-fire).

### 2. Periodic tick (APScheduler, 5 min cadence)
`watchdog_tick()`:
- Any `state=running` doc with `updated_at > 10 min` old → mark
  `interrupted`, `interrupt_reason="watchdog (stale updated_at)"`.
- Any `state=interrupted` doc with a non-terminal reason → auto-resume
  (one per agent).

Scheduler job id: `dropbox_migration_watchdog`, `max_instances=1`,
`coalesce=True`.

## Safety net

### Terminal `interrupt_reason` values (NEVER auto-resumed)
- `user_cancelled` — set by admin cancel action.
- `hard_fail_limit_hit` — set by a future hard-error path (Dropbox
  auth revoked, quota exceeded, etc.).

Set either of these to force manual investigation.

### 5-strike cap
Consecutive auto-resumes without `files_copied` advancing → set
`state="needs_attention"` on the 6th tick and stop auto-resuming.
The counter resets when `files_copied` advances past the snapshot
stored at the last auto-resume (`last_progress_files_copied`).

## New / modified data model

### `dropbox_migration_run` — 5 new fields
| Field | Type | Purpose |
|---|---|---|
| `auto_resume_count` | int | Strike counter. Set to `strikes + 1` on each auto-resume fire. |
| `last_auto_resume_at` | iso str | Wall clock of last watchdog fire. |
| `last_progress_files_copied` | int | Snapshot for strike-reset logic. |
| `last_auto_resumed_into` | str | Child run_id spawned by the last auto-resume. |
| `needs_attention_reason` | str \| null | Populated when the cap trips. |

### `migration_watchdog_settings` (new collection)
Single doc:
```json
{
  "key": "watchdog",
  "enabled": true,
  "updated_at": "...",
  "updated_by": "<admin id or email>"
}
```
Absence of the doc → default `enabled: true`.

## New / extended endpoints

### `POST /api/dropbox/migration/watchdog/pause` (admin)
Toggle global auto-resume off. Returns `{watchdog_enabled: false,
updated_at}`.

### `POST /api/dropbox/migration/watchdog/resume` (admin)
Re-enable auto-resume. Returns `{watchdog_enabled: true, updated_at}`.

### `GET /api/dropbox/migration/status` (admin) — extended
Payload gains 4 fields:
- `watchdog_enabled: bool`
- `auto_resume_count: int` (mirrored from latest run doc)
- `last_auto_resume_at: iso | null`
- `needs_attention: bool` (true iff `needs_attention_reason` set)

## Files touched

| File | Change |
|---|---|
| `backend/integrations_dropbox.py` | `+236/-3`. Adds `_watchdog_enabled`, `_launch_resume_task`, extends `sweep_zombie_migration_runs`, adds `watchdog_tick`, adds 2 endpoints, extends `dropbox_migration_status`. |
| `backend/server.py` | `+16/-0`. Registers APScheduler `dropbox_migration_watchdog` job (5-min interval). |
| `frontend/src/lib/version.js` | `+62/-1`. Version bump `.132mk → .132mm` + changelog block. |
| `frontend/public/service-worker.js` | `+1/-1`. Cache version bump. |

## Real-world proof point

At ship time the migration `copy-19a839780d6f` was stuck in
`state=running` with `updated_at=2026-09-24T03:16:23Z` (~24 min stale).
This was the zombie left behind when `.132mk-fix1` restarted the
backend and the shutdown-time `state=interrupted` write raced the
`MongoClient.close()` and lost. The boot sweep as originally shipped
in `.132mg` only catches stale runnings AT BOOT TIME, so this state
persisted post-boot.

**The `.132mm` restart itself is the acceptance test.** On boot:
1. Sweep re-runs the 5-min-stale check → catches `copy-19a839780d6f`,
   marks it `interrupted`.
2. NEW: sweep then iterates `state=interrupted` runs, one per
   `agent_id`, and fires a fresh resume for `copy-19a839780d6f`.
3. `auto_resume_count` on the original run doc goes to `1`.
4. `last_auto_resumed_into` points at the new child `run_id`.

If any of the above fails to happen on this exact ship, the watchdog
is broken — treat as a P0 regression.

## Ban discipline

- No `/app/mobile/*` touch.
- No `testing_agent` call.
- No `finish` tool call.
- Explicit `git add <file>` per touched path (no `-A`, no `commit -a`).
- Parallel-actor files (`craco.config.js` and its `.bak_ticket*`)
  intentionally left unstaged.

## Known non-issues (do NOT auto-fix in a future ship)

- Migration `copy-19a839780d6f` will continue to accumulate 14
  `GetTemporaryLinkError('not_allowed', ...)` failures on the GIS
  shapefiles under `Hazell Brothers/SWISA Tenders HDD/HB/5.0
  SWISA-250004 Contract Specification/GIS Shapefiles/`. These are
  Dropbox permission-scope errors on the user's side — not a watchdog
  bug. Watchdog treats these as regular per-file errors (they don't
  block the run) and continues copying the other ~thousands of files.
  Remediation is a separate track (user needs to update Dropbox
  sharing scope OR we skip GIS folder OR user provides a manual
  export).

## Next-session queue (from this ship's report, not yet shipped)

1. **COP ingest via headless browser.** `.132mk` couldn't enumerate
   the WorkSafe Tas Codes of Practice landing page because it's
   behind a Cloudflare browser challenge (`cf-mitigated: challenge`,
   `HTTP 403`). Needs a Playwright-based fetcher (spins up a
   headless Chrome, solves the JS challenge, hands the resolved HTML
   to the existing `parser.enumerate_cop_pdfs()`). Prefix will
   likely be `.132mn`.
2. **Dropbox GIS permission errors** — separate track, likely
   requires user-side Dropbox sharing scope update or an ingest
   exclusion list. Not a code fix.

## Post-ship verification (executed inline; see ship response)

1. Backend restarts cleanly.
2. Startup log shows `APScheduler job registered — dropbox_migration_watchdog every 5 min`.
3. `POST /api/dropbox/migration/watchdog/pause` returns 200 — endpoint is mounted.
4. Immediately unpause via `POST /api/dropbox/migration/watchdog/resume` — 200.
5. `GET /api/dropbox/migration/status` returns `watchdog_enabled: true`.
6. `copy-19a839780d6f` has been swept to `state=interrupted` AND a
   child run created via `last_auto_resumed_into`. `auto_resume_count`
   on the original doc is `1`.
7. 60-second health snapshot on the child run: `updated_at` advancing.
