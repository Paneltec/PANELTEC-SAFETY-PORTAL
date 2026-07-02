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

---

## 8. Contractors & Suppliers

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

## 9. Plant & Vehicles

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

## 10. Sites & Site sign-on

![Sites & QR sign-on flow](/api/help/schematics/paneltec_sites_qr.png)

_Fig. Sites & QR sign-on flow._

Sidebar → **Sites**. Each site has a public QR for worker sign-on. Coming-soon features in this section: scheduled site closures, geofenced auto-sign-out, and the supervisor dashboard for live headcount. Full release in a near-term phase — until then, the sign-on QR works end-to-end for sign-in records.

---

## 11. Certifications & Inductions

### Adding a certification
Sidebar → **Certifications** → **+ Add certification**. Pick the worker, choose the cert type (White Card, First Aid, Working at Heights, etc.), enter issue/expiry dates, attach the certificate PDF or photo. Save.

### Renewal reminders
The system auto-emails the worker 30/14/7 days before any cert expires (subject to Comms Safe Mode). Admins can see all renewals on the **Renewal Links** page.

### Live Inductions Matrix
Sidebar → **Workers** → **Inductions Matrix**. A grid view of every worker × every induction type. Filter by status. Multi-select rows → **Print selected** to generate a single PDF pack.

### Worker ID cards + lanyards
Workers list → row → **Print ID card** generates an A6 card PDF with photo, name, role, induction summary and a back-side QR linking to the worker's public compliance record. A lanyard-format variant is available from the same menu.

---

## 12. Audit Exports

![Audit pack contents & delivery](/api/help/schematics/paneltec_audit_exports.png)

_Fig. Audit pack contents & delivery._

Sidebar → **Audit Exports** → **+ New audit pack**. Choose the date range and the modules to include (SWMS, pre-starts, hazards, incidents, inspections, contractor compliance, certifications). Click **Generate**.

The pack produces **two artefacts at the same time**:

- **JSON** — machine-readable bundle for ingestion into external audit tooling.
- **PDF** — a paginated branded report with cover page, table of contents, embedded photos, signed evidence, and an audit-trail appendix.

Download both from the audit pack row. Scheduled exports (weekly / monthly auto-runs) ship in a future phase.

---

## 13. Comms Safe Mode

![Comms Safe Mode kill switch flow](/api/help/schematics/paneltec_comms_safe_mode.png)

_Fig. Comms Safe Mode kill switch flow._

### What it is
Comms Safe Mode is a kill switch that intercepts every outbound email (Microsoft 365) and SMS (TextMagic) at the org level. When `on`, no real worker or contractor receives any communication — messages are logged to the **blocked outbox** with the full payload preserved for inspection.

### When it's on
You'll see an orange **COMMS SAFE MODE** chip in the top-right of every page when it's active. It's intentionally enabled during onboarding and testing to prevent accidental mass-emails to real recipients.

### Viewing blocked messages
Sidebar → **Settings → Comms Safe Mode**. The table shows every blocked message with timestamp, channel, recipient, subject and reason. Useful for verifying your invite/renewal flow is sending the right content before going live.

### Turning it off when going live
Edit `/app/backend/.env`, set `COMMS_SAFE_MODE=off`, then `sudo supervisorctl restart backend`. The orange chip disappears and outbound comms resume.

---

## 14. Mobile app (PWA)

### Installing
See **Section 1 — Getting started**.

### Biometric / Face ID setup
First sign-in on a PWA install asks you to enrol biometric unlock. Tap **Set up Face ID / Fingerprint** when prompted; the credential is stored in your device's secure enclave (never on our servers). Subsequent app launches skip the password screen and unlock with biometric only.

### Pull-to-refresh module config
The mobile home screen shows only the modules your role + permissions allow. If your admin enables a new module while you're signed in, pull down on the home screen to refresh the layout — no sign-out required.

### Offline behaviour
The PWA pre-caches the app shell + your last-viewed module screens. If you lose signal mid-capture, draft forms are saved to local storage and sync to the server when you're back online. Photos are queued in the same local outbox and uploaded in order. The orange dot on the home screen indicates pending offline records.

---

## 15. Troubleshooting & FAQ

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
