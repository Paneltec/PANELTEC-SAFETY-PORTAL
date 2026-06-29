# 2026-06-29 — Phase 3.16 Parts A+B + Phase 3.17 (Certifications row actions)

## Part A — `session_timeout.py` BSON-Date normalisation (FAIL-SAFE)
- New helper `_normalise_activity_ts(raw) -> Optional[datetime]` (tz-aware UTC).
  Accepts: ISO string (w/ or w/o `Z` / offset / tzinfo), `datetime` (naive → UTC,
  tz-aware → unchanged). Anything else / malformed → `None`.
- `touch_and_check_session()` now calls the helper. `None` returns make the
  caller delete the row and return `session_idle_timeout` — fail SAFE, not
  fail OPEN (which was the silent BSON-Date bug pre-Phase 3.16).
- Belt-and-suspenders pytest suite: `tests/test_session_timeout_normalisation.py`
  · 9 tests · ISO+offset, ISO+Z, naive ISO, tz-aware dt, naive dt, 2h-old dt,
  malformed strings, None, unknown types (int, dict, list) — all passing.
- **Curl receipt** (real BSON Date via Motor):
    - BEFORE tamper: GET /api/auth/me → HTTP 200
    - TAMPER: `last_activity_at` = `datetime.now(UTC) − 2h` (naive datetime,
      stored as BSON Date by Motor — `type: datetime`, no tzinfo)
    - AFTER tamper: GET /api/auth/me → HTTP 401 `{"detail":"session_idle_timeout"}`
    - Garbage-string tamper (`"not-a-date"`) → also 401 `session_idle_timeout`.

## Part B — Phase 3.16 deferred UI
- `components/settings/SessionTimeoutCard.jsx` (new, admin-gated, mounted in
  Settings → System under the Server Tools section). Surfaces:
    - Idle timeout dropdown (15m / 30m / 1h / 2h / 4h / 8h)
    - Absolute timeout dropdown (4h / 8h / 12h / 24h / 72h)
    - Warning modal toggle + lead-time dropdown (15s / 30s / 1m / 2m)
    - Remember-me toggle (controls `/login` "Keep me logged in" visibility)
    - Per-role overrides toggle + 6-row matrix (admin / manager / hseq_lead /
      auditor / supervisor / worker, each with idle-min + absolute-hr inputs)
    - "Save changes" (dirty-tracked, disabled when no diff)
    - Danger zone: "Force logout everyone" with inline confirm pattern →
      POSTs `/api/admin/settings/force-logout-all` then signs the admin out.
- `Login.jsx` — calls `GET /api/settings/login-options` on mount. When
  `remember_me_enabled=true`, renders the "Keep me logged in" checkbox under
  the password field. `lib/auth.js::login()` now accepts `{remember_me}` and
  forwards it in the POST payload.
- **AppShell.jsx scope fix**: previous agent had declared `warnInfo`
  state inside `TopBar` but referenced it from `AppShell`'s JSX → uncaught
  `ReferenceError: warnInfo is not defined` blocked every `/app/*` render.
  Moved the `useSessionTimeout` hook + state up into `AppShell`.

## Part C — Phase 3.17 Certifications row actions
- `pages/Certifications.jsx` action column adds three icon buttons before
  Send-reminder:
    - 👁 **View PDF** — opens existing `PdfPreviewModal` with the cert's
      `doc_file_id`. Disabled (greyed) when the cert has no uploaded file.
    - ✏️ **Edit** (admin / hseq_lead) — opens `CertEditModal` (new). Patches
      `name / issuer / issue_date / expiry_date` via
      `PATCH /api/workers/certifications/{id}`. Backend recomputes
      `doc_seed_folder` automatically when `name` changes.
    - 🗑 **Delete** (admin only) — opens `CertDeleteConfirm` (new). Posts
      `DELETE /api/workers/certifications/{id}`. Soft-deletes the cert and
      detaches the file if no other cert references it.
- **Curl receipts**:
    - admin PATCH → HTTP 200 (rename), restore PATCH → HTTP 200.
    - worker DELETE → HTTP 403 (auth gate intact).
- Both modals follow the rounded-2xl shell pattern of InductionCardModal,
  ESC closes, backdrop click closes when not busy, no `window.confirm()`.

## Cache version
- `service-worker.js` bumped to **paneltec-v83**.

## Pre-flight
- `python -m py_compile $(find /app/backend -maxdepth 2 -name "*.py")` ✓
- `yarn build` ✓ (warnings only, all pre-existing exhaustive-deps).
- `pytest tests/test_session_timeout_normalisation.py` → 9/9 passed.

## Screenshots (saved as receipts)
- `/tmp/login_remember_me.png` — checkbox rendered under password when admin enables remember-me.
- `/tmp/settings_session_timeout.png` — full Session Timeout card with role override matrix open.
- `/tmp/cert_row_actions.png` — Certifications page with all 4 row buttons per cert.
- `/tmp/cert_edit_modal.png` — Edit modal showing LISA TAFARI / Traffic Control / 2017-12-19.
- `/tmp/cert_delete_modal.png` — Delete confirmation copy nailing the soft-delete semantics.

## Next Action Items
- Phase 3.18 — Granular per-user permission overrides (P1).
- Phase 4.1 — SWMS Assignments admin page + version-chain commit (P2).

---


# 2026-02-19 — Phase 3.10: Universal PDF preview for Document Library files

## Backend (`file_pdf.py` + server.py wiring)
- `GET /api/files/{id}/pdf` and `/api/files/{id}/pdf.pdf` (ad-blocker-friendly alias).
- `?dl=1` switches Content-Disposition to attachment.
- Conversion pipelines:
  - `passthrough` (PDF) · `image` (JPG/PNG/WEBP) · `heic` (pillow-heif → JPG)
  - `text` (CSV/TXT/MD via reportlab monospace)
  - `docx_docx2pdf` → if <1 KB output, falls back to `docx_text_fallback` (python-docx → reportlab plain text — lossy but **never blank**)
  - Anything else → **415** `{"detail":"PDF preview not available for {mime}"}`
- Cache: `doc_files_pdf_cache` keyed by `(file_id, sha1, pipeline)`. Subsequent calls bypass conversion. Invalidates automatically when the original file changes (sha1 mismatch).
- `POST /api/files/pdf-bundle {file_ids:[...]}` (admin/manager/hseq_lead, max 25) → single concatenated PDF via PyPDF2 merger; reports skipped/unconvertible IDs.
- `POST /api/admin/install-libreoffice?include_ocr=true` (admin only) — dormant install hook for LibreOffice + Tesseract + Poppler. Streams the apt-get tail back. **Does NOT auto-trigger.**
- `GET /api/admin/system-tools` — `which`/version status for the three optional toolchains.

## Frontend (`SystemSettings.jsx` + `AppShell.jsx`)
- New **Settings → System** page (admin-only, nav-testid `nav-settings-system`).
- Three tool cards (`tool-libreoffice` / `tool-tesseract` / `tool-poppler`) show install status (checkmark + version when installed, greyed "Not installed" otherwise).
- "Install now" button + "Run health check" — clicking install POSTs `?include_ocr=true`, displays install log in a dark terminal block on completion.
- Friendly footer card explaining today's Phase A coverage (PDF/images/HEIC/text/DOCX-fallback) vs what installing unlocks (XLSX/PPTX/ODT + full-fidelity DOCX + OCR).
- Service worker bumped to **paneltec-v61**.

## Receipts
- **TXT** → 1799 b PDF · pipeline=`text` · cache HIT on 2nd call (95 ms vs 104 ms).
- **PDF** passthrough → 322 471 b · pipeline=`passthrough` · cache HIT (`%PDF` magic).
- **PNG** → 11 960 b PDF · pipeline=`image`.
- **DOCX** → 1924 b PDF · pipeline=`docx_text_fallback` (LibreOffice not installed; docx2pdf raised → text fallback rendered the headings + bullets + tables as flattened text). >1 KB guard satisfied.
- **ZIP-mime** → **415** `{"detail":"PDF preview not available for application/zip"}`.
- **/pdf.pdf** alias variant → 200 · same body.
- **?dl=1** → `Content-Disposition: attachment; filename="test.pdf"`.
- **Bundle** of 2 files → 323 398 b single concatenated PDF · `X-Bundle-Converted: 2`.
- **System tools status** → all three `installed: false` (expected for Phase A).
- **Worker → 403** on `POST /admin/install-libreoffice`.
- Cache collection: 4 rows after the test suite, one per pipeline used.

## Pre-flight
- `python -m py_compile` ✓ clean.
- `cd /app/frontend && yarn build` ✓ 19.0 s, no compile errors.
- `curl /api/health` 200; backend log clean apart from the expected "docx2pdf is not implemented for linux" notice when DOCX hits the fallback.
- `requirements.txt` updated with `pillow_heif==1.4.0`, `PyPDF2==3.0.1`, `docx2pdf==0.1.8`, `openpyxl==3.1.5`, `python-docx==1.2.0`.
- `CACHE_VERSION = 'paneltec-v61'` ✓.

## Out of scope this phase (P1 follow-ups)
- **Document Library row buttons** (View PDF / Download PDF / disabled tooltip) and **PdfPreviewModal** — the backend endpoints are wired and the System page lets admin install the toolchain; the row-level buttons + modal ship in Phase 3.11 (small, isolated frontend work).
- **Bulk PDF toolbar action** on Workers certs / Renewal Links — needs each page's existing multi-select wired to the bundle endpoint.
- **Async 202 + job_id polling** for files >5 MB — current conversion is fast enough for the seeded corpus; ship when first user reports a >2 s wait.

---


# 2026-02-19 — Phase 3.9c + SWMS-06 ingest

## Phase 3.9c — Per-worker / per-role / per-company Form Assignments
**Backend** (`asset_service.py`, `forms.py`, `workers_qr.py`, new `form_assignment_notifier.py`, migration `migrate_seed_form_applies_to.py`):
- Extended `form_templates.applies_to` with `worker_ids`, `roles`, `companies` (each with optional `expires_at`).
- New `resolve_forms_for_worker()` combines asset-type + direct/role/company rules and decorates with `match_reasons`.
- `PUT /api/form-templates/{id}/applies-to` and `POST /assignments/bulk` accept the new fields; unknown `worker_id` → 422; `skip_notifications:true` mutes the dispatcher.
- New `POST /preview-recipients` returns prior/next/newly-added counts + sample without persisting.
- `GET /api/forms/templates?for_worker=me|<id>` filters the library to that worker; admins see `?show_all=true` bypass.
- `GET /api/scan/{token}/forms` now returns `match_reasons` per form.
- Notification dispatcher fires email (Microsoft 365 outbox) + SMS (TextMagic) within ~1 s of save, deduped per (worker_id, template_id) for 24 h via `form_assignment_notifications`.

**Frontend** (`FormAssignmentsAdmin.jsx`, `Forms.jsx`, `WorkerScanResolver.jsx`, `service-worker.js` → `v60`):
- Three new right-pane sections in FormAssignmentsAdmin (`section-workers/section-roles/section-companies`) + live "Visible to N workers" counter (`visible-counter`) + Save → Notify confirm dialog (`notify-confirm` / `notify-skip` / `notify-send`).
- `/app/forms` for workers calls `?for_worker=me` automatically; admins see the full library.
- WorkerScanResolver site search debounced 300 ms; site IDs slugified into testids.

**Phase 4.1 code-review fixes:**
1. RBAC on `/api/scan/worker/{token}/site-signin` — workers can only sign themselves in (cross-worker → 403). Admin/manager/hseq_lead unrestricted.
2. WorkerScanResolver picker testids slugified.
3. Site-search debounced 300 ms.
4. site_signins row's `workspace_id` now prefers the WORKER's own workspace.
5. No `dangerouslySetInnerHTML` usage in Workers.jsx (confirmed via grep).

**Receipts:** list_assignments returns roles+companies; PUT with worker+role+company → `notify.newly_added_count=30 queued=true`; unknown worker_id → 422; `email_outbox` row "New safety form: Equipment Pre-Use Checklist · sent" + 17 dedupe rows; admin signing another worker → 200 with worker's workspace_id; worker→ 403 cross-signin; CACHE_VERSION = `paneltec-v60`.

