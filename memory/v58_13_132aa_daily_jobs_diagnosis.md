# v58.13.132aa — DIAGNOSIS ONLY (daily_job_assignments empty)

Status: **diagnosis complete, NO fix shipped — pipeline gap is
architectural (admin UI never built). Reporting back per brief.**

## TL;DR

`daily_job_assignments` has 0 rows because **nothing writes to it**.
The writer endpoint `POST /api/mobile/daily-jobs` exists and works,
but no caller was ever built:

- No web-admin UI screen calls the endpoint.
- No cron / Simpro-sync auto-generates assignments.
- No SMS-reply webhook creates rows on worker replies.
- SMS dispatch itself is intentionally inert (parked at `.132n`
  per Comms Safe Mode).

The mobile app is a **read-only consumer**; its home screen renders
`no_job` for every worker until an admin manually POSTs an
assignment via curl / API client.

**No mobile UX breakage** — the `/mobile/daily-jobs/today` endpoint
returns `{assignment: null, status: "no_job"}` cleanly, and
`mobile_home.py` handles the empty state at line 371-372.

## Evidence

### Writer path — endpoint exists, no caller

```
backend/mobile_daily_jobs.py:91   @router.post("/mobile/daily-jobs", status_code=201)
backend/mobile_daily_jobs.py:128  await db.daily_job_assignments.insert_one(doc)
backend/server.py:52              from mobile_daily_jobs import router as mobile_daily_jobs_router
backend/server.py:358             api.include_router(mobile_daily_jobs_router)
```

Router mounts correctly on `/api/*` — endpoint is live at
`POST /api/mobile/daily-jobs`.

### Web frontend — zero callers

```
grep -rn "mobile/daily-jobs\|daily-jobs\|dailyJob\|DailyJob"
    frontend/src --include="*.jsx" --include="*.js" --include="*.tsx" --include="*.ts"
→ 0 hits
```

**No admin screen** in the web app to assign a daily job. The
`UsersManagement.jsx` "Assign" language is for role assignment, not
job assignment (grep-confirmed).

### Mobile app — read-only + accept/decline

```
mobile/src/services/dailyJobs.ts  → exports acceptDailyJob, declineDailyJob only
mobile/app/(tabs)/home.tsx:25-26  → imports acceptDailyJob, declineDailyJob
mobile/app/(tabs)/home.tsx:328    → await acceptDailyJob(job.id)
mobile/app/(tabs)/home.tsx:335    → await declineDailyJob(job.id)
```

Mobile never POSTs to `/mobile/daily-jobs` (create). It only reads
via the bundled `fetchHome` call (which internally hits
`mobile_home.py:372` → `db.daily_job_assignments.find_one`) and
transitions state via accept/decline.

### Backend — no other writer

```
grep -rn "daily_job_assignments" backend --include="*.py"
backend/mobile_daily_jobs.py:128  await db.daily_job_assignments.insert_one(doc)  [WRITE]
backend/mobile_daily_jobs.py:171  await db.daily_job_assignments.find_one(...)     [READ]
backend/mobile_daily_jobs.py:220  await db.daily_job_assignments.find_one(...)     [READ, accept/decline]
backend/mobile_daily_jobs.py:248  await db.daily_job_assignments.find_one_and_update(...)  [UPDATE, accept/decline]
backend/mobile_home.py:372        await db.daily_job_assignments.find_one(...)     [READ]
```

Only **one** insert path in the entire codebase. Nothing else
writes to this collection.

### SMS-reply / webhook — none

```
grep -rn "pending_sms_dispatches" backend --include="*.py"
backend/mobile_daily_jobs.py:81   await db.pending_sms_dispatches.insert_one(row)  [only writer]
```

Only writer. No reader / cron / cleanup consumer means the outbox
is drain-less by design (Safe Mode). `pending_sms_dispatches` also
has 0 rows because zero assignments have been created to enqueue
SMS payloads for.

