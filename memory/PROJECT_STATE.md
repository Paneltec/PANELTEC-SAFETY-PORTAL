# PROJECT_STATE.md — Paneltec Safety Portal

Snapshot at close of session `.132p2b`. High-level product state,
personas, working flows, known limitations, and a dated log of ships
in this session's arc.

For the technical live-state (versions, unpushed commits, running
schedulers, env-var presence), see `BUILD_STATE.md`. For remaining
work + priorities, see `backlog.md`.

---

## Product summary

**Paneltec Safety Portal** is the internal Work-Health-and-Safety
platform for **Paneltec Group** — a Tasmanian civil-contracting
business. It replaces the legacy paper-and-whiteboard workflow: the
office allocation officer issues daily jobs via a "whiteboard" SMS,
field crews accept/decline + sign on to a site on their phones,
truck and site pre-starts are captured digitally, hazards + near
misses + incident reports are logged with photos + GPS, and admins
oversee compliance across SWMS, inspections, WHS legislation, and
document-library artefacts. The whole platform sits on top of a
Dropbox-as-source-of-truth store (in-app browser + search + share
built directly against the Dropbox API), with a Mongo store for
operational state and an on-prem NAS mirror (currently in
maintenance-lockdown — see `MIGRATION_DISABLED`).

---

## Personas

| Persona            | Primary surface     | Key jobs-to-be-done                                                                              |
|--------------------|---------------------|--------------------------------------------------------------------------------------------------|
| Office admin       | Web app             | Manage users + roles, run backups, view audit trails, monitor compliance dashboards.             |
| HSEQ admin         | Web app             | Review SWMS, chase pre-starts, action incidents + hazards, publish WHS legislation updates.      |
| Allocation officer | Web app             | Issue today's job via the whiteboard SMS + web "Issue Job" form (both send the same 7-field job to the crew's phones). |
| Field worker       | Mobile app (Android/iOS) | Accept/decline today's job, truck pre-start, site sign-on, log hazards + incidents, complete inspections + SWMS review. |

**No supervisors.** Paneltec has no supervisor roles — every daily
job is worker-direct. Code + form + data model must reject any
`supervisor_*` field (this rule enforced from `.132n7a` onward and
locked at the schema layer in `.132p0`).

---

## Major flows working today

### Web admin (`/app/*`)
- **Dropbox in-app browser** — full desktop-app parity:
  - Browse team-folder tree (path_root'd to the Paneltec Group
    namespace).
  - Preview any file inline: PDF via react-pdf/PDF.js
    canvas render (`.132n4d` — works in all browser + iframe
    contexts), DOCX, XLSX, images, code, video, audio.
  - Global search (Tier 1) via Dropbox's native `search_v2` with
    highlights (`.132n6`).
  - Share / permissions modal (Share links, member add/remove, etc.
    — `.132n4b`).
  - Drag-drop upload with progress + resumable session upload for
    large files.
  - Move / rename / delete / hard-delete-folder / restore-from-
    trash / version history.
- **Issue Today's Job** form (`/app/mobile/issue-job`, `.132p0`):
  - Locked to the 7 SMS fields: `truck, date, site_name, address,
    customer, staff[], notes`.
  - "Paste SMS" modal → hits shared parser at
    `POST /api/mobile/sms/parse` → pre-fills form.
  - Multi-worker picker + trial-run-to-my-phone.
  - Left panel: today's assignments (auto-refresh every 15 s).
- **Phone Preview** (`/app/phone-preview`, `.132n7c`):
  - Admin-only iframe running the Expo app under a preview JWT.
  - Auto-selects the current admin's own workers row on first
    mount so the "Today's Assignment" tile hydrates without hunting
    for the picker.
  - LocalStorage-persisted choice.
- **Permissions Matrix** — role × capability × workspace grid.
- **WHS Legislation Phase 1** — Cloudflare-scraped
  Australian federal + state safe-work Acts + Regulations + Codes
  of Practice, ingested into `db.whs_legislation` with full text
  and search-by-title.
- **Document Library** (`DocumentLibrary.jsx`) — legacy grid, all
  categories (SWMS, Pre-Starts, Inspections, Incidents, Hazards,
  Toolbox Talks, SDSs, Contractor Docs, Registers, Templates,
  Training Records, Site Records).
- **Backup pipeline** — nightly + on-demand snapshot to on-prem
  agent (currently 401'ing on `10.232.132.186` due to expired agent
  token — see backlog P4).
- **Schema Inspector** — dev-only view of all Mongo collections
  + field cardinality.
- **All recent additions** shipped this session are listed in the
  "Session-summary" section below.

### Mobile worker app (Android + iOS, Expo SDK 57)

