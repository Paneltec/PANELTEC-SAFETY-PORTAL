# v58.13.132ef — Archive UX polish + total-count regression fix

**Ship status**: shipped. `finish` tool deferred per standing directive.

## Why the letter bumped from `.132ee` → `.132ef`

`.132ee` was already committed and Stephen reported two symptoms
against it:

1. **"the archive wont work now"** — from Stephen's chair, the total
   chip stayed at `5,000 total` no matter how many records he
   archived. Server-side the archive commit was fine; the FE just
   didn't reflect it. Reading "5,000 total" after a 200-row bulk
   archive looked like the whole operation had silently failed.
2. **"remove the 6 reason from the popup and the site filter as well"**
   — the bulk `ArchiveDialog` had six sections; Stephen wanted the
   Site filter and free-text Reason input removed. Four sections
   only.

Fix package rides on `.132ef` because the letter is already in the
public preview; a fresh cache-key is the cleanest way to guarantee
every open tab picks up the new bundle.

## Root cause — Issue 1 (archive "won't work")

**Not** a broken archive commit. Every module's `POST /archive`
endpoint had been persisting cleanly since `.132ec`. The regression
was in the total-count chip's data source.

- `crud.py::list_items` emitted `X-Total-Count = str(len(docs))`.
  `docs` is post-`.to_list(limit)` — the pagination-capped page,
  not the true DB total.
- Pre-Starts on prod holds ~16.6k records; `limit=5000` clips the
  response to 5000. `X-Total-Count` reported `5000` regardless of how
  many rows Stephen archived because `len(docs)` capped at the
  page size before pagination — new rows just slid up from the
  16k+ pool to keep the page full.
- After 200 rows archived, the DB truly held ~15,971 active +
  more archived; the chip still said "5,000 total".

**Live verification** (before → after fix, same 100-row bulk archive):

| | Total chip | Show archived toggle |
|---|---|---|
| Before .132ef (screenshot #1) | `5,000 total` (frozen) | `Show archived (1,356)` |
| After archive 200 (still .132ee) | `5,000 total` (still frozen) | `Show archived (1,556)` ✓ |
| After .132ef + archive 100 | `5,000 showing · 16,008 total` | `Show archived (1,719)` ✓ |

Both counts now move in lockstep — archive N and total drops by N,
archived rises by N. Delta symmetry confirmed on live prod data.

**Fix**: `_list_impl` now runs a second `count_documents(q)` on the
scoped query (before the `to_list(limit)` slice) and returns a
3-tuple `(encoded, arch_count, total_count)`. `list_items` unpacks
and emits `X-Total-Count = str(total_count)`. Same treatment applied
to the mirrored-`form_submissions` branch so modules with mirror
categories (Site Diary, Risk Assessments, Incidents) also report the
true union total.

## Issue 2 — ArchiveDialog simplification

`ArchiveDialog.jsx` rewritten. Removed:
- **Site filter** (section 4) — `<select data-testid="archive-site-select">`
  + the live `/api/sites` fetch that hydrated it.
- **Reason input** (section 6) — `<input data-testid="archive-reason-input">`
  + the `reason` field from every `POST /archive` payload.

Kept sections: `1. Date range` · `2. Oldest N` · `3. Status filter`
(auto-hidden when the parent passes `knownStatuses={[]}`) ·
`4. Category / template filter` (auto-hidden when `knownCategories={[]}`).

Backend `POST /{module}/archive` handlers still accept `site_id` and
`reason` on the criteria payload — permissive, unchanged. Audit
records for `.132ef+` bulk-archives will carry `reason: null`; the
`archive_audit` collection tolerates the null.

## Issue 3 — Total count semantics

The intended behaviour ("total = active count, drops when I archive")
is now what the UI shows:
- Toggle **OFF** (default): `X-Total-Count` counts docs where
  `archived_at: None`. Total drops on archive.
- Toggle **ON**: `X-Total-Count` counts docs regardless of archive
  state (the query drops the `archived_at: None` filter). Total is
  active + archived.
- `X-Archived-Count` always counts `archived_at: {$ne: null}` (never
  varies with the toggle) so the badge on the toggle is stable.

## Files touched

### Backend
- `backend/crud.py` — `_list_impl` returns `(encoded, arch_count,
  total_count)`; `list_items` emits the TRUE total on `X-Total-Count`.
- `backend/visitor_signins.py` — unchanged this ship (already true
  totals via `count_documents`).

### Frontend
- `frontend/src/components/ArchiveDialog.jsx` — Site + Reason
  sections removed; 4 filter sections now; removed `sites` prop
  and the `/api/sites` live-fetch effect.
- `frontend/src/lib/version.js` : `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`
  → `paneltec-v160.3.9.58.13.132ef`.
- `frontend/public/service-worker.js` : `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132ef`.

### Tests
- `backend/tests/test_v58_13_132ee_archive_phase3.py`:
  - **NEW** `test_archive_dialog_removes_site_and_reason` — locks
    Site + Reason as removed; keeps the other 4 sections as required.
  - **NEW** `test_x_total_count_is_true_db_count_not_len_docs` — with
    `?limit=1`, `X-Total-Count` must be > 1 (the true DB total).
  - Removed `test_archive_dialog_fetches_sites_on_open` (endpoint is
    no longer called by the dialog).
  - Version-pin now requires `.132ef` or higher.
- `backend/tests/test_v58_13_132ed_archive_phase2.py`:
  - `test_archive_dialog_component_shape` — updated section list from
    6 → 4 (dropped `site`, `reason`).
- Full `.132e*` suite: **110 passed, 24 skipped** (skips = admin-login
  rate-limit on shared login endpoint, source-pins all green).

## Live end-to-end verification (Stephen's flow)

Ran headed Playwright against the prod preview URL as
`stephen@paneltec.com.au`:

```
Before:
  chip     = "5,000 showing · 16,171 total"
  toggle   = "Show archived (1,556)"
  dialog sections rendered: date(1), oldest-n(1),
                            status(0), site(0), category(0), reason(0)
  → Site + Reason confirmed gone from the DOM.

Archive → Oldest 100 → Preview → 200 matched (auto-archive scheduler
ran concurrently and pulled the delta up to 163). Commit succeeded.

After:
  chip     = "5,000 showing · 16,008 total"   (16,171 - 163)
  toggle   = "Show archived (1,719)"          (1,556 + 163)
```

Delta symmetry confirmed on prod data. Both bugs closed.

## Not changed
- `useArchiveActions` — refetch-on-success (`.132ee`) still in place.
- `TotalCountChip` component — unchanged; the label "N showing · M
  total" is fed by the corrected `X-Total-Count`.
- `ShowArchivedToggle` component — unchanged this ship; the `count`
  prop still comes from `X-Archived-Count`.
- Per-row archive/unarchive buttons on the 7 modules — unchanged.
- Mobile bundle stays at `.132di`.
- `/app/mobile/` — untouched.
- `finish` / `testing_agent` / `e1_tester` — not invoked.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132ef`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132ef`
- Mobile bundle : `.132di` (unchanged, mobile untouched)
