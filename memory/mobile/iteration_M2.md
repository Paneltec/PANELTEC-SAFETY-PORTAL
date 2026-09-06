# Iteration M2 — Home Dashboard + Simpro company_id fix

## What was implemented
- Patched Simpro worker sync to populate `company_id` from `_company_id`
- Backfilled 72 workers and 4 users
- Built `GET /api/mobile/home` with Open-Meteo weather, company toggling, module permission matrix
- Built `POST /api/mobile/user/active-company` for company switching
- Built `GET /api/mobile/notifications/count` stub
- Rewrote `home.tsx` with full dashboard: greeting header, company toggle pill, hero card (weather + site), 6-tile grid
- Created `app/toolbox/index.tsx` and `app/my-fleet/index.tsx` placeholders
- Created `src/services/home.ts` with TypeScript interfaces + API helpers
- Installed `@tanstack/react-query` for caching/refresh
- Updated `CompanyPill.tsx` for API-driven toggle vs static chip
- Wrapped root `_layout.tsx` with QueryClientProvider

## Web-to-mobile mapping
- No direct web page equivalent (this is mobile-only dashboard)
- API patterns: same auth header pattern as web frontend
- Data: same user collection, same sites collection

## Dependencies installed
- `@tanstack/react-query@5.102.8`

## Known issues
- Weather uses office fallback coords (no GPS until M3)
- Notification count is always 0 (stub)
- Module badges only count sites/hazards/prestarts from MongoDB

## Deferred
- GPS device location (M3)
- Site sign-in/sign-off flow (M3)
- Full notification system