**As of v1.0.50 build 172, freshly published 2026-09-26T11:14 UTC:**

- **Home tab**
  - "Today's Assignment" tile — pulsing pill "You have a new job"
    when a fresh row is issued (`.132n5m5`).
  - Tap → Job Detail screen.
  - Empty state: friendly "Ready when the office issues today's
    job."
- **Job Detail screen** (`.132p2`, redesigned):
  - **Before accept**: shows the 7 SMS fields, big
    Accept/Decline buttons, address card (Google Static Maps
    placeholder — see limitations).
  - **After accept**: swaps the pill to "Accepted", surfaces:
    - Truck Pre-Start CTA (stub → Phase 3+)
    - Navigate button (deep-links Google/Apple Maps to the site
      address).
    - Sign-On button (stub → Phase 4).
  - Decline reverses the state and clears the tile.
- **MY WORK tab** (`.132n5m3`) — 5 categories:
  SWMS · Pre-Starts · Inspections · Incidents · Hazards.
  Each opens a stub list (Phase 3+ fills in per-category content).
- **Forms** — SWMS review category surfacing (`.132n5m1`),
  Profile My SWMS routing (`.132n5m1`).
- **QR Scan** — worker sign-on via web-issued QR (existing legacy
  flow, unchanged).
- **Paste SMS modal** (`.132p1a`) — iOS + Android manual paste;
  parses via `POST /api/mobile/sms/parse` and creates the job
  locally.
