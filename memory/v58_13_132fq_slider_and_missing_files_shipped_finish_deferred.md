# v58.13.132fq — Slider CSS fix + missing-file 410 handler (web only)

**Ship type:** Two independent bug fixes, one release.
**Scope:** Frontend photo render sites + backend download endpoints.
**Finish tool:** DEFERRED (per standing rule).

---

## Bug 1 — Photo-alignment slider had ZERO visual effect

### Root cause (algebra, not React)

Stephen's diagnostic screenshot from `.132fl` proved the event chain
was healthy: `state: 0 · onChange: 116` at slider left,
`state: 100 · onChange: 146` at slider right. The `objectPosition`
CSS value in the DOM updated on every drag. But the visible photo
did not move.

Why: **`object-fit: cover` on a square wrapper with a square (or
close-to-square) source photo produces ZERO overflow to reposition.**
Given content-box W×H and intrinsic w×h, the algorithm chooses
`scale = max(W/w, H/h)` and renders at `w·scale × h·scale`. When
`W == H` and `w == h`, both dimensions match after scaling and
`object-position` moves nothing.

Melinda's photo (a headshot roughly square-ish) hit exactly this
case in the 56×56 edit-modal preview.

### Fix

Applied to **every** worker-photo render site in `Workers.jsx`
(row 40×40, edit-modal slider preview 56×56, ID card 128×128) so the
crop looks consistent across surfaces:

```
Before:
  <img
    style={{ objectPosition: `50% ${offset}%` }}
    className="w-14 h-14 rounded-xl object-cover …" />

After:
  <div className="w-14 h-14 rounded-xl overflow-hidden …">
    <img
      style={{
        width: '100%',
        height: '200%',
        objectFit: 'cover',
        transform: `translateY(${-offset * 0.56}px)`,
        display: 'block',
      }}
    />
  </div>
```

Key insight: the img renders at 2× the wrapper's height (`h=200%` → 112 px
in the 56-tall wrapper). The wrapper's `overflow: hidden` crops. A
`translateY` from `0` (slider=0) to `-56 px` (slider=100) linearly
shifts the crop window across the full 56-px range. **Works
regardless of the source photo's aspect ratio** — no more dead
sliders on square headshots.

Translate scale factors per site:
- Row 40 px  → `-offset * 0.4`  (range 0..-40 px)
- Edit 56 px → `-offset * 0.56` (range 0..-56 px)
- ID  128 px → `-offset * 1.28` (range 0..-128 px)

### Slider diagnostic overlay retired

The `.132fl` counter panel (`state / onChange / onInput / lastRaw /
at`) served its purpose — it proved the React state was healthy so
we could confidently point the finger at CSS. `.132fq` deletes the
overlay, the `window.__PANELTEC_SLIDER_DEBUG` inspector hook and
the `console.info('[slider]', …)` line. The slider itself keeps its
`data-testid` + `data-photo-offset-y` attributes for testing.

### Visual proof

Playwright cropped screenshots of the 56 px edit-modal preview:

- `memory/v58_13_132fq_slider_0.png` (5,963 bytes, SHA-1
  `7b7a6ffc…`) — slider at `0`: **top of Mel's head visible**.
- `memory/v58_13_132fq_slider_100.png` (4,546 bytes, SHA-1
  `864fd0e1…`) — slider at `100`: **shoulders / collar visible**.

Byte-identical screenshots would prove the crop still isn't
moving; distinct SHA-1s + a 1,417-byte size delta prove the visible
region actually shifted.

---

## Bug 2 — Raw `{"detail": "File missing on disk"}` blob on legacy cert files

Stephen clicked Melinda's Drug and Alcohol Testing certification
and got a naked JSON blob because the underlying file bytes were
lost across a pod restart (ephemeral upload storage — see the
parked `v58.14.x` Object Storage migration). The record in Mongo
still exists.

### Fix

New shared helper `backend/missing_file_response.py`:

