# Iteration 10 — QR Scanning: MOCKED → REAL API Integration (Phase M2)

## What was implemented
- Replaced the MOCKED QR sign-on flow with full backend API integration
- Three scan type components created:
  1. **SiteScanResult** — `GET /api/scan/site/{token}` → site info + SWMS acknowledgment → `POST .../sign-on` → confirmation
  2. **WorkerScanResult** — `GET /api/scan/worker/{token}` → profile + certs → "Sign in to site" → site picker → `POST .../site-signin`
  3. **SupplierScanResult** — `GET /api/scan/supplier/{token}` → supplier info + docs/SWMS → `POST .../complete-induction`
- Main scanner screen with URL parser, viewfinder, and three quick-type buttons

## API Endpoints Used (all verified working)
- `GET /api/scan/site/{token}` ✅ (public, returns site + active_swms)
- `POST /api/scan/site/{token}/sign-on` ✅ (auth, returns pass_expires_at)
- `GET /api/scan/worker/{token}` ✅ (public, returns profile + certifications + assigned_swms)
- `POST /api/scan/worker/{token}/site-signin` ✅ (auth, requires site_id + site_name)
- `GET /api/scan/supplier/{token}` (auth, returns contractor + documents + active_swms)
- `POST /api/scan/supplier/{token}/complete-induction` (auth)
- `GET /api/forms/pickers/sites` ✅ (auth, site picker for worker sign-in)

## Test Tokens
- Site: `ziwkVY2CDZK4` → Erskineville Turnout — Sample Site
- Worker: `tWoXwM5SpM` → RICK ANTRIM (Traffic Controller, 28 certs)

## Known Limitations
- Camera scanning only works on native (iOS/Android) — web uses URL input
- Supplier scan not yet tested with real token (no supplier tokens found in API)
- Quick-type buttons don't auto-populate tokens (user must enter URL manually)

## Dependencies
- No new dependencies installed (expo-camera already present)

## Next Steps
- Phase M3/M4 verification (forms + hazards already built)
- Phase M5: Push notifications + offline queue (Tier 2)
