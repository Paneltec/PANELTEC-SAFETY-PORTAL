# Paneltec Civil — User Manual

_Last updated for paneltec-v137 · Web platform · Australian English_

Welcome to Paneltec Civil — the connected WHS compliance platform built for Australian civil contracting and construction teams. This manual walks you through every screen and feature you'll touch day-to-day. If you only read one section, make it **Getting started** below; everything else can wait until you need it.

---

## Platform Overview

Paneltec Civil is a WHS compliance platform purpose-built for Australian civil construction teams. This diagram shows how the pieces fit together — from the people who use it, through the modules that capture and process work, to the integrations that keep it all in sync, and the reports that come out the other end.

![Paneltec Civil architecture](/api/help/schematics/paneltec_architecture.png)

_Fig 1. Platform architecture — personas, modules, integrations and outputs._

## A day in the life

Here's what a typical shift looks like from a worker's perspective through to the admin dashboard and audit trail:

![Paneltec Civil user journey](/api/help/schematics/paneltec_user_journey.png)

_Fig 2. User journey — from sign-in through site arrival, daily work capture, AI processing, live dashboard, to reports and audit._

---

## 1. Getting started

### What Paneltec Civil is and who it's for
Paneltec Civil is an all-in-one safety, compliance and analytics portal for civil contractors. It replaces spreadsheets, shared drives, and chase-up emails with a single source of truth covering SWMS, pre-starts, hazards, incidents, inspections, contractor compliance, certifications, and audit-ready exports. It's designed for foremen, project managers, safety officers, plant operators, contractors and back-office admins — each role sees the screens and modules relevant to their work.

### Signing in
Open the portal at your organisation's URL (for example `https://paneltec.com.au` or your internal preview link). You have three sign-in options:

- **Email + password** — the most common path. Enter your work email and your password, then click **Sign in →**.
- **Simpro SSO** — if your org has Simpro connected, click **Sign in with Simpro**. You'll be bounced to Simpro to authenticate, then returned to Paneltec.
- **PIN redeem** — if your admin sent you a one-time PIN via SMS or email, open `/onboard?token=…` from the link in the message, then enter the PIN.

If you forget your password, click **Forgot password?** below the form. You'll receive a one-time reset link by email. Five failed sign-in attempts lock the account for 15 minutes — your admin can unlock it sooner if needed.

### Setting your password the first time
When an admin invites you, you'll receive an email (or SMS) with a one-time link to `/onboard?token=…`. Click it, set a password that scores at least **Good** on the strength meter, confirm, and you'll land straight on the dashboard. The link expires in 24 hours; ask your admin to re-send if it's lapsed.

### Changing your password
From inside the app: click your avatar (top-right) → **My profile** → **Change password**. You'll need to enter your current password, then the new one twice. The same strength meter applies. You're signed out of all other sessions after the change.

### Installing the PWA
Paneltec runs as a Progressive Web App — install it to your home screen and it behaves like a native app, with biometric unlock and offline-tolerant pages.

- **iOS (Safari):** Tap the Share icon → **Add to Home Screen** → **Add**.
- **Android (Chrome / Edge):** Tap the three-dot menu → **Install app** (or **Add to Home screen** on older Android).

The home-screen tile is the orange Paneltec chevron on slate-900. If you installed before the v116 rebrand, your tile may still be cobalt — re-install to refresh it (the in-app banner walks you through the steps the first time you sign in as a PWA installer).

---

## 2. Your account

Your avatar in the top-right of every page opens the account panel. From here you can control the security and behaviour of your own session.

**Session timeout** — how long your browser stays signed in before it drops you back to the login screen. Options range from 15 minutes (kiosk-safe) through the 12-hour default up to 7 days for trusted personal devices. The setting applies only to the browser you save it in.

**Suspicious-login alerts** — when a sign-in arrives from a new device or location, we ping you with a one-tap "That wasn't me" link that revokes the session and forces a password reset. Choose Both / Email / SMS / Off. When Comms Safe Mode is on, alerts are captured but not delivered — the panel calls that out with an amber banner.

**Change password** — opens a small modal that requires your current password and the new one twice. Sessions elsewhere are not signed out; use "Active sessions" to revoke those.

**My apps** — a quick view of the third-party integrations your organisation has connected (Simpro, Navixy, Microsoft 365, TextMagic, MongoDB) and their current health. Full configuration lives under Settings → Integrations.

