# v58.13.132cf — Ad-hoc Job Assignments overhaul · SHIPPED (finish-deferred)

## Ship rules honoured
- `testing_agent` — NOT invoked.
- `e1_tester` — NOT invoked.
- `finish` tool — NOT invoked. Finish-deferred per standing directive.
- `/app/mobile/` + `metro.config.js` — untouched.
- LLM calls use the real Emergent LLM key via `emergentintegrations.llm.chat.LlmChat` (no mocks).
- No hard deletes. Pre-.132cf assignment rows would still enrich cleanly via the legacy JOIN fallback in `admin_list_assignments` (0 rows in prod so effectively a no-op).
- The PDF-storage path uses **Mongo GridFS** (`bucket_name="job_pdfs"`), NOT the pod filesystem — so this ship adds ZERO new `ephemeral-upload-storage` warnings on top of the 20 already parked for v58.14.x.

## Scope
Stephen approved the entire `.132cf` brief. Every point below is shipped and pinned by pytest.

### 1. Page rename
- Page title `Assign Daily Jobs` → **`Ad-hoc Job Assignments`**. Subtitle unchanged.
- Sidebar entry label → **`Ad-hoc Jobs`** (testid `nav-assign-daily-jobs` preserved).

### 2. Worker picker (backend)
- Source flipped from `db.workers` → `db.users` because workers has no `role_id` (73/73 rows null) whereas users carry the authoritative `role_id` from the .132be standard-matrix seed.
- Server-side filter: `role_id ∈ {paneltec_civil, viatec_traffic, external_contractor}`. `admin` (office staff) is explicitly excluded.
- Query param `role_id=<one of target>` narrows further from the client-side chips.
- Response now surfaces `role_id` on every row so the FE can render the coloured chip.
- Paneltec org live count: **65 rows** (36 paneltec_civil + 28 viatec_traffic + 1 external_contractor — admin 15 excluded).

### 3. Date field
- Bare `<input type="date">` retired.
- Replaced with shadcn `<Calendar>` inside a `<Popover>` (from `frontend/src/components/ui/{calendar,popover}.jsx`).
- Adjacent `←` / `→` icon buttons jump ±1 day (`data-testid="date-prev-btn"`, `date-next-btn"`).
- `Today` button (`data-testid="date-today-btn"`) snaps back to `sydneyTodayIso()`.
- **TZ fix**: both FE and BE use `Australia/Sydney`. FE helper `sydneyTodayIso()` uses `toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })`; BE `_today_iso()` uses `datetime.now(ZoneInfo("Australia/Sydney")).strftime("%Y-%m-%d")`.
- Every assignment doc now stamps BOTH `date_local` (Sydney, primary) and `date_utc` (audit trail).

### 4. Worker name propagation
- `create_daily_job` now snapshots all of `worker_name`, `worker_phone`, `worker_role_id`, `worker_kind` (`"user"` or `"worker"` — the .132cf assignee helper `_resolve_assignee` accepts either id shape for legacy compat), `assigned_by_id`, `assigned_by_name`, `assigned_at` on the assignment doc at write time.
- `admin_list_assignments` reads snapshot fields directly (legacy-row JOIN path retained only for docs missing `worker_name`).
- `GET /daily-jobs/today` returns the full doc (snapshots come along for free).
- FE `worker-row-header` renders a visible Worker card at the top of the form: name + role chip + phone/email — directly under "Assign to".

### 5. PDF drag-drop + AI parse
- **New endpoint** `POST /api/mobile/daily-jobs/parse-pdf` — multipart PDF upload.
- **Pipeline**:
  1. Stream body (10 MB cap), compute SHA-256.
  2. Cache lookup keyed on SHA-256 (5-min TTL) — skips LLM on repeat uploads.
  3. `PyPDF2` text-layer extraction (max 20 pages for latency).
  4. LLM call — `emergentintegrations.llm.chat.LlmChat` with `anthropic/claude-sonnet-4-5-20250929`, system prompt `PDF_SYSTEM` requiring strict JSON extraction of `worker_name`/`date`/`site_name`/`site_address`/`notes`.
  5. Store PDF bytes in Mongo GridFS (`bucket_name="job_pdfs"`), stringify the ObjectId as `pdf_id`.
  6. Response: `{parsed, raw_text_snippet, pdf_id, pdf_url, cache_hit}`.