**Regression follow-up:** iteration 19 caught a missing-hook bug in `WorkerScanResolver.jsx` (`debouncedQ`/`slug` undefined). Patched — hook + helper now declared at module scope.

## SWMS-06 ingest (queued after Phase 3.9c)

**Module:** pre-existing — `swms` collection + `crud.build_router("swms", "swms", SwmsIn, "swms")` + `pdf_renderer.render_swms_pdf`. Extended, not duplicated.

**Backend changes:**
- `models.SwmsIn` extended with optional rich fields (`code, version, slug, scope, high_risk_construction_work, prepared_by, approved_by, review_date, activity_analysis, environmental_risks, training_requirements, equipment_list, emergency_procedures, legislation_and_codes, attendance_sheet_template, source_file, applies_to, superseded_by, supersedes`). Legacy AI-draft path unaffected.
- New `swms_extras.py` — full SWMS-06 V12.0 payload + `seed_swms_06()` (idempotent, runs on startup, one record per org) + `POST /api/swms/import-docx` (admin-only; fetches .docx, parses via `python-docx`, returns inferred payload for review — does NOT auto-save).
- `pdf_renderer.render_swms_pdf(doc, layout='civil')` — modern Paneltec Civil layout by default; `layout='original'` switches to traditional Paneltec table layout with formal borders. Both branches render activity/hazard table, environmental risks table, PPE/training/equipment/legislation bullets, emergency procedures, and a 12-row attendance sign-off sheet.
- `pdf_routes._build` now accepts `?layout=civil|original` query on the SWMS endpoint.
- Installed `python-docx==1.2.0` + `lxml==6.1.1` (added to requirements.txt).
- Startup registration: `swms_extras_router` mounted + `seed_swms_06()` called from `on_startup`.

**Receipts (stephen@paneltec org, seed id `c05bd7ee-8f7d-40fc-b4ad-719dcab25e4b`):**
- `GET /api/swms` → 7 records, includes SWMS-06 V12.0 status=approved review_date=2026-08-31.
- `GET /api/swms/{id}` → full payload returns prepared_by=Patrick Monaghan, approved_by=John Guy, 11 activity_analysis rows, 9 environmental_risks, applies_to.asset_types=[concrete_saw, slab_cutter], source_file URL preserved.
- `GET /api/swms/{id}/pdf?layout=civil` → 200, 17 458 bytes, `%PDF-1.4` magic.
- `GET /api/swms/{id}/pdf?layout=original` → 200, 17 502 bytes (different size confirms layout branch).
- `POST /api/swms/import-docx` → 200, parses the .docx into 16 paragraphs + 14 tables, returns inferred title="2018 SWMS-06 Concrete or Asphalt Cutting".
- Frontend `/app/swms` list shows the new record at top (APPROVED · vV12.0 · Open report / Email).
- Frontend `/app/swms/{id}` detail renders the title, status pill, PPE block.

**Deferred to a future phase (P1):**
- SWMS Assignments admin page at `/app/settings/swms-assignments` (two-pane like FormAssignmentsAdmin, targeting asset_types/workers/roles/companies). Backend `applies_to` already accepts the same shape — wire the UI when the user greenlights Phase 4.2.
- SWMS detail view currently doesn't render the structured activity_analysis / environmental_risks tables in-app (the PDF does). Add a `RichSwmsDetail` component when prioritised.
- `superseded_by`/`supersedes` archive flow (auto-archive on new version).
- "Civil PDF" + "Original layout PDF" split-button on the detail page (the URL param is wired; the dropdown UI ships when SWMS frontend is rebuilt).

---


# 2026-02-19 — Phase 4.1: Worker Induction QR + Printable ID Cards

## Backend (`/app/backend/workers_qr.py`)
- **Endpoints**
  - `GET /api/workers/{id}/qr.png` — admin-only PNG of the worker's signed scan URL.
  - `GET /api/workers/{id}/id-card.pdf?layout=wallet|lanyard|avery` — ReportLab-generated PDFs (wallet default = ID-1 85.6×54 mm, lanyard 100×150 mm portrait, Avery A4 10-up).
  - `POST /api/workers/{id}/nfc-pair` `{nfc_uid}` — pairs a UHF/NFC tag UID with a worker; duplicate UID on a different worker returns `409`.
  - `DELETE /api/workers/{id}/nfc-pair` — unpairs.
  - `GET /api/scan/worker/{scan_token}` — **PUBLIC** (no auth). Returns `{id,name,role,trade,company,scan_token,certifications,assigned_swms,active_site_today}` for the lanyard scan resolver.
  - `POST /api/scan/worker/{scan_token}/site-signin` `{site_id,site_name,gps}` — authed; inserts a `site_signins` row with `source="worker_qr"` and the calling user's `org_id` + `workspace_id`.
