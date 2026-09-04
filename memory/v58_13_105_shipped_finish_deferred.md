# v58.13.105 — Shipped (finish tool deferred) — REDUCED batch

**Status**: SHIPPED. `finish` tool deferred under standing Option A
directive (20 pre-existing `ephemeral-upload-storage` warnings still
parked for v58.14.x).
**Date**: 2026-09-04.
**Ship type**: **Reduced batch** — Items 1 + 2 of the original 4-item
brief shipped; Items 3 + 4 formally deferred by user directive to keep
credits inside a safe envelope. Also deferred: the v58.13.106 Public
Visitor Form feature ship (brief captured for next-session pickup).

---

## Batch state — final

| # | Title | Status |
|---|---|---|
| 1 | PDF blob-helper sweep | ✅ SHIPPED (this ship) |
| 2 | Users & Permissions matrix — `comms_safe_mode.edit` wire-in | ✅ SHIPPED (this ship) |
| 3 | Route-link compile guard | ⏭ DEFERRED → v58.13.106b |
| 4 | Rate-limit test-mode bypass | ⏭ DEFERRED → v58.13.106c |
| — | v58.13.106 Public Visitor Form | ⏭ QUEUED → `/app/memory/v58_13_106_visitor_form_brief.md` |

Rationale for the reduction (verbatim from your directive):
> "Credits are low — if any single item balloons, stop and report
>  rather than sinking the whole batch."
> "You made exactly the right call — thank you for stopping before
>  sinking both ships."

---

## Item 1 — PDF blob-helper sweep

### Root cause reminder
`/api/files/*` endpoints are bearer-gated. `<a href={BACKEND +
file_url} target="_blank">` and `window.open(BACKEND + file_url)` both
issue plain GETs WITHOUT the `Authorization: Bearer <jwt>` header →
401 → blank tab. AuditExports.jsx got its blob-helper fix in .103; this
ship extends it to every remaining site.

### NEW `frontend/src/lib/downloads.js`
Exports `openAuthedFile(fileUrl, filename, opts?)`. Same shape as the
`.103` AuditExports helper, lifted to a shared module. New `opts.mode`
flag: `'blob'` (default — new-tab) or `'download'` (force save-as).
Popup-blocked case degrades gracefully to a synthetic `<a download>`
click. Object URL revoked after 60 s.

### Wire-in — 4 download surfaces (all previously 401'd on click)

| File | Previous pattern | Now |
|---|---|---|
| `AuditExports.jsx` | Local `openAuthedFile` (.103) | Imports the shared helper. No behaviour change; refactor for DRY. |
| `Dashboard.jsx` | `window.open(\`${BACKEND}${data.file_url}\`)` on "Generate PDF audit pack" | `await openAuthedFile(data.file_url, \`${payload.title}.pdf\`)` |
| `Forms.jsx` | Photo grid wrapped in `<a href={${BACKEND}${p.file_url}} target="_blank">` | `<button onClick={() => openAuthedFile(...)}>` with the `<img>` thumb inside (thumb still uses server URL; the click routes through bearer path) |
| `Outbox.jsx` | `<a href={a.file_url}>` on attachment lists (bare URL, current-domain relative) | `<button onClick={() => openAuthedFile(a.file_url, ...)}>` |

New testids: `form-photo-open-{i}`, `outbox-attachment-open-{i}`.
Existing testids on AuditExports.jsx and the Dashboard PDF button
preserved (no e2e breakage).

### Deliberately NOT touched
- `DocumentLibrary.jsx` — already uses bearer-authed `fetch()` +
  blob flow. Correct.
- `Contractors.jsx` — already uses `api.get(..., responseType:
  'blob')`. Correct.
- `BackupTab.jsx` — uses `?token=…` query-string auth. Different
  auth model; its download works. Out of scope.
- `Renewals.jsx` — no file-download surfaces.

---

## Item 2 — Users & Permissions matrix wire-in for `comms_safe_mode.edit`

### Root cause reminder
Backend `PATCH /api/admin/comms-safe-mode` is gated by
`require_permission("comms_safe_mode", "edit")` (v58.13.90). The
override lives at `user_permissions.overrides.comms_safe_mode.edit`.
Pre-.105 there was no UI checkbox — admins had to grant/revoke via
direct API call, which is friction and error-prone.

### `frontend/src/lib/permissions.js`
- Added `RESOURCE_LABELS.comms_safe_mode = 'Comms Safe Mode'`.
- Added `EMAIL_SUPPORTED.comms_safe_mode = false`.
- Added `DELETE_SUPPORTED.comms_safe_mode = false`.
- Added `TEAM_VIEW_SUPPORTED.comms_safe_mode = false`.
- NEW `OPEN_VIEW_SUPPORTED` map — `comms_safe_mode: false`, every
  other existing resource `true`. Some resources only have a
  meaningful `edit` action; the matrix now has a way to render "—"
  for their `open` / `view` columns too.