**Users & permissions** (admin-only) — jumps straight to the org's users, roles and workspace access matrix.

**Clear cache & reload** — wipes local caches and reloads the app. Use this if the UI feels stuck after a deploy. Any unsaved work will be lost, so save first.

**Top-bar pills** — the small `● API · 5/5` and `● BACKUP` chips are live health indicators. Green = all up, amber = partial, red = down. Click either for a per-integration or per-backup breakdown.

---

## 3. The dashboard (Live Compliance Dashboard)

The dashboard is your daily landing page. It's split into three columns:

- **Create & Capture (left)** — quick links into the six main field captures (AI SWMS, Daily Pre-Starts, Site Diary, Hazard Reports, Incident Reports, Inspection Reports).
- **Compliance Snapshot (centre)** — your six rolling metrics for the quarter (SWMS, pre-starts, site diary, hazards, incidents, inspections), plus the Compliance Attention Score. Mint banner = strong; amber/red banners surface specific records needing attention.
- **Ask Intelligence (right)** — the AI briefing for what needs management attention now, with cited evidence. Click **Explore Ask Intelligence →** to ask your own question.

Below the three columns is the **Records needing attention** stream — auto-surfaced from the system: overdue inspections, near-expiry certs, contractor renewals due in the next 7 days, and any incidents flagged in the last 24 hours. Click any row to jump to it.