- **New endpoint** `GET /api/mobile/daily-jobs/pdf/{pdf_id}` — StreamingResponse from GridFS, org-scoped so a caller can't fetch another org's PDF.
- **FE**: dropzone (`data-testid="pdf-dropzone"`) with drag-over highlight, filename display after upload, `data-testid="pdf-clear-btn"` to remove.
- **Prefill**: parsed fields flow into `date` / `siteName` / `siteAddress` / `notes` / matched worker. Each prefilled field gets a violet `Sparkles + AI-parsed` pill (`data-testid="ai-parsed-pill-<field>"`) so Stephen can visually verify before Assign. Worker name fuzzy-matches by exact → contains → contained-in against the loaded picker list.

### 6. Editable preamble
- New `<textarea data-testid="preamble-input">` with `maxLength={500}` and a live character counter in the label (`Message to worker (71/500)`).
- Default value: `"You have been assigned the job attached. Please review before starting."`
- Stored as `assignment.preamble`. Server caps at 500 chars defensively.

### 7. Role gate consistency
- `_require_admin` in BOTH `mobile_daily_jobs.py` and `mobile_daily_jobs_admin.py` narrowed to **`role == "admin"` only**.
- Retired the .132n permissive gate (`admin, manager, hseq_lead, owner`) and the .132ab admin-list variant (`admin, owner`). Uniform strictness across create + parse-pdf + admin_list_workers + admin_list_assignments + admin_list_sites.

## Files touched

### Backend
- `backend/mobile_daily_jobs.py` — full rewrite of the module header + `_today_iso` + `_require_admin` + `create_daily_job` + NEW `parse_pdf` + NEW `download_pdf` + `_resolve_assignee` helper. `DailyJobCreateIn` gained `preamble`/`pdf_id`/`pdf_url`.
- `backend/mobile_daily_jobs_admin.py` — `_require_admin` strict; `admin_list_workers` sourced from `db.users` with role_id filter; `admin_list_assignments` reads snapshot fields with legacy-JOIN fallback; module-level `ADHOC_TARGET_ROLE_IDS`.

### Frontend
- `frontend/src/pages/AdminAssignDailyJobs.jsx` — rewritten (~500 lines):
  - `sydneyTodayIso()` + `isoAddDays` + `fmtNiceDate` helpers.
  - ROLE_LABELS + ROLE_CHIP_CLASS maps.
  - Shadcn Calendar in Popover, ±1 arrows, Today button.
  - Server-side `role_id` filter on the picker.
  - PDF drag-drop `handlePdfUpload` + AI-parsed pill helper.
  - Editable preamble textarea with counter.
  - Visible Worker header card (`worker-row-header`) with role chip.
- `frontend/src/components/layout/AppShell.jsx` — sidebar label `Assign Daily Jobs` → `Ad-hoc Jobs`.

### Version
- `frontend/src/lib/version.js`:
  - `RUNNING_VERSION` `.132ce` → `.132cf`
  - `EXPECTED_CACHE_VERSION` `.132ce` → `.132cf` (three-way lockstep per the .132ce guardrail)
- `frontend/public/service-worker.js`:
  - `CACHE_VERSION` `.132ce` → `.132cf`

## Pytests (`backend/tests/test_v58_13_132cf_adhoc_job_assignments.py`)
17/17 green:
- `test_backend_today_iso_uses_sydney_tz`
- `test_backend_require_admin_is_strict` — both routers pin strict admin-only.
- `test_backend_picker_targets_users_by_role_id`
- `test_backend_create_snapshots_worker_and_assigner` — every snapshot field present.
- `test_backend_parse_pdf_endpoint_present` — endpoint registered, GridFS bucket wired, cache in place.
- `test_backend_pdf_download_endpoint_present` — download route + `StreamingResponse`.
- `test_backend_admin_list_reads_snapshot_fields` — legacy-JOIN fallback preserved.
- `test_frontend_title_renamed` (runtime title, comments allowed).
- `test_sidebar_label_renamed`.
- `test_frontend_role_filter_chips_are_three_roles_plus_all` — 3 role keys + `all`; `foreman` gone.
- `test_frontend_shadcn_calendar_popover_wired` — all four date-bar testids.
- `test_frontend_sydney_today_helper`.
- `test_frontend_pdf_dropzone_wired`.
- `test_frontend_preamble_textarea` — maxLength=500 + default text.
- `test_frontend_worker_header_row_and_role_chip` — Worker card + per-row role chip.
- `test_frontend_ai_parsed_pills_present`.
- `test_three_way_version_sync_at_132cf` — RUNNING == EXPECTED == SW CACHE == `.132cf`.

Adjacent regressions (`.132ce`) still green.