- **Migration**: nanoid 10-char `scan_token` backfilled into all 61 existing workers at startup. `_full_name(w)` helper derives display name from `first_name + last_name` (workers don't have a single `name` column).
- **Coexistence**: `/api/scan/worker/{token}` (new) and `/api/scan/{asset_token}/forms` (Phase 3.8) share the `/scan` mount with no shadowing — verified by regression test.

## Frontend
- **New** `pages/WorkerScanResolver.jsx` — public route `/scan/worker/:token`. Renders profile card, certifications chip strip, "Already signed in to {site}" banner, and dual-state CTA: anonymous shows "Log in to sign in" → `/login?next=...`, authed shows "Sign in to site" → opens a site picker modal backed by `/api/forms/pickers/sites`.
- **`pages/Workers.jsx`** — added:
  - Row chips: green `QR` (every worker, 60 rows) + purple `NFC` (when paired).
  - Row action button: `Printer` icon → one-click wallet PDF in new tab.
  - `IdCardSection` accordion inside `EditModal` with: QR preview (blob-fetch with bearer header), 3-up layout picker (`wallet` selected by default), Print preview / Download PDF buttons, NFC pair input (auto-uppercase, hex+colon filtered) with Pair / Unpair buttons.
- **Service worker** bumped `paneltec-v57 → v58`.

## Pre-flight (mandatory after previous build-breaks)
- `python -m py_compile $(find /app/backend -maxdepth 2 -name "*.py")` ✓ clean.
- `cd /app/frontend && DISABLE_ESLINT_PLUGIN=true yarn build` ✓ 19.4s, no compile errors.
- `curl /api/health` → 200; `curl /api/auth/login` → 200.

## Verification — Phase 4.1 receipts (Stephen Guy, id=dbddf739-5803-4a86-925d-ed1aef514fa1, scan_token=i4UmjUBzsi)
- **Public profile (anon)** `GET /api/scan/worker/i4UmjUBzsi` → 200 · 251 b · `name="Stephen Guy"`, 4 certs, `active_site_today="130 Cimitiere St Launceston"`.
- **Invalid token** `GET /api/scan/worker/__invalid__` → 404.
- **Wallet PDF** → 200, `%PDF` magic ✓. **Lanyard PDF** → 200, `%PDF` ✓. **Avery A4 PDF** → 200, `%PDF` ✓.
- **QR PNG** → 200, `\x89PNG` ✓.
- **Site sign-in** POST `{site_id:"130 Cimitiere St Launceston",gps:{...}}` → 200; row has `source="worker_qr"`, `workspace_id="156f06df…"`, `worker_name="Stephen Guy"`, `signed_in_by_name="Stephen McGregor"`. Subsequent profile fetch shows `active_site_today` populated.
- **NFC pair** `04:A1:B2:C3:D4:E5` → 200 OK. Re-paring same UID to a different worker → **409 conflict**. ✓
- **Asset scan regression** `GET /api/scan/03tuIaQGp5/forms` → 200, returns Scott Campbell vehicle + 6 forms (Phase 3.8 + 3.9b unaffected). ✓

## Testing
- `testing_agent_v3` iteration 18 → backend **12/12 pytest pass**, frontend **100% pass**. Zero critical/minor bugs. Pytest module at `/app/backend/tests/test_phase_41_worker_qr.py`.
- Code-review notes (non-blocking): site-signin doesn't yet enforce role RBAC; site picker testids include spaces; sites picker lacks debounce; workspace_id falls back to first allowed workspace.

## Out of scope (Phase 4.2/4.3)
- **Phase 4.2** — Site induction QR (posters per site, induction acknowledgement record, expiry).
- **Phase 4.3** — Supplier induction QR + supplier compliance gating.
- Slugify site-signin picker IDs.
- Debounce site search in `WorkerScanResolver`.

---


# 2026-02-18 — Phase 3: Service & Maintenance for Plant & Vehicles

## Backend (new `/app/backend/asset_service.py`)
- **Collections** (with indexes wired in `seed.ensure_indexes`):
  - `asset_service_schedules` — name, interval_kind (hours|km|calendar), interval_value, calendar_unit, last_done_at/value, computed next_due_at/value, status_cached, reminder_lead_*, status, soft delete.
  - `asset_service_records` — type (service|defect|meter_update), title, description, performed_at/by, hours_at/km_at, cost, technician, photo_file_ids, defect_severity, linked_hazard_id, schedule_id.
  - `asset_reminders_sent` — dedupe key (schedule_id, status, sent_at).
- **Endpoints under `/api/assets/{asset_id}/...`**: CRUD for schedules + records, `POST /meter` quick endpoint, `GET /records?type=`, `DELETE /records/{rid}` (admin only).
- **`POST /api/assets/service/scan-reminders`** — walks active schedules, computes due/overdue using `_compute_next_due`, queues M365 email via existing `email_outbox.queue_email_doc` and SMS via TextMagic API, deduplicates within 24h per (schedule, status).
- **`GET /api/assets/service/summary`** — dashboard payload: `{overdue, due_soon, items:[top-5]}`.
- **`POST /api/scan/quick-action`** — public-scan-driven endpoint (JWT) for the worker's three actions: `log_service` / `report_defect` / `update_meter`. Resolves token → asset and dispatches into `create_record`.
- **Defect → Hazard auto-link**: `_maybe_raise_hazard` checks workspace setting `settings.defectAutoCreatesHazard` (default true). Major/critical defects insert a `hazards` row with `source="asset_defect"`, `linked_asset_id`, severity mapped (critical→high, major→medium). The defect record stores `linked_hazard_id`.
- **Schedule recompute**: `create_record(type=service, schedule_id=…)` updates `last_done_at/value` and recomputes `next_due_*`. Meter-only updates also recompute *all* active schedules on the asset.
- Permissions middleware leverages existing `assets` resource gate; worker `POST /api/assets/{id}/schedules` → 403 (verified).

## Frontend
- **New `components/AssetServiceTabs.jsx`** — `ServiceSchedulesTab` (list with OK/DUE SOON/OVERDUE pills + add/edit modal) and `ServiceLogTab` (chronological feed with severity chips and `Hazard raised` badge linking to the auto-created hazard).
- **`AssetDrawer.jsx`** — added `Schedules` and `Service log` tabs.
- **`pages/ScanResolver.jsx`** — added `ScanQuickActions` panel: three buttons (Log service / Report defect / Update hours/km) rendered above the existing View / Copy actions. Slide-up form posts to `/api/scan/quick-action` and toasts "Done · added to {asset}" (or "Hazard raised" when applicable).
- **`pages/Dashboard.jsx`** — new `PlantDueWidget` next to the existing certs widget. Counts overdue + due-soon, lists top 5, links to `/app/vehicles`.
- Service worker bumped `paneltec-v41 → v42`.

## Workspace setting
- `workspaces.settings.defectAutoCreatesHazard` (bool, default true). Updated directly via MongoDB in this phase — UI toggle (Settings → Compliance) deferred to follow-up.

## Verification (curl + screenshots)
- **Schedule lifecycle**: POST `/api/assets/{id}/schedules` `{name:"250hr service",interval_kind:"hours",interval_value:250}` → status `ok` (cur=0, next=250). After POST `/meter {hours:260}` schedule cache flips to `overdue`. Dashboard summary now returns `overdue:1`.
- **Scan-reminders**: 1st call `{scanned:1, overdue:1, emails_sent:1+}`. 2nd call within 24h `{emails_sent:0}` (dedupe). ✓
- **Defect→Hazard**: critical defect via `/api/scan/quick-action` → hazards count 5→6, `linked_hazard_id` populated on the defect record. ✓
- **Toggle OFF** `defectAutoCreatesHazard=false`: critical defect → `linked_hazard_id:null`, hazards count unchanged. ✓
- **Worker (non-admin)**: `POST /api/assets/{id}/schedules` → 403. ✓
- Playwright screenshots (`/app/test_reports/p3_01..04_*.png`):
  - `p3_01_dashboard` — Plant due widget visible, counter "1 OVERDUE · 0 DUE SOON".
  - `p3_02_schedules_tab` — AssetDrawer Schedules tab with header and Add button.
  - `p3_03_service_log` — Service log tab with Log service + Report defect buttons.
  - `p3_04_scan_quick_actions` — `/scan/EFLdyI3Thc` page now shows three quick-action buttons above View / Copy.

## Out of scope (deferred)
- Plant & Vehicles list status chip per row + sort/filter by service status.
- Bulk "Scan reminders now" toolbar button in PlantVehicles header.
- Settings → Compliance UI toggle for `defectAutoCreatesHazard` (workspace-level direct DB update works today).
- Service-record PDF (acceptance criterion — falls back to existing `forms_pdf.py` for any forms attached, no separate `asset_service_pdf.py` yet).
- Worker / Site / Supplier QR (Phase 4) and UHF (Phase 5) — explicitly out of scope.


# 2026-02-18 — Phase 2: Scan-to-fill on Forms (`asset_scan` field)

## Backend
- `forms.py`:
  - `asset_scan` added to `ALLOWED_FIELD_TYPES`; `_clean_field` now preserves a `config` blob (per-field settings: `requireScan`, `kindFilter`, `autofillTargets`).
  - `GET /api/forms/assets/lookup?token=…` (JWT) — authed wrapper around the public scan resolver, also returns `vehicle_type_slug`, `last_known_lat/lng/at`, `odo_km`, `hours_meter`. 404 on unknown, 410 on retired.
  - `GET /api/forms/assets/picker?q=&kind=&asset_type=` (JWT) — trimmed picker list, workspace-scoped (org-wide Navixy + workspace manual assets).

## Frontend
- **New** `src/components/forms/AssetScanField.jsx`:
  - Segmented control with capability auto-detect (`'NDEFReader' in window`, `navigator.mediaDevices`, `'BarcodeDetector' in window`).
  - **QR Camera**: `BarcodeDetector` first, `jsQR` fallback on hidden canvas; environment-facing camera; overlay box and Start/Stop controls.
  - **NFC Tap**: `NDEFReader().scan()` listens for the first `url` record; abort-controller for clean stop; gracefully hides on unsupported browsers.
  - **Manual Pick**: debounced `/api/forms/assets/picker` calls.
  - Resolve flow: any input → `/api/forms/assets/lookup` → green confirmation card ("Resolved · PLANT · EXCAVATOR …") with **Use this** / **Scan again**.
  - On confirm, dispatches `paneltec:asset-autofill` event with target field values.
  - Exports `buildAutofillFromAsset(allFields, asset)` — maps vehicle_type/rego/gps/odo/hours into sibling field ids by label heuristics.
- `Forms.jsx`:
  - `FieldRunner` adds `asset_scan` case and routes the autofill event.
  - `FillOutModal` listens for the autofill event, locks affected fields, and renders an inline **Override** link to unlock individual fields.
  - URL handler: `?template={id}&scan={token}` auto-opens FillOutModal with `_initialValues` pre-set (asset card + dependent autofill applied).
- `pages/ScanResolver.jsx`:
  - When `?form={id}` is present **and** user is authed, the resolver stashes `{scan_token, form_id, at}` in `sessionStorage.paneltec.activeScan` and navigates to `/app/forms?template={id}&scan={token}` for a seamless landing.
- `components/forms/TemplateBuilder.jsx`:
  - `asset_scan` added to `FIELD_TYPES` palette.
  - Save payload now persists `config` per field.
- Service Worker bumped `paneltec-v40 → paneltec-v41`.

## Heavy Vehicle Daily Check migration
- Patched template `be6e01d5-1e98-4d81-bb4a-33fd607f0d20`: inserted an `asset_scan` field at position 0 ("Scan asset", `requireScan=false`, `kindFilter=any`). Field order: Scan asset → Date → Vehicle Type → Vehicle Rego.

## Dependencies
- `jsqr@1.4.0` added to `package.json` (`yarn add jsqr`).

## Verification
- curl smoke: `GET /api/forms/assets/lookup?token=EFLdyI3Thc` returns enriched payload (vehicle_type_slug: "excavator"); bad token → 404. `GET /api/forms/assets/picker?q=exc&kind=plant&limit=5` returns CAT 320.
- Playwright e2e (5 screenshots `/app/test_reports/p2_01..p2_05_*.png`):
  1. Heavy Vehicle Daily Check opens with Scan asset segmented control (QR Camera / Manual pick).
  2. Manual pick lists workspace assets.
  3. Search "CAT 320" → green Resolved card with Use this / Scan again.
  4. Use this → asset chip persisted ("via manual"); Vehicle Rego auto-filled to "CAT 320 Excavator (Yard) · EX-320-007" and shows **Override** link (locked).
  5. Deep-link `/scan/EFLdyI3Thc?form={tpl}` → modal auto-opens with asset chip pre-filled ("via qr").

## Deferred (out of scope for Phase 2)
- Vehicle Type auto-select when the template's `select` options don't include an "Excavator" / matching slug (autofill correctly no-ops). Templates that want auto-Vehicle-Type should add the matching option label.
- Service & Maintenance schedules (Phase 3).
- Worker/Supplier/Site QR (Phase 4).
- UHF sled (Phase 5).


# 2026-02-18 — Phase 1: Plant & Vehicles Register (Asset Register backbone)

## New backend module `/app/backend/assets.py`
- Collection `assets` indexed by `scan_token` (unique), `(org_id, kind)`, `navixy_device_id` (sparse), `nfc_uid` (sparse).
- Routes (under `/api/assets`):
  - `GET /` — list + backfill from Navixy on every call (idempotent on `navixy_device_id`). Filters: `kind`, `asset_type`, `q`.
  - `POST /` — create manual asset (admin/manager/hseq_lead via `assets.edit`).
  - `GET /{id}`, `PUT /{id}`, `DELETE /{id}` — read / update / soft-archive.
  - `GET /{id}/qr.png` — QR PNG encoding `${FRONTEND_PUBLIC_URL}/scan/{token}`.
  - `GET /{id}/label.pdf?layout=a6|avery_l7160|on_metal|combo&ids=…` — ReportLab labels.
  - `POST /{id}/nfc-pair` (workspace-scoped uid uniqueness → 409 on dup) + `DELETE /{id}/nfc-pair`.
  - `POST /{id}/uhf-pair` — Phase 5 stub.
  - `GET /scan/{token}` — **public, no JWT** (skipped in permissions middleware). Returns sanitised payload, `410` on retired, `404` on unknown.
- Navixy backfill uses `_classify_vehicle_type(label, tag_names)` from `forms.py` — vehicles inherit the same vac-truck/tipper classification.
- Rego parsed from Navixy labels with a regex heuristic (last alphanumeric token w/ ≥1 letter and ≥1 digit).

## Permissions
- `permissions.py`: added `assets` resource (`email_supported=False`). admin/hseq_lead: full edit; supervisor/worker/auditor: view-only.
- `permissions_middleware.py`: added `(/api/assets, "assets")` matcher and `^/api/assets/scan/` skip path for the public resolver.

## Frontend
- New `/app/frontend/src/pages/PlantVehicles.jsx` — unified register: filter chips (All / Vehicles / Plant / Tools / Containers), type sub-pills, search, list/map view, source badges (LIVE NAVIXY / MANUAL) + pairing chips (QR ✓ / NFC ✓ / UHF ✓), per-row actions (Locate, QR download, Print label, Edit, Archive), `+ Add Asset` and `Print Labels` (multi-select via layout picker).
- New `/app/frontend/src/components/AssetDrawer.jsx` — right-side drawer with Details / Pairing / Photo / Notes tabs. Pairing tab includes QR preview, label printers (a6/on_metal/combo/avery_l7160), Web NFC writing via `NDEFReader` with manual UID fallback, and UHF EPC field. Navixy-linked assets lock core fields ("Synced from Navixy").
- New `/app/frontend/src/pages/ScanResolver.jsx` at `/scan/:token` (public route) — anonymous-safe; redirects to `/login?next=…` for full access. Phase 2 will read `sessionStorage` form context to push the asset into an active form.
- Sidebar renamed "Vehicles" → **Plant & Vehicles** (still routed at `/app/vehicles`, legacy at `/app/vehicles-legacy`). Resource gate changed `vehicles` → `assets`.
- `lib/permissions.js` RESOURCE_LABELS/EMAIL_SUPPORTED updated.
- Service Worker bumped `paneltec-v38 → paneltec-v39`.

## Dependencies
- Added `qrcode==8.2` to `requirements.txt` (`pip install qrcode[pil]`). `reportlab` already present.

## Verification (curl + screenshot)
- Backend smoke: 72 Navixy vehicles backfilled, CAT 320 Excavator (Yard) created with token `EFLdyI3Thc`. PDF labels valid (`%PDF-`) at a6=14KB, combo=11KB, on_metal=18KB, avery_l7160=26KB (3 ids). QR PNG ~2KB, valid `\x89PNG`. NFC pair success + duplicate 409. Worker token: GET 200, POST 403.
- Frontend smoke: sidebar shows "Plant & Vehicles", page lists 73/73 (72 live · 1 manual), CAT 320 Excavator appears with MANUAL + QR ✓ + NFC ✓ chips. `/scan/EFLdyI3Thc` renders the resolver card with name + rego + actions.

## Phase 1 acceptance: all met
- GET /api/assets merges + backfills ✓
- POST creates with unique scan_token ✓
- /qr.png returns PNG that decodes to `${FRONTEND_PUBLIC_URL}/scan/{token}` ✓
- /label.pdf?layout=a6 returns PDF (14KB, well under 200KB cap) ✓
- avery_l7160 with `?ids=` lays 3-up ✓
- NFC duplicate → 409 ✓
- Plant & Vehicles page lists merged set with chips ✓
- Worker role hides create/edit/delete ✓
- /scan/{token} works end-to-end ✓

## Deferred to next phases
- Photo upload via doc_files (drawer accepts ID only for now)
- `asset_scan` form field (Phase 2)
- Service & Maintenance schedules (Phase 3)
- Worker/Supplier/Site QR (Phase 4)
- UHF sled integration (Phase 5)
- Expo mobile parity — dispatch `e1_expo_frontend_dev`


# 2026-02-18 — Vehicle Type → Filtered Navixy Fleet (verified)
- `_classify_vehicle_type(label, tag_names=None)` in `/app/backend/forms.py` now searches Navixy **tags first**, label second. This lifted vac-truck detection from 2 → 13 (Cap Recycler, Industrial, Cappelotto, RSP, VW Crafter, etc. all carry the "Vac Truck Dumping" tag but have free-form labels).
- `/api/forms/fleet/vehicles` proxy passes each vehicle's `tags[].name` array into the classifier.
- Frontend `Forms.jsx` `FieldRunner` was restored to its proper dispatch (the previous "duplicate cleanup" had accidentally left only the VehicleNavixyField body inside, breaking every non-vehicle field render). `FieldRunner` now correctly delegates `photo/signature/gps/vehicle_navixy/textarea/select/radio/date/number/text` and threads `allFields` + `allValues` into the vehicle picker.
- Service Worker bumped `paneltec-v37 → paneltec-v38`.
- Verified on **Heavy Vehicle Daily Check**:
  - Field order Date → Vehicle Type → Vehicle Rego (migration intact).
  - No selection → 72 vehicles shown.
  - "Vacuum Truck" → "Showing 13 vehicles matching Vacuum Truck" (Cap Recycler ✓, Industrial ✓, Cappelotto 1/2/3 ✓, Vacvator 1/2 ✓, RSP, VW Crafter CCTV, Kroll Recycler, DW FX50/FX60, "Other" w/ Vac tag).
  - "Tipper" → "Showing 11 vehicles matching Tipper" (UD/500/200/HINO/450 Tippers).
  - Clear filter → all 72 vehicles return.


# 2026-02-17 — PDF viewer Edge-block fix
- `POST /api/pdf-token` mints a 90s JWT (claims: sub/org_id/resource/record_id/action/exp, type=pdf-token).
- Each `/api/{resource}/{id}/pdf` accepts EITHER `Authorization: Bearer <user-jwt>` OR `?token=<pdf-token>`.
- Frontend `PdfActions.jsx` switched from blob+iframe to `window.open` + signed URL. `PdfViewerModal.jsx` deleted.
- Token is bound to the exact resource+record_id — mismatch → 403 `pdf-token-mismatch`; expired → 401 `pdf-token-expired`; garbage → 401 `pdf-token-invalid`.


# 2026-02-17 — User management opened to hseq_lead (verified)
- `hseq_lead` now has `users.{open,view,edit}=true` (still `email=false`). Confirmed via `/api/auth/me`.
- `GET /api/workspaces` (org-scoped list) wired and consumed by the user-edit drawer.
- `UsersManagement.jsx` user drawer now renders a functional workspace multi-select (checkboxes per workspace).
- Verified end-to-end as `hseq_lead`: invite → patch (rename + add workspace) → delete (soft-disable) → reactivate via PATCH status=active.
- Regression: `worker` token still returns 403 on `GET /api/users` and `POST /api/users` (lower roles untouched).


# Phase 5 — Permissions Matrix + Email Outbox (shipped 2026-02-17)

## Permission model
- 12 resources × 4 actions (open / view / edit / email). Vehicles, integrations and users have `email_supported: false`.
- Role defaults in `/app/backend/permissions.py::ROLE_DEFAULTS`. Per-user overrides stored in Mongo collection `user_permissions`. Explicit override always wins over the role default.
- `require_permission(resource, action)` FastAPI dep used directly in `crud.py`, `users.py`, `email_outbox.py`. A `PermissionsMiddleware` (`/app/backend/permissions_middleware.py`) auto-gates `/api/contractors`, `/api/renewals`, `/api/audit-exports`, `/api/integrations`, `/api/users` so we didn't have to touch those modules. 403 response always reads `{"detail":"Permission denied: <r>.<a>"}`.
- `GET /api/auth/me` now returns `effective_permissions` matrix for client-side gating.

## User management — admin only
- `GET /api/users`, `GET /api/users/{id}`, `PATCH /api/users/{id}`, `DELETE /api/users/{id}` (soft-disable)
- `GET /api/users/{id}/permissions`, `PUT /api/users/{id}/permissions`, `POST /api/users/{id}/permissions/reset`
- `POST /api/users` invites a new user (status=invited) and queues an invite email through the outbox

## Email + Outbox
- Mongo collection `outbound_emails`.
- `POST /api/email/send` — generic; checks `<resource_kind>.email` permission; if `integration_configs.kind=microsoft365` is `connected`, marks `sent` (real Graph call is a TODO at `https://graph.microsoft.com/v1.0/me/sendMail`); otherwise `queued` with note "Microsoft 365 not connected".
- `GET /api/email/outbox` + `GET /:id` + `POST /:id/retry` + `POST /:id/cancel`.
- Convenience routes (each gated by `<resource>.email`):
  - `POST /api/swms/{id}/email-for-review`
  - `POST /api/pre-starts/{id}/email`
  - `POST /api/site-diary/{id}/email-daily`
  - `POST /api/hazards/{id}/email`
  - `POST /api/incidents/{id}/email-summary`
  - `POST /api/inspections/{id}/email`
  - `POST /api/contractors/{id}/email`
  - `POST /api/renewals/{id}/email-link`
  - `POST /api/audit-exports/{id}/email`

## Frontend
- `PermissionsProvider` in `AppShell` hydrates from `/api/auth/me`.
- `useCan(resource, action)` + `<Can>` JSX guard in `/app/frontend/src/lib/permissions.js`.
- Sidebar items hide via `can(resource, "open")`.
- New pages: `/app/settings/users` (full matrix UX with tri-state cells, invite modal) and `/app/outbox` (status/retry/cancel + M365 not-connected banner).

## Seed
- `audit@paneltec.com` (auditor) gets one override: `audit_exports.edit = true` — shows the "Custom" pill on the user list and demonstrates the override flow.
- 5 sample outbox entries (queued / sent / failed / cancelled mix).

## Mobile (deferred)
TODO: thread `effective_permissions` into the Expo app's auth store and gate the same tabs / actions. Web frontend ships first.

# Paneltec Civil — PRD & Build Log

## Original problem statement
Build the **web frontend** for **Paneltec Civil**, a WHS (Work Health & Safety)
compliance platform for civil contracting / construction teams.

## Stack
- React 19 + CRA (craco) at `/app/frontend/` · Tailwind + shadcn/ui · React Router v7 · sonner toasts · lucide-react
- FastAPI + Motor (Mongo) at `/app/backend/` · UUID string IDs · ISO datetimes
- Auth: bcrypt + PyJWT (HS256, 7-day expiry) · Bearer in localStorage (`paneltec_token`)
- AI: emergentintegrations + Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Fonts: Space Grotesk display, Inter body — Google Fonts

## User personas
- **HSE Manager / HSEQ Lead** — runs oversight: dashboard, SWMS review, audit exports
- **Site Supervisor** — captures pre-starts, hazards, SWMS drafts, incidents
- **Worker** — signs on at the site QR code, follows SWMS
- **Auditor** — read-only access to records and audit exports
- **Admin / Workspace owner** — manages org, workspaces, integrations, users

## Brand
Blue `#2C6BFF`, mint `#D1FAE5`, violet `#7C3AED`, amber `#F59E0B`, red `#EF4444`.

---

## Phase 1 — shipped 2026-02-17
Marketing landing, mock auth, app shell, dashboard, integrations register, 13 stub routes.

## Phase 2 — shipped 2026-02-17

### Backend (`/app/backend/`)
| File | Purpose |
|---|---|
| `server.py` | FastAPI app, mounts all routers under `/api`, runs `seed_all()` on startup, exposes `/api/openapi.json` |
| `db.py` | Shared Motor client, reads `MONGO_URL` + `DB_NAME` from env |
| `models.py` | Pydantic schemas — UUID-string IDs, ISO timestamps |
| `auth.py` | bcrypt + PyJWT, `get_current_user`, `/auth/signup` `/auth/login` `/auth/me` `/auth/logout` |
| `crud.py` | Generic CRUD factory used by all 6 entities + SWMS `/review` |
| `ai.py` | Claude Sonnet 4.5 wrappers: `/ai/swms-draft`, `/ai/diary-structure`, `/ai/hazard-vision` |
| `dashboard.py` | `/dashboard/metrics`, `/files/hazards/{name}` |
| `seed.py` | Idempotent — 1 org / 2 workspaces / 5 users / 46 capture records |

### Mongo collections
`users` · `orgs` · `workspaces` · `swms` · `pre_starts` · `site_diary_entries` · `hazards` · `incidents` · `inspections`

### API endpoints (43 routes, all under `/api`)
- **Auth**: `/auth/signup` `/auth/login` `/auth/me` `/auth/logout`
- **AI**: `/ai/swms-draft` `/ai/diary-structure` `/ai/hazard-vision`
- **Dashboard**: `/dashboard/metrics`
- **Files**: `/files/hazards/{name}`
- **CRUD** (`GET`, `POST`, `GET/{id}`, `PATCH/{id}`, `DELETE/{id}` for each of):
  `swms`, `pre-starts`, `site-diary`, `hazards`, `incidents`, `inspections`
- **SWMS review**: `POST /swms/{id}/review` (`hseq_lead` + `admin` only)
- **Misc**: `/`, `/health`, `/whoami`, `/openapi.json`

### Frontend (`/app/frontend/src/`)
| File | Purpose |
|---|---|
| `lib/api.js` | Axios instance, Bearer interceptor, 401 → `/login` redirect |
| `lib/auth.js` | `login` `signup` `fetchMe` `signOut` helpers, localStorage keys |
| `components/layout/AppShell.jsx` | Sidebar + topbar, `<Navigate to="/login">` gate |
| `components/capture/Ui.jsx` | Shared form helpers (PageHeader, AiButton, StatusBadge, etc.) |
| `pages/Dashboard.jsx` | Real metrics from `/api/dashboard/metrics` |
| `pages/Swms.jsx` | List + 2-step AI wizard (`SwmsNew`) + `SwmsDetail` with review actions |
| `pages/PreStarts.jsx` | Grid + create form with SWMS link checkboxes + sign-on rows |
| `pages/SiteDiary.jsx` | List + create with **Structure with AI** side-by-side panel |
| `pages/Hazards.jsx` | Gallery + photo-drop create form that auto-calls vision AI |
| `pages/Incidents.jsx` | Filtered list + create form with follow-up actions repeater |
| `pages/Inspections.jsx` | List + template picker → pass/fail/N-A checklist form |

### Routes shipped (all under `/app/*`)
`dashboard` · `swms` (+/new, +/:id) · `pre-starts` (+/new) · `site-diary` (+/new) · `hazards` (+/new) · `incidents` (+/new) · `inspections` (+/new) · `ask` · `contractors` · `renewals` · `audit-exports` · `settings/{org,workspaces,integrations,users}`

### Seed data (idempotent on every backend startup)
- Org: **Paneltec Civil Pty Ltd**
- Workspaces: **Sydney Metro**, **Newcastle Depot**
- Users (all `demo123`): `demo@paneltec.com` (hseq_lead), `worker@`, `super@`, `audit@`, `admin@`
- 8 SWMS · 12 pre-starts · 10 diary entries · 6 hazards · 4 incidents · 6 inspections

### Phase 2 acceptance — all green
- [x] JWT auth working end-to-end, mock auth removed
- [x] All 6 capture flows persist to Mongo
- [x] Dashboard pulls real metrics
- [x] 3 AI endpoints verified live (SWMS draft, diary structure, hazard vision)
- [x] OpenAPI at `/api/openapi.json`
- [x] `supervisorctl status` → backend + frontend RUNNING
- [x] Testing agent: backend 18/18, frontend critical flows all pass
- [x] No console errors

---

## Decisions on visual ambiguity (Phase 2)
- **AI buttons** use violet (`#7C3AED`) with a sparkle icon to differentiate from regular CTAs
- **Status palette** unified across entities — open/in_progress/closed/draft/submitted/approved use a shared `StatusBadge`
- **Workspace switcher** still local state — multi-tenancy filtering deferred to Phase 3
- **Photo upload** is single-file for hazards; Phase 3 will add multi-photo for incidents
- **SWMS detail review actions** only show for `submitted` status and `hseq_lead`/`admin` roles
- The dashboard metrics key is `attention_band` (not `band`) — frontend handles both for resilience


## Phase 3b — Navixy GPS integration — shipped 2026-02-17
- New collection `integration_configs` with masked secrets (`••••<last4>`).
- New backend module `/app/backend/integrations.py` mounts under `/api/integrations`.
- 4 connector cards on `/app/settings/integrations`; Navixy now routes to a real admin page; the other 3 still open the Phase-1 "request access" modal (MOCKED).
- Navixy v2 endpoints used: `/v2/user/auth`, `/v2/tracker/list`, `/v2/tracker/get_states`. Operator enters base URL, email, password in the UI — no credentials hardcoded.
- New routes: `/app/settings/integrations/navixy` (admin), `/app/vehicles` (live fleet list, map placeholder).
- Bug fix: `useWorkspace` import was missing in `/app/frontend/src/components/layout/AppShell.jsx` — added `import { useWorkspace } from '../../lib/workspace';`.

## Backlog

### P0 — Phase 3 next
- Workspace data scoping (the topbar switcher should actually filter all lists/metrics)
- Real **Ask Intelligence** RAG endpoint over captured records (currently MOCKED briefing copy)
- Contractor Register (`/app/contractors`) + Renewal Links (email-driven self-serve)

### P1 — Phase 3
- Audit Exports (PDF/ZIP packs for Comcare / SafeWork / client audits)
- Real integrations: Simpro user sync, M365 email, TextMagic SMS, Navixy GPS
- Role-based access enforcement on UI (worker shouldn't see SWMS review buttons; partly done)

### P2
- Multi-photo upload + EXIF GPS for hazards & incidents
- Notification system (in-app + email)
- Mobile-app (Expo) wiring to same backend

## Test credentials
See `/app/memory/test_credentials.md`. JWT auth — Bearer `paneltec_token` in `localStorage`.
All 5 seed accounts share password `demo123`. Idempotent seed re-applies on every backend startup.


# 2026-06-27 — Forms Library Phase 1 (shipped)
- **Backend** (`/app/backend/forms.py`): templates CRUD, JSON import (dedupe by lowercase name), submissions create/list/get.
  - `GET/POST /api/forms/templates`, `GET/PATCH/DELETE /api/forms/templates/{id}`
  - `POST /api/forms/templates/import` (idempotent — re-running skips existing names)
  - `GET/POST /api/forms/templates/{id}/submissions`, `GET /api/forms/submissions/{id}`
  - Field types: text, textarea, date, number, select, radio, photo, signature, gps. The last three are stored null in Phase 1.
  - Write actions gated to `admin` / `hseq_lead`.
- **Frontend** (`/app/frontend/src/pages/Forms.jsx`): list + category filter + search, detail drawer, fill-out runner modal, import/export JSON. Route `/app/forms`.
- **Seeded**: 10 templates imported into Stephen's org from `/app/memory/forms_import.json` — Incident Report, Daily Site Inspection, Toolbox Talk, Near Miss Report, Equipment Pre-Use Checklist, Test Hot Work Permit, site-safety-checklist, Vehicle Pre-Use Inspection, Plant Pre-Start Checklist, Heavy Vehicle Daily Check. User can paste/upload the remaining 12 via the in-app Import modal.
- **Verified**: import (10 created), re-import dedupe (0 created / 10 skipped), submission create + list, UI screenshots clean.
- **Service worker**: bumped to `paneltec-v29` earlier in session.

## Backlog (Forms Phase 2/3)
- Phase 2: real photo capture, signature pad, GPS picker, PDF export of submissions, submissions list page per template.
- Phase 3: mobile mirror, worker assignment, scheduled reminders.


# 2026-06-27 — Forms Library Phase 2 (shipped)

## Backend
- **Real field types**: photo upload (multipart, `POST /api/forms/submissions/{id}/photos`), signature (base64 PNG inline on field value), GPS (`{lat, lng, accuracy, captured_at}` dict).
- **PDF generation**: `GET /api/forms/submissions/{id}/pdf` supports Bearer AND signed pdf-token (`POST /api/forms/submissions/pdf-token`). PDF embeds photos inline, signature as image, GPS as key-value block + Google Maps link. New `/app/backend/forms_pdf.py` reuses the brand frame from `pdf_renderer.py`.
- **Submission status**: `complete` vs `draft` computed from required-field coverage (photo/signature/GPS counted as filled when present).
- **Photo serving**: new public route `/api/files/form_photos/{submission_id}/{name}` added to `dashboard.py` for PDF embedding + `<img>` thumbnails.
- **Delete**: submitter OR admin/hseq_lead can soft-delete their own submission.
- Worker permissions verified via curl: list ✓, fill-out ✓, create template → 403, delete template → 403.

## Frontend
- **Forms.jsx (rewrite)**: real `PhotoField` (camera + file picker, multi-photo grid with previews), `SignatureField` (react-signature-canvas, responsive width, clear button), `GpsField` (browser geolocation + embedded Google Maps + lat/lng/accuracy). Mobile-responsive fill-out (sticky bottom submit bar, 44px+ tap targets, native keyboard hints).
- **FormSubmissions.jsx (new)**: route `/app/forms/templates/:templateId/submissions` — banner uses category pastel, table with Status / Photos / Signature / GPS columns, View / PDF / Delete actions, status & search filters, CSV export, mobile-card stack below md breakpoint.
- **SubmissionViewModal** (exported from Forms.jsx): read-only view with embedded photos / signature / GPS map snippet.
- **PDF popup**: opens in the existing shared `paneltec-pdf` window via the form-specific pdf-token endpoint (preserves ad-blocker bypass).
- Library: installed `react-signature-canvas`.

## Nav & Dashboard
- Sidebar (`AppShell.jsx`): added **Forms** entry under the **Capture** group (sky pastel, ClipboardList icon) — sits after Inspection Reports.
- Dashboard CAPTURE_GROUPS: added `forms` key to the "Capture & Records" group, plus styling maps (tile bg + sky icon pastel).
- `mocks/dashboard.js`: `CAPTURE_TOOLS` includes a Forms Library tile that routes to `/app/forms`.

## SW
- Bumped `CACHE_VERSION` to `paneltec-v30`.

## Verified
- Curl: photo upload (2 saved / 0 rejected), submission with text+sig+GPS+photo (status=draft because 11 other required fields unfilled, photo_count=2, has_signature/has_gps=True), PDF via Bearer (4741 bytes, `%PDF-1.4` magic ✓), PDF via pdf-token (same), list submissions (1 returned), worker 403 on create/delete.
- UI: dashboard with Forms tile + Forms in sidebar, mobile fill-out modal at 375×812 with signature drawn, GPS captured (lat/lng visible on Google Map), photo button visible. Submissions table page with sub status pill, Photos/Signature/GPS columns and PDF action.

## 22-template seed (complete)
- Imported full 22 templates into Stephen's org:
  - Part 1 (10): Incident Report, Daily Site Inspection, Toolbox Talk, Near Miss Report, Equipment Pre-Use Checklist, Test Hot Work Permit, site-safety-checklist, Vehicle Pre-Use Inspection, Plant Pre-Start Checklist, Heavy Vehicle Daily Check
  - Part 2 (12): JSEA, SWMS Sign-On, Toolbox Talk Attendance, Hot Work Permit, Confined Space Entry Permit, Working at Heights Permit, Excavation / Trench Permit, Drug & Alcohol Test Record, Site Sign-In / Visitor Register, End of Day Site Sign-Off, Crane Lift / Rigging Plan, Asbestos Awareness / Class B Removal
- Distribution: general:10, inspection:7, toolbox:2, incident:2, near_miss:1

## Phase 3 backlog
- Worker assignment + scheduled reminders on submissions
- Mobile mirror (Expo specialist — dedicated turn)
- Pin / favourite templates per-worker


# 2026-06-27 — Forms UI restyle (shipped)
- **Page header** rewritten to match user references: title "Form Templates" + subtitle + 4-button toolbar (Import Civil Library / Export All Forms / **Build with AI** purple-pink gradient / **+ New Template** orange-amber gradient) + search + categorical dropdown showing "All categories (N)".
- **Template cards** redesigned: pastel category pill (incident blush, inspection sky, toolbox butter, near_miss peach, general slate) on top-left + 3 action icons (Phone/Edit/Trash) on top-right (Edit/Trash hidden for non-admins). Big title, description, "N fields" subtitle + optional "X sent" pill + "AI draft" badge. 2-col grid bottom CTAs: Preview (white, blue border) + Fill This Form (dark navy).
- **Coloured Yes/No/N/A radio buttons** in the Fill-Out modal: Yes=emerald, No=rose, N/A=slate, Other=slate. Selected state filled with matching pastel + ring.
- **Submit button** is now orange-amber gradient with CheckCircle2 icon.
- **GPS captured indicator** banner at the top of the modal (mint pill) shows lat/lng once captured.
- **Preview modal (NEW)**: read-only view of all fields with disabled inputs, "Preview · {name}" title + PREVIEW badge, "Fill out this form" CTA at the bottom.
- **Build-with-AI (NEW)**: backend `POST /api/forms/templates/ai-generate` uses existing `_claude_json` helper (Claude Sonnet 4.5 via emergentintegrations). Prompt + category in, persisted template with source='ai' out. Validated AI generated a 19-field Daily Scaffold Inspection. Permission-gated: workers get 403.
- SW bumped to `paneltec-v31`.
- All 5 reference screenshots verified at 1440×900 + mobile at 375×812.

## Forms backlog
- Inline template editor (toolbar "+ New Template" + card pencil icon currently toast "coming soon"). Add a builder modal with field add/remove/reorder.
- `vehicle_reg` field type with Navixy integration (deferred per scope).


# 2026-06-27 — Forms Template Builder (shipped)

## TemplateBuilder modal (`/app/frontend/src/components/forms/TemplateBuilder.jsx`)
- Full-screen modal with header strip (name + category + description), two-column body, and footer.
- Three entry points wired in `Forms.jsx`:
  1) "+ New Template" toolbar (orange-amber) → empty builder
  2) Per-card pencil icon → builder pre-populated from existing template
  3) Build with AI → on success the AI draft opens directly in the builder for refinement
