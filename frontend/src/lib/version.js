// Paneltec Civil · v159 — single-source-of-truth version constant
// for the currently running JS bundle.

// v160.3.9.41 — Users & Permissions UX polish.
//                  Part A — Drag-handle reorder for role sections.
//                    Replaces the up/down ArrowUp/ArrowDown buttons on
//                    each role-section header with a `⋮⋮`
//                    GripVertical drag handle powered by `@dnd-kit/
//                    core` + `@dnd-kit/sortable`. Section rows drag
//                    up/down; drop persists via the SAME endpoint
//                    (`PUT /api/user-prefs/section-order/users` with
//                    `{section_order: [...]}`) and preserves the SAME
//                    per-viewer semantic — every logged-in admin has
//                    their own saved order. Keyboard sensor: arrow
//                    keys with focus on the grip, Space to lift /
//                    drop. Per-user row sort dropdown for name /
//                    last-login / date-created preserved.
//                  Part B — Auto-linked worker avatars on Users
//                    rows. ALREADY IMPLEMENTED in v160.3.9.33.1 at
//                    `backend/users.py:187-231` — no code change
//                    needed. GET /api/users enriches each row with
//                    `photo_url` at read time by looking up the
//                    matching worker via `simpro_employee_id` (primary)
//                    or case-insensitive `email` (fallback). Verified
//                    live: 4/N rows on Stephen's admin view render an
//                    `<img>` avatar today (rest use the initials
//                    fallback).
// v160.3.9.40 — Security Wave 2. Bundled:
//                  • SEC-002 (Stored XSS in email Outbox): server-side
//                    `bleach` sanitizer on the `body_html` WRITE path in
//                    `email_outbox.py`, keyed off a strict tag/attribute
//                    allowlist (`p, br, strong, em, u, ul, ol, li, a,
//                    h1-h4, blockquote, hr, span, img, table, thead,
//                    tbody, tr, td, th`). `<script>`, `on*` handlers,
//                    `<iframe>`, `javascript:` URLs, and non-image
//                    `data:` URLs are stripped. Idempotent startup
//                    backfill sanitises historical `outbound_emails`
//                    rows and records a marker doc in
//                    `bk_migrations.v160_3_9_40_email_outbox_sanitize_backfill`.
//                    Outbox.jsx keeps `dangerouslySetInnerHTML` — server
//                    is authoritative. New `data-sanitized="true"`
//                    probe marker on that div.
//                  • SEC-003 (Integration secrets plaintext at rest):
//                    new Fernet key `INTEGRATIONS_ENC_KEY` (distinct
//                    from the v38 backup key — cross-scope isolation).
//                    Secret fields under
//                    `integration_configs.<kind>.config.<field>` for
//                    Simpro (`api_token`), Navixy (`password`,
//                    `session_hash`), M365 (`client_secret`,
//                    `access_token`, `refresh_token`), TextMagic
//                    (`api_key`) are encrypted at rest — ciphertext
//                    lives under `<field>_encrypted` and the plaintext
//                    key is `$unset`. Idempotent startup migration
//                    guarded by
//                    `bk_migrations.v160_3_9_40_integrations_encryption`.
//                    Manual re-run: `POST /api/integrations/admin/
//                    migrate-integration-secrets`. New helper
//                    `hydrate_integration_config(doc)` returns a
//                    shallow-copy config with plaintext hydrated —
//                    every consumer site
//                    (`auth.py` Simpro login, `integrations_simpro`
//                    `_cfg`, `integrations_m365._cfg`,
//                    `integrations_simpro_workers`, `asset_navixy_*`,
//                    `asset_service`, `asset_trip_summary`,
//                    `form_assignment_notifier`) now flows through it.
//                    API responses continue to return only the
//                    masked-last-4 preview — never plaintext OR
//                    ciphertext.
//                  • SEC-004 (Unauthenticated /api/files/*):
//                    `permissions_middleware.py` skip for
//                    `^/api/files/` REMOVED. Every handler under
//                    `dashboard.py::files_router` now depends on
//                    `Depends(get_current_user)` which accepts the
//                    short-lived download-scoped JWT via `?token=`
//                    query — the existing `filesUrl()` helper on the
//                    FE already sends this so no FE change was
//                    needed. `document_library` and `form_photos`
//                    are additionally org-scoped: the parent
//                    folder/submission's `org_id` must match the
//                    caller. Mismatch returns 404 (existence not
//                    confirmed). `/api/files/renewals/{token}/{name}`
//                    stays public — auth via the share-link token
//                    in the URL — and is now the only entry in the
//                    middleware `/api/files/` skip list.
// v160.3.9.39 — Introduce `local_agent` backup destination kind.
//                  When the LAN backup agent runs INSIDE the NAS's
//                  own Docker environment, the SMB mirror step
//                  is redundant AND was failing on `Connection
//                  refused` (UGREEN SMB service off). New
//                  `kind: "local_agent"` + `local_path` (default
//                  `/data`) on `bk_destinations`. Backend:
//                  `GET /api/backup/agent/pending` omits SMB
//                  fields for local_agent rows and returns
//                  `mode: "local"` + `local_path` instead.
//                  `POST /api/backup/agent/report` only bumps
//                  `last_written_at` when the reported
//                  `target_path` actually starts with the
//                  configured `local_path`. Create/update
//                  destination endpoints REJECT SMB fields on a
//                  local_agent row with HTTP 400 for a clean
//                  contract. Idempotent startup migration
//                  converts destination
//                  `5e6a5346-2207-409d-ab11-c702651223fa`
//                  (Office UGREEN tower) to local_agent and
//                  clears any stale SMB mirror telemetry
//                  (last_mirror_status, last_mirror_error).
//                  Frontend `<MirrorStatusCards>` gains a
//                  fourth state — "DELIVERED (LOCAL MOUNT)"
//                  in calm blue-green — with an
//                  "Awaiting first write" amber sibling. SMB
//                  failure surface suppressed for local_agent
//                  rows.
//                Bundled fixes (same version bump — spotted in
//                the same screenshot):
//                  • Refresh button on LAST LAN DELIVERY was
//                    firing `load` but had no tactile feedback;
//                    now wired through a `handleRefreshClick`
//                    that adds an `isRefreshing` state, disables
//                    the button, spins the icon, and enforces a
//                    500ms visible floor so a fast round-trip
//                    still registers as a click.
//                  • "Reported NaN d ago" subline under the
//                    Backup agent disk gauge — the local
//                    `fmtAge(min)` was being fed an ISO
//                    timestamp. New module-level
//                    `safeRelativeTime(iso)` helper returns
//                    "—" on any parse failure and is now used
//                    everywhere in BackupTab.jsx that renders a
//                    relative time. "NaN" can no longer surface.
// v160.3.9.38 — SMB destination password at-rest encryption.
//                  BEFORE: `bk_destinations.password` stored in
//                  plaintext, readable via mongodump, snapshot ZIPs,
//                  and any DB-level access. AFTER: Fernet
//                  (AES-128-CBC + HMAC) ciphertext stored on
//                  `password_encrypted`, keyed by `BACKUP_DEST_ENC_KEY`
//                  env var. `agent/pending` decrypts at read time so
//                  the LAN agent contract is unchanged. Idempotent
//                  startup migration sweeps legacy plaintext rows
//                  into ciphertext (guarded by
//                  `bk_migrations.v160_3_9_38_dest_password_encryption`
//                  marker). Manual re-run at
//                  `POST /api/backup/admin/migrate-destination-passwords`.
//                  Backend-only patch — no FE changes required.
// v160.3.9.37 — Backup dashboard clarity fix.
//                  1. Relabelled the "NAS disk" gauge to "Backup
//                     agent disk" — the numbers come from the
//                     LAN agent's OWN filesystem (Raspberry Pi
//                     SD/SSD in the reference deployment), NOT
//                     the SMB NAS tower. Added agent name +
//                     heartbeat age subline + tooltip explainer.
//                  2. New `<MirrorStatusCards>` renders per-
//                     destination mirror-state: green Mirroring
//                     OK / red Mirror failing (with verbatim
//                     error + "What to check" collapsible) /
//                     amber Never mirrored. Fixes the "0 MB free
//                     of 0 MB" confusion by giving the SMB
//                     Connection-refused signal its own surface.
//                  3. Backend: `POST /api/backup/agent/report`
//                     now accepts an optional `nas_disk_usage`
//                     payload (same shape as `disk_usage`, but
//                     covering the SMB target). Stashed on the
//                     destination doc + relayed in
//                     `/api/backup/lan-status` as
//                     `destinations[].nas_disk_usage`. FE hides
//                     the NAS-tower gauge until the agent code
//                     starts posting it — no invented numbers.
//                  Preserves the v160.3.7ah defensive fallback
//                  in `DiskGauge` (`!usage || total===0` → amber
//                  "Unavailable — agent not reporting" chip).
// v160.3.9.36 — Phase 5: legacy `role`-string retirement (shim).
//                  New `auth.py::_derive_legacy_role()` mapper +
//                  `get_current_user()` shim make `user.role` an
//                  authoritative derivative of `user.role_id` on
//                  every request. The ~65 Bucket-A legacy
//                  `user.role`-string gates scattered across the
//                  backend now read a value sourced from the DB's
//                  authoritative `role_id`, eliminating drift.
//                  Bucket B (display) auto-fixed by the shim.
//                  Bucket C: Simpro import dual-writes role +
//                  role_id using the mapper (data-hygiene).
//                  FE: `MobileModulesSection.jsx` row-key
//                  parameter renamed `role` → `role_id`.
//                  Per-site Bucket-A migration is now backlog
//                  work — see phase5b_bucket_a_backlog.md.
//                  `require_roles()` deprecated but kept live for
//                  the ~20 Simpro endpoints still using it.
// v160.3.9.35 — Phase 6: permissions token unification.
//                  Backend `_role_default()` in `permissions.py` is
//                  now ALWAYS DB-first for every role (seeded +
//                  custom). It reads `roles.permission_tokens[]`
//                  from Mongo keyed on `role_id` and only falls
//                  back to the hardcoded `ROLE_DEFAULTS` map when
//                  the DB has no active doc for that role_id
//                  (first-run / pre-seed safety). Fixes the silent-
//                  ignore bug where an admin editing seeded roles
//                  via the Roles Matrix UI would see their changes
//                  ignored at runtime. Empty `permission_tokens: []`
//                  is now respected as an explicit "no permissions"
//                  choice — not a fallback trigger. Full matrix
//                  (`effective_for`) inherits the same semantics.
//                  Legacy `_role_permits` alias preserved for
//                  backwards-compat middleware import.
// v160.3.9.34.5 — Fix: expanded ID Card content is no longer hidden
//                  behind the sticky Save/Cancel footer. Two changes,
//                  both in the Edit modal: (1) `pb-24` (96px) padding-
//                  bottom on the modal's `overflow-y-auto` scroll
//                  container so any last-child section has room to
//                  scroll fully above the footer; (2) `useEffect` in
//                  `IdCardSection` that fires
//                  `scrollIntoView({block:'start', behavior:'smooth'})`
//                  on the section wrapper whenever `open` flips true,
//                  placing the header near the top of the visible
//                  scroll area with the newly-revealed content
//                  visible below it, footer no longer overlapping.
//                  No other section touched.
// v160.3.9.34.4 — Fix: ID Card section now opens on the first tap on
//                  touch devices. Previously the section (last child of
//                  the modal's scrollable body) sat at the scroll
//                  boundary, so iOS Safari's 300ms tap-delay + tap-vs-
//                  scroll ambiguity swallowed the first tap and the
//                  section only opened on the second attempt. Bespoke
//                  header for `IdCardSection` — mirrors the shared
//                  `<Section>` visual pattern (same chevron animation,
//                  same badge slot, same open/close transition) but
//                  adds `touch-action: manipulation` +
//                  `-webkit-tap-highlight-color: transparent` +
//                  `scroll-margin-block-end` so single-tap toggles
//                  identically to the sibling sections above. No other
//                  section touched.
// v160.3.9.34.3 — Explicit "Upload Photo" button on the Edit worker
//                  modal header and the read-only view drawer. The
//                  previous versions only surfaced a clickable avatar
//                  (view drawer) or no upload UI at all (edit modal),
//                  so users could not find how to add a photo. New
//                  self-contained `<EditWorkerPhoto>` uploader lives
//                  in `Workers.jsx` — plain `<input type="file"
//                  accept="image/*">` styled as a labeled button, no
//                  feature detection, no conditional hiding. Wired to
//                  the existing POST /api/workers/{id}/photo endpoint.
//                  On success the avatar refreshes immediately without
//                  closing the modal. Camera button hidden in-tree
//                  behind a false-gated conditional per user request.
// v160.3.9.34.2 — Camera capture for the worker avatar uploader + ID Card
//                  tap-to-expand. New `<CameraCaptureModal>` (getUserMedia →
//                  live preview → Capture/Retake/Switch/Close → JPEG File
//                  @ 0.85 quality) wired into `<WorkerPhoto>` in the read-
//                  only view drawer. Feature-detected: button hidden on
//                  browsers without `mediaDevices.getUserMedia`. Zero-leak
//                  stream release on every exit path. Plus new
//                  `<ImageLightbox>`: the ID Card photo tile and QR tile
//                  are now tap-to-expand with hover ring + magnifier
//                  overlay, ESC / X / click-outside to close.
// v160.3.9.34.1 — Phase 4b parity for workers. Removed manual
//                  "Add worker" affordance from the Workers page
//                  (top-of-page CTA + empty-state CTA + copy). The
//                  public `POST /api/workers` endpoint now returns
//                  410 with detail "worker create disabled: use
//                  Simpro ZIP import". Auth gate preserved
//                  (401 unauth, 403 non-admin, 410 admin).
// v160.3.9.32-4c — Phase 4c: Deferred FE polish + per-user permission
//                  overrides with reasons sidecar. Grouped-by-role Users
//                  list with collapsible sections and per-section sort.
//                  ResetPasswordDialog in the user drawer (direct + magic-
//                  link modes). Drawer chips (Simpro-linked, TEST, Pending,
//                  Archived). Permissions tab in the user drawer reading
//                  GET /users/{id}/permissions and PUT-back with reasons.
//                  Housekeeping: InviteModal + BulkInviteModal removed.
// v160.3.9.42.1 — Users & Permissions UX patch (two bugs, one version).
//                  Bug 1 — Skewed / soft avatars on the Users table:
//                    Root cause was Shadcn `<AvatarImage>` rendering
//                    `aspect-square h-full w-full` WITHOUT
//                    `object-cover`, so the browser defaulted to
//                    `object-fit: fill` and stretched non-1:1 photos.
//                    Users.jsx now renders a bare `<img>` at 56 px
//                    (h-14 w-14) with `rounded-full object-cover
//                    border border-slate-200 bg-white` — identical
//                    styling discipline to the Workers portal row
//                    photo, just larger. Initials fallback follows
//                    the same square-round + object-cover pattern
//                    via a plain `<div>`. `UserAvatarImage` wrapper
//                    from v41.2 preserved (still resolves through
//                    `filesUrl()` so SEC-004 signed-download JWT
//                    ships with every request).
//                  Bug 2 — Per-section sort dropdown removed:
//                    Every role section now sorts alphabetically
//                    (A-Z on `name`) as the single deterministic
//                    order. `sortUsers()` collapsed to one
//                    `localeCompare({sensitivity:'base'})` pass;
//                    the four-option `<select>` (Name A-Z / Name
//                    Z-A / Last login / Date created) and its
//                    `sectionSort` state are deleted from
//                    UsersManagement.jsx. Drag-handle section
//                    reorder (v41) is UNCHANGED — this only
//                    touches row-within-section ordering.
// v160.3.9.42 — Users & Permissions polish (v41 follow-up).
//                  Enlarged user-row avatars from 40 px → 56 px so
//                  the Simpro-linked photos are legible at glance.
//                  Also added a defensive `<AuthedImage>` sweep on
//                  Hazards + SubmissionViewer photo lists — any
//                  `<img>` pointing at `/api/files/*` or `/api/
//                  workers/*/photo/*` now flows through the shared
//                  fetch-with-Bearer + blob URL helper so nothing
//                  silently 401s post-SEC-004.
// v160.3.9.42.2 — Users & Permissions row-height trim.
//                  v42.1's bare-<img> avatar at 56 px pushed row height
//                  to 69 px because the surrounding row cells still
//                  carried the v42 `py-1.5` (12 px total padding) plus
//                  the Actions cell's legacy `py-3` (24 px total). User
//                  asked for a tighter layout that hugs the avatar
//                  with only a couple of pixels of breathing room.
//                  Every row `<td>` now uses `px-4 py-1 align-middle`
//                  (checkbox cell uses `px-3 py-1 align-middle`).
//                  Actions cell's outlier `py-3` reduced to `py-1` to
//                  match the row. Avatar UNCHANGED at 56×56 —
//                  reduction is padding-only. Row height measured
//                  from 69–69.5 px → 60–61 px. Section header row,
//                  drag handle, column widths, font sizes and every
//                  other page element untouched. Explicit
//                  `align-middle` is redundant with the browser
//                  default `vertical-align: middle` on `<td>` but
//                  makes future refactors safe against a Tailwind
//                  reset that might change the default.
// v160.3.9.42.3 — Bundle: three bugs on Users & Permissions.
//                  Bug 1 (Aaron Foster purple circle):
//                    Aaron's Simpro-imported photo was a 512×512 solid-
//                    purple placeholder PNG (11.9 KB, fetch HTTP 200 —
//                    the image itself IS junk, no fallback fires
//                    because from React's POV the load succeeded). New
//                    `isMonoColorImage()` decodes the image into a 4×4
//                    canvas and computes channel-wise variance; scores
//                    < 500 are treated as broken → render the initials
//                    fallback. Live calibration on 12 real users: mono
//                    Aaron scored 114.93, LOWEST real photo (Dominic
//                    Goold) scored 1,608, HIGHEST (Craig Large) 14,884
//                    → 500 is 4.4× above the mono ceiling and 3.2×
//                    below the real-photo floor. `getInitials(name, email)` now returns
//                    proper 2-char initials (e.g. "AF" for Aaron Foster)
//                    instead of the previous single-letter fallback.
//                    New reusable `<InitialsAvatar>` component owns the
//                    fallback tile styling. `<img crossOrigin="anonymous">`
//                    so the canvas readback isn't tainted by CORS.
//                  Bug 2 ("← Back to Settings" too close to breadcrumb):
//                    Shared component `capture/Ui.jsx::SettingsBackLink`
//                    was `inline-flex` and the sibling `renderCrumb`
//                    also returned an `inline-flex` div — both inline-
//                    level, so they collapsed onto the same line as
//                    "← Back to SettingsSETTINGS / Users". Wrapped the
//                    back-link in a block-level `<div className="mb-2">`
//                    so it lays out ABOVE the crumb on every page that
//                    uses PageHeader (~24 pages: Users, Workers, Roles,
//                    Contractors, Certs, Vehicles, Sites, Audit Exports,
//                    Ask, Outbox, etc.). Single-file fix.
//                  Bug 3 ("Refresh from Simpro" button did nothing):
//                    Root cause was BACKEND — `simpro_import_users.py::
//                    sync_linked_users` (and 3 sibling call sites in the
//                    same file) still read `cfg_doc.get("config") or {}`
//                    to hand the raw doc to `_fetch_simpro`, which
//                    expects plaintext `api_token`. v40 SEC-003 moved
//                    every Simpro secret to `<field>_encrypted` at rest,
//                    but this file was missed in the audit. Result:
//                    HTTP 500 KeyError: 'api_token' in 98ms — endpoint
//                    never reached the Simpro API. All 4 call sites now
//                    flow through `hydrate_integration_config(cfg_doc)`.
//                    Verified via curl: HTTP 200 · scanned=64 · changed=0
//                    · 31.9s wall-time (real API round-trip).
//                    FE polish (same version): button gains
//                    `isRefreshingSimpro` state + spinner + "Refreshing…"
//                    copy + `data-refreshing` probe attribute + 500ms
//                    min-visible floor. testid renamed
//                    `sync-from-simpro-btn` → `refresh-from-simpro-btn`
//                    to match the user-facing label.
// v160.3.9.43 — SEC-003 SWEEP CONTINUATION HOTFIX.
//                  v42.3 patched `simpro_import_users.py` after the
//                  "Refresh from Simpro" button crashed with
//                  `KeyError: 'api_token'`. That was one of NINE latent
//                  gaps in the v40 SEC-003 migration. This version
//                  closes the remaining EIGHT across four files:
//                    • asset_meter_history.py (2 sites — Navixy 30-day
//                      backfill and track-based backfill, both read
//                      `session_hash` on raw doc).
//                    • integrations_textmagic.py (2 sites — `_cfg()`
//                      helper returned raw `doc["config"]`; `tm_send`
//                      also read the raw config directly. Every SMS
//                      send would have 4xx'd with the encrypted
//                      Mongo doc).
//                    • worker_certifications.py (1 site — cert
//                      expiry reminder cron/manual endpoint read
//                      TextMagic credentials from the raw doc; SMS
//                      would have silently dropped without error).
//                    • workers.py (1 site — `POST /workers/sync-from-
//                      simpro` read `cfg["api_token"]` directly to
//                      call `_refresh_staff_cache`; would 500 on
//                      first click).
//                    • health_extras.py (3 sites — Simpro / Navixy /
//                      TextMagic health checks used
//                      `(cfg.get("config") or {}).get("api_token")`
//                      to detect presence. On v40-encrypted rows the
//                      plaintext no longer exists, so every health
//                      pill reported "Not connected" even when the
//                      integration was fully functional. Fixed by
//                      accepting plaintext OR `<field>_encrypted` for
//                      the presence check — actual auth still goes
//                      through `hydrate_integration_config` in the
//                      real request path).
//                  Every consumer now flows through
//                  `hydrate_integration_config(cfg_doc)` — the shared
//                  v40 helper that returns a shallow-copy config with
//                  plaintext hydrated in memory only.
//                  Test coverage: `test_integrations_encryption_v40`
//                  extended with per-file regression fixtures that
//                  seed an encrypted config, call each of the eight
//                  fixed code paths, and assert no `KeyError` and
//                  no fallback-to-empty-cfg behaviour.
// v160.3.9.43.1 — Green + Orange pill-toggle pair (Users list/dashboard
//                   pattern applied app-wide) + SEC-003 startup self-
//                   check + SEC-003 contract regression pytest.
//                   AUDIT CORRECTION: original v43 audit table listed 12
//                   sites; grep against the actual codebase found the
//                   Shadcn `<TabsList>` "Dashboard + List" pair on
//                   only 7 sites — Users, Hazards, Certifications,
//                   Incidents, Inspections, Swms, SitesAdmin. The other
//                   "12" from the audit were either bespoke pill toggles
//                   (Workers Directory / Matrix), 3+ way tab strips
//                   (PlantVehicles), or non-existent (Contractors,
//                   Vehicles, Suppliers, RolesAdmin, Outbox,
//                   DocumentLibrary, PermissionPresetsAdmin,
//                   SwmsAssignmentsAdmin all have no `<TabsList>` at
//                   all). Applied to the 7 verified sites only.
//                  Component: new `variant="pill-pair"` on the shared
//                  Shadcn `<TabsList>` + `<TabsTrigger>` so Radix keeps
//                  ownership of state + keyboard nav + focus rings for
//                  free. Colour is POSITION-BASED per your approval:
//                  LEFT (List, emphasis="primary") → emerald;
//                  RIGHT (Dashboard, emphasis="secondary") → orange.
//                  Active = solid fill + white text + white/25
//                  translucent count-badge; Inactive = pale tint
//                  (emerald-50 / orange-50) + coloured text + white
//                  opaque count-badge. Site conversion is a 3-token
//                  swap (`variant="hero"` → `variant="pill-pair"`) —
//                  ZERO structural changes, so every `<TabsContent>`
//                  still switches correctly.
//                  SEC-003 startup self-check (server.py:on_startup):
//                  scans `integration_configs` for `<field>_encrypted`
//                  keys and, if `_FERNET` is unloaded OR fails a
//                  decrypt smoke-test on any kind, logs a high-visibility
//                  `log.error` naming each affected `kind`. Non-fatal —
//                  the app still boots — but the log line makes botched
//                  key rotations impossible to miss. Verified: healthy
//                  boot logs `[v43.1 SEC-003 SELF-CHECK] OK — 4
//                  integration kinds carry ciphertext, all decrypt
//                  cleanly.`
//                  SEC-003 contract pytest
//                  (`test_sec003_contract_v43_1.py`): static scan of
//                  every `/app/backend/*.py` for the invariant "if you
//                  read `integration_configs` AND dereference any
//                  secret field on cfg/c/conf/tm_cfg/etc., you MUST
//                  import `hydrate_integration_config`." Pre-v43 this
//                  would have flagged 4 files (asset_meter_history,
//                  integrations_textmagic, worker_certifications,
//                  workers, simpro_import_users). Post-v43 the sweep
//                  is complete — the test reports 0 offenders.
// v160.3.9.43.2 — Bug fix: "Refresh from Simpro" pill stayed "22d ago"
//                  after a successful click. Case (a) diagnosis — field
//                  mismatch. The pill reads `GET /integrations/simpro/
//                  workers/last-sync`, which is the ZIP-import snapshot
//                  endpoint (`simpro_zip_import.py::last_sync_marker` →
//                  latest `worker_import_snapshots` doc by `run_at`).
//                  `POST /admin/simpro/sync-linked` (v42.3 fix) writes
//                  only per-user `users.simpro_last_synced_at` fields.
//                  So the pill was picking up the last ZIP import (July
//                  12 — 22 days ago) even though the manual sync had
//                  just run. Two-part fix:
//                    • Backend: `sync_linked_users` now writes a
//                      `worker_import_snapshots` row on completion with
//                      `kind='sync_linked'` + `counts={scanned, changed,
//                      role_updates, lock_drifts}`. The shared pill
//                      endpoint returns the latest by `run_at`, so the
//                      pill now reflects manual syncs immediately.
//                    • Frontend: the Refresh button's success handler
//                      calls `await Promise.all([load(), loadLastSync()])`
//                      instead of `await load()`, so the pill refreshes
//                      without a full page reload.
//                  Test coverage: `test_sync_linked_writes_snapshot_v43_2`
//                  seeds an ephemeral simpro config + one linked user,
//                  monkey-patches `_fetch_simpro`, calls the handler,
//                  and asserts a fresh `worker_import_snapshots` row
//                  exists with `kind='sync_linked'` and `run_at`
//                  within the current test window.
//                  Note: this fix only covers the sync-linked path.
//                  Other Simpro flows (workers ZIP import at
//                  `integrations_simpro_workers.py` and roles sync at
//                  `roles_catalogue.py::sync_roles_from_positions`)
//                  already write to their own snapshot rows or don't
//                  need to appear in this pill.
// v160.3.9.44 — Wave 1 of RBAC audit remediations.
//                  Part A (P0-AI): audit's Section-3 finding was a
//                    FALSE POSITIVE. The 3 AI routes in `ai.py` (POST
//                    /swms-draft, /diary-structure, /hazard-vision)
//                    are ALREADY gated via `Depends(require_ai_use)`
//                    which is `Depends(require_permission("ai","use"))`.
//                    Verbatim curl on all three: HTTP 401 for anon.
//                    My static-scan regex missed the aliased Depends.
//                    Lesson folded into Part C's contract test.
//                  Part B (P0-IDOR): diagnosis showed no LIVE hole —
//                    every mutation was closed by an incidental
//                    `WRITE_ROLES = {"admin","hseq_lead"}` inner
//                    allowlist. But the token model was inconsistent:
//                    outer `require_permission("workers","edit")`
//                    granted the token while inner allowlist silently
//                    overrode it. Added explicit
//                    `require_scoped_access(user, resource, existing)`
//                    calls at 5 latent sites so record-scope is
//                    enforced regardless of the role allowlist:
//                    - workers.py: PATCH + DELETE /workers/{id}
//                    - worker_certifications.py: PATCH + DELETE
//                      /certifications/{cert_id} (via parent worker
//                      company_id lookup)
//                    - contractors.py: DELETE /contractors/{cid}
//                    404-on-scope-mismatch (not 403) to match SEC-004's
//                    existence-leak-avoidance pattern.
//                  Part C: new `test_permissions_gate_contract_v44.py`
//                    scans every mutating route in `/app/backend/*.py`
//                    and asserts a `require_permission`-family gate
//                    exists in the Depends chain (recognises aliased
//                    wrappers like `require_ai_use`,
//                    `require_admin_and_hseq`). 7 auth-bootstrap routes
//                    allow-listed by (file,verb,path). 122 LEGACY
//                    routes with only `Depends(get_current_user)` or
//                    `Depends(require_roles(...))` documented as
//                    `_KNOWN_UNGATED_LEGACY` tech debt — future waves
//                    will migrate them. New mutating routes without a
//                    gate fail the test at CI.
//                  Test coverage delta: +8 tests (6 IDOR + 2 contract),
//                  regression stack now 91/91 (was 101/101 pre-wave —
//                  the extra 2 sync_linked_snapshot tests from v43.2
//                  contribute).
// v160.3.9.45 — Wave 2 RBAC audit remediations.
//                  P1-CUSTOM + P1-TC-UNDER closed. Idempotent one-shot
//                  backfill of the 11 empty Simpro `custom_*` UUID
//                  roles + Traffic Controller expansion (3 → 16
//                  tokens) + Cleaner role INSERT (no UUID doc existed).
//                  Marker: `bk_migrations.v160_3_9_45_custom_role_
//                  token_backfill`. Field workers (Construction Worker
//                  L1/L2/L3/CW2, Machine Operator, Traffic Controller)
//                  get identical 16-token Cluster-A set; Plumber gets
//                  Cluster-A + `assets.view + vehicles.view`; Cleaner
//                  gets Cluster-A minus `swms.view + inductions.view`;
//                  Directors get 44-token Cluster-C (read + email,
//                  team_view, no edit); Ops Manager adds `.edit` on
//                  hazards/incidents/pre_starts; Safety and Compliance
//                  Manager adds `.edit` across the full compliance
//                  domain; Admin Assistant + Administration get
//                  Cluster-D (24 tokens view+email). NO `users.*`,
//                  `roles.*`, `integrations.*`, `backups.*`, or
//                  `.delete` grants anywhere outside admin. Total
//                  active users unblocked: 57 (26 Traffic Controllers +
//                  19 Construction Workers L2 + 12 across the other
//                  10 roles).
//                  Also: v44 IDOR-scoping test extended with the "no
//                  cross-contractor writes anywhere" invariant across
//                  every scoped resource (workers, hr, certifications,
//                  documents, contractors).
// v160.3.9.47 — Program Schematic redesign (SVG topology).
//                  Complete rewrite of `pages/settings/ProgramSchematicPage.jsx`
//                  and `lib/programSchematic.js`. ReactFlow retired in
//                  favour of a static SVG hub-and-spoke poster on a
//                  dark-navy canvas with a radial purple bloom behind
//                  a blue→violet gradient central hub badge.
//                  6 clusters, locked palette (do NOT drift):
//                    Overview     Sky      #0EA5E9  (4 icons)
//                    Capture      Orange   #F97316  (6 icons)
//                    Compliance   Emerald  #10B981  (5 icons)
//                    Register     Indigo   #6366F1  (4 icons)
//                    Settings     Violet   #8B5CF6  (11 icons — split into
//                                                    Access + Data & Automation)
//                    Integrations Amber    #F59E0B  (4 icons)
//                  Lucide-react icons only, tinted per cluster. Each
//                  cluster connects to the hub via ONE quadratic bezier
//                  path — no inter-cluster edges. Static (no zoom /
//                  pan / drag). Icons are clickable and keyboard-
//                  focusable; Enter/Space navigate to the module.
//                  Legacy `/app/settings/program-schematic` route added
//                  as a client-side `<Navigate>` redirect to
//                  `/app/settings/schematic`.
//                  Route contract enforced by new backend pytest
//                  `test_program_schematic_routes_v47.py` — every route
//                  declared in `programSchematic.js` must exist as a
//                  `<Route path>` under `/app/*` in `App.js`.
//                  `lib/programSchematic.js`: `_RAW_EDGES`,
//                  `SCHEMATIC_ZONES`, `SCHEMATIC_EDGES` deleted (dead
//                  after the react-flow retirement; verified via grep
//                  no other file imported them).
// v160.3.9.46 — placeholder marker (pre-schematic session).
export const RUNNING_VERSION = 'paneltec-v160.3.9.47';