## Live curl trace
```
POST /api/auth/login (stephen)                            → token
GET  /api/mobile/daily-jobs/admin/workers?limit=5
     → total=65, target_role_ids=[paneltec_civil, viatec_traffic, external_contractor]
     → sample: STEPHEN BEADLE role_id=viatec_traffic
             RICK ANTRIM     role_id=viatec_traffic
             Avery Auditor   role_id=paneltec_civil
             Casey Worker    role_id=paneltec_civil
             Test Worker …   role_id=paneltec_civil
GET  /api/health/version                                  → {cache_version: paneltec-v160.3.9.58.13.132cf}
```

## Screenshot
`/tmp/132cf_adhoc_jobs.jpeg` — page loaded with Casey Worker selected. Shows:
- Title "Ad-hoc Job Assignments" + subtitle.
- Sidebar "Ad-hoc Jobs".
- Workers panel: 65 rows, per-row role chip (`PANELTEC CIVIL`, `VIATEC TRAFFIC`).
- Role-filter chip row (`all` + `Paneltec Civil` + `Viatec Traffic` + `External Contractor`).
- Date bar with `Wed, 9 Sept 2026` + `←` `→` `Today` chrome.
- Worker header row: Casey Worker with `PANELTEC CIVIL` chip + email.
- PDF drop-zone: "Drop a job PDF here or click to browse. AI extracts worker · date · site · address · notes."
- "Message to worker (71/500)" textarea preloaded with the default preamble.
- Version pill `v160.3.9.58.13.132cf`.

Not captured in this screenshot (no real PDF at hand + no pre-existing assignment to override) — the AI-parsed pills only render after a live PDF parse. That path is locked by `test_frontend_ai_parsed_pills_present` (source-pin) plus the parse-pdf endpoint pytest.

## PDF parsing implementation notes
- **Text-only PDFs supported** in this ship (PyPDF2 text-layer extraction). Image-only PDFs return HTTP 422 `"Could not extract readable text from this PDF (image-only PDFs aren't supported yet)"`. If Stephen wants OCR fallback (Poppler+Tesseract, à la `swms_phase45.py`), we can flip a follow-up switch — it's one function call.
- **LLM contract**: strict-JSON only, no markdown fences. Prompt requires `null` for missing fields (never invent). Response is defensively `json.loads`-fallback across raw / triple-fence / brace-search — malformed replies yield blank prefill (not a 500) so the admin can still type manually.
- **Cache**: 5-minute in-memory TTL keyed on SHA-256. Cache hit returns the cached `pdf_id` — no re-upload to GridFS.
- **Storage**: GridFS bucket `job_pdfs` — same pattern as `assets.py::_fs_bucket()` (`bucket_name="asset_photos"`). Zero `ephemeral-upload-storage` warnings added.
- **Cost cap**: prompt is trimmed to 12,000 chars pre-LLM.

## Decisions
- **Users, not workers** — Workers has no role_id in this codebase (Simpro-imported employees). Users is the authoritative role_id source. The picker semantics change from "Simpro employees" → "dispatchable identities in Paneltec's user register", which matches Stephen's brief ("workers whose role_id IS one of…").
- **`worker_id` field kept** — the assignment doc's `worker_id` field name is retained even though the value is now a `users.id`; renaming to `assignee_id` would ripple through the mobile app + workers-tracking pipes. `_resolve_assignee` accepts either shape so nothing breaks.
- **GridFS not local uploads** — sidesteps the parked `ephemeral-upload-storage` lint, matches the existing `assets.py` photo pattern, and survives pod restarts.
- **AI-parsed pills over pre-filled greyed inputs** — Stephen asked for a "please verify" affordance. A subtle violet Sonner-style pill next to each label communicates "AI touched this" without disabling the field.
- **Preamble default sentence stored client-side** — server also has a defensive default when the client passes blank, so worker's mobile card is never empty.

## NOT changed
- Mobile worker's job card rendering — the payload changes are additive (`preamble`, `pdf_url`, `worker_name`), so the mobile side gains fields without breaking. Wire-up on the mobile card is deferred to a mobile-side ship per rules.
- Debounce on worker / site search — deferred to `.132cg`.
- SMS-deferred pill on the assignments list — deferred to `.132cg`.
- Sidebar icon swap — deferred to `.132cg`.
- Backfill of pre-.132cf assignment rows — `daily_job_assignments` was empty at ship time (`db.count = 0`); legacy-JOIN fallback covers any future edge case.
- `/app/mobile/` code — untouched. `MOBILE_BUNDLE_VERSION` unchanged.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked for v58.14.x.

## finish tool
Deferred by design. Handed off to the next fork with this memo.
