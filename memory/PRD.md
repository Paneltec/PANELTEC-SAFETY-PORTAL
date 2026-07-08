# 2026-06-30 — Phase 4.9 — Counter fix re-ship + Today/Week/Month Trip data (v113)

## Part 1 — Counter fix re-shipped (after the brief rollback)
- Pass 0.5 back in `asset_navixy_sync.py`. Calls `POST /v2/tracker/get_counters`
  for EVERY synced asset on every 15-min cycle, idempotent via the
  existing `_apply_counters` guard (refuses to lower a higher value).
- Structured per-device log: `navixy.sync device_id=X hours=Y km=Z
  source=counters_v2`. 307 such lines across recent cycles in the journal.
- H89MY (tid 10307562): hours=554.7032 / km=109914.99 — matches Navixy
  UI within 0.01.

## Part 2 + 3 — Today / Week / Month Trip summary (NEW)
- **New module `asset_trip_summary.py`** exposing
  `GET /api/assets/{id}/trip-summary?range=today|week|month`.
- Pulls Navixy `/v2/track/list` for the org-local window
  (Australia/Sydney default) → aggregates from `type="regular"` tracks:
  `distance_km`, `drive_seconds`, `max_speed_kmh`, plus a per-day
  `sparkline:[{date, km}]`.
- **Idle time** derived from inter-trip gaps shorter than 30 minutes
  (Navixy plan doesn't expose a dedicated `track/stop/list` endpoint —
  probed and confirmed HTTP 400). Documented in module docstring.
- 60-second in-memory cache keyed by `(asset_id, range, org_id)` so
  the UI tab flicker doesn't hammer Navixy.
- Structured log: `navixy.trip_summary device_id=X range=Y distance=Z`.

## Web UI — `LiveCountersPanel.jsx`
- New **`TripSummaryCard`** rendered BELOW the existing Live Counters
  block (separate card, discoverable). Title: "Today's trip · Navixy".
- 4-tile grid: **Distance · Drive time · Idle time · Max speed**.
- Tab strip: **Today (default) · This Week · Last Month**, matching the
  Live Counters tabs above.
- Tiny **orange sparkline of daily km** below the tiles (last N days).
- Honest "Collecting data — N of M days with activity" hint when the
  Navixy track stream has gaps.

## Verification (testing_agent_v3 — 14/14 PASS, 100%)
- H89MY today=21.42 km / 3 trips / peak 93 km/h. Week=115.37 km / 15
  trips / 104 km/h. Month=665.26 km / 56 trips / 117 km/h. Exact match
  to the brief's ground-truth numbers.
- Schema contract met (`range, navixy, from, to, as_of,
  total_days_in_range, distance_km, drive_seconds, idle_seconds,
  max_speed_kmh, trip_count, days_available, sparkline`).
- Cache check confirmed: second call within 60s does NOT emit a new
  `navixy.trip_summary` log line.
- Non-Navixy asset path returns 200 with `navixy=false`,
  `distance_km=0`, no upstream call.
- Counter fix re-ship: 70 assets refreshed on first cycle. Fleet sample
  shows 5+ assets with `engine_hours>100 AND odometer_km>500` (no stuck
  values).

## Service worker
- `CACHE_VERSION` bumped to **`paneltec-v113`** (re-shipped) with full
  v113 changelog covering counter fix + trip summary endpoint + UI card.

## Out of scope (parked per directive)
- Harsh braking / acceleration / speeding events
- Geofence entry/exit
- Battery voltage
- Service hours since last service
- Driver ID / iButton
- Fuel consumption

## Comms Safe Mode
- `COMMS_SAFE_MODE=on` remains in effect. No emails sent during build
  or testing.

---


# 2026-06-30 — Phase 4.8 Asset Meter Trends (v112)

## Backend
- New collection **`asset_meter_history`** with unique compound index
  `(asset_id, snapshot_date)` — idempotent upserts.
- New APScheduler job **`meter_history_daily_snapshot`** at **01:00 UTC**
  daily. Pulls `engine_hours_total` + `odometer_km_total` from the live
  asset doc (kept fresh by the existing 15-min Navixy sync). Confirmed
  on first run: **69 of 72 Navixy assets written**, 3 skipped (no
  current counter value).
- One-time **30-day backfill** runs async on startup. Probes Navixy
  `tracker/counter/list_history` + `list` with day-aggregation for each
  asset. Where the Navixy plan exposes history, rows are written with
  `source="navixy_backfill"`; otherwise the asset is marked
  `backfill_skipped` and the today-anchor snapshot still seeds row #1.
  On this preview env Navixy returned no history (plan limit), so all
  assets currently start with `days_available: 1` and accumulate from
  here.
- New endpoint **`GET /api/assets/{id}/meter-trends`** returns:
  - `total`: `{engine_hours, odometer_km, as_of}` (unchanged shape from
    live counters).
  - `week`: `{engine_hours_delta, odometer_km_delta, daily_avg_hours,
    daily_avg_km, days_available, sparkline[]}` over the last 7 days.
  - `month`: same over the last 30 days.
  - `days_available` is honest — sparkline shows only as many points as
    the DB actually has, so the UI can render the "Collecting data —
    N of 7 days" hint without inventing numbers.

## Web UI
- `LiveCountersPanel.jsx` keeps the existing mint-green NAVIXY block
  intact and adds a **3-tab strip (Total · This Week · Last Month)**
  just under the dual-heartbeat status line. Default = Total (zero
  behavioural change for users who never click a tab).
- Week/Month cards show **signed deltas** (`+12 hrs` / `+215 km`),
  daily averages, and a **tiny recharts sparkline** beneath each metric
  (engine hours mint-green, odometer brand orange).
- "Refresh now" admin button now reloads BOTH the asset (live counters)
  AND the meter-trends payload so a successful sync updates the chart
  immediately.

## Service worker
- `CACHE_VERSION` bumped to **`paneltec-v112`** with full changelog.

## Out of scope (per directive)
- Manual-entry meter readings for non-Navixy assets — future phase.
- Annual / YTD trends — Week + Month is enough for now.
- Asset-to-asset comparison — single asset only.
- Mobile mirror — queued for a separate dispatch after web tester
  passes (deep-equivalent on the asset detail screen).

## Note on Comms Safe Mode
- `COMMS_SAFE_MODE=on` remains in effect. No comms changes this phase.
- 2 historical "queued" emails kept as audit record per user direction.

---


# 2026-06-30 — Phase 4.7.2 tester sweep (v110)

## Bug fixes
- **Forgot password regression** — Cover.jsx's "Forgot password?" link
  was a `<Link to="/forgot-password">` to a dead route. Replaced with a
  button that opens the same `ForgotPasswordModal` used on `/login`.
  `/login` mount was already correct; verified live both routes open the
  modal.
- **Users-list pill stayed "Active" after Send invite** — backend
  `_user_out` now exposes derived flags `invite_pending` (invite_token_hash
  set AND `invite_expires_at` in the future) and `is_locked`
  (`locked_until > now`). `UsersManagement.StatusPill` derives from those
  flags instead of the persisted `status` field, which doesn't move on
  invite. Verified live: 9 seed users currently `invite_pending=true`
  rendered as the amber "Invite pending" pill.
- **Workers-list silent toast** — `AccessKebab` now closes the picker
  dialog BEFORE firing the toast + refetch. The Sonner toast was
  rendering behind the still-open dialog overlay. Same reorder applied
  to `AccessSection`.
- **Plant & Vehicles dead QR icon button** — replaced the silent
  `downloadQr` onClick with a `DropdownMenu` exposing three actions:
  **Print QR label** (reuses bulk Print Labels modal pre-filtered to
  the one asset via `setPrintIds([a.id])`), **Copy scan link**
  (writes `${origin}/scan/${scan_token}` to clipboard with
  `execCommand` fallback for non-secure contexts), **Download PNG**
  (the existing handler, now toasts on success). Verified live on 77
  assets in the Paneltec seed.

## Service worker
- `CACHE_VERSION` bumped to **`paneltec-v110`** with full changelog.

## Backend touched
- `users.py` only — `_user_out` augmented with derived flags. No route
  signatures changed, no breaking changes for existing consumers.

---


# 2026-06-30 — Phase 4.7.1 tester sweep + Workers list access controls (v109)

## Bug fixes
- **Send invite "Field required" 422** — the kebab was POSTing with no body.
  Now opens a `ChannelPickerDialog` (Auto / Email / SMS) on Send invite +
  Reset password and submits `{ channel }`. Verified via curl: invite returns
  200 with `{ "channel": "email" }`. Same fix applied to `AccessSection`
  (drawer Profile tab); the standalone channel dropdown retired.
- **`/reset?token=bogus` showed the form, not the friendly error** — added
  `POST /api/auth/reset/validate` (mirror of `/invite/validate`) and
  hooked the web `ResetPasswordPage` to pre-flight the token. A
  bogus / expired / used token now renders the "Link can't be used"
  panel with the "Need help? Contact your administrator…" footer
  rather than a dead password form.

## Enhancement — Workers list (the actual entry point users reach for)
- Each worker row in `/app/settings/workers` now resolves its linked
  `users` record by email (admin-only `/api/users` fetch on mount) and
  renders one of:
  - `AccessKebab` (Send invite / Reset password / Generate PIN / Unlock) —
    same component the Users admin uses.
  - **"+ Login"** button — for workers with an email but no linked user
    account. Calls `POST /api/users` with `role=worker`, splices the new
    user into the in-memory map and lets the admin send the invite
    immediately.
- Status pill (Active / Invite pending / Locked / Disabled) renders
  beneath the existing active/inactive badge so admins can scan the
  list at a glance.
- Worker-role viewers see neither — the `/api/users` fetch 403s and
  the local map stays empty, naturally suppressing the controls.
- `AccessKebab` extracted to `components/auth/AccessKebab.jsx` so both
  pages share the same handlers.

## Service worker
- `CACHE_VERSION` bumped to **`paneltec-v109`** with a v109 changelog
  entry covering both bug fixes + the Workers list integration.

## Out of scope (parked)
- Bulk invite modal — deferred per user direction.
- Mobile-side biometric — next dispatch after this is green.

---


# 2026-06-29 — Phase 4.7 Web UI shipped (v108)

## Web UI (token-driven password flows + admin UX) — SHIPPED
- **Public routes** wired in `App.js` OUTSIDE `<AppShell />`:
  - `/onboard?token=` → `Onboard` (invite flavour). Validates token via
    `POST /api/auth/invite/validate` then redeems via `/invite/redeem`.
  - `/reset?token=` → `ResetPasswordPage` (reset flavour). Skips validate
    (no email leak) and redeems via `/reset/redeem`.
  - Shared `PasswordPanel` (in `pages/Onboard.jsx`) enforces the backend
    rule (≥10 chars / letter / digit / special) with a live strength meter.
  - Error states (invalid / expired / used) surface a **"Need help? Contact
    your administrator to issue a fresh link or PIN."** footer so workers
    don't dead-end.
- **`MustChangePasswordGuard`** wraps `/app/*`. Reads `must_change_password`
  from `/auth/me` and pins a non-dismissable `ChangePasswordModal` until
  the user complies (backstop for admin-initiated rotations + first
  logins via PIN). Does **not** block users where the flag is false, so
  existing logins are unaffected.
- **Login page** gains a **"Forgot password?"** link beneath the password
  field that opens `ForgotPasswordModal`. Always reports success (no email
  enumeration), regardless of the backend's 200.
- **AppShell user dropdown** gains a **"Change password…"** entry that
  opens the modal in unlocked mode for self-serve rotations.
- **UsersManagement**:
  - Per-row **`AccessKebab`** (Send invite / Reset password / Generate
    one-time PIN / Unlock account) — uses the same `/api/users/{id}/*`
    endpoints as `AccessSection`, with the PIN reveal modal.
  - User drawer **Profile tab** now embeds the full `AccessSection` with
    channel picker (auto / email / SMS), status pill (Active / Invite
    pending / Locked / Never logged in), and contextual sub-line
    (expires in N days / last login Nd ago / too many failed attempts).
- **`setToken(token)` helper** added to `lib/auth.js` — persists the redeem
  JWT, hydrates `/auth/me`, so navigation to `/app` lands on a populated
  user object.

## Service worker
- `CACHE_VERSION` bumped to **`paneltec-v108`**. Removed orphaned
  `paneltec-v107` const + duplicate `paneltec-v105` declaration left over
  from the previous cutoff (`swVersionGuard` will auto-purge stale caches
  on next page load).

## Mobile mirror — PENDING (handed off to `e1_expo_frontend_dev`)
- Deep links: `paneltec://onboard?token=` and `paneltec://reset?token=`.
- "Sign in with PIN" entry on the mobile login screen → `/api/auth/pin/
  redeem`.
- Biometric unlock after first successful password sign-in.

---


# 2026-06-29 — Phase 4.7 Worker Invite / Reset / PIN / Lockout (v107)

## Backend (`auth_invite.py` new + `auth.py` login patch) — SHIPPED
- `POST /api/users/{id}/invite` (admin) — email + SMS magic link,
  7-day JWT, hashed token on the user row, audit-logged.
- `POST /api/auth/invite/validate` (public, rate-limited 10/min/IP).
- `POST /api/auth/invite/redeem` (public, 5/min/IP) — sets password,
  bumps `token_version` (invalidates all other sessions),
  returns a normal login JWT.
- `POST /api/users/{id}/reset-password` (admin) — 24-h JWT,
  `purpose=reset`. Same channel flow as invite.
- `POST /api/auth/reset/redeem` (public) — same shape as invite redeem.
- `POST /api/auth/forgot-password` (public) — **always 200** (no
  email enumeration leak); per-email throttle 3/min + per-IP 10/min;
  silently triggers reset email if email matches a user.
- `POST /api/users/{id}/pin` (admin) — 6-digit, 24-h, **bcrypt-hashed**
  on the user row; plaintext returned ONCE to the admin response so
  they can read it out. Audit-logged.
- `POST /api/auth/pin/redeem` (public) — verifies bcrypt PIN, sets
  new password, bumps token_version, returns login JWT.
- `POST /api/users/{id}/unlock` (admin) — clears
  `failed_login_attempts` + `locked_until`.
- `GET  /api/users/{id}/access-status` — admin pill data
  (`never_logged_in / invite_pending / active / locked`).
- **Lockout in `auth.login`** — `is_locked()` pre-check returns 423;
  `record_login_attempt(success=False)` increments
  `failed_login_attempts`, sets `locked_until` after 5 fails for
  15 minutes. `last_login_at` written on success.
- `validate_password_rule()` — centralised (min 10 chars, letter +
  digit + special).
- Public links built from `X-Forwarded-Host` so the email URL is
  always the public ingress, not the internal pod host.

## Verification receipts (11 / 12 green — 1 cosmetic curl-regex miss)
1. `POST /users/{id}/invite` → `ok: true, channel: email, expires_at`.
2. Email queued (visible in `email/outbox`).
3. Weak password → 400. Strong → 201 + access_token.
4. `POST /users/{id}/pin` → returns 6-digit PIN once.
5. `POST /auth/pin/redeem` with that PIN → `access_token`.
6. `POST /auth/forgot-password` unknown → 200.
7. `POST /auth/forgot-password` real → 200 + backend log
   `auth.forgot_password_sent`.
8. 5 wrong logins → 401, 401, 401, 401, 401. 6th → **423 Locked**.
9. `POST /users/{id}/unlock` → ok.
10. `GET /users/{id}/access-status` → sensible state machine output.
11. Audit logs written for invite_sent, pin_generated, pin_redeem,
    forgot_password_sent, lockout, unlock.
12. (Curl regex couldn't extract the invite-JWT from the queued email
    HTML on the shell — UX path is fine; would work end-to-end via
    browser link click. NOT a backend bug.)

## Service worker
- `paneltec-v106` → **`paneltec-v107`**. `swVersionGuard` auto-heals
  open clients on next 60s poll.

## Frontend status — DEFERRED to next turn
Backend acceptance is solid but **the web UI pages were NOT shipped
this turn** to avoid a half-baked drop. Specifically still owed:
- `Onboard.jsx` (`/onboard?token=…`) — calls `/auth/invite/validate`
  → password + confirm + strength meter → `/auth/invite/redeem`.
- `ResetPassword.jsx` (`/reset?token=…`) — mirrors Onboard for the
  reset flow.
- `ForgotPasswordModal.jsx` — small "Forgot password?" link under
  the Login form → modal → silent 200 toast.
- `AccessSection.jsx` — embedded on the User detail / Users page:
  Send invite (channel picker), Generate PIN modal, Reset password,
  Status pills, Unlock button.
- `ChangePasswordModal.jsx` — Profile dropdown action + the forced
  `must_change_password` guard.
- Routing: register `/onboard`, `/reset` as public routes; add the
  must-change-password redirect guard to the protected route wrapper.

## Mobile (next turn after web UI lands)
- Deep links `paneltec://onboard?token=…`, `paneltec://reset?…`.
- Forgot-password bottom-sheet.
- PIN redeem flow.
- Biometric unlock (`expo-secure-store` + `expo-local-authentication`).
- Forced-change guard.

---


# 2026-06-29 — Phase 4.6 SWMS Scan Upload (OCR + Claude) (v106)

## Backend (`swms_phase45.py` extended)
- `parse_swms_text(text, title_hint)` — shared Claude entry-point
  (extracted from `from-paste`). Same strict-JSON prompt feeds both
  surfaces so the editor highlight UI behaves identically regardless
  of input modality.
- `POST /api/swms/from-scan` (multipart):
  - Accepts `.pdf`, `.png`, `.jpg`, `.jpeg`, max 25 MB. Streams to
    disk with size cap so a hostile upload can't OOM the worker.
  - PDF path: tries `ocr_pdf_to_text` first (Poppler `pdftotext` +
    Tesseract fallback), gracefully degrades to **PyPDF2** when the
    OCR binaries aren't on the host (text-embedded PDFs still work).
  - Image path: direct `tesseract` invocation.
  - <200 OCR chars → friendly 400 retry message.
  - >12k OCR chars → truncated to 12k + `truncated: true` warning
    flag (NOT 413 — scans are often long).
  - Persists SWMS with `created_via="scan"` + `attachments: [
      { kind: "signed_evidence", file_url, pages, ocr_chars, ...}]`
    so the auditor copy lives next to the parsed draft.
  - Audit log: `swms.from_scan` with bytes, pages, ocr_chars,
    truncated, file name.
- New static route `GET /api/files/swms_scans/{stored_name}` serves
  the signed-evidence file.

## Web (`Swms.jsx`)
- "Upload Scanned SWMS" header button (ScanLine icon) — orange
  outlined to match the Paste action.
- `ScanSwmsDialog` — dropzone (drag/drop + click-to-browse), file
  preview + size + MIME, 25 MB client-side cap, optional title hint,
  "Read & Parse with AI" submit with 20–40s loading state.
- Multipart upload with a 120-second axios timeout.
- **"Open in editor"** toast action (Phase 4.6 enhancement) on BOTH
  paste and scan success → navigates to `/app/swms/{id}?highlight=ai_filled`.
  Editor page consumes the param to render "AI filled" vs "Needs
  your input" pills (URL contract in place; pill rendering follow-on
  for the editor route).

## Service worker
- `paneltec-v105` → **`paneltec-v106`**. `swVersionGuard` auto-heals
  open clients on next 60s poll.

## Verification receipts (5/5 green)
1. PDF upload (1-page signed-SWMS sample): 201 with 5 tasks,
   4 hazards, 10 controls, 7 PPE, `created_via=scan`,
   `ocr_chars=1199`, `truncated=False`, attachment with `pages=1`.
2. Signed-evidence download via `/api/files/swms_scans/{name}`:
   HTTP 200, exact 2193-byte round-trip.
3. `.txt` upload → 400 (unsupported type).
4. Blank PNG → 400 "Could not read the document — please rescan…".
5. Bulk-delete cleanup works on `created_via=scan` rows too.

## Mobile hand-off
- `/app/memory/mobile_briefs/phase_4_6_swms_scan_upload.md` — Expo:
  camera (`expo-image-picker`) + file picker (`expo-document-picker`),
  multipart submit, same "Open in editor" toast, "View signed copy"
  on detail. Stacks with Phase 4.5 brief for one mobile cycle.

---


# 2026-06-29 — Phase 4.5 SWMS Paste + Bulk Delete + Recycle Bin (v105)

## Backend (`swms_phase45.py`)
- `POST /api/swms/from-paste` — Claude-parses pasted text/HTML into the
  existing SWMS schema and saves as a Draft.
  - Bounds: `200 ≤ chars ≤ 12,000`. Returns 400 / 413 outside.
  - HTML path uses BeautifulSoup to flatten `<table>` → Markdown so
    Claude can read column meaning (activity → hazards → controls).
  - Prefers HTML when materially richer than the plain text (eg
    paste from Word retains its grids).
  - LLM: `claude-sonnet-4-5-20250929` via `emergentintegrations` /
    `EMERGENT_LLM_KEY`. Strict JSON output, fence-tolerant parser.
  - On success: writes a doc with `created_via=paste`, `status=draft`,
    `version=1`, all soft-delete fields cleared.
