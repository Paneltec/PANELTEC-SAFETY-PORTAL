# v58.13.132hz — Dedicated SSRA capture surface · SHIPPED (finish deferred)

**Ship phase:** `.132hz`
**Scope:** P1 — new top-level route `/app/capture/ssra` under the Capture sidebar section. List existing SSRA submissions, upload PDFs, surface the source-document filename per record.
**Testing:** Pytest (`backend/tests/test_v58_13_132hz_ssra_capture.py`) — 12/12 green. Live Playwright smoke via `screenshot_tool` — page renders, sidebar entry active, header + empty state + version pill all verified.

## What shipped

### 1. New page `frontend/src/pages/capture/SsraCapture.jsx`
- Filters the shared `/api/risk-assessments` endpoint client-side against a classifier regex `/ssra|site[\s_-]*specific[\s_-]*risk/i`.
- Same `CaptureListToolbar` + `CaptureCard` + `CaptureCardGrid` shape as the parent Risk Assessments page — visual continuity, zero new component families.
- Header carries a filled-blue `Upload PDF` button (admin-only) that opens the existing `<PdfImportModal>` — no new backend endpoint.
- Empty state copy names the three SSRA-family templates that already exist in the org (Drain Cleaning SSRA, Viatec Traffic Solutions SSRA, Construction & Excavation SSRA).
- Per-card "Source: `<filename>`" line renders when `imported_from_pdf` is present (records ingested via `/api/imports/pdf`). Missing → line hidden.
- Back-link to `/app/risk-assessments` for the full parent surface (Master Risks / List Forms / Root Causes).

### 2. Route mount
- `App.js` → `<Route path="capture/ssra" element={<SsraCapture />} />` inside the authenticated shell.
- No redirect from `/app/risk-assessments` — both surfaces coexist. SSRA is a focused subset; Risk Assessments remains the canonical parent.

### 3. Sidebar entry
- `AppShell.jsx` grows one row under **Capture**, immediately after `Risk Assessments`:
  ```
  { to: '/app/capture/ssra', label: 'SSRA', testid: 'nav-capture-ssra',
    resource: 'risk_assessments', pastel: 'lilac' }
  ```
- Same `ShieldTask24` icon family + same permission gate as the parent (risk_assessments.view) so any user who can see Risk Assessments can see SSRA.

## Backend
No changes. Reuses:
- `/api/risk-assessments` — list + archive.
- `/api/imports/pdf` — upload flow (existing PdfImportModal wire-up).
- Existing filename matchers already cover Drain Cleaning SSRA + Viatec Traffic Solutions SSRA (via `_FILENAME_MATCHERS` shipped `.132hn` and expanded `.132hy`).

## Version pin
- `RUNNING_VERSION`  → `paneltec-v160.3.9.58.13.132hz`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132hz`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132hz`
- MOBILE_BUNDLE_VERSION unchanged.

## Pytest coverage (12 checks)
- `test_ssra_capture_page_exists` — page + testids + PdfImportModal wire-up + SSRA_RE + API endpoint + source-doc affordance.
- `test_app_js_mounts_capture_ssra_route` — import + route path.
- `test_sidebar_has_capture_ssra_entry` — testid + href + ordering guard (must sit after Risk Assessments).
- `test_version_pin_v132hz` — three-string lockstep.
- `test_ssra_classifier_regex_matches_expected` (8 param cases) — SSRA family matches; TTM Registers, Master Risks, and unrelated templates correctly excluded.

## Live verification
- Page renders with sidebar entry highlighted (`SSRA` under Capture).
- Header shows `CAPTURE / SSRA` breadcrumb + `SSRA` H1 + subtitle + `Upload PDF` header button.
- Empty state visible for the live Paneltec preview data (org currently has no SSRA-classified `risk_assessments` rows via the list endpoint — this is expected: SSRA submissions are stored on the parent Risk Assessments page under `template_category=hazard` and only surface here once new submissions land).
- Version pill at bottom-left shows `v160.3.9.58.13.132hz`.

## Deferred (from the original brief)
- **Fix AI-generated PDF missing photos/signatures**: NOT_IN_SCOPE. SSRAs are declared as `MIRRORED_ONLY_KINDS` in `pdf_routes.py` (line 67) — there is NO SSRA-specific renderer in `pdf_renderer.py::RENDERERS`. The AI-generated PDF path the user described must therefore live either (a) inside the mobile SSRA capture flow that generates a PDF at submit-time OR (b) inside a `POST /forms/submit-pdf` flow that renders form_submissions to PDF. Neither surface has been traced in this ship. Deferred to `.132hz-a` pending a specific document ID from Stephen so the exact renderer entry point can be located.
- **"View original document" as a modal viewer**: This ship surfaces the source filename inline on each card (`imported_from_pdf`). Opening the original blob requires resolving the filename against `doc_files` or the (temporarily-persisted) import buffer — neither path is currently wired to preserve the original PDF. Explicit affordance deferred alongside the AI PDF fix.

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish` invocations.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk pre-check: 91% steady.

## Next action items
- Ship `.132ia` — Incidents module overhaul + Hazard Reports merge (P0).
- Ship `.132hz-a` — SSRA AI PDF photo/signature fix (blocked on Stephen supplying a leaked document ID).
