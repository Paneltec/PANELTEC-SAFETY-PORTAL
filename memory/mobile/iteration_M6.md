# Iteration M6 — v58.13.132g Profile Tab

## What was implemented

### Screens
1. **`app/(tabs)/profile.tsx`** — Profile tab with 5 sections:
   - Header: Orange avatar with initials, name (Stephen Guy), position (Traffic Controller), company chip (Viatec)
   - Contact Details: Email card
   - My Certifications: List of 14 certs with status pills (Missing file), "See all" link, tap → detail
   - My SWMS: Filtered by worker's `applies_to.worker_ids` (0 assigned for test user)
   - My Fleet: 50 assets from fleet register with odometer/hours metrics
   - Payroll: **MOCKED** stub with "Coming Soon" badge (Latest Payslip, Leave Balance, Book Time Off)
   - Sign Out button + version footer

2. **`app/profile/certifications/[id].tsx`** — Cert detail screen:
   - Status banner (color-coded: valid/expiring/expired/missing)
   - Detail rows (Issuer, Issue Date, Expiry Date, Category)
   - Document attachment status

3. **`app/profile/swms/[id].tsx`** — SWMS detail screen:
   - Title block with code + version
   - Status badge (approved/draft)
   - Details (scope, description, review date)
   - PPE requirements grid

4. **`app/profile/fleet/[id].tsx`** — Fleet asset detail:
   - Asset header with kind pill
   - 4-tile counters grid (Odometer, Hours, Services, Total Spend)
   - Compliance section (Open Hazards, Open Incidents, Last Service)
   - Asset details (Rego, Type, Navixy Device, Last Position)
   - Service history timeline

### Components
- `src/services/profile.ts` — API client with 4 fetch functions
- `app/profile/_layout.tsx` — Stack navigation layout

### Device-Framed Screenshots (12 total)
Generated at 390×844 (iPhone 14 Pro), wrapped with ImageMagick device frame:
1. Splash/Onboarding, 2. Login (setup code), 3. Home dashboard
4. Sites list, 5. Hazard Reports, 6. Pre-Start Checks
7. Site Diary Entries, 8. Inspections, 9. Profile (Header + Certs)
10. Profile (SWMS + Fleet), 11. Profile (Fleet detail + Payroll)
12. Profile (Payroll stub + Sign Out)

## Web-to-Mobile Mapping
| Backend Endpoint | Profile Section | Notes |
|---|---|---|
| GET /api/me/worker-profile | Header + Contact + Certs | JWT-authenticated |
| GET /api/swms (CRUD) | My SWMS | Client-side filter by worker_id |
| GET /api/fleet/register | My Fleet | Full org register (no worker binding) |
| GET /api/fleet/assets/{id} | Fleet Detail | Counters + history |
| (none) | Payroll | MOCKED — no backend |

## Dependencies Installed
None — all libraries already present from M5.

## Known Issues / Deferred
- Payroll section is **MOCKED** (no WoJo integration yet — planned for v58.13.133)
- Fleet has no worker→asset binding; shows full register
- SWMS client-side filtering may miss docs if `applies_to.worker_ids` not populated
- "See all" buttons on certs/fleet are UI-only (no full list screen yet)
