/* Paneltec Civil — service worker.
 * Strategy:
 *   - index.html / navigation requests: NETWORK-FIRST with cache fallback.
 *     This prevents the "stale chunk reference" bug where a cached HTML
 *     points at a JS chunk hash that no longer exists on disk, causing the
 *     UI to load yesterday's bundle (which surfaced as the phantom
 *     "ReferenceError: refreshToken is not defined" on /app/ask).
 *   - Static hashed assets (CSS/JS/images/manifest): cache-first with
 *     background refresh. These are immutable once built so caching is safe.
 *   - API (/api/*): NETWORK-ONLY. Never intercept or cache. Stale 401s
 *     from cache previously caused phantom "logged out" loops.
 *
 * Bump CACHE_VERSION whenever this file changes.
 *
 * v69 — Forced reset path. Activate handler now hard-purges EVERY cache
 *       that doesn't carry the current `paneltec-v69` prefix and broadcasts
 *       `paneltec_sw_force_reload` to all open clients so they refresh once.
 *       Pairs with the backend `Clear-Site-Data` middleware (cookie-gated)
 *       so visitors with a stuck older SW self-heal on next API hit.
 * v76 — Inductions Matrix gains inline PDF preview alongside download via the
 *       existing PdfPreviewModal. Touches InductionsMatrix.jsx,
 *       PdfPreviewModal.jsx, and the backend print endpoint (mode flag).
 * v77 — Phase 3.12 Induction Card popup: every induction card / matrix cell
 *       opens InductionCardModal (detail view + iframe doc preview + edit /
 *       add / file upload). New backend endpoints under
 *       /workers/{wid}/inductions/...
 * v81 — Phase 3.16 Session Timeout: backend org settings + active_sessions
 *       + per-role JWT lifetimes + force-logout-all. Frontend gets the
 *       useSessionTimeout hook driving SessionWarningModal inside AppShell.
 * v82 — Phase 3.16 Part A+B: BSON-Date fail-SAFE normalisation in
 *       session_timeout.py (+ pytest cover), Settings → Session Timeout
 *       admin card (idle/absolute/warning/remember-me/per-role overrides/
 *       force-logout-all), and "Keep me logged in" checkbox on /login
 *       gated by GET /api/settings/login-options.
 * v83 — Phase 3.17 Certifications row actions: 👁 View PDF (PdfPreviewModal),
 *       ✏️ Edit (PATCH /workers/certifications/{id}), 🗑 Delete with proper
 *       confirmation modal (DELETE /workers/certifications/{id}, admin-only).
 * v84 — Phase 3.18 Granular permissions + Active Sessions panel:
 *       `delete` action added to ACTIONS, new resources (workers, inductions,
 *       certifications, documents, forms), HSEQ Lead loses delete by default.
 *       Cert/induction/worker DELETE routes now flow through require_permission
 *       so admins can grant per-user delete via override. UsersManagement
 *       gains a ✏️ Edit-permissions icon button + matrix search field.
 *       Live "Active sessions" panel inside the Session Timeout card
 *       (GET /api/admin/active-sessions + DELETE /api/admin/active-sessions/{jti}).
 * v85 — Phase 4.1 SWMS Assignments admin + version-chain commit:
 *       POST /api/swms now auto-chains: same title+org_id with bumped
 *       version archives the old row (status=superseded, superseded_by) and
 *       inserts a fresh one with supersedes pointer. Same version → in-place
 *       update (idempotent). GET /swms hides superseded unless
 *       ?include_superseded=true. New /swms/{id}/history (DFS, capped at 20
 *       hops). Backfill endpoint POST /admin/swms/backfill-version-chain
 *       (admin only). SWMS Assignments two-pane admin page with bulk mode.
 * v85.1 — Phase 3.14b "Add to Renewal Links" workflow promotion:
 *       Contractors page gets 3-tab strip (All · Needs renewal link ·
 *       Has active link), checkbox column, per-row "Add to Renewal Links"
 *       button (`contractor-add-renewal-{id}`), and a bulk toolbar button
 *       (`contractor-bulk-renewal`). Modal posts to /renewals or
 *       /renewals/bulk with doc-type chips + expiry. Backend: GET
 *       /contractors now decorates rows with `has_active_renewal_link` and
 *       supports `?missing_renewal_link=true`. POST /renewals/bulk is
 *       idempotent (skip rows already covered by a pending link).
 *       Also: Phase 4.1 history walker is now BIDIRECTIONAL — calling
 *       /history on the LATEST node returns the same chain as the OLDEST.
 * v85.2 — Phase 3.15 Navixy health-dot accuracy fix.
 *       Root cause: `hours_meter_updated_at` only ticks when the meter VALUE
 *       changes; parked-but-online vehicles never got a fresh timestamp so
 *       the health-dot read them as stale. Now sync stamps a dedicated
 *       `navixy_last_seen_at` on every reachable device via a single bulk
 *       /v2/tracker/get_states probe covering the entire fleet. Histogram
 *       flipped from 1 green / 71 red → 72 green / 0 red on the first
 *       post-fix sync tick.
 * v86 — Phase 4.2 frontend (Part A) + 4.1c diff endpoint + 3.14c search
 *       + 3.15+ last_position_time:
 *       · Public `/scan/site/:token` SiteScanResolver page (auth-aware
 *         CTA: signed-in users sign on directly; anon users bounce
 *         through /login?next=… and auto-return).
 *       · `GET /api/swms/{id}/diff/{previous_id}` returns set-diffs of
 *         hazards/controls/ppe/activity_analysis (added/removed/unchanged)
 *         + a header with from/to versions+dates for the auditor UI.
 *       · `GET /api/contractors?search=` server-side regex on name/abn/
 *         simpro_vendor_id (closes the tester WARN from 3.14b).
 *       · Navixy sync now also harvests `last_position_time` from
 *         get_states and stores it as `navixy_last_position_time` so admins
 *         can see Navixy-side vs our-poll timestamps side-by-side.
 * v96 — Phase 3.20 (Wave 2) Fluent icon migration across AppShell + 16
 *       list pages (62 lucide swaps → @fluentui/react-icons). ESLint
 *       no-undef tightened to error to block undefined JSX at build.
 * v96.2 — Cache-propagation fix. Two reasons users were still seeing the
 *       pre-Fluent icons after v96 shipped:
 *         (1) Page-side `RELOAD_GUARD` was a single static string so only
 *             the FIRST SW upgrade in a browser session triggered the
 *             auto-reload — every subsequent version (incl. v96) was
 *             silently dropped. Now keyed per-version.
 *         (2) In DEV mode `registerServiceWorker()` returned early without
 *             unregistering stale prod SWs already controlling the tab —
 *             those zombies kept serving cached chunks. Dev mode now
 *             unregisters every SW + drops every cache on page load.
 * v99.1 — Phase 3.22b. Migrated Incident, Inspection, Pre-Start, and
 *       Site Diary report PDFs to the shared `pdf_template` (orange +
 *       slate, 18mm margins, evidence-sufficiency line, full timeline
 *       + signatures section on every report). Card-style PDFs
 *       (Worker ID / Supplier lanyard / Site gate sign) and long-form
 *       (SWMS / Certs / Inductions print / Form submission) still on
 *       legacy path — migrate in 3.22c/d.
 * v101 — Phase 3.23 Audit Exports dual JSON+PDF artefact:
 *       · `POST /api/audit-exports` now auto-writes a PDF sibling
 *         whenever the user picks JSON or CSV (best-effort — never
 *         breaks the primary export).
 *       · `POST /api/audit-exports/{id}/render-pdf` admin-only
 *         on-demand renderer for packs missing their PDF sibling.
 *       · `scripts/backfill_audit_pack_pdfs.py` idempotent script
 *         to backfill historical JSON packs (logs migrated /
 *         skipped_already_dual / failed counts).
 *       · Frontend `AuditExports.jsx` groups rows by composite key
 *         (title + period + scope + workspace) and renders inline
 *         "PDF · JSON" download links. Amber warning chip appears
 *         when a row is missing a format — admin click triggers the
 *         render-pdf endpoint and refreshes the table.
 * v102 — Phase 3.22c + 3.22d. EVERY PDF report in the app now flows
 *       through the shared 2-colour brand (orange #F97316 + slate
 *       #1E293B). Zero `HexColor(...)` calls outside the three brand
 *       modules: `pdf_brand.py`, `pdf_template.py`, `pdf_card_template.py`.
 *       · 3.22c — `pdf_card_template.py` shipped with `header_band`,
 *         `chevron`, `qr_image`, `qr_block`, `pairing_zone`,
 *         `footer_brand`, `cut_guide`. Migrated: Worker wallet/lanyard
 *         ID, Asset A6 label, on-metal label, combo (QR+NFC) label,
 *         Avery L7160 21-up sheet, Supplier lanyard, Supplier business
 *         card, Site gate sign, Site Avery 30-up sheet.
 *       · 3.22d — `pdf_renderer.py` brand tokens point at the new
 *         palette so SWMS (both civil + rich activity-analysis layout),
 *         Form submission, Certifications and Renewals print PDFs
 *         inherit orange + slate automatically. Inductions Matrix
 *         print (`/api/workers/inductions/print`) also migrated.
 *         Old violet NFC pairing zone replaced with dotted orange.
 * v103 — Phase 4.3 Mobile App Module allocator (per-role visibility):
 *       · Backend `mobile_modules.py` — `GET /api/settings/mobile-modules`,
 *         `PUT /api/settings/mobile-modules` (admin, audit-logged),
 *         `GET /api/me/mobile-modules` (any user → flat boolean map for
 *         their role). Admin row is force-true on every PUT so the
 *         lock can't be bypassed by a hand-crafted payload.
 *       · Web — new "Mobile App Modules" tab on the Permissions Matrix
 *         page (re-titled from "Permission presets"). 13 modules × 4
 *         roles toggle grid; admin column locked; "All on / All off"
 *         per-role shortcuts; sticky orange Save bar; reset-to-clean
 *         action. No API enforcement yet — visibility only.
 *       · Expo mobile work handed off to `e1_expo_frontend_dev` to
 *         consume `/api/me/mobile-modules` on login + foreground and
 *         hide bottom-tab / drawer entries set to `false`.
 * v104 — Phase 4.4 Live mobile preview inside Permissions Matrix:
 *       · Backend: `GET /api/me/mobile-modules?as_role=...` admin-only
 *         preview of another role's module set (silently ignored for
 *         non-admins; usage logged at INFO).
 *       · Web: phone-bezel iframe pinned to the right of the matrix
 *         grid, role-switcher dropdown, Reload + open-in-new-tab
 *         controls. iframe points at the Expo web build with
 *         `preview_role` + `preview_token` query params. Explicitly
 *         decoupled from grid toggles — only reflects SAVED config so
 *         admins never see a misleading "preview-only" state.
 *       · Mobile hand-off written: query-param wiring is the only
 *         change required in the Expo app for this phase.
 * v105 — Phase 4.5 SWMS paste-to-create + bulk soft-delete + recycle
 * v106 — Phase 4.6 SWMS scan upload (PDF / JPG / PNG) + OCR + Claude
 *       parse + signed-evidence attachment. Shared `parse_swms_text`
 *       helper now powers both `/from-paste` and `/from-scan`. New
 *       `/api/files/swms_scans/{name}` route serves the auditor copy.
 *       PyPDF2 fallback in place when poppler/tesseract aren't on
 *       the host (graceful degrade for text-embedded PDFs). Toast on
 *       success now offers "Open in editor" → `?highlight=ai_filled`.
 * v107 — Phase 4.7 BACKEND — Worker invites, reset, PIN, lockout:
 *       · `POST /api/users/{id}/invite` (admin) — email+SMS magic
 *         link, 7-day JWT, audit-logged.
 *       · `POST /api/auth/invite/validate` (public, rate-limited).
 *       · `POST /api/auth/invite/redeem` (public) — sets password,
 *         bumps token_version, returns a normal login JWT.
 *       · `POST /api/users/{id}/reset-password` (admin) — 24-h JWT.
 *       · `POST /api/auth/reset/redeem` (public).
 *       · `POST /api/auth/forgot-password` (public) — always 200, no
 *         email enumeration leak; per-email + per-IP throttle.
 *       · `POST /api/users/{id}/pin` (admin) — 6-digit, 24-h, bcrypt
 *         hashed; PIN returned ONCE to admin.
 *       · `POST /api/auth/pin/redeem` (public).
 *       · `POST /api/users/{id}/unlock` (admin) + `record_login_attempt`
 *         hook into `auth.login` → 5 fails / 15 min lockout, 423.
 *       · `GET  /api/users/{id}/access-status` — admin status pill data.
 *       · Centralised `validate_password_rule` (10 chars, letter+digit+
 *         special). Audit-logged everywhere. PUBLIC_HOST derived from
 *         X-Forwarded-Host. Frontend onboard/reset/forgot/access UI
 *         + ChangePasswordModal queued for next turn.
 *
 * v108 — Phase 4.7 WEB UI shipped (token-driven password flows + admin UX):
 *       · Public routes: `/onboard?token=` (invite redeem) and
 *         `/reset?token=` (admin- or self-initiated reset) rendered
 *         OUTSIDE the `AppShell`. Shared `PasswordPanel` enforces the
 *         backend rule (10 chars / letter / digit / special) with a
 *         live strength meter, and on error states surfaces a
 *         "Need help? Contact your administrator" footer so workers
 *         can't dead-end on an expired link.
 *       · `MustChangePasswordGuard` wraps the authenticated `/app/*`
 *         layout. Reads `must_change_password` from `/auth/me` and
 *         pins a non-dismissable `ChangePasswordModal` until the user
 *         complies — backstop for admin-initiated rotations + first
 *         logins via PIN.
 *       · Login page gains a "Forgot password?" link that opens
 *         `ForgotPasswordModal`. Always reports success (no email
 *         enumeration) regardless of the backend's 200.
 *       · AppShell user dropdown gains a "Change password…" entry
 *         that opens the modal in unlocked mode for self-serve
 *         rotations.
 *       · UsersManagement: per-row "Access…" kebab exposes Send invite
 *         / Generate PIN / Reset password / Unlock (gated by current
 *         user.status). User drawer Profile tab now renders the full
 *         `AccessSection` with channel picker, live status pill and
 *         PIN reveal modal.
 *       · `setToken(token)` helper added to `lib/auth.js` — persists
 *         the redeem JWT, then hydrates `/auth/me` so the rest of
 *         the app sees a populated user object before navigating to
 *         `/app`.
 *
 * v109 — Phase 4.7.1: tester sweep + Workers list access controls.
 *       · Bug fix (#1) — `AccessKebab` now opens `ChannelPickerDialog`
 *         (Auto / Email / SMS) on Send invite + Reset password and POSTs
 *         the chosen channel, fixing the backend's "Field required" 422
 *         that the original "no body" call produced.
 *       · Bug fix (#2) — `/reset?token=` now pre-flights via the new
 *         `POST /api/auth/reset/validate` endpoint (mirror of
 *         `/invite/validate`). A bogus / expired / used token renders
 *         the friendly "Link can't be used" panel + help footer
 *         instead of dumping the worker into a password form.
 *       · Workers list (`pages/Workers.jsx`): each row now resolves
 *         its linked `users` record by email and renders either an
 *         `AccessKebab` (Send invite / Reset / PIN / Unlock) OR a
 *         "+ Login" button that POSTs `/api/users` with role=worker,
 *         splices the resulting user into the in-memory map and lets
 *         the admin invite immediately. Includes a small Invite-pending
 *         / Active / Locked / Disabled pill beneath the existing active
 *         badge. Worker-role viewers see neither (the `/users` fetch
 *         403s and the map stays empty).
 *       · Shared `AccessKebab` extracted out of `UsersManagement.jsx`
 *         into `components/auth/AccessKebab.jsx` so the Users admin and
 *         the Workers list use the same handlers.
 *       · `AccessSection` (drawer Profile tab) channel dropdown
 *         retired — same picker dialog reused for consistency.
 *
 * v110 — Phase 4.7.2: three regressions + one dead button.
 *       · Fix #1 — `/login` and `/` both open `ForgotPasswordModal`.
 *         Cover.jsx's "Forgot password?" link was a `<Link to="/forgot-
 *         password">` to a dead route; replaced with a button that mounts
 *         the same modal used on `/login`.
 *       · Fix #2 — Users list pill flips to "Invite pending" immediately
 *         after Send invite. Backend `_user_out` now exposes derived
 *         `invite_pending` (invite_token_hash set AND expiry in the
 *         future) and `is_locked` (locked_until > now). `StatusPill`
 *         in UsersManagement derives from those flags instead of the
 *         persisted `status` field, which doesn't move on invite.
 *       · Fix #3 — `AccessKebab` now closes the picker BEFORE firing the
 *         toast + refetch. Workers list invite path was completing the
 *         POST and the refetch but the Sonner toast was rendered behind
 *         the still-open dialog overlay. Same fix lifts onto AccessSection.
 *       · Fix #4 — Plant & Vehicles row QR icon button was firing
 *         `downloadQr` silently. Now opens a `DropdownMenu` with three
 *         explicit actions: Print QR label (reuses bulk Print Labels
 *         modal pre-filtered to the asset), Copy scan link (clipboard
 *         write of `${origin}/scan/${scan_token}` with execCommand
 *         fallback), and Download PNG (the existing handler, now toasts
 *         on success).
 *
 * v111 — Phase 4.7.3 COMMS SAFE MODE (P0 kill switch).
 *       · NEW env var `COMMS_SAFE_MODE` (default "on") is the master
 *         kill switch. When ON, NO email and NO SMS leaves the box.
 *         Persisted `org_settings.comms_safe_mode` overrides only when
 *         env is OFF (env always wins for off-by-default safety).
 *       · Backend `comms_safe_mode.py`:
 *         - `is_blocked(org_id)`, `record_blocked(...)`, status + toggle
 *           routes.
 *         - `GET /api/admin/comms-safe-mode/status` → effective, env_locked,
 *           env_value, org_value.
 *         - `PATCH /api/admin/comms-safe-mode` (admin) → flips org setting;
 *           returns 423 Locked when env var is the master ON.
 *         - `GET /api/admin/comms-outbox-blocked?limit=&channel=` → audit
 *           feed of captured payloads.
 *       · Interception points: `email_outbox.queue_email_doc` (primary),
 *         `integrations_m365.graph_send_mail` (defensive), and
 *         `integrations_textmagic.tm_send` (SMS boundary before the
 *         TextMagic price/send HTTP calls).
 *       · `outbound_emails` rows now use a new `status="blocked"` value
 *         when held back so the existing email outbox UI can see them
 *         alongside live mail; STATUS_STYLES updated accordingly.
 *       · Frontend:
 *         - Persistent yellow lightning chip in TopBar ("COMMS SAFE
 *           MODE") that links to the dedicated settings page when active.
 *         - New page `/app/settings/comms-safe-mode` shows current state,
 *           env-lock pill, on/off buttons (disabled when env-locked),
 *           and a chronological list of blocked email+SMS payloads with
 *           channel filter.
 *         - Email Outbox page gets a slate-amber banner explaining the
 *           held-back state and linking to the blocked outbox.
 *       · Invite / Reset / Forgot-password / Audit-pack / Cert-reminder
 *         email paths all funnel through `queue_email_doc`, so the
 *         single intercept covers ALL of them. Verified live: invite +
 *         forgot-password both return 200 with 0 actual sends and
 *         appear as 2 rows in `comms_outbox_blocked`.
 *
 * v112 — Phase 4.8 ASSET METER TRENDS (Week + Month deltas on Live Counters).
 *       · Backend `asset_meter_history.py`:
 *         - New collection `asset_meter_history` with unique compound
 *           index on (asset_id, snapshot_date) — idempotent upserts.
 *         - APScheduler `meter_history_daily_snapshot` at 01:00 UTC daily
 *           captures `engine_hours_total` + `odometer_km_total` for every
 *           Navixy-synced asset from `assets.hours_meter` / `assets.odo_km`.
 *         - One-time `backfill_30d` fires async on startup. Probes
 *           Navixy `tracker/counter/list_history` + `list` with day-
 *           aggregation. Where the plan exposes history, rows are
 *           written with source="navixy_backfill"; otherwise the asset
 *           is marked `backfill_skipped` and the daily-snapshot anchor
 *           still seeds today's row.
 *         - `GET /api/assets/{id}/meter-trends` returns total + week
 *           + month with delta, daily averages, sparkline points, and
 *           an honest `days_available` so the UI can render a
 *           "Collecting data — N of 7 days" hint without inventing
 *           numbers.
 *       · Frontend `LiveCountersPanel.jsx`:
 *         - Tab strip (Total · This Week · Last Month) inside the
 *           existing mint-green NAVIXY block. Default = Total (no
 *           behavioural change for users who never click a tab).
 *         - Week/Month cards show signed deltas (+12 hrs / +215 km),
 *           daily averages, and a tiny recharts sparkline beneath
 *           each metric.
 *         - "Refresh now" reloads BOTH the asset (live counters) and
 *           the meter-trends payload so a successful sync immediately
 *           updates the chart.
 *
 * v113 — Phase 4.9 — Re-ship counter fix + Today/Week/Month trip data.
 *       · Part 1 (re-ship the counter fix from v113 hot-fix): Pass 0.5
 *         in `asset_navixy_sync.py` calls `/v2/tracker/get_counters`
 *         for EVERY synced asset on every cycle (warm + cold). Legacy
 *         `counter/read` / `counter/list` paths return HTTP 400 on
 *         this Navixy plan and were silently being skipped on warm
 *         assets, freezing counters at first-write. Per-sync log:
 *         `navixy.sync device_id=X hours=Y km=Z source=counters_v2`.
 *         Idempotent — `_apply_counters` refuses to overwrite a
 *         higher value with a transient lower one.
 *       · Part 2 + 3 — Today/Week/Month trip summary (Navixy):
 *         - `asset_trip_summary.py`: `GET /api/assets/{id}/trip-
 *           summary?range=today|week|month`. Calls Navixy
 *           `/v2/track/list` for the date window (org-local timezone
 *           defaulted to Australia/Sydney). Aggregates distance,
 *           drive_seconds, max_speed across `type=regular` tracks;
 *           derives idle_seconds from inter-trip gaps shorter than
 *           30 minutes. Returns daily sparkline of km. 60-second
 *           in-memory cache per (asset_id, range, org_id) keyed off
 *           repeated UI hits. Structured log:
 *           `navixy.trip_summary device_id=X range=Y distance=Z`.
 *         - `LiveCountersPanel.jsx`: new `TripSummaryCard` rendered
 *           BELOW the existing Live Counters block. 4-tile grid
 *           (distance / drive time / idle time / max speed) +
 *           Today / This Week / Last Month tab strip. Tiny orange
 *           sparkline (km per day) at the bottom of each tab.
 *           Honest "Collecting data" hint when Navixy returns gaps.
 *       · Verified on H89MY (tracker 10307562): today=21.4 km / 3
 *         trips / peak 93 km/h; week=115.4 km / 15 trips / 104 km/h;
 *         month=665.3 km / 56 trips / 117 km/h.
 *
 * v114 — Phase 4.9.1 — three production bug fixes.
 *       · Fix #1 — Odometer paradox repair (`asset_navixy_sync.py`).
 *         After every 15-min counter sync we now sweep for assets where
 *         the stored `odo_km` is LESS than the last 30 days of trip
 *         distance (e.g. truck reads 3,300 km lifetime but logged
 *         1,672.3 km this month alone — impossible for a 25-month-old
 *         vehicle). For each broken asset we try, in order:
 *           (a) `/v2/report/generate` mileage report — best-effort, the
 *               current plan returns 400 but the call is plan-upgrade-
 *               ready; on success writes `odo_km_source=navixy_report`.
 *           (b) `/v2/track/list` chunked sum from the asset's
 *               `created_at` (capped at 730 days) — writes
 *               `odo_km_source=navixy_tracks_lifetime`.
 *           (c) Both failed → stamp `lifetime_unreliable=true` so the
 *               UI can hide the misleading low number.
 *         New admin endpoint `POST /api/assets/navixy/repair-lifetimes`
 *         for manual re-runs. Idempotent. Paradox detection requires
 *         `month_km > 0` so silent / never-driven trackers aren't
 *         mis-flagged.
 *       · Fix #1 (UI half) — `LiveCountersPanel.jsx` renders a new
 *         amber `UnreliableOdoCard` when `asset.lifetime_unreliable===
 *         true`. Admins see an inline form: date + km → POST
 *         `/api/assets/{id}/meter-history`. Everyone else sees the
 *         "Lifetime not available — Add a historical reading" copy.
 *         `srcLabel` now distinguishes `navixy_report` ("mileage
 *         report") and `navixy_tracks_lifetime` ("sum of all trips
 *         since first sync") from the legacy `navixy_tracks_window`.
 *       · Fix #2 — `engine_hours` monotonicity guard
 *         (`asset_meter_history.py`). POST `/api/assets/{id}/meter-
 *         history` already returned 409 when an older snapshot's
 *         odometer exceeded a younger one — extended to enforce the
 *         same rule for engine_hours. Queries explicitly require
 *         `engine_hours_total: {$ne: null}` on the next-younger row
 *         so backfill anchors with NULL hours don't silently skip the
 *         validation. Confirms by pytest in
 *         `tests/test_navixy_trip_summary_v114.py`.
 *       · Fix #3 — Pasted text retention.
 *         `Swms.jsx PasteSwmsDialog.onPaste` now defensively re-reads
 *         `taRef.current.value` on next tick and calls setText, so the
 *         Word/Outlook combined text/html clipboard race that was
 *         dropping plain text after the html branch hijacked the
 *         render is now closed. Other surfaces audited:
 *           - `Ask.jsx` (`#ask-input`)         — no onPaste handler, paste OK.
 *           - `SiteDiary.jsx` entry field      — no onPaste handler, paste OK.
 *           - `FormSubmissions.jsx`            — no onPaste handler, paste OK.
 *           - Dialog-mounted controlled inputs — all confirmed standard
 *             controlled-input semantics.
 *
 * v115 — Phase 4.10 — brand sweep on public auth surfaces.
 *       The Phase 3.22 PDF-side brand refresh (cobalt → orange #F97316 +
 *       slate #1E293B) missed the four public auth pages, which were
 *       still rendering the old cobalt blue logo + "Sign in" buttons.
 *       Closed the gap on:
 *         · `Login.jsx` — all 7 `brand-blue` references (logo wordmark,
 *           input focus rings, "Forgot password?" link, "Sign in" CTA,
 *           "Start your free trial" link, remember-me checkbox tint)
 *           swapped to `orange-500`; `hover:bg-blue-600` →
 *           `hover:bg-orange-600`.
 *         · `Cover.jsx` — all 12 `brand-blue` references + 3
 *           `brand-blue-soft` (the numbered iOS install step circles)
 *           swapped to `orange-500` + `orange-100`. CTA hover/active
 *           gradient swapped from `blue-600/blue-700` →
 *           `orange-600/orange-700`. The slate-900 right-panel hero +
 *           stats card backgrounds and Simpro outlined button stay
 *           untouched — those were already on-brand.
 *         · `Onboard.jsx` (covers both `/onboard?token=` invite redeem
 *           and `/reset?token=` ResetPasswordPage) — password strength
 *           meter ramp swapped from the emerald/amber gradient
 *           `[rose, orange, amber, emerald, emerald-600]` to the brand
 *           palette `[slate-400, slate-500, orange-400, orange-500,
 *           orange-600]`. The rest of the page (input borders, button
 *           backgrounds, header wordmark) was already on-brand from
 *           Phase 4.7.
 *       Zero leftover `text-blue-*`, `bg-blue-*`, `border-blue-*` or
 *       `brand-blue*` classes remain on any of the three files
 *       (verified via grep). The `text-brand-blue` / `bg-brand-blue` /
 *       `ring-brand-blue` CSS variables in `index.css` are
 *       intentionally LEFT IN PLACE because they are still legitimately
 *       referenced by system/info UI states elsewhere in the app
 *       (notification dots, "info" alert chips, link colours in body
 *       copy) — brand-blue is now scoped to system semantics only.
 *       Out of scope and untouched: every logged-in `/app/*` surface
 *       (already on-brand since Phase 3.22), the mobile Expo app, and
 *       the `comms_safe_mode` infrastructure.
 *
 *       Follow-up sweep (same v115) — visual QA caught the chevron
 *       icon mark was still rendering cobalt because:
 *         a) `components/brand/Logo.jsx` hard-coded `fill="#2C6BFF"` +
 *            `stroke="#1E4FD6"` for the SVG chevron, AND coloured the
 *            "Civil" wordmark with `text-brand-blue`. All three
 *            swapped to `#F97316` / `#EA580C` / `text-orange-500`.
 *         b) `Cover.jsx` rendered `<img src="/brand/mark.png">` in two
 *            places (top-left header + above the sign-in card),
 *            pointing at the legacy cobalt-blue PNG asset. Replaced
 *            with inline SVG chevrons in orange so the brand colour is
 *            now controlled by code, not a binary asset. The old PNG
 *            stays on disk for backwards-compat with any external
 *            link or unforeseen reference, but is no longer rendered
 *            anywhere.
 *         c) `Cover.jsx` 1px left-edge accent stripe on the sign-in
 *            card was a hard-coded inline `style={{ backgroundColor:
 *            '#2C6BFF' }}` — swapped to `#F97316`.
 *
 * v116 — Phase 4.10.1 — PWA / launcher icon regeneration.
 *       The Phase 4.10 v115 sweep fixed every rendered DOM element but
 *       missed two binary asset layers that still surfaced cobalt:
 *       (1) the PWA home-screen tile (apple-touch-icon.png + the
 *       icon-*.png maskable set referenced by manifest.json), and
 *       (2) the browser theme-color meta tags (index.html +
 *       manifest.json `theme_color`). On v115 a worker who installed
 *       Paneltec Civil to their phone got an orange app launching from
 *       a cobalt home-screen tile, with a cobalt iOS status bar tint —
 *       brand break visible every single launch.
 *
 *       Changes:
 *         · New `/app/backend/scripts/regenerate_brand_icons.py` —
 *           Pillow-based rasteriser that draws the chevron polygon
 *           (same 24×24 viewBox path data as `Logo.jsx`) at every
 *           required size. Re-runnable for future brand refreshes.
 *         · `/app/frontend/public/brand/icon-192.png` — 192×192,
 *           transparent background, plain orange chevron. Manifest
 *           "any" purpose.
 *         · `/app/frontend/public/brand/icon-512.png` — 512×512, same.
 *         · `/app/frontend/public/brand/icon-maskable-192.png` — NEW —
 *           192×192 slate-900 background, 20% safe-area pad per W3C
 *           maskable spec. Manifest "maskable" purpose.
 *         · `/app/frontend/public/brand/icon-maskable-512.png` —
 *           512×512, same recipe.
 *         · `/app/frontend/public/brand/icon-monochrome-512.png` —
 *           regenerated white-on-slate for Android themed-icon engines.
 *         · `/app/frontend/public/brand/apple-touch-icon.png` —
 *           180×180 slate-900 + 12% pad. iOS rounds the corners
 *           automatically; padding stops the chevron getting clipped
 *           when the OS applies its rounded-square mask.
 *         · `/app/frontend/public/brand/mark.png` — regenerated at
 *           256×256 transparent (was 859 KB cobalt PNG, now ~1.3 KB
 *           orange — no quality loss, just a polygon at vector
 *           resolution).
 *         · `manifest.json` — `theme_color` flipped #2C6BFF → #F97316.
 *           Added icon-maskable-192 entry and icon-monochrome-512
 *           entry with `purpose: "monochrome"` so Android 13+ themed
 *           icons get the right monochrome layer.
 *         · `index.html` — `<meta name="theme-color">` flipped
 *           #2C6BFF → #F97316 so non-PWA browser chrome (Chrome on
 *           Android, Edge top bar, Safari iOS smart banner) reflects
 *           the orange brand on first paint.
 *
 *       KNOWN PWA LIMITATION: iOS and Android both cache home-screen
 *       icons aggressively — installed PWAs from v115 or earlier will
 *       continue to show the cobalt tile until the user removes and
 *       re-adds the app to their home screen, OR the OS triggers its
 *       own icon refresh cycle (typically when the manifest URL
 *       changes or the app is reinstalled). This is an OS-level
 *       behaviour, not something the SW activate handler can clear.
 *       Communicate to v115 PWA installers: "Reinstall to home screen
 *       to see the new orange tile."
 *
 * v117 — Phase 4.10.2 — in-app rebrand nudge for stale PWA installs.
 *       Closes the v116 OS-icon-cache problem at the application
 *       layer. New `components/RebrandNudge.jsx` renders a soft
 *       orange banner directly under the topbar (mounted in
 *       `layout/AppShell.jsx` between `<TopBar />` and `<main>`) when
 *       BOTH:
 *         · the session is running in standalone PWA mode (matches
 *           `display-mode: standalone` OR iOS Safari's legacy
 *           `navigator.standalone === true`), AND
 *         · `localStorage.paneltec_seen_v116_rebrand !== '1'`.
 *       The banner explains the icon-refresh step with platform-
 *       specific instructions and gives the user three exits:
 *         · "Got it" (`bg-orange-500` CTA) → sets the localStorage
 *           flag, banner gone forever on this device.
 *         · "Remind me later" → sets `sessionStorage`-only flag, so
 *           the banner reappears on next app launch but stays hidden
 *           for the rest of the current session.
 *         · "✕" icon button → equivalent to "Remind me later".
 *       Icons via @fluentui/react-icons (`PaintBrush20Regular`,
 *       `Dismiss16Regular`) — no emoji. All storage operations are
 *       wrapped in try/catch so Safari Private Mode / Lockdown Mode
 *       don't blow up the AppShell.
 *
 *       Non-PWA web sessions never see the banner — desktop browser
 *       users aren't affected by the OS icon cache problem so there's
 *       nothing to nudge them about.
 *
 * v118 — Phase 4.10.3 — authoritative marketing copy on auth surfaces.
 *       The Login.jsx right-hand dark panel was still showing day-one
 *       generator scaffolding (a placeholder eyebrow, a generic SaaS
 *       headline, a "civil contracting teams" subhead, and four
 *       hard-coded mock stat cards). The mock numbers were constants
 *       in the source — visible as fake on inspection, and at odds
 *       with Cover.jsx which has carried the user-authored copy for
 *       weeks.
 *
 *       Replaced the right-panel content with the authoritative
 *       hero block already running on Cover.jsx — eyebrow + three-
 *       line "Build" headline + subhead + four feature pills
 *       (Real-time Compliance / AI-Powered Insights / Cert Tracking
 *       / Live Analytics) with Fluent icons, slate-900 fill, 3px
 *       orange-500 left-edge accent stripe per pill, white labels.
 *       No mock data anywhere.
 *
 *       Cover.jsx — verified already shipping the same hero block in
 *       both desktop and mobile views. No copy edits needed there.
 *       Did not touch any other surface, the login form fields, the
 *       Simpro SSO flow, or the "Start your free trial" footer link.
 *
 * v119 — Phase 4.10.4 — kill the legacy hero copy + extract shared
 *       PaneltecHero component so the two surfaces can never drift
 *       apart again.
 *
 *       1. Cleanup — swept every file in /app for any trace of the
 *          legacy login placeholder phrases, including in-source
 *          comments and changelog blocks. The v118 entry above was
 *          rewritten to describe the change WITHOUT quoting the old
 *          strings — a future `grep -r "One platform for SWMS"` over
 *          the repo now returns ZERO hits.
 *
 *       2. Single source of truth —
 *          `/app/frontend/src/components/marketing/PaneltecHero.jsx`
 *          (NEW) exports a `<PaneltecHero variant="dark|cover|compact" />`
 *          component plus a frozen `PANELTEC_HERO_COPY` constant. All
 *          three call sites now render through it:
 *            · Login.jsx                  → variant="dark"   (slate-900
 *                                            panel, Fluent icons,
 *                                            orange left-edge stripes)
 *            · Cover.jsx desktop hero     → variant="cover"  (over the
 *                                            construction-site photo,
 *                                            glass-blur chips, Lucide
 *                                            icons in paneltec-gold)
 *            · Cover.jsx mobile-only      → variant="compact" (slate-900
 *                                            text on cream, no pills)
 *          Editing the eyebrow / headline / subhead / pill labels now
 *          requires touching exactly ONE file. The two surfaces cannot
 *          structurally drift apart again.
 *
 *       3. CI guard — new
 *          `/app/scripts/check_no_legacy_login_copy.sh` greps for the
 *          known-bad phrases and exits non-zero if any reappear in the
 *          source tree. Documented in PRD.md as a pre-deploy sanity
 *          check.
 *
 *       Visual verification: Playwright screenshots of /login and /
 *       confirm the hero block renders identically (modulo variant
 *       styling differences) on both surfaces, and Cover.jsx no
 *       longer pulls in the now-unused Lucide icons
 *       (ShieldCheck/Sparkles/Award/BarChart3) — those are now
 *       imported only by PaneltecHero.jsx.
 *
 * v120 — P1 hotfix — Dashboard "Users & Permissions" tile bounced to
 *       /login instead of opening the page. Single-line drift bug:
 *       `Dashboard.jsx:302` had `route: '/app/users'`, but the actual
 *       route registered in `App.js:124` is `settings/users` →
 *       `/app/settings/users`. React Router's outer wildcard
 *       `<Route path="*" element={<Navigate to="/" replace />} />` was
 *       silently catching `/app/users` and bouncing to `/` (the Cover
 *       page), which an authenticated user perceives as "kicked back
 *       to login".
 *
 *       Fix: changed the tile's `route` to `/app/settings/users`.
 *       Audit of all 9 Dashboard tile routes against App.js shows
 *       NO OTHER drift — every other tile maps to an existing route.
 *       The sidebar nav in `AppShell.jsx:79` was already correct
 *       (`/app/settings/users`), so only the dashboard tile was
 *       affected.
 *
 *       The wildcard-to-cover fallback is intentional belt-and-braces
 *       routing behaviour and stays in place. The drift was a
 *       hand-coded string mismatch, not a guard or permission bug.
 *
 * v121 — Phase 4.11 — comprehensive in-app User Manual.
 *       New top-level help surface backed by a single markdown source
 *       at `/app/backend/content/user_manual.md`. Both renderings
 *       (web HTML + branded PDF) share the same source so the manual
 *       cannot drift between the in-app reader and the downloadable
 *       artefact.
 *         · Backend — `help_routes.py` exposes `GET /api/help/manual.md`
 *           (raw markdown) and `GET /api/help/manual.pdf` (ReportLab
 *           render using the v118 `pdf_brand.py` orange/slate palette,
 *           with chevron + wordmark header band and footer page #).
 *           Both responses cached in-process for 5 min.
 *         · Frontend — `UserManual.jsx` renders the markdown with
 *           react-markdown + remark-gfm. Three-column layout: sticky
 *           TOC (H2 anchors) on the left, content in the middle with
 *           slug ids on every heading, sticky "On this page" rail
 *           (H3 anchors) on the right. Header carries a search input
 *           that highlights in-page matches with the brand
 *           orange-200 mark colour and scrolls to the first hit, plus
 *           an orange Download PDF button that streams the cached
 *           PDF for offline reading.
 *         · Mount points — Dashboard.jsx banner now carries a top-
 *           right "User Manual" button (BookOpen20Regular Fluent icon)
 *           routing to `/app/help`, and `AppShell.jsx` sidebar gains
 *           a new top-level "User Manual" nav entry under the Email
 *           outbox row so the manual is discoverable from anywhere.
 *         · Content — 13 sections covering every shipped feature in
 *           friendly Australian English with concrete step-by-step
 *           procedures: getting started + PWA install, dashboard,
 *           SWMS (incl. paste + scan + bulk delete), the four field
 *           captures, workers/users/permissions/mobile modules,
 *           contractors + renewal links + QR resolvers, plant &
 *           vehicles (live counters / trip summary / manual snapshots
 *           / source pills), sites + sign-on (coming-soon flagged
 *           where appropriate), certifications + inductions matrix +
 *           ID cards, audit exports (dual JSON+PDF), Comms Safe Mode
 *           explainer, mobile/PWA + offline, and a troubleshooting
 *           FAQ. No "Lorem ipsum" or TODO placeholders.
 */
