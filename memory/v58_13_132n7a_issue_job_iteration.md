# v58.13.132n7a — Issue Today's Job iteration (supervisor removed + SMS-shape trial seed)

**Ship label:** `.132n7a`
**Cut on top of:** `9999553f` (`.132n6`) — the last commit landed by me. The parallel mobile agent has since shipped `.132n5m1`, `.132n5m2`, `.132n5m3`, `.132n5m5`; those are mobile-side and this ship does not touch them.
**No push.**

---

## What this ship does

Bundles the entire `.132n7` initial "Issue Job" web-form ship (never
committed) with the iteration corrections from the user's follow-up
briefs:

* Supervisor field REMOVED entirely — Paneltec has no supervisors.
* Sidebar entry + H1 renamed **Issue Today's Job**.
* Mobile `/api/mobile/daily-jobs/today` grows a fallback path so a
  past-dated unaccepted job still populates the Home tile.
* Real trial seed for `worker_stephen@paneltec.com.au` with the
  verbatim SMS shape from the officer's screenshot (15 Sept 2026,
  Cappellotto 2, 78 Corin St, Shaw, Kroll notes, no supervisor).

Housekeeping retry is documented at the end — still 403, reconnect
still not done.

NAS lockdown ships next as `.132n8`.

---

## Backend

### `backend/daily_jobs_batch.py`

* Removed `supervisor_id`, `supervisor_name`, `supervisor_phone`
  from `BulkCreateIn`.
* Removed the entire supervisor resolve block (~25 LOC).
* Removed the supervisor keys from the doc-shape dict; every
  child doc built by this endpoint now lacks `supervisor_*`
  entirely.
* Pydantic default `extra="ignore"` silently drops any legacy
  `supervisor_id`/`_name`/`_phone` on inbound payloads without
  400ing — backwards compat for older FE builds still in flight.
* Added prominent `.132n7a` note in the docstring / class comment
  explaining the removal.

### `backend/mobile_daily_jobs.py` — `/today` fallback

The bare-date filter (`date == today_syd`) was too strict for the
trial-seed flow (past-dated SMS date). Extended `_load()`:

1. First try exact-date match on `assignee_id` (both user AND
   workers-by-email identity paths). Unchanged.
2. If no exact-date row exists, look up the most-recent
   non-terminal (accepted/declined/completed = null) row for the
   same worker, sorted by `date` desc → `issued_at` desc →
   `assigned_at` desc.
3. If the user-branch fallback misses, retry with the
   workers-by-email branch so both identity paths get their
   fair share.
4. Cleaned payload gets an additive `is_past_date_fallback: bool`
   flag so the mobile UI can render a subtle "issued <date>"
   hint if it wants. Non-breaking.

### `backend/tests/test_v58_13_132n7_daily_jobs_batch.py`

Updated to reflect the supervisor removal:

* Payload no longer sets `supervisor_id`.
* Snapshot-field assertions changed from `d["supervisor_id"] ==
  user_ids[0]` to `"supervisor_id" not in d` (and same for name +
  phone).
* Replaced the old "supervisor omitted succeeds" test (step 12)
  with a **backwards-compat test**: sending
  `supervisor_id`/`_name`/`_phone` in the payload MUST NOT 400
  AND MUST NOT land on the doc. Pydantic's `extra="ignore"`
  handles it.

Test run (post-changes):

```
$ python3 -m pytest tests/test_v58_13_132n7_daily_jobs_batch.py -v
tests/test_v58_13_132n7_daily_jobs_batch.py::test_bulk_create_batch_and_conflict_flow PASSED [100%]
============================== 1 passed in 0.39s ===============================
```

---

## Frontend — `frontend/src/pages/IssueJob.jsx`

Supervisor UI totally excised:

* `supervisor: null` gone from form state.
* Supervisor `<Label>` + `<WorkerSinglePicker>` block removed
  (~15 LOC).
* Whole `WorkerSinglePicker` function removed (85 LOC — was only
  used by supervisor).
* `UserIcon` removed from the lucide-react import list.
* `supervisor_id`/`_name`/`_phone` gone from the POST payload.
* Reset-form call no longer touches `supervisor`.
* Left-panel recent-list row: `"Sup: X"` hint replaced with the
  customer name.
* Task field promoted from optional label to explicit
  `<Label ... optional />` (uses the same "(optional)" grey hint
  I introduced for supervisor in `.132n7`).
* Layout tightened: Task + Notes now share the second-to-last
  row at `col-span-1` each (previously Task was `col-span-1` and
  Notes was `col-span-2`).

H1 + sidebar rename (from `.132n7`):

* `frontend/src/pages/IssueJob.jsx` H1: `Issue Job` → **Issue Today's Job**.
* `frontend/src/components/layout/AppShell.jsx` sidebar label:
  `Issue Job` → **Issue Today's Job**.

Route unchanged: `/app/mobile/issue-job` (parallels
`/app/mobile/assign-daily-jobs` — same domain, sits next to it in
the Compliance section).

Trial-run checkbox (from `.132n7`) preserved:

* "Trial run — also send a copy to my own phone (adds a mirror
  assignment for you)."
* When ticked, backend appends the calling admin's own user id to
  the batch; a mirror doc lands with `is_trial_mirror=true`.

---