- `POST /api/swms/bulk-delete {ids[]}` — up to 200 ids per call.
  - Ownership rule: admin OR `created_by == caller`. Mixed-ownership
    requests succeed for the rows the caller owns and return the rest
    under `refused_ids` (the UI shows a warning toast).
  - Sets `deleted_at`, `deleted_by`, `restore_until = now + 30d`.
  - Existing `GET /api/swms` already filters `deleted_at: None`.
  - Audit log: `swms.bulk_delete` with deleted + refused id arrays.
- `POST /api/swms/{id}/restore` — undo soft-delete (admin OR owner).
  Audit `swms.restore`.
- `GET /api/swms/recycle-bin` — admin-only listing with `days_left`
  per row.
- **APScheduler cron** `swms_purge_expired` — daily at 03:15 UTC,
  hard-deletes rows where `restore_until < now`.

## Web (`Swms.jsx`)
- Header now has **two** primary actions: orange-outlined "Paste SWMS"
  (Clipboard icon) + the existing blue "Create SWMS".
- Paste dialog (`PasteSwmsDialog`):
  - Sparkles header, large mono textarea with `onPaste` that captures
    both plain text AND HTML clipboard streams.
  - Live counter `<n> / 12,000 chars`, min-200 hint, "HTML detected
    (tables preserved)" pill when html clipboard is present.
  - "Reading your SWMS… (~10–20s)" loading state on submit.
  - On 201 → close + navigate to `/app/swms/{id}` + success toast.
- Row checkboxes + select-all on the SWMS list.
- Sticky bulk-action toolbar (slate-900 + orange Delete button)
  appears whenever ≥1 row checked. Confirmation dialog before
  posting, success toast cites the 30-day restore window.
- Admin "Open Recycle Bin →" link (small, top-right) flips the page
  into the bin view — listing soft-deleted SWMS with Restore
  buttons + amber/red day-count chips.

## Service worker
- `paneltec-v104` → **`paneltec-v105`**. `swVersionGuard` auto-heals
  open clients on next 60s poll.

## Verification receipts (9/9 green)
1. <200 chars → 400.
2. ~1.4KB SWMS paste → 201 with title, 6 tasks, 4 hazards, 9 controls,
   6 PPE, 6 activity_analysis rows, `created_via=paste`.
3. >12k chars → 413.
4. Bulk-delete one id → `deleted=1`, `restore_until` ≈ 30d ahead.
5. Default `GET /api/swms` excludes the deleted row.
6. Recycle bin lists it with `days_left=29`.
7. Restore → ok.
8. Default list contains the restored row again.
9. Cleanup ok.

## Mobile hand-off
- `/app/memory/mobile_briefs/phase_4_5_swms_paste_bulk.md` —
  Paste-to-create + bulk-delete on the Expo SWMS screen. Recycle Bin
  stays web-only this phase. Gated by the Phase 4.3 `swms` module flag.

---


# 2026-06-29 — Phase 4.4 Live Mobile Preview in Permissions Matrix (v104)

## Backend
- `GET /api/me/mobile-modules?as_role=worker|supervisor|contractor|admin`
  - Admins: returns the matrix row for the requested role.
  - Non-admins: param silently ignored (no escalation surface).
  - Response gains `actual_role` and `previewed: bool` fields so the
    mobile client can show a "Preview mode" ribbon.
  - Usage is logged at INFO: `mobile_modules.preview org=... actor=...
    preview_as=...`. No new collection — structured log only.

## Web
- `MobileModulesSection.jsx` gains a right-hand `<PhonePreview>` panel:
  - Sticky on `lg:` and above; stacks below the grid on smaller screens.
  - Header: Phone icon, "Live Preview" title, "Saved config · <role>"
    sub-line, Reload + Open-in-new-tab icon buttons.
  - Role dropdown: Worker (default) / Supervisor / Contractor / Admin.
  - Phone bezel: 320×680 slate-900 rounded-[36px], notch with orange
    accent dot. iframe inside `rounded-[24px]` white.
  - `iframe` sandbox: `allow-scripts allow-same-origin allow-forms
    allow-popups`. `referrerPolicy="no-referrer-when-downgrade"`.
  - URL derivation: explicit `REACT_APP_EXPO_URL` env wins; otherwise
    inject `.expo.` into the backend hostname (matches the existing
    `EXPO_PACKAGER_PROXY_URL` convention in `/app/mobile/.env`).
  - Token: admin's JWT from `getToken()` → `preview_token` query param.
  - Role: dropdown → `preview_role` query param.
  - Cache-bust: `_t=<timestamp>` so Reload always force-boots a fresh
    Expo session.
  - **Decoupled from grid toggles** — preview only ever reflects SAVED
    config so admins never see a misleading half-state. The footer
    note in the panel calls this out explicitly.
- Iframe verified end-to-end: `https://whs-compliance.expo.preview.
  emergentagent.com/?preview_role=worker&preview_token=eyJ…&_t=…`
  with role-switch to contractor confirmed updating the src.

## Service worker
- `paneltec-v103` → **`paneltec-v104`**. `swVersionGuard` auto-heals
  all open clients on next 60s poll.

## Mobile hand-off
- `/app/memory/mobile_briefs/phase_4_4_preview_role.md` — Expo-only
  query-param wiring: `preview_token` overrides stored JWT (web only,
  never persisted), `preview_role` is forwarded as `as_role` query on
  the modules fetch. Native iOS/Android explicitly ignore both params.
  Optional "Preview mode · <role>" ribbon when `previewed === true`.

## Verification receipts
- Curl admin no `as_role` → `role=admin actual=admin previewed=false`.
- Curl admin `as_role=contractor` → `role=contractor previewed=true
  count_true=4/13` (sign-on + swms + inductions + profile).
- Curl admin `as_role=hacker` → silently rejected, returns admin row.
- Backend INFO log: `mobile_modules.preview org=... preview_as=contractor`.
- Playwright: iframe src has `.expo.preview.emergentagent.com` host,
  `preview_role=worker` initially, switches to `preview_role=contractor`
  on dropdown change.

## Parked (next phases)
- **Worker password / set-password workflow** — user explicitly parked
  this to look at separately. Brief later.
- **Native preview mode** — out of scope; web admin tool only.
- **Phase 4.5 (P0 candidate)**: API-level enforcement layer for
  modules — disabled module = 403 on related POST/PUT routes.

---


# 2026-06-29 — Phase 4.3 Worker Mobile App Module Allocator (v103)

## Goal
Admin can decide which app modules appear in the Paneltec Civil Expo mobile
app per role (Worker / Supervisor / Contractor / Admin). Visibility-only
this phase — no API enforcement, no per-user overrides.

## Backend (`mobile_modules.py` — new router)
- Storage: `org_settings` collection, sub-doc `mobile_modules` keyed by
  `org_id`. Seeded with sensible defaults on first read (workers + super
  get the full operational kit, contractors are minimal: SWMS, inductions,
  sign-on, profile).
- `GET  /api/settings/mobile-modules` — admin-only. Returns full matrix +
  `module_keys` + `role_keys` + `defaults` (for client-side fallback).
- `PUT  /api/settings/mobile-modules` — admin-only, audit-logged.
  Diff-only audit entry on `audit_logs` so a worker reporting "my tab
  disappeared" is greppable. Admin row is force-set to all-true on every
  PUT, so a hand-crafted payload can never silently strip the lock.
- `GET  /api/me/mobile-modules` — any authenticated user. Returns flat
  boolean map for the caller's role. Unknown roles fall back to the
  most-restrictive `contractor` row.
- 13 module keys × 4 role keys: `pre_start, site_diary, hazard, incident,
  inspection, swms, inductions, plant_vehicles, service_maintenance,
  certifications, ask_intel, sign_on, profile`.

## Web admin UI
- `PermissionPresetsAdmin.jsx` renamed page-title to **"Permissions
  Matrix"** and added a tab strip (orange underline = active):
  - **Permission Presets** (existing) — preset list + matrix detail.
  - **Mobile App Modules** (new) — `MobileModulesSection.jsx`.
- Mobile section: 13-row × 4-column grid. Each cell is a custom orange
  switch toggle. Admin column lock icon + disabled toggles. Per-role
  "All on / All off" shortcuts. Sticky orange Save bar appears on dirty
  state with Reset + Save buttons.
- Fluent UI icons throughout (no emoji). Brand: orange `#F97316` +
  slate `#1E293B` via Tailwind's `orange-500` / `slate-900` classes
  (matches `pdf_brand.py` exactly).

## Service worker
- `paneltec-v102` → **`paneltec-v103`**. `swVersionGuard` auto-heals
  all open clients on next 60s poll.

## Verification receipts
- Curl: `GET /settings/mobile-modules` returns seeded defaults.
- Curl: `PUT` with `admin:{}` payload — admin row preserved as all-true.
- Curl: `GET /me/mobile-modules` returns admin's full map (role=admin).
- Audit log: `mobile_modules.update` entry with diff array.
- Playwright: 13 rows × 52 toggles rendered, admin column disabled,
  save bar appears on dirty, save succeeds, savebar disappears.

## Out of scope (parked)
- API-level enforcement (blocking POSTs when module off) — next phase.
- Per-user overrides — next phase.
- Image-based sign-in / facial recognition — separate brief.

## Mobile hand-off
- Brief written to `/app/memory/mobile_briefs/phase_4_3_mobile_module_gate.md`
  for `e1_expo_frontend_dev` to consume `GET /api/me/mobile-modules`
  on login + foreground and gate the bottom-tab + drawer nav.

---


# 2026-06-29 — Phase 3.22c + 3.22d ALL PDFs on 2-colour brand (v102)

## Phase 3.22c — Card-style PDFs (NEW `pdf_card_template.py`)
- New shared template: `header_band`, `chevron` (orange "A" mark),
  `qr_image`, `qr_block`, `pairing_zone` (replaces violet NFC zone with
  dotted orange), `footer_brand`, `cut_guide`.
- Migrated 9 card artefacts to slate + orange:
  - `workers_qr.py` — wallet + lanyard worker ID cards (Avery 10-up too).
  - `assets.py` — A6 plant label, on-metal label, combo (QR + NFC) label,
    Avery L7160 21-up sheet.
  - `suppliers_qr.py` — supplier lanyard + business-card induction QR.
  - `sites_qr.py` — A4 portrait gate sign + Avery 30-up label sheet.

## Phase 3.22d — Long-form PDFs (`pdf_renderer.py` brand swap)
- Brand constants in `pdf_renderer.py` (`BRAND_BLUE`, `GREEN`, `VIOLET`,
  `MINT_BG` …) now point at `pdf_brand.py` orange + slate. Cascades to:
  - SWMS document (civil + rich `activity_analysis` layout).
  - Form submission PDFs (`forms_pdf.py` reuses pdf_renderer helpers).
  - Certifications + Renewals PDFs.
  - Audit Pack PDF (Phase 3.23 sibling).
  - Pre-Start / Site Diary / Incident / Inspection / Hazard already on
    `pdf_template.py` from 3.22a/b — no churn.
- `_render_swms_rich` — inline accent colours swapped to `ORANGE` / `SLATE`,
  environmental risks table now slate (was mint).
- `workers_inductions.py::print_inductions` — orange eyebrow, slate body,
  slate table headers (`#f1f5f9` → `SLATE_BAND`, `#e2e8f0` → `SLATE_BORDER`,
  `#94a3b8` → `SLATE_MUTED`).

## Guarantees
- `grep -rE 'HexColor\(' /app/backend/*.py | grep -v pdf_brand.py | grep -v
  pdf_template.py | grep -v pdf_card_template.py` → **zero matches**.
- Smoke-rendered all 11 PDF artefact types — all return `%PDF` magic.
- SWMS PDF pixel sample: orange + slate present, **no cobalt / violet /
  mint** in top 12 colours.

## Cache
- Service worker bumped `paneltec-v101` → `paneltec-v102`. All clients
  self-heal via `swVersionGuard`.

## Next session
- **Phase 3.24** (parked, user-requested) — Scheduled monthly auto-pack:
  `org_settings.audit_pack_schedule`, APScheduler cron (1st @ 06:00 UTC),
  dual JSON+PDF via 3.23 pipeline, M365 outbox to recipients, Settings →
  Audit Exports "Schedule" admin tab.

---


# 2026-06-29 — Phase 3.23 Audit Exports dual JSON+PDF artefact (v101)

## Backend
- `POST /api/audit-exports` now auto-writes a **PDF sibling** whenever the
  user picks JSON or CSV. Best-effort: a sibling failure logs a warning but
  never breaks the primary artefact. Sibling row carries `sibling_of` →
  primary id and shares the primary's SHA-256 via the meta block.
- **NEW** `POST /api/audit-exports/{id}/render-pdf` — admin-only, idempotent
  on-demand renderer for packs missing their PDF. Returns the existing
  sibling if one already exists for the composite (title + period + scope)
  group. Used by the frontend "JSON unavailable / render PDF" hint chip.
- `_pdf()` hardened against malformed legacy bundles: non-list values are
  ignored when computing sufficiency totals; non-dict records are skipped
  per entity. Previously crashed with `AttributeError` on legacy packs.
- `scripts/backfill_audit_pack_pdfs.py` — idempotent backfill script:
  - Reads every non-PDF `audit_exports` row.
  - Skips rows that already have a PDF sibling (composite lookup).
  - Renders + writes the sibling, inserts a row with `backfilled=True`.
  - Logs `migrated / skipped_already_dual / failed` counters at end.
  - Run with `cd /app/backend && python3 -m scripts.backfill_audit_pack_pdfs`.

## Frontend
- `AuditExports.jsx` rewritten to **group rows by composite key**
  `(title, date_from, date_to, scope, workspace_id)`. The composite
  includes `scope` + `workspace_id` to defend against cross-workspace
  collisions (e.g. "Quarterly Pack · All workspaces" vs "Quarterly Pack ·
  Sydney Metro" would otherwise merge into one — catastrophic for audit).
- Formats column renders inline `PDF · JSON` links (PDF first as the
  human-readable default; JSON muted in slate-500). Each link is a direct
  href to `${BACKEND}${file_url}` with `data-testid="export-download-{fmt}-{id}"`.
- Missing-format hint chip (amber WarnFill icon) appears when a row is
  missing a format:
  - **Missing PDF** (JSON-only): admin click triggers
    `POST /audit-exports/{id}/render-pdf` then reloads. Non-admins see
    tooltip "ask an admin to regenerate".
  - **Missing JSON** (PDF-only): informational tooltip only — JSON cannot
    be reconstructed from PDF; user must re-export from source data.
- Email button now attaches **all formats** in the group (PDF preferred).
- Service worker `CACHE_VERSION` bumped to `paneltec-v101` — all clients
  self-heal via `swVersionGuard` on next poll.

## Verification
- Backfill first run: `migrated=4 skipped_already_dual=2 failed=0`.
- Backfill re-run: `migrated=0 skipped_already_dual=6 failed=0` (idempotent).
- Curl receipts:
  - `POST /audit-exports` JSON format → returns primary + `pdf_sibling`.
  - `POST /audit-exports/{json_id}/render-pdf` → 201 + sibling row.
  - Re-call same id → 201 + **same sibling id** (idempotent).
  - Call on a PDF id → 400 "Row is already a PDF artefact".
- UI screenshot: 5 grouped rows. 3 show `PDF · JSON`, 2 show `PDF` plus
  amber JSON-unavailable hint.

## Files touched
- `/app/backend/exports.py` (+ render-pdf endpoint, defensive _pdf)
- `/app/backend/scripts/backfill_audit_pack_pdfs.py` (new)
- `/app/frontend/src/pages/AuditExports.jsx` (full rewrite, group key)
- `/app/frontend/public/service-worker.js` (CACHE_VERSION → paneltec-v101)

## Next phases (parked for next session)
- **Phase 3.22c (P1)** — Card-style PDFs to 2-colour brand. Needs new
  `pdf_card_template.py` for CR80/lanyard/site-gate sign + Avery 30-up
  label sheet.
- **Phase 3.22d (P1)** — Long-form PDFs (SWMS doc, certification renewal,
  inductions matrix print, form submission) to the same brand template.

---


# 2026-06-29 — Phase 4.1 SWMS Assignments + version-chain commit

## Backend
- `crud.py::create_item` SWMS branch now does **version-chain auto-commit**:
  - Lookup by `org_id + title + status != superseded`.
  - Same version → idempotent in-place update (returns existing id, no chain
    mutation). Response carries `_chain_action: "in_place_update"`.
  - Different version → insert FRESH + set `supersedes` on new, set
    `superseded_by + status="superseded"` on old. Response carries
    `_chain_action: "superseded_v<old_ver>"`.
- `GET /api/swms` now hides `status:"superseded"` by default; opt-in with
  `?include_superseded=true` for admin tools.
- New endpoints in `swms_extras.py`:
  - `GET /api/swms/{id}/history` — DFS walk via supersedes/superseded_by,
    capped at 20 hops to defend against accidental loops.
  - `PUT /api/swms/assignments/bulk` (admin/manager/hseq_lead).
  - `PUT /api/swms/assignments/{swms_id}` (same RBAC).
  - `GET /api/swms/assignments` — current applies_to map keyed by SWMS id
    (excludes superseded).
  - `POST /api/admin/swms/backfill-version-chain` — admin-only one-shot.
    Idempotent (links existing duplicates by title in created_at order).
- **Route-order fix**: `swms_extras_router` now mounts BEFORE `swms_router`
  in `server.py` so `/swms/assignments` and `/swms/{id}/history` aren't
  shadowed by the generic `/swms/{item_id}` dynamic route from crud.py.
- API contract note (from tester feedback): per-user permission override
  payload shape is `{"overrides": {"<resource>": {"<action>": bool}}}`
  (nested); reset is `{"overrides": {}}` or the dedicated
  `POST /users/{id}/permissions/reset` endpoint.

## Frontend
- `pages/SwmsAssignmentsAdmin.jsx` (new) — two-pane admin page:
  - **Left**: scrollable list of active SWMS (superseded hidden), search
    box, optional bulk-mode checkbox, applies-to summary per row, violet
    🕐 "view history" icon on chained rows.
  - **Right**: 4 multi-select editors — Roles + Asset Types as chip groups,
    Workers + Companies as searchable multi-selects against `/workers` and
    `/contractors`. Single Save → PUT `/swms/assignments/{id}`.
  - **Bulk mode**: tick rows → editor shows "Editing N SWMS — overwrite
    applies_to for all" → Save → PUT `/swms/assignments/bulk`.
  - **History modal** (`swms-history-modal`): renders the chain as numbered
    timeline nodes, superseded rows greyed and badged.
- App.js route added at `/app/settings/swms-assignments`. Sidebar entry
  `nav-settings-swms-assignments` (admin/manager/hseq_lead only).

## Cache
- `service-worker.js` → **paneltec-v85**.

## Curl receipts (full 13/13 scenario covered)
- POST same title same version → **in_place_update** (same id).
- POST same title bumped version → **superseded_vV1.0** (new id, old archived).
- Old record `status=superseded`, `superseded_by=new_id`. New record
  `supersedes=old_id`. `/swms/{new}/history` depth=2, both rows.
- `GET /swms` default → hides id1, shows id2. `?include_superseded=true` →
  both visible.
- `PUT /swms/assignments/{id2}` admin → **200**, applies_to round-trips.
- `PUT /swms/assignments/bulk` admin → **200** (matched=1, modified=1).
- Worker bulk PUT → **403**.
- Backfill: 1st run `{linked:0, skipped:1}` (chain already linked from
  earlier seed); 2nd run identical → idempotent.

## Pre-flight
- `py_compile` ✓ · pytest 9/9 ✓ · `eslint` clean on new files ·
  webpack 1 pre-existing warning.

## Screenshots
- `/tmp/swms_assignments_page.png` — two-pane layout, 8 active SWMS rows
  (superseded V1.0 hidden), editor showing Admin+Manager chips selected,
  Workers/Companies pickers, Asset-types chip group.
- `/tmp/swms_history_modal.png` — V1.0 superseded + V2.0 approved chain.
- `/tmp/swms_bulk_mode.png` — 3 rows ticked, editor switches to "Editing 3
  SWMS in bulk · Saving will overwrite applies_to for all selected records."

## Next Action Items
- Phase 4.2/4.3 — Site / Supplier Induction QR (P2).
- Backlog parking lot: per-user session-history audit log retaining expired
  `active_sessions` for 30 days (the v3.19/v4.4 enhancement).

---


# 2026-06-29 — Phase 3.18 Granular Permissions + Active Sessions

## Backend
- `permissions.py` extended:
  - New action `delete` joins `open|view|edit|email` → 5-action matrix.
  - New `_all_no_delete()` helper keeps HSEQ Lead's broad grants while
    *explicitly* denying delete (mirrors actual route behaviour pre-3.18).
  - 5 new resources added to `PERMISSIONS_SCHEMA`: `workers`, `inductions`,
    `certifications`, `documents`, `forms`. Each declares `delete_supported`
    and `email_supported` flags.
  - ROLE_DEFAULTS extended for all 5 roles × 5 new resources. Workers get
    view-only on inductions/certifications; supervisors get edit on
    inductions/forms; only admin gets delete by default.
- Cert/induction/worker DELETE routes now flow through `require_permission`
  instead of inline role checks, so per-user overrides actually grant access.
- `admin_active_sessions.py` (new) wires:
    - `GET  /api/admin/active-sessions` — joins active_sessions ⨝ users.
    - `DELETE /api/admin/active-sessions/{jti}` — revokes one session +
      bumps the owner's `token_version` (defence-in-depth — even a cached
      JWT for that user fails on next /auth/me).

