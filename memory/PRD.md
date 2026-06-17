# Paneltec Civil — PRD & Build Log

## Original Problem Statement
Build the **web frontend** for **Paneltec Civil**, a WHS (Work Health & Safety)
compliance platform for civil contracting / construction teams. Phase 1 is
**frontend-only** with all data mocked. Real APIs land in Phase 2.

## Stack
- React 19 + CRA (craco) — `/app/frontend/`
- TailwindCSS + shadcn/ui + lucide-react + sonner (toasts)
- React Router v7
- All mocks live in `/app/frontend/src/mocks/dashboard.js` (every export commented `// MOCKED:`)
- No backend calls in Phase 1; `REACT_APP_BACKEND_URL` left intact for Phase 2

## User Personas
- **HSE Manager** — runs oversight: dashboard, attention score, audit exports
- **Site Supervisor** — captures pre-starts, hazards, SWMS, incidents
- **Contractor admin** — completes renewal links (Phase 3)
- **Workspace owner** — manages org, workspaces, integrations, users (Phase 3)

## Brand
Blue `#2C6BFF`, mint `#D1FAE5`, violet `#7C3AED`, amber `#F59E0B`, red `#EF4444`.
Display: Space Grotesk · Body: Inter. Cards: rounded-2xl, soft `shadow-card`.

---

## Phase 1 — Shipped on 2026-02-17

### Pages
| Route | Page | Notes |
|---|---|---|
| `/` | Landing | Hero, 3×3 connected workflows, dashboard preview, bottom strip, footer |
| `/login` | Login | Demo banner; mock auth via localStorage `paneltec_user` |
| `/signup` | Signup | Mock — name, org, email, password |
| `/app/dashboard` | Live Compliance Dashboard | 3-column: Capture / Snapshot / Ask Intelligence + quick-actions strip |
| `/app/settings/integrations` | Integrations | 4 cards: Simpro · M365 · TextMagic · Navixy — all "Not connected" |
| `/app/swms`, `/app/pre-starts`, `/app/site-diary`, `/app/hazards`, `/app/incidents`, `/app/inspections`, `/app/contractors`, `/app/renewals`, `/app/audit-exports`, `/app/ask`, `/app/settings/{org,workspaces,users}` | Stub | "Coming in Phase 2/3" notice cards |

### What's been implemented (2026-02-17)
- ✅ Marketing landing — hero with Unsplash hi-vis photo + floating mini-cards
- ✅ Mock auth (localStorage `paneltec_user`); protected `/app/*` routes via `<Navigate>` gate
- ✅ AppShell — collapsible desktop sidebar + mobile drawer (Sheet), top bar with workspace switcher, search, notifications bell, user menu, sign-out
- ✅ Live Compliance Dashboard fully matches the spec layout
- ✅ Integrations register (4 connectors, MOCKED, admin-pending modal)
- ✅ 13 stub routes
- ✅ Testing agent run: **100% pass**, no bugs found, no console errors (one non-blocking a11y warning noted for Phase 2 polish)

### Acceptance criteria
- [x] Landing renders all required sections
- [x] Login → dashboard navigation works
- [x] All sidebar links route to real or stub pages
- [x] Dashboard visually matches the central card scaled to full page
- [x] Integrations lists all 4 with "Not connected"
- [x] Every brand mention reads "Paneltec Civil" (no Axion)
- [x] Mobile-responsive — sidebar drawer under `md`
- [x] No console errors

---

## Backlog

### P0 — Phase 2 (next)
- Replace mock auth with real backend session (`integration_playbook_expert_v2` for JWT vs Emergent Google Auth)
- Wire dashboard metrics from `/api/*` endpoints
- AI SWMS Generator (`/app/swms`) — Claude Sonnet 4.5 draft from job brief
- Hazard Reports from Photos — image upload + AI classification (Nano Banana for thumbnails, Claude vision for classification)
- Daily Pre-Starts capture flow + QR sign-on

### P1 — Phase 2
- Incident Reports with witness statements & evidence upload
- Inspection Reports (plant, scaffold, site walk)
- Site Diary AI — voice note + photo → daily summary (Whisper + Claude)
- Ask Intelligence end-to-end RAG over captured records

### P2 — Phase 3
- Contractor Register, Renewal Links (email-driven self-serve)
- Audit Exports (Comcare / SafeWork / client packs as PDF/ZIP)
- Real integrations: Simpro user sync, Microsoft 365 email, TextMagic SMS, Navixy GPS
- Multi-workspace data scoping + role-based access

## Decisions on visual ambiguity
- Hero photo: chose a hi-vis worker silhouette from Unsplash with peach/pink radial gradient
- Used **Space Grotesk display + Inter body** (brief said "Inter/SF"; design guideline prefers less-overused fonts — Space Grotesk handles headings)
- Attention Score ring drawn as inline SVG (no chart library dep)
- Topbar notification badge hard-coded to `3` (data-driven in Phase 2)
- Workspace switcher state is local to TopBar; persistence deferred to Phase 2 multi-tenancy

## Test credentials
See `/app/memory/test_credentials.md`. Login is **MOCKED** — any non-empty
email + password works. Demo: `demo@paneltec.com` / `demo123`.