### Runtime probe

```
DB: test_database
daily_job_assignments: 0
pending_sms_dispatches: 0
workers: 73
users: 83
simpro_jobs: 500
jobs: 0

daily_job_assignments indexes: only default _id_
  → no compound (org_id, worker_id, date) index either
```

500 `simpro_jobs` and 73 `workers` exist but nothing bridges them
into the daily-assignments flow.

## Root cause

**The `.132n` batch shipped the API surface for the SMS-you-your-
job flow but not the admin UI to trigger it.** Per the `.132n`
memo (referenced in `mobile_daily_jobs.py:11-14`), SMS dispatch
was deliberately parked as INERT for Comms Safe Mode. The
admin-facing "assign today's job to worker X" web screen was
never scheduled.

Both halves need to ship together to produce a working end-to-end
pipeline:
1. **Admin UI** on web to POST to `/api/mobile/daily-jobs`
   (worker picker + site picker + optional date + notes).
2. **SMS dispatch un-parking** for the actual TextMagic send when
   Comms Safe Mode is lifted (currently `pending_sms_dispatches`
   would just accumulate rows forever with no drainer).

## Options for you

### Option A — Ship the admin UI (medium)

Build a web screen at (e.g.) `/app/mobile/assign-daily-jobs`:
- Worker dropdown (filtered to org, `deleted_at: null`).
- Site dropdown (or free-text site_id + name).
- Optional date picker (defaults to today).
- Optional notes textarea.
- "Assign" button → `POST /api/mobile/daily-jobs`.
- List of today's assignments below (uses a new
  `GET /api/mobile/daily-jobs` admin-scoped list endpoint — needs
  to be added; currently only per-worker /today exists).

Estimated: one batch (`.132ab`). ~200-300 LOC frontend, ~40 LOC
backend for the list endpoint + compound index.

### Option B — Auto-derive from Simpro jobs (larger)

Nightly cron reads `simpro_jobs` for the next day, groups by
assigned worker, creates one `daily_job_assignments` per worker.
Handles multi-job workers by picking primary site (largest job or
earliest start).

Estimated: two batches. Needs product decision on multi-job
disambiguation (Paneltec's Simpro workers frequently have 2-3 jobs
in a day — which one gets the SMS?).

### Option C — Keep parked (no action)

Leave `daily_job_assignments` empty. Mobile home continues to
render `no_job` cleanly. Revisit when Comms Safe Mode lifts and
you have TextMagic budget for real SMS sends.

### Recommended

**Option C for now, promote to A when Safe Mode lifts.** Building
an admin UI that queues SMS payloads into a drain-less outbox is
premature — you'd accumulate `pending_sms_dispatches` rows that
never fire, and workers would get zero mobile notification signal
even if you fill `daily_job_assignments` (they only see the job
after they open the app and pull-to-refresh — no push).

## Related fires (adjacent but not this batch)

- `pending_sms_dispatches` has no drainer job (no cron, no admin
  "process outbox" button). Same architectural gap as this issue.
- `daily_job_assignments` lacks compound index
  `(org_id, worker_id, date)` — trivial to add when the feature
  becomes real; skipping while collection is empty.
- No admin-scoped list endpoint (`GET /api/mobile/daily-jobs`)
  for reviewing/revoking assignments.

## Files touched this batch

| File | Change | LOC |
|---|---|---:|
| `frontend/src/lib/version.js#RUNNING_VERSION` | `.132z → .132aa` + diagnosis-only ship-note block | +20 |
| `memory/v58_13_132aa_daily_jobs_diagnosis.md` | new | +this file |

No frontend / backend / mobile code changes. No DB writes. No
schema changes.

## Rollback

Nothing to roll back. Diagnosis-only ship.

## Waiting for your call

Reply with **A / B / C** (or another direction) and I'll pick up
the next batch. Standing by.
