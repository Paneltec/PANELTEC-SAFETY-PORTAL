# Iteration M5 — v58.13.132e Capture Modules

## What was implemented

### Discovery
- Discovered all 5 modules share `crud.py::build_router()` with identical CRUD patterns
- AI endpoint: `POST /api/ai/hazard-vision` (multipart, returns analysis + photo_url)
- No missing endpoints — all modules fully supported

### Shared Infrastructure
- `capture.ts` — Module-keyed CRUD client with offline fallback
- `CaptureList.tsx` — Generic list with filter chips, status pills, FAB
- `PhotoCapture.tsx` — Camera/gallery picker with web DOM fallback

### Module Screens
- **Hazards**: List (in tab), New form with AI photo analysis + severity chips + controls, Detail view
- **Incidents**: List, New form with AI photo + category selector, Detail view
- **Pre-Starts**: List (in tab), New form (date, crew lead, work summary, hazards), Detail view
- **Site Diary**: List, New form (date, notes), Detail view
- **Inspections**: List, New form with 8-item checklist (PASS/FAIL/NA toggle), Detail view

### AI Photo Integration
- `analyzePhoto()` in capture.ts posts to `/api/ai/hazard-vision`
- Hazard form: AI auto-fills severity, title, shows hazard tags + control suggestions as chips
- Incident form: AI shows identified hazards

### Draft/Offline
- Draft via `status` field on create (pre-starts, site-diary, inspections support "draft")
- Hazards/Incidents: status is typed enum (open|in_progress|closed) — "draft" not in enum
- Offline: createItem catches network errors, queues via offline-queue.ts

## Dependencies
- No new dependencies (reused expo-image-picker, expo-file-system, @tanstack/react-query)

## Known Issues
- Hazard/Incident don't support "draft" status (enum constraint)
- Inspection checklist is default template (not server-driven yet)
- Company scoping: workspace_id passed but not enforced in list filtering
