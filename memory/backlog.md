# backlog.md — Paneltec Safety Portal

Remaining work, grouped by priority. Regenerated at every major ship.

Sibling docs: `BUILD_STATE.md` (technical live-state) and
`PROJECT_STATE.md` (product state + persona flows).

---

## P0 — In flight / awaiting external

- **v1.0.50 APK on Stephen's real phone**
  - Scheduler auto-ingested the fresh build at 2026-09-26T11:17:01Z.
  - The DOWNLOAD APP dropdown now serves v1.0.50 build 172. Stephen
    needs to tap Update on his device to install.
  - Verification signal: any accept/decline round-trip against the
    live trial seed shows the new detail-screen layout from `.132p2`.

- **User verification of `.132p2` Job screen redesign on the real phone**
  - Confirm before/after states render as designed (accept flip,
    truck pre-start CTA visible, navigate button opens Maps app,
    sign-on button navigates to the 501 stub without crashing).
  - Address card / map thumbnail — confirm the placeholder is
    acceptable until the Google Static Maps API key lands.

- **Phase 2 SMS intake end-to-end proof**
  - With the fresh APK on-device, send a whiteboard SMS to the
    handset and confirm:
    - Android BroadcastReceiver fires → local notification.
    - Tapping the notification opens the app to Job Detail
      populated with the parsed 7 fields.
    - Retry queue drains cleanly if the phone is offline at capture
      time.
  - iOS: confirm the Shortcut → `paneltec://` deep link populates
    the Paste-SMS modal end-to-end.

---

## P1 — Next planned ships

- **Phase 4 — `.132p3`** — Sign On GPS/QR gate + `job_id` attached
  to sign-on.
  - Backend `POST /api/mobile/daily-jobs/{id}/signon` — replace the
    501 stub with:
    - Body: `{lat, lng, qr_payload?, acceptance_lat, acceptance_lng}`
    - Verify the caller matches the assignment's `worker_id`.
    - Optional: verify `qr_payload` matches the site's QR (extends
      existing web QR flow).
    - Set `status = signed_on`, stamp `signed_on_at` +
      `signed_on_gps`.
  - Mobile: wire the "Sign On" CTA on the Job Detail screen to the
    endpoint, gated behind the accept transition. Location
    permission prompt on first use.
  - Return the freshly-signed-on assignment so the mobile app
    transitions the tile straight into the Phase-5 signed-on screen.

- **Phase 5 — `.132p4`** — Signed-on screen + site pre-start
  pre-fill with crew Sign rows.
  - New mobile screen for the "on-site" state: pulls the SMS staff
    list, renders one row per crew member, each row has "Sign on"
    button that either QR-scans them or captures a signature-line.
  - Backend `site_prestart` collection scaffold — link to the
    parent `daily_job_assignments` via `site_prestart_id` field
    (already present since `.132p0`).
  - Photos, hazards spotted on arrival, EWP setup + PPE.

---

## P2 — Cleanup + housekeeping

- **Dropbox trash purge** — housekeeping script scaffolded in
  `scripts/dropbox_housekeeping_132n5_trash.py`, refresh token still
  needs `files.permanent_delete` scope. Blocked on user re-authorise
  via `/api/dropbox/oauth/start`.

- **Push 20+ unpushed commits when user is ready** — every commit
  from `.132n5_hk1` through `.132p2c` is local-only. No remote
  configured on this pod. When user provides remote URL, batch-push
  the whole run.

- **Google Static Maps API key** — when user obtains one, wire
  into the mobile Job Detail `<MapCard>` placeholder so the address
  renders as a static thumbnail instead of the current fallback.
  Also unlocks the Signed-on screen's location marker for Phase 5.

- **SMS provider webhook** (optional, low) — Stephen has an
  existing SMS-out integration for the whiteboard; a webhook-based
  ingest would let us bypass the phone-side SMS receiver entirely
  for workers who are on iOS or have SMS blocking. Not requested;
  skip unless user asks.

- **Delete the retired one-shot bash watcher** —
  `scripts/eas_ingest_watcher_132n7d.sh`. Left on disk after
  `.132p2a` for reference; safe to remove.

---

## P3 — Deferred features

- **`.132n6b` — AI re-rank layer on Dropbox search** — Tier 2 over
  the existing Tier 1 `search_v2` result set. Optional.

- **WHS Legislation Phase 2 semantic search + Phase 3 mauve chat UI**
  - Phase 2: OpenAI embeddings via Emergent LLM key on the ingested
    Legislation corpus.
  - Phase 3: chat UI matching the "mauve" mockup Stephen shared.

- **View original document for SSRAs / Incident Reports** — user
  request: surface the source PDF next to the parsed data.

- **Form Templates CRUD** — admin add/edit/remove custom form
  templates (currently seeded, not editable).

- **Worker photo tile CSS bug** — blocked on user screenshot.

- **Google Play Console 2FA** — blocked on user completing
  enrolment. Only relevant when we're ready to submit for public
  Play Store distribution.

- **AI parse accuracy on ingested SWMS** — blocked on user Doc ID.

- **SWMS Emergency Procedures AI leak** — blocked on user Doc ID.

- **COP Cloudflare 403** — Codes of Practice PDFs behind Cloudflare
  bot check. Needs a headless-Chrome scraper or a User-Agent rotate
  strategy.

---

## P4 — Known bugs / tech debt

- **`document_library.py` non-ASCII filenames** — Starlette
  `FileResponse` throws on non-ASCII Content-Disposition. Refactor
  to use `starlette.responses.StreamingResponse` with a manually
  encoded RFC5987 header.

- **`hard_delete_folder` recursive purge not transactional** — if
  a mid-purge Dropbox error hits, the caller is left with a
  partially-deleted folder. Move the multi-step call into a
  best-effort retry loop with idempotent step tracking.

- **Mobile PIN-login ignores soft-deleted users**
  (`backend/auth_mobile_pin.py`) — a worker soft-deleted in the
  users collection can still log in via PIN if they know it.

- **Worker account `disabled_reason: "admin_cleanup_2026_06_29"`
  stale field** — cleanup left the flag on ~30 rows that have
  since been rehired. Needs a one-off script to clear the field
  on rehired workers.

- **Backup agent 401 on `10.232.132.186`** — agent token expired.
  Snapshot upload leg silently failing since two sessions ago.
  Needs the on-prem agent token rotated.

- **`DocumentLibrary.jsx` > 2500 lines** — split into per-category
  sub-components (SwmsSection, PreStartsSection, IncidentsSection,
  etc.). Blocking future feature work in that surface.

- **Sync SDK calls in `dropbox_bytes_copy.py` migration loop** —
  dead-code with the current `MIGRATION_DISABLED=True` lockdown,
  but if the lockdown is ever lifted these need to move to async
  before we ship migration to production.

- **`mDNS discovery bug`** (zeroconf API drift) — carried over
  from an earlier session; low-impact but flagged.

- **`Bulk Import (Daily Pre-Starts) 460 failures`** — carried over;
  needs a re-run with the new Vision extractor once someone has
  time to diff the failure categories.