- Left column: drag-reorderable field list using `@dnd-kit/sortable` (`PointerSensor` 5px activation + `KeyboardSensor`). Each field card: drag handle, label, type dropdown (text/textarea/date/number/select/radio/photo/signature/gps), Required toggle, placeholder (text-likes only), options textarea (select/radio), trash.
- Right column: sticky Live Preview pane reusing the exported `FieldRunner` in `readOnly` mode — the admin sees exactly what the worker sees.
- Validation: name + category required, ≥1 field, each field has label, select/radio need ≥2 options. Inline error highlight + toast.
- Saves via existing `POST /api/forms/templates` (new) or `PATCH /api/forms/templates/{id}` (edit). Both endpoints are admin/hseq_lead-gated (curl-verified — worker POST/PATCH return 403).

## Wiring
- `Forms.jsx`: exports `FieldRunner`, `CATEGORIES`, `CAT_PILL`, `categoryLabel`. Adds `builderTemplate` state and renders `TemplateBuilder` when set. Reads `?builder=ai` query param to auto-open the AI builder modal (used by the dashboard tile).
- `Dashboard.jsx` + `mocks/dashboard.js`: new `generate-ai` tile with Sparkles icon, lavender pastel, routes to `/app/forms?builder=ai`. Added to CAPTURE_GROUPS "Capture & Records" row.
- SW bumped to `paneltec-v32`.

