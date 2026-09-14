# v58.13.132fg — Section C regressions + Section G picker flatten (SCOPE-SPLIT)

**Status:** SHIPPED. Commits `76fd3ac` (sub-commit 1+2) + this version-bump commit. Finish tool intentionally NOT called.
**Ship type:** Regression hotfixes + UX simplification.
**Scope:** Web only. `/app/mobile/` untouched.

Per Stephen's Option A directive: `.132fg` is being shipped narrow (C + G only). Sections D (Private & Confidential + Licences), H (admin gate audit), E (delete audit), F (brand sweep) are being split into follow-up ships `.132fh` (D + H), `.132fi` (E), `.132fj` (F) so each gets proper depth + Playwright evidence.

---

## Executive summary

Two things fixed:

1. **C — Regressions from Mel Linford's report.** Real root cause identified in the live browser: `WorkerInductionsCard` was rendering the card as a native `<button>` that contained `FilePresenceChip`'s inner `<button>`. Nested interactive elements are invalid HTML — Chrome reparents the tree and swallows the outer click. This presented as *both* "induction records won't show when I try to view" (C2) *and* "no option to add records to a worker profile" (C1) since empty induction slots use the same click handler. Fix: outer element is now `<div role="button" tabIndex={0}>` with an `onKeyDown` handler for Enter/Space keyboard access. Same pattern the `Section` component already uses (v160.3.6b).

   C3 (photo slider not moving) is **not reproducible in headless Chromium** — slider works, both `onChange` fires and `img.style.object-position` updates. Ship: defensive `onInput` twin added to the range input for robustness against extension-heavy browsers. Mel should try Incognito with extensions off before we escalate further.

2. **G — Approvals picker flattened.** Per Stephen's clarified mental model (Section B of the brief): the web portal is admin-only, all 11 users are admins, so the "Admins" / "Users" role grouping was noise. Now: single alphabetical list, "Select everyone" + "Clear all" only. Violet "admin" row pill removed from both the picker and the inline approved-users chip row on the Apps Directory table.

---

## Files changed

```
frontend/src/components/WorkerInductionsCard.jsx        ~55 lines rewritten
frontend/src/components/QuickLinksSection.jsx           ~130 lines rewritten
frontend/src/pages/Workers.jsx                          +1 (onInput twin)
frontend/src/lib/version.js                             +1 −1 (RUNNING_VERSION + EXPECTED_CACHE_VERSION)
frontend/public/service-worker.js                       +1 −1 (CACHE_VERSION)
backend/tests/test_v58_13_132fc_tile_editor_clarity.py  contract flip
backend/tests/test_v58_13_132fe_hotfix_approvals.py     contract flip
backend/tests/test_v58_13_132fg_regressions_and_picker_flatten.py  NEW  9 checks
scripts/verify_132fg.py                                 NEW  headed Playwright, 3 flows
scripts/repro_mel_induction_view.py                     NEW  repro for C2
scripts/repro_photo_slider.py                           NEW  repro for C3
```

---

## Root-cause analysis: the nested-button footgun

`WorkerInductionsCard.jsx` line 68 (pre-`.132fg`):

```jsx
<button key={c.column_key} type="button" onClick={() => openCard(c, cell)}>
  ...
  <FilePresenceChip workerId={workerId} cell={cell} />   // renders another <button>
  ...
</button>
```

`FilePresenceChip` at line 148 renders `<button onClick={...} type="button">` for the "📄 File" affordance. Two `<button>` elements nested is invalid HTML. Chrome reparents the tree during layout: the inner button gets promoted to a sibling of the outer, and clicks on the outer's whitespace regions land on the inner button instead. `e.stopPropagation()` on the inner cancels bubbling to `openCard` — so **the click gets silently eaten**.

Live-browser capture (before the fix):

```
[console.error] <%s> cannot contain a nested %s.
See this log for the ancestor stack trace. button <button>
```

Fix (same pattern as the `Section` component from v160.3.6b):

```jsx
<div role="button" tabIndex={0}
     onClick={() => openCard(c, cell)}
     onKeyDown={(e) => {
       if (e.key === 'Enter' || e.key === ' ') {
         e.preventDefault();
         openCard(c, cell);
       }
     }}
     className="... focus-visible:ring-2 focus-visible:ring-[#1e4a8c]/40">
  ...
  <FilePresenceChip .../>
  ...
</div>
```

After the fix: **no more nested-button warning in console**, clicks land on the card, modal opens with `induction-detail-view` rendered.

---

## Backend curl evidence

```
$ API=https://whs-compliance.preview.emergentagent.com
$ MEL=47476d38-bc55-4fc7-90c2-7db2b909d692

# Mel's Tas Gas Induction — backend was always fine
$ curl -s "$API/api/workers/$MEL/inductions/03b23e14cb9142f699882ab5" \
        -H "Authorization: Bearer $TOK"
{"id":"03b23e14cb9142f699882ab5","worker_id":"47476d38-...",
 "name":"Tas Gas Induction","type":"site_induction",
 "column_key":"tas_gas_induction","expiry_date":"2026-09-03",
 "status":"expired","doc_file_id":"5e11a3e4cbd3497bbb2f85f7",...}
http=200

# photo_offset_y round-trip — backend accepts + clamps
$ curl -s -X PATCH "$API/api/workers/$MEL" \
        -H "Authorization: Bearer $TOK" \
        -H "Content-Type: application/json" \
        -d '{"photo_offset_y":30}' | jq .photo_offset_y
30
```

