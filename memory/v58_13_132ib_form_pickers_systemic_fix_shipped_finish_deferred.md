# v58.13.132ib — Form pickers systemic fix · SHIPPED (finish deferred)

**Ship phase:** `.132ib`
**Scope:** P0 systemic — WorkerPicker on WEB now honors `config.inline_company_toggle` (Paneltec Civil / Viatec chip filter) and `config.multi: true` (array-value chip cluster; fixes real data loss on 7 templates that need multi-attendee capture). Plus a Playwright regression harness that iterates every form template and asserts every picker's toggle→row→chip cycle.
**Testing:** Pytest (`backend/tests/test_v58_13_132ib_worker_picker_config.py`) — 7/7 green. Live Playwright verification via `screenshot_tool` — screenshots confirm company chips render + filter (All=65, Paneltec=38, Viatec=27), multi chip cluster (3-picked, idempotent re-click, X-remove works). Regression harness ships as `scripts/verify_pickers_132ib.py` — invoked manually (not in CI yet).

## Investigation summary
- **Reported bugs NOT reproducible on web** — CVT Daily Pre-Start worker + vehicle pickers both selectable on the current bundle (verified live before this ship). Backend endpoints all healthy: `/workers` 65, `/customers` 200, `/sites` 16, `/jobs` 189, `/fleet/vehicles` 124 (`local_fleet_fallback`).
- Most-likely explanation for user's symptom: stale service-worker cache OR user was on mobile (mobile fill flow stubs every picker as "fill on web app" — /app/mobile/app/forms/[id]/index.tsx:606).
- **However** the audit surfaced 2 real systemic gaps + 1 mobile parity gap (below).

## What shipped

### 1. Backend — `backend/forms_pickers.py::workers()`