### `frontend/src/pages/UsersManagement.jsx`
- Imports the two additional support maps.
- Widened the `supported` computation to consult all four maps
  (email, team_view, delete, open/view) with `!== false` semantics
  so unmapped resources continue to render supported=true. Every
  existing row still behaves identically; only `comms_safe_mode`
  gains the "—" rendering on non-applicable columns.

### Result
The `comms_safe_mode` row shows exactly ONE clickable checkbox
cell (`edit`) with all other columns rendered as "—". Admins can
grant / revoke the override in one click. Backend endpoint from
.90 handles the actual permission mutation.

---

## Tests

NEW `tests/backend_unit/test_batch_reduced_v58_13_105.py` — **17
source-pin tests**:
- Item 1: `downloads.js` module exists + exports helper; api.get
  blob call + `/api` strip; AuditExports imports shared (and no
  longer defines locally); Dashboard/Forms/Outbox all import; regression
  guards for the specific pre-.105 bug patterns (bare
  `window.open(${BACKEND}${…file_url})`, bare `<a href={a.file_url}>`,
  bare `<a href={${BACKEND}${p.file_url}}>`).
- Item 2: RESOURCE_LABELS carries `comms_safe_mode`; all four support
  maps carry `false`; new `OPEN_VIEW_SUPPORTED` export; UsersManagement
  `supported` gate exact expression pin; UsersManagement imports
  DELETE_SUPPORTED + OPEN_VIEW_SUPPORTED.
- Version-sync forward-safe pins ≥ 105.

Also updated `tests/backend_unit/test_purge_widened_patterns_v58_13_103.py`
to look for `openAuthedFile` in the new shared location. Prior tests
source-scanned AuditExports.jsx; now they source-scan
`lib/downloads.js` + confirm AuditExports imports it. No test coverage
lost.

**Full pytest suite: 696 passed, 1 skipped, 0 regressions** (was 679
at .104 baseline. Delta +17 matches the new .105 tests exactly.)
Webpack: compiled with 110 pre-existing warnings, none from touched
files.

Aside — the 60 s rate-limit cool-off between full-suite runs is
still needed until Item 4 (v58.13.106c) ships. Documented so future
runs know the pattern; not a regression.

---

## Version bumps (all 3 canonical strings → `paneltec-v160.3.9.58.13.105`)

- `frontend/src/lib/version.js#RUNNING_VERSION` (+ full changelog
  block prepended above the export line).
- `frontend/public/service-worker.js#CACHE_VERSION`.
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION`.

---

## NOT changed (deferred per user directive)

- **Item 3 · Route-link compile guard** — deferred to v58.13.106b.
- **Item 4 · Rate-limit test-mode bypass** — deferred to v58.13.106c.
  Recommendation: ship .106c FIRST next session — it's tiny (one env
  var + one `Limiter(enabled=…)` param) and unblocks full-suite runs
  from the 60 s cool-off.
- **v58.13.106 Public Visitor Form** — full brief captured verbatim at
  `/app/memory/v58_13_106_visitor_form_brief.md`. Includes pre-.106
  dependency notes (permission-matrix pattern, QR-URL migration
  strategy).
- **Backend code** — no server-side changes this ship.
- **`/app/mobile/`** — only `MOBILE_BUNDLE_VERSION` bumped.
- **20 pre-existing `ephemeral-upload-storage` warnings** — still
  parked for v58.14.x object-storage migration.

---

## Rollout plan

- **PREVIEW**: JSX + version bump changes live via hot-reload. SW
  cache version rolled to `.105`. Next full page load serves the
  fresh bundle. No backend restart (no backend changes).
- **PROD**: user Re-publishes `.105` when convenient. Prod already
  has all four bearer-authed endpoints in place from prior ships;
  this ship is a client-side hardening + a new admin-UI affordance.
  Risk: minimal.

## Standing by
- User's call whether to green-light v58.13.106 in the next session.
- Recommendation: ship `.106c` (rate-limit bypass) FIRST — tiny,
  unblocks test-suite ergonomics. Then `.106b` (route-link guard),
  then `.106` proper.

## Roadmap still queued (unchanged)
- P1: Decide whether to create the ~104 missing asset records for
  the 346 orphan maintenance rows.
- P2: Relabel/behaviour change on "Clear Blocked Outbox" (F4).
- P3: Rename `plant_maintenance.registration_matched` (F1).
- Future: v58.14.x object-storage migration — unblocks `finish` tool.
