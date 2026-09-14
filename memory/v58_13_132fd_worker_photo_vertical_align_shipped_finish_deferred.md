# v58.13.132fd — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (Stephen's standing
directive).

**Scope in one line**: worker records now carry a
`photo_offset_y: int` (0..100) that shifts the photo up or down
within its crop frame. A range slider in the worker edit form
live-previews the change; the same offset applies to the workers
list row and the ID-card view drawer.

## The Melinda case

Melinda Linford's uploaded headshot has her face too high in the
crop — the current centre-crop chopped her forehead. There was no
way to nudge the frame short of re-uploading a re-cropped image.
This ship gives admins a one-slider control that shifts the CSS
`object-position` from top (0) → centre (50, default) → bottom
(100).

## Data model

- Field: `photo_offset_y: Optional[int]` on the worker document.
- Semantics: percentage from top for the CSS `object-position`
  Y-axis (`0` = pin photo top, `50` = centre-crop / current
  behaviour, `100` = pin photo bottom).
- Missing / null / non-int on read → coerced to `50` in
  `_serialise`. **No migration needed** — pre-`.132fd` rows
  behave exactly as before.
- Range: `0..100`. Values outside the range are **clamped** on
  save (spec says clamp, not 400) so admins dragging past the
  slider ends don't get rejected.

## Endpoints (unchanged surface, new field accepted)

- `PATCH /api/workers/{id}` — now accepts `photo_offset_y: int`
  in the body. Clamped to `[0, 100]` on the server. Non-integer
  → 422 (Pydantic).
- `GET /api/workers` / `GET /api/workers/{id}` — every response
  carries `photo_offset_y` (defaults to `50` when the stored value
  is missing / null / bogus).
- Same `_require_write` gate as every other worker edit — non-
  admin PATCH returns 403 (or 404 under contractor-rep scoping).

## Frontend

### Edit form thumbnail
`EditWorkerPhoto` now accepts controlled `photoOffsetY` +
`onChangeOffsetY` props. When rendered inside the worker edit
modal it exposes a slider block under the "Upload Photo" button:

- Label: **Vertical alignment**
- `<input type="range" min="0" max="100" step="1">` bound to the
  form's `f.photo_offset_y`.
- **Reset to centre** small link that snaps the slider to `50`
  (disabled when already `50`).
- End captions: **Higher** ← / → **Lower** (matches the spec's
  "left to raise / right to lower").
- Live preview: the 56×56 thumbnail applies
  `objectPosition: '50% Y%'` inline as the admin drags.
- **Only rendered when** `canEdit && hasPhoto && typeof
  onChangeOffsetY === 'function'` — so the same component
  bystanders (row list, ID card) don't sprout a slider when they
  render the photo without offset control.

### Renders in three places, offset applied to all
1. **Edit form thumbnail** (`EditWorkerPhoto`, 56×56, rounded-xl).
2. **Workers list row** (`WorkerRowPhoto`, 40×40, rounded-full)
   — offset picked up from `worker.photo_offset_y` on GET.
3. **ID card view** (`IdCardPhoto`, 128×128, rounded-lg) inside
   the worker view drawer / expand modal.

Tiny mini-avatars (< 32px), the top-bar user avatar, and any
avatars in tooltips are deliberately left un-adjusted — the
offset is imperceptible at those sizes and the CSS noise wasn't
worth it. PDF rendering + sign-on QR photo also deferred per the
spec — parked as a follow-up if the ergonomics prove worth it.

Save flow: the slider does **not** trigger its own PATCH. The
value ships as part of the existing worker-edit submit body
(spread from `f` in `submit`), so the admin's Save click covers
every change on the form as one round-trip.

## Files touched

| File | Change |
| --- | --- |
| `backend/workers.py` | `WorkerPatch` gains `photo_offset_y: Optional[int]`; `_serialise` coerces missing/null to 50 and clamps stored values to `[0,100]`; `update_worker` clamps incoming values on write. |
| `frontend/src/pages/Workers.jsx` | `EditWorkerPhoto` accepts `photoOffsetY` + `onChangeOffsetY`, live-previews via `object-position`, renders the slider + reset link. Parent modal passes controlled state via `f.photo_offset_y`. `WorkerRowPhoto` and `IdCardPhoto` also apply `object-position` from `worker.photo_offset_y`. |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fd`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fd`. |
| `backend/tests/test_v58_13_132fd_worker_photo_align.py` | New, 9 tests. |

## Pytest results