New optional `company_id: str | None` query param on `GET /api/forms/pickers/workers`.
- Filters Mongo query by `simpro_company_id` (Simpro's own numeric id, matching `template.config.company_options[*].simpro_id`).
- No behaviour change for pre-.132ib callers (param defaults to `None`).
- Response now surfaces `simpro_company_id` + `company_name` per row so any future FE badging can drop straight in.
- Verified live: 65 total → 38 for Paneltec (`company_id=2`) → 27 for Viatec (`company_id=3`).

### 2. Frontend — `PickerFields.jsx`

**Refactor of shared `PickerInput`** — added three extension points that any picker can bolt onto:
- `topSlot` — arbitrary React node rendered inside the dropdown, above the search input.
- `hideSelectedChip: boolean` — skips the built-in single-value chip render (so a parent can render its own chip cluster instead).
- `onPickOverride: (item) => void` — parent-controlled row-click handler; when supplied, PickerInput does NOT `setOpen(false)` (keeps dropdown open for chained multi-picks).
- `forceOpen: boolean` — reserved for a future auto-open UX (unused today; keeps the seam future-proof).

**WorkerPicker rewritten to honour two config keys** the web renderer had ignored since v160.1.6:
- `config.inline_company_toggle: true` + `config.company_options: [{label, simpro_id}]`:
  - Renders a chip row above the search input: `All` · `Paneltec Civil` · `Viatec`.
  - Selecting a chip sets local `companyFilter` state, which flows into `fetchParams={company_id}` → the endpoint returns only that company's workers.
  - Testids: `worker-picker-{fid}-company-toggle`, `-company-all`, `-company-{simpro_id}`.
- `config.multi: true`:
  - Value shape becomes `Array<worker>` (was single worker object).
  - Row click **appends** rather than replaces. Idempotent — clicking an already-selected row is a no-op.
  - Chip cluster rendered above the picker toggle: each chip has role-color emerald + per-worker `×` remove.
  - Rows show `· SELECTED` marker for already-picked workers.
  - Testids: `worker-picker-{fid}-multi`, `-multi-chips`, `-multi-chip-{worker_id}`, `-multi-remove-{worker_id}`.

### 3. Frontend — `isAnswerValid.js`

Widened the `worker_picker` branch: when `field.config.multi` is truthy, the validator accepts `Array<worker>` with `length > 0` and a first entry that has an `id`. Preserves single-select validation for the remaining 62/69 fields.

### 4. `scripts/verify_pickers_132ib.py` — regression harness

Playwright script that:
1. Logs in as the admin.
2. Fetches all form templates via `/api/forms/templates?limit=200`.
3. For every template with any picker field, opens the FillOutModal.
4. For every picker in the template:
   - **worker_picker** → toggle opens dropdown, search input present. If `inline_company_toggle`, asserts every configured company chip is rendered. If rows load, click first row → assert chip (single) or `-multi-chips` entry (multi).
   - **vehicle_navixy** → asserts fleet options OR manual toggle rendered. Clicks first `vehicle-opt-*` → asserts `vehicle-clear-{fid}` chip appears.
   - **job_picker / site_picker / customer_picker** → toggle click → search input mounts.
5. Prints a per-template pass/fail line, exits 0 on all-green.

Runs with:
```bash
python scripts/verify_pickers_132ib.py
```

Exit code 0 = every picker across every template interactive. Non-zero = one or more broken pickers listed by template + field id. Ready to wire into CI once we have a Playwright container in the pipeline.

## Deliberately UNCHANGED (deferred / blocked)

### Mobile fill flow (`/app/mobile/app/forms/[id]/index.tsx`)

**Not touched — /app/mobile/ edit ban still in force.** Current line 606 stubs every picker field with the grey "`<type>` field (fill on web app)" message. If the user is testing on mobile PWA / Expo, that's exactly what "not selectable" looks like.

**Queued for the Expo specialist** with this shopping list:
1. `worker_picker` — port the web WorkerPicker's `inline_company_toggle` + `multi` behaviour to the RN component.
2. `vehicle_navixy` — port the web VehicleNavixyField (with local-fleet-fallback support shipped in `.132hw`).
3. `job_picker` / `site_picker` / `customer_picker` — port via a shared RN `PickerInput` mirror.
4. Update the stub message to explicitly say **"Please open this form on the web app at whs-compliance.paneltec.com.au"** instead of the current generic "fill on web app" so a user knows exactly where to go.

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ib`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ib`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ib`
- `MOBILE_BUNDLE_VERSION` unchanged.

## Pytest coverage (7 checks)
- `test_worker_picker_reads_inline_company_toggle_config` — cfg keys read + company-toggle testids present.
- `test_worker_picker_handles_multi_config` — array-value contract, chip cluster testids, idempotent add.
- `test_picker_input_has_multi_support_hooks` — `topSlot`, `hideSelectedChip`, `onPickOverride` seams shipped.
- `test_backend_workers_endpoint_accepts_company_id` — signature + Mongo filter + projection.
- `test_is_answer_valid_accepts_multi_worker_picker_array` — Py port + JS source-pin of the multi branch.
- `test_workers_endpoint_filters_by_company_id` — behavioural: seeds 5 workers across 2 orgs + 2 companies, hits the endpoint 3 ways (`no filter`, `company_id=2`, `company_id=3`), asserts the id sets.
- `test_version_pin_v132ib` — three-string lockstep.

## Live verification (Playwright screenshots at `/tmp/`)

**CVT Daily Pre-Start** (single-select worker_picker · `inline_company_toggle: true`):
- Company chips rendered: `All` · `Paneltec Civil` · `Viatec` above the search input.
- Row counts: All=65, Paneltec Civil=38, Viatec=27, back to All=65.
- Row click still creates single chip.

**Toolbox Talk** (multi-select worker_picker · `multi: true`):
- Three attendee chips rendered above the picker (Aaron Foster · Aaron Holmes · Adam Garcie).
- Rows show `· SELECTED` markers next to already-picked workers.
- Idempotent add: clicking Aaron Foster a second time does NOT add duplicate (chips stayed at 3).
- Remove `×` button on chip works: chips went 3 → 2.
- Company toggle also renders in multi mode.

## Cross-ship regression check
- 4-ship `.132ia` + `.132ia-b` + `.132ia-c` + `.132ib` pytest suite: **all green** (27 + 7 = 34/34).
- Backend healthy post-restart (verified via `/api/forms/pickers/*` curl round-trip).

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish` invocations.
- No `/app/mobile/` edits (mobile parity queued for Expo specialist).
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk pre-check: /app 91%, /root cleaned to 93%.

## Next action items
- **Queue for Expo specialist**: mobile picker parity (worker_picker with `inline_company_toggle` + `multi`, vehicle_navixy, job/site/customer picker) + explicit "open on web" stub message.
- **User instruction (send now)**: hard-refresh (Ctrl+Shift+R) OR DevTools → Application → Service Workers → Unregister → reload — to pick up `.132ib` bundle. If they're on mobile, that's the stub message; use web until Expo ships parity.
- **Wire `scripts/verify_pickers_132ib.py` into CI** once a Playwright container is in the pipeline.
- Latent bugs still BLOCKED on user input: `.132ic` (SWMS Emergency Procedures leak — needs doc ID), `.132id` (Pre-starts empty view — needs record ID).
