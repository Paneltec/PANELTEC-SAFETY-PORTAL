# v58.13.132cz — Ship Memo

**Date**: 2026-04-16  
**Bundle**: `paneltec-v160.3.9.58.13.132cz`  
**Scope**: Complete mobile UI replacement — 8 new screens, 7-tab navigation.

---

## What shipped

Replaced all 26 existing mobile screens with an 8-screen mockup layout and a 7-tab bottom navigation bar.

### New Tab Bar
`HOME · QR SCAN · OUTBOX · FLEET · MY WORK · PROFILE · ASK AI`

### Screens

| # | Screen | Description | Data Source |
|---|--------|-------------|-------------|
| 1 | **Login (PIN)** | Existing PIN login preserved | ✅ `POST /api/auth/mobile/pin-login` |
| 2 | **Home** | Intelligence Briefing + Compliance list + Quick Actions | ⚠️ **MOCKED** AI briefing + compliance list. ✅ `GET /api/mobile/daily-jobs/today` wired for today's assignment. |
| 3 | **My Records** | Records grouped by type (Pre-Starts, Hazards, Incidents, Inspections, SWMS) | 🔴 **MOCKED** — `/api/mobile/records/mine` returns 404 |
| 4 | **New Pre-Start (QR)** | QR scanner → auto-fill → inspection checklist form | ⚠️ **MOCKED** — No submission endpoint. Camera works on native only. |
| 5 | **Home + Notification** | Notification banner toggle on Home screen | ⚠️ **MOCKED** — No push notification wiring |
| 6 | **Ad-hoc Job Detail** | Job card with site, time, contact, notes | ⚠️ **MOCKED** fallback if no live assignment |
| 7 | **Signed On** | Site sign-on status with timer + sign-off button | ⚠️ **MOCKED** — No sign-on endpoint |
| 8 | **Profile** | User info, nav links, sign out | 🔴 **MOCKED** — `/api/users/me` returns 401. Uses stored session data. |

### Placeholder Tabs
- **Outbox** — empty state ("All caught up")
- **Fleet** — "Coming soon" placeholder
- **Ask AI** — suggested questions + mock response (🔴 **MOCKED** — no AI endpoint)

---

## MOCKED Endpoints (flagged RED in-app)

Every mocked UI element displays a red `MOCK` badge or banner in the app.

| Endpoint | Status | Used By |
|----------|--------|---------|
| `/api/mobile/records/mine` | 404 | My Records (My Work tab) |
| `/api/users/me` | 401 | Profile screen |
| AI daily briefing | Not implemented | Home Intelligence Briefing |
| Pre-start submission | Not implemented | QR Scan form |
| Site sign-on/off | Not implemented | Signed On view |
| Ask AI chat | Not implemented | Ask AI tab |

## REAL Endpoints Wired

| Endpoint | Screen |
|----------|--------|
| `POST /api/auth/mobile/pin-login` | Login |
| `GET /api/auth/mobile/device-hint` | Welcome back flow |
| `GET /api/mobile/daily-jobs/today` | Home today's assignment |

---

## Archived
- 26 old screens moved to `app/_archived_pre_132cz/`
- Visitor wizard (`app/visitor/`) preserved

## Known Issues
- Web preview CORS blocks `POST /api/auth/mobile/pin-login` (works on native)
- `expo-notifications`, `Sentry` native, `Reanimated 4` remain disabled

## Post-Ship
- **⚠️ Re-bake the Program Schematic** — the Mobile section is now stale after this UI replacement
- Wire real endpoints as backend implements them
- Re-enable `expo-notifications` and `Sentry` native after native device testing