### `.132fd` new suite — **9 / 9 passing**
`backend/tests/test_v58_13_132fd_worker_photo_align.py`
- `test_patch_accepts_photo_offset_y` — round-trip PATCH → GET
  echoes `70`.
- `test_missing_photo_offset_y_defaults_to_fifty` — freshly
  seeded worker with no field returns `50` on GET.
- `test_clamp_above_range` — PATCH `150` → stored `100`.
- `test_clamp_below_range` — PATCH `-20` → stored `0`.
- `test_non_integer_photo_offset_y_rejected` — PATCH
  `{"photo_offset_y": "high"}` returns 422 (Pydantic).
- `test_non_admin_patch_forbidden` — ephemeral worker → 403
  (or 404 under contractor-rep scoping; both accepted).
- `test_frontend_slider_wired_in_edit_form` — source-pin:
  "Vertical alignment" label + testid + range input with
  `max="100"` + reset link + live `objectPosition` style + form
  state carries `photo_offset_y`.
- `test_frontend_slider_only_shows_when_photo_present_and_editable`
  — source-pin: guard expression matches the spec.
- `test_version_pinned_to_132fd_or_higher`.

### Combined `.132e* + .132f*` smoke — **312 passed, 88 skipped, 1 pre-existing failure**
`pytest -k "132e or 132f" --tb=line`
- Pre-existing failure: `test_v58_13_132ek_zebra_and_login_polish.py::test_incidents_opts_in_to_zebra`
  — same `\bzebra\b` word-boundary bug carried forward. Not
  touched by this ship.

## Version bumps
- `RUNNING_VERSION` **v58.13.132fc → v58.13.132fd** ✓
- `EXPECTED_CACHE_VERSION` **v58.13.132fc → v58.13.132fd** ✓
- Service Worker `CACHE_VERSION` **v58.13.132fc → v58.13.132fd** ✓
- Mobile bundle NOT bumped (web-only ship;
  `MOBILE_VERSION_SYNC_OPTIONAL=true --no-verify`).

## Acceptance criteria
1. Melinda's edit page shows a "Vertical alignment" slider under
   her photo with a "Reset to centre" link. ✓
2. Dragging the slider live-updates the thumbnail. ✓ (inline
   `objectPosition` style).
3. Clicking form Save persists `photo_offset_y` via the existing
   PATCH. ✓
4. Reload → slider position + thumbnail crop remembered. ✓
   (`GET` returns `photo_offset_y`).
5. Same worker in the list row + ID card renders with the same
   offset. ✓
6. Existing workers with no `photo_offset_y` render unchanged
   (centre). ✓
7. Non-admin PATCH → 403 / 404 (existence not leaked). ✓
   Admin PATCH → 200.
8. Out-of-range values clamped server-side. ✓
9. New `.132fd` pytests pass; combined smoke shows no new
   regressions. ✓
10. Version bumped in all 3 web files; commit succeeds. ✓
11. Ship memo written; reply-in-chat (no `finish`). ✓

## Design decisions

- **Percentage, not pixels.** The stored value is a percentage so
  it works across every render size (40×40 row, 56×56 edit, 128×128
  ID card) without recalculation. Pixel offsets would need to be
  scaled per render site.
- **Server clamps, not 400s.** Sliders can overshoot on some
  browsers (touch drag past the end); a 400 there is user-hostile.
- **Coercion on read, not migration.** Every serialise pass
  emits a valid integer — legacy rows behave exactly like fresh
  ones without needing a data backfill.
- **Slider only in the edit form.** Bystander render sites just
  READ the field. Otherwise the ID card popup would sprout a
  slider you can't save from.
- **Not sent as a separate endpoint.** Piggybacks on the
  existing worker PATCH so the admin's Save click still covers
  the full form. Adds one field, zero new endpoints, zero new
  round-trips.

## Deferred / follow-ups
- **PDF / sign-on QR photo rendering** — deliberately skipped
  this ship. The current PDF pipeline centre-crops and the
  ergonomics of applying the offset in a server-rendered PDF
  need a separate look. Parked.
- **Horizontal offset / zoom / drag-to-position** — Stephen
  explicitly ruled these out for this ship. If needed later,
  add `photo_offset_x` + `photo_zoom` following the same shape.
- **Pre-existing `.132ek` zebra source-pin failure** — standalone
  follow-up.

## Rules honoured this ship
- **NO** `finish`.
- **NO** `e1_tester`.
- **NO** edits under `/app/mobile/`.
- **NO** rewrite of `/app/frontend/` to Vite — CRA production shell
  preserved.
- Commit uses `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.
- English-only chat replies.
- Backend field added is coercion-idempotent — no migration
  needed.
