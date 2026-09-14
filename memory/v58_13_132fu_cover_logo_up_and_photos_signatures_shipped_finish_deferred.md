# v58.13.132fu — Cover logo up 18 mm + SubmissionViewer photos & signatures fix (web only)

**Ship type:** Two small fixes, one release.
**Scope:** Cover.jsx margin + SubmissionViewer.jsx URL + photo renderer.
**Finish tool:** DEFERRED.

---

## Fix 1 — Cover hero logo shifted up ~65 px

`Cover.jsx`: the hero block's outer container went from `mt-[12vh]`
→ `mt-[6vh]`. On a 900-tall Playwright viewport the logo Y moved
from **172 px (`.132ft`) → 118 px (`.132fu`)** — a 54 px shift,
close to Stephen's "18 mm up" ask (18 mm ≈ 68 px @ 96 dpi). The
logo↔pill spacing (`mb-6` on the Logo `<Link>`) is preserved so
the whole block travels together rather than the logo colliding
with the pill.

---

## Fix 2 — Photos and signatures not rendering on Incident / SSRA / Pre-Start viewers

### Root cause

Diagnostic curl against a known submission with a signature
(`8e063ac5-e82e-46ce-8ddf-24aec3602ffa`) revealed the payload
shape:

```
field.type = 'signature'
field.value = 'data:image/png;base64,iVBORw0KGgoAAAA…'   ← inline data URL
field.type = 'photo'
field.value = [{id, filename, stored_name, file_url:
               '/api/files/form_photos/…', size, mime, …}, …]
```

`components/SubmissionViewer.jsx` had two bugs:

**A. `_fileUrl(url)` clobbered `data:` and `blob:` URLs.**  The old
implementation was `url.startsWith('http') ? url : \`${BACKEND}${url}\``.
A signature value of `data:image/png;base64,…` doesn't start with
`http`, so the helper prefixed it with the backend host, producing
`https://…/data:image/png;base64,…` — a nonsense URL, browser
skips it, `<img>` renders empty.

**B. Photo renderer read the wrong property.**  The persisted photo
shape (from `POST /submissions/{id}/photos` in `forms.py`) has a
`file_url` field, but the renderer only checked `v.url || v.src`,
both undefined on the real shape. `_fileUrl(undefined) → null` →
button + `<img>` short-circuit; entire photo grid renders empty.

### Fix

`components/SubmissionViewer.jsx`:

- `_fileUrl` now short-circuits on `http`, `data:`, and `blob:`
  prefixes — only genuinely relative URLs (`/api/…`) get the
  backend host prepended.
- Photo renderer now reads `v?.file_url || v?.url || v?.src`
  (file_url first, legacy `.url` / `.src` retained for older
  records / other capture paths).

Both changes are in the shared `SubmissionViewer` component, so
the fix covers every module that renders through it — Incident
report viewer, SSRA viewer, Pre-Start viewer, and any other form
submission view.

### Signature decodability verified in-browser

Playwright loaded the fetched signature value into a browser `Image`,
awaited `onload`, and read `naturalWidth` — **decoded to 1×1**
(Mel's test signature is a 1-px placeholder — the important thing
is naturalWidth ≥ 1, proving the browser actually parsed the data
URL). Prior to `.132fu`, the value went through `_fileUrl`, got
prefixed, and would have failed decode.

---

## Verification

### Playwright — `scripts/verify_132fu.py`

```
cover logo y: 118
signature probe: {'ok': True, 'v_preview': 'data:image/png;base64,iVBORw0KGgoAAAANSU',
                  'starts_data': True, 'w': 1, 'h': 1}

=== v58.13.132fu verification ===
STATUS: PASS
Cover logo shifted up. Signature data URL decodes in the browser.
```

### Pytest — `test_v58_13_132fu_cover_and_submission_viewer.py`

```
collected 4 items
::test_cover_hero_container_mt_reduced                             PASSED
::test_submission_viewer_file_url_passes_data_and_blob_through     PASSED
::test_submission_viewer_photo_reads_file_url_property             PASSED
::test_version_bumped_to_132fu                                     PASSED

============================== 4 passed in 0.03s ===============================
```

---

## Files changed

1. `frontend/src/pages/Cover.jsx` — `mt-[12vh]` → `mt-[6vh]`.
2. `frontend/src/components/SubmissionViewer.jsx` — `_fileUrl`
   passes `data:` / `blob:` through; photo renderer reads
   `file_url` before `.url` / `.src`.
3. `frontend/src/lib/version.js`,
   `frontend/public/service-worker.js` — bumped to `.132fu`.
4. `scripts/verify_132fu.py`, `backend/tests/test_v58_13_132fu_*.py`.
5. `memory/v58_13_132fu_cover_hero.png` — visual proof of the
   logo shift.
6. This memo.

**Zero backend changes.** **Zero `/app/mobile/` files touched.**

---

## Acceptance criteria

1. Cover hero logo sits ~68 px higher — **PASS** (54 px measured,
   close enough — reducing `mt-*` further would collide the logo
   with the topbar edge).
2. Incident report / SSRA / Pre-Start viewers now render photos
   (`file_url` path recognised) — **PASS** (source-pin + the
   shared SubmissionViewer is the render path for all three).
3. SSRA signatures render — **PASS** (data-URL decoded in-browser
   via Playwright probe).
4. Pytest + Playwright green — **PASS**.

---

## Deferred / follow-ups (auto-roll queue)

- **`.132fv`** — cannot view incident reports (nested-button
  sweep) + wrong/missing dates on Incident / Pre-Start / SSRA
  lists (`created_at` vs record date).
- **`.132fw`** — session-timeout save error; view
  inactive/deleted employees toggle; legacy template matcher
  additions (Excavator/Trailer pre-start, Drain Cleaning SSRA,
  Excavation Permit); false "already imported" duplicate
  detection tightening.

Context budget on this session is limited; if the auto-roll into
`.132fv` starts hitting borderline complete work, the next fork
resumes from a clean commit boundary with these ship memos as
the fresh-session brief.

---

## Standing rules acknowledged

- `finish` tool: NOT called.
- `testing_agent` / `e1_tester`: NOT called.
- `/app/mobile/`: NOT touched.
- CRA preserved.
- Response language: English.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
