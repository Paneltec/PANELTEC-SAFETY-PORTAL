# Paneltec Civil — App Audit v56

Route walkthrough with `stephen@paneltec.com.au` (Admin). Ran via
Playwright at 1440×900 on 2026-08-04. This is a **scan and list**
pass — no bugs were fixed here. Sort by severity and triage together.

## Method
- Load each authenticated route.
- Assert no JS pageerror event.
- Assert `document.body.scrollWidth <= window.innerWidth` (no page
  horizontal overflow).
- Assert a `<h1>` / `<h2>` heading exists.
- Snapshot count of `[data-testid]` present on the page.
- **No** attempt was made yet to click every button or fill every form.

## Route table — 40 routes covered

| # | Route | Loaded | H-overflow | JS errs | Heading | testIds | Notes |
|-:|:------|:------:|:----------:|:-------:|:--------|-------:|:------|
| 1  | `/app/dashboard`                       | ✅ | ✅ | 0 | Good morning, Stephen. | 150  | Live tiles render.
| 2  | `/app/ask`                             | ✅ | ✅ | 0 | Ask Intelligence | 97   | |
| 3  | `/app/swms`                            | ✅ | ✅ | 0 | Safe Work Method Statements | 139  | |
| 4  | `/app/pre-starts`                      | ✅ | ✅ | 0 | Daily Pre-Starts | 1580 | Very testid-heavy — likely per-row IDs; sanity-fine. |
| 5  | `/app/site-diary`                      | ✅ | ✅ | 0 | Site Diary | 80   | |
| 6  | `/app/hazards`                         | ✅ | ✅ | 0 | Hazard Reports | 1678 | Per-row testids; sanity-fine. |
| 7  | `/app/incidents`                       | ✅ | ✅ | 0 | Incident Reports | 196  | |
| 8  | `/app/inspections`                     | ✅ | ✅ | 0 | Inspection Reports | 154  | |
| 9  | `/app/risk-assessments`                | ✅ | ✅ | 0 | Risk Assessments | 88   | |
| 10 | `/app/contractors`                     | ✅ | ✅ | 0 | Contractor Register | 114  | |
| 11 | `/app/suppliers`                       | ✅ | ✅ | 0 | Suppliers | 71   | |
| 12 | `/app/renewals`                        | ✅ | ✅ | 0 | Renewal Links | 111  | |
| 13 | `/app/audit-exports`                   | ✅ | ✅ | 0 | Audit Exports | 105  | |
| 14 | `/app/vehicles`                        | ✅ | ✅ | 0 | Plant & Vehicles | 932  | **See P2-01** below (Maintenance sub-tab). |
| 15 | `/app/sites`                           | ✅ | ✅ | 0 | Sites | 93   | |
| 16 | `/app/document-library`                | ✅ | ✅ | 0 | Document Library | 359  | |
| 17 | `/app/forms`                           | ✅ | ✅ | 0 | Form Templates | 340  | |
| 18 | `/app/outbox`                          | ✅ | ✅ | 0 | Email outbox | 160  | |
| 19 | `/app/profile`                         | ✅ | ✅ | 0 | My Profile | 74   | |
| 20 | `/app/help`                            | ✅ | ✅ | 0 | Paneltec Civil User Manual | 127  | v56 search UX applied. |
| 21 | `/app/settings/org`                    | ✅ | ✅ | 0 | Organisation | 84   | |
| 22 | `/app/settings/workspaces`             | ✅ | ✅ | 0 | Workspaces | 73   | |
| 23 | `/app/settings/integrations`           | ✅ | ✅ | 0 | Integrations | 83   | |
| 24 | `/app/settings/comms-safe-mode`        | ✅ | ✅ | 0 | Comms Safe Mode | 236  | |
| 25 | `/app/settings/integrations/simpro`    | ✅ | ✅ | 0 | *(no <h1>/<h2>)* | 106  | **See P3-01**. |
| 26 | `/app/settings/integrations/navixy`    | ✅ | ✅ | 0 | *(no <h1>/<h2>)* | 78   | **See P3-01**. |
| 27 | `/app/settings/integrations/microsoft365` | ✅ | ✅ | 0 | *(no <h1>/<h2>)* | 77   | **See P3-01**. |
| 28 | `/app/settings/integrations/textmagic` | ✅ | ✅ | 0 | *(no <h1>/<h2>)* | 74   | **See P3-01**. |
| 29 | `/app/settings/users`                  | ✅ | ✅ | 0 | Users & permissions | 638  | |
| 30 | `/app/settings/schematic`              | ✅ | ✅ | 0 | Program Schematic | 127  | v56 grid replaced SVG. |
| 31 | `/app/settings/permission-presets`     | ✅ | ✅ | 0 | Permissions Matrix | 240  | |
| 32 | `/app/settings/roles-admin`            | ✅ | ✅ | 0 | Roles Admin | 414  | v55.4: "Create custom role" removed. |
| 33 | `/app/settings/workers`                | ✅ | ✅ | 0 | Workers | 959  | |
| 34 | `/app/settings/hr-employees`           | ✅ | ✅ | 0 | HR Employees | 308  | |
| 35 | `/app/settings/form-assignments`       | ✅ | ✅ | 0 | Form Assignments | 137  | |
| 36 | `/app/settings/swms-assignments`       | ✅ | ✅ | 0 | SWMS Assignments | 80   | |
| 37 | `/app/settings/system`                 | ✅ | ✅ | 0 | Server Tools | 1595 | testids include per-integration cards. |
| 38 | `/app/settings/certifications`         | ✅ | ✅ | 0 | Certifications | 418  | |
| 39 | `/app/settings/backup`                 | ✅ | ✅ | 0 | *(no <h1>/<h2>)* | 99   | **See P3-01**. |
| 40 | `/app/settings/my-apps`                | ✅ | ✅ | 0 | My apps | 72   | |

