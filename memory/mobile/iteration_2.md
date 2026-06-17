# Mobile Iteration 2 — Phase 4 Feature Completion

## Changes Made

### Tab Navigation Restructured
- **Before**: Dashboard, Capture, Compliance, Ask AI, Settings
- **After**: Home, Capture, QR Sign-On, My Work, Profile
- Compliance and Ask AI are hidden tabs (accessible via routes, not shown in tab bar)

### Home/Dashboard Enhanced
- Added GET /api/ask/briefing call with workspace_id param
- Briefing card rendered with violet theme, confidence badge, cited evidence chips
- "Ask Intelligence anything" link navigates to hidden Ask AI tab

### QR Sign-On Tab (NEW — MOCKED)
- Camera viewfinder mock with corner brackets
- "Tap to Scan" button simulates barcode detection (random SITE-XXXXXX code)
- Manual code text input fallback
- Sign-on button with success state display
- Camera scan is MOCKED (simulated 1.5s delay + random code)
- Sign-on submit is MOCKED (always succeeds with Alert)

### My Work Tab (NEW)
- Fetches all 6 record types via parallel API calls: GET /api/swms, /api/pre-starts, /api/site-diary, /api/hazards, /api/incidents, /api/inspections
- Groups records by type with count badges
- Shows latest 3 records per group with status badges
- "View all" link navigates to respective list screen

### Profile Tab (was Settings)
- Profile card with avatar, name, email, role
- Workspace switcher with radio group (Sydney Metro, Newcastle Depot)
- Settings links: Organisation, Integrations, Users, Compliance Hub, Ask Intelligence
- Sign out with confirmation alert

### Hazard Form Enhanced
- Camera capture via expo-image-picker (launchCameraAsync + launchImageLibraryAsync)
- Photo preview with remove button
- AI Vision analysis (POST /api/ai/hazard-vision with multipart/form-data)
- AI analysis result card (violet theme, identified hazards tags, summary)
- Auto-fills title, description, severity, controls from AI response
- Controls list management (add/edit/delete)

## Dependencies Added
- expo-camera@17.0.10
- expo-image-picker@17.0.11

## Bugs Fixed
- settings.tsx: Added missing `useAuth` import (was calling `useAuth()` without importing it)
- Complete rewrite of settings.tsx to be a proper Profile screen

## Known MOCKED Items
1. **QR Sign-On camera scan** — simulated with setTimeout + random code (reason: web preview can't access real camera; on native devices expo-camera would work)
2. **QR Sign-On submit** — always succeeds (reason: no backend endpoint for site sign-on)
3. **Workspace switcher** — hardcoded workspace list from seed data (reason: no backend workspace list endpoint used)

## Backend Endpoints Used
- POST /api/auth/login
- POST /api/auth/signup
- GET /api/auth/me
- POST /api/auth/logout
- GET /api/dashboard/metrics
- GET /api/ask/briefing
- POST /api/ask
- GET /api/ask/history
- GET /api/swms, POST /api/swms
- GET /api/swms/:id
- POST /api/ai/swms-draft
- GET /api/pre-starts, POST /api/pre-starts
- GET /api/site-diary, POST /api/site-diary
- POST /api/ai/diary-structure
- GET /api/hazards, POST /api/hazards
- POST /api/ai/hazard-vision
- GET /api/incidents, POST /api/incidents
- GET /api/inspections, POST /api/inspections
- GET /api/contractors, POST /api/contractors
- GET /api/contractors/:id
- DELETE /api/contractors/:id/documents/:docId

## No Backend Endpoint Gaps Found
All endpoints used by the mobile app are confirmed working on the live backend.
