# v58.13.132ic — Worker profile enhancements batch + fixes · SHIPPED (finish deferred)

**Ship phase:** `.132ic`
**Scope:** P0 batch — Remove Clients dropdown from Worker profile · Photo tile upload RE-DO (preserve full pixels) · Licences panel feature-parity (drop-zone + Add + Delete) · New Inductions panel · SSRA Select Vehicle native `<select>` · Pre-Starts source filename affordance.

## What shipped

### 1. Remove Clients dropdown from Worker edit modal
- **`frontend/src/pages/Workers.jsx`** — Deleted the `<Section title="Clients">` block (populate-from-SimPRO chips + `ClientPicker` mount).
- `client_ids` still hydrated by Simpro sync and still shown on the Workers-list table row chip; only the profile-level picker was removed per Stephen's brief.
- `ClientPicker` component + `CLIENT_SOURCES` constant retained (dead code) for one release cycle to keep the state-hook order stable — follow-up ship can drop them.

### 2. Photo tile RE-DO — preserve original pixels
- **`backend/workers.py::_canonicalise_image`** — The old flow centre-cropped input to a square then downscaled to 512×512, so `photo_transform = {x, y, zoom}` could only pan inside a pre-cropped thumbnail. Now:
  - EXIF orientation applied (iPhone portrait shots no longer arrive sideways).
  - Alpha channels flattened onto white for JPEG output.
  - Saved as JPEG **q=95** — near-lossless, roughly 30% smaller than PNG.
  - **NO centre-crop. NO resize.** Original aspect + pixels intact.
  - Behavioural pytest: seed 2000×1500, round-trip through `_canonicalise_image`, assert output decodes back to 2000×1500 and meta reports `resized_to: None`.
- Downstream renders (row avatar, edit tile, ID card) already apply the `photo_transform` via CSS `translate()` + `scale()` against whatever the img element holds — those work correctly against the full photo without any FE change.

### 3. Licences panel — Certifications parity
- **`frontend/src/components/workers/LicencesPanel.jsx`**:
  - New drop-zone (`licence-dropzone`) + hidden file input (`licence-file-input`) — uploads via the shared `POST /workers/{id}/certifications/upload` with `category=license` form hint.
  - `+ Add licence (no file)` button (`licence-add-manual`) — creates a `worker_certifications` row with `category: 'license'` via the shared `POST /workers/{id}/certifications`.
  - Per-row **Delete** action (`licence-delete-{cert_id}`) — soft-delete via `DELETE /workers/certifications/{cert_id}` (30-day recoverable per the existing archive contract).
  - Edit + View + File download unchanged from `.132hx`.

### 4. New Inductions panel
- **`frontend/src/components/workers/InductionsPanel.jsx`** — Mirror of LicencesPanel:
  - Section chip toggle (`section-inductions` + persisted collapse state).
  - Same 7-column table (Name / Issuer / Issued / Expiry / Status / File / Actions).
  - Same drop-zone (`induction-dropzone`) + `+ Add induction` button (`induction-add-manual`) + per-row Delete (`induction-delete-{id}`).
  - Filters `worker_certifications` to rows with `category === 'site_induction'`; falls back to a name-substring heuristic (`/\b(induction|orient(ation)?|site[\s-]*safety[\s-]*brief)\b/i`) for legacy rows without a category.
  - Violet accent (`#5b21b6`) to distinguish from the blue Certifications / Licences tabs.
- Wired below `LicencesPanel` in `Workers.jsx` (both visible when `!isNew`).

### 5. Backend — `worker_certifications.py` category plumbing
- `CertIn` + `CertPatch` Pydantic models now carry `category: Optional[str]`.
- `create_cert` writes the category on the new doc — whitelisted to `site_induction / competency / license / general`; unknown values drop to `None` (backward compat).
- `upload_cert_file` accepts `category` as a `Form` field with the same whitelist. `Form` import added to the FastAPI import line.
- Non-breaking: existing callers that don't send `category` still work — the field is `None` by default and the FE tabs fall back to their name-heuristic filters.

### 6. SSRA vehicle_navixy → native `<select>`
- **`frontend/src/pages/Forms.jsx`**:
  - `templateName` prop plumbed from `FillOutModal` → `FieldRunner` → `VehicleNavixyField`.
  - `VehicleNavixyField` detects SSRA templates via `/ssra|site[\s_-]*specific[\s_-]*risk/i` on the template name.
  - When matched, the "From fleet" list renders as a native `<select data-testid="vehicle-select-{fid}">` populated from the same `/api/forms/fleet/vehicles` endpoint (local-fleet-fallback status preserved).
  - Same value shape on select: `{navixy_id, label, registration}`.
  - The "Other (manual entry)" mode toggle + search input + amber Navixy-disconnected banner all preserved — only the row-list is swapped for a `<select>`.
  - Non-SSRA templates unchanged.
