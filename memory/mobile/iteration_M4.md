# Iteration M4 — v58.13.132d Sites Reconciliation + Dynamic Home

## What was implemented

### Part A: Backend Reconciliation
- **Audit document**: `/app/memory/v58_13_132d_sites_reconciliation_audit.md`
  - Documented 3 endpoint families: M3 mobile-only, legacy QR/signon, public visitor
  - Schema diff: `site_sign_ins` (M3) vs `site_signons` (legacy)
  - Decision: **REPOINT UI** — redirect mobile to existing endpoints, no data migration
- **Server.py cleanup**: Removed `mobile_sites_router` imports and 2x `include_router` calls
- **mobile_home.py fixes**:
  - Sign-in status now queries `site_signons` (field: `signed_by_user_id`, `signoff_at`)
  - Modules now dynamically loaded from `mobile_modules_data.py::_load_matrix()` — returns all 19 MODULE_KEYS filtered by user's role
  - `MODULE_METADATA` dict maps each key → label, icon, route

### Part B: Mobile UI Rebuild
- **Sites service** (`src/services/sites.ts`):
  - `fetchSites()` → `GET /api/sites` + client-side haversine distance calculation
  - `workerSignIn()` → `POST /api/sites/{id}/signon-v127` (gps_lat, gps_long, answers)
  - `workerSignOut()` → `POST /api/me/signoff-active`
  - `visitorSignIn()` → `POST /api/public/visitor/site/{token}/signin`
- **Sites tab** (`app/(tabs)/sites.tsx`):
  - Site list from `GET /api/sites`, enriched with GPS distance (client-side)
  - Sign-in status derived from home endpoint (`site.signed_in`, `site.site_id`)
  - Worker sign-in/out modals use new endpoints
  - Visitor card passes `scan_token` to visitor wizard
- **Home tab** (`app/(tabs)/home.tsx`):
  - Renders dynamic module grid (3 columns)
  - Active modules (with navy icon circles) vs "Coming soon" (muted + label)
  - `KNOWN_ROUTES` set determines which tiles are active
- **Visitor wizard step 4**: Uses `POST /api/public/visitor/site/{token}/signin`
- **Deleted**: `toolbox/index.tsx`, `my-fleet/index.tsx` placeholders

## Web-to-Mobile Mapping
| Existing Web Endpoint | Mobile Usage |
|---|---|
| `GET /api/sites` | Sites tab list |
| `POST /api/sites/{id}/signon-v127` | Worker sign-in |
| `POST /api/me/signoff-active` | Worker sign-off |
| `POST /api/public/visitor/site/{token}/signin` | Visitor wizard step 4 |
| `GET /api/mobile/home` | Home dashboard (19 modules + site status from `site_signons`) |

## Known Issues / Deferred
- GPS sorting only works on native devices (web preview falls back to alphabetical)
- `site_sign_ins` collection still exists in DB but is no longer written to — can be dropped manually
- `mobile_sites.py` file still exists on disk but is unregistered from `server.py`
- Visitor sign-out not yet implemented (visitors sign out via public form on the web)
- Photo capture on sign-in deferred (existing `signon-v127` doesn't support photo_data_uri)

## Dependencies
- No new dependencies installed (reused existing `@tanstack/react-query`, `expo-location`, `axios`)