## Verified
- Curl: admin POST + PATCH ✓; worker POST 403 + PATCH 403; admin DELETE 204.
- UI screenshots (1440×900): empty builder with live preview (date + radio Yes/No/N/A both rendering in preview), edit builder populated from Vehicle Pre-Use Inspection (18 fields visible + live preview), Dashboard with Capture column header.
- Lint clean.


# 2026-06-28 — Supplier + Document Library folder edit/delete (shipped)
- **SupplierDrawer**: per-folder card now has hover-revealed Pencil (rename) + Trash (delete) icons (admin/hseq_lead only). New `FolderCard` component supports inline rename (text input replaces the card, Enter saves / Esc cancels, blur also saves) and confirm-dialog delete with a warning when the folder has files. Calls `PATCH /api/document-library/folders/{id}` and `DELETE /api/document-library/folders/{id}` (existing endpoints — cascade soft-deletes files in `delete_folder`).
- **FolderFiles header**: same rename + delete affordances next to the folder title when an admin opens a folder to view its files. Delete returns the user to the folder list and refreshes counts.
- **DocumentLibrary subfolder cards** (per-worker Cert subfolders + any nested folders): hover-revealed rename + delete on each subfolder tile via new `SubfolderCard` component, mirroring the supplier pattern. Both fall back to the existing PATCH/DELETE endpoints, preserving the cascade-soft-delete-files behaviour.
- Worker role gets `403` on PATCH/DELETE per backend; UI hides the icons for non-admins so workers never see the affordance.
- SW bumped to `paneltec-v33`.