- **Android SMS receiver** (`.132p1b`):
  - Expo config plugin injects a `BroadcastReceiver` for
    `SMS_RECEIVED` action.
  - Local notification when a whiteboard SMS lands.
  - Retry queue for offline SMS captures.
  - **Needs the fresh v1.0.50 APK on-device** (users still on
    v1.0.48 won't have this).
- **Deep link** `paneltec://` — for iPhone Shortcut integration
  (`.132p1a`).

### Backend (FastAPI on `:8001`)
- **Locked `daily_job_assignments` schema** — 7 SMS fields +
  status + timestamps + geo (`.132p0`). No task, no supervisor, no
  truck-split.
- **Shared SMS parser** at `backend/sms_parser.py` (`.132p0`) —
  handles positional + labeled + mixed shapes; used by both web
  form and mobile receiver.
- **Endpoint contracts**:
  - `POST /api/mobile/daily-jobs` — single create
  - `POST /api/daily-jobs/bulk-create` — batch create (web form)
  - `GET  /api/mobile/daily-jobs/today`
  - `POST /api/mobile/daily-jobs/{id}/accept`
  - `POST /api/mobile/daily-jobs/{id}/decline`
  - `POST /api/mobile/daily-jobs/{id}/signon` (501 stub → Phase 4)
  - `POST /api/mobile/sms/parse`
- **Geocoding** — Nominatim proxy (`/api/mobile/geocode`) with
  in-process cache; called at create-time to populate
  `site_lat/site_lng`.
- **Dropbox OAuth** — team-namespace `path_root` handled at every
  SDK boundary. See `_DROPBOX_SCOPES` in `integrations_dropbox.py`.
- **EAS auto-ingest scheduler** (`.132p2a`) — every 5 min pulls the
  newest FINISHED internal Android build and publishes it to
  `/api/mobile/downloads/android/latest.apk`. Idempotent
  same-build short-circuit; downgrade guard; kill switch in
  `eas_watchdog_settings`.
- **Backup snapshot pipeline** — hourly snapshot watchdog,
  cron-scheduled daily snapshots at 03:30–03:45.

---

## Known limitations / not yet built

- **Phase 4 not shipped** — Sign On GPS/QR gate + `job_id`
  attachment. The mobile Sign-On button routes to a stub; backend
  endpoint `POST /daily-jobs/{id}/signon` returns 501.
- **Phase 5 not shipped** — Signed-on screen + site pre-start
  pre-fill with crew Sign rows. Depends on Phase 4.
- **Google Static Maps API key** — not yet configured. Mobile
  Job Detail shows an address-card fallback instead of a rendered
  map thumbnail. Deep-link to Google/Apple Maps still works.
- **iOS SMS reading** — impossible by design (Apple sandbox).
  Ship workaround: Paste-SMS modal (`.132p1a`) + `paneltec://`
  deep link so users can wire an iOS Shortcut → forward SMS → open
  the app pre-populated.
- **Google Play Console 2FA** — blocked on user completing
  enrolment. Play store submission deferred (internal APK
  distribution already works via the DOWNLOAD APP dropdown).
- **Dropbox trash purge** — housekeeping script scaffolded
  (`.132n5_hk1`) but refresh token still lacks `files.permanent_delete`
  scope. Blocked on user re-authorising via
  `/api/dropbox/oauth/start`.
- **Backup agent 401** — `10.232.132.186` returns 401 on the
  agent token. Snapshot upload leg is failing silently since the
  session before this one.
- **SDS "expiring soon" dashboard widget** — designed, not built.
- **Password-protected + link-expiry** for Dropbox browser shares —
  designed, not built.

---

## Session-summary of today's work

Dated log — one line per ship in the order shipped. Full memos live
in `/app/memory/v58_13_*.md`.

| Ship         | Summary                                                                                              |
|--------------|------------------------------------------------------------------------------------------------------|
| `.132mw`     | SWMS/Pre-start tab routing fix in worker mobile.                                                     |
| `.132mx`     | Worker mobile UI cleanup pass (spacing, colour, icon consistency).                                   |
| `.132my`     | Migration shutdown hardening — first pass of the NAS-write lockdown.                                 |
| `.132n0`     | Fork branding tweak — page title + favicon.                                                          |
| `.132n2`     | Dropbox in-app browser Phase 1 (list, preview, upload/download).                                     |
| `.132n2a`    | Browser writes + rename/delete.                                                                      |
| `.132n2b`    | DOCX preview via Mammoth in-browser render.                                                          |
| `.132n4a`    | Version history.                                                                                     |
| `.132n4b`    | Share/Permissions modal.                                                                             |
| `.132n4c`    | Drag-drop upload with progress.                                                                      |
| `.132n4d`    | PDF preview via react-pdf/PDF.js canvas (fixes all browser + iframe cases).                          |
| `.132n5m1`   | Mobile: wire SWMS Review + Profile My SWMS to SWMS category list.                                    |
| `.132n5_hk1` | Housekeeping: add `files.permanent_delete` scope + trash script (blocked on user App Console).       |
| `.132n5m2`   | Mobile: job detail redesign (map placeholder, accept/decline, navigate + sign-on unlock).            |
| `.132n5m3`   | Mobile: MY WORK tab scaffold (5 record categories).                                                  |
| `.132n5m4`   | Mobile: job tile+detail wired to real SMS fields, empty-state reword.                                |
| `.132n5m5`   | Mobile: remove supervisor UI, filter self from work mates, new-job pulse + banner.                   |
| `.132n6`     | Dropbox in-app global search (Tier 1: `search_v2` + highlights).                                     |
| `.132n7a`    | Issue Today's Job form (supervisor removed) + trial-to-my-phone + real SMS-shape trial seed + `/today` fallback. |
| `.132n7b`    | Wide-net trial-seed for phone-preview tile + EAS rebuild status memo.                                |
| `.132n7c`    | Phone-preview worker auto-select + EAS APK rebuild triggered (v1.0.48 build 170).                    |
| `.132n7d`    | EAS build watcher + auto-ingest of fresh APK.                                                        |
| `.132n8`     | Hard NAS-write lockdown (`MIGRATION_DISABLED=True` × 22 code guards).                                |
| `.132p0`     | **Phase 1 rebuild** — lock `daily_job_assignments` to 7 SMS fields, shared SMS parser, purge task/supervisor/truck-split. |
| `.132p1`     | **Phase 2** — mobile SMS intake (Android BroadcastReceiver + iOS paste flow + deep link).            |
| `.132p1a`    | Mobile parser + iPhone paste modal + `paneltec://` deep link.                                        |
| `.132p1b`    | Android SMS BroadcastReceiver via Expo config plugin + local notification + retry queue.             |
| `.132p2`     | **Phase 3** — Job screen redesign (before/after accept) with truck-prestart button, navigate, sign-on stub. |
| `.132p2a`    | Persistent EAS APK auto-ingest scheduler + immediate v1.0.50 ingest.                                 |
| `.132p2b`    | Lock full colour palette in `colors.ts` + normalise hex literals across mobile.                      |
| `.132p2c`    | *(this ship)* — state files: BUILD_STATE, PROJECT_STATE, backlog updated to session close.           |

---

## Credentials for testing

See `/app/memory/test_credentials.md` (kept out of Git). The current
admin credential (`stephen@paneltec.com.au` / …) still works and was
used successfully by:
- `.132n7c` EAS trigger flow
- `.132p0` pytest suite
- `.132p2a` scheduler ingest audit-log

The wide-net trial seed (`.132p0_trial_seed`) is live for 3
identities: `worker_stephen@paneltec.com.au` (users), the admin's own
users row (`808cb7de-…`), and the linked Stephen Guy workers row
(`dbddf739-…`). Any of those identities pulls the trial job on
`GET /api/mobile/daily-jobs/today`.
