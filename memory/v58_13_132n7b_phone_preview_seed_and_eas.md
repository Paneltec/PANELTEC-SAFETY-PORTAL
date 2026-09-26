# v58.13.132n7b — Phone-preview trial-seed wide net + EAS rebuild status

Follow-up to the `.132n7a` "Issue Today's Job" ship. Stephen reported
the mobile Home "Today's Assignment" tile was still empty on the admin
phone-preview iframe. This memo documents the diagnosis, the wide-net
re-seed, and the EAS rebuild blocker.

## P0-1 — Phone-preview seed not reaching the tile

### Diagnosis
The `.132n7a` seed targeted `worker_stephen@paneltec.com.au` only,
which resolves to `users.id = 21dddcc2-e184-47f7-bac6-9b128925b8df` in
this env (no `workers` row exists for that email).

The admin phone-preview iframe (`/app/phone-preview` →
`components/settings/MobileModulesSection.jsx :: PhonePreview`) mints
a synthetic session via `GET /api/mobile/preview-user` with a
**random `preview-<scope>-<hex>` subject** and, when no worker is
picked in the "Preview as specific worker" dropdown, an
`<subject>@preview.paneltec.local` email. `GET /api/mobile/daily-jobs/today`
resolves the caller identity in this order:

  1. `assignee_id = user["id"]` (the random subject) — never matches
     any real seed doc.
  2. `workers.find_one({email: user["email"]})` fallback — the fake
     `@preview.paneltec.local` email never matches, so the fallback
     is a no-op.
  3. `.132n7a` "most-recent-unaccepted" fallback keyed off the
     resolved `assignee_id` — still the random subject, no match.

**Result:** default plain-scope preview always returns
`{"assignment": null, "status": "no_job"}`. This is by design — the
endpoint has no identity to resolve without a worker binding.

When the admin picks a worker in the dropdown, the JWT carries the
worker's real email, the `workers` fallback lands on that worker's
`workers.id`, and the tile populates *if a seed exists for that
`workers.id`*.

### Identities in this env (org `3116f250-a4eb-43f3-98a5-2a3656d6cb63`)

| Email                                | users.id                                | workers.id                              | Comes up in preview picker |
|--------------------------------------|-----------------------------------------|-----------------------------------------|----------------------------|
| worker_stephen@paneltec.com.au       | `21dddcc2-e184-47f7-bac6-9b128925b8df`  | *(no workers row)*                      | ❌ picker only lists workers |
| stephen@paneltec.com.au              | `808cb7de-985a-4c49-8554-9c67e5e86313`  | `dbddf739-5803-4a86-925d-ed1aef514fa1`  | ✅ as "Stephen Guy"          |

Only `stephen@paneltec.com.au` (Stephen Guy → worker `dbddf739`) is
selectable in the picker, so that's the identity the admin phone-
preview iframe resolves to when they bind a worker.

### Fix — `scripts/seed_132n7b_trial_job_wide.py`

Casts a wide net: seeds the trial SMS-shape job for BOTH target
emails, resolving each to users AND workers rows. Three docs written
in this env (all with `meta.trial_marker = "132n7b_trial_seed"` for
idempotent re-runs):

  · user   `worker_stephen@paneltec.com.au` → 21dddcc2-…  (already covered by .132n7a, kept for parity)
  · user   `stephen@paneltec.com.au`        → 808cb7de-…  (admin direct login)
  · worker `stephen@paneltec.com.au`        → dbddf739-…  (phone-preview binding + email fallback)

### Verification (curl, `/api/mobile/daily-jobs/today`)

```
== Admin /today (stephen@paneltec.com.au) ==
  status = pending_accept
  worker_id = dbddf739-5803-4a86-925d-ed1aef514fa1
  site      = 78 Corin Street West Launceston
  truck     = Cappellotto 2 - Volvo XT48AK
  customer  = Shaw
  staff     = ['DANIEL BUTLER', 'JARROD TARGETT', 'JASON DONNELLAN']
  is_past_date_fallback = True    # .132n7a fallback surfacing the 15-Sep row

== Preview session (scope=paneltec_civil, no worker) ==
  status = no_job                 # unchanged — no identity to resolve

== Preview session bound to worker Stephen Guy (dbddf739) ==
  status = pending_accept
  worker_id = dbddf739-5803-4a86-925d-ed1aef514fa1
  ...populated...
```

**Bottom line:** the tile will populate on the phone-preview iframe
as soon as the admin picks **Stephen Guy** in the "Preview as
specific worker" dropdown. When Stephen tests on his real device
(logged in as either `stephen@paneltec.com.au` or
`worker_stephen@paneltec.com.au`), the tile populates directly.

### What we did NOT change

- No backend code changes. `/today` and preview minting behave
  exactly as they did in `.132n7a`; the only change is the seed
  coverage.
- No UI auto-select of a default worker in the phone-preview picker.
  If the empty default keeps confusing operators, a follow-up ship
  could either (a) auto-select the first worker on mount, or (b)
  render an inline "Pick a worker to preview their assignment"
  callout when the tile is empty. Not shipped here to keep the
  surface minimal.
- `worker_stephen@paneltec.com.au` still has no `workers` row, so
  it won't show up in the preview picker. Not our call — that
  account is a synthetic test user, and Stephen tests via his real
  `stephen@paneltec.com.au` admin credential.

## P0-2 — EAS rebuild status

Current published APK is v1.0.40 build 162 from 2026-09-22. Recent
mobile ships (`.132n5m2` through `.132n5m5`) are not in that binary.

### Inventory

- `EXPO_TOKEN`   ✅ set in `backend/.env`.
- `POST /api/mobile/downloads/android/ingest-from-eas`  ✅ exists —
  but it only **pulls** the latest FINISHED build off EAS; it does
  NOT trigger a new one.
- `eas` / `eas-cli` binary   ❌ not installed anywhere on the pod
  (checked `/usr/local/bin`, `/root/.npm-global`, `/app/mobile/node_modules/.bin`).
- Build endpoint that TRIGGERS a new EAS build   ❌ not implemented.

### What's needed to trigger a build

Two viable paths (need Stephen's steer):

1. **Install `eas-cli` globally** (`yarn global add eas-cli`, adds
   ~140 MB) and run
   `EXPO_TOKEN=… eas build -p android --profile preview --non-interactive`
   from inside `/app/mobile`. Non-interactive requires only reading
   `/app/mobile/eas.json` (no edits). Build runs on Expo's cloud, ~15
   min turnaround. Result APK can then be pulled onto the pod via
   the existing `ingest-from-eas` endpoint.

2. **Add a new endpoint** `POST /api/mobile/downloads/android/build-and-ingest`
   that calls the EAS GraphQL `createBuild` mutation with our
   existing `EXPO_TOKEN`, polls status, then invokes the ingest
   pipeline. Cleaner long-term but more code.

Neither is trivial and both require Stephen's blessing. Ship blocked
until then. Recording this so the phone-preview seed fix isn't held
up.

### Ship pointers

- `.132n7b` = wide-net seed only. No FE, no BE code changes.
- Trial-marker for idempotent re-runs: `132n7b_trial_seed` (distinct
  from `.132n7a`'s `132n7a_trial_seed` so both seeds coexist without
  clobbering each other).
- To reseed after Stephen accepts/declines the job (which clears the
  tile): `python3 /app/scripts/seed_132n7b_trial_job_wide.py`.