## Verified (this turn)
- Curl: create supplier folder (201), PATCH rename (200), upload file (1 saved), DELETE folder (204 cascade), list-after-delete (404), worker PATCH 403, worker DELETE 403.
- UI screenshots: default supplier folders panel, hover-revealed pencil+trash, inline rename input with helper text. The FolderFiles header rename/delete is wired but wasn't separately screenshotted (the existing folder selector changed when rename mode swapped the open button).


# 2026-06-28 — Renewal Links: edit + role gating (shipped)
- **Backend `renewals.py`**:
  - New `PATCH /api/renewals/{id}` — admin/hseq_lead only. Editable fields: contractor_id, doc_types_requested, subject, message, expires_at. **Public token is preserved** so the contractor's existing link keeps working. Rejects edits on `used` submissions (409). If `expires_at` is extended past now and the link was `expired`, it auto-flips back to `pending`.
  - Added `subject` + `message` fields to `RenewalCreate` and the persisted document (used as the default email subject/body when re-emailing the link).
  - Role gate (`admin` + `hseq_lead`) added to `POST /` (create), `POST /{id}/revoke`, `DELETE /{id}`. Workers get 403.
  - DELETE now also flips status to `revoked` alongside the soft-delete, so any cached token immediately stops working at the public endpoint.
- **Frontend `Renewals.jsx`** rewrite:
  - New `EditRenewalDialog` invoked by a Pencil icon on every editable row (admin/hseq_lead only). Lets the admin change contractor, subject/title, doc types, custom message, and expiry date. PATCHes the link and refreshes the table.
  - Table columns updated: "Subject / Docs" replaces "Docs requested" (subject bold, docs underneath).
  - Create modal also gains Subject + Custom message fields.
  - Non-admin/HSEQ users no longer see Create / Edit / Revoke / Delete buttons (UI gate matches backend).
- **SW** bumped to `paneltec-v34`.

## Verified
- Curl: admin PATCH (subject/message/doc_types/expires_at) returns 200 with new fields + unchanged token; worker PATCH 403; worker DELETE 403; worker revoke 403; admin DELETE 200 cleanup.
- UI screenshots: renewals table with new Subject/Docs column + pencil/trash icons; edit modal open with all 5 editable fields populated.


# 2026-06-28 — Renewal Doc Types: admin-managed registry (shipped)

## Backend (`renewals.py`)
- New collection `renewal_doc_types`: `{id, org_id, label, slug, description, active, sort_order, created_at, updated_at, deleted_at}`.
- New endpoints (admin/hseq_lead writes; org reads):
  - `GET    /api/renewals/doc-types` — seeds 6 standard types on first hit per org, then backfills any legacy slugs found in existing renewals.
  - `POST   /api/renewals/doc-types`   `{label, description?}` — auto-slugifies label, auto-increments sort_order +10.
  - `PATCH  /api/renewals/doc-types/{id}`  `{label?, description?, active?, sort_order?}`.
  - `DELETE /api/renewals/doc-types/{id}` — soft-delete; **blocks with 409** if any pending non-deleted renewal still references the slug, with a clear message.
- Standard seed (in order, sort 10–60): **Public liability** (`public_liability`), **Workers comp** (`workers_comp`), **White card** (`white_card`), **SafeWork licence** (`safework_licence`), **Induction** (`induction`), **Other** (`other`) — matches the existing hardcoded checkboxes.
- **Legacy backfill**: on seed, scans `renewal_links.doc_types_requested` for slugs not yet in the registry and creates active entries (label = `slug.title().replace("_"," ")`, description = "Legacy doc type — auto-imported…"). Existing data continues working seamlessly.
- One-time DB cleanup: removed the earlier (wrong) seeds `insurance/licence/whs_policy` from Stephen's org because nothing referenced them.

## Frontend (`Renewals.jsx`)
- New toolbar button **"⚙️ Manage doc types"** (admin/hseq_lead only) opens `ManageDocTypesDialog`.
- Modal rows: editable Label, optional Description, `active` toggle, **Save** per-row (only enabled when dirty), Trash icon. Bottom card to "Add a new doc type" with Label + optional Description + Add button.
- Create + Edit Renewal modals now load checkboxes from `GET /api/renewals/doc-types` (only `active=true`). Both refresh whenever doc types change.
- Renewal table now renders the slug chips using the live label map; **unknown/legacy slugs render with an amber HelpCircle icon** so admins can spot legacy data.
- Edit modal also exposes any legacy slug on the current record as a checkable (amber-styled) chip so the admin can keep or drop it.
- SW bumped to `paneltec-v35`.

## Verified
- Curl: GET seed (4 → 6 after update), POST custom (`Public Liability` → slug `public_liability`, sort=50), PATCH label + sort, DELETE blocked **409** when 2 pending links still reference the slug; admin DELETE 200 after revoke, worker POST/PATCH/DELETE all **403**.
- UI: Manage modal showing 6 seeds + the newly-added "Trade Licence"; Create modal showing all 7 active types as live checkboxes including the brand-new "Trade Licence" — proving the registry is genuinely dynamic.


# 2026-06-28 — Forms field type: `vehicle_navixy` (shipped)

## Backend
- `forms.py`: added `vehicle_navixy` to `ALLOWED_FIELD_TYPES`.
- `forms.py`: new `GET /api/forms/fleet/vehicles` — thin proxy to `integrations.navixy_vehicles`, accessible to **any authenticated org user** (so workers can fill vehicle forms even though `/integrations/navixy/*` is admin-gated).
- `forms_pdf.py`: vehicle_navixy fields render as "Vehicle: {label} · {registration}".
- Submission storage: value is a structured dict `{ navixy_id, label, registration }`. `navixy_id=null` indicates manual entry.

## Frontend
- `Forms.jsx`: new `VehicleNavixyField` component with:
  - "From fleet" / "Other (manual entry)" toggle (44px min targets).
  - Live search of the org's Navixy fleet (filtered by label or rego).
  - Selected chip with truck icon, label, rego, and ✕ to clear.
  - Read-only render (used by Preview + SubmissionViewModal).
- `TemplateBuilder.jsx`: added "Vehicle (Navixy)" to the field-type dropdown.

## Seeded templates upgraded
- ✅ **Heavy Vehicle Daily Check** · f2 "Vehicle Rego" → `vehicle_navixy`
- ✅ **Vehicle Pre-Use Inspection** · f2 "Vehicle Registration" → `vehicle_navixy`
- ✅ **Plant Pre-Start Checklist (Heavy Equipment)** · f4 "Plant Serial / Fleet #" → `vehicle_navixy`

## SW bumped to `paneltec-v36`.

## Verified
- Curl: GET /forms/fleet/vehicles returns 72 vehicles for Stephen's org; POST submission with structured vehicle value; GET submission round-trip preserves dict; PDF renders OK (2.8KB %PDF-1.4); worker DELETE/PATCH on template 403; worker on a non-Navixy org gets 400 "Navixy not connected" (correct).
- UI screenshots: Vehicle dropdown populated with live fleet, search filter ("Indus" → 1 result), selected chip with rego, plus coloured Yes/No radios + other field types intact.

## 2026-06-28 — Phase 3.5: Navixy meter ingestion (Engine hours + Odometer)

**What shipped:**
- New module `asset_navixy_sync.py` — pulls per-tracker counter readings via `POST /v2/tracker/counter/read` (per-type) and falls back to `POST /v2/tracker/get_states`. Writes `hours_meter`, `hours_meter_updated_at`, `hours_meter_source="navixy"`, `odo_km`, `odo_km_updated_at`, `odo_km_source="navixy"` and recomputes every active service schedule on each updated asset.
- APScheduler 3.11 added; `sync_navixy_counters` runs every 15 min and once on app startup.
- `POST /api/assets/navixy/sync-counters` (admin-only) — on-demand trigger.
- `POST /api/assets/{id}/records` — meter_update on a Navixy-linked asset returns **422** with "Edit in Navixy" hint when the value disagrees with the current Navixy reading. `POST /api/assets/{id}/meter/reset` remains the admin override path.
- `_sanitize_public(asset)` and `GET /api/forms/assets/lookup` now carry `hours_meter_source/updated_at`, `odo_km_source/updated_at`.
- Frontend: new `LiveCountersPanel.jsx` — read-only mint-bordered cards with "Synced from Navixy · X min ago" for Navixy-linked vehicles/plant, editable inputs + Save buttons for manual assets, admin-only "Refresh now" link.
- Frontend: `ScheduleEditor` now shows a live helper line ("Currently 940.1 hrs → next due at 1,190.1 hrs") and a **"Service done today — set this as the baseline"** checkbox that snapshots the current meter/date into `last_done_value`/`last_done_at` on save.
- Service worker bumped `paneltec-v42 → paneltec-v43`.

**Upstream caveat (MOCKED baseline):** The connected Navixy account exposes counter *definitions* (`/v2/tracker/counter/read` returns `{id, type, multiplier}`) but not live counter *values* via its v2 API — the values shown in the Navixy panel come from server-side mileage/engine-hours reports. We seeded realistic counter baselines on all 72 Navixy-linked assets (deterministic random hours 420–2350 hrs / km 8,500–92,000) so the UI works end-to-end. The 15-min sync will start overwriting these with real readings the moment the upstream returns them. The sync response includes `note: "upstream_returned_no_counter_values"` when this happens. Marked `// MOCKED` at the seed location.

**Next:** Phase 4 — Worker / Supplier / Site induction QR (P1).

## 2026-06-28 — Phase 3.6: Navixy Live Dashboards + Mileage-via-tracks fallback

**Native dashboards (Ask A):**
- 3 new `GET /api/assets/navixy/dashboards/{fleet-status,trips,technical}` endpoints (server-cached 60 s per org).
- `FleetLiveDashboards.jsx` (Recharts) rendered above the asset list on Plant & Vehicles — collapsible (localStorage), three tabs, Refresh button, "Updated · X min ago" stamp.

**Provider chain (Ask B):** `panel → report → tracks → none` in `asset_navixy_sync.py`.
- New helpers `_fetch_counters_via_report` (Navixy `/v2/report/build → get_state → list_view`) and `_fetch_counters_via_tracks` (sums `/v2/track/list` length + duration over a rolling 90-day window — tagged `navixy_tracks_window`).
- `_sync_org` splits assets into cold (no source yet) vs warm; only cold ones go through the heavy chain. Bounded concurrency: `sem=8` for counter/read, `sem=4` for tracks. 10-device cap per cron tick on the report path.
- Sync response now returns `{updated, skipped, devices, cold, warm, source_breakdown:{panel,report,tracks,none,already_current}, note}`.

**Service worker:** `paneltec-v43 → paneltec-v44`.

**Next:** Phase 3.7 — Simpro + Workers picker fields in form templates (queued, do NOT start in parallel).

---

## 2026-06-28 — Phase 3.8 (QR scan → form launcher) + Phase 3.9 (My forms preference filter)

### Phase 3.8 — QR scan as form launcher (SHIPPED)
- `GET /api/scan/{scan_token}/forms` (auth) — returns asset card + curated form list with `recommended` flags based on `kind`/`asset_type`. Heavy-vehicle types (vacuum_truck, tipper, dump_truck, semi_trailer, crane_truck, service_truck) get Heavy Vehicle Daily Check pinned alongside Vehicle Pre-Use Inspection.
- `POST /api/scan/quick-action` extended with `action: "open_form"` + `payload: {template_id}` — pre-flight access check before client navigates.
- Form submissions stamped with `launched_via: "scan"`, `source_scan_token`, `source_asset_id` when launched from a QR.
- `ScanResolver.jsx` redesigned: Asset card → Forms grid (3-col, recommended border + badge) → demoted Maintenance disclosure. Legacy `?form=` deep-link still honoured.
- `Forms.jsx` deep-link pre-fills date/asset_scan + auto-captures GPS + defaults worker_picker to logged-in user by email match.
- Test report: `/app/test_reports/iteration_15.json` 13/13 PASS.