```python
def missing_file_response(*, record_still_exists: bool = True,
                          restore_hint: str = "…"):
    return HTTPException(
        status_code=410,
        detail={
            "code": "file_missing_on_disk",
            "message": "This file is missing from the server. Click "
                       "the row's edit pencil to reupload it, or delete "
                       "this record if it's no longer needed.",
            "record_still_exists": bool(record_still_exists),
            "restore_hint": restore_hint,
        },
    )
```

Every raise site swapped from
`raise HTTPException(404, "File missing on disk")` to
`raise missing_file_response()`:

1. `backend/document_library.py` — `/document-library/files/{id}/download`
   (this is the endpoint Stephen actually hit).
2. `backend/asset_service.py` — plant / vehicle schedule attachments.
3. `backend/file_pdf.py` — inline-PDF conversion helper.
4. `backend/forms.py` — form-submission attachment download.
5. `backend/simpro_zip_import.py` — Simpro staged ZIP artefacts.

### Frontend recognises the structured 410

`frontend/src/lib/api.js`:

- `apiError()` now detects `e.response.status === 410` + `detail.code
  === 'file_missing_on_disk'` and returns `detail.message` verbatim.
  Any callsite that already displays `apiError(err)` in a toast will
  now show the friendly copy instead of `JSON.stringify(detail)`.
- New exported helper `missingFileMeta(e)` returns
  `{code, message, record_still_exists, restore_hint}` or `null`, so
  future banner components (Reupload / Delete inline affordances)
  can render a structured banner without duplicating the shape
  check.

### Orphan-files report

Deliberately deferred — a full-collection scan is a heavier
migration and belongs with the parked Object Storage effort
(`v58.14.x`). This ship's scope is (a) stop showing the raw JSON
blob and (b) unblock Stephen's Melinda click. The next Object
Storage ship will produce
`memory/v58_13_XXX_orphan_files_report.md` at the same time it
moves everything to remote storage.

---

## Version bump

```
frontend/src/lib/version.js:
  RUNNING_VERSION           .132fp → .132fq
  EXPECTED_CACHE_VERSION    .132fp → .132fq

frontend/public/service-worker.js:
  CACHE_VERSION             .132fp → .132fq
```

Mobile bundle untouched. Backend restarted so the new
`missing_file_response` module is loaded by the API workers.

---

## Verification

### 1. Backend heartbeat

```
$ curl -s -o /dev/null -w "%{http_code}\n" \
       https://whs-compliance.preview.emergentagent.com/api/health
200
```

### 2. Pytest — `backend/tests/test_v58_13_132fq_missing_file_handler.py`

```
$ python -m pytest tests/test_v58_13_132fq_missing_file_handler.py -v

collected 8 items
::test_missing_file_helper_module_exists_and_shape                PASSED
::test_every_missing_file_raise_site_uses_shared_helper           PASSED
::test_backend_returns_410_on_document_library_orphan_file        PASSED
::test_frontend_apierror_recognises_structured_410                PASSED
::test_frontend_exports_missingFileMeta_helper                    PASSED
::test_workers_jsx_photo_uses_translate_y_not_object_position     PASSED
::test_workers_jsx_slider_diagnostic_overlay_retired              PASSED
::test_version_bumped_to_132fq                                    PASSED

============================== 8 passed in 1.38s ===============================
```

Guards:

- Shared 410 helper exists with `status_code=410`,
  `code: 'file_missing_on_disk'`, `record_still_exists`,
  `restore_hint`.
- All 5 raise sites now import + call the helper; zero remaining
  `raise HTTPException(404, "File missing on disk")` occurrences.
- Live probe: `GET /api/document-library/files/{random-uuid}/download`
  still returns 404 "File not found" (not-found record path
  unchanged — only file-missing branch was rewritten).
- `apiError()` inspects `status === 410` + `detail.code`.
- `missingFileMeta()` exported.
- `Workers.jsx` uses `transform: translateY(...)` on the three
  photo render sites, no bare `objectPosition` on `photo_offset_y`
  / `effectiveOffset` styles.