## Routes not covered by this pass
- `/app/swms/new`, `/app/swms/:id`, `/app/pre-starts/new`,
  `/app/site-diary/new`, `/app/hazards/new`, `/app/incidents/new`,
  `/app/inspections/new`, `/app/contractors/new`,
  `/app/contractors/:id`, `/app/sites/:id`,
  `/app/document-library/:folderId`,
  `/app/forms/templates/:templateId/submissions` — every "new / detail"
  route was skipped because they need param seeding or a real record
  to load. Deferred to a second audit pass.
- Public routes (`/`, `/login`, `/signup`, `/onboard`, `/reset`,
  `/renew/:token`, `/scan/*`, `/print/*`) — excluded (audit is
  authenticated-only).

## Issues surfaced by the walkthrough

### P1 — Blocker
_None. Every route loaded without JS errors._

### P2 — Bug (fix before next release)

- **P2-01 · Plant & Vehicles / Maintenance sub-tab** — STATUS column
  clipped to "Clos…" on ≤1200px viewports. Root cause: outer
  container had `overflow-hidden` while inner grid was pinned to
  1130px. **Fixed in v56** in `PlantMaintenanceTab.jsx`
  (switched to `overflow-x-auto` + `min-w-[1130px]` inner wrap).
  Verification pending on live re-visit at 1024px.

### P3 — Polish

- **P3-01 · Missing top-level heading on 5 pages**
  - `/app/settings/integrations/simpro`
  - `/app/settings/integrations/navixy`
  - `/app/settings/integrations/microsoft365`
  - `/app/settings/integrations/textmagic`
  - `/app/settings/backup`
  These 5 pages render content but no `<h1>` / `<h2>` at top level —
  audit heuristics can't confirm the page title matches its route. Not
  a functional bug; accessibility / SEO friction only. Add a
  `<PageHeader>` with the module name for consistency with every
  other admin page.

- **P3-02 · High testid counts on `pre-starts` (1580),
  `hazards` (1678), `workers` (959), `vehicles` (932),
  `system` (1595)** — these are per-row `data-testid` grants which
  can slow the DOM at very large record counts. Not a bug, but if
  you see UI lag on those pages once records exceed ~2,000, consider
  gating the per-row testids behind an env flag or Playwright
  fingerprint.

- **P3-03 · No offline / stale-check for `/app/dashboard`** — page
  loads happy path but doesn't yet show a network-lost banner if the
  backend is unreachable (would fall through to skeletons only).
  Nice-to-have.

## What this audit did NOT cover
1. **Deep interaction paths** — button click testing, form fill +
   submit, modal open/close, sort/filter combinations. Every route
   here was just a "does it paint?" check. Deep interaction paths
   need a second pass.
2. **Mobile-portrait viewports (≤480px)** — this pass was 1440×900
   only. The v56 schematic grid was independently verified at
   360/768/1280 (see `/tmp/schem_v56_grid_*.png`), but other pages
   were not re-checked at narrow widths.
3. **Auth transitions** — MFA flow, password-reset, forced password
   change, session expiry, refresh-token rotation. All routes here
   were entered from an already-authenticated Admin session.
4. **File uploads** — no attachment upload was attempted.
5. **Cross-integration flows** — e.g. running a real Simpro sync,
   confirming the resulting DB delta.

## Recommended follow-up audits
1. **Deep interaction audit** — click every button on every page,
   log any dead-clicks or handler errors. ~3-4 hours of Playwright.
2. **Mobile-portrait audit** — re-run this route walk at 360/420/480
   widths, look for horizontal overflow.
3. **Data-boundary audit** — for each list route, load with 0 records,
   1 record, and 200 records; confirm empty-state / loading /
   pagination behave.