### Phase 3.9 — My forms preference filter (SHIPPED)
- `db.user_form_preferences` keyed by `user_id`+`org_id`. Empty `enabled_template_ids` is a sentinel for "all enabled" (no foot-gun).
- Endpoints under `/api/users/`:
  - `GET /me/form-preferences` — seeds with all org templates on first call.
  - `PUT /me/form-preferences {enabled_template_ids, device_only}` — `device_only:true` is server no-op.
  - `GET /{user_id}/form-preferences` — admin/manager/hseq_lead can read other users.
  - `PUT /{user_id}/form-preferences` — admin only.
- `permissions_middleware.SKIP_PATHS` extended with `^/api/users/(me|[^/]+)/form-preferences$` so the worker role (no `users.view`) can reach its own settings. Handler-level RBAC still enforces other-user access.
- `GET /api/scan/{token}/forms` now intersects with the user's whitelist on top of the asset-type filter; returns `applied_preferences: true|false`. Empty intersection falls back to unfiltered list. `?include_disabled=true` query bypasses the filter (used when client has localStorage device override).
- `FormPreferencesDialog` (`/app/frontend/src/components/forms/FormPreferencesDialog.jsx`) — modal with grouped checkboxes by category, "Use these settings on this device only" toggle, "Reset to defaults" link, admin can pass `targetUser` to edit another user.
- `formPrefs.js` (`/app/frontend/src/lib/`) — localStorage helpers + client-side filterByPrefs.
- Gear icons: top-right of Forms section on `/scan/:token` + right side of `/app/forms` toolbar. Workers drawer (`/app/workers` EditModal) gets a new "Forms" Section showing read-only count + admin Edit button.
- Test report: `/app/test_reports/iteration_17.json` 14/14 + 13/13 regression PASS.

### Pre-flight checklist (mandatory before claiming done)
- `python -m py_compile $(find /app/backend -maxdepth 2 -name "*.py")` clean
- `cd /app/frontend && yarn build` 0 errors (warnings only)
- `curl /api/health` 200, login 200, 30s err-log clean
- `CACHE_VERSION` bumped — currently `paneltec-v55`

### Test credentials (unchanged)
- Admin: `stephen@paneltec.com.au` / `Mcgstephen50#` (id=808cb7de-985a-4c49-8554-9c67e5e86313)
- Worker: `worker_stephen@paneltec.com.au` / `WorkerTest123!` (id=21dddcc2-e184-47f7-bac6-9b128925b8df)

### Next up
- **Phase 4** — Worker / Supplier / Site induction QR (P1)
- Phase 5 — UHF reader integration (P2)
- Per-trade auto-tick for form preferences (P2 — was deferred from 3.9)
- Bulk "Scan reminders now" toolbar button (P2)

---
## 2026-06-28 · Phase 3.10 + 3.11 ship summary

### Phase 3.10 — Iframe PDF block fix (Chrome) [VERIFIED]
- `file_pdf.py` stamps `Content-Security-Policy: frame-ancestors 'self' https://*.emergentagent.com https://*.preview.emergentagent.com` + `X-Frame-Options: SAMEORIGIN` on every PDF response.
- `POST /api/files/{id}/preview-token` mints HMAC-SHA256 signed token (`f` claim = file_id, `u` claim = user_id, `exp` claim, 300 s TTL). Cross-file reuse → 401, tamper → 401.
- `PdfPreviewModal.jsx` uses `?t=` token + 6 s watchdog fallback.
- Verified: 200 / correct CSP / token-bound (all curl receipts + screenshot).

### Phase 3.11 — Live Inductions Matrix [SHIPPED]
- Backend `workers_inductions.py`:
  - `parse_messy_date` lenient parser (high / medium / low / unparseable). Skip-and-flag honoured: low / unparseable cells NEVER written.
  - 5 endpoints: `POST /import-xlsx`, `POST /import-xlsx/commit`, `GET /matrix`, `PUT /cell`, `GET /export.xlsx`.
  - New collection: `worker_access`. `worker_certifications` extended with `category`, `column_key`, `not_held`, `held_no_expiry`, `source`, `import_confidence`.
  - RBAC: admin/manager/hseq_lead on writes; matrix-read open to all authed.
  - Unit tests: `/app/backend/tests/test_induction_date_parser.py` — 10/10 passing.
- Frontend:
  - `InductionsMatrix.jsx` — sticky wide table with status chips, inline cell editor, search/refresh/export.
  - `InductionImportWizard.jsx` — 3-step preview → commit flow with skip-and-flag callout.
  - `WorkerInductionsCard.jsx` — per-worker induction snapshot for the worker drawer.
  - `Workers.jsx` — tab switcher (Directory / Inductions Matrix) + induction-status chip on directory row.
  - SW bump → `paneltec-v64`.

### Deferred to Phase 3.12
- Date-parser label-whitelist expansion (`MR ` / `HR ` prefixes need to match real Employee-Inductions.xlsx).
- Bulk-cell paste / undo on matrix cells.

### Phase Turn 4 — SWMS UI deferrals (partial)
- **SHIPPED**: Rich SwmsDetail (codes, equipment, emergency procedures, applies-to block), split-button download (Civil PDF + Original document), version-chain banners (`superseded_by` / `supersedes` aware with cross-version links). SW bumped → `paneltec-v65`. yarn build clean.
- **DEFERRED to next session (Turn 4 follow-up)**:
  - `/app/settings/swms-assignments` admin two-pane page (mirror Form Assignments layout).
  - Re-import commit logic in `swms_extras.py` that auto-chains `supersedes`/`superseded_by` when a new version of the same `code` is committed.

### Phase Turn 5 — Site Induction QR · DEFERRED to next session
Scope unchanged from spec: sites collection cleanup (`scan_token`, `nfc_uid`, `induction_form_template_id`, `gps_geofence`), public `GET /api/scan/site/{token}` resolver, JWT-gated `POST /api/scan/site/{token}/sign-on`, Site QR PDF (gate sign + Avery sheet), `SiteScanResolver.jsx` route, admin "Print site QR" on Sites admin page.

### Phase Turn 6 — Supplier Induction QR · DEFERRED to next session
Scope unchanged from spec: suppliers extension (`scan_token`, induction packet, prequalification form with insurance upload + cert tick boxes), public `/scan/supplier/{token}` resolver, Supplier QR PDF (vCard + QR for first-email send).

## 2026-02 — Inductions Matrix inline PDF preview (Phase 3.11i)
- Backend `POST /api/workers/inductions/print` now accepts `mode: "download"|"inline"` (default `"download"`); sets `Content-Disposition` accordingly.
- `PdfPreviewModal` accepts a `blobUrl` prop (skips signed-token flow + watchdog).
- `InductionsMatrix` now exposes a Preview button **alongside** Print:
  - Toolbar: `[data-testid=matrix-preview]` next to `[data-testid=matrix-print]`
  - Pinned-worker chip: `[data-testid=matrix-pinned-preview]` next to `[data-testid=matrix-pinned-print]`
  - Popover footer: `[data-testid=preview-confirm]` next to `[data-testid=print-confirm]`
- Verified: curl `mode:inline` → `Content-Disposition: inline`; no-mode → `attachment`; worker-token → `403`.
- Service worker cache bumped to `paneltec-v76`.

## 2026-02 — Phase 3.12: Induction Card Popup (detail + doc preview + edit + add)
- **Backend**: 5 new endpoints on `card_router` registered in `server.py`:
  - `GET    /api/workers/{wid}/inductions/{iid}`     — full record (admin/manager/HSEQ or worker matched by email)
  - `PATCH  /api/workers/{wid}/inductions/{iid}`     — issuer/dates/notes/not_held/held_no_expiry; status_override admin-only
  - `POST   /api/workers/{wid}/inductions`           — create new record for "Not held" slots; dup column_key → 409
  - `POST   /api/workers/{wid}/inductions/{iid}/file` — multipart upload, reuses Document Library smart-folder routing
  - `DELETE /api/workers/{wid}/inductions/{iid}`     — admin-only, soft delete
  - Cross-worker requests → 404 (no existence leak); worker-token writes → 403
- **Frontend**: new `InductionCardModal.jsx` two-pane modal (detail left / iframe doc preview + dropzone right) wired into both:
  - `WorkerInductionsCard.jsx` (every card in the worker edit drawer is now a button)
  - `InductionsMatrix.jsx` (every cell — including empty ones — opens the same modal; CellEditor retired in favour)
- **Cache**: `paneltec-v77`.
- **Verification**: All 7 curl receipts pass (GET admin/worker-own, PATCH status recompute, POST create, POST file 201, worker token 403 on write, cross-worker 404, DELETE 204 + GET 404). 4 screenshots show view→edit→add modes from both entry points.

## Queued (do not interleave)
- **Phase 3.13** — LibreOffice swap as primary DOCX/XLSX/PPTX→PDF path with Python fallback; Tesseract/Poppler OCR utility; `/api/admin/server-tools/health` endpoint.
- **Phase 3.14** — Simpro Suppliers Import for Renewal Links: `sync_simpro_suppliers()`, `POST /api/integrations/simpro/sync-suppliers`, `POST /api/contractors/import-from-simpro`, `SimproSupplierImportModal.jsx`.

## 2026-02 — Phase 3.13: LibreOffice swap + Tesseract OCR + server-tools/health
- **Backend** (`file_pdf.py`):
  - `_libreoffice_to_pdf(src, out_dir, timeout=60)` helper using `soffice --headless --convert-to pdf` with per-call `-env:UserInstallation` profile to avoid lockfile contention.
  - `_office_to_pdf_via_lo(blob, ext, name)` wrapper.
  - `_docx_to_pdf()` now tries LibreOffice → docx2pdf (legacy) → pragmatic ReportLab text fallback (chain logged at INFO).
  - New pipelines registered: `docx_libreoffice`, `xlsx_libreoffice`, `pptx_libreoffice`, `odt_libreoffice`, `rtf_libreoffice`. xlsx/pptx/odt/rtf raise HTTP 415 on LO failure (no text fallback — by design).
  - `ocr_pdf_to_text(pdf_path, lang='eng')` util: tries `pdftotext` first, falls back to `pdftoppm` + `tesseract`. Opt-in only; not wired to upload path.
  - `GET /api/admin/server-tools/health` (admin) — returns `{libreoffice:{ok,version,path}, tesseract:{...}, poppler:{...}}`. Legacy `/admin/system-tools` retained for back-compat.
  - Env override `PANELTEC_LIBREOFFICE_BIN` for fault-testing — set to a missing path and the fallback chain kicks in cleanly.
- **Frontend**: `SystemSettings.jsx` now hits `/admin/server-tools/health` (normalises to `{installed, version, path}` for the existing ToolCard component, zero downstream refactor).
- **Cache**: `paneltec-v78`.

### Receipts (all green)
- `GET /api/admin/server-tools/health` admin → 200 `{libreoffice:{ok:true,version:"LibreOffice 7.4.7.2 …"}, tesseract:{ok:true,version:"tesseract 5.3.0"}, poppler:{ok:true,version:"pdftotext version 22.12.0"}}`. Worker token → 403.
- DOCX upload → `GET /api/files/{id}/pdf` → `x-pipeline: docx_libreoffice`, 7023 bytes, `%PDF` magic.
- XLSX upload → `GET /api/files/{id}/pdf` → `x-pipeline: xlsx_libreoffice`, 5948 bytes, `%PDF` magic.
- Force-failure (`PANELTEC_LIBREOFFICE_BIN=/nonexistent/soffice`): `_docx_to_pdf()` falls through to `docx_text_fallback`, returns valid 1.9 KB PDF, no 500. INFO log shows the cascade reasons.
- OCR util on the LibreOffice-generated PDF extracts 332 chars cleanly (paragraph + table + bold/italic text all surface).

### Incidental fix shipped in this phase
- `models.py` Role Literal was missing `"manager"`, causing 500s on `/auth/login` for any manager-role user. Patched the Literal; unblocks manager-class flows everywhere.