const CACHE_VERSION = 'paneltec-v121';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PRECACHE = [
  '/manifest.json',
  '/brand/mark.png',
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Hard purge every cache that doesn't carry the current version prefix.
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !k.startsWith(CACHE_VERSION))
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
    // Broadcast a one-time reload signal. The page-side listener gates on
    // sessionStorage so it never loops.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { c.postMessage({ type: 'paneltec_sw_force_reload', version: CACHE_VERSION }); }
      catch (_) { /* noop */ }
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  // v96.2 — version probe. Client posts {type:'GET_VERSION'} via a
  // MessageChannel and we reply with the running CACHE_VERSION so the page
  // can detect when a stale prod SW is still in control.
  if (event.data && event.data.type === 'GET_VERSION') {
    const port = event.ports && event.ports[0];
    if (port) {
      try { port.postMessage({ version: CACHE_VERSION }); } catch (_) { /* noop */ }
    }
    return;
  }
});

function isHtmlNavigation(req, url) {
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  // bare "/" or paths with no file extension are SPA routes
  if (url.pathname === '/' || (!url.pathname.includes('.') && !url.pathname.startsWith('/static/'))) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // CRITICAL: never intercept API requests. Always go to network.
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML / SPA navigations — guarantees the latest chunk
  // hashes are referenced after every deploy.
  if (isHtmlNavigation(req, url)) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/'))),
    );
    return;
  }

  // Cache-first for hashed static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((resp) => {
          if (resp.ok) caches.open(STATIC_CACHE).then((c) => c.put(req, resp.clone())).catch(() => {});
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((resp) => {
        if (resp.ok && resp.type !== 'opaque') {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => caches.match('/'));
    })
  );
});
