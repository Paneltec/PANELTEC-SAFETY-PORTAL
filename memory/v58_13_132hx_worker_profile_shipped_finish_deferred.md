# v58.13.132hx — Worker profile grouped tweaks · SHIPPED (finish deferred)

**Ship phase:** `.132hx`
**Scope:** P1 grouped tweaks to the Worker profile edit modal + Workers list filter.
**Testing:** Pytest (`backend/tests/test_v58_13_132hx_worker_profile.py`) — 9/9 green. Live Playwright smoke via `screenshot_tool` — all acceptance criteria verified on preview.

## What shipped

### 1. Photo tile — retire sliders, add wheel-zoom + drag
- `SliderWithDiagnostic` component definition + render call **REMOVED**.
- `EditWorkerPhoto` now supports:
  - Mouse wheel over the preview → zoom (step 0.1, clamp `[0.5, 3.0]`).
  - Pointer drag on the preview → shift `x` / `y` in pixels.
  - Double-click → reset to `{x: 0, y: 0, zoom: 1}`.
- Persists a new field `workers.photo_transform = {x, y, zoom}` (bounded server-side: `x/y ∈ [-500, 500]`, `zoom ∈ [0.5, 3.0]`).
- Backward-compat: `getPhotoTransform(w)` folds legacy `photo_offset_y` + `photo_scale` into the new shape when the field is missing so pre-.132hx records render correctly at every site (list row, edit preview, ID card).
- Preview tile enlarged 56 → 96px for better drag ergonomics; ID card grid still renders at 128px with the same relative offset.

### 2. Emergency Contact — split into 3 fields
- New field `emergency_contact_relationship` on `WorkerIn` + `WorkerPatch` (`max_length=60`).
- Edit modal Personal section now shows `Name / Relationship / Phone` in a 2-col grid.
- Backfill posture (per Stephen's approved default): existing single-string values stay in `name`; `relationship` + `phone` default to empty. No regex parsing.

### 3. Inductions fast-select — removed
- `<Section title="Inductions">` block deleted from the edit modal.
- `WorkerInductionsCard` import + `inductionsBadges` constant removed from `Workers.jsx`.
- The Inductions Matrix tab on the Workers list remains the canonical entry point; the Certifications panel already surfaces induction counts as pills.

### 4. Licences panel — matches Certifications tab layout
- `LicencesPanel.jsx` rewritten to mirror `CertificationsPanel`:
  - Column headers: `Name · Issuer · Issued · Expiry · Status · File · Actions`
  - Header summary pills styled with the same `SummaryPill` treatment.
  - Row layout mirrors the Certifications table (same file button style, edit affordance).
- Retains the licence-family filter (`LICENCE_SLUGS`) — this is still a read-only filtered view over `worker_certifications`.

### 5. Workers list — Paneltec / Viatec / External chip filter
- New `[data-testid="workers-role-filter"]` chip row above the list.
- 4 chips: `All (default) · Paneltec · Viatec · External`.
- Mapping mirrors backend `bucket_target_role`:
  - `simpro_company_id="2"` → Paneltec chip
  - `simpro_company_id="3"` → Viatec chip
  - else (manual / other) → External chip
- Admins hidden from the 3 bucketed chips (only surface under `All`) — driven by the linked user's role via the existing `userByEmail` map.

## Backend contract (`backend/workers.py`)
- `_serialise` — coerces `photo_transform` default from legacy fields; clamps `x/y ∈ [-500, 500]`, `zoom ∈ [0.5, 3.0]`.
- `PATCH /api/workers/{id}` — accepts `photo_transform` + `emergency_contact_relationship`; clamp posture matches `photo_offset_y` (never 400 on out-of-range, silently coerce).

## Version pin
- `RUNNING_VERSION`  → `paneltec-v160.3.9.58.13.132hx`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132hx`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132hx`
- MOBILE_BUNDLE_VERSION unchanged (no mobile edits).

## Pytest coverage (`tests/test_v58_13_132hx_worker_profile.py`)
- `test_worker_patch_has_relationship_and_transform_fields` — model field + serialise + clamp source-pin.
- `test_worker_in_accepts_relationship` — `WorkerIn` also carries the field.
- `test_worker_patch_roundtrip_relationship_and_transform` — behavioural: PATCH sets values, out-of-range values clamp (zoom=25→3.0, x=9999→500.0, y=-9999→-500.0).
- `test_workers_jsx_has_wheel_zoom_and_drag` — `function SliderWithDiagnostic` gone, `onWheel` + `onPointerDown` + `getPhotoTransform` in place.
- `test_workers_jsx_emergency_contact_split_and_relationship` — testid `worker-emergency-contact-relationship` present.
- `test_workers_jsx_removed_inductions_fast_select` — no `import WorkerInductionsCard`, no `<Section title="Inductions">`, no `section-inductions` testid.
- `test_workers_jsx_has_role_chip_filter` — chip container + 4 chip buttons + `workerBucket` helper.
- `test_licences_panel_matches_certifications_layout` — Issuer + File column headers, LICENCE_SLUGS retained.
- `test_version_pin_v132hx` — three-string lockstep.

## Superseded prior contracts
- `test_v58_13_132hp_worker_profile.py::test_photo_zoom_slider_rendered` → renamed to `test_photo_tile_wheel_zoom_supersedes_slider_v58_13_132hx` and flipped to lock the NEW contract.
- `test_v58_13_132hp_worker_profile.py::test_version_bumped_to_132hp` → renamed to `test_version_bumped_to_132hp_or_later` with a forward-safe pin.

## Live verification (Playwright / screenshot_tool)
- Workers list chip filter renders with 4 chips.
- Edit modal opens with new photo tile (`worker-edit-photo-block` present, both legacy sliders gone).
- Personal section shows Name / Relationship / Phone fields.
- Inductions Section is gone from the modal.
- Licences panel table has Issuer + File columns.
- Version pill at bottom-left shows `v160.3.9.58.13.132hx`.

## Not in this ship
- Simpro sync of `emergency_contact_relationship` — Simpro does not expose this field.
- Migration script backfill: intentional. Legacy single-line emergency contact strings remain in `emergency_contact_name`; the admin edits per record.

## Disk hygiene
- Pre-ship cleanup: `/app/frontend/node_modules/.cache` + all `__pycache__` folders deleted before writing (91% → 91% steady during ship).
- Post-ship cleanup will also delete `/app/frontend/build` if the pre-commit hook created one.

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish` invocations.
- No `/app/mobile/` edits.

## Next action items
- Ship `.132hy` — Import Legacy PDF matcher for incident reports (P1).
- Ship `.132hz` — New SSRA section under Capture (P1).
- Ship `.132ia` — Incidents module overhaul + Hazard Reports merge (P0).
