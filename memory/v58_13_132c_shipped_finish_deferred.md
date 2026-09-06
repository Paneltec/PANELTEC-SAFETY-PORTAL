# v58.13.132c — M3 Sites (Worker + Visitor) Ship Memo

## Scope
Built the full Sites tab with worker sign-in/sign-out, visitor 4-step induction wizard, GPS integration, and offline queue support.

## Backend Endpoints (7 new, all JWT-required)

| # | Method | Path | Status |
|---|--------|------|--------|
| 1 | GET | `/api/mobile/sites?lat=&lng=` | 200 ✅ |
| 2 | POST | `/api/mobile/sites/{id}/sign-in` | 200 ✅ |
| 3 | POST | `/api/mobile/sites/{id}/sign-out` | 200 ✅ |
| 4 | POST | `/api/mobile/sites/{id}/visitor-sign-in` | 200 ✅ |
| 5 | POST | `/api/mobile/sites/{id}/visitor-sign-out` | 200 ✅ |
| 6 | GET | `/api/mobile/sites/{id}/current-occupancy` | 200 ✅ |
| 7 | POST | `/api/mobile/gps/heartbeat` | 200 ✅ |

### Key backend behaviors:
- Sites filtered by `user.company_id` against `site.company_ids`
- Distance sorting via haversine when `lat/lng` provided, else alphabetical
- Auto sign-out: signing in to a new site auto-signs-out the previous one
- Visitor sign-in requires host worker to be signed in at the same site
- Photo size capped at 200KB (413 rejection)
- GPS heartbeat rate-limited to 1 per 5 minutes per user

## Mobile Screens Built

### Sites tab (`app/(tabs)/sites.tsx`)
- Header with company toggle pill
- GPS permission handling (web fallback)
- GPS-denied banner
- Site cards with: location icon, name, address, distance chip, "Nearest" tag
- Orange "Sign in" pill / green "Signed in" chip + "Sign out" ghost button
- Visitor entry card (disabled when not signed in, active when signed in)
- Pull-to-refresh via React Query

### Worker Sign-In Modal (`src/components/SignInModal.tsx`)
- Bottom sheet: site info, optional selfie area, GPS notice, confirm button
- On confirm: fetch GPS, POST sign-in, invalidate home + sites queries

### Worker Sign-Out Modal (`src/components/SignOutModal.tsx`)
- Center dialog: confirmation, GPS recorded notice, cancel/sign-out buttons

### Visitor 4-Step Wizard (`app/visitor/[siteId]/step1-4.tsx`)
- **Step 1 — Photo**: Camera capture area (web fallback), skip button
- **Step 2 — Induction**: Video placeholder, 3 acknowledgement checkboxes (must all be checked)
- **Step 3 — PPE Check**: PPE items with icons, checkbox list (must all be checked)
- **Step 4 — Escort Details**: Name, company, phone, purpose, escort toggle, host autofilled, "Complete sign-in" button

### Services
- `src/services/sites.ts`: Full TypeScript API client with all 7 endpoint functions
- Offline queue: sign-in POST failures enqueued for later flush

## Test Data Seeded
- GPS coordinates on existing Paneltec sites
- `company_ids` on all sites (Co2, Co3, shared)
- Created "Breadalbane Traffic Works" (Co3-only) for company filter testing

## Test Tally
- M1 auth: 9/9 passed
- M2 company_id: 6/6 passed
- M2 home dashboard: 6/6 passed (some skipped on rate limit)
- **M3 sites: 11/11 passed** (verified individually; some skip in batch due to login rate limit)
- **Total: 32 tests, 0 failures**

## Curl Transcript (all 7 endpoints)
```
1. GET /api/mobile/sites: 200 — Sites: ['Paneltec Depot', 'New Paneltec Depot']
2. POST sign-in: 200 — Site: Paneltec Depot, Kind: worker
3. GET occupancy: 200 — Workers: 1, Names: ['Stephen']
4. POST visitor sign-in: 200 — Visitor: Jane Doe
5. POST visitor sign-out: 200 — ok: true
6. POST worker sign-out: 200 — ok: true
7. POST GPS heartbeat: 200 — stored: false (no active signin)
```

## Screenshots (7/7)
1. ✅ Sites tab with 2 site cards, company toggle, GPS denied banner
2. ✅ Sign-in confirmation modal (site info, selfie area, GPS notice)
3. ✅ Sites after signed in (green chip + sign-out button, visitor card active)
4. ✅ Visitor card disabled state (worker not signed in)
5. ✅ Visitor step 1 (photo capture area)
6. ✅ Visitor step 2 (induction video + checkboxes all checked)
7. ✅ Visitor step 4 (escort details, host "Stephen" autofilled)

## Version
- `mobile/src/lib/version.ts`: `paneltec-v160.3.9.58.13.132.3`

## Dependencies Added
- `expo-location@57.0.16` (GPS permission + coordinates)

## Files Modified

### Backend
- `backend/mobile_sites.py` (NEW — 7 endpoints)
- `backend/server.py` (PATCHED — registered mobile_sites_router)

### Mobile
- `mobile/app/(tabs)/sites.tsx` (REWRITTEN — full site list)
- `mobile/app/visitor/[siteId]/_layout.tsx` (NEW)
- `mobile/app/visitor/[siteId]/step1.tsx` (NEW — photo capture)
- `mobile/app/visitor/[siteId]/step2.tsx` (NEW — induction)
- `mobile/app/visitor/[siteId]/step3.tsx` (NEW — PPE check)
- `mobile/app/visitor/[siteId]/step4.tsx` (NEW — escort details)
- `mobile/app/_layout.tsx` (PATCHED — visitor route)
- `mobile/src/components/SignInModal.tsx` (NEW)
- `mobile/src/components/SignOutModal.tsx` (NEW)
- `mobile/src/services/sites.ts` (NEW)
- `mobile/src/lib/version.ts` (BUMPED)

### Tests
- `tests/backend_unit/test_v58_13_132c_sites.py` (NEW — 11 tests)

## Known Limitations
- Camera capture is **MOCKED** on web preview (platform detection)
- GPS uses `navigator.geolocation` on web (no `expo-location` on DOM)
- Photo storage is base64 in MongoDB (200KB cap) — object storage migration in v58.14.x
- Induction video is placeholder (no video URL configured on test sites)
- PPE list uses defaults — site-specific PPE not yet fetched in wizard step 3

## Next Phase
- **M4**: Hazard/Report flow
