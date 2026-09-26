# v58.13.132p0 — Phase 1: Data-Model Reset

Locked-in reset of the daily-job flow to the SEVEN SMS fields
Stephen's whiteboard emits. Nothing invented. Phase 1 of a 5-phase
mobile job rebuild — this ship covers web + backend only; mobile
lands in Phase 2 (Android SMS receiver).

## Locked schema — `daily_job_assignments`

```
id                    str  (uuid)
job_batch_id          str
worker_id             str
worker_email          str
worker_name           str
truck                 str          # single string, e.g. "Cappellotto 2 - Volvo - XT48AK"
date                  str          # ISO YYYY-MM-DD
site_name             str
address               str
customer              str
staff                 list[str]    # names as they appear on the SMS
notes                 str
status                enum         # issued | accepted | declined | signed_on | completed
issued_at             datetime
accepted_at           datetime | null
declined_at           datetime | null
signed_on_at          datetime | null
signed_on_gps         {lat, lng} | null
site_id               str | null   # geocode/site-match populated at create time
site_lat              float | null
site_lng              float | null
truck_prestart_id     str | null   # Phase 3+
site_prestart_id      str | null   # Phase 5
created_at            datetime
updated_at            datetime
meta                  dict
```

## Purged fields

`task`, `supervisor_id`, `supervisor_name`, `supervisor_phone`,
`truck_name`, `truck_reg`, `is_past_date_fallback`, `date_local`,
`date_utc`, `sms_sent_at`, `sms_message_id`, `sms_provider`,
`site_freeform`, `preamble`, `assigned_at`, `assigned_by`,
`assigned_by_name`, `worker_kind`, `worker_phone`, `worker_role_id`,
`site_address`, `site_coords`.

Renamed via migration:
  · `staff_names` → `staff`
  · `truck_name + " - " + truck_reg` → single `truck` string
  · `site_address` → `address` (only when `address` was empty)
  · `site_coords.{lat,lng}` → `site_lat` / `site_lng`

## Endpoints (final contracts)

All under `/api/`:

  · `POST /mobile/daily-jobs`
      Body: `{worker_id | worker_email, truck, date, site_name,
             address, customer, staff[], notes, override?}`
      Extra keys ignored (Pydantic `extra="ignore"`) — legacy
      callers that still send `task` / `supervisor_*` / `truck_name`
      / `truck_reg` get 201 back, but nothing invalid survives.
      Geocodes `address` via existing `/mobile/geocode` if possible;
      links to `db.sites` if a match exists. Returns the full doc,
      status=`issued`.

  · `POST /daily-jobs/bulk-create`
      Web form endpoint. Same seven fields + `worker_ids[]` +
      `override` + `trial_run`. Loops N times, one geocode call
      shared across the batch. Same doc shape as single-create.

  · `GET  /mobile/daily-jobs/today`
      Returns the caller's active (non-terminal) assignment, sorted
      by (date desc, issued_at desc). NO `is_past_date_fallback`
      flag. Shape: `{"assignment": <doc>|null, "status": …}`.

  · `POST /mobile/daily-jobs/{id}/accept`  → status flip, stamps `accepted_at`
  · `POST /mobile/daily-jobs/{id}/decline` → status flip, stamps `declined_at`
  · `POST /mobile/daily-jobs/{id}/signon`  → 501 (Phase 4 stub)

  · `POST /mobile/sms/parse`  ← NEW
      Body: `{sms: "..."}`. Returns
      `{parsed: {truck, date, site_name, address, customer, staff[], notes},
        missing: [...]}`. Never creates a job.

## Shared SMS parser — `backend/sms_parser.py`

Single source of truth for parsing Stephen's whiteboard SMS. Used
by:
  · Web admin `IssueJob.jsx` — Paste-SMS modal
  · `POST /api/mobile/sms/parse` — mobile SMS-receiver (Phase 2)
  · Any future ingestion path (e.g. webhook)

