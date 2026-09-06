# v58.13.132b — M2 Home Dashboard Ship Memo

## Scope
Built the M2 Home Dashboard for the Paneltec Civil Field Expo mobile app, including the P1 company_id fix.

## Delivered

### Step 0 — P1 Fix: Simpro company_id Mapping
- **Patched** `integrations_simpro_workers.py`: New workers get `company_id` from `_company_id` on creation. Existing workers get `company_id` updated on every sync. Dual-company detection sets `company_ids` + `primary_company_id`.
- **Patched** `users.py` `import_from_simpro`: Sets `company_id = simpro_company_id` on user creation.
- **Created** `scripts/backfill_company_id.py`: Dry-run and apply modes. Backfill ran successfully: 72 workers (40 Co2, 32 Co3) and 4 users (3 Co2, 1 Co3) now have `company_id`. Zero dual-company records detected.
- **Tests**: `test_v58_13_132b_simpro_company_mapping.py` — 6 passed.

### Step 1 — Home Dashboard Backend
- **New file**: `backend/mobile_home.py`
  - `GET /api/mobile/home` — Returns aggregated dashboard: user info, companies, today, weather, site status, module tiles with badge counts.
  - `POST /api/mobile/user/active-company` — Switches active company for dual-company users.
  - `GET /api/mobile/notifications/count` — Stub returning `{count: 0}`.
- **Open-Meteo** integration: Free weather API, no key required, cached per geohash for 10 minutes. Falls back to office coords (Canberra region).
- **Module permission matrix**: Filters tiles by user role. Admin/supervisor see all 6 tiles; workers don't see Toolbox Talk or My Fleet.
- **Tests**: `test_v58_13_132b_mobile_home.py` — 6 passed (shape, auth, notifications, company toggle, cache, module filtering).

### Step 2 — Home Screen UI
- **Rewrote** `app/(tabs)/home.tsx` with full dashboard:
  - Greeting header (navy): Avatar initials, greeting, employee number, notification bell.
  - Company toggle pill: Segmented control (Paneltec / Viatec) when `can_switch_company=true`, static chip otherwise.
  - Hero card: Today's date, weather from Open-Meteo, site signed-in status with green chip or nearest site prompt.
  - Module tile grid (3×2): Navy icon circles, orange badges, label — navigates to routes.
  - Pull-to-refresh via React Query.
  - Error state with retry.
  - Loading state with spinner.

### Step 3 — Placeholder Screens
- `app/toolbox/index.tsx` — "Toolbox Talks (coming in M8)"
- `app/my-fleet/index.tsx` — "My Fleet (coming in M5)"

### Step 4 — State + Services
- `src/services/home.ts`: `fetchHome()`, `setActiveCompany()`, `fetchNotificationCount()` with TypeScript interfaces.
- `@tanstack/react-query@5.102.8` installed for caching + auto-refresh.
- `QueryClientProvider` wrapped in root `_layout.tsx`.
- Updated `CompanyPill.tsx` for API-driven toggle vs static chip.

## Version
- `mobile/src/lib/version.ts`: `paneltec-v160.3.9.58.13.132.2`

## Test Tally
- **M1 auth tests**: 9/9 passed (no regressions)
- **M2 company mapping tests**: 6/6 passed
- **M2 home dashboard tests**: 6/6 passed
- **Total**: 21/21 passed

## Screenshots Captured
1. Home with dual-company toggle (Paneltec active) + 6 tiles + weather + hero ✅
2. Home for single-company user (static Paneltec chip) ✅
3. Company toggle: Paneltec → Viatec switch ✅
4. Home with site signed-in (green "Signed in · Breadalbane" chip) ✅
5. Home in Viatec mode (Viatec pill active) ✅
6. Backfill dry-run summary (inline in log) ✅

## Known Limitations
- Weather uses office fallback coords (no device GPS until M3)
- Nearest site uses first active site (no distance calc until GPS in M3)
- Notification count is stub `{count: 0}` — no notification system yet
- Module badges only show for sites/hazards/prestart counts
- `SecureStore` / `expo-local-authentication` still MOCKED on web preview

## Files Modified
### Backend (new/changed)
- `backend/mobile_home.py` (NEW)
- `backend/integrations_simpro_workers.py` (PATCHED — company_id on sync)
- `backend/users.py` (PATCHED — company_id on import)
- `backend/server.py` (PATCHED — registered mobile_home_router)
- `backend/scripts/backfill_company_id.py` (NEW)

### Mobile (new/changed)
- `mobile/app/(tabs)/home.tsx` (REWRITTEN)
- `mobile/app/_layout.tsx` (REWRITTEN — QueryClientProvider + new screens)
- `mobile/app/toolbox/index.tsx` (NEW)
- `mobile/app/my-fleet/index.tsx` (NEW)
- `mobile/src/components/CompanyPill.tsx` (REWRITTEN — API-driven)
- `mobile/src/services/home.ts` (NEW)
- `mobile/src/lib/version.ts` (BUMPED)

### Tests (new)
- `tests/backend_unit/test_v58_13_132b_simpro_company_mapping.py`
- `tests/backend_unit/test_v58_13_132b_mobile_home.py`

## Next Phase
- **M3**: Sites screens + GPS device location + site sign-in/sign-out flow
