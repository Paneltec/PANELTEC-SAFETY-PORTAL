# v58.13.132h — Ship Memo: M6-reset Categorised Forms Library

## Direction Correction
**M5 approach was wrong.** The web app's Capture/Forms module is ONE categorised library, not 5 hardcoded tabs. This build resets the mobile app to mirror that structure exactly.

## What Shipped
- **4-tab bottom nav**: Home / Forms / Sites / Profile (was 5+)
- **Forms tab** (`app/(tabs)/forms.tsx`): Categorised library with search
  - Categories: General (11), Pre-Start (5), Inspection (7), Near Miss (1), Incident (2), Toolbox (2), Admin Only (1)
  - Permission-gated: Admin Only hidden for non-admin users
  - Form cards with color-coded accent bars, descriptions, field counts
- **Form runner** (`app/forms/[id].tsx`): Opens any template, renders fields natively
  - Supported: text, textarea, number, date, select, radio, photo, signature, GPS
  - Unsupported types: graceful fallback "fill on web app"
  - Submit + success confirmation flow
  - Cert-gating access check
- **Home tile grid**: Pruned to Forms/Sites/Profile (removed standalone hazard/pre-start/diary/inspection tiles)
- **Version bumped**: `.132g` → `.132h` across all 3 canonical files

## Archived (NOT deleted)
The M5 fragmented tab files moved to `/app/mobile/_archived_m5_wrong_approach/`:
- `report.tsx`, `prestart.tsx` (old tabs)
- `hazards/`, `incidents/`, `prestarts/`, `site-diary/`, `inspections/` (old module screens)

## Backend Changes
NONE. Zero new endpoints, collections, or forms. Reuses:
- `GET /api/forms/templates` — categorised list
- `GET /api/forms/templates/{id}` — template detail
- `GET /api/forms/templates/{id}/access-check` — cert gating
- `POST /api/forms/templates/{id}/submissions` — submission

## Payroll Stub (Profile Tab)
Still **MOCKED** from v58.13.132g. No backend endpoint.

## Screenshots (6 device-framed)
Published to: `https://whs-compliance.preview.emergentagent.com/mobile-screenshots/index.html`
1. 4-tab bottom nav
2. Forms tab — General category
3. Forms tab — all categories scrolled
4. Forms tab — non-admin (Admin Only hidden)
5. Forms tab — admin (Admin Only visible)
6. Form runner — real form rendering

## Pytest
6/6 passing (`test_v58_13_132h_forms.py`):
- `test_forms_templates_list` ✅
- `test_forms_categories_present` ✅
- `test_forms_admin_category_gated` ✅
- `test_form_template_detail` ✅
- `test_form_access_check` ✅
- `test_form_submission_round_trip` ✅

## Honest Flags
- Payroll section in Profile tab: **MOCKED** (no backend)
- Fleet shows full org register (no worker→asset binding)
- "See all" buttons on certs/fleet are UI stubs
- Some form field types (vehicle_navixy, worker_picker, job_picker, etc.) display graceful fallbacks