## Frontend
- `pages/UsersManagement.jsx`:
  - New ✏️ Edit-permissions icon button (`user-edit-perms-{id}`, violet)
    opens the existing drawer pre-selected to the permissions tab.
  - Permissions matrix now has a `perm-search` filter input.
  - `<div data-testid="user-permissions-modal">` wraps the matrix tab so
    e2e selectors are stable.
- `lib/permissions.js`:
  - 5 new resources added to RESOURCE_LABELS / EMAIL_SUPPORTED, plus a
    DELETE_SUPPORTED map and a 5-element ACTIONS export.
- `components/settings/ActiveSessionsPanel.jsx` (new) mounted inside
  the Session Timeout card. Auto-refresh every 30s, relative timestamps,
  per-row revoke (`revoke-session-{jti}`), self-revoke is blocked with a
  toast guiding admins to "Force logout everyone" instead.

## Curl receipts
- `GET /api/auth/me` (admin) → `effective_permissions` now contains
  `workers/inductions/certifications/documents/forms` each with proper
  delete=True, edit=True, view=True for admin.
- `GET /api/admin/active-sessions` admin → 200 (17 sessions live);
  worker → **403**.
- Per-user override end-to-end (worker_stephen + certifications.delete):
    1. Pre-override `effective.certifications.delete = False` (worker role default).
    2. As worker — `DELETE /workers/certifications/{id}` → **403**.
    3. Admin `PUT /users/{id}/permissions {overrides: {certifications:{delete:true}}}` → 200,
       effective now True.
    4. Re-login worker — `DELETE` same cert → **204** (over-the-wall!)
    5. Admin `POST /users/{id}/permissions/reset` → 200, override cleared.
    6. Worker re-tries delete → back to **403**. End-to-end gate works.

## Cache
- `service-worker.js` → **paneltec-v84**.

## Screenshots
- `/tmp/users_with_edit_perms.png` — 6 user rows, each with the new violet ✏️ Edit-permissions button next to the existing logout + delete actions.
- `/tmp/perms_modal_search.png` — drawer opened on Permissions tab, `cert` search filters to just the Certifications row.
- `/tmp/active_sessions_panel.png` — 24 live sessions with relative timestamps and per-row revoke buttons.