## Trial seed — `scripts/seed_132n7a_trial_job.py`

Fully rewritten (rev 2) per the user's exact spec.

**Target:** `worker_stephen@paneltec.com.au` — resolves in db.users
(and would also resolve in db.workers if a matching row existed;
only the users row was found in this org).

**Payload (verbatim SMS shape):**

| Field | Value |
|---|---|
| `date` | `"2026-09-15"` |
| `issued_at` | `"2026-09-15T07:07:00+10:00"` (Sydney) |
| `truck_name` | `"Cappellotto 2 - Volvo"` |
| `truck_reg` | `"XT48AK"` |
| `site_name` | `"78 Corin Street West Launceston"` |
| `site_address` | `"78 Corin Street West Launceston, TAS 7250"` |
| `customer` | `"Shaw"` |
| `staff_names` | `["DANIEL BUTLER", "JARROD TARGETT", "JASON DONNELLAN"]` |
| `notes` | `"Kroll to site to expose main, ring Jason to complete tapping when exposed Tap 50mm connection to Main, all fittings to be supplied, after site visit"` |
| `task` | `null` |
| `status` | `"issued"` |
| `job_batch_id` | `04736b4d-d655-4c71-accf-fe316bae461f` (shared) |
| `is_trial_mirror` | `true` |
| `meta.trial_marker` | `"132n7a_trial_seed"` |
| `supervisor_*` | **absent — Paneltec has no supervisors** |

**Idempotency:** purges every prior `132n7a_trial_seed`-tagged row
for the target identities before inserting. Safe to re-run.

**Live insert log:**

```
[trial-seed] Found 1 identity match(es) for 'worker_stephen@paneltec.com.au':
  · user   id=21dddcc2-e184-47f7-bac6-9b128925b8df  name='Test Worker (Stephen Org)'
[trial-seed] Removed 0 previous trial row(s).
  → inserted assignment ff27f34c-cd6f-4683-987b-0216b8d51db3 for kind=user id=21dddcc2-…
[trial-seed] job_batch_id: 04736b4d-d655-4c71-accf-fe316bae461f
[trial-seed] SMS date: 2026-09-15  issued_at: 2026-09-15T07:07:00+10:00
```

---

## /today fallback proof (simulated call)

```
today (Sydney): 2026-09-26
seeded date   : 2026-09-15  (past — needs fallback)
fallback found:
  status                : pending_accept
  is_past_date_fallback : True
  cleaned.site_name     : 78 Corin Street West Launceston
  cleaned.truck_name    : Cappellotto 2 - Volvo
  cleaned.staff_names   : ['DANIEL BUTLER', 'JARROD TARGETT', 'JASON DONNELLAN']
  cleaned has supervisor: False
```

The `/today` payload for `worker_stephen@paneltec.com.au` will now
surface this doc verbatim on the mobile Home tile.

---

## Housekeeping status — STILL BLOCKED

Re-ran `/app/scripts/dropbox_housekeeping_132n5_trash.py`. All three
targets returned the same `AuthError('missing_scope',
TokenScopeError(required_scope='files.permanent_delete'))` as the
previous two attempts.

Diagnosis unchanged from `.132n5_hk1`: App Console tick landed, but
the OAuth **reconnect** step never happened. The current refresh
token still predates the scope grant.

Recovery action for the user (unchanged):

1. Admin portal → Settings → Dropbox integration → **Reconnect**.
2. Complete Dropbox's consent screen (approve the new
   `files.permanent_delete` scope).
3. Ping me — I'll re-run the housekeeping script.

Nothing this ship can do.

---

## Files touched

```
 M backend/daily_jobs_batch.py                              (supervisor removed)
 M backend/mobile_daily_jobs.py                             (/today fallback)
 M backend/tests/test_v58_13_132n7_daily_jobs_batch.py      (assertions updated)
 M backend/server.py                                        (router mount — from .132n7)
 M frontend/src/pages/IssueJob.jsx                          (supervisor UI removed)
 M frontend/src/App.js                                      (route — from .132n7)
 M frontend/src/components/layout/AppShell.jsx              (sidebar label — "Issue Today's Job")
 M frontend/src/lib/version.js                              (RUNNING + EXPECTED bump + this block)
 M frontend/public/service-worker.js                        (CACHE_VERSION bump)
?? scripts/seed_132n7a_trial_job.py                         (rev 2)
?? memory/v58_13_132n7a_issue_job_iteration.md              (this file)
?? test_reports/132n7a_form_no_supervisor.jpeg              (screenshot proof)
```

## Not in this ship

* NAS lockdown — shipping next as `.132n8`.
* Housekeeping run — awaits Dropbox reconnect.
* Mobile-side edits — none, and never. Mobile agent shipped
  their supervisor-removal + new-job pulse in parallel as `.132n5m5`.

## Ship discipline

* Defensive `git reset HEAD -- .` before staging.
* Parallel-actor stowaways (`.emergent/emergent.yml`,
  `craco.config.js`, `android_manifest.json`, everything under
  `mobile/`, and the new mobile version bumps) confirmed **not**
  in the commit.
* Backend restart (`sudo supervisorctl restart backend`) required
  to pick up the router mount (was running w/o `--reload`).
* Test suite passed post-changes.
* No push. No `testing_agent`. No `finish` tool.