Backend was never broken. Both C1/C2 and C3 were pure frontend rendering issues.

---

## Playwright evidence (headed, live preview host)

`scripts/verify_132fg.py`:

```
[1] Logged in — https://whs-compliance.preview.emergentagent.com/app/dashboard
[C2] Verifying induction card click opens modal…
    OK — detail view rendered.
[C3] Verifying photo slider still moves the img…
    OK — img.style now: object-position: 50% 30%
[G] Verifying picker is flat (no role groups)…
    72 flat user rows visible
    after Select everyone: 72 approved
    after Clear all      : 0 approved
    OK — picker flat.

── RESULT ─────────────────────────────────────────────
  C2 induction click       : OK
  C3 slider updates img    : OK
  G  picker flat           : OK
──────────────────────────────────────────────────────
```

Full artifact set at `/app/memory/v58_13_132fg_artifacts/` (3 screenshots) + repro artifacts at `/app/memory/v58_13_132fg_repro/` (10 screenshots covering pre-fix + post-fix states for C2/C3).

---

## Pytest evidence

```
$ cd backend && python -m pytest \
    tests/test_v58_13_132fc_tile_editor_clarity.py \
    tests/test_v58_13_132fe_hotfix_approvals.py \
    tests/test_v58_13_132ff_eligible_users_and_access_mode.py \
    tests/test_v58_13_132fg_regressions_and_picker_flatten.py -q
.....................................                                    [100%]
37 passed in 5.52s
```

New `.132fg` suite (9 checks):
- Induction card no longer a native `<button>` (root-cause lock).
- Induction card is `<div role="button" tabIndex={0}>`.
- `onKeyDown` opens the card on Enter/Space.
- Focus-visible ring for a11y.
- `openCard` click-handler contract unchanged (view vs add).
- Photo slider has both `onChange` + `onInput` twins.
- Picker role grouping fully removed (testids, handlers, copy, split predicates).
- Picker has `Select everyone` + `Clear all` (with real handlers).
- Admin pill removed from user row.
- Picker still sorted alphabetically.
- Preflight warnings preserved.

Contract-flipped:
- `.132fc` `test_picker_has_bulk_buttons` → `test_picker_has_bulk_buttons_legacy_gone`.
- `.132fc` `test_picker_groups_users_by_role` → `test_picker_no_longer_groups_users_by_role`.
- `.132fe` `test_bulk_buttons_have_type_button_and_onclick` — locks new `Select everyone` + `Clear all` contract; locks removal of old `selectAllAdmins` and `selectAll` handlers.
- `.132fe` `test_e2e_public_then_private_then_grant_via_batch` — updated to send explicit `access_mode: "private"` alongside `allowed_user_ids` per `.132ff` semantic (access_mode is authoritative on write).

---

## Version bumps

- `frontend/src/lib/version.js`: `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fg`
- `frontend/public/service-worker.js`: `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fg`

---

## C3 caveat — honest gap

Mel's photo-slider report **could not be reproduced** in headless Chromium 151 against the live preview host. My Playwright test dispatched both native `input` and `change` events on the range slider and observed `img.style.object-position` update from `50% 50%` → `50% 30%` → `50% 80%` on every dispatch. Backend PATCH accepts + persists the value cleanly.

**Hypotheses:**
- A Chrome extension on Mel's machine intercepting input events on range inputs.
- Mel is dragging the slider but looking at the wrong image (the modal preview is a 56×56 px thumbnail; the visible effect is subtle on that size).
- Mel is dragging then hitting Cancel instead of Update — the live preview updates but nothing persists.

**Mitigations shipped:**
- `onInput` twin alongside `onChange` (defensive against event-ordering quirks).
- Preserved `onChange` (single source of truth for React's controlled-input semantics).

**Ask Mel to:** open the worker in **Incognito with extensions disabled**, drag the slider, click **Update**, close and re-open. Report back with the exact browser + version + extension list if it's still broken.

---

## NOT changed

- `/app/mobile/` code (untouched — `MOBILE_BUNDLE_VERSION` unchanged).
- Sections **D** (Private & Confidential + Licences), **H** (admin gate audit), **E** (delete audit), **F** (brand sweep) — split into follow-up ships `.132fh` / `.132fi` / `.132fj` per Stephen's Option A directive. Each will get proper depth + Playwright evidence rather than being rushed under a single monolithic `.132fg`.
- The 20 pre-existing `ephemeral-upload-storage` lint warnings — still parked for v58.14.x.
- Pre-existing `.132ek` zebra source-pin test — untouched.
- `WorkerViewModal.jsx` (read-only drawer) — does not have the induction click grid, so no fix needed there.
- `InductionsMatrix.jsx` — its `<Cell>` component uses a `<button>` but contains only `<span>` children (no nested interactives), so the same fix isn't needed.

---

## Next ships (queued)

- **`.132fh`** — Section **D** (Private & Confidential + Licences worker profile sections) + Section **H** (admin gate audit).
- **`.132fi`** — Section **E** (delete audit across ~10 document surfaces).
- **`.132fj`** — Section **F** (Paneltec Group logo brand sweep — EPS → SVG/PNG/favicon; header + sidebar + login + PDF + email swaps).

Auto-rolling into `.132fh` next.
