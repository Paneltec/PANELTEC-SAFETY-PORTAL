// Paneltec Civil · v159 — single-source-of-truth version constant
// for the currently running JS bundle.

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
export const RUNNING_VERSION = 'paneltec-v160.3.9.38';
