# Iteration 3 — Phase 8 Full Wiring

## What was implemented

### Screens built
1. `(tabs)/outbox.tsx` — Full outbox screen with status filters (all/queued/sent/failed/cancelled), pull-to-refresh, retry/cancel actions, detail drawer modal, M365 connection banner
2. `pre-starts/[id].tsx` — Pre-start detail screen with crew sign-ons list, work summary, hazards discussed, PdfActions, EmailButton
3. `site-diary/[id].tsx` — Site diary detail with raw notes, AI structured log sections (activities, delays, deliveries, visitors, safety, weather)
4. `hazards/[id].tsx` — Hazard detail with severity/status badges, controls list, AI analysis card
5. `incidents/[id].tsx` — Incident detail with category badge, follow-up actions list, immediate actions
6. `inspections/[id].tsx` — Inspection detail with pass/fail/NA results summary, full checklist items with response badges

### Components wired
- `PdfActions` → all 6 detail screens (gated by `can(resource, 'view')`)
- `EmailButton` → all 6 detail screens (gated by `can(resource, 'email')`)
- `ReadOnlyBanner` → all 6 detail screens (shown when `!can(resource, 'edit')`)

### Permission gating
- Tab bar: Capture tab hidden if no capture permissions (`hasAnyCaptureOpen`)
- Capture screen: Tools filtered by `can(resource, 'open')`
- 6 index screens: Create/New buttons gated by `can(resource, 'open')`
- 6 detail screens: Edit/save hidden, ReadOnlyBanner shown if no edit perm
- Outbox badge on Home tab showing queued count

### Authentication polish
- `api.ts` interceptor handles 401 + `X-Auth-Reason` header → force logout
- `AuthContext.tsx` registers force-logout handler on mount
- `login.tsx` shows "Account disabled" banner for disabled accounts

## Web-to-mobile mapping
| Web Page | Mobile Screen | API endpoints |
|----------|--------------|---------------|
| Outbox | (tabs)/outbox.tsx | GET /email/outbox, POST /email/outbox/:id/retry, POST /email/outbox/:id/cancel |
| SWMS Detail | swms/[id].tsx | GET /swms/:id, POST /swms/:id/review |
| Pre-Start Detail | pre-starts/[id].tsx | GET /pre-starts/:id |
| Site Diary Detail | site-diary/[id].tsx | GET /site-diary/:id |
| Hazards Detail | hazards/[id].tsx | GET /hazards/:id |
| Incidents Detail | incidents/[id].tsx | GET /incidents/:id |
| Inspections Detail | inspections/[id].tsx | GET /inspections/:id |

## Known issues
- CDN tunnel (expo-whs-compliance.preview.emergentagent.com) serving stale "Preview Unavailable" — infrastructure issue, app compiles and runs on localhost:3001
- Package version warnings: expo-file-system and expo-sharing versions don't match expected SDK 54 versions (non-breaking)

## Dependencies installed
- No new dependencies (expo-file-system, expo-sharing, expo-linking were already installed in iteration 2)