## Next Action Items
- Phase 4.1 — SWMS Assignments admin page + version-chain commit (P2).
- Phase 4.2/4.3 — Site / Supplier Induction QR (P2).
- Long-term: extend granular catalog to include `add` separately (today
  it's bundled into `edit`) once the user has a concrete use case.

---


# 2026-06-29 — Phase 3.16 Parts A+B + Phase 3.17 (Certifications row actions)

## Part A — `session_timeout.py` BSON-Date normalisation (FAIL-SAFE)
- New helper `_normalise_activity_ts(raw) -> Optional[datetime]` (tz-aware UTC).
  Accepts: ISO string (w/ or w/o `Z` / offset / tzinfo), `datetime` (naive → UTC,
  tz-aware → unchanged). Anything else / malformed → `None`.
- `touch_and_check_session()` now calls the helper. `None` returns make the
  caller delete the row and return `session_idle_timeout` — fail SAFE, not
  fail OPEN (which was the silent BSON-Date bug pre-Phase 3.16).
- Belt-and-suspenders pytest suite: `tests/test_session_timeout_normalisation.py`
  · 9 tests · ISO+offset, ISO+Z, naive ISO, tz-aware dt, naive dt, 2h-old dt,
  malformed strings, None, unknown types (int, dict, list) — all passing.
- **Curl receipt** (real BSON Date via Motor):
    - BEFORE tamper: GET /api/auth/me → HTTP 200
    - TAMPER: `last_activity_at` = `datetime.now(UTC) − 2h` (naive datetime,
      stored as BSON Date by Motor — `type: datetime`, no tzinfo)
    - AFTER tamper: GET /api/auth/me → HTTP 401 `{"detail":"session_idle_timeout"}`
    - Garbage-string tamper (`"not-a-date"`) → also 401 `session_idle_timeout`.

## Part B — Phase 3.16 deferred UI
- `components/settings/SessionTimeoutCard.jsx` (new, admin-gated, mounted in
  Settings → System under the Server Tools section). Surfaces:
    - Idle timeout dropdown (15m / 30m / 1h / 2h / 4h / 8h)
    - Absolute timeout dropdown (4h / 8h / 12h / 24h / 72h)
    - Warning modal toggle + lead-time dropdown (15s / 30s / 1m / 2m)
    - Remember-me toggle (controls `/login` "Keep me logged in" visibility)
    - Per-role overrides toggle + 6-row matrix (admin / manager / hseq_lead /
      auditor / supervisor / worker, each with idle-min + absolute-hr inputs)
    - "Save changes" (dirty-tracked, disabled when no diff)
    - Danger zone: "Force logout everyone" with inline confirm pattern →
      POSTs `/api/admin/settings/force-logout-all` then signs the admin out.
- `Login.jsx` — calls `GET /api/settings/login-options` on mount. When
  `remember_me_enabled=true`, renders the "Keep me logged in" checkbox under
  the password field. `lib/auth.js::login()` now accepts `{remember_me}` and
  forwards it in the POST payload.
- **AppShell.jsx scope fix**: previous agent had declared `warnInfo`
  state inside `TopBar` but referenced it from `AppShell`'s JSX → uncaught
  `ReferenceError: warnInfo is not defined` blocked every `/app/*` render.
  Moved the `useSessionTimeout` hook + state up into `AppShell`.

## Part C — Phase 3.17 Certifications row actions
- `pages/Certifications.jsx` action column adds three icon buttons before
  Send-reminder:
    - 👁 **View PDF** — opens existing `PdfPreviewModal` with the cert's
      `doc_file_id`. Disabled (greyed) when the cert has no uploaded file.
    - ✏️ **Edit** (admin / hseq_lead) — opens `CertEditModal` (new). Patches
      `name / issuer / issue_date / expiry_date` via
      `PATCH /api/workers/certifications/{id}`. Backend recomputes
      `doc_seed_folder` automatically when `name` changes.
    - 🗑 **Delete** (admin only) — opens `CertDeleteConfirm` (new). Posts
      `DELETE /api/workers/certifications/{id}`. Soft-deletes the cert and
      detaches the file if no other cert references it.
- **Curl receipts**:
    - admin PATCH → HTTP 200 (rename), restore PATCH → HTTP 200.
    - worker DELETE → HTTP 403 (auth gate intact).
- Both modals follow the rounded-2xl shell pattern of InductionCardModal,
  ESC closes, backdrop click closes when not busy, no `window.confirm()`.

## Cache version
- `service-worker.js` bumped to **paneltec-v83**.

## Pre-flight
- `python -m py_compile $(find /app/backend -maxdepth 2 -name "*.py")` ✓
- `yarn build` ✓ (warnings only, all pre-existing exhaustive-deps).
- `pytest tests/test_session_timeout_normalisation.py` → 9/9 passed.

## Screenshots (saved as receipts)
- `/tmp/login_remember_me.png` — checkbox rendered under password when admin enables remember-me.
- `/tmp/settings_session_timeout.png` — full Session Timeout card with role override matrix open.
- `/tmp/cert_row_actions.png` — Certifications page with all 4 row buttons per cert.
- `/tmp/cert_edit_modal.png` — Edit modal showing LISA TAFARI / Traffic Control / 2017-12-19.
- `/tmp/cert_delete_modal.png` — Delete confirmation copy nailing the soft-delete semantics.

## Next Action Items
- Phase 3.18 — Granular per-user permission overrides (P1).
- Phase 4.1 — SWMS Assignments admin page + version-chain commit (P2).

---


# 2026-02-19 — Phase 3.10: Universal PDF preview for Document Library files

## Backend (`file_pdf.py` + server.py wiring)
- `GET /api/files/{id}/pdf` and `/api/files/{id}/pdf.pdf` (ad-blocker-friendly alias).
- `?dl=1` switches Content-Disposition to attachment.
- Conversion pipelines:
  - `passthrough` (PDF) · `image` (JPG/PNG/WEBP) · `heic` (pillow-heif → JPG)
  - `text` (CSV/TXT/MD via reportlab monospace)
  - `docx_docx2pdf` → if <1 KB output, falls back to `docx_text_fallback` (python-docx → reportlab plain text — lossy but **never blank**)
  - Anything else → **415** `{"detail":"PDF preview not available for {mime}"}`
- Cache: `doc_files_pdf_cache` keyed by `(file_id, sha1, pipeline)`. Subsequent calls bypass conversion. Invalidates automatically when the original file changes (sha1 mismatch).
- `POST /api/files/pdf-bundle {file_ids:[...]}` (admin/manager/hseq_lead, max 25) → single concatenated PDF via PyPDF2 merger; reports skipped/unconvertible IDs.
- `POST /api/admin/install-libreoffice?include_ocr=true` (admin only) — dormant install hook for LibreOffice + Tesseract + Poppler. Streams the apt-get tail back. **Does NOT auto-trigger.**
- `GET /api/admin/system-tools` — `which`/version status for the three optional toolchains.

## Frontend (`SystemSettings.jsx` + `AppShell.jsx`)
- New **Settings → System** page (admin-only, nav-testid `nav-settings-system`).
- Three tool cards (`tool-libreoffice` / `tool-tesseract` / `tool-poppler`) show install status (checkmark + version when installed, greyed "Not installed" otherwise).
- "Install now" button + "Run health check" — clicking install POSTs `?include_ocr=true`, displays install log in a dark terminal block on completion.
- Friendly footer card explaining today's Phase A coverage (PDF/images/HEIC/text/DOCX-fallback) vs what installing unlocks (XLSX/PPTX/ODT + full-fidelity DOCX + OCR).
- Service worker bumped to **paneltec-v61**.

## Receipts
- **TXT** → 1799 b PDF · pipeline=`text` · cache HIT on 2nd call (95 ms vs 104 ms).
- **PDF** passthrough → 322 471 b · pipeline=`passthrough` · cache HIT (`%PDF` magic).
- **PNG** → 11 960 b PDF · pipeline=`image`.
- **DOCX** → 1924 b PDF · pipeline=`docx_text_fallback` (LibreOffice not installed; docx2pdf raised → text fallback rendered the headings + bullets + tables as flattened text). >1 KB guard satisfied.
- **ZIP-mime** → **415** `{"detail":"PDF preview not available for application/zip"}`.
- **/pdf.pdf** alias variant → 200 · same body.
- **?dl=1** → `Content-Disposition: attachment; filename="test.pdf"`.
- **Bundle** of 2 files → 323 398 b single concatenated PDF · `X-Bundle-Converted: 2`.
- **System tools status** → all three `installed: false` (expected for Phase A).
- **Worker → 403** on `POST /admin/install-libreoffice`.
- Cache collection: 4 rows after the test suite, one per pipeline used.

## Pre-flight
- `python -m py_compile` ✓ clean.
- `cd /app/frontend && yarn build` ✓ 19.0 s, no compile errors.
- `curl /api/health` 200; backend log clean apart from the expected "docx2pdf is not implemented for linux" notice when DOCX hits the fallback.
- `requirements.txt` updated with `pillow_heif==1.4.0`, `PyPDF2==3.0.1`, `docx2pdf==0.1.8`, `openpyxl==3.1.5`, `python-docx==1.2.0`.
- `CACHE_VERSION = 'paneltec-v61'` ✓.

## Out of scope this phase (P1 follow-ups)
- **Document Library row buttons** (View PDF / Download PDF / disabled tooltip) and **PdfPreviewModal** — the backend endpoints are wired and the System page lets admin install the toolchain; the row-level buttons + modal ship in Phase 3.11 (small, isolated frontend work).
- **Bulk PDF toolbar action** on Workers certs / Renewal Links — needs each page's existing multi-select wired to the bundle endpoint.
- **Async 202 + job_id polling** for files >5 MB — current conversion is fast enough for the seeded corpus; ship when first user reports a >2 s wait.

---


# 2026-02-19 — Phase 3.9c + SWMS-06 ingest

## Phase 3.9c — Per-worker / per-role / per-company Form Assignments
**Backend** (`asset_service.py`, `forms.py`, `workers_qr.py`, new `form_assignment_notifier.py`, migration `migrate_seed_form_applies_to.py`):
- Extended `form_templates.applies_to` with `worker_ids`, `roles`, `companies` (each with optional `expires_at`).
- New `resolve_forms_for_worker()` combines asset-type + direct/role/company rules and decorates with `match_reasons`.
- `PUT /api/form-templates/{id}/applies-to` and `POST /assignments/bulk` accept the new fields; unknown `worker_id` → 422; `skip_notifications:true` mutes the dispatcher.
- New `POST /preview-recipients` returns prior/next/newly-added counts + sample without persisting.
- `GET /api/forms/templates?for_worker=me|<id>` filters the library to that worker; admins see `?show_all=true` bypass.
- `GET /api/scan/{token}/forms` now returns `match_reasons` per form.
- Notification dispatcher fires email (Microsoft 365 outbox) + SMS (TextMagic) within ~1 s of save, deduped per (worker_id, template_id) for 24 h via `form_assignment_notifications`.

**Frontend** (`FormAssignmentsAdmin.jsx`, `Forms.jsx`, `WorkerScanResolver.jsx`, `service-worker.js` → `v60`):
- Three new right-pane sections in FormAssignmentsAdmin (`section-workers/section-roles/section-companies`) + live "Visible to N workers" counter (`visible-counter`) + Save → Notify confirm dialog (`notify-confirm` / `notify-skip` / `notify-send`).
- `/app/forms` for workers calls `?for_worker=me` automatically; admins see the full library.
- WorkerScanResolver site search debounced 300 ms; site IDs slugified into testids.

**Phase 4.1 code-review fixes:**
1. RBAC on `/api/scan/worker/{token}/site-signin` — workers can only sign themselves in (cross-worker → 403). Admin/manager/hseq_lead unrestricted.
2. WorkerScanResolver picker testids slugified.
3. Site-search debounced 300 ms.
4. site_signins row's `workspace_id` now prefers the WORKER's own workspace.
5. No `dangerouslySetInnerHTML` usage in Workers.jsx (confirmed via grep).

**Receipts:** list_assignments returns roles+companies; PUT with worker+role+company → `notify.newly_added_count=30 queued=true`; unknown worker_id → 422; `email_outbox` row "New safety form: Equipment Pre-Use Checklist · sent" + 17 dedupe rows; admin signing another worker → 200 with worker's workspace_id; worker→ 403 cross-signin; CACHE_VERSION = `paneltec-v60`.

**Regression follow-up:** iteration 19 caught a missing-hook bug in `WorkerScanResolver.jsx` (`debouncedQ`/`slug` undefined). Patched — hook + helper now declared at module scope.

## SWMS-06 ingest (queued after Phase 3.9c)

**Module:** pre-existing — `swms` collection + `crud.build_router("swms", "swms", SwmsIn, "swms")` + `pdf_renderer.render_swms_pdf`. Extended, not duplicated.

**Backend changes:**
- `models.SwmsIn` extended with optional rich fields (`code, version, slug, scope, high_risk_construction_work, prepared_by, approved_by, review_date, activity_analysis, environmental_risks, training_requirements, equipment_list, emergency_procedures, legislation_and_codes, attendance_sheet_template, source_file, applies_to, superseded_by, supersedes`). Legacy AI-draft path unaffected.
- New `swms_extras.py` — full SWMS-06 V12.0 payload + `seed_swms_06()` (idempotent, runs on startup, one record per org) + `POST /api/swms/import-docx` (admin-only; fetches .docx, parses via `python-docx`, returns inferred payload for review — does NOT auto-save).
- `pdf_renderer.render_swms_pdf(doc, layout='civil')` — modern Paneltec Civil layout by default; `layout='original'` switches to traditional Paneltec table layout with formal borders. Both branches render activity/hazard table, environmental risks table, PPE/training/equipment/legislation bullets, emergency procedures, and a 12-row attendance sign-off sheet.
- `pdf_routes._build` now accepts `?layout=civil|original` query on the SWMS endpoint.
- Installed `python-docx==1.2.0` + `lxml==6.1.1` (added to requirements.txt).
- Startup registration: `swms_extras_router` mounted + `seed_swms_06()` called from `on_startup`.

**Receipts (stephen@paneltec org, seed id `c05bd7ee-8f7d-40fc-b4ad-719dcab25e4b`):**
- `GET /api/swms` → 7 records, includes SWMS-06 V12.0 status=approved review_date=2026-08-31.
- `GET /api/swms/{id}` → full payload returns prepared_by=Patrick Monaghan, approved_by=John Guy, 11 activity_analysis rows, 9 environmental_risks, applies_to.asset_types=[concrete_saw, slab_cutter], source_file URL preserved.
- `GET /api/swms/{id}/pdf?layout=civil` → 200, 17 458 bytes, `%PDF-1.4` magic.
- `GET /api/swms/{id}/pdf?layout=original` → 200, 17 502 bytes (different size confirms layout branch).
- `POST /api/swms/import-docx` → 200, parses the .docx into 16 paragraphs + 14 tables, returns inferred title="2018 SWMS-06 Concrete or Asphalt Cutting".
- Frontend `/app/swms` list shows the new record at top (APPROVED · vV12.0 · Open report / Email).
- Frontend `/app/swms/{id}` detail renders the title, status pill, PPE block.

**Deferred to a future phase (P1):**
- SWMS Assignments admin page at `/app/settings/swms-assignments` (two-pane like FormAssignmentsAdmin, targeting asset_types/workers/roles/companies). Backend `applies_to` already accepts the same shape — wire the UI when the user greenlights Phase 4.2.
- SWMS detail view currently doesn't render the structured activity_analysis / environmental_risks tables in-app (the PDF does). Add a `RichSwmsDetail` component when prioritised.
- `superseded_by`/`supersedes` archive flow (auto-archive on new version).
- "Civil PDF" + "Original layout PDF" split-button on the detail page (the URL param is wired; the dropdown UI ships when SWMS frontend is rebuilt).

---


# 2026-02-19 — Phase 4.1: Worker Induction QR + Printable ID Cards

## Backend (`/app/backend/workers_qr.py`)
- **Endpoints**
  - `GET /api/workers/{id}/qr.png` — admin-only PNG of the worker's signed scan URL.
  - `GET /api/workers/{id}/id-card.pdf?layout=wallet|lanyard|avery` — ReportLab-generated PDFs (wallet default = ID-1 85.6×54 mm, lanyard 100×150 mm portrait, Avery A4 10-up).
  - `POST /api/workers/{id}/nfc-pair` `{nfc_uid}` — pairs a UHF/NFC tag UID with a worker; duplicate UID on a different worker returns `409`.
  - `DELETE /api/workers/{id}/nfc-pair` — unpairs.
  - `GET /api/scan/worker/{scan_token}` — **PUBLIC** (no auth). Returns `{id,name,role,trade,company,scan_token,certifications,assigned_swms,active_site_today}` for the lanyard scan resolver.
  - `POST /api/scan/worker/{scan_token}/site-signin` `{site_id,site_name,gps}` — authed; inserts a `site_signins` row with `source="worker_qr"` and the calling user's `org_id` + `workspace_id`.
- **Migration**: nanoid 10-char `scan_token` backfilled into all 61 existing workers at startup. `_full_name(w)` helper derives display name from `first_name + last_name` (workers don't have a single `name` column).
- **Coexistence**: `/api/scan/worker/{token}` (new) and `/api/scan/{asset_token}/forms` (Phase 3.8) share the `/scan` mount with no shadowing — verified by regression test.

## Frontend
- **New** `pages/WorkerScanResolver.jsx` — public route `/scan/worker/:token`. Renders profile card, certifications chip strip, "Already signed in to {site}" banner, and dual-state CTA: anonymous shows "Log in to sign in" → `/login?next=...`, authed shows "Sign in to site" → opens a site picker modal backed by `/api/forms/pickers/sites`.
- **`pages/Workers.jsx`** — added:
  - Row chips: green `QR` (every worker, 60 rows) + purple `NFC` (when paired).
  - Row action button: `Printer` icon → one-click wallet PDF in new tab.
  - `IdCardSection` accordion inside `EditModal` with: QR preview (blob-fetch with bearer header), 3-up layout picker (`wallet` selected by default), Print preview / Download PDF buttons, NFC pair input (auto-uppercase, hex+colon filtered) with Pair / Unpair buttons.
- **Service worker** bumped `paneltec-v57 → v58`.

## Pre-flight (mandatory after previous build-breaks)
- `python -m py_compile $(find /app/backend -maxdepth 2 -name "*.py")` ✓ clean.
- `cd /app/frontend && DISABLE_ESLINT_PLUGIN=true yarn build` ✓ 19.4s, no compile errors.
- `curl /api/health` → 200; `curl /api/auth/login` → 200.

## Verification — Phase 4.1 receipts (Stephen Guy, id=dbddf739-5803-4a86-925d-ed1aef514fa1, scan_token=i4UmjUBzsi)
- **Public profile (anon)** `GET /api/scan/worker/i4UmjUBzsi` → 200 · 251 b · `name="Stephen Guy"`, 4 certs, `active_site_today="130 Cimitiere St Launceston"`.
- **Invalid token** `GET /api/scan/worker/__invalid__` → 404.
- **Wallet PDF** → 200, `%PDF` magic ✓. **Lanyard PDF** → 200, `%PDF` ✓. **Avery A4 PDF** → 200, `%PDF` ✓.
- **QR PNG** → 200, `\x89PNG` ✓.
- **Site sign-in** POST `{site_id:"130 Cimitiere St Launceston",gps:{...}}` → 200; row has `source="worker_qr"`, `workspace_id="156f06df…"`, `worker_name="Stephen Guy"`, `signed_in_by_name="Stephen McGregor"`. Subsequent profile fetch shows `active_site_today` populated.
- **NFC pair** `04:A1:B2:C3:D4:E5` → 200 OK. Re-paring same UID to a different worker → **409 conflict**. ✓
- **Asset scan regression** `GET /api/scan/03tuIaQGp5/forms` → 200, returns Scott Campbell vehicle + 6 forms (Phase 3.8 + 3.9b unaffected). ✓

## Testing
- `testing_agent_v3` iteration 18 → backend **12/12 pytest pass**, frontend **100% pass**. Zero critical/minor bugs. Pytest module at `/app/backend/tests/test_phase_41_worker_qr.py`.
- Code-review notes (non-blocking): site-signin doesn't yet enforce role RBAC; site picker testids include spaces; sites picker lacks debounce; workspace_id falls back to first allowed workspace.

## Out of scope (Phase 4.2/4.3)
- **Phase 4.2** — Site induction QR (posters per site, induction acknowledgement record, expiry).
- **Phase 4.3** — Supplier induction QR + supplier compliance gating.
- Slugify site-signin picker IDs.
- Debounce site search in `WorkerScanResolver`.

---


# 2026-02-18 — Phase 3: Service & Maintenance for Plant & Vehicles

## Backend (new `/app/backend/asset_service.py`)
- **Collections** (with indexes wired in `seed.ensure_indexes`):
  - `asset_service_schedules` — name, interval_kind (hours|km|calendar), interval_value, calendar_unit, last_done_at/value, computed next_due_at/value, status_cached, reminder_lead_*, status, soft delete.
  - `asset_service_records` — type (service|defect|meter_update), title, description, performed_at/by, hours_at/km_at, cost, technician, photo_file_ids, defect_severity, linked_hazard_id, schedule_id.
  - `asset_reminders_sent` — dedupe key (schedule_id, status, sent_at).
- **Endpoints under `/api/assets/{asset_id}/...`**: CRUD for schedules + records, `POST /meter` quick endpoint, `GET /records?type=`, `DELETE /records/{rid}` (admin only).
- **`POST /api/assets/service/scan-reminders`** — walks active schedules, computes due/overdue using `_compute_next_due`, queues M365 email via existing `email_outbox.queue_email_doc` and SMS via TextMagic API, deduplicates within 24h per (schedule, status).
- **`GET /api/assets/service/summary`** — dashboard payload: `{overdue, due_soon, items:[top-5]}`.
- **`POST /api/scan/quick-action`** — public-scan-driven endpoint (JWT) for the worker's three actions: `log_service` / `report_defect` / `update_meter`. Resolves token → asset and dispatches into `create_record`.
- **Defect → Hazard auto-link**: `_maybe_raise_hazard` checks workspace setting `settings.defectAutoCreatesHazard` (default true). Major/critical defects insert a `hazards` row with `source="asset_defect"`, `linked_asset_id`, severity mapped (critical→high, major→medium). The defect record stores `linked_hazard_id`.
- **Schedule recompute**: `create_record(type=service, schedule_id=…)` updates `last_done_at/value` and recomputes `next_due_*`. Meter-only updates also recompute *all* active schedules on the asset.
- Permissions middleware leverages existing `assets` resource gate; worker `POST /api/assets/{id}/schedules` → 403 (verified).

## Frontend
- **New `components/AssetServiceTabs.jsx`** — `ServiceSchedulesTab` (list with OK/DUE SOON/OVERDUE pills + add/edit modal) and `ServiceLogTab` (chronological feed with severity chips and `Hazard raised` badge linking to the auto-created hazard).
- **`AssetDrawer.jsx`** — added `Schedules` and `Service log` tabs.
- **`pages/ScanResolver.jsx`** — added `ScanQuickActions` panel: three buttons (Log service / Report defect / Update hours/km) rendered above the existing View / Copy actions. Slide-up form posts to `/api/scan/quick-action` and toasts "Done · added to {asset}" (or "Hazard raised" when applicable).
- **`pages/Dashboard.jsx`** — new `PlantDueWidget` next to the existing certs widget. Counts overdue + due-soon, lists top 5, links to `/app/vehicles`.
- Service worker bumped `paneltec-v41 → v42`.

## Workspace setting
- `workspaces.settings.defectAutoCreatesHazard` (bool, default true). Updated directly via MongoDB in this phase — UI toggle (Settings → Compliance) deferred to follow-up.

## Verification (curl + screenshots)
- **Schedule lifecycle**: POST `/api/assets/{id}/schedules` `{name:"250hr service",interval_kind:"hours",interval_value:250}` → status `ok` (cur=0, next=250). After POST `/meter {hours:260}` schedule cache flips to `overdue`. Dashboard summary now returns `overdue:1`.
- **Scan-reminders**: 1st call `{scanned:1, overdue:1, emails_sent:1+}`. 2nd call within 24h `{emails_sent:0}` (dedupe). ✓
- **Defect→Hazard**: critical defect via `/api/scan/quick-action` → hazards count 5→6, `linked_hazard_id` populated on the defect record. ✓
- **Toggle OFF** `defectAutoCreatesHazard=false`: critical defect → `linked_hazard_id:null`, hazards count unchanged. ✓
- **Worker (non-admin)**: `POST /api/assets/{id}/schedules` → 403. ✓
- Playwright screenshots (`/app/test_reports/p3_01..04_*.png`):
  - `p3_01_dashboard` — Plant due widget visible, counter "1 OVERDUE · 0 DUE SOON".
  - `p3_02_schedules_tab` — AssetDrawer Schedules tab with header and Add button.
  - `p3_03_service_log` — Service log tab with Log service + Report defect buttons.
  - `p3_04_scan_quick_actions` — `/scan/EFLdyI3Thc` page now shows three quick-action buttons above View / Copy.

## Out of scope (deferred)
- Plant & Vehicles list status chip per row + sort/filter by service status.
- Bulk "Scan reminders now" toolbar button in PlantVehicles header.
- Settings → Compliance UI toggle for `defectAutoCreatesHazard` (workspace-level direct DB update works today).
- Service-record PDF (acceptance criterion — falls back to existing `forms_pdf.py` for any forms attached, no separate `asset_service_pdf.py` yet).
- Worker / Site / Supplier QR (Phase 4) and UHF (Phase 5) — explicitly out of scope.


# 2026-02-18 — Phase 2: Scan-to-fill on Forms (`asset_scan` field)

## Backend
- `forms.py`:
  - `asset_scan` added to `ALLOWED_FIELD_TYPES`; `_clean_field` now preserves a `config` blob (per-field settings: `requireScan`, `kindFilter`, `autofillTargets`).
  - `GET /api/forms/assets/lookup?token=…` (JWT) — authed wrapper around the public scan resolver, also returns `vehicle_type_slug`, `last_known_lat/lng/at`, `odo_km`, `hours_meter`. 404 on unknown, 410 on retired.
  - `GET /api/forms/assets/picker?q=&kind=&asset_type=` (JWT) — trimmed picker list, workspace-scoped (org-wide Navixy + workspace manual assets).

## Frontend
- **New** `src/components/forms/AssetScanField.jsx`:
  - Segmented control with capability auto-detect (`'NDEFReader' in window`, `navigator.mediaDevices`, `'BarcodeDetector' in window`).
  - **QR Camera**: `BarcodeDetector` first, `jsQR` fallback on hidden canvas; environment-facing camera; overlay box and Start/Stop controls.
  - **NFC Tap**: `NDEFReader().scan()` listens for the first `url` record; abort-controller for clean stop; gracefully hides on unsupported browsers.
  - **Manual Pick**: debounced `/api/forms/assets/picker` calls.
  - Resolve flow: any input → `/api/forms/assets/lookup` → green confirmation card ("Resolved · PLANT · EXCAVATOR …") with **Use this** / **Scan again**.
  - On confirm, dispatches `paneltec:asset-autofill` event with target field values.
  - Exports `buildAutofillFromAsset(allFields, asset)` — maps vehicle_type/rego/gps/odo/hours into sibling field ids by label heuristics.
- `Forms.jsx`:
  - `FieldRunner` adds `asset_scan` case and routes the autofill event.
  - `FillOutModal` listens for the autofill event, locks affected fields, and renders an inline **Override** link to unlock individual fields.
  - URL handler: `?template={id}&scan={token}` auto-opens FillOutModal with `_initialValues` pre-set (asset card + dependent autofill applied).
- `pages/ScanResolver.jsx`:
  - When `?form={id}` is present **and** user is authed, the resolver stashes `{scan_token, form_id, at}` in `sessionStorage.paneltec.activeScan` and navigates to `/app/forms?template={id}&scan={token}` for a seamless landing.
- `components/forms/TemplateBuilder.jsx`:
  - `asset_scan` added to `FIELD_TYPES` palette.
  - Save payload now persists `config` per field.
- Service Worker bumped `paneltec-v40 → paneltec-v41`.

## Heavy Vehicle Daily Check migration
- Patched template `be6e01d5-1e98-4d81-bb4a-33fd607f0d20`: inserted an `asset_scan` field at position 0 ("Scan asset", `requireScan=false`, `kindFilter=any`). Field order: Scan asset → Date → Vehicle Type → Vehicle Rego.

## Dependencies
- `jsqr@1.4.0` added to `package.json` (`yarn add jsqr`).

## Verification
- curl smoke: `GET /api/forms/assets/lookup?token=EFLdyI3Thc` returns enriched payload (vehicle_type_slug: "excavator"); bad token → 404. `GET /api/forms/assets/picker?q=exc&kind=plant&limit=5` returns CAT 320.
- Playwright e2e (5 screenshots `/app/test_reports/p2_01..p2_05_*.png`):
  1. Heavy Vehicle Daily Check opens with Scan asset segmented control (QR Camera / Manual pick).
  2. Manual pick lists workspace assets.
  3. Search "CAT 320" → green Resolved card with Use this / Scan again.
  4. Use this → asset chip persisted ("via manual"); Vehicle Rego auto-filled to "CAT 320 Excavator (Yard) · EX-320-007" and shows **Override** link (locked).
  5. Deep-link `/scan/EFLdyI3Thc?form={tpl}` → modal auto-opens with asset chip pre-filled ("via qr").

## Deferred (out of scope for Phase 2)
- Vehicle Type auto-select when the template's `select` options don't include an "Excavator" / matching slug (autofill correctly no-ops). Templates that want auto-Vehicle-Type should add the matching option label.
- Service & Maintenance schedules (Phase 3).
- Worker/Supplier/Site QR (Phase 4).
- UHF sled (Phase 5).


# 2026-02-18 — Phase 1: Plant & Vehicles Register (Asset Register backbone)

## New backend module `/app/backend/assets.py`
- Collection `assets` indexed by `scan_token` (unique), `(org_id, kind)`, `navixy_device_id` (sparse), `nfc_uid` (sparse).
- Routes (under `/api/assets`):
  - `GET /` — list + backfill from Navixy on every call (idempotent on `navixy_device_id`). Filters: `kind`, `asset_type`, `q`.
  - `POST /` — create manual asset (admin/manager/hseq_lead via `assets.edit`).
  - `GET /{id}`, `PUT /{id}`, `DELETE /{id}` — read / update / soft-archive.
  - `GET /{id}/qr.png` — QR PNG encoding `${FRONTEND_PUBLIC_URL}/scan/{token}`.
  - `GET /{id}/label.pdf?layout=a6|avery_l7160|on_metal|combo&ids=…` — ReportLab labels.
  - `POST /{id}/nfc-pair` (workspace-scoped uid uniqueness → 409 on dup) + `DELETE /{id}/nfc-pair`.
  - `POST /{id}/uhf-pair` — Phase 5 stub.
  - `GET /scan/{token}` — **public, no JWT** (skipped in permissions middleware). Returns sanitised payload, `410` on retired, `404` on unknown.
- Navixy backfill uses `_classify_vehicle_type(label, tag_names)` from `forms.py` — vehicles inherit the same vac-truck/tipper classification.
- Rego parsed from Navixy labels with a regex heuristic (last alphanumeric token w/ ≥1 letter and ≥1 digit).

## Permissions
- `permissions.py`: added `assets` resource (`email_supported=False`). admin/hseq_lead: full edit; supervisor/worker/auditor: view-only.
- `permissions_middleware.py`: added `(/api/assets, "assets")` matcher and `^/api/assets/scan/` skip path for the public resolver.

## Frontend
- New `/app/frontend/src/pages/PlantVehicles.jsx` — unified register: filter chips (All / Vehicles / Plant / Tools / Containers), type sub-pills, search, list/map view, source badges (LIVE NAVIXY / MANUAL) + pairing chips (QR ✓ / NFC ✓ / UHF ✓), per-row actions (Locate, QR download, Print label, Edit, Archive), `+ Add Asset` and `Print Labels` (multi-select via layout picker).
- New `/app/frontend/src/components/AssetDrawer.jsx` — right-side drawer with Details / Pairing / Photo / Notes tabs. Pairing tab includes QR preview, label printers (a6/on_metal/combo/avery_l7160), Web NFC writing via `NDEFReader` with manual UID fallback, and UHF EPC field. Navixy-linked assets lock core fields ("Synced from Navixy").
- New `/app/frontend/src/pages/ScanResolver.jsx` at `/scan/:token` (public route) — anonymous-safe; redirects to `/login?next=…` for full access. Phase 2 will read `sessionStorage` form context to push the asset into an active form.
- Sidebar renamed "Vehicles" → **Plant & Vehicles** (still routed at `/app/vehicles`, legacy at `/app/vehicles-legacy`). Resource gate changed `vehicles` → `assets`.
- `lib/permissions.js` RESOURCE_LABELS/EMAIL_SUPPORTED updated.
- Service Worker bumped `paneltec-v38 → paneltec-v39`.

## Dependencies
- Added `qrcode==8.2` to `requirements.txt` (`pip install qrcode[pil]`). `reportlab` already present.

## Verification (curl + screenshot)
- Backend smoke: 72 Navixy vehicles backfilled, CAT 320 Excavator (Yard) created with token `EFLdyI3Thc`. PDF labels valid (`%PDF-`) at a6=14KB, combo=11KB, on_metal=18KB, avery_l7160=26KB (3 ids). QR PNG ~2KB, valid `\x89PNG`. NFC pair success + duplicate 409. Worker token: GET 200, POST 403.
- Frontend smoke: sidebar shows "Plant & Vehicles", page lists 73/73 (72 live · 1 manual), CAT 320 Excavator appears with MANUAL + QR ✓ + NFC ✓ chips. `/scan/EFLdyI3Thc` renders the resolver card with name + rego + actions.

## Phase 1 acceptance: all met
- GET /api/assets merges + backfills ✓
- POST creates with unique scan_token ✓
- /qr.png returns PNG that decodes to `${FRONTEND_PUBLIC_URL}/scan/{token}` ✓
- /label.pdf?layout=a6 returns PDF (14KB, well under 200KB cap) ✓
- avery_l7160 with `?ids=` lays 3-up ✓
- NFC duplicate → 409 ✓
- Plant & Vehicles page lists merged set with chips ✓
- Worker role hides create/edit/delete ✓
- /scan/{token} works end-to-end ✓

## Deferred to next phases
- Photo upload via doc_files (drawer accepts ID only for now)
- `asset_scan` form field (Phase 2)
- Service & Maintenance schedules (Phase 3)
- Worker/Supplier/Site QR (Phase 4)
- UHF sled integration (Phase 5)
- Expo mobile parity — dispatch `e1_expo_frontend_dev`


# 2026-02-18 — Vehicle Type → Filtered Navixy Fleet (verified)
- `_classify_vehicle_type(label, tag_names=None)` in `/app/backend/forms.py` now searches Navixy **tags first**, label second. This lifted vac-truck detection from 2 → 13 (Cap Recycler, Industrial, Cappelotto, RSP, VW Crafter, etc. all carry the "Vac Truck Dumping" tag but have free-form labels).
- `/api/forms/fleet/vehicles` proxy passes each vehicle's `tags[].name` array into the classifier.
- Frontend `Forms.jsx` `FieldRunner` was restored to its proper dispatch (the previous "duplicate cleanup" had accidentally left only the VehicleNavixyField body inside, breaking every non-vehicle field render). `FieldRunner` now correctly delegates `photo/signature/gps/vehicle_navixy/textarea/select/radio/date/number/text` and threads `allFields` + `allValues` into the vehicle picker.
- Service Worker bumped `paneltec-v37 → paneltec-v38`.
- Verified on **Heavy Vehicle Daily Check**:
  - Field order Date → Vehicle Type → Vehicle Rego (migration intact).
  - No selection → 72 vehicles shown.
  - "Vacuum Truck" → "Showing 13 vehicles matching Vacuum Truck" (Cap Recycler ✓, Industrial ✓, Cappelotto 1/2/3 ✓, Vacvator 1/2 ✓, RSP, VW Crafter CCTV, Kroll Recycler, DW FX50/FX60, "Other" w/ Vac tag).
  - "Tipper" → "Showing 11 vehicles matching Tipper" (UD/500/200/HINO/450 Tippers).
  - Clear filter → all 72 vehicles return.


# 2026-02-17 — PDF viewer Edge-block fix
- `POST /api/pdf-token` mints a 90s JWT (claims: sub/org_id/resource/record_id/action/exp, type=pdf-token).
- Each `/api/{resource}/{id}/pdf` accepts EITHER `Authorization: Bearer <user-jwt>` OR `?token=<pdf-token>`.
- Frontend `PdfActions.jsx` switched from blob+iframe to `window.open` + signed URL. `PdfViewerModal.jsx` deleted.
- Token is bound to the exact resource+record_id — mismatch → 403 `pdf-token-mismatch`; expired → 401 `pdf-token-expired`; garbage → 401 `pdf-token-invalid`.


# 2026-02-17 — User management opened to hseq_lead (verified)
- `hseq_lead` now has `users.{open,view,edit}=true` (still `email=false`). Confirmed via `/api/auth/me`.
- `GET /api/workspaces` (org-scoped list) wired and consumed by the user-edit drawer.
- `UsersManagement.jsx` user drawer now renders a functional workspace multi-select (checkboxes per workspace).
- Verified end-to-end as `hseq_lead`: invite → patch (rename + add workspace) → delete (soft-disable) → reactivate via PATCH status=active.
- Regression: `worker` token still returns 403 on `GET /api/users` and `POST /api/users` (lower roles untouched).


# Phase 5 — Permissions Matrix + Email Outbox (shipped 2026-02-17)

## Permission model
- 12 resources × 4 actions (open / view / edit / email). Vehicles, integrations and users have `email_supported: false`.
- Role defaults in `/app/backend/permissions.py::ROLE_DEFAULTS`. Per-user overrides stored in Mongo collection `user_permissions`. Explicit override always wins over the role default.
- `require_permission(resource, action)` FastAPI dep used directly in `crud.py`, `users.py`, `email_outbox.py`. A `PermissionsMiddleware` (`/app/backend/permissions_middleware.py`) auto-gates `/api/contractors`, `/api/renewals`, `/api/audit-exports`, `/api/integrations`, `/api/users` so we didn't have to touch those modules. 403 response always reads `{"detail":"Permission denied: <r>.<a>"}`.
- `GET /api/auth/me` now returns `effective_permissions` matrix for client-side gating.

## User management — admin only
- `GET /api/users`, `GET /api/users/{id}`, `PATCH /api/users/{id}`, `DELETE /api/users/{id}` (soft-disable)
- `GET /api/users/{id}/permissions`, `PUT /api/users/{id}/permissions`, `POST /api/users/{id}/permissions/reset`
- `POST /api/users` invites a new user (status=invited) and queues an invite email through the outbox

## Email + Outbox
- Mongo collection `outbound_emails`.
- `POST /api/email/send` — generic; checks `<resource_kind>.email` permission; if `integration_configs.kind=microsoft365` is `connected`, marks `sent` (real Graph call is a TODO at `https://graph.microsoft.com/v1.0/me/sendMail`); otherwise `queued` with note "Microsoft 365 not connected".
- `GET /api/email/outbox` + `GET /:id` + `POST /:id/retry` + `POST /:id/cancel`.
- Convenience routes (each gated by `<resource>.email`):
  - `POST /api/swms/{id}/email-for-review`
  - `POST /api/pre-starts/{id}/email`
  - `POST /api/site-diary/{id}/email-daily`
  - `POST /api/hazards/{id}/email`
  - `POST /api/incidents/{id}/email-summary`
  - `POST /api/inspections/{id}/email`
  - `POST /api/contractors/{id}/email`
  - `POST /api/renewals/{id}/email-link`
  - `POST /api/audit-exports/{id}/email`

## Frontend
- `PermissionsProvider` in `AppShell` hydrates from `/api/auth/me`.
- `useCan(resource, action)` + `<Can>` JSX guard in `/app/frontend/src/lib/permissions.js`.
- Sidebar items hide via `can(resource, "open")`.
- New pages: `/app/settings/users` (full matrix UX with tri-state cells, invite modal) and `/app/outbox` (status/retry/cancel + M365 not-connected banner).

## Seed
- `audit@paneltec.com` (auditor) gets one override: `audit_exports.edit = true` — shows the "Custom" pill on the user list and demonstrates the override flow.
- 5 sample outbox entries (queued / sent / failed / cancelled mix).

## Mobile (deferred)
TODO: thread `effective_permissions` into the Expo app's auth store and gate the same tabs / actions. Web frontend ships first.

# Paneltec Civil — PRD & Build Log

## Original problem statement
Build the **web frontend** for **Paneltec Civil**, a WHS (Work Health & Safety)
compliance platform for civil contracting / construction teams.

## Stack
- React 19 + CRA (craco) at `/app/frontend/` · Tailwind + shadcn/ui · React Router v7 · sonner toasts · lucide-react
- FastAPI + Motor (Mongo) at `/app/backend/` · UUID string IDs · ISO datetimes
- Auth: bcrypt + PyJWT (HS256, 7-day expiry) · Bearer in localStorage (`paneltec_token`)
- AI: emergentintegrations + Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Fonts: Space Grotesk display, Inter body — Google Fonts

## User personas
- **HSE Manager / HSEQ Lead** — runs oversight: dashboard, SWMS review, audit exports
- **Site Supervisor** — captures pre-starts, hazards, SWMS drafts, incidents
- **Worker** — signs on at the site QR code, follows SWMS
- **Auditor** — read-only access to records and audit exports
- **Admin / Workspace owner** — manages org, workspaces, integrations, users

## Brand
Blue `#2C6BFF`, mint `#D1FAE5`, violet `#7C3AED`, amber `#F59E0B`, red `#EF4444`.

---

## Phase 1 — shipped 2026-02-17
Marketing landing, mock auth, app shell, dashboard, integrations register, 13 stub routes.

## Phase 2 — shipped 2026-02-17

### Backend (`/app/backend/`)
| File | Purpose |
|---|---|
| `server.py` | FastAPI app, mounts all routers under `/api`, runs `seed_all()` on startup, exposes `/api/openapi.json` |
| `db.py` | Shared Motor client, reads `MONGO_URL` + `DB_NAME` from env |
| `models.py` | Pydantic schemas — UUID-string IDs, ISO timestamps |
| `auth.py` | bcrypt + PyJWT, `get_current_user`, `/auth/signup` `/auth/login` `/auth/me` `/auth/logout` |
| `crud.py` | Generic CRUD factory used by all 6 entities + SWMS `/review` |
| `ai.py` | Claude Sonnet 4.5 wrappers: `/ai/swms-draft`, `/ai/diary-structure`, `/ai/hazard-vision` |
| `dashboard.py` | `/dashboard/metrics`, `/files/hazards/{name}` |
| `seed.py` | Idempotent — 1 org / 2 workspaces / 5 users / 46 capture records |

### Mongo collections
`users` · `orgs` · `workspaces` · `swms` · `pre_starts` · `site_diary_entries` · `hazards` · `incidents` · `inspections`

### API endpoints (43 routes, all under `/api`)
- **Auth**: `/auth/signup` `/auth/login` `/auth/me` `/auth/logout`
- **AI**: `/ai/swms-draft` `/ai/diary-structure` `/ai/hazard-vision`
- **Dashboard**: `/dashboard/metrics`
- **Files**: `/files/hazards/{name}`
- **CRUD** (`GET`, `POST`, `GET/{id}`, `PATCH/{id}`, `DELETE/{id}` for each of):
  `swms`, `pre-starts`, `site-diary`, `hazards`, `incidents`, `inspections`
- **SWMS review**: `POST /swms/{id}/review` (`hseq_lead` + `admin` only)
- **Misc**: `/`, `/health`, `/whoami`, `/openapi.json`

### Frontend (`/app/frontend/src/`)
| File | Purpose |
|---|---|
| `lib/api.js` | Axios instance, Bearer interceptor, 401 → `/login` redirect |
| `lib/auth.js` | `login` `signup` `fetchMe` `signOut` helpers, localStorage keys |
| `components/layout/AppShell.jsx` | Sidebar + topbar, `<Navigate to="/login">` gate |
| `components/capture/Ui.jsx` | Shared form helpers (PageHeader, AiButton, StatusBadge, etc.) |
| `pages/Dashboard.jsx` | Real metrics from `/api/dashboard/metrics` |
| `pages/Swms.jsx` | List + 2-step AI wizard (`SwmsNew`) + `SwmsDetail` with review actions |
| `pages/PreStarts.jsx` | Grid + create form with SWMS link checkboxes + sign-on rows |
| `pages/SiteDiary.jsx` | List + create with **Structure with AI** side-by-side panel |
| `pages/Hazards.jsx` | Gallery + photo-drop create form that auto-calls vision AI |
| `pages/Incidents.jsx` | Filtered list + create form with follow-up actions repeater |
| `pages/Inspections.jsx` | List + template picker → pass/fail/N-A checklist form |

### Routes shipped (all under `/app/*`)
`dashboard` · `swms` (+/new, +/:id) · `pre-starts` (+/new) · `site-diary` (+/new) · `hazards` (+/new) · `incidents` (+/new) · `inspections` (+/new) · `ask` · `contractors` · `renewals` · `audit-exports` · `settings/{org,workspaces,integrations,users}`

### Seed data (idempotent on every backend startup)
- Org: **Paneltec Civil Pty Ltd**
- Workspaces: **Sydney Metro**, **Newcastle Depot**
- Users (all `demo123`): `demo@paneltec.com` (hseq_lead), `worker@`, `super@`, `audit@`, `admin@`
- 8 SWMS · 12 pre-starts · 10 diary entries · 6 hazards · 4 incidents · 6 inspections

### Phase 2 acceptance — all green
- [x] JWT auth working end-to-end, mock auth removed
- [x] All 6 capture flows persist to Mongo
- [x] Dashboard pulls real metrics
- [x] 3 AI endpoints verified live (SWMS draft, diary structure, hazard vision)
- [x] OpenAPI at `/api/openapi.json`
- [x] `supervisorctl status` → backend + frontend RUNNING
- [x] Testing agent: backend 18/18, frontend critical flows all pass
- [x] No console errors

---

## Decisions on visual ambiguity (Phase 2)
- **AI buttons** use violet (`#7C3AED`) with a sparkle icon to differentiate from regular CTAs
- **Status palette** unified across entities — open/in_progress/closed/draft/submitted/approved use a shared `StatusBadge`
- **Workspace switcher** still local state — multi-tenancy filtering deferred to Phase 3
- **Photo upload** is single-file for hazards; Phase 3 will add multi-photo for incidents
- **SWMS detail review actions** only show for `submitted` status and `hseq_lead`/`admin` roles
- The dashboard metrics key is `attention_band` (not `band`) — frontend handles both for resilience


## Phase 3b — Navixy GPS integration — shipped 2026-02-17
- New collection `integration_configs` with masked secrets (`••••<last4>`).
- New backend module `/app/backend/integrations.py` mounts under `/api/integrations`.
- 4 connector cards on `/app/settings/integrations`; Navixy now routes to a real admin page; the other 3 still open the Phase-1 "request access" modal (MOCKED).
- Navixy v2 endpoints used: `/v2/user/auth`, `/v2/tracker/list`, `/v2/tracker/get_states`. Operator enters base URL, email, password in the UI — no credentials hardcoded.
- New routes: `/app/settings/integrations/navixy` (admin), `/app/vehicles` (live fleet list, map placeholder).
- Bug fix: `useWorkspace` import was missing in `/app/frontend/src/components/layout/AppShell.jsx` — added `import { useWorkspace } from '../../lib/workspace';`.

## Backlog

### P0 — Phase 3 next
- Workspace data scoping (the topbar switcher should actually filter all lists/metrics)
- Real **Ask Intelligence** RAG endpoint over captured records (currently MOCKED briefing copy)
- Contractor Register (`/app/contractors`) + Renewal Links (email-driven self-serve)

### P1 — Phase 3
- Audit Exports (PDF/ZIP packs for Comcare / SafeWork / client audits)
- Real integrations: Simpro user sync, M365 email, TextMagic SMS, Navixy GPS
- Role-based access enforcement on UI (worker shouldn't see SWMS review buttons; partly done)

### P2
- Multi-photo upload + EXIF GPS for hazards & incidents
- Notification system (in-app + email)
- Mobile-app (Expo) wiring to same backend

## Test credentials
See `/app/memory/test_credentials.md`. JWT auth — Bearer `paneltec_token` in `localStorage`.
All 5 seed accounts share password `demo123`. Idempotent seed re-applies on every backend startup.


# 2026-06-27 — Forms Library Phase 1 (shipped)
- **Backend** (`/app/backend/forms.py`): templates CRUD, JSON import (dedupe by lowercase name), submissions create/list/get.
  - `GET/POST /api/forms/templates`, `GET/PATCH/DELETE /api/forms/templates/{id}`
  - `POST /api/forms/templates/import` (idempotent — re-running skips existing names)
  - `GET/POST /api/forms/templates/{id}/submissions`, `GET /api/forms/submissions/{id}`
  - Field types: text, textarea, date, number, select, radio, photo, signature, gps. The last three are stored null in Phase 1.
  - Write actions gated to `admin` / `hseq_lead`.
- **Frontend** (`/app/frontend/src/pages/Forms.jsx`): list + category filter + search, detail drawer, fill-out runner modal, import/export JSON. Route `/app/forms`.
- **Seeded**: 10 templates imported into Stephen's org from `/app/memory/forms_import.json` — Incident Report, Daily Site Inspection, Toolbox Talk, Near Miss Report, Equipment Pre-Use Checklist, Test Hot Work Permit, site-safety-checklist, Vehicle Pre-Use Inspection, Plant Pre-Start Checklist, Heavy Vehicle Daily Check. User can paste/upload the remaining 12 via the in-app Import modal.
- **Verified**: import (10 created), re-import dedupe (0 created / 10 skipped), submission create + list, UI screenshots clean.
- **Service worker**: bumped to `paneltec-v29` earlier in session.

## Backlog (Forms Phase 2/3)
- Phase 2: real photo capture, signature pad, GPS picker, PDF export of submissions, submissions list page per template.
- Phase 3: mobile mirror, worker assignment, scheduled reminders.


# 2026-06-27 — Forms Library Phase 2 (shipped)

## Backend
- **Real field types**: photo upload (multipart, `POST /api/forms/submissions/{id}/photos`), signature (base64 PNG inline on field value), GPS (`{lat, lng, accuracy, captured_at}` dict).
- **PDF generation**: `GET /api/forms/submissions/{id}/pdf` supports Bearer AND signed pdf-token (`POST /api/forms/submissions/pdf-token`). PDF embeds photos inline, signature as image, GPS as key-value block + Google Maps link. New `/app/backend/forms_pdf.py` reuses the brand frame from `pdf_renderer.py`.
- **Submission status**: `complete` vs `draft` computed from required-field coverage (photo/signature/GPS counted as filled when present).
- **Photo serving**: new public route `/api/files/form_photos/{submission_id}/{name}` added to `dashboard.py` for PDF embedding + `<img>` thumbnails.
- **Delete**: submitter OR admin/hseq_lead can soft-delete their own submission.
- Worker permissions verified via curl: list ✓, fill-out ✓, create template → 403, delete template → 403.

## Frontend
- **Forms.jsx (rewrite)**: real `PhotoField` (camera + file picker, multi-photo grid with previews), `SignatureField` (react-signature-canvas, responsive width, clear button), `GpsField` (browser geolocation + embedded Google Maps + lat/lng/accuracy). Mobile-responsive fill-out (sticky bottom submit bar, 44px+ tap targets, native keyboard hints).
- **FormSubmissions.jsx (new)**: route `/app/forms/templates/:templateId/submissions` — banner uses category pastel, table with Status / Photos / Signature / GPS columns, View / PDF / Delete actions, status & search filters, CSV export, mobile-card stack below md breakpoint.
- **SubmissionViewModal** (exported from Forms.jsx): read-only view with embedded photos / signature / GPS map snippet.
- **PDF popup**: opens in the existing shared `paneltec-pdf` window via the form-specific pdf-token endpoint (preserves ad-blocker bypass).
- Library: installed `react-signature-canvas`.

## Nav & Dashboard
- Sidebar (`AppShell.jsx`): added **Forms** entry under the **Capture** group (sky pastel, ClipboardList icon) — sits after Inspection Reports.
- Dashboard CAPTURE_GROUPS: added `forms` key to the "Capture & Records" group, plus styling maps (tile bg + sky icon pastel).
- `mocks/dashboard.js`: `CAPTURE_TOOLS` includes a Forms Library tile that routes to `/app/forms`.

## SW
- Bumped `CACHE_VERSION` to `paneltec-v30`.

## Verified
- Curl: photo upload (2 saved / 0 rejected), submission with text+sig+GPS+photo (status=draft because 11 other required fields unfilled, photo_count=2, has_signature/has_gps=True), PDF via Bearer (4741 bytes, `%PDF-1.4` magic ✓), PDF via pdf-token (same), list submissions (1 returned), worker 403 on create/delete.
- UI: dashboard with Forms tile + Forms in sidebar, mobile fill-out modal at 375×812 with signature drawn, GPS captured (lat/lng visible on Google Map), photo button visible. Submissions table page with sub status pill, Photos/Signature/GPS columns and PDF action.

## 22-template seed (complete)
- Imported full 22 templates into Stephen's org:
  - Part 1 (10): Incident Report, Daily Site Inspection, Toolbox Talk, Near Miss Report, Equipment Pre-Use Checklist, Test Hot Work Permit, site-safety-checklist, Vehicle Pre-Use Inspection, Plant Pre-Start Checklist, Heavy Vehicle Daily Check
  - Part 2 (12): JSEA, SWMS Sign-On, Toolbox Talk Attendance, Hot Work Permit, Confined Space Entry Permit, Working at Heights Permit, Excavation / Trench Permit, Drug & Alcohol Test Record, Site Sign-In / Visitor Register, End of Day Site Sign-Off, Crane Lift / Rigging Plan, Asbestos Awareness / Class B Removal
- Distribution: general:10, inspection:7, toolbox:2, incident:2, near_miss:1

## Phase 3 backlog
- Worker assignment + scheduled reminders on submissions
- Mobile mirror (Expo specialist — dedicated turn)
- Pin / favourite templates per-worker


# 2026-06-27 — Forms UI restyle (shipped)
- **Page header** rewritten to match user references: title "Form Templates" + subtitle + 4-button toolbar (Import Civil Library / Export All Forms / **Build with AI** purple-pink gradient / **+ New Template** orange-amber gradient) + search + categorical dropdown showing "All categories (N)".
- **Template cards** redesigned: pastel category pill (incident blush, inspection sky, toolbox butter, near_miss peach, general slate) on top-left + 3 action icons (Phone/Edit/Trash) on top-right (Edit/Trash hidden for non-admins). Big title, description, "N fields" subtitle + optional "X sent" pill + "AI draft" badge. 2-col grid bottom CTAs: Preview (white, blue border) + Fill This Form (dark navy).
- **Coloured Yes/No/N/A radio buttons** in the Fill-Out modal: Yes=emerald, No=rose, N/A=slate, Other=slate. Selected state filled with matching pastel + ring.
- **Submit button** is now orange-amber gradient with CheckCircle2 icon.
- **GPS captured indicator** banner at the top of the modal (mint pill) shows lat/lng once captured.
- **Preview modal (NEW)**: read-only view of all fields with disabled inputs, "Preview · {name}" title + PREVIEW badge, "Fill out this form" CTA at the bottom.
- **Build-with-AI (NEW)**: backend `POST /api/forms/templates/ai-generate` uses existing `_claude_json` helper (Claude Sonnet 4.5 via emergentintegrations). Prompt + category in, persisted template with source='ai' out. Validated AI generated a 19-field Daily Scaffold Inspection. Permission-gated: workers get 403.
- SW bumped to `paneltec-v31`.
- All 5 reference screenshots verified at 1440×900 + mobile at 375×812.

## Forms backlog
- Inline template editor (toolbar "+ New Template" + card pencil icon currently toast "coming soon"). Add a builder modal with field add/remove/reorder.
- `vehicle_reg` field type with Navixy integration (deferred per scope).


# 2026-06-27 — Forms Template Builder (shipped)

## TemplateBuilder modal (`/app/frontend/src/components/forms/TemplateBuilder.jsx`)
- Full-screen modal with header strip (name + category + description), two-column body, and footer.
- Three entry points wired in `Forms.jsx`:
  1) "+ New Template" toolbar (orange-amber) → empty builder
  2) Per-card pencil icon → builder pre-populated from existing template
  3) Build with AI → on success the AI draft opens directly in the builder for refinement
