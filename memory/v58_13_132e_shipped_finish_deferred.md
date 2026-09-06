# M5 Capture Modules Ship Memo — v58.13.132e

## Summary
Wired 5 existing Capture modules into the native mobile shell using existing backend CRUD endpoints. NO new forms, NO new collections — native UI over `crud.py::build_router()`.

## What Shipped

### Shared Infrastructure
- `src/services/capture.ts` — Generic CRUD client for all 5 modules (list/get/create/update/delete + AI photo analysis + offline queue)
- `src/components/CaptureList.tsx` — Reusable list screen: filter chips, pull-to-refresh, item cards with status pills, module-colored FAB
- `src/components/PhotoCapture.tsx` — Camera + gallery picker with web fallback (expo-image-picker for native, file input for web)

### 5 Module Screens (15 files)
| Module | List | New | Detail |
|--------|------|-----|--------|
| Hazards | `(tabs)/report.tsx` | `hazards/new.tsx` | `hazards/[id].tsx` |
| Incidents | `incidents/index.tsx` | `incidents/new.tsx` | `incidents/[id].tsx` |
| Pre-Starts | `(tabs)/prestart.tsx` + `prestarts/index.tsx` | `prestarts/new.tsx` | `prestarts/[id].tsx` |
| Site Diary | `site-diary/index.tsx` | `site-diary/new.tsx` | `site-diary/[id].tsx` |
| Inspections | `inspections/index.tsx` | `inspections/new.tsx` | `inspections/[id].tsx` |

### AI Photo Analysis (Hazards + Incidents)
- Calls `POST /api/ai/hazard-vision` (multipart upload)
- Returns `{identified_hazards, suggested_controls, severity, summary, photo_url}`
- Hazard form: AI auto-fills severity + title + shows hazard tag chips + control suggestions
- Incident form: AI shows analysis suggestions

### Draft/Offline Support
- Pre-Starts, Site Diary, Inspections: `status: "draft"` via new Pydantic model field
- Hazards/Incidents: `status: "open"` (no "draft" in HazardStatus/IncidentStatus enum)
- Offline: `createItem()` catches network errors, queues via `offline-queue.ts`, returns `{_offline: true}`

### Backend Changes (Minimal)
- Added `status: Optional[str] = None` to `PreStartIn`, `SiteDiaryIn`, `InspectionIn` in `models.py`
- Version bump `mobile_home.py` header to `.132e`
- NO new endpoints, NO new collections, NO new routers

### Home Tile Grid Updated
- `KNOWN_ROUTES` in `home.tsx` now includes `/incidents`, `/inspections`, `/site-diary`
- All 5 capture module tiles show as active (navy icons) instead of "Coming Soon"

## Test Results
- `test_v58_13_132e_capture.py`: **8/8 passed** (hazard list, create+get, draft, incident, pre-start, site diary, inspection, AI endpoint)
- `test_v58_13_132d_reconciliation.py`: **5/5 passed** (no regressions from M4)
- **Total: 13/13 passed**

## Screenshots (6)
1. Home tab with 19 module tiles (5 capture active)
2. Hazards list with real data
3. New Hazard form (photo capture, severity selector, AI analysis placeholder, controls)
4. Pre-Start list with imported PDF data
5. Site Diary list with submitted entry + filter chips
6. New Inspection form with checklist (PASS/FAIL/NA toggle)

## Known Limitations
- Hazard/Incident `status` doesn't support "draft" (enum is `open|in_progress|closed`) — would need enum expansion
- Inspection checklist uses default template — server-driven template loading deferred
- Photo upload to AI may fail without real image (endpoint requires multipart file)
- Company scoping: org_id filter is applied by CRUD; workspace_id passed but not always set in existing data

## Deferred
- SWMS (has its own AI parse workflow — M6+)
- Certifications, Plant & Vehicles, Contractors, Suppliers (M6/M7)
- Profile content (M6)
- QR install card (M7)