The header carries the **User Manual** button (you're reading it now), the workspace switcher, the search box, the notifications bell, and your avatar menu.

---

## 4. Module dashboards

Every major module (SWMS, Hazards, Incidents, Inspections, Sites, Plant & Vehicles, Workers, Certifications, Audit Exports) opens onto its own **Dashboard tab** — an at-a-glance analytics view tuned to that module's data. It's the default landing tab; the familiar list you're used to sits one click away under **List**.

**What you get on every module dashboard**

- **Hero band** — dark-navy header with the module name, tagline, live refresh timestamp, and the module schematic on the right for context.
- **KPI tiles** — 4–5 slate-900 tiles with the numbers that matter for that module (e.g. Total SWMS · Drafts · Approved · AI-parsed for SWMS; Open · Closed this week · High-severity for Hazards). Where a KPI doesn't yet have a data source, the tile shows `0` with a small "Coming soon" tooltip instead of a fabricated number.
- **Charts** — one or two recharts visualisations (bar / line / donut) driven by real aggregation off the same collections that back the list. Every module gets a 12-month trend (or 30-day, where appropriate) plus a status/type breakdown donut.
- **Records needing attention** — top 5 rows from that module that need someone's eyes right now (e.g. SWMS awaiting sign-off, high-severity open hazards, overdue inspections). Click any row to jump into the record.
- **Quick actions** — the primary "Create X" and "View list" buttons in the module's accent colour.

**Live refresh**

Dashboards fetch `GET /api/dashboards/{module}` on mount and re-poll every 60 seconds. A 60-second per-org cache sits behind the endpoint so multiple simultaneous viewers don't hammer MongoDB — the hero band shows a small "cache hit · 60 s window" chip when you're inside that window. If nothing has changed you'll still see the tiles update to the latest generated_at.

**Where to find each module's dashboard**

- SWMS → Sidebar → SWMS → Dashboard tab
- Hazards → Sidebar → Hazards → Dashboard tab
- Incidents → Sidebar → Incidents → Dashboard tab
- Inspections → Sidebar → Inspections → Dashboard tab
- Sites → Sidebar → Sites → Dashboard tab
- Plant & Vehicles → Sidebar → Vehicles → Dashboard tab
- Workers → Sidebar → Users & Workers → Dashboard tab
- Certifications → Sidebar → Certifications → Dashboard tab
- Audit Exports → Sidebar → Audit Exports → Dashboard tab

These are separate from the org-wide **Live Compliance Dashboard** (Section 3); that stays as your one-page rollup across every module.

---

## 5. SWMS — Safe Work Method Statements

![SWMS lifecycle](/api/help/schematics/paneltec_swms.png)

_Fig. SWMS lifecycle — Create → AI parse → Review & approve → Issue & track._

### Creating a SWMS from scratch
1. Sidebar → **AI SWMS** → **+ New SWMS** (top-right).
2. Fill the task name, location, hazards, controls, PPE, and responsible person.
3. Save as **Draft** to keep editing, or **Submit for review** to send it to your approver.

### Paste SWMS from text or Word
If you already have a written SWMS in Word, Outlook, or an email body:

1. Sidebar → **AI SWMS** → **Paste SWMS** (the icon next to + New).
2. Paste the full text into the textarea. The character counter shows you're under the 12,000-character limit.
3. Click **Parse with AI**. The AI extracts task, hazards, controls and PPE into the structured fields. Review, correct anything wrong, then **Save**.

### Scan SWMS from a signed paper copy
1. Sidebar → **AI SWMS** → **Scan SWMS**.
2. Drag in a PDF (or take a photo with your phone camera).
3. The backend runs OCR + AI parse, attaches the original signed copy as evidence, and pre-fills the SWMS form.
4. Confirm details, then **Save**. The signed PDF stays attached for audit.

### Reviewing and approving a draft
Approvers see a yellow **Drafts pending review** pill at the top of the SWMS list. Open a draft, scroll the AI-parsed sections, then click **Approve** (or **Send back for changes** with a comment).

### Bulk delete + 30-day Recycle Bin
Select multiple SWMS rows via the checkboxes → **Delete selected**. Deleted SWMS go to the Recycle Bin (top of the SWMS list, dropdown) and can be restored within 30 days. After 30 days they're permanently purged.

---

## 6. Hazards, Incidents, Inspections, Pre-starts

All four are captured the same way:

1. Sidebar → choose the report type.
2. Click **+ New** (top-right).
3. Fill the form. **Photo upload** is supported on every type — drag photos in or use your phone's camera. The AI runs hazard analysis on photos and pre-fills suggested hazard tags and severity.
4. Save as **Draft** or **Submit**.

### PDF reports
Every submitted report renders to a branded PDF (orange/slate). Open the record and click **Download PDF** (top-right). For hazards and incidents, the PDF includes the embedded photos and the AI-suggested control measures.

### Mobile capture
The PWA runs the same forms on your phone. Tap **+** from the dashboard, choose the report type, fill the fields and take photos in-app. The form keeps a local draft if you lose signal — sync resumes when you're back online.

---

## 7. Workers, Users & Permissions

![Worker onboarding & access](/api/help/schematics/paneltec_workers_access.png)

_Fig. Worker onboarding & access._

### Adding a worker
Sidebar → **Workers** (under Settings) → **+ Add worker**. Fill name, mobile, email, role, induction status. If your Simpro integration is connected, workers sync automatically — manual adds are for crew not in Simpro.

### Sending an invite
Workers list → row action menu → **Send invite**. Choose the channel (email or SMS) — both deliver a one-time PIN + a redeem link. The pill on the worker row updates: `Invite pending` → `Active` once they redeem.

### Bulk invite (paste-a-list)
Users list → **Bulk invite** (top-right, next to **Invite user**). Paste any number of emails — commas, spaces, semicolons and newlines all count as separators. Hit **Parse** to see a preview table splitting the list into three columns:

- **New** — email is validly formatted and not already in your org. These are the only rows that will actually get sent.
- **Already exists** — matched an existing user by email (case-insensitive). Skipped silently on submit.
- **Invalid** — didn't parse as `x@y.z`. Skipped.

Pick a default **Role** (worker / manager / admin) and a **Channel** (Auto / Email / SMS), then **Send N invites**. A progress bar walks each row through the standard `POST /users` endpoint one at a time; per-row ✓ sent / ✗ failed appears live in the table. A summary toast fires at the end. All messages respect Comms Safe Mode — blocked deliveries land in the outbox instead of hitting the network.

### Generating a one-time PIN
Same menu → **Generate PIN** if email/SMS isn't appropriate. You'll see a 6-digit PIN and a copyable redeem URL — share via your usual secure channel.

### Resetting a password / unlocking a locked account
Sidebar → **Users & Permissions** → find the user → row action menu → **Reset password** or **Unlock**. Reset sends a one-time link; unlock clears the 15-minute lockout flag.

### Per-role permission matrix
Sidebar → **Users & Permissions** → click any user → **Permissions** tab. You'll see a checkbox grid of every resource (SWMS, hazards, incidents, etc.) crossed with view/create/edit/delete. Admin role has everything; operator and viewer roles are pre-set; you can flip individual cells per user.

### Mobile App Modules per role
Same Permissions tab → **Mobile Modules** section. Each module (Daily Pre-Start, Hazard Capture, Site Diary, etc.) has a per-role toggle. Disabling a module hides it from that role's mobile home screen — pull-to-refresh updates the config without a re-sign-in.

### Roles are canonical in Simpro
Sidebar → **Roles Admin**. This is the master list of every role your org uses. You cannot create custom roles here anymore — press **Sync from Simpro** (blue button, top-right) to pull every unique Simpro employee position and mirror it here. Each imported role starts with zero permission tokens; open its matrix to grant tokens per-resource. System roles (Admin, Manager, HSEQ Lead, Auditor, Supervisor, Worker) remain read-only. If a Simpro position no longer matches a user's locked role, an orange drift banner surfaces at the top of Roles Admin so you can unlock or override per user.

---

## 8. HR Employees Register

The HR Employees register is the employer-of-record roster (currently 121 employees). It sits alongside the Workers list — Workers is field-oriented (who's on site, what SWMS they've signed, what certifications are expiring), HR Employees is admin-oriented (payroll references, next-of-kin, DOB, address, employment status).

### How data gets in
- **Initial seed** — an XLSX file `hr_employees_source.xlsx` is auto-ingested at startup on first run (idempotent — subsequent restarts skip the ingest).
- **Ongoing refresh** — press **Refresh from Simpro** (blue button, top-right) to re-parse the on-disk source. Simpro doesn't expose an HR endpoint, so the on-disk XLSX is treated as the sync boundary for now.
- **No manual create form** — there is no "+ Add employee" button on this page. If you need to add an employee, drop them into the XLSX source and click Refresh.

### Active vs Archived tabs
Two tabs at the top of the table:
- **Active** — every employee currently on the roster.
- **Archived** — employees marked archived via the drawer's **Archive** action. Archiving keeps the record + audit trail but hides it from the Active view. Restore via the drawer.

Delete (both inline row-button and drawer header) does a soft-delete: the record stays in Mongo with `deleted_at` set. Archive is orthogonal — you can archive without deleting, or delete without archiving.

### PII controls
Date of Birth, home Address, and Next-of-Kin phone/relationship are masked by default. Each field has a **Reveal** button that unmasks the value and writes an audit row (`hr_employees_audit`) capturing who revealed what and when. Reveals are gated by the `hr_employees.reveal_pii` permission token.

### Sparse-column display
The table shows a subset of columns (name, employee_id, role, employment_status, archived flag) — everything else surfaces in the row drawer's **Detail** tab. Filter dropdowns above the table cover role, employment status, and archived state. The search field indexes name, employee_id, and email.

### `linked_worker_id` reserved
Every HR Employees record carries a reserved `linked_worker_id` field for the future Employees↔Workers linker (so a payroll record can point at the field record). It's patchable via the drawer but no endpoint consumes it yet — coming in a future release.

---

## 9. Program Schematic

Sidebar → **Program Schematic** (under Settings). A single-page SVG topology diagram showing every module in Paneltec Civil connected to the central control panel. Six clusters, colour-coded:

- **Overview** (sky blue) — Intelligence Centre, Ask Intelligence, Document Library, Outbox.
- **Capture** (orange) — AI SWMS, Pre-Starts, Site Diary, Hazards, Incidents, Inspections.
- **Compliance** (emerald) — Risk Assessments, Contractors, Suppliers, Renewals, Audit Exports.
- **Register** (indigo) — Workers, Vehicles, Sites, Forms.
- **Settings** (violet) — split into Access (Organisation, Workspaces, Users & Perms, Roles Admin, Perm Presets, System) and Data & Automation (Certifications, Form Assignments, SWMS Assignments, Backup, Comms Safe).
- **Integrations** (amber) — Simpro, Navixy, Microsoft 365, TextMagic.

Click any node to open its module. On narrow screens the canvas scrolls horizontally so icons stay full-size — no pinch-zoom needed. Print (Ctrl+P) exports the schematic as a landscape one-pager for onboarding decks.

---

## 10. Backup & Restore

Sidebar → **Backup & Restore** (Settings). Real MongoDB snapshots to GridFS + optional LAN mirror.

### Snapshot cadence
Two APScheduler cron jobs run automatically:
- **Every 6 hours** — rolling backup, retained per the schedule below.
- **Mon–Fri 17:00 Sydney** — daily close-of-business snapshot.

The **Schedule** card on the page introspects the running scheduler and shows the exact cron + next-run for each job — no editable UI here, cadence is fixed.

### Retention
Every snapshot is retained per this rolling policy: `7d keep-all`, then `30d daily`, then `26w weekly`, then `forever monthly`. Older snapshots are hard-deleted automatically.

### LAN destinations
Add SMB shares under **Destinations** with `{host, share, username, password}`. Passwords are encrypted at rest with Fernet (AES-128-CBC + HMAC, keyed by `BACKUP_DEST_ENC_KEY`) — the plaintext never touches disk after write. For agents that run inside the NAS itself (no SMB round-trip), set `kind: "local_agent"` — the agent's LAN report unlocks a "DELIVERED (LOCAL MOUNT)" state instead of expecting SMB.

### Backup pill in the top nav
The green **Backup** LED in the header polls `/api/health/backup` every 60s and shows: last snapshot age, size, and destination count. Click it for the popover with the same detail. Grey means no snapshots yet.

### Restore semantics
The Restore panel carries a yellow banner: MongoDB `_id` fields regenerate on restore, but Paneltec Civil's UUID `id` fields are preserved — so foreign-key references (`worker_id`, `swms_id`, etc.) survive a restore intact.

---

## 11. Simpro integration

Simpro is the source of truth for staff, positions/roles, vendors, and jobs. Paneltec Civil consumes Simpro on-demand:

### The five Simpro sync buttons
All are styled in Simpro-brand blue (`#0093D0`) with white text so they're impossible to miss:
- **Users & Permissions → Refresh from Simpro** — pulls the latest employee list, updates linked user rows, refreshes photos.
- **Roles Admin → Sync from Simpro** — pulls every unique Simpro employee position and mirrors it as a role here (this replaces the old "+ Create custom role" button, which has been removed — roles are canonical in Simpro).
- **Certifications → Refresh from Simpro** — pulls both Paneltec + Viatec worker certifications in one call via `POST /workers/sync-from-simpro` with `company: 'both'`.
- **HR Employees → Refresh from Simpro** — re-parses the on-disk XLSX source (see §8).
- **Workers → Sync from Simpro** (split button in the toolbar), **Suppliers → Sync from Simpro** (toolbar + empty-state) — company-scoped pulls.

Each button shows a spinner + "Refreshing…" state with a 500 ms minimum-visible floor so a fast round-trip still registers as a click.

### Integration health
The top-nav **API · N/5** pill polls `/api/health/integrations` every 60s. Click it for a popover with per-integration LED dots: green = live traffic possible, amber = degraded, red = down. Rows are clickable — they deep-link to the corresponding admin config page under `/app/settings/integrations/*`.

Simpro is an **on-demand** integration, so a green "Ready" state is normal even if the last actual call was hours or days ago — that's not "stale", that's idle.

### Simpro secrets at rest
All Simpro API tokens are Fernet-encrypted (`INTEGRATIONS_ENC_KEY`) on the `integration_configs` doc — the plaintext is only rehydrated in memory when a request is about to fire.

---

## 12. Contractors & Suppliers

### Importing from Simpro
Sidebar → **Suppliers** → **Import from Simpro** (top-right). Choose the vendor list, map fields if needed, click **Import**. Existing suppliers are matched by ABN; new ones are created with `Source: Simpro` pill.

### Renewal links workflow
Sidebar → **Renewal Links**. Each row is a contractor with an expiring document (insurance, licence, SWMS). Click **Send renewal link** — the contractor receives an email with a public URL `/renew/:token` where they can upload the updated document. The submission lands in your inbox for approval.

### Public QR resolvers
The QR codes on the worker / supplier / site cards resolve via short tokens:

- `/scan/worker/:token` — opens the worker's compliance card on any phone (no login).
- `/scan/site/:token` — opens the site sign-on page.
- `/scan/supplier/:token` — opens the supplier's renewal portal.

Print the QR via the asset / supplier / worker row's **Print** action.

---

## 13. Plant & Vehicles

![Plant & Vehicles telemetry sources](/api/help/schematics/paneltec_plant_vehicles.png)

_Fig. Plant & Vehicles telemetry sources._

### Asset list and QR codes
Sidebar → **Plant & Vehicles**. Each asset has a QR menu on the row:

- **Print** — generates a printable card with the QR.
- **Copy scan link** — copies the public URL to clipboard.
- **Download PNG** — saves the QR as a PNG.

### Live Counters
Each asset has a **Live Counters** panel with two tabs:

- **Total** — lifetime engine hours and odometer.
- **This Week** / **Last Month** — sparkline deltas with daily resolution (Recharts).

Below the live counters is the **Today's Trip** card with three tabs (Today / Week / Month). Each shows distance, drive time, idle time, max speed, and a km-per-day sparkline. Data comes from Navixy's `/v2/track/list` and is cached for 60 seconds.

### Adding a historical meter reading manually
Every asset's **Live Counters** card has a **"…"** overflow trigger in the top-right (right next to Refresh now on Navixy-tracked assets, or next to the panel title on manual-only assets). Click it to open **Add historical reading**:

1. Pick a **Date** (defaults to today; max = today, past dates always allowed).
2. Enter **Engine hours (total, cumulative)** and / or **Odometer (total, cumulative km)** — you can submit one or both, whichever you have.
3. Client-side check: if there's a snapshot already on file for a later date, we won't let you save a bigger value against an earlier date (that would break the delta chain). Same-day corrections are allowed — the backend upserts.
4. **Save reading**. A toast confirms, the asset auto-refreshes, and the source pill on the affected metric flips to **Manually entered** on the next render.

The old inline "+ Add a historical reading" button on the unreliable-odometer card still works too — it's kept as a shortcut for the specific case where a Navixy device returns an empty counter set (Kroll Recycler XT04CS pattern).

### Understanding source pills
Each metric carries a small label explaining where the number came from:

- **Synced from Navixy · panel counter** — authoritative, from the device's onboard odometer.
- **Synced from Navixy · mileage report** — derived from Navixy's report API (rare on this plan).
- **Estimated · sum of all trips since first sync** — lifetime tracks aggregation (fallback).
- **GPS-derived (no panel counter)** — rolling track-window estimate (least accurate).
- **Manually entered** — admin-keyed snapshot.

---

## 14. Sites & Site sign-on

![Sites & QR sign-on flow](/api/help/schematics/paneltec_sites_qr.png)

_Fig. Sites & QR sign-on flow._

Sidebar → **Sites**. Each site has a public QR for worker sign-on. Coming-soon features in this section: scheduled site closures, geofenced auto-sign-out, and the supervisor dashboard for live headcount. Full release in a near-term phase — until then, the sign-on QR works end-to-end for sign-in records.

---

## 15. Certifications & Inductions

### Adding a certification
Sidebar → **Certifications** → **+ Add certification**. Pick the worker, choose the cert type (White Card, First Aid, Working at Heights, etc.), enter issue/expiry dates, attach the certificate PDF or photo. Save.

### Renewal reminders
The system auto-emails the worker 30/14/7 days before any cert expires (subject to Comms Safe Mode). Admins can see all renewals on the **Renewal Links** page.

### Live Inductions Matrix
Sidebar → **Workers** → **Inductions Matrix**. A grid view of every worker × every induction type. Filter by status. Multi-select rows → **Print selected** to generate a single PDF pack.

### Worker ID cards + lanyards
Workers list → row → **Print ID card** generates an A6 card PDF with photo, name, role, induction summary and a back-side QR linking to the worker's public compliance record. A lanyard-format variant is available from the same menu.

---

## 16. Audit Exports

![Audit pack contents & delivery](/api/help/schematics/paneltec_audit_exports.png)

_Fig. Audit pack contents & delivery._

Sidebar → **Audit Exports** → **+ New audit pack**. Choose the date range and the modules to include (SWMS, pre-starts, hazards, incidents, inspections, contractor compliance, certifications). Click **Generate**.

The pack produces **two artefacts at the same time**:

- **JSON** — machine-readable bundle for ingestion into external audit tooling.
- **PDF** — a paginated branded report with cover page, table of contents, embedded photos, signed evidence, and an audit-trail appendix.

Download both from the audit pack row. Scheduled exports (weekly / monthly auto-runs) ship in a future phase.

---

## 17. Comms Safe Mode

![Comms Safe Mode kill switch flow](/api/help/schematics/paneltec_comms_safe_mode.png)

_Fig. Comms Safe Mode kill switch flow._

### What it is
Comms Safe Mode is a kill switch that intercepts every outbound email (Microsoft 365) and SMS (TextMagic) at the org level. When `on`, no real worker or contractor receives any communication — messages are logged to the **blocked outbox** with the full payload preserved for inspection.

### When it's on
You'll see an orange **COMMS SAFE MODE** chip in the top-right of every page when it's active. It's intentionally enabled during onboarding and testing to prevent accidental mass-emails to real recipients.

**Top-bar API pill behaviour** — while Safe Mode is on, the **Microsoft 365** and **TextMagic** rows in the integrations popover show **red** with a small `🛡 disarmed` chip next to the name and the detail _"Disarmed by Comms Safe Mode"_. That's expected. The lights answer the question _"will this integration actually fire outbound traffic right now?"_ — and the answer is no, because you've deliberately disarmed it. A yellow banner at the bottom of the popover reminds you of this. The moment you lift Safe Mode both lights re-arm on the next 60 s refresh (or immediately if you close and re-open the popover; the cache key includes the safe-mode flag).

**Idle green is normal for on-demand integrations** — the **Simpro** row shows **🟢 Ready** even if you haven't clicked _Import from Simpro_ in days. Simpro is called on demand (when you fetch a worker, vendor, site, or job) rather than on a continuous sync schedule, so an idle green light is the correct state. It only flips amber if a recent call errored, and only flips red if credentials are missing or errors have persisted for more than 24h. The **Navixy** row, by contrast, IS a continuous-sync integration — its green state means an asset has synced within the last 60 minutes, and it will flip amber if the sync loop stalls.

**Click any row to jump to its config** — every integration row in the popover (except MongoDB, which is infrastructure) is a deep link into its admin page under **Settings → Integrations → &lt;provider&gt;**. Hover reveals an orange left-edge accent stripe and a right-chevron. The popover closes on navigation.

### Viewing blocked messages
Sidebar → **Settings → Comms Safe Mode**. The table shows every blocked message with timestamp, channel, recipient, subject and reason. Useful for verifying your invite/renewal flow is sending the right content before going live.

### Turning it off when going live
Edit `/app/backend/.env`, set `COMMS_SAFE_MODE=off`, then `sudo supervisorctl restart backend`. The orange chip disappears and outbound comms resume.

---

## 18. Mobile app (PWA)

### Installing
See **Section 1 — Getting started**.

### Biometric / Face ID setup
First sign-in on a PWA install asks you to enrol biometric unlock. Tap **Set up Face ID / Fingerprint** when prompted; the credential is stored in your device's secure enclave (never on our servers). Subsequent app launches skip the password screen and unlock with biometric only.

### Pull-to-refresh module config
The mobile home screen shows only the modules your role + permissions allow. If your admin enables a new module while you're signed in, pull down on the home screen to refresh the layout — no sign-out required.

### Offline behaviour
The PWA pre-caches the app shell + your last-viewed module screens. If you lose signal mid-capture, draft forms are saved to local storage and sync to the server when you're back online. Photos are queued in the same local outbox and uploaded in order. The orange dot on the home screen indicates pending offline records.

---

## 19. Troubleshooting & FAQ

- **"My changes aren't showing"** — Hard refresh (Cmd/Ctrl + Shift + R). Paneltec's service worker auto-detects new versions and prompts a reload, but a manual hard refresh always works.

- **"A tile bounced me back to login"** — This shouldn't happen on the current build; if it does, screenshot the URL and report to your admin. Likely a stale route from an older deploy.

- **"PDF won't open in my browser"** — Some ad-blockers strip PDF responses. Open in an incognito window or use the inline preview by clicking the PDF row in the audit pack list.

- **"Camera permission denied"** — iOS / Android both require explicit camera permission. Settings → Safari/Chrome → Camera → Allow for `paneltec.com.au`.

- **"Lifetime odometer is wrong on a vehicle"** — Likely no Navixy panel counter for that device. Open the asset, scroll to **Live Counters**, click **+ Add a historical reading** and enter the correct total km. Future trip deltas anchor off your reading.

- **"I'm locked out"** — Five failed sign-ins triggers a 15-minute lockout. Either wait it out or ask your admin to unlock via **Users & Permissions → Unlock**.

- **"My phone is still showing the old cobalt app icon"** — iOS and Android cache home-screen icons aggressively. Remove the app from your home screen and re-install via Share / browser menu → Add to Home Screen.

- **"The SWMS paste didn't work"** — Make sure you pasted into the **Paste SWMS** dialog (not the regular SWMS form). The dialog handles Word/Outlook combined HTML+plain-text payloads safely; the regular form expects keyboard input.

---

_For anything not covered here, contact your organisation's Paneltec administrator. They have direct support escalation to the Paneltec team._