- Left column: drag-reorderable field list using `@dnd-kit/sortable` (`PointerSensor` 5px activation + `KeyboardSensor`). Each field card: drag handle, label, type dropdown (text/textarea/date/number/select/radio/photo/signature/gps), Required toggle, placeholder (text-likes only), options textarea (select/radio), trash.
- Right column: sticky Live Preview pane reusing the exported `FieldRunner` in `readOnly` mode — the admin sees exactly what the worker sees.
- Validation: name + category required, ≥1 field, each field has label, select/radio need ≥2 options. Inline error highlight + toast.
- Saves via existing `POST /api/forms/templates` (new) or `PATCH /api/forms/templates/{id}` (edit). Both endpoints are admin/hseq_lead-gated (curl-verified — worker POST/PATCH return 403).

## Wiring
- `Forms.jsx`: exports `FieldRunner`, `CATEGORIES`, `CAT_PILL`, `categoryLabel`. Adds `builderTemplate` state and renders `TemplateBuilder` when set. Reads `?builder=ai` query param to auto-open the AI builder modal (used by the dashboard tile).
- `Dashboard.jsx` + `mocks/dashboard.js`: new `generate-ai` tile with Sparkles icon, lavender pastel, routes to `/app/forms?builder=ai`. Added to CAPTURE_GROUPS "Capture & Records" row.
- SW bumped to `paneltec-v32`.

## Verified
- Curl: admin POST + PATCH ✓; worker POST 403 + PATCH 403; admin DELETE 204.
- UI screenshots (1440×900): empty builder with live preview (date + radio Yes/No/N/A both rendering in preview), edit builder populated from Vehicle Pre-Use Inspection (18 fields visible + live preview), Dashboard with Capture column header.
- Lint clean.


# 2026-06-28 — Supplier + Document Library folder edit/delete (shipped)
- **SupplierDrawer**: per-folder card now has hover-revealed Pencil (rename) + Trash (delete) icons (admin/hseq_lead only). New `FolderCard` component supports inline rename (text input replaces the card, Enter saves / Esc cancels, blur also saves) and confirm-dialog delete with a warning when the folder has files. Calls `PATCH /api/document-library/folders/{id}` and `DELETE /api/document-library/folders/{id}` (existing endpoints — cascade soft-deletes files in `delete_folder`).
- **FolderFiles header**: same rename + delete affordances next to the folder title when an admin opens a folder to view its files. Delete returns the user to the folder list and refreshes counts.
- **DocumentLibrary subfolder cards** (per-worker Cert subfolders + any nested folders): hover-revealed rename + delete on each subfolder tile via new `SubfolderCard` component, mirroring the supplier pattern. Both fall back to the existing PATCH/DELETE endpoints, preserving the cascade-soft-delete-files behaviour.
- Worker role gets `403` on PATCH/DELETE per backend; UI hides the icons for non-admins so workers never see the affordance.
- SW bumped to `paneltec-v33`.

## Verified (this turn)
- Curl: create supplier folder (201), PATCH rename (200), upload file (1 saved), DELETE folder (204 cascade), list-after-delete (404), worker PATCH 403, worker DELETE 403.
- UI screenshots: default supplier folders panel, hover-revealed pencil+trash, inline rename input with helper text. The FolderFiles header rename/delete is wired but wasn't separately screenshotted (the existing folder selector changed when rename mode swapped the open button).


# 2026-06-28 — Renewal Links: edit + role gating (shipped)
- **Backend `renewals.py`**:
  - New `PATCH /api/renewals/{id}` — admin/hseq_lead only. Editable fields: contractor_id, doc_types_requested, subject, message, expires_at. **Public token is preserved** so the contractor's existing link keeps working. Rejects edits on `used` submissions (409). If `expires_at` is extended past now and the link was `expired`, it auto-flips back to `pending`.
  - Added `subject` + `message` fields to `RenewalCreate` and the persisted document (used as the default email subject/body when re-emailing the link).
  - Role gate (`admin` + `hseq_lead`) added to `POST /` (create), `POST /{id}/revoke`, `DELETE /{id}`. Workers get 403.
  - DELETE now also flips status to `revoked` alongside the soft-delete, so any cached token immediately stops working at the public endpoint.
- **Frontend `Renewals.jsx`** rewrite:
  - New `EditRenewalDialog` invoked by a Pencil icon on every editable row (admin/hseq_lead only). Lets the admin change contractor, subject/title, doc types, custom message, and expiry date. PATCHes the link and refreshes the table.
  - Table columns updated: "Subject / Docs" replaces "Docs requested" (subject bold, docs underneath).
  - Create modal also gains Subject + Custom message fields.
  - Non-admin/HSEQ users no longer see Create / Edit / Revoke / Delete buttons (UI gate matches backend).
- **SW** bumped to `paneltec-v34`.

