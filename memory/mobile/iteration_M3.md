# Iteration M3 — Sites (Worker + Visitor)

## What was implemented
- 7 backend endpoints for sites, sign-in/out, visitor, occupancy, GPS heartbeat
- Sites tab with site cards, GPS distance sorting, company filtering
- Worker sign-in/sign-out modals
- Visitor 4-step induction wizard (photo, induction, PPE, escort)
- GPS integration via expo-location (web fallback)
- Offline queue extension for sign-in failures

## Web-to-mobile mapping
- Reuses `simpro_sites` collection from existing backend
- New `site_sign_ins` collection for mobile-specific flow
- Sign-in modal approach (vs web QR-based flow)

## Dependencies installed
- `expo-location@57.0.16`

## Known issues
- Camera mocked on web preview
- PPE list uses defaults (not fetched from site data in wizard)
- GPS denied on web preview (alphabetical fallback)
