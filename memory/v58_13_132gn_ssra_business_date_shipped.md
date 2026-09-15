# v58.13.132gn — SSRA business-date column · SHIPPED

## Root cause

`.132fv` deferred SSRA date rendering; today's diagnosis with a live
sample confirmed the deferral: a **14 Sep 2026** SSRA submission carried
an internal `fields[]` "Date" field with value **23 Dec 2024** (the
actual assessment day). The list column was rendering the top-level
`r.date` (auto-mirrored to the submission day) not the field value.

```
GET /api/risk-assessments?limit=1
  r.date:             2026-09-14        ← submission day (was showing here)
  r.submitted_at:     2026-09-14T…
  r.assessment_date:  (not present)
  fields[Date]:       "2024-12-23"      ← business day (now showing here)
```

## Fix — FE-only, no schema change

New shared helper `frontend/src/lib/deriveAssessmentDate.js`:
* Accepts a submission record.
* Prefers `record.assessment_date` when present (backend override slot
  for future consumers — e.g. CSV export or mobile client).
* Otherwise scans `fields[]` for the first `type === 'date'` value.
* Handles full ISO, short ISO, and `DD/MM/YYYY`. Returns
  `YYYY-MM-DD` or `null`.

Wired into two surfaces:

* **`components/CaptureCard.jsx`** (renders Risk Assessments cards +
  Pre-Starts + Hazards + Site Diary + Inspections + Incidents grids).
  `dateStr = deriveAssessmentDate(r) || r.date || submitted_at.slice(0,10)`.
* **`pages/FormSubmissions.jsx`** (per-template submission list).
  Column header renamed from **When** → **Date** with a title tooltip
  ("Business date captured on the form; falls back to submission time
  when the form has no date field"). Both desktop table and mobile
  stack now render the derived date.

Legacy behaviour preserved: if no date field exists, falls back
through `r.date` then `r.submitted_at.slice(0,10)` — nothing hides.

## Verification

### Pytest
```
$ pytest backend/tests/test_v58_13_132gn_ssra_business_date.py -q
4 passed in 0.03s
```

Source pins on:
1. Helper exists, filters `type !== 'date'`, handles ISO regex,
   respects `record.assessment_date` override.
2. `CaptureCard` imports + prefers derived value in `dateStr`.
3. `FormSubmissions` imports helper, column header switched to
   "Date", new `submission-date-*` testid added, derived value
   consumed.
4. Version lockstep to `paneltec-v160.3.9.58.13.132gn`.

### Curl evidence
```
$ curl /api/risk-assessments?limit=1
  r.date: 2026-09-14
  fields[Date]: '2024-12-23'
```
Before: card / row rendered `2026-09-14`.
After: card / row renders `2024-12-23` (the SSRA's actual assessment
date). Same record; zero backend/data changes.

## Files changed
```
frontend/src/lib/deriveAssessmentDate.js         NEW 51 lines
frontend/src/components/CaptureCard.jsx          +8 −2
frontend/src/pages/FormSubmissions.jsx           +12 −2
frontend/src/lib/version.js                      × 2 version bump
frontend/public/service-worker.js                CACHE_VERSION bump
backend/tests/test_v58_13_132gn_ssra_business_date.py   NEW 40 lines
memory/v58_13_132gn_ssra_business_date_shipped.md       NEW (this)
```

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester`.
* `/app/mobile/` untouched.
* CRA — no Vite.
* Version bump → `paneltec-v160.3.9.58.13.132gn`.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Follow-up backlog

* Backend `assessment_date` write-time denormalisation for CSV export
  and mobile client parity. The helper already reads
  `record.assessment_date` first so a future ship can start writing
  the field without any FE change.