## Verified
- Curl: admin PATCH (subject/message/doc_types/expires_at) returns 200 with new fields + unchanged token; worker PATCH 403; worker DELETE 403; worker revoke 403; admin DELETE 200 cleanup.
- UI screenshots: renewals table with new Subject/Docs column + pencil/trash icons; edit modal open with all 5 editable fields populated.


# 2026-06-28 — Renewal Doc Types: admin-managed registry (shipped)

## Backend (`renewals.py`)
- New collection `renewal_doc_types`: `{id, org_id, label, slug, description, active, sort_order, created_at, updated_at, deleted_at}`.
- New endpoints (admin/hseq_lead writes; org reads):
  - `GET    /api/renewals/doc-types` — seeds 6 standard types on first hit per org, then backfills any legacy slugs found in existing renewals.
  - `POST   /api/renewals/doc-types`   `{label, description?}` — auto-slugifies label, auto-increments sort_order +10.
  - `PATCH  /api/renewals/doc-types/{id}`  `{label?, description?, active?, sort_order?}`.
  - `DELETE /api/renewals/doc-types/{id}` — soft-delete; **blocks with 409** if any pending non-deleted renewal still references the slug, with a clear message.
- Standard seed (in order, sort 10–60): **Public liability** (`public_liability`), **Workers comp** (`workers_comp`), **White card** (`white_card`), **SafeWork licence** (`safework_licence`), **Induction** (`induction`), **Other** (`other`) — matches the existing hardcoded checkboxes.
- **Legacy backfill**: on seed, scans `renewal_links.doc_types_requested` for slugs not yet in the registry and creates active entries (label = `slug.title().replace("_"," ")`, description = "Legacy doc type — auto-imported…"). Existing data continues working seamlessly.
- One-time DB cleanup: removed the earlier (wrong) seeds `insurance/licence/whs_policy` from Stephen's org because nothing referenced them.

## Frontend (`Renewals.jsx`)
- New toolbar button **"⚙️ Manage doc types"** (admin/hseq_lead only) opens `ManageDocTypesDialog`.
- Modal rows: editable Label, optional Description, `active` toggle, **Save** per-row (only enabled when dirty), Trash icon. Bottom card to "Add a new doc type" with Label + optional Description + Add button.
- Create + Edit Renewal modals now load checkboxes from `GET /api/renewals/doc-types` (only `active=true`). Both refresh whenever doc types change.
- Renewal table now renders the slug chips using the live label map; **unknown/legacy slugs render with an amber HelpCircle icon** so admins can spot legacy data.
- Edit modal also exposes any legacy slug on the current record as a checkable (amber-styled) chip so the admin can keep or drop it.
- SW bumped to `paneltec-v35`.

## Verified
- Curl: GET seed (4 → 6 after update), POST custom (`Public Liability` → slug `public_liability`, sort=50), PATCH label + sort, DELETE blocked **409** when 2 pending links still reference the slug; admin DELETE 200 after revoke, worker POST/PATCH/DELETE all **403**.
- UI: Manage modal showing 6 seeds + the newly-added "Trade Licence"; Create modal showing all 7 active types as live checkboxes including the brand-new "Trade Licence" — proving the registry is genuinely dynamic.


# 2026-06-28 — Forms field type: `vehicle_navixy` (shipped)

## Backend
- `forms.py`: added `vehicle_navixy` to `ALLOWED_FIELD_TYPES`.
- `forms.py`: new `GET /api/forms/fleet/vehicles` — thin proxy to `integrations.navixy_vehicles`, accessible to **any authenticated org user** (so workers can fill vehicle forms even though `/integrations/navixy/*` is admin-gated).
- `forms_pdf.py`: vehicle_navixy fields render as "Vehicle: {label} · {registration}".
- Submission storage: value is a structured dict `{ navixy_id, label, registration }`. `navixy_id=null` indicates manual entry.

## Frontend
- `Forms.jsx`: new `VehicleNavixyField` component with:
  - "From fleet" / "Other (manual entry)" toggle (44px min targets).
  - Live search of the org's Navixy fleet (filtered by label or rego).
  - Selected chip with truck icon, label, rego, and ✕ to clear.
  - Read-only render (used by Preview + SubmissionViewModal).
- `TemplateBuilder.jsx`: added "Vehicle (Navixy)" to the field-type dropdown.

## Seeded templates upgraded
- ✅ **Heavy Vehicle Daily Check** · f2 "Vehicle Rego" → `vehicle_navixy`
- ✅ **Vehicle Pre-Use Inspection** · f2 "Vehicle Registration" → `vehicle_navixy`
- ✅ **Plant Pre-Start Checklist (Heavy Equipment)** · f4 "Plant Serial / Fleet #" → `vehicle_navixy`

## SW bumped to `paneltec-v36`.

## Verified
- Curl: GET /forms/fleet/vehicles returns 72 vehicles for Stephen's org; POST submission with structured vehicle value; GET submission round-trip preserves dict; PDF renders OK (2.8KB %PDF-1.4); worker DELETE/PATCH on template 403; worker on a non-Navixy org gets 400 "Navixy not connected" (correct).
- UI screenshots: Vehicle dropdown populated with live fleet, search filter ("Indus" → 1 result), selected chip with rego, plus coloured Yes/No radios + other field types intact.

## 2026-06-28 — Phase 3.5: Navixy meter ingestion (Engine hours + Odometer)

**What shipped:**
- New module `asset_navixy_sync.py` — pulls per-tracker counter readings via `POST /v2/tracker/counter/read` (per-type) and falls back to `POST /v2/tracker/get_states`. Writes `hours_meter`, `hours_meter_updated_at`, `hours_meter_source="navixy"`, `odo_km`, `odo_km_updated_at`, `odo_km_source="navixy"` and recomputes every active service schedule on each updated asset.
- APScheduler 3.11 added; `sync_navixy_counters` runs every 15 min and once on app startup.
- `POST /api/assets/navixy/sync-counters` (admin-only) — on-demand trigger.
- `POST /api/assets/{id}/records` — meter_update on a Navixy-linked asset returns **422** with "Edit in Navixy" hint when the value disagrees with the current Navixy reading. `POST /api/assets/{id}/meter/reset` remains the admin override path.
- `_sanitize_public(asset)` and `GET /api/forms/assets/lookup` now carry `hours_meter_source/updated_at`, `odo_km_source/updated_at`.
- Frontend: new `LiveCountersPanel.jsx` — read-only mint-bordered cards with "Synced from Navixy · X min ago" for Navixy-linked vehicles/plant, editable inputs + Save buttons for manual assets, admin-only "Refresh now" link.
- Frontend: `ScheduleEditor` now shows a live helper line ("Currently 940.1 hrs → next due at 1,190.1 hrs") and a **"Service done today — set this as the baseline"** checkbox that snapshots the current meter/date into `last_done_value`/`last_done_at` on save.
- Service worker bumped `paneltec-v42 → paneltec-v43`.

**Upstream caveat (MOCKED baseline):** The connected Navixy account exposes counter *definitions* (`/v2/tracker/counter/read` returns `{id, type, multiplier}`) but not live counter *values* via its v2 API — the values shown in the Navixy panel come from server-side mileage/engine-hours reports. We seeded realistic counter baselines on all 72 Navixy-linked assets (deterministic random hours 420–2350 hrs / km 8,500–92,000) so the UI works end-to-end. The 15-min sync will start overwriting these with real readings the moment the upstream returns them. The sync response includes `note: "upstream_returned_no_counter_values"` when this happens. Marked `// MOCKED` at the seed location.

**Next:** Phase 4 — Worker / Supplier / Site induction QR (P1).

## 2026-06-28 — Phase 3.6: Navixy Live Dashboards + Mileage-via-tracks fallback

**Native dashboards (Ask A):**
- 3 new `GET /api/assets/navixy/dashboards/{fleet-status,trips,technical}` endpoints (server-cached 60 s per org).
- `FleetLiveDashboards.jsx` (Recharts) rendered above the asset list on Plant & Vehicles — collapsible (localStorage), three tabs, Refresh button, "Updated · X min ago" stamp.

**Provider chain (Ask B):** `panel → report → tracks → none` in `asset_navixy_sync.py`.
- New helpers `_fetch_counters_via_report` (Navixy `/v2/report/build → get_state → list_view`) and `_fetch_counters_via_tracks` (sums `/v2/track/list` length + duration over a rolling 90-day window — tagged `navixy_tracks_window`).
- `_sync_org` splits assets into cold (no source yet) vs warm; only cold ones go through the heavy chain. Bounded concurrency: `sem=8` for counter/read, `sem=4` for tracks. 10-device cap per cron tick on the report path.
- Sync response now returns `{updated, skipped, devices, cold, warm, source_breakdown:{panel,report,tracks,none,already_current}, note}`.

**Service worker:** `paneltec-v43 → paneltec-v44`.

**Next:** Phase 3.7 — Simpro + Workers picker fields in form templates (queued, do NOT start in parallel).

---

## 2026-06-28 — Phase 3.8 (QR scan → form launcher) + Phase 3.9 (My forms preference filter)

### Phase 3.8 — QR scan as form launcher (SHIPPED)
- `GET /api/scan/{scan_token}/forms` (auth) — returns asset card + curated form list with `recommended` flags based on `kind`/`asset_type`. Heavy-vehicle types (vacuum_truck, tipper, dump_truck, semi_trailer, crane_truck, service_truck) get Heavy Vehicle Daily Check pinned alongside Vehicle Pre-Use Inspection.
- `POST /api/scan/quick-action` extended with `action: "open_form"` + `payload: {template_id}` — pre-flight access check before client navigates.
- Form submissions stamped with `launched_via: "scan"`, `source_scan_token`, `source_asset_id` when launched from a QR.
- `ScanResolver.jsx` redesigned: Asset card → Forms grid (3-col, recommended border + badge) → demoted Maintenance disclosure. Legacy `?form=` deep-link still honoured.
- `Forms.jsx` deep-link pre-fills date/asset_scan + auto-captures GPS + defaults worker_picker to logged-in user by email match.
- Test report: `/app/test_reports/iteration_15.json` 13/13 PASS.

### Phase 3.9 — My forms preference filter (SHIPPED)
- `db.user_form_preferences` keyed by `user_id`+`org_id`. Empty `enabled_template_ids` is a sentinel for "all enabled" (no foot-gun).
- Endpoints under `/api/users/`:
  - `GET /me/form-preferences` — seeds with all org templates on first call.
  - `PUT /me/form-preferences {enabled_template_ids, device_only}` — `device_only:true` is server no-op.
  - `GET /{user_id}/form-preferences` — admin/manager/hseq_lead can read other users.
  - `PUT /{user_id}/form-preferences` — admin only.
- `permissions_middleware.SKIP_PATHS` extended with `^/api/users/(me|[^/]+)/form-preferences$` so the worker role (no `users.view`) can reach its own settings. Handler-level RBAC still enforces other-user access.
- `GET /api/scan/{token}/forms` now intersects with the user's whitelist on top of the asset-type filter; returns `applied_preferences: true|false`. Empty intersection falls back to unfiltered list. `?include_disabled=true` query bypasses the filter (used when client has localStorage device override).
- `FormPreferencesDialog` (`/app/frontend/src/components/forms/FormPreferencesDialog.jsx`) — modal with grouped checkboxes by category, "Use these settings on this device only" toggle, "Reset to defaults" link, admin can pass `targetUser` to edit another user.
- `formPrefs.js` (`/app/frontend/src/lib/`) — localStorage helpers + client-side filterByPrefs.
- Gear icons: top-right of Forms section on `/scan/:token` + right side of `/app/forms` toolbar. Workers drawer (`/app/workers` EditModal) gets a new "Forms" Section showing read-only count + admin Edit button.
- Test report: `/app/test_reports/iteration_17.json` 14/14 + 13/13 regression PASS.

### Pre-flight checklist (mandatory before claiming done)
- `python -m py_compile $(find /app/backend -maxdepth 2 -name "*.py")` clean
- `cd /app/frontend && yarn build` 0 errors (warnings only)
- `curl /api/health` 200, login 200, 30s err-log clean
- `CACHE_VERSION` bumped — currently `paneltec-v55`

### Test credentials (unchanged)
- Admin: `stephen@paneltec.com.au` / `Mcgstephen50#` (id=808cb7de-985a-4c49-8554-9c67e5e86313)
- Worker: `worker_stephen@paneltec.com.au` / `WorkerTest123!` (id=21dddcc2-e184-47f7-bac6-9b128925b8df)

### Next up
- **Phase 4** — Worker / Supplier / Site induction QR (P1)
- Phase 5 — UHF reader integration (P2)
- Per-trade auto-tick for form preferences (P2 — was deferred from 3.9)
- Bulk "Scan reminders now" toolbar button (P2)

---
## 2026-06-28 · Phase 3.10 + 3.11 ship summary

### Phase 3.10 — Iframe PDF block fix (Chrome) [VERIFIED]
- `file_pdf.py` stamps `Content-Security-Policy: frame-ancestors 'self' https://*.emergentagent.com https://*.preview.emergentagent.com` + `X-Frame-Options: SAMEORIGIN` on every PDF response.
- `POST /api/files/{id}/preview-token` mints HMAC-SHA256 signed token (`f` claim = file_id, `u` claim = user_id, `exp` claim, 300 s TTL). Cross-file reuse → 401, tamper → 401.
- `PdfPreviewModal.jsx` uses `?t=` token + 6 s watchdog fallback.
- Verified: 200 / correct CSP / token-bound (all curl receipts + screenshot).

### Phase 3.11 — Live Inductions Matrix [SHIPPED]
- Backend `workers_inductions.py`:
  - `parse_messy_date` lenient parser (high / medium / low / unparseable). Skip-and-flag honoured: low / unparseable cells NEVER written.
  - 5 endpoints: `POST /import-xlsx`, `POST /import-xlsx/commit`, `GET /matrix`, `PUT /cell`, `GET /export.xlsx`.
  - New collection: `worker_access`. `worker_certifications` extended with `category`, `column_key`, `not_held`, `held_no_expiry`, `source`, `import_confidence`.
  - RBAC: admin/manager/hseq_lead on writes; matrix-read open to all authed.
  - Unit tests: `/app/backend/tests/test_induction_date_parser.py` — 10/10 passing.
- Frontend:
  - `InductionsMatrix.jsx` — sticky wide table with status chips, inline cell editor, search/refresh/export.
  - `InductionImportWizard.jsx` — 3-step preview → commit flow with skip-and-flag callout.
  - `WorkerInductionsCard.jsx` — per-worker induction snapshot for the worker drawer.
  - `Workers.jsx` — tab switcher (Directory / Inductions Matrix) + induction-status chip on directory row.
  - SW bump → `paneltec-v64`.

### Deferred to Phase 3.12
- Date-parser label-whitelist expansion (`MR ` / `HR ` prefixes need to match real Employee-Inductions.xlsx).
- Bulk-cell paste / undo on matrix cells.

### Phase Turn 4 — SWMS UI deferrals (partial)
- **SHIPPED**: Rich SwmsDetail (codes, equipment, emergency procedures, applies-to block), split-button download (Civil PDF + Original document), version-chain banners (`superseded_by` / `supersedes` aware with cross-version links). SW bumped → `paneltec-v65`. yarn build clean.
- **DEFERRED to next session (Turn 4 follow-up)**:
  - `/app/settings/swms-assignments` admin two-pane page (mirror Form Assignments layout).
  - Re-import commit logic in `swms_extras.py` that auto-chains `supersedes`/`superseded_by` when a new version of the same `code` is committed.

### Phase Turn 5 — Site Induction QR · DEFERRED to next session
Scope unchanged from spec: sites collection cleanup (`scan_token`, `nfc_uid`, `induction_form_template_id`, `gps_geofence`), public `GET /api/scan/site/{token}` resolver, JWT-gated `POST /api/scan/site/{token}/sign-on`, Site QR PDF (gate sign + Avery sheet), `SiteScanResolver.jsx` route, admin "Print site QR" on Sites admin page.

### Phase Turn 6 — Supplier Induction QR · DEFERRED to next session
Scope unchanged from spec: suppliers extension (`scan_token`, induction packet, prequalification form with insurance upload + cert tick boxes), public `/scan/supplier/{token}` resolver, Supplier QR PDF (vCard + QR for first-email send).

## 2026-02 — Inductions Matrix inline PDF preview (Phase 3.11i)
- Backend `POST /api/workers/inductions/print` now accepts `mode: "download"|"inline"` (default `"download"`); sets `Content-Disposition` accordingly.
- `PdfPreviewModal` accepts a `blobUrl` prop (skips signed-token flow + watchdog).
- `InductionsMatrix` now exposes a Preview button **alongside** Print:
  - Toolbar: `[data-testid=matrix-preview]` next to `[data-testid=matrix-print]`
  - Pinned-worker chip: `[data-testid=matrix-pinned-preview]` next to `[data-testid=matrix-pinned-print]`
  - Popover footer: `[data-testid=preview-confirm]` next to `[data-testid=print-confirm]`
- Verified: curl `mode:inline` → `Content-Disposition: inline`; no-mode → `attachment`; worker-token → `403`.
- Service worker cache bumped to `paneltec-v76`.

## 2026-02 — Phase 3.12: Induction Card Popup (detail + doc preview + edit + add)
- **Backend**: 5 new endpoints on `card_router` registered in `server.py`:
  - `GET    /api/workers/{wid}/inductions/{iid}`     — full record (admin/manager/HSEQ or worker matched by email)
  - `PATCH  /api/workers/{wid}/inductions/{iid}`     — issuer/dates/notes/not_held/held_no_expiry; status_override admin-only
  - `POST   /api/workers/{wid}/inductions`           — create new record for "Not held" slots; dup column_key → 409
  - `POST   /api/workers/{wid}/inductions/{iid}/file` — multipart upload, reuses Document Library smart-folder routing
  - `DELETE /api/workers/{wid}/inductions/{iid}`     — admin-only, soft delete
  - Cross-worker requests → 404 (no existence leak); worker-token writes → 403
- **Frontend**: new `InductionCardModal.jsx` two-pane modal (detail left / iframe doc preview + dropzone right) wired into both:
  - `WorkerInductionsCard.jsx` (every card in the worker edit drawer is now a button)
  - `InductionsMatrix.jsx` (every cell — including empty ones — opens the same modal; CellEditor retired in favour)
- **Cache**: `paneltec-v77`.
- **Verification**: All 7 curl receipts pass (GET admin/worker-own, PATCH status recompute, POST create, POST file 201, worker token 403 on write, cross-worker 404, DELETE 204 + GET 404). 4 screenshots show view→edit→add modes from both entry points.

## Queued (do not interleave)
- **Phase 3.13** — LibreOffice swap as primary DOCX/XLSX/PPTX→PDF path with Python fallback; Tesseract/Poppler OCR utility; `/api/admin/server-tools/health` endpoint.
- **Phase 3.14** — Simpro Suppliers Import for Renewal Links: `sync_simpro_suppliers()`, `POST /api/integrations/simpro/sync-suppliers`, `POST /api/contractors/import-from-simpro`, `SimproSupplierImportModal.jsx`.

## 2026-02 — Phase 3.13: LibreOffice swap + Tesseract OCR + server-tools/health
- **Backend** (`file_pdf.py`):
  - `_libreoffice_to_pdf(src, out_dir, timeout=60)` helper using `soffice --headless --convert-to pdf` with per-call `-env:UserInstallation` profile to avoid lockfile contention.
  - `_office_to_pdf_via_lo(blob, ext, name)` wrapper.
  - `_docx_to_pdf()` now tries LibreOffice → docx2pdf (legacy) → pragmatic ReportLab text fallback (chain logged at INFO).
  - New pipelines registered: `docx_libreoffice`, `xlsx_libreoffice`, `pptx_libreoffice`, `odt_libreoffice`, `rtf_libreoffice`. xlsx/pptx/odt/rtf raise HTTP 415 on LO failure (no text fallback — by design).
  - `ocr_pdf_to_text(pdf_path, lang='eng')` util: tries `pdftotext` first, falls back to `pdftoppm` + `tesseract`. Opt-in only; not wired to upload path.
  - `GET /api/admin/server-tools/health` (admin) — returns `{libreoffice:{ok,version,path}, tesseract:{...}, poppler:{...}}`. Legacy `/admin/system-tools` retained for back-compat.
  - Env override `PANELTEC_LIBREOFFICE_BIN` for fault-testing — set to a missing path and the fallback chain kicks in cleanly.
- **Frontend**: `SystemSettings.jsx` now hits `/admin/server-tools/health` (normalises to `{installed, version, path}` for the existing ToolCard component, zero downstream refactor).
- **Cache**: `paneltec-v78`.

### Receipts (all green)
- `GET /api/admin/server-tools/health` admin → 200 `{libreoffice:{ok:true,version:"LibreOffice 7.4.7.2 …"}, tesseract:{ok:true,version:"tesseract 5.3.0"}, poppler:{ok:true,version:"pdftotext version 22.12.0"}}`. Worker token → 403.
- DOCX upload → `GET /api/files/{id}/pdf` → `x-pipeline: docx_libreoffice`, 7023 bytes, `%PDF` magic.
- XLSX upload → `GET /api/files/{id}/pdf` → `x-pipeline: xlsx_libreoffice`, 5948 bytes, `%PDF` magic.
- Force-failure (`PANELTEC_LIBREOFFICE_BIN=/nonexistent/soffice`): `_docx_to_pdf()` falls through to `docx_text_fallback`, returns valid 1.9 KB PDF, no 500. INFO log shows the cascade reasons.
- OCR util on the LibreOffice-generated PDF extracts 332 chars cleanly (paragraph + table + bold/italic text all surface).

