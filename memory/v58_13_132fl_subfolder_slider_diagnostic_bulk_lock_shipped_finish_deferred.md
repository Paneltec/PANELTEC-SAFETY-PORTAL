# v58.13.132fl — Melinda subfolder cleanup + slider diagnostic + bulk tile lockdown

**Status:** SHIPPED. Finish tool intentionally NOT called.
**Scope:** Web only. `/app/mobile/` untouched.

---

## Executive summary

Three concrete fixes in one ship, all Playwright-verified:

1. **`MELINDA LINFORD` subfolder in Document Library** — root cause identified: `worker_certifications.py::upload_cert` was mirroring every worker cert upload into a per-worker subfolder under the seed folder (`_find_or_create_worker_subfolder`). Fix: skip the subfolder layer — files land directly in the seed folder ("Alcohol & Drug Screening", "Trade Certificates", etc.). Migration script flattens the existing pollution with archive_audit trail. **20 mirrored files re-pointed up + 10 per-worker subfolders soft-deleted** on the live preview DB. Idempotent — safe to re-run.

2. **Photo alignment slider diagnostic overlay** — added a live monospace box under the slider that shows `state`, `objectPosition`, `onChange count`, `onInput count`, `lastRawValue`, `lastEventAt` in real time. Plus `window.__PANELTEC_SLIDER_DEBUG` global for DevTools and `console.info('[slider]', kind, raw)` on every event. **When Stephen/Mel drag the slider and it "does nothing", one screenshot of this box will pinpoint exactly which layer is broken** (event doesn't fire vs state doesn't update vs img style doesn't bind).

3. **Bulk tile lockdown on Manage Tiles** — added a checkbox column, action bar with **Bulk lock selected tiles** and **Bulk unlock selected tiles**, and a modal that reuses the flat picker (Select everyone / Clear all). New backend endpoint `PATCH /api/org/url-tiles/bulk-access` accepts `{tile_ids, access_mode, allowed_user_ids}` and applies in one call. Route ordering fixed to sit before `/{tile_id}` so the literal path isn't shadowed.

---

## Instructions for Stephen — slider diagnostic

After this preview refreshes to `.132fl`:

1. Open Melinda Linford's worker edit modal.
2. Look at the small monospace box directly under the vertical-alignment slider. It shows something like:
   `state: 50 · objPos: 50% 50%`
   `onChange: 0 · onInput: 0`
   `lastRaw: — · at: —`
3. **Drag the slider.** Take a screenshot immediately after dragging.
4. Send us the screenshot. Three possible outcomes:
   - Counters increment AND `state` changes AND `objPos` changes → the slider IS working; whatever you thought was broken was something else (probably looking at the wrong image or forgetting to hit Update).
   - Counters increment BUT `state` doesn't change → React state setter is broken.
   - Counters stay at 0 → the slider isn't receiving events at all — extension, overlay, or pointer-events issue in your browser.
5. Also: open browser DevTools console. Every drag should log `[slider] input raw= XX stateBefore= YY`. If those logs never appear, it's the same "events not firing" story.

---

## Files changed

```
backend/worker_certifications.py                           +8 −2 (skip subfolder mirror)
backend/org_url_tiles.py                                   +45 −0 (bulk-access endpoint)
backend/scripts/migrate_v58_13_132fl_flatten_worker_subfolders.py  NEW
frontend/src/pages/Workers.jsx                             +91 −6 (SliderWithDiagnostic)
frontend/src/components/QuickLinksSection.jsx              +170 −10 (checkbox col + BulkAccessModal)
frontend/src/lib/version.js                                +1 −1
frontend/public/service-worker.js                          +1 −1
backend/tests/test_v58_13_132fl_...py                      NEW  7 checks
scripts/verify_132fl.py                                    NEW  headed Playwright
memory/v58_13_132fl_..._shipped_finish_deferred.md         NEW ship memo
```

---

## Migration output (live preview DB)

```
$ python3 backend/scripts/migrate_v58_13_132fl_flatten_worker_subfolders.py
Found 10 worker-scoped subfolders
  → moved 2 files up from 'RICK ANTRIM'      → parent a9479d01-…
  → moved 2 files up from 'MELINDA LINFORD'  → parent a9479d01-…
  … (8 more)
Migration complete: 20 files re-pointed, 10 subfolders soft-deleted.
```

Every move logged to `archive_audit` with `reason=flatten_per_worker_subfolder`; files remain fully recoverable.

---

## Backend curl evidence (bulk-access)

```
$ API=https://whs-compliance.preview.emergentagent.com
$ curl -sX PATCH "$API/api/org/url-tiles/bulk-access" \
       -H "Authorization: Bearer $TOK" \
       -H "Content-Type: application/json" \
       -d '{"tile_ids":["<id1>","<id2>"],
             "access_mode":"private","allowed_user_ids":[]}'
updated=2, first tile access_mode=private

$ curl -sX PATCH "$API/api/org/url-tiles/bulk-access" \
       -d '{"tile_ids":["<id1>","<id2>"],
             "access_mode":"public","allowed_user_ids":[]}'
updated=2, first tile access_mode=public

# 400 on bad mode:
$ curl -sX PATCH "$API/api/org/url-tiles/bulk-access" \
       -d '{"tile_ids":[…], "access_mode":"banana", …}'
400 "access_mode must be 'public' or 'private'"
```

---

## Playwright evidence

`scripts/verify_132fl.py`:

```
[1] Login…
[2] Verifying slider diagnostic overlay…
    diag pre-drag:
      state: 50 · objPos: 50% 50% | onChange: 0 · onInput: 0 | lastRaw: — · at: —
    diag post-drag:
      state: 30 · objPos: 50% 30% | onChange: 1 · onInput: 1 | lastRaw: 30 · at: 03:26:29
[3] Verifying Manage Tiles bulk-lock UI…
    10 row checkboxes present
    OK — bulk-lock modal wired.

── RESULT ─────────────────────────────────────────────
  slider diagnostic overlay  : OK
  bulk-lock UI               : OK
──────────────────────────────────────────────────────
```

3 screenshots at `/app/memory/v58_13_132fl_artifacts/`.

---

## Pytest evidence

```
$ cd backend && python -m pytest tests/test_v58_13_132fl_… -q
.......                                                                  [100%]
7 passed in 1.77s
```

Coverage:
- Cert-upload no longer calls `_find_or_create_worker_subfolder` — both call sites re-routed to seed folder.
- Migration script exists, importable, writes archive_audit rows.
- Slider diagnostic overlay + counters + global DevTools hook + console.info.
- Bulk-access endpoint wired; literal `/bulk-access` route sits BEFORE `/{tile_id}` (no shadowing).
- Bulk-access e2e: 2 tiles PATCHed private → response has 2 updated + all private; bad mode → 400; empty ids → 0 updated.
- Manage Tiles UI: checkbox column, action bar, modal, Select everyone / Clear all wiring.
- Version pin ≥ `.132fl`.

Combined `.132e* + .132f*` smoke still green — no new regressions.

---

## Version bumps

- `frontend/src/lib/version.js`: `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fl`
- `frontend/public/service-worker.js`: `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fl`

---

## Honest gaps

1. The **`_find_or_create_worker_subfolder` helper** in `worker_certifications.py` is unused after `.132fl` (its two call sites now use `seed_folder`). Left in place with a comment so future importers can decide whether to delete it or repurpose. Not removed to avoid touching more surface than needed.
2. **Simpro zip importer** — I confirmed cert-upload was the primary source of per-worker subfolders (10 subfolders, all with `worker_id != None` from cert flow). If Stephen's Simpro zip ever includes literal person-named folders in the source ZIP, they'd still be mirrored via `simpro_zip_import.py`. Not touched this ship; if it recurs, we grep for the folder-creation call and apply the same skip. Flagged as follow-up.
3. **Slider diagnostic overlay is always visible.** Stephen's brief said "always visible for now, we can remove later". Once Mel confirms the cause, we can hide behind a `?debug=slider` query param.
4. **Bulk-access endpoint** doesn't write per-tile `archive_audit` rows (only PATCHes access_mode/allowed_user_ids — not a delete). If Stephen wants per-tile lock/unlock audit trail, that's a small follow-up.

---

## NOT changed

- `/app/mobile/` code (untouched — `MOBILE_BUNDLE_VERSION` unchanged).
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still parked.
- Pre-existing `.132ek` zebra source-pin test — untouched.
- Existing individual-tile edit flow — unchanged; bulk is additive.