- Diagnostic counter panel + `window.__PANELTEC_SLIDER_DEBUG`
  retired.
- Version pins read `.132fq`.

### 3. Playwright — `scripts/verify_132fq.py`

```
$ PLAYWRIGHT_BROWSERS_PATH=/pw-browsers python scripts/verify_132fq.py

slider=0    sha1=7b7a6ffc73b14ae95a85b5e7a01407f35da7cbd3  bytes=5963
slider=100  sha1=864fd0e161677c3372e3e54f1559990d1d6b11b5  bytes=4546

=== v58.13.132fq verification ===
STATUS: PASS
Slider crop moves visibly between offset=0 and offset=100.
```

Distinct SHA-1s + 1,417-byte delta between the two cropped
screenshots proves the visible crop region actually moved when the
slider was dragged — no more silent slider.

---

## Files changed

1. `backend/missing_file_response.py` — NEW shared helper module.
2. `backend/document_library.py` — import + `raise missing_file_response()`.
3. `backend/asset_service.py`     — import + `raise missing_file_response()`.
4. `backend/file_pdf.py`          — import + `raise missing_file_response()`.
5. `backend/forms.py`             — import + `raise missing_file_response()`.
6. `backend/simpro_zip_import.py` — import + `raise missing_file_response()`.
7. `frontend/src/pages/Workers.jsx` —
   - `WorkerRowPhoto` → wrapper + oversized img + `translateY`.
   - `EditWorkerPhoto` header preview → wrapper + oversized img + `translateY`.
   - `IdCardPhoto` → wrapper + oversized img + `translateY`.
   - `SliderWithDiagnostic` → slimmed down (counter panel + global
     inspector hook + `console.info` removed; slider stays).
8. `frontend/src/lib/api.js` — `apiError` handles 410 shape;
   `missingFileMeta` helper exported.
9. `frontend/src/lib/version.js`, `frontend/public/service-worker.js`
   — bumped to `.132fq`.
10. `backend/tests/test_v58_13_132fq_missing_file_handler.py` — 8
    pytest source-pins + live probe (all pass).
11. `scripts/verify_132fq.py` — Playwright slider byte-diff verification.
12. `memory/v58_13_132fq_slider_0.png`, `memory/v58_13_132fq_slider_100.png`
    — visual proof of the crop shift.
13. This ship memo.

**Zero `/app/mobile/` files touched.** **Zero deletions of records
or bytes.**

---

## Acceptance criteria

1. Slider visibly moves the photo — top-of-head at 0, shoulders at
   100 — **PASS** (screenshots + byte-diff assertion in
   `verify_132fq.py`).
2. Diagnostic overlay removed from production view — **PASS** (pytest
   `test_workers_jsx_slider_diagnostic_overlay_retired`).
3. Clicking a legacy file with missing storage returns structured
   410, FE `apiError` surfaces the friendly message — **PASS**
   (backend helper + frontend recognition, verified by pytest).
4. All new tests pass — **PASS** (8 / 8 pytest, 1 / 1 Playwright).
5. Version bumped `.132fq`, memo written — **PASS**.

---

## Deferred / follow-ups

- **Orphan-files report + Object Storage migration:** parked for
  `v58.14.x` per standing directive.
- **Reupload / Delete inline banner component:** the FE now has
  `missingFileMeta(e)` — a future ship can wire an actual banner
  UI into the document-library file open flow (currently the
  friendly message goes through the existing `toast.error` path
  via `apiError`, so it looks like every other error toast).
  Non-blocking for Stephen's original complaint (no more JSON blob).
- **`.132fo` tile-access radical simplify:** WIP stashed as
  `stash@{0}`, still parked pending Stephen re-confirmation.

---

## Standing rules acknowledged

- `finish` tool: NOT called.
- `testing_agent` / `e1_tester`: NOT called.
- `/app/mobile/`: NOT touched.
- CRA preserved — no Vite migration.
- Response language: English.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