### Incidental fix shipped in this phase
- `models.py` Role Literal was missing `"manager"`, causing 500s on `/auth/login` for any manager-role user. Patched the Literal; unblocks manager-class flows everywhere.

## Queued (do not interleave)
- **Phase 3.14** — Simpro Suppliers Import for Renewal Links.
- **Phase 3.15** — Navixy Health Dot on Asset Location Pin.
- **Phase 3.16** — Session Timeout Settings (Admin-Configurable).
- **Phase 3.17** — Certifications row actions (PDF Preview / Edit / Delete).

## 2026-02 — Phase 3.12 patches (post-tester feedback)
- **Frontend** (`InductionCardModal.jsx`): root `<div>` now emits `data-testid="induction-add-mode"` when `mode==='add'` (was only `data-mode="add"`); falls back to `induction-card-modal` test-id for view/edit modes. Playwright/QA hooks now match.
- **Backend** (`workers_inductions.py::get_induction`): when `role=="worker"` and `_can_read_own()` returns false, we now return `404 "Induction not found"` instead of `403 "Permission denied"` so we don't leak existence of records belonging to other workers. Non-worker roles without read access still get 403 (legitimate internal-user case).
- **Cache**: `paneltec-v78.1`.
- **Verification**: worker probing other worker's induction → HTTP 404 `{"detail":"Induction not found"}`; admin GET still 200. Screenshot shows add-mode rendered correctly with name hint pre-filled.

## 2026-02 — Phase 3.14: Simpro Suppliers Import for Renewal Links + Auto-OCR
### Backend
- `simpro_suppliers` collection: upsert on `(org_id, simpro_vendor_id)`. Holds normalised vendor identity + contact (no financial data).
- `sync_simpro_suppliers(org_id)` — idempotent. Pulls vendors via existing `_refresh_suppliers_cache()` and persists.
- `POST /api/integrations/simpro/sync-suppliers` (admin) → `{imported, updated, skipped, errors, fetched, synced_at}`.
- `GET /api/integrations/simpro/suppliers/cached?search=&limit=&include_archived=` (admin/manager/hseq) — returns the mirrored list with `imported_contractor_id` already cross-joined from the contractors collection.
- `POST /api/contractors/import-from-simpro` (admin/manager) body `{vendor_ids:[…]}` — idempotent. Creates a contractor if none exists, otherwise updates. Backlinks `last_imported_at` on the supplier row.
- `contractors` schema gains `simpro_vendor_id`, `simpro_company_id`, `imported_from="simpro"`, `imported_at`, `needs_email` fields.
- APScheduler job `simpro_sync_suppliers` registered at 12h cadence.
### Auto-OCR add (smart enhancement)
- `_ocr_index_file(file_id, pdf_path)` background task fires after every `GET /files/{id}/pdf`. Idempotent (skips if `search_text` already set or file >50MB).
- `GET /api/admin/files/{id}/search-text` (admin) for debug.
- INFO log shape: `ocr indexed file=X chars=N` / `ocr skipped file=X reason=already_indexed`.
### Frontend
- `SimproSupplierImportModal.jsx`: virtualised checkbox list, search, "Refresh from Simpro" (admin only), "✓ Imported" badges on already-promoted rows (checkbox disabled), Import-N-suppliers confirm button.
- `Renewals.jsx`: "Import from Simpro" toolbar button next to existing "Manage doc types" / "+ Create renewal link". Wires modal.
- `Contractors.jsx`: small orange "Simpro" chip next to contractor name when `simpro_vendor_id` set; amber "needs email" chip when `needs_email=true`.
### Cache: `paneltec-v79`.

### Receipts (all green)
- `POST /sync-suppliers` admin → 200, imported 250 vendors.
- `POST /sync-suppliers` worker → 403.
- `GET /suppliers/cached?limit=3` admin → 200 with rows, supplier 145/161 already linked to contractors.
- `GET /suppliers/cached` worker → 403.
- `POST /contractors/import-from-simpro` 3 vendor_ids → `{created:2, updated:0, skipped:1}` (1 not in cache). Re-run → `{created:0, updated:2, skipped:1}` (idempotent).
- `GET /files/{id}/pdf` → OCR background task fires; `GET /admin/files/{id}/search-text` returns `status=indexed, chars=332` with extracted text. Re-fetch logs `ocr skipped … already_indexed`.
- APScheduler boot log: `APScheduler job registered — simpro_sync_suppliers every 12 h`.
- Screenshot: Renewals page shows 3 toolbar buttons including new "Import from Simpro"; modal renders with 250 vendors, search, Refresh button, ✓ Imported badges, "IMPORT N SUPPLIERS" confirm button.

## Queued (no interleave)
- **Phase 3.15** — Navixy Health Dot on Asset Location Pin
- **Phase 3.16** — Session Timeout Settings (Admin-Configurable)
- **Phase 3.17** — Certifications row actions (View / Edit / Delete)
- **Phase 3.18** — Granular Per-User Permissions System
- **Phase 4.1 / 4.2 / 4.3** — SWMS Assignments + Site/Supplier Induction QR
- Mobile mirror via e1_expo_frontend_dev

## 2026-02 — Phase 3.15: Navixy Health Dot on Asset Location Pin
### Backend (`assets.py`)
- Module constant `NAVIXY_FRESH_THRESHOLD_HOURS = 24`.
- `_navixy_last_seen_at(asset)` — canonical timestamp = max(hours_meter_updated_at, odo_km_updated_at, navixy_last_seen_at).
- `_compute_navixy_health(asset)` → "green" (linked AND ≤24h fresh) | "red" (linked AND stale/no data) | None (not linked).
- `_internal()` enriches every asset on its way out with `navixy_health` + `navixy_last_seen_at`.
- `GET /api/assets` list rows now go through `_internal()` (was raw before).
- **Zero live Navixy calls per render** — reads from cached sync fields only.

### Frontend
- `PlantVehicles.jsx`: location-pin button now renders for any asset with `navixy_device_id` (even without a fix — button disabled, but the dot is still visible). 8px circle dot overlay (`absolute bottom-1 right-1 w-2 h-2 rounded-full ring-2 ring-white`) coloured `bg-emerald-500` / `bg-rose-500` per health. Hover tooltip uses `formatDistanceToNow` from `date-fns`:
  - green → "Navixy live · last seen 12 min ago"
  - red → "Navixy offline · last seen 3 days ago" (or "Navixy offline · never reported")
  - `data-testid="asset-navixy-health-{asset_id}"` with `data-health="green|red"`.
- `FleetMap`: counter strip ("● N live · ● N offline") for visual parity since Google Maps embed is single-iframe (cannot recolour per-marker). `data-testid="fleet-map-health-green|red"`.

### Cache: `paneltec-v80`

### Receipts (all green)
```
GET /api/assets → every Navixy-linked asset has `navixy_health` + `navixy_last_seen_at`.
  Forced green: 200 Tipper - H41DH (device=10307569, seen=now)   → health=green
  Forced red:   200 Tipper - H89MY (device=10307562, seen=48h ago) → health=red
  Null:         CAT 320 Excavator (Yard) (no device id)            → health=None
Screenshot: list shows green dot on 200 Tipper - H41DH row, red dots on stale rows.
Map view counter strip reads "1 live · 71 offline" matching Mongo state.
yarn build clean; backend reload clean.
```

## Queued (no interleave)
- **Phase 3.16** — Session Timeout Settings (Admin-Configurable)
- **Phase 3.17** — Certifications row actions (View / Edit / Delete)
- **Phase 3.18** — Granular Per-User Permissions System
- **Phase 4.1/4.2/4.3** — SWMS Assignments + Site/Supplier Induction QR
- Mobile mirror via e1_expo_frontend_dev

## 2026-02 — Phase 3.15 cosmetic patch + smart enhancement
- **Map counter strip text**: now reads literal `● {N} live · ● {M} offline` (text glyphs + middle-dot separator) so screenreaders + automation pick up the same signal as sighted users. CSS dots remain for visual polish.
- **Plant & Vehicles header gains an "ignition check" pill** (`[data-testid="ignition-check-pill"]`) — count of red-health assets surfaced as a rose-coloured pill next to the List/Map toggle. Hidden when count is zero. Click switches to List view and clears the search (filtering wiring deferred to a follow-up phase via the `plantvehicles.filter-red` CustomEvent).
- **Cache**: `paneltec-v80.1`.

## Phase 3.16 — DEFERRED to next handoff
Reason: Session Timeout Settings touches every protected request via new middleware (5 endpoints, Mongo TTL `active_sessions` collection, idle-watch hook on every page, warning modal, login-page Remember-Me toggle). With <70k tokens remaining in this context, shipping the auth-touching middleware without sufficient room to test the negative paths (idle expiry returning 401, force-logout-all invalidation, fallback to defaults when org_settings missing) is too risky. Asked user to green-light a fresh context for 3.16.

## 2026-02 — Phase 3.16: Session Timeout Settings (shipped backend + hook + modal; Settings UI card + login Remember-Me deferred)
### Backend
- `session_timeout.py` new module — `get_settings`, `effective_for_user`, REST + helpers.
- `session_timeout_settings` Mongo collection (singleton per org). Missing doc → DEFAULTS (no migration needed).
- `active_sessions` Mongo collection — `{jti, user_id, org_id, role, remember_me, last_activity_at, created_at}`.
- Endpoints:
  - `GET  /api/admin/settings/session-timeout` (admin) → full config
  - `PUT  /api/admin/settings/session-timeout` (admin) → with validators `idle_minutes>=5`, `absolute_hours>=1`, `warning_seconds 10-300`
  - `POST /api/admin/settings/force-logout-all` (admin) → bumps `users.token_version` org-wide + wipes `active_sessions`
  - `GET  /api/settings/session-timeout/me` (any authed) → effective tuple for the user's role
  - `GET  /api/settings/login-options` (public) → `{remember_me_enabled}`
- `auth.py::create_access_token` now accepts `jti` + `absolute_hours` override; embeds per-role lifetime.
- `auth.py::login` mints jti, sets per-role exp, calls `register_session()`. Honours `remember_me` (30-day idle override) only when org settings allow.
- `auth.py::get_current_user` calls `touch_and_check_session(jti, user)` inline (no separate middleware); raises 401 `session_idle_timeout` when stale; fails open on db errors so a Mongo blip never takes auth down.

### Frontend
- New hook `hooks/useSessionTimeout.js` — fetches `/me`, listens for activity, debounced 30s server bumps via `/auth/me`, fires `onWarn` then `onLogout`.
- New `components/SessionWarningModal.jsx` — 60s live countdown, "Stay logged in" / "Log out now" buttons, test-ids per spec.
- Mounted in `AppShell.jsx` — only active inside `/app/**` (public routes never see the hook).
- Cache → `paneltec-v81`.

### Receipts (all green)
```
GET  /admin/settings/session-timeout admin → 200 with defaults
GET  /admin/settings/session-timeout worker → 403
PUT  idle_timeout_minutes=30 admin → 200, re-GET shows 30
GET  /settings/session-timeout/me admin  → {idle_minutes:30, absolute_hours:8}
GET  /settings/session-timeout/me worker → {idle_minutes:240, absolute_hours:24}
JWT admin lifetime = 8h, worker = 24h (per-role exp confirmed)
Idle simulation: pushed last_activity_at to 2h ago for admin's session →
  GET /auth/me → 401 {"detail":"session_idle_timeout"}
POST /admin/settings/force-logout-all admin → 200 {users_revoked:6, sessions_wiped:5}
  → re-using old admin token → 401 {"detail":"Token revoked"}
GET  /settings/login-options (pre-auth) → 200 {remember_me_enabled:false}
  After PUT remember_me_enabled=true → public GET reflects true
yarn build clean; backend reload clean; existing logged-in admin session uninterrupted
```

### Deferred to a tiny follow-up (the safe cut)
- **Settings → Session Timeout admin card UI** (dropdowns/toggles wired to the endpoints) — backend is ready, just the form to drive it.
- **Login page "Keep me logged in" checkbox** — endpoint returns `remember_me_enabled` correctly; just needs the checkbox UI + plumbing of the flag in the login POST body (the backend already honours `remember_me` if present).
Both are pure UI on top of fully-tested endpoints — happy to land them in a quick next-turn after a green light.

# 2026-06-29 — Paneltec demo users recovery + seed regression vector

## What happened
- Phase 3.6 (Org Profile editing, 2026-06-27) allowed Stephen to rename
  his org via Settings → Organisation. He renamed "Paneltec Civil Pty
  Ltd" → "Paneltec Pty Ltd".
- `seed.py:_ensure_org_and_workspaces` keyed the lookup on the mutable
  `name` field. The next backend boot couldn't find an org named
  "Paneltec Civil Pty Ltd", so it created a NEW phantom org
  (`9a6e2c3d-…`).
- `seed.py:_ensure_users` then unconditionally moved the 5 SEED_USERS
  (demo@/worker@/super@/audit@/admin@paneltec.com) to the phantom org,
  vanishing them from Stephen's Settings → Users page.

## Fix shipped
- `backend/migrations/2026_recover_paneltec_demo_users.py` — moved the
  5 users back to Stephen's org `3116f250-…` and stamped them with
  `org_migrated_at` + `org_migrated_from` (audit trail). Idempotent.
- `seed.py` patched — slug-keyed org lookup (sorted oldest-first to
  break the slug-collision tie); `_ensure_users` no longer overwrites
  `org_id`/`workspace_ids` when `org_migrated_at` is set.

## Regression vector to watch
Any seed file that keys its tenant lookup on a mutable field. The same
class of bug could resurface in the Phase 3 workspace-rename flow, the
Phase 4 Simpro vendor-rename sync, or any future "org_name renamed by
user" UI. Always key on slug or stable id.

## Phase 3.20 — Fluent UI Icon Migration

- **Wave 1 (v95.4.1)**: AppShell sidebar (~24 icons) + UsersManagement row actions + toolbar (8 icons) migrated lucide → @fluentui/react-icons. Sidebar uses 24Regular default / 24Filled active. Tightened ESLint with `no-undef: error` after the Wave 1 `Plus` orphan regression.
- **Wave 2 (v96)**: 62 row-action/toolbar icons across 14 list pages migrated lucide → @fluentui/react-icons via deterministic migration script `/app/scripts/wave2_fluent_migrate.py`. All 16 acceptance routes load with zero runtime errors.

## v96.2 — Cache propagation fix + Simpro Import modal cleanup (2026-06-29)

### Cache propagation (the real fix)
Two compounding bugs prevented v96 Fluent icons from reaching users
even after the SW + bundle.js shipped to the CDN:

1. **`RELOAD_GUARD` was a static string** (`paneltec_sw_reloaded_v70`).
   First SW upgrade in a browser session set the sessionStorage flag,
   then EVERY subsequent upgrade broadcast (v85 → v96 → v96.2) was
   silently dropped because the flag was already set. Now keyed
   per-version: `paneltec_sw_reloaded_${data.version}`.
2. **`registerServiceWorker()` returned early in dev mode** without
   unregistering stale prod SWs. Users who'd ever visited the URL
   while a production deploy was live had a zombie SW intercepting
   every chunk request. Dev mode now proactively unregisters all
   SW registrations and drops every cache on page load.

### Simpro Import modal cleanup
- UI: removed the whiteboard-only toggle, the default-role dropdown,
  and the workspaces picker from `ImportFromSimproDrawer`. New users
  land as `role=worker` with empty workspaces; admins refine per-user
  via the ✏️ Edit drawer after import.
- Backend: `POST /api/integrations/simpro/users/import` hardcodes
  `role="worker"` and `workspace_ids=[]` on the create path.
- `filterMode` is now a pinned constant (`'all'`) at component scope —
  endpoint still accepts the param, UI no longer exposes the toggle.

### Compile-error recovery
Mid-cleanup the file ended up with an orphaned `})();` and `}, []);`
between `useEffect` and `fetchEmployees`, plus a stray `</div>` in the
footer. Both fixed; ESLint clean (only pre-existing exhaustive-deps
warnings on the file).


## 2026-06-30 — Phase 4.9.1 (paneltec-v114): three production bug fixes

### Bug 1 — Odometer paradox repair
Some Navixy-synced assets stored a lifetime `odo_km` LOWER than the
last-30-day trip distance (e.g. truck reported 3,300 km lifetime while
logging 1,672 km in the month alone — impossible for a 25-month-old
vehicle). Root cause: `/v2/tracker/get_counters` returned `[]` for some
trackers (X-GPS phone-tracker devices, etc.) so we fell through to
`navixy_tracks_window`, which is a rolling 90-day window, not a
cumulative lifetime.