## Queued (do not interleave)
- **Phase 3.14** — Simpro Suppliers Import for Renewal Links.
- **Phase 3.15** — Navixy Health Dot on Asset Location Pin.
- **Phase 3.16** — Session Timeout Settings (Admin-Configurable).
- **Phase 3.17** — Certifications row actions (PDF Preview / Edit / Delete).

## 2026-02 — Phase 3.12 patches (post-tester feedback)
- **Frontend** (`InductionCardModal.jsx`): root `<div>` now emits `data-testid="induction-add-mode"` when `mode==='add'` (was only `data-mode="add"`); falls back to `induction-card-modal` test-id for view/edit modes. Playwright/QA hooks now match.
- **Backend** (`workers_inductions.py::get_induction`): when `role=="worker"` and `_can_read_own()` returns false, we now return `404 "Induction not found"` instead of `403 "Permission denied"` so we don't leak existence of records belonging to other workers. Non-worker roles without read access still get 403 (legitimate internal-user case).
- **Cache**: `paneltec-v78.1`.
- **Verification**: worker probing other worker's induction → HTTP 404 `{"detail":"Induction not found"}`; admin GET still 200. Screenshot shows add-mode rendered correctly with name hint pre-filled.

## 2026-02 — Phase 3.14: Simpro Suppliers Import for Renewal Links + Auto-OCR
### Backend
- `simpro_suppliers` collection: upsert on `(org_id, simpro_vendor_id)`. Holds normalised vendor identity + contact (no financial data).
- `sync_simpro_suppliers(org_id)` — idempotent. Pulls vendors via existing `_refresh_suppliers_cache()` and persists.
- `POST /api/integrations/simpro/sync-suppliers` (admin) → `{imported, updated, skipped, errors, fetched, synced_at}`.
- `GET /api/integrations/simpro/suppliers/cached?search=&limit=&include_archived=` (admin/manager/hseq) — returns the mirrored list with `imported_contractor_id` already cross-joined from the contractors collection.
- `POST /api/contractors/import-from-simpro` (admin/manager) body `{vendor_ids:[…]}` — idempotent. Creates a contractor if none exists, otherwise updates. Backlinks `last_imported_at` on the supplier row.
- `contractors` schema gains `simpro_vendor_id`, `simpro_company_id`, `imported_from="simpro"`, `imported_at`, `needs_email` fields.
- APScheduler job `simpro_sync_suppliers` registered at 12h cadence.
### Auto-OCR add (smart enhancement)
- `_ocr_index_file(file_id, pdf_path)` background task fires after every `GET /files/{id}/pdf`. Idempotent (skips if `search_text` already set or file >50MB).
- `GET /api/admin/files/{id}/search-text` (admin) for debug.
- INFO log shape: `ocr indexed file=X chars=N` / `ocr skipped file=X reason=already_indexed`.
### Frontend
- `SimproSupplierImportModal.jsx`: virtualised checkbox list, search, "Refresh from Simpro" (admin only), "✓ Imported" badges on already-promoted rows (checkbox disabled), Import-N-suppliers confirm button.
- `Renewals.jsx`: "Import from Simpro" toolbar button next to existing "Manage doc types" / "+ Create renewal link". Wires modal.
- `Contractors.jsx`: small orange "Simpro" chip next to contractor name when `simpro_vendor_id` set; amber "needs email" chip when `needs_email=true`.
### Cache: `paneltec-v79`.

### Receipts (all green)
- `POST /sync-suppliers` admin → 200, imported 250 vendors.
- `POST /sync-suppliers` worker → 403.
- `GET /suppliers/cached?limit=3` admin → 200 with rows, supplier 145/161 already linked to contractors.
- `GET /suppliers/cached` worker → 403.
- `POST /contractors/import-from-simpro` 3 vendor_ids → `{created:2, updated:0, skipped:1}` (1 not in cache). Re-run → `{created:0, updated:2, skipped:1}` (idempotent).
- `GET /files/{id}/pdf` → OCR background task fires; `GET /admin/files/{id}/search-text` returns `status=indexed, chars=332` with extracted text. Re-fetch logs `ocr skipped … already_indexed`.
- APScheduler boot log: `APScheduler job registered — simpro_sync_suppliers every 12 h`.
- Screenshot: Renewals page shows 3 toolbar buttons including new "Import from Simpro"; modal renders with 250 vendors, search, Refresh button, ✓ Imported badges, "IMPORT N SUPPLIERS" confirm button.

## Queued (no interleave)
- **Phase 3.15** — Navixy Health Dot on Asset Location Pin
- **Phase 3.16** — Session Timeout Settings (Admin-Configurable)
- **Phase 3.17** — Certifications row actions (View / Edit / Delete)
- **Phase 3.18** — Granular Per-User Permissions System
- **Phase 4.1 / 4.2 / 4.3** — SWMS Assignments + Site/Supplier Induction QR
- Mobile mirror via e1_expo_frontend_dev

## 2026-02 — Phase 3.15: Navixy Health Dot on Asset Location Pin
### Backend (`assets.py`)
- Module constant `NAVIXY_FRESH_THRESHOLD_HOURS = 24`.
- `_navixy_last_seen_at(asset)` — canonical timestamp = max(hours_meter_updated_at, odo_km_updated_at, navixy_last_seen_at).
- `_compute_navixy_health(asset)` → "green" (linked AND ≤24h fresh) | "red" (linked AND stale/no data) | None (not linked).
- `_internal()` enriches every asset on its way out with `navixy_health` + `navixy_last_seen_at`.
- `GET /api/assets` list rows now go through `_internal()` (was raw before).
- **Zero live Navixy calls per render** — reads from cached sync fields only.

### Frontend
- `PlantVehicles.jsx`: location-pin button now renders for any asset with `navixy_device_id` (even without a fix — button disabled, but the dot is still visible). 8px circle dot overlay (`absolute bottom-1 right-1 w-2 h-2 rounded-full ring-2 ring-white`) coloured `bg-emerald-500` / `bg-rose-500` per health. Hover tooltip uses `formatDistanceToNow` from `date-fns`:
  - green → "Navixy live · last seen 12 min ago"
  - red → "Navixy offline · last seen 3 days ago" (or "Navixy offline · never reported")
  - `data-testid="asset-navixy-health-{asset_id}"` with `data-health="green|red"`.
- `FleetMap`: counter strip ("● N live · ● N offline") for visual parity since Google Maps embed is single-iframe (cannot recolour per-marker). `data-testid="fleet-map-health-green|red"`.

### Cache: `paneltec-v80`

### Receipts (all green)
```
GET /api/assets → every Navixy-linked asset has `navixy_health` + `navixy_last_seen_at`.
  Forced green: 200 Tipper - H41DH (device=10307569, seen=now)   → health=green
  Forced red:   200 Tipper - H89MY (device=10307562, seen=48h ago) → health=red
  Null:         CAT 320 Excavator (Yard) (no device id)            → health=None
Screenshot: list shows green dot on 200 Tipper - H41DH row, red dots on stale rows.
Map view counter strip reads "1 live · 71 offline" matching Mongo state.
yarn build clean; backend reload clean.
```

## Queued (no interleave)
- **Phase 3.16** — Session Timeout Settings (Admin-Configurable)
- **Phase 3.17** — Certifications row actions (View / Edit / Delete)
- **Phase 3.18** — Granular Per-User Permissions System
- **Phase 4.1/4.2/4.3** — SWMS Assignments + Site/Supplier Induction QR
- Mobile mirror via e1_expo_frontend_dev

## 2026-02 — Phase 3.15 cosmetic patch + smart enhancement
- **Map counter strip text**: now reads literal `● {N} live · ● {M} offline` (text glyphs + middle-dot separator) so screenreaders + automation pick up the same signal as sighted users. CSS dots remain for visual polish.
- **Plant & Vehicles header gains an "ignition check" pill** (`[data-testid="ignition-check-pill"]`) — count of red-health assets surfaced as a rose-coloured pill next to the List/Map toggle. Hidden when count is zero. Click switches to List view and clears the search (filtering wiring deferred to a follow-up phase via the `plantvehicles.filter-red` CustomEvent).
- **Cache**: `paneltec-v80.1`.

## Phase 3.16 — DEFERRED to next handoff
Reason: Session Timeout Settings touches every protected request via new middleware (5 endpoints, Mongo TTL `active_sessions` collection, idle-watch hook on every page, warning modal, login-page Remember-Me toggle). With <70k tokens remaining in this context, shipping the auth-touching middleware without sufficient room to test the negative paths (idle expiry returning 401, force-logout-all invalidation, fallback to defaults when org_settings missing) is too risky. Asked user to green-light a fresh context for 3.16.

## 2026-02 — Phase 3.16: Session Timeout Settings (shipped backend + hook + modal; Settings UI card + login Remember-Me deferred)
### Backend
- `session_timeout.py` new module — `get_settings`, `effective_for_user`, REST + helpers.
- `session_timeout_settings` Mongo collection (singleton per org). Missing doc → DEFAULTS (no migration needed).
- `active_sessions` Mongo collection — `{jti, user_id, org_id, role, remember_me, last_activity_at, created_at}`.
- Endpoints:
  - `GET  /api/admin/settings/session-timeout` (admin) → full config
  - `PUT  /api/admin/settings/session-timeout` (admin) → with validators `idle_minutes>=5`, `absolute_hours>=1`, `warning_seconds 10-300`
  - `POST /api/admin/settings/force-logout-all` (admin) → bumps `users.token_version` org-wide + wipes `active_sessions`
  - `GET  /api/settings/session-timeout/me` (any authed) → effective tuple for the user's role
  - `GET  /api/settings/login-options` (public) → `{remember_me_enabled}`
- `auth.py::create_access_token` now accepts `jti` + `absolute_hours` override; embeds per-role lifetime.
- `auth.py::login` mints jti, sets per-role exp, calls `register_session()`. Honours `remember_me` (30-day idle override) only when org settings allow.
- `auth.py::get_current_user` calls `touch_and_check_session(jti, user)` inline (no separate middleware); raises 401 `session_idle_timeout` when stale; fails open on db errors so a Mongo blip never takes auth down.

### Frontend
- New hook `hooks/useSessionTimeout.js` — fetches `/me`, listens for activity, debounced 30s server bumps via `/auth/me`, fires `onWarn` then `onLogout`.
- New `components/SessionWarningModal.jsx` — 60s live countdown, "Stay logged in" / "Log out now" buttons, test-ids per spec.
- Mounted in `AppShell.jsx` — only active inside `/app/**` (public routes never see the hook).
- Cache → `paneltec-v81`.

### Receipts (all green)
```
GET  /admin/settings/session-timeout admin → 200 with defaults
GET  /admin/settings/session-timeout worker → 403
PUT  idle_timeout_minutes=30 admin → 200, re-GET shows 30
GET  /settings/session-timeout/me admin  → {idle_minutes:30, absolute_hours:8}
GET  /settings/session-timeout/me worker → {idle_minutes:240, absolute_hours:24}
JWT admin lifetime = 8h, worker = 24h (per-role exp confirmed)
Idle simulation: pushed last_activity_at to 2h ago for admin's session →
  GET /auth/me → 401 {"detail":"session_idle_timeout"}
POST /admin/settings/force-logout-all admin → 200 {users_revoked:6, sessions_wiped:5}
  → re-using old admin token → 401 {"detail":"Token revoked"}
GET  /settings/login-options (pre-auth) → 200 {remember_me_enabled:false}
  After PUT remember_me_enabled=true → public GET reflects true
yarn build clean; backend reload clean; existing logged-in admin session uninterrupted
```

### Deferred to a tiny follow-up (the safe cut)
- **Settings → Session Timeout admin card UI** (dropdowns/toggles wired to the endpoints) — backend is ready, just the form to drive it.
- **Login page "Keep me logged in" checkbox** — endpoint returns `remember_me_enabled` correctly; just needs the checkbox UI + plumbing of the flag in the login POST body (the backend already honours `remember_me` if present).
Both are pure UI on top of fully-tested endpoints — happy to land them in a quick next-turn after a green light.
