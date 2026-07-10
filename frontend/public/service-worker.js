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
 *
 * v122 — Phase 4.11.1 — micro-polish.
 *       · `Dashboard.jsx` banner — added `pr-32 sm:pr-40` to the
 *         eyebrow + H1 inside the banner so the absolute-positioned
 *         "User Manual" button at top-right no longer visually
 *         collides with "PANELTEC CIVIL INTELLIGENCE CENTRE" /
 *         "Live Compliance Dashboard". Button stays in place; the
 *         heading row just reserves the right-side gutter.
 *       · `help_routes.py` — replaced the 5-minute hard-coded TTL
 *         with mtime-based invalidation. `_CACHE["mtime"]` is
 *         compared against `MANUAL_PATH.stat().st_mtime` on every
 *         request; mismatch → re-read markdown + invalidate PDF
 *         cache. Both dev edits AND prod redeploys (where the
 *         markdown file's timestamp changes) pick up new content
 *         instantly with zero backend restart. Dropped the unused
 *         `import time`.
 *
 * v123 — Phase 4.11.2 — User Manual button position fix.
 *       User feedback: "could you position the user manual tab to a
 *       different position, it is over some wording at the moment
 *       about 15 mm up should work." The v121 implementation used
 *       `absolute top-5 right-5` which still overlapped the banner
 *       copy on some viewport widths even after the v122 `pr-32 sm:pr-40`
 *       padding gutter. Permanent fix: dropped the absolute positioning
 *       entirely and switched the banner to a flex layout — left
 *       column carries eyebrow + H1 + lede, button gets its own
 *       column (top-aligned, `self-start`, `shrink-0`). No further
 *       overlap is possible regardless of viewport width or copy
 *       length because the button now consumes its own flex track.
 *       The `pr-32 sm:pr-40` heading padding is no longer needed and
 *       was removed.
 *
 * v124 — Phase 4.11.3 — sticky TOC + anchor rail fix on User Manual.
 *       User reported the left TOC and right anchor rail scrolled with
 *       the main content instead of staying anchored on screen.
 *       Two-part fix:
 *         (1) Moved `position: sticky` from an inner <div> directly
 *             onto the <aside> grid items themselves so the sticky
 *             element IS the direct grid child — no extra wrapper to
 *             confuse the containing-block resolution.
 *         (2) Added `items-start` to the grid container + `self-start`
 *             to each aside so grid's default `align-items: stretch`
 *             doesn't make the sidebars fill the full row height —
 *             which would technically defeat sticky positioning
 *             because the sticky element would already span the
 *             entire scroll range.
 *       Also added `max-h-[calc(100vh-6rem)] overflow-y-auto` per
 *       sidebar so a long TOC scrolls internally instead of pushing
 *       the page when more sections land in future content updates.
 *
 * v125 — Phase 4.4.1 — sticky Mobile App Modules preview panel.
 *       Same regression family as v124 but on
 *       `components/settings/MobileModulesSection.jsx` →
 *       `<PhonePreview>` aside. The existing `lg:sticky lg:top-4`
 *       only stuck the panel at 16px from the viewport top, which is
 *       BELOW the 64px AppShell topbar — so the bezel slid under the
 *       topbar and looked like it was scrolling away with the matrix
 *       grid. Swapped to `lg:top-20` (80px, clears the topbar) and
 *       added `lg:self-start lg:max-h-[calc(100vh-6rem)]
 *       lg:overflow-y-auto` so a tall bezel scrolls internally on
 *       shorter viewports rather than getting clipped behind the
 *       topbar. Grid container already carries `items-start` from
 *       Phase 4.4, no change needed there.
 *
 * v126 — Phase 4.11.4 — P1 hotfix: AppShell sidebar scrolled with
 *       page content on long pages.
 *
 *       Root cause: `SidebarShell <aside>` had no height constraint
 *       and no sticky positioning. With the AppShell root flex row
 *       defaulting to `align-items: stretch`, the sidebar grew to
 *       the FULL document height on any long page (User Manual,
 *       Permission Presets Mobile Modules matrix, etc.) — so when
 *       the page scrolled, the sidebar scrolled with it. Only the
 *       sidebar's inner `<nav overflow-y-auto>` was prepared to
 *       handle scroll; the outer aside never got a viewport-height
 *       bound.
 *
 *       Fix: added `sticky top-0 h-screen` to the SidebarShell
 *       <aside>. The sidebar is now a viewport-tall column anchored
 *       to the top of the page. Internal `<nav overflow-y-auto>`
 *       handles any rail content that overflows the viewport height.
 *       Pages that were already short (Dashboard, SWMS list,
 *       Vehicles) see no behaviour change; pages that grew tall
 *       enough to push the sidebar off-screen (User Manual,
 *       Permission Presets) now see the sidebar pinned in place as
 *       intended. One-line change.
 * v127 — Phase 4.12 Sites + QR sign-on. New backend endpoints under
 *        /api/sites for manual-site CRUD, soft-delete + recycle bin,
 *        per-site sign-on questions and a public visitor sign-on path
 *        (`/scan/site/{token}/sign-on-visitor`). Frontend gains Add /
 *        Edit / Recycle-bin modals in SitesAdmin plus dynamic-question
 *        rendering + GPS capture + visitor name/company/phone form in
 *        SiteScanResolver. Sign-ons now carry GPS distance from site
 *        (warn-only at >250m) and the dynamic answers list.
 * v128 — Phase 4.12.1 mobile resolver fix. `GET /api/assets/{id}/meter-
 *        trends` and `/trip-summary` now also accept a numeric Navixy
 *        tracker_id (falls back to a `navixy_device_id` lookup) so the
 *        Expo app stops 404-ing when it passes upstream IDs. Logged as
 *        `assets.id_resolver via tracker_id=X → asset_id=Y`.
 * v129 — Phase 4.13. Killed duplicate /login route — redirects to /.
 *        Single login surface (Cover.jsx) eliminates random crane-vs-
 *        black-panel flip on refresh. All internal links + the 401
 *        axios interceptor + the AppShell idle-timeout redirect now
 *        target `/` instead of `/login`.
 * v130 — Phase 4.11.5. User Manual gains a colourful platform-schematic
 *        block (`/api/help/schematics/{filename}`). Two full-width
 *        diagrams — architecture and user-journey — now render at the
 *        top of `/app/help` in the browser AND inside the downloaded
 *        PDF (ReportLab `Image` flowable, proportionally scaled to
 *        page width). No other manual copy changed.
 * v131 — Phase 4.14. Rolled the colourful platform schematics across
 *        the app. Six new module diagrams (SWMS, Sites+QR, Plant &
 *        Vehicles, Workers, Audit Exports, Comms Safe Mode) embedded
 *        in the corresponding User Manual sections and, via a new
 *        `<HowThisWorks />` collapsible card, on each module's main
 *        page (Dashboard, /app/swms, /app/sites, /app/vehicles,
 *        /app/settings/users, /app/audit-exports, /app/settings/
 *        comms-safe-mode). Panel open/closed state persists per-slug
 *        in localStorage. Schematic PNGs added to the precache list.
 * v132 — Phase 4.15. Dashboard capture tiles gained a colourful hero
 *        emblem — 96×96 rounded PNG served from `/api/help/tiles/` in
 *        the same mtime-cached pattern as the schematics. On image
 *        load failure the tile silently falls back to the original
 *        pastel Fluent-icon square. Thirteen emblems shipped: SWMS,
 *        Hazards, Sites, Plant, Workers, Certs, Suppliers, Audit,
 *        Incidents, Inspections, Pre-starts, Documents, Ask
 *        Intelligence. All added to the SW precache list.
 * v133 — Phase 4.16. Tech-aesthetic top-bar refresh: new ApiHealthPill +
 *        BackupPill (green LED dots polling `/api/health/integrations`
 *        and `/health/backup` every 60s), plus a rebuilt orange-avatar
 *        user pill. Clicking the pill opens a rich dark-navy dropdown
 *        card with session-timeout picker, suspicious-login alert
 *        segmented buttons (both/email/sms/off backed by new
 *        `PATCH /api/me/suspicious-alerts`), Change-password, My apps
 *        (new stub page listing integrations), Users & permissions
 *        (admin-only), and Clear-cache-&-reload with a confirm. User
 *        Manual updated with a "Your account" section.
 * v134 — Phase 4.17 v134.0 + partial v134.1. Per-module analytics dashboards.
 *        Backend: `/api/dashboards/{module}` aggregator registry — SWMS,
 *        Hazards, Incidents, Inspections, Sites, Plant & Vehicles, Workers,
 *        Certifications and Audit Exports are ALL live with real
 *        aggregation (60s per-org cache; `dashboards.query` structured
 *        logs). Frontend: shared dark-navy `<ModuleDashboard />` (recharts
 *        + orange tech aesthetic) is mounted inside a `<Tabs>` layout on
 *        SWMS, Hazards, Incidents and Inspections (Dashboard is the
 *        default tab; List keeps every pre-v134 affordance intact). User
 *        Manual gets a new "Module dashboards" section and the whole
 *        section list has been re-sequenced (1–15) to fix the v133
 *        numbering drift.
 * v135 — Phase 4.17 v134.1 checkpoint. Sites, Plant & Vehicles, Workers,
 *        Certifications and Audit Exports pages still need their
 *        Dashboard-tab mount — aggregators are live and verified via
 *        curl, waiting only on the frontend Tab wrapping. Cache bump so
 *        stuck-SW browsers pick up the SWMS/Hazards/Incidents/Inspections
 *        Dashboard tabs on next load.
 * v136 — Phase 4.17 v134.2 COMPLETE. Every one of the 9 major modules
 *        now has its Dashboard tab as the default landing tab, backed by
 *        the shared `<ModuleDashboard />` component and the real
 *        `/api/dashboards/{module}` aggregators shipped in v134/v135.
 *        v134.2 wired the final 5 mounts: Sites (`SitesAdmin.jsx`),
 *        Plant & Vehicles (`PlantVehicles.jsx`), Workers
 *        (`UsersManagement.jsx`), Certifications (`Certifications.jsx`)
 *        and Audit Exports (`AuditExports.jsx`). Existing HowThisWorks
 *        panels moved into the Dashboard tab; List tab preserves every
 *        pre-v134 affordance untouched.
 * v137 — Phase 4.18 quick-wins bundle.
 *        • Users & Permissions: new **Bulk invite** button next to
 *          Invite user. Paste any list of emails — comma / space / newline
 *          separated — parse dedupes + validates against existing users,
 *          preview table shows New / Already exists / Invalid per row,
 *          progress bar walks each new address through `POST /users`
 *          with per-row ✓ sent / ✗ failed status and a summary toast.
 *        • Plant & Vehicles: general **Add historical reading** overflow
 *          trigger on every Live Counters panel (Navixy + manual).
 *          Modal takes date + engine_hours + odometer_km, checks
 *          client-side monotonicity against the newest existing snapshot,
 *          then POSTs to `/api/assets/{id}/meter-history` — source pill
 *          flips to "Manually entered" on next refresh.
 *        • Dashboards: `/api/dashboards/audit-exports` (hyphen) is now
 *          aliased to `/api/dashboards/audit_exports` (underscore) via a
 *          normalise-on-input patch in `dashboards.py`.
 *        • User Manual: new "Bulk invite" subsection under §7 Workers,
 *          and an expanded "Add historical meter reading manually"
 *          subsection under §9 Plant & Vehicles.
 * v138 — Phase 4.18.1 integration health-light truth-serum (first pass).
 *        See v139 for the corrected semantics — v138 read credentials
 *        and marked M365/TextMagic green while COMMS_SAFE_MODE was on,
 *        which is misleading. v139 flips the meaning.
 * v139 — Phase 4.18.1 CORRECTED. `/api/health/integrations` now
 *        answers the question "will this integration actually fire
 *        outbound traffic right now?" — not "does it have credentials?".
 *        Microsoft 365 and TextMagic hard-return red with a
 *        `disarmed: true` flag and detail "Disarmed by Comms Safe Mode"
 *        whenever `COMMS_SAFE_MODE=on`. The top-bar popover shows a
 *        subtle "🛡 disarmed" chip next to those rows and a yellow
 *        banner at the bottom explaining that lifting safe mode
 *        re-arms both integrations automatically. Cache key now
 *        includes the safe-mode flag so a toggle re-computes on the
 *        next call instead of waiting for the 60s TTL. User Manual
 *        §13 (Comms Safe Mode) updated with the "red on purpose"
 *        expectation. Simpro stays honestly amber when its last
 *        successful sync is >24h — that's a real "sync cron not
 *        running" signal, not a red-vs-green bug (auto_sync_enabled
 *        is currently `false` for this org).
 * v140 — Phase 4.18.2 Simpro semantics correction. Simpro is an
 *        on-demand integration — you only call it when you need to
 *        fetch a worker/vendor/site/job. Between demands it sits idle
 *        in "ready" state. v139 was flagging that idleness as amber
 *        "stale", which was wrong. v140 flips it: credentials + no
 *        error = **green "Ready"** regardless of how long ago the last
 *        call was. Amber only when a recent (< 24h) call errored;
 *        red when credentials are missing or errors have persisted
 *        > 24h. User Manual §13 gains an "Idle green is normal for
 *        on-demand integrations" note.
 * v141 — Phase 4.18.2 clickable integration rows. Every row in the
 *        top-bar API-health popover (Simpro / Navixy / Microsoft 365
 *        / TextMagic) is now a `<Link>` deep-linking to its admin
 *        config page under `/app/settings/integrations/<provider>`.
 *        Hover reveals an orange left-edge accent stripe, a right-
 *        chevron and a lifted background — matching the sidebar
 *        interaction language. Popover closes on navigation. MongoDB
 *        stays a static row (no route — infrastructure) with a
 *        subtle "· System" label. User Manual §13 gets a one-line
 *        "click any row to jump to its config" note.
 * v142 — Phase 4.18.2 popover layout fix. v141 shipped with the
 *        integration name column set `flex-1 min-w-0` while the
 *        detail column was set `max-w-[220px]` — bigger than the
 *        popover's own inner width, which caused the name span to
 *        collapse to zero on the first four rows (Simpro, Navixy,
 *        Microsoft 365, TextMagic) and completely disappear. Only
 *        MongoDB survived because its "· System" chip forced a
 *        minimum. Fix: widen popover w-72 → w-96, flip the flex
 *        priority so the name span becomes `shrink-0` (never
 *        collapses) and the detail span becomes the flex-growing /
 *        truncating one. Every row now shows its brand name in
 *        uppercase to the right of the LED dot, exactly like the
 *        MongoDB row already did.
 * v143 — Phase 4.19 real MongoDB backup service, grafted from the
 *        Paneltec Portal. Backend: new `backup_service.py` (1,375-line
 *        FastAPI router mounted at `/api/backup/*`) + `auth_helpers.py`
 *        for the `?token=` download flow. EXCLUDE_COLLECTIONS widened
 *        with Civil's ephemeral tables (session_history, email_outbox,
 *        comms_outbox_blocked, active_signons). Snapshots write to
 *        GridFS (`bk_fs.files/chunks`) and manifest rows to
 *        `bk_snapshots`. Retention: 7d keep-all + 30d daily +
 *        26w weekly + forever monthly, applied after every snapshot.
 *        Two APScheduler cron jobs registered against the existing
 *        `AsyncIOScheduler`: `backup_snapshot_6h` (every 6h) +
 *        `backup_snapshot_cob` (mon-fri 17:00 Sydney). `/api/health/
 *        backup` now reads real snapshots from `bk_snapshots` — the
 *        `placeholder: true` synth branch is deleted. Frontend: new
 *        admin route `/app/settings/backup` mounts BackupTab.jsx
 *        (self-styled, no shadcn deps, uses Civil's bearer-attaching
 *        axios instance). Sidebar entry "Backup & Restore" with the
 *        CloudArrowUp icon, admin-only. Backup pill in the top bar
 *        now surfaces the real last-snapshot age + size + LAN
 *        destination count (0 destinations shows "LAN idle" until
 *        agents register in Stage D). Clicking the pill opens the
 *        popover; footer link "Open backup admin →" navigates to
 *        `/app/settings/backup`. Restore panel carries a yellow
 *        caveat banner: MongoDB `_id`s regenerate on restore but
 *        Civil's UUID `id` fields are unaffected.
 * v144 — Narrow follow-up to Stage B:
 *        Backend: new read-only `GET /api/backup/schedule` (admin-gated)
 *        introspects the running APScheduler for `backup_snapshot_6h`
 *        and `backup_snapshot_cob`, returning `{jobs:[{id,cron,timezone,
 *        next_run_at}], retention_last_run_at}`. No cron cadence is
 *        hard-coded — we read the live triggers.
 *        Frontend: `BackupTab.jsx` `ScheduleCard` collapsed from an
 *        interactive editor (which pointed at a non-existent endpoint
 *        and rendered the literal text "Not Found") to a read-only
 *        two-row table showing each job's cron string, timezone, and
 *        next-run timestamp.
 *        Also: reactivated `worker_stephen@paneltec.com.au` (status
 *        `disabled` → `active`) so the tester can exercise the
 *        non-admin browser-side sidebar/route-guard flow.
 * v145 — Portal→Civil cleanup pass on the backup bundle.
 *        Backend `backup_service.py`: `verify_snapshot()` no longer
 *        keys off a hardcoded Portal collection table (customers_master,
 *        weigh_tickets, products, sp_form_templates, sp_workers, users
 *        with Portal `user_id` schema, app_settings). Now dynamic —
 *        one `collection · <name>` row per manifest.collections[] +
 *        a `document count parity` row (Σ len(rows) ≡ manifest.
 *        total_documents) + a warn-only `unexpected files` row for
 *        any `mongo/*.json` not listed in the manifest. Portal
 *        "Iter 66" comment removed; two Portal-flavoured comments
 *        rewritten to say Hub / Hub admin bearer.
 *        Frontend `BackupTab.jsx`: `portalToken()` → `civilToken()`
 *        rename, and the localStorage key is now read from Civil's
 *        `TOKEN_KEY` import (`paneltec_token`) instead of the wrong
 *        `paneltec_session_token`. This unblocks the four call-sites
 *        that bypass the axios interceptor: snapshot download
 *        (button + `<a href>`), installer .py download, and
 *        docker-compose.yml download. Two Portal comment/copy
 *        strings rewritten to Civil wording.
 * v146 — Server-tools installer now runs as a background job.
 *        Backend `file_pdf.py`: `POST /admin/install-libreoffice`
 *        returns 202 immediately with `{job_id, started_at,
 *        install_running:true, packages}` and spawns apt-get in a
 *        detached asyncio task. Overlap → 409 with the running
 *        job_id. Module-level `_INSTALL_STATE` tracks live progress
 *        (rolling last-50-lines deque) with a 20-min wall-clock
 *        SIGKILL. `GET /admin/server-tools/health` now surfaces
 *        `install_running`, `install_job_id`, `install_started_at`,
 *        `install_finished_at`, `install_exit_code`, and
 *        `install_log_tail`.
 *        Frontend `SystemSettings.jsx`: rewritten to poll health
 *        every 5 s while an install is running, render the live
 *        `install_log_tail` in a collapsible <pre>, handle 409 by
 *        attaching to the running job, and auto-resume the polling
 *        loop if the page is reloaded mid-install (detected via
 *        `install_running:true` on mount).
 *        Fixes the "install goes part of the way then stops"
 *        symptom that was actually Cloudflare/ingress killing the
 *        long-running synchronous HTTP request while apt-get kept
 *        installing to completion server-side.
 * v147 — Settings → Integrations page now consumes
 *        `/api/health/integrations` (matches Settings → My Apps —
 *        the source of truth). Previously it hit `/api/integrations`
 *        which returns the per-org config-lifecycle status
 *        (`connected/error/not_connected`) — ignorant of Comms Safe
 *        Mode. M365 + TextMagic correctly show as `Down` with a
 *        secondary `Disarmed` badge when Comms Safe Mode is on;
 *        Simpro idle-with-creds correctly shows `Connected` (v140
 *        semantic fix); Navixy and Simpro cards now surface the
 *        live `detail` string ("Ready · last call 4d ago · 466
 *        records cached", "72 assets synced · last sync 12m ago").
 *        The per-integration admin pages and their
 *        `GET /integrations/{kind}` config CRUD flow are untouched.
 *
 * v148 — Ad-blocker bypass for PDF preview/download. Chrome ad-blocker
 *        extensions (uBlock, Adblock Plus) match `blob:` URLs against
 *        their filter heuristics and were surfacing PDFs as
 *        `ERR_BLOCKED_BY_CLIENT` — the user saw print sheets fail to
 *        render, "Download PDF" clicks do nothing, and Print-Labels
 *        (Avery L7160) return blank. Fix: replace
 *        `URL.createObjectURL(blob)` at all v148 PDF surfaces with
 *        `stashInlinePdf(blob, filename)` → the blob is POSTed to
 *        `POST /api/files/inline-pdf` and served back from
 *        `GET /api/files/inline/{stash_id}` — a same-origin URL that
 *        no ad-blocker filter matches. Migrated 8 files:
 *        Workers.jsx (print sheet + wallet card), PlantVehicles.jsx
 *        (Print Labels avery_l7160), UserManual.jsx (manual PDF),
 *        DocumentLibrary.jsx (download), InductionsMatrix.jsx (export
 *        + preview), InductionCardModal.jsx (card PDF),
 *        PdfPreviewModal.jsx (universal preview iframe),
 *        AssetDrawer.jsx (label PDF). Server helper lives in
 *        `backend/file_pdf.py::stash_inline_pdf`; frontend helper in
 *        `frontend/src/lib/pdfStash.js`. No auth changes.
 *
 * v149 — PdfPreviewModal watchdog now armed only in legacy `blob:` mode.
 *        The 6 s timer was originally added to catch ad-blocker silence
 *        on `blob:` iframe URLs, but with v148's stashInlinePdf migration
 *        the primary paths are `directUrl` (same-origin stash) and the
 *        signed preview-token iframe URL — neither are ad-blocker
 *        susceptible. Cold DOCX→PDF LibreOffice conversions routinely
 *        take 10–30 s on first hit, so the timer was firing before the
 *        PDF arrived, unmounting the iframe and showing a false "browser
 *        blocked the preview" UI. Fix: gate the watchdog behind
 *        `isBlobMode`. Also added a small "Preparing PDF…" overlay that
 *        stays up until the iframe fires `onLoad`, so the user sees
 *        progress feedback during the LibreOffice conversion instead of
 *        an empty preview pane. `Open in new tab` and `Download PDF`
 *        buttons remain functional throughout. No backend changes.
 *
 * v150 — SitePrintModal (Sites → Print QR) and SupplierPrintModal
 *        (Contractors → Print QR) now delegate their body rendering to
 *        PdfPreviewModal via the new optional `headerExtras` /
 *        `footerExtras` props. The layout tabs (Gate Sign A4 / Avery
 *        30-up, Business card / Lanyard) stay in each modal's header,
 *        but the iframe, loading overlay, "Open in new tab" and
 *        "Download PDF" escape hatches now come from the shared
 *        component. Consolidates PDF preview UX across all four print
 *        surfaces (Document Library, Site QR, Supplier QR, Inductions
 *        Preview) so future improvements can't miss a sibling modal.
 *        No backend changes. PdfPreviewModal's watchdog behaviour and
 *        blob-mode fallback unchanged; the two new props default to
 *        null so existing callers are unaffected.
 *
 * v151 — PDF preview no longer relies on Chrome's built-in PDF viewer.
 *        `pdfjs-dist` (Mozilla PDF.js) bundled — PDFs render to <canvas>
 *        inside the modal, working regardless of browser, extension,
 *        ad blocker, or corporate PDF-download policy. The legacy
 *        iframe render path is retained as an automatic fallback if
 *        pdfjs fails to load or parse (a one-time toast tells the user
 *        "Using compatibility mode"). The pdf.worker.min.js file is
 *        served as a same-origin static asset from `/pdfjs/` and
 *        included in the SW precache so it's available offline. The
 *        "Download PDF" and "New tab" escape hatches remain in the
 *        modal header regardless of which render path wins.
 *
 * v152 — Server Tools UI self-heals without a manual refresh.
 *        Settings → Server Tools (`SystemSettings.jsx`) now arms its
 *        health-poll loop on mount whenever ANY tool reports
 *        `ok:false`, not just when the backend flags
 *        `install_running:true`. Pairs with the v151.1 backend
 *        `ensure_server_tools_or_install_bg()` startup hook so pods
 *        that lose LibreOffice/Tesseract/Poppler on restart auto-
 *        install AND the UI transitions from "Auto-install pending…"
 *        (blue spinner) → green checkmark within seconds of the apt
 *        run finishing — no user refresh required. Auto-heal cycles
 *        are capped at 5 minutes wall-clock (manual "Install now"
 *        still gets the full 25 min ceiling) so a genuinely broken
 *        pod doesn't loop forever. Also fixes the misleading red
 *        "Not installed" X that flashed during the auto-install
 *        window; the amber "Auto-install pending…" state now
 *        renders instead.
 *
 * v153 — BackupTab red banner alert when any LAN agent is silent.
 *        Non-dismissable banner renders at the top of
 *        `/app/settings/backup` whenever:
 *          (a) any registered agent has never checked in
 *              (last_seen_at === null),
 *          (b) any registered agent has been silent for more than
 *              60 minutes, or
 *          (c) `lan-status.health === "down"` while the Hub is still
 *              producing snapshots (latest_snapshot_age_min < 30).
 *        Surfaces the 42-hour cold-delivery scenario that let the
 *        July 4 2026 outage stay invisible: snapshots kept ticking,
 *        only the delivery leg was cold. Non-dismissable by design —
 *        no localStorage hide, no X button, no cookie flag. Uses the
 *        existing `/api/backup/agents` + `/api/backup/lan-status`
 *        endpoints; no backend changes. "Show token & agent config"
 *        CTA smoothly scrolls to the Agents card below.
 */
 *
 * v154 — Clipboard iframe-safe wrapper + silent-agent diagnostics.
 *        · New `lib/clipboard.js` exports `copyToClipboard(text, opts)`
 *          with three-tier fallback: async Clipboard API →
 *          `document.execCommand('copy')` on a hidden textarea →
 *          manual-select modal with the text pre-highlighted in a
 *          readonly `<textarea>`. Guarantees NO uncaught runtime
 *          error from any Copy button under any iframe permissions
 *          policy. Fixes the Emergent preview-iframe blocker that
 *          made the agent token uncopyable ("The Clipboard API has
 *          been blocked because of a permissions policy applied to
 *          the current document").
 *        · Sweep — every raw `navigator.clipboard.writeText` call
 *          in `src/` migrated to the wrapper: PlantVehicles
 *          (scan link copy), Contractors (renewal link copy),
 *          Renewals (two link-copy call sites), ScanResolver
 *          (share link copy) and BackupTab (compose YAML copy).
 *          Zero raw calls remain outside `lib/clipboard.js`.
 *        · Backend `POST /api/backup/agent/pending` and
 *          `POST /api/backup/agent/report` now stamp `first_seen_at`
 *          on the agent's very first successful call, letting the
 *          UI distinguish "never polled since register" from
 *          "polled once then stopped". `AgentRegister` inserts
 *          initialise the field to null.
 *        · BackupTab silent-agent banner gains a **tick counter**:
 *          when > 1 agent registered in the last 24 h have
 *          `last_seen_at === null`, the banner surfaces
 *          "This is the Nth registered agent that hasn't checked
 *           in. If restarting the agent binary hasn't helped, the
 *           process itself may not be running on the office
 *           machine." Diagnostic gold for the "re-register keeps
 *          not helping" scenario.
 *        · Agents table row now surfaces "First check-in: X ago"
 *          or a red "never polled" chip alongside the existing
 *          last-seen pill.
 */
 *
 * v154.1 · Clipboard hotfix — two missed call sites + nuclear
 *          safety net.
 *          · Fixed the "Copy token" button in the fresh-agent
 *            panel (`BackupTab.jsx` line 1658) — used raw
 *            `navigator.clipboard?.writeText(freshAgent.token)`
 *            and threw the Permissions-Policy error under the
 *            Emergent preview iframe. This was THE button the
 *            operator needed to unblock the LAN agent restart —
 *            regression traced to the fresh-agent panel not
 *            being in the original v154 sweep because the
 *            optional-chain `?.writeText` pattern slipped past
 *            the grep.
 *          · Fixed `PinRevealModal.copy` in
 *            `components/auth/AuthBundle.jsx` (line 210) — same
 *            bypass shape.
 *          · Nuclear safety net: `lib/clipboard.js` now monkey-
 *            patches `navigator.clipboard.writeText` at module
 *            load. Any raw call anywhere in the app (including
 *            future regressions, third-party libs, hasty PRs)
 *            transparently routes through the three-tier
 *            fallback chain on Permissions-Policy failure.
 *            Sentinel-guarded against hot-reload double-wrap.
 *          · The wrapper is now imported at App boot
 *            (`App.js` line 3) so the monkey-patch arms before
 *            any Copy button can fire.
 */
 *
 * v154.2 · Download hotfix — iframe-safe anchor click.
 *          Reported blocker: `downloadCompose` in `BackupTab.jsx`
 *          created a Blob URL and an `<a download>` element but
 *          NEVER appended the anchor to the DOM before `.click()`.
 *          Under the Emergent preview iframe and any sandboxed
 *          WebView the click is a silent no-op — the download
 *          handler refuses to fire on a detached anchor. Same
 *          bug shape in `downloadInstaller`. Both migrated to
 *          the new `lib/download.js` `downloadFile()` wrapper
 *          (three-tier fallback: anchor-in-DOM → data-URL popup
 *          → manual-copy modal with content pre-selected).
 *
 *          Nuclear safety net: `lib/download.js` monkey-patches
 *          `HTMLAnchorElement.prototype.click` at module load.
 *          When any anchor has a `download` attribute AND is
 *          not currently connected to the DOM, the wrapper
 *          transparently attaches it, clicks it, and detaches
 *          it after a tick. Every raw `URL.createObjectURL +
 *          <a download>.click()` call site in the app
 *          (Certifications CSV, Workers CSV/photo, Forms JSON,
 *          FormSubmissions CSV, DocumentLibrary, Suppliers CSV,
 *          InductionsMatrix XLSX, InductionCardModal PDF,
 *          UserManual PDF, PdfPreviewModal, PlantVehicles QR)
 *          inherits the fix immediately — no code changes to
 *          those files. Sentinel-guarded against hot-reload.
 *          Armed at App boot via `App.js` line 4.
 */
 *
 * v154.3 · Cache-buster banner.
 *          `CacheBusterBanner.jsx` mounts at the top of `App.js`
 *          (above <Routes>) and polls `/api/health/version` every
 *          5 minutes while the tab is visible. When the response
 *          disagrees with the compile-time constant
 *          `lib/version.js#RUNNING_VERSION` embedded in the running
 *          bundle, a sticky amber banner renders with a "Reload now"
 *          CTA that:
 *            1. Unregisters ALL service worker registrations
 *            2. Clears every Cache Storage entry via the Cache API
 *            3. Hard-reloads the tab
 *          Prevents the "no visible effect after fix" trap that hit
 *          the July 4 2026 docker-compose download unblocker — the
 *          server-side fix was live, but the user's tab was pinned
 *          to a stale SW bundle. Non-technical users no longer need
 *          to know about Cmd/Ctrl+Shift+R.
 *
 *          30-second boot grace suppresses false-positives during
 *          SW install races. Session-scoped "Later" dismissal only
 *          (no localStorage) — the banner reappears on next mount
 *          so a bounced tab still re-surfaces the update.
 *
 *          Renders ABOVE the SilentAgentAlert banner by design — a
 *          bundle mismatch might itself be the reason the silent-
 *          agent state is stale.
 *
 *          Reminder for future bumps: update BOTH
 *          `/app/frontend/public/service-worker.js#CACHE_VERSION`
 *          AND `/app/frontend/src/lib/version.js#RUNNING_VERSION`
 *          together, otherwise the banner will render immediately
 *          after every deploy.
 */
 *
 * v155b · Backup admin traffic-light hero card.
 *          New `/api/backup/summary` aggregator + new
 *          `BackupStatusHero.jsx` mounted at the top of
 *          `BackupTab.jsx` (above the v153 SilentAgentAlert). One
 *          glance answers "is my backup working?" — green Healthy /
 *          amber Attention / red Down / grey Setup incomplete pill,
 *          plus three data lines (last snapshot, last delivery,
 *          next scheduled) and two CTAs (Backup now, Show history).
 *          Polls 60 s while tab visible. Setup Wizard and Advanced
 *          accordion follow in v155c. Existing cards untouched.
 *          Also deletes the 11 dormant v155a extraction files
 *          under `pages/settings/backup/` (Path A cleanup).
 */
 *
 * v155b.1 · Delivery attribution fallback.
 *          `/api/backup/summary` now falls back to "the sole enabled
 *          destination" when `bk_agent_logs.destination_id` is null
 *          (legacy agents pre-v155b). Makes the hero card's Last
 *          delivery line read "…→ Office UGREEN tower via Office
 *          Pi" instead of just "…via Office Pi". No agent-side
 *          changes required. Sole-destination heuristic — silently
 *          skipped if the tenant has 0 or >1 enabled destinations.
 *          Frontend untouched; SW bump exists solely to force
 *          browsers to see the enriched summary payload.
 */
const CACHE_VERSION = 'paneltec-v160.0.23';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PRECACHE = [
  '/manifest.json',
  '/brand/mark.png',
  '/brand/icon-192.png',
  '/brand/icon-512.png',
  '/brand/apple-touch-icon.png',
  '/api/help/schematics/paneltec_architecture.png',
  '/api/help/schematics/paneltec_user_journey.png',
  '/api/help/schematics/paneltec_swms.png',
  '/api/help/schematics/paneltec_sites_qr.png',
  '/api/help/schematics/paneltec_plant_vehicles.png',
  '/api/help/schematics/paneltec_workers_access.png',
  '/api/help/schematics/paneltec_audit_exports.png',
  '/api/help/schematics/paneltec_comms_safe_mode.png',
  '/api/help/tiles/tile_swms.png',
  '/api/help/tiles/tile_hazards.png',
  '/api/help/tiles/tile_sites.png',
  '/api/help/tiles/tile_plant.png',
  '/api/help/tiles/tile_workers.png',
  '/api/help/tiles/tile_certs.png',
  '/api/help/tiles/tile_suppliers.png',
  '/api/help/tiles/tile_audit.png',
  '/api/help/tiles/tile_incidents.png',
  '/api/help/tiles/tile_inspections.png',
  '/api/help/tiles/tile_prestarts.png',
  '/api/help/tiles/tile_documents.png',
  '/api/help/tiles/tile_ask_intel.jpeg',
  // v151 — pdfjs-dist worker. Bundled so PDF preview works offline and on
  // repeat loads.
  '/pdfjs/pdf.worker.min.js',
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