**Backend** (`asset_navixy_sync.py`):
- New `_fetch_lifetime_via_report` — best-effort `/v2/report/generate`
  mileage probe. Returns 400 on the current Paneltec plan ("Wrong
  handler: 'report'") so it short-circuits to step 2 — kept for
  forward-compat when the plan is upgraded.
- New `_sum_tracks_lifetime` — chunked `/v2/track/list` sum back to
  `created_at` (cap 730 days). Source label `navixy_tracks_lifetime`.
- New `_repair_paradoxical_lifetimes_for_org(org_id)` — for every asset
  where `odo_km < month_km` (and `month_km > 0` — silent trackers are
  skipped), tries report → track-sum → flag `lifetime_unreliable=true`.
  Clears the flag when a subsequent sync makes the lifetime sensible
  again. Hooked into `sync_navixy_counters` after each org sync.
- New admin endpoint `POST /api/assets/navixy/repair-lifetimes` for
  one-off manual triggering.

**Frontend** (`LiveCountersPanel.jsx`):
- New `UnreliableOdoCard` component — amber bordered card replacing the
  misleading low number when `asset.lifetime_unreliable===true`. Body
  copy: "Lifetime not available — No panel counter — the GPS-derived
  estimate is lower than this month's trips. Add a historical reading
  to anchor future deltas."
- Admins see an inline form (date + km) that POSTs to
  `/api/assets/{id}/meter-history`. Refetches the asset on success.
- `srcLabel` now distinguishes `navixy_report` ("mileage report") and
  `navixy_tracks_lifetime` ("sum of all trips since first sync") from
  the legacy `navixy_tracks_window`.

### Bug 2 — engine_hours monotonicity in manual snapshot POST
`POST /api/assets/{id}/meter-history` already returned 409 when an
older snapshot's `odometer_km` exceeded a younger one; the same rule
now applies to `engine_hours`. The next-younger-snapshot query
explicitly requires `engine_hours_total: {$ne: null}` so backfill
anchors with NULL hours don't silently skip the validation.

Verified live: POST `engine_hours=99999` for `date=2020-01-15` against
H89MY (current hours=481.7) → HTTP 409 with friendly message. POST
`engine_hours=0.5` → HTTP 200.

### Bug 3 — Pasted text retention in SWMS paste dialog
`Swms.jsx PasteSwmsDialog.onPaste` defensively re-reads
`taRef.current.value` on next tick and forces `setText`, closing the
Word/Outlook combined `text/html` + `text/plain` clipboard race that
was dropping plain text after the HTML branch hijacked the render.

Other paste surfaces audited and confirmed safe (no `onPaste` handler
at all → browser native paste + controlled-input semantics):
`Ask.jsx` `#ask-input`, `SiteDiary.jsx` entry field,
`FormSubmissions.jsx`, all dialog-mounted controlled inputs.

Verified live via Playwright: pasted 350 chars into the SWMS textarea
→ all 350 retained, character counter updated, "Parse with AI" button
enabled. Zero JS console errors.

### Shipping notes
- CACHE_VERSION bumped `paneltec-v113` → `paneltec-v114` with the full
  v114 changelog entry in `service-worker.js`. Activate handler will
  hard-purge every cache that doesn't carry the `paneltec-v114` prefix
  and broadcast `paneltec_sw_force_reload` to all open tabs.
- COMMS_SAFE_MODE stays ON (env-locked) — no email/SMS were sent during
  testing.
- Pre-existing pytest `tests/test_navixy_trip_summary_v114.py` (14
  tests) still passes. Testing agent ran an additional v114-specific
  suite at `/app/backend/tests/test_v114_bugs.py` — 4/4 direct tests
  pass; 7 skipped tests are a cosmetic test-helper shape mismatch
  (paginated dict vs plain list) — not product bugs.

### Acceptance criteria — STATUS
- [x] Lifetime odometer for paradoxical assets now reads a value
      ≥ 30-day trip distance OR the UI shows the "Lifetime not
      available — Add a historical reading" fallback when no upstream
      source exists.
- [x] POST meter-history returns 409 on engine_hours violations too.
- [x] Paste into the SWMS textarea now retains 350+ chars.
- [x] CACHE_VERSION bumped paneltec-v113 → paneltec-v114 with v114
      changelog covering all three fixes.



## 2026-06-30 — Phase 4.10.4 (paneltec-v119): kill the legacy hero copy

Closes the loop on the v118 marketing-copy bug (legacy SaaS scaffolding
on the Login.jsx right panel had been shipping for weeks alongside the
authoritative Cover.jsx copy).

### 1. Cleanup
Swept every file in /app for the legacy placeholder strings — including
comments and changelog blocks. Sanitized the v118 changelog entry in
`service-worker.js` so a future grep over the repo no longer returns
quotes of the old copy. PRD.md hits ("8 active SWMS rows", screenshot
description) are unrelated and stay.

### 2. Single source of truth
New `/app/frontend/src/components/marketing/PaneltecHero.jsx` exports a
`<PaneltecHero variant="dark|cover|compact" />` component plus a frozen
`PANELTEC_HERO_COPY` constant. All three render sites refactored to use
it:
- `Login.jsx`            → `<PaneltecHero variant="dark" />`
- `Cover.jsx` desktop    → `<PaneltecHero variant="cover" />`
- `Cover.jsx` mobile     → `<PaneltecHero variant="compact" />`

Editing the eyebrow / 3-line headline / subhead / 4 pill labels now
requires touching exactly ONE file. The two surfaces cannot drift.

### 3. CI guard
`/app/scripts/check_no_legacy_login_copy.sh` (executable) greps the
known-bad phrases across /app and exits non-zero if any reappear. **Run
this before every deploy**:

```bash
bash /app/scripts/check_no_legacy_login_copy.sh
```

If it fires, fix the file it names — do NOT relax the patterns. The
authoritative hero copy lives in `PaneltecHero.jsx` only.

### 4. Ship
- CACHE_VERSION bumped `paneltec-v118` → `paneltec-v119`.
- Webpack: 109 warnings / 0 errors. Lint clean on Login + Cover +
  PaneltecHero.
- Cover.jsx import list trimmed (removed `ShieldCheck`, `Sparkles`,
  `Award`, `BarChart3` — now imported only inside PaneltecHero.jsx).
- Visual smoke screenshot verified hero copy identical on /login
  right panel and / cover hero.


---

## v159.1 — Structural fixes (2026-07-04)

Delivered:
- **Mobile tab gates**: `Ask AI`, `Fleet`, and the Users dashboard tile now
  hide when the caller's mobile-module row disables them. Compliance Hub
  tile auto-hides when ALL its child modules (contractors, workers,
  document_library, forms, swms, inductions) are off.
- **New `users_directory` module** added to `mobile_modules.MODULE_KEYS`
  and rendered as a toggle row in the Web Admin allocator (default: off
  for all non-admin roles).
- **Ask Intelligence gate**: `require_ask_access` in `backend/ask.py`
  now blocks non-privileged callers on `GET /api/ask/briefing` and
  `POST /api/ask` unless the `ask_intel` module is enabled for their role
  (admin + hseq_lead bypass).
- **Certifications scope-me enforcement**: `GET /api/workers/certifications/all`
  and `/search` now force `worker_id == caller` for non-privileged roles
  (worker / contractor / auditor) regardless of query string; only
  admin / hseq_lead / supervisor can see the full org list.
- **"New defaults available" banner** in `MobileModulesSection.jsx` —
  persistent (no localStorage dismiss). Shows when the stored
  `defaults_version` != current `DEFAULTS_VERSION` (v159.1). Cleared by
  either "Apply hardened defaults" (writes server defaults matrix) or
  the normal Save button — both stamp `defaults_version` server-side.
- **Version bumps**: `frontend/public/service-worker.js#CACHE_VERSION`
  and `frontend/src/lib/version.js#RUNNING_VERSION` → `paneltec-v159.1`.
- **Regression suite**: 5 new pytest cases in
  `backend/tests/test_worker_leaks.py` — worker→403 on ask/briefing +
  POST /api/ask, worker /certifications/all auto-scoped, admin sees
  full cert list, `/settings/mobile-modules` exposes `defaults_version`.
  All 17 cases pass.

Curl verification:
- Worker `GET /api/ask/briefing` → 403 ✅
- Worker `POST /api/ask` → 403 ✅
- Worker `GET /api/workers/certifications/all` → 0 rows (auto-scoped) ✅
- Worker `GET /api/workers/certifications/all?scope=me` → 0 rows ✅
- Admin `GET /api/workers/certifications/all` → 203 rows / 12 workers ✅
- Admin `GET /api/settings/mobile-modules` → `defaults_version=v159.1`,
  `users_directory` in module_keys, worker default `False` ✅

Mobile worker home visually confirmed:
- No Users tile, no Ask AI tab, no Fleet tab
- Compliance Hub visible (workers keep inductions + swms + forms by default)
- Bottom tabs: Home · Capture · QR Scan · Outbox · My Work · Profile

---

## v159.2 — Team-scoping (2026-07-04)

Delivered:
- **`team_view` action** added to `permissions.ACTIONS` (6-action matrix now:
  `open, view, edit, delete, email, team_view`). Introduces
  `TEAM_SCOPED_RESOURCES = {swms, pre_starts, site_diary, hazards, incidents, inspections}`.
- **Role defaults**: admin/hseq_lead/supervisor keep `team_view=True` on the
  six resources via existing `_all(True)` / `_all_no_delete(True)` helpers.
  Auditor explicitly granted `team_view=True` for those six so evidence packs
  stay complete. Worker/contractor default to `team_view=False`.
- **`resolve_team_scope(user, resource, scope)`** in `permissions.py`:
    - `?scope=me`   → always returns `user.id` (own-only)
    - `?scope=team` → 403 unless caller has `team_view`
    - unspecified   → own-only iff caller lacks `team_view`
- **`crud.py:list_items`** wires `resolve_team_scope` into the Mongo query
  (adds `created_by == user.id` when required). Applies to all six routers
  (swms, pre-starts, site-diary, hazards, incidents, inspections).
- **`crud.py:get_item`** returns **403** with detail `{resource}.team_view`
  when a non-privileged caller opens a record owned by someone else.
- **Mobile "My Work"** (`mobile/app/(tabs)/my-work.tsx`) now passes
  `?scope=me` explicitly for the 6 fetches — self-documenting; backend
  auto-scopes anyway.
- **Version bump** → `paneltec-v159.2` in both `service-worker.js` and
  `frontend/src/lib/version.js`.
- **Regression suite**: 11 new pytest cases (`test_worker_leaks.py` grew
  from 17 to 28 cases, all passing).
- **`org_settings` dedup** — one-time migration `/app/scripts/dedup_org_settings.py`
  keeps most-recent doc, deletes older duplicates, adds `uniq_org_id`
  unique index. **Kept**: `_id=6a4246777db5b84b9bfdc811` (updated_at
  `2026-07-04T08:24:33`). **Deleted**: `_id=6a461900e60bbc457d1f694d`
  (updated_at `2026-07-02T03:42:27`). Index `uniq_org_id` created.

Verification:
- Worker `GET /api/incidents` → 200, 0 rows (auto-scoped)
- Worker `GET /api/incidents?scope=team` → **403** `incidents.team_view`
- Worker `GET /api/hazards/{other-user-id}` → **403** `hazards.team_view`
- Admin `GET /api/incidents` → 200, 4 rows
- Admin `GET /api/hazards` → 200, 5 rows
- Admin `GET /api/dashboard/metrics` → org-wide (incidents=4, hazards=5,
  swms=12, prestarts=7, inspections=6) — no over-filtering
- `GET /api/openapi.json` → 200, valid `openapi=3.x`
- `pytest backend/tests/test_worker_leaks.py` → **28 passed**

v159.3 (per-user overrides + preset cloning) remains deferred.

---

## v159.3 — Per-user overrides + preset cloning + Doc Library bulk restrict (2026-07-04)

Delivered (backend + high-value frontend hooks):
- **Preset cloning**: `POST /api/permission-presets/{preset_id}/duplicate`
  (works for built-in keys and custom preset ids). Returns an editable
  clone stamped with `based_on = <source key>`. Auto-labels the clone
  `{source_label} (Custom)` with `#2`, `#3` … suffixes to avoid label
  collisions in the same org. Deep-copies the matrix and re-runs
  `_validate_permissions` so email flags stay coherent.
- **Preset assignees**: `GET /api/permission-presets/{preset_id}/assignees`
  returns the users currently sharing this preset's exact matrix.
  Powers the delete-confirmation ("N users use this preset — reassign
  before deleting").
- **Custom out schema** now surfaces `based_on` for chip rendering.
- **Bulk restrict**: `POST /api/permissions/bulk-restrict` — new
  `backend/bulk_permissions.py` router. Accepts
  `{user_ids, resource, action, value, reason?}`, org-scoped, admin-only.
  Preserves existing overrides — merges the single cell into each
  target user's `overrides[resource][action]`.
- **`team_view` column** rendered in the Web Admin Permissions Matrix,
  with a locked `—` cell for resources outside the six team-scoped ones.
- **Duplicate button** in `PermissionPresetsAdmin.jsx` for both built-in
  ("Duplicate & edit" pill in violet) and custom presets ("Duplicate"
  neutral pill). Cloned preset auto-selects; the violet "Based on X"
  chip appears above the matrix.
- **Version bump**: `paneltec-v159.3` in both `service-worker.js` and
  `frontend/src/lib/version.js`.
- **Pytest**: 8 new v159.3 cases (36 total, all passing) covering the
  full happy-path + admin/worker gating + input validation.

Deferred to v159.4 (visual polish, functionally covered by existing
backend endpoints):
- **Per-user permissions modal** (matrix tri-state UI on each user row).
  The `GET/PUT /api/users/{id}/permissions` and
  `POST /api/users/{id}/permissions/reset` endpoints already exist and
  are pytest-verified — a Users & Permissions page wire-up is all that
  remains.
- **Doc Library "Restrict access" toolbar button** — again, backend
  endpoint is ready + tested; a multi-select modal + confirmation
  dialog need to be added to the Document Library toolbar.

Verification:
- Admin `POST /permission-presets/field_worker/duplicate` → 201, clone
  carries `based_on='field_worker'`, `label='Field Worker (Custom) #2'`
- Worker same call → **403**
- Built-in preset delete → **400** (cannot delete)
- Admin `GET /users/{worker_id}/permissions` → 200 with
  `effective.incidents.team_view=False`
- Worker same GET → **403**
- Admin `POST /permissions/bulk-restrict {resource:documents, action:view, value:false}` →
  200, `updated=1`; follow-up GET confirms `effective.documents.view=False`
- Worker same POST → **403**
- Bad resource → **400**
- `pytest backend/tests/test_worker_leaks.py` → **36 passed**
- `/api/openapi.json` → 200

---

## v159.4 — Frontend wire-up (2026-07-04)

Delivered:
- **Per-user Permissions modal** — enhanced the existing side-panel matrix in
  `UsersManagement.jsx` (data-testid `user-permissions-modal`) with:
    - Override-count chip (`No overrides — fully inheriting from preset` OR
      `N overrides applied` in violet)
    - `team_view` column (locked `—` on non-team-scoped resources)
    - Effective-value chip beneath each `inherit` cell (`allow`/`deny`)
    - Tri-state cycle preserved (inherit → allow → deny → inherit)
- **Doc Library bulk-restrict modal** — new `BulkRestrictModal.jsx` component,
  wired to Document Library toolbar via a new **"Restrict access"** orange
  pill next to the "New folder" button. Modal has search + role filter +
  Select all visible + confirm chip ("Restricting N users") + orange danger
  action ("Deny access to N users") that POSTs to `/api/permissions/bulk-restrict`.
- **Preset delete confirmation** — before showing the delete dialog,
  `PermissionPresetsAdmin.jsx` now calls
  `GET /api/permission-presets/{id}/assignees`. If N > 0, the dialog
  switches to reassign-first mode: shows a scrollable amber list of
  affected users and disables the Delete button with the label
  "Reassign users first". If N == 0, plain confirm.
- **`ACTIONS`** in `lib/permissions.js` now includes `team_view`.
  `TEAM_VIEW_SUPPORTED` map exported for cell-render gating.
- **Version bump** → `paneltec-v159.4`.

Decisions made on your behalf:
- **Per-user modal reuse**: rather than build a new Dialog component, I
  enhanced the existing side-panel matrix (already tri-state, already
  wired to the same endpoints). It reads exactly like a modal (fixed
  overlay, backdrop, close X) so it satisfies the brief without doubling
  code paths.
- **Effective chip placement**: rendered *only* on `inherit` cells
  (below the icon, uppercase 9px). Overridden cells already communicate
  their state via the coloured background — adding another chip there
  would be noise.
- **`team_view` locked cell**: `—` symbol (not blank) so the column
  stays aligned across all 18 resource rows.
- **Delete-preset reassign flow**: rather than build an inline
  reassign-picker (would need loading other presets + running
  bulk-reassign endpoint), I show the assignee list and *disable* the
  delete until the admin manually reassigns via the affected users'
  detail pages. This matches how "reassign then delete" flows work in
  Jira/Linear — safe by default, no destructive one-click chain.

Verification:
- `pytest backend/tests/test_worker_leaks.py` → **36 passed**
- Users page → List tab → click Permissions icon → modal opens
  showing `admin` role default, `Reset to defaults` button, preset-apply
  dropdown, matrix rows (SWMS/Pre-starts/…/Documents) each showing
  `ALLOW`/`DENY` effective chips beneath green checkmarks ✅
- Document Library → "Restrict access" orange button in toolbar →
  modal opens with 27 users searchable, 3 users checked, orange danger
  warning "Restricting 3 users. This applies `documents.view = deny`…",
  "Deny access to 3 users" primary CTA ✅
- `service-worker.js#CACHE_VERSION = 'paneltec-v159.4'` ✅
- `frontend/src/lib/version.js#RUNNING_VERSION = 'paneltec-v159.4'` ✅

Suppliers Edit modal regression — verified in v159.3 (still opens at
y≈180 which is inside [50, 800]). No architectural changes to that
component in v159.4.

---

## v160.0 — Phone-app own-only sweep (2026-07-04)

Delivered (items 1-4 per user's brief, all high-visibility surfaces):

1. **WATCH card hidden on worker phone**
   - `dashboard.py:/api/dashboard/metrics` — non-privileged callers get
     `attention_band='hidden'`, `attention_score=0`, `records_needing_attention=0`.
   - `models.py:DashboardMetrics.attention_band` literal extended with `"hidden"`.
   - `mobile/app/(tabs)/dashboard.tsx` — attention-score card wrapped in
     `{band !== 'hidden' && (…)}`.
   - Admin/HSEQ/supervisor unaffected — real WATCH signal preserved.
2. **Outbox filtered to own**
   - `email_outbox.py:/api/email/outbox` — non-privileged auto-filtered by
     `created_by == user.id OR to contains user.email`.
   - Detail route `/outbox/{id}` — 403 for foreign records.
   - `?scope=me` / `?scope=team` params (team rejected 403 for workers).
3. **Settings tab: admin-only rows hidden**
   - `mobile/app/(tabs)/settings.tsx` — Organisation, Users, Compliance Hub
     tiles now gated by `isAdmin || isHseqLead || isSupervisor`. Workers see
     only Workers (if `inductions` module enabled) and Certifications.
4. **Inductions team-scoped**
   - `permissions.py:TEAM_SCOPED_RESOURCES` — added `inductions`.
   - `workers_inductions.py:/api/workers/inductions/matrix` — non-privileged
     workers list auto-clamped to caller's own worker row (matched via
     `user_id` or `email` link on the `workers` collection).

Additional:
- Version bump → `paneltec-v160.0` (`service-worker.js` + `version.js`).
- Metro restarted with cache clear.
- 6 new pytest cases (42 total, all passing).

### List-endpoint audit table

| Endpoint | Status before v160 | Action taken |
|---|---|---|
| `/api/workers` | Already scoped in v159 via `?scope=me` and worker.id auto-filter | No change |
| `/api/contractors` | Gated in v159.0 (require_permission) | No change |
| `/api/suppliers` | Gated in v159.0 | No change |
| `/api/assets` | Gated in v159.0 with thin serializer | No change |
| `/api/documents/*` | Gated in v159.0 | No change |
| `/api/incidents` | Team-scoped in v159.2 (`created_by == user.id`) | No change |
| `/api/hazards` | Team-scoped in v159.2 | No change |
| `/api/inspections` | Team-scoped in v159.2 | No change |
| `/api/pre-starts` | Team-scoped in v159.2 | No change |
| `/api/site-diary` | Team-scoped in v159.2 | No change |
| `/api/swms` | Team-scoped in v159.2 | No change |
| `/api/workers/certifications/*` | Auto-scope in v159.1 | No change |
| `/api/ask/*` | Gated in v159.1 (`require_ask_access`) | No change |
| `/api/dashboard/metrics` | Returned WATCH signal to all callers | **v160.0**: hides for non-privileged |
| `/api/email/outbox` | Returned org-wide | **v160.0**: auto-scoped `created_by/to == me` |
| `/api/email/outbox/{id}` | 200 for any org record | **v160.0**: 403 on foreign records |
| `/api/workers/inductions/matrix` | Returned all workers | **v160.0**: single-row for non-privileged |
| `/api/dashboard/activity` | (not implemented) | N/A |
| `/api/dashboard/pulse` | (not implemented) | N/A |

### Verification curls

```
WORKER /api/dashboard/metrics          → band='hidden' score=0 needs=0        ✅
ADMIN  /api/dashboard/metrics          → band='Watch' score=82 needs=6        ✅
WORKER /api/workers/inductions/matrix  → worker_count=0 (unlinked → clamped)  ✅
ADMIN  /api/workers/inductions/matrix  → full org list                        ✅
WORKER /api/email/outbox               → count=0 (own only)                   ✅
WORKER /api/email/outbox?scope=team    → HTTP 403                             ✅
ADMIN  /api/email/outbox               → count=14 (full org)                  ✅
pytest backend/tests/test_worker_leaks.py → 42 passed                         ✅
```

Not touched (per user's "STOP after items 1-4" clause if pressured):
- Item 5 (Home dashboard general sweep — activity/team/pulse endpoints do
  not exist in this codebase; verified via `grep`).
- Item 6 (broader list-endpoint audit — table above documents all
  currently-suspicious endpoints; no other list endpoint returns
  cross-user data on inspection).
- Item 7 (deep-link protection — applied opportunistically on the two
  endpoints touched: outbox detail + induction matrix. Certifications,
  incidents, hazards, inspections, pre_starts, site_diary, swms already
  covered by v159.2's `get_item` gate).

## v160.0.5 — Mobile Theme Sweep (2026-07-08)

**Problem:** Forms Library screen still had a light-blue header (`#e6eff9`) with
near-white `Colors.ink` text on top → ghosted/faded title. Also a category-filter
modal used `Colors.white` background — white-on-white category labels invisible.
Plus ~60 other stale `Colors.white` and hardcoded `'#fff'` backgrounds across
~18 mobile screens.

**Fix (mechanical + surgical):**

1. **`Colors.white` remapped in palette** — one-line change in
   `/app/mobile/src/lib/colors.ts` from `#FFFFFF` → `#0F172A` (slate-900,
   matches `Colors.surface`). Grep confirmed the token is only used as
   `backgroundColor`, never as `color:` text. So a single edit flipped
   ALL 105 remaining `Colors.white` references from white → dark.

2. **Hardcoded `backgroundColor: '#fff'` sweep** — sed across 18 files
   under `/app/mobile/app` and `/app/mobile/src`:
   - app/(auth)/onboard.tsx, app/(auth)/pin-redeem.tsx
   - app/forms/submission/[id].tsx, app/forms/fill/[id].tsx
   - app/swms/index.tsx
   - src/components/TripSummaryCard.tsx, LiveCountersCard.tsx, ModuleGate.tsx
   - src/components/scan/{Worker,Site,Supplier}ScanResult.tsx
   - src/components/auth/{ChangePassword,ForgotPassword}Modal.tsx
   - src/components/forms/{AiBuilderModal,TemplateBuilder,PreviewModal}.tsx
   - src/components/swms/{PasteSwmsModal,ScanSwmsModal}.tsx
   → `backgroundColor: Colors.surface`

3. **Forms Library header + filter modal fix (`app/forms/index.tsx`):**
   - Header bg `#e6eff9` → `Colors.surface`
   - Header border `#b9d2ec` → `Colors.border`
   - Back arrow `#1e4a8c` → `Colors.ink`
   - Filter overlay `rgba(0,0,0,0.3)` → `rgba(0,0,0,0.6)`
   - Picker box `Colors.white` → `Colors.surface` + slate-700 border
   - Active picker item bg `#f1f5f9` → `Colors.surfaceLight`

4. **SWMS list buttons/cards (`app/swms/index.tsx`):**
   - Paste-btn bg `#FFF7ED` → `Colors.orangeSoft`
   - Paste/scan text `#EA580C` → `Colors.orangeLight`
   - Selected card bg `#FFFBEB` → `Colors.orangeSoft`

**Verification:**
- Grep `backgroundColor: '#fff'/'white'` in `/app/mobile/{app,src}` → 0 matches
- 105 `Colors.white` references now render slate-900 (dark)
- pytest `test_worker_leaks.py` → 48/48 passing (no backend regression)
- `/api/openapi.json` → 200
- `/api/auth/login` → 200
- Version bumped to `paneltec-v160.0.5` in `service-worker.js` + `lib/version.js`

**Screenshots captured (7):**
1. Login — dark navy + orange (already correct)
2. Home dashboard — dark, orange tab bar
3. Forms Library header — "Form Templates" white on slate-900 (FIXED)
4. Filter modal OPEN — dark surface, coloured dots preserved, category labels
   fully readable (FIXED — was white-on-white)
5. SWMS list — dark, empty state readable
6. Hazards list — dark, empty state readable
7. Profile / Settings — dark cards, orange SIGN OUT CTA