- Live verified via Playwright: Construction & Excavation SSRA now renders `<select>` with 124 fleet options.

### 7. Pre-Starts source-filename affordance
- **`frontend/src/pages/PreStarts.jsx`** — When a record carries `imported_from_pdf`, the group card now shows a `Source: <filename>` line beneath the CaptureCard (testid `prestarts-original-doc-{id}`). Matches the Incidents `.132ia` + SSRA `.132hz` visual pattern.
- Text-only affordance (not clickable). Making it a clickable PDF preview requires storing the source PDF in GridFS at import time — **deferred as `.132id` scope**.

## Investigation results

- **ResizeObserver loop error** — Grepped 10 legitimate ResizeObserver call sites (`Workers.jsx:2396`, `GroupedTilesView.jsx:155`, `InductionsMatrix.jsx:724`, `PdfPreviewModal.jsx:485`, `MasterRisksTab.jsx:442`, `ListFormsTab.jsx:181`, `CompletedTrainingTab.jsx:97`, `ListRolesTab.jsx:134`, `CompaniesTab.jsx:70`, `IncidentRootCausesTab.jsx:147`). None have recursive-layout smell — every call site follows the same "measure body, sync width, cleanup on unmount" pattern with no re-observe. **No fix required in this ship.** Continuing to monitor; if the loop reappears, we'll wrap the callbacks in `requestAnimationFrame` batching.
- **View original document on Incidents** — Verified from `.132ia`: the affordance is a **text-only** `Source: <filename>` line at `Incidents.jsx:494` (testid `incidents-original-doc-{id}`). It is NOT clickable — matches the SSRA `.132hz` pattern. Making it clickable requires the same GridFS storage as item #8/#9 → deferred to `.132id`.
- **View original document on Pre-Starts** — Added in this ship as a text-only source-filename line (matches Incidents/SSRA). Clickable version deferred.
- **Photos not in imported incident PDFs** — Investigated: `backend/imports.py:302` deletes the temp file after parsing; the source PDF is NEVER stored in GridFS. Making it embed-able requires:
  1. New GridFS bucket `imported_source_pdfs` with the raw upload.
  2. `imports.py` stashes the PDF + writes `imported_pdf_gridfs_id` on the submission.
  3. New `preview_sources.py` adapter for `imported_pdf` source.
  4. AI PDF re-embed path extracts photos from the source PDF via PyMuPDF and injects them as inline Image flowables.
  → **Deferred as a separate ship** (`.132id` — "imported PDF source storage + photo re-embed"). Not in `.132ic` scope.

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ic`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ic`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ic`

## Pytest coverage (12 checks)
- `test_workers_page_removes_clients_section_from_edit_modal` — Populate-from-SimPRO chips + ClientPicker mount gone; explanatory comment survives.
- `test_workers_page_wires_inductions_panel` — Import + mount + LicencesPanel co-existence.
- `test_inductions_panel_has_full_action_surface` — 7 testids + delete/edit prefixes + category persistence on upload+create.
- `test_licences_panel_gains_dropzone_add_and_delete` — 3 testids + delete prefix + category hint + soft-delete API call.
- `test_forms_page_threads_template_name_and_ssra_vehicle_select` — templateName plumbing + native `<select>` testids + SSRA regex.
- `test_prestarts_page_shows_imported_source_filename` — testid + `imported_from_pdf` binding + FileText icon import.
- `test_canonicalise_image_no_longer_crops_or_downscales` — Old crop + resize gone; new quality=95 marker present.
- `test_canonicalise_image_preserves_original_dimensions` — **Behavioural**: 2000×1500 in → 2000×1500 out, `meta.resized_to is None`.
- `test_cert_in_and_patch_accept_category` — Pydantic accepts optional category.
- `test_create_cert_persists_category_whitelist_only` — Whitelist + None fallback.
- `test_upload_cert_file_accepts_and_persists_category` — Form import + Form param + doc field.
- `test_version_pin_v132ic` — Three-string lockstep.

## Live verification
- SSRA (Construction & Excavation) → vehicle_navixy renders as `<select>` with 124 fleet options (screenshot `/tmp/ssra_select_132ic.png`).
- Worker profile changes verified via pytest source pins (workers page → Clients section removed; Inductions + Licences testids present + wired).

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish`.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk pre/post: /app 82% / /root 82%.

## Next action items
- **`.132id`** — Imported PDF source storage + photo re-embed:
  · GridFS stash source PDFs at import time.
  · `imported_pdf` preview source adapter.
  · Clickable "View original document" on Incidents / Pre-Starts / SSRA cards.
  · AI PDF regen path extracts photos from source PDF and re-embeds inline.
- **Mobile parity backlog** (queued for Expo specialist): worker/vehicle/job/site/customer picker parity; explicit "open on web" stub message; SSRA `<select>` mode; Inductions tab.
- Blocked items still awaiting user IDs: pre-starts empty view latent bug; SWMS Emergency Procedures leak.