Handles:
  · Positional 7-line SMS (Stephen's actual format)
  · Labeled SMS (`Truck: …`, `Date: …`, `Staff: …`, etc.)
  · Mixed (some labeled, some positional)
  · Date shapes: `DD-MM-YY`, `DD-MM-YYYY`, `DD/MM/YY`, `DD/MM/YYYY`,
    `YYYY-MM-DD`, ISO 8601 with time
  · Curly quotes, CRLF, extra blank lines

Never raises. Missing fields stay `None` (or `[]` for staff).

## Migration — `scripts/migrate_132p0_data_model_reset.py`

Idempotent, safe to re-run. Runs against the live Mongo. Output on
first-run in this env:

```
[migrate 132p0] 5 row(s) in daily_job_assignments
[migrate 132p0]   1) combined truck_name+truck_reg → truck: 4
[migrate 132p0]   1b) rename site_address → address: (added post-first-run)
[migrate 132p0]   1c) lift site_coords → site_lat/site_lng: (added post-first-run)
[migrate 132p0]   2) $unset legacy keys: 5 row(s)
[migrate 132p0]   3) rename staff_names → staff: 5
[migrate 132p0]   4) status → 'issued': 1
[migrate 132p0]   5) backfilled worker_email: 5
[migrate 132p0]   6) backfilled issued_at: 0
[migrate 132p0]     · added site_lat=null on 5 rows
[migrate 132p0]     · added site_lng=null on 5 rows
[migrate 132p0]     · added signed_on_at=null on 5 rows
[migrate 132p0]     · added signed_on_gps=null on 5 rows
[migrate 132p0]     · added truck_prestart_id=null on 5 rows
[migrate 132p0]     · added site_prestart_id=null on 5 rows
[migrate 132p0]     · added created_at=null on 5 rows
[migrate 132p0] ✔ no legacy keys remain
```

Stale `.132n7a/.132n7b` trial seeds (4 rows) were purged manually
before the re-run; the current `daily_job_assignments` collection
is 3 rows (all `.132p0_trial_seed`), all conforming to the new
schema.

## Seed — `scripts/seed_132p0_trial_job_wide.py`

Wide-net trial seed: 3 identity matches for Stephen's env
(worker_stephen users row, stephen admin users row, Stephen Guy
workers row). Locked to the `.132p0` schema. Tagged
`meta.trial_marker = "132p0_trial_seed"`.

## Admin form — `frontend/src/pages/IssueJob.jsx`

Rewritten to the seven-SMS-field shape:
  · Truck: single `<input>` (was two separate `truck_name` +
    `truck_reg` fields wrapped in a picker).
  · **Paste SMS** button (top-right of page) → modal with textarea
    → `POST /mobile/sms/parse` → pre-fills the form.
  · Staff-names field: comma-separated free-text, falls back to
    picked workers' names if left blank.
  · Removed: task input, all supervisor references, truck picker.
  · Left panel row rendering now reads the `.132p0` fields
    (`r.site_name || r.address`, `r.issued_at`).

## Tests — `backend/tests/test_v58_13_132p0_daily_jobs_schema.py`

9 tests, all passing:

```
tests/test_v58_13_132p0_daily_jobs_schema.py::test_parser_extracts_exact_sms_shape PASSED
tests/test_v58_13_132p0_daily_jobs_schema.py::test_parser_handles_labeled_format PASSED
tests/test_v58_13_132p0_daily_jobs_schema.py::test_parser_never_raises_on_junk PASSED
tests/test_v58_13_132p0_daily_jobs_schema.py::test_sms_parse_endpoint_returns_seven_fields PASSED
tests/test_v58_13_132p0_daily_jobs_schema.py::test_create_daily_job_with_seven_fields PASSED
tests/test_v58_13_132p0_daily_jobs_schema.py::test_create_ignores_extra_legacy_keys PASSED
tests/test_v58_13_132p0_daily_jobs_schema.py::test_today_endpoint_returns_clean_shape PASSED
tests/test_v58_13_132p0_daily_jobs_schema.py::test_accept_and_decline_transitions PASSED
tests/test_v58_13_132p0_daily_jobs_schema.py::test_signon_stub_returns_501 PASSED

============================== 9 passed in 6.66s ===============================
```

Tests hit the LIVE supervisor-managed backend on `http://localhost:8001`
via `httpx` to sidestep Motor's per-loop client cache (TestClient +
Motor collide on shared event loops in this codebase). Per-test
cleanup runs in a subprocess so every teardown gets a guaranteed
fresh loop.

Live curl verification against the preview host:

```
== Admin /today ==
status= issued
truck= Cappellotto 2 - Volvo - XT48AK
date= 2026-09-15
site_name= 78 Corin Street West Launceston
address= 78 Corin Street West Launceston, TAS 7250
customer= Shaw
staff= ['DANIEL BUTLER', 'JARROD TARGETT', 'JASON DONNELLAN']
legacy_leak? False

== POST /api/mobile/sms/parse ==
{
  "parsed": {
    "truck": "Cappellotto 2 - Volvo - XT48AK",
    "date": "2026-09-15",
    "site_name": "78 Corin Street West Launceston",
    "address": "78 Corin Street West Launceston, TAS 7250",
    "customer": "Shaw",
    "staff": ["DANIEL BUTLER", "JARROD TARGETT", "JASON DONNELLAN"],
    "notes": "Kroll to site to expose main"
  },
  "missing": []
}
```

## Version bumps

  · `frontend/public/service-worker.js`  CACHE_VERSION → `paneltec-v160.3.9.58.13.132p0`
  · `frontend/src/lib/version.js`        RUNNING_VERSION → `paneltec-v160.3.9.58.13.132p0`
  · `frontend/src/lib/version.js`        EXPECTED_CACHE_VERSION → `paneltec-v160.3.9.58.13.132p0`

## Files touched

Backend:
  · `backend/sms_parser.py`                         **NEW** — shared parser
  · `backend/mobile_sms_parse.py`                   **NEW** — POST /api/mobile/sms/parse
  · `backend/mobile_daily_jobs.py`                  rewritten — locked contract
  · `backend/daily_jobs_batch.py`                   rewritten — bulk uses same shape
  · `backend/server.py`                             +1 import, +1 include_router
  · `backend/tests/test_v58_13_132p0_daily_jobs_schema.py`  **NEW** — 9 tests

Scripts:
  · `scripts/migrate_132p0_data_model_reset.py`     **NEW** — one-off migration
  · `scripts/seed_132p0_trial_job_wide.py`          **NEW** — new-schema seed

Frontend:
  · `frontend/src/pages/IssueJob.jsx`               rewritten — 7-field form + Paste SMS
  · `frontend/public/service-worker.js`             CACHE_VERSION bump
  · `frontend/src/lib/version.js`                   RUNNING + EXPECTED bump

## What Phase 2 needs (already unblocked)

  · `POST /api/mobile/sms/parse` — ready. Mobile SMS receiver just
    needs to POST the incoming SMS body and use the response to
    call `POST /api/mobile/daily-jobs` (per-worker). Same schema
    across web + mobile. No duplication.

## Ship pointers

  · Not pushed. Defensive git reset kept parallel-actor files
    untouched.
  · Ship label: `.132p0`.
  · Migration is idempotent — safe to re-run against production
    when the time comes.
  · Mobile is untouched. No EAS rebuild needed for Phase 1.
