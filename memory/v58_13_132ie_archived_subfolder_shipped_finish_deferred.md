# v58.13.132ie — Archived subfolder on worker cert-family tabs · SHIPPED (finish deferred)

**Ship phase:** `.132ie`
**Scope (this ship):** Cert-family tabs only — Certifications (embedded in Workers.jsx), Licences, Inductions. Each tab now splits rows into Active + Archived buckets, with the Archived section rendered as a collapsible drawer pinned to the bottom of the tab.
**Scope split:** User pre-approved the split. HR Documents / Discovered Documents / Compliance folders queued for `.132if` (they don't share the `worker_certifications` collection or the expiry-based auto-archive semantics).

## What shipped

### 1. Backend — `worker_certifications.py`

- **Auto-archive-on-fetch sweep** inside `GET /workers/{id}/certifications`. Before the list query fires, a single `update_many` flips every row where `expiry_date < today AND archived_at IS NULL AND deleted_at IS NULL` to `archived_at = now(), archived_reason = 'auto_expired'`. Idempotent: second run matches 0 docs. Scoped to `(org_id, worker_id)` so the write blast radius is bounded per request. Cheaper than a cron + no scheduler dependency.
- **Manual `POST /workers/certifications/{cert_id}/archive`**: flips `archived_at = now(), archived_reason = 'manual', archived_by = user.id`. Idempotent (re-archive refreshes timestamp).
- **`POST /workers/certifications/{cert_id}/restore`**: clears `archived_at`, `archived_reason`, `archived_by`. Row keeps its `expiry_date` — a restored-then-expired row will re-archive on next list fetch unless the user also updates the expiry.
- **Semantic separation from `deleted_at`**:
  - `deleted_at` → soft-delete, 30-day audit trail, hidden by default, restored via archive dialog. Unchanged.
  - `archived_at` → "expired but preserved", surfaced in the collapsible Archived section, restored in-place.
- Both new endpoints share `_archive_gate(cert_id, user)` — common scope + existence check that raises 404 on scope-miss (no existence leak) and 404 on missing.
- Both go through `require_permission("certifications", "edit")`.

### 2. Frontend — shared helpers (`src/lib/certArchiveHelpers.js`)

- `splitByArchived(rows) → { active, archived }` — order-preserving partition.
- `useArchivedOpen(panel, workerId)` — localStorage-persisted `[open, toggle]` under key `paneltec:archive:open:<panel>:<workerId>`. **Default: closed**, so the Archived accordion is a bottom drawer that appears when there's something to reveal.
- `archiveCert(cert, onDone)` / `restoreCert(cert, onDone)` — single-shot POSTs with shared toast + error path.

### 3. Frontend — three cert-family panels

Each panel now:
1. Imports the shared helpers.
2. Filters the main table to `active` rows only via `splitByArchived`.
3. Adds a per-row **Archive** button (`slate-100` bg + `Archive` icon) between Edit and Delete on active rows.
4. Renders a **collapsible "Archived" accordion** below the main table when at least one archived row exists. Header shows `Archived · N` count and an explanatory chip `(expired inductions/licences/certifications kept for compliance audit)`. Body is a lighter-toned table (opacity-75) with per-row **Restore** (`emerald-50` bg + `RotateCcw` icon) and Delete actions.
5. Only ACTIVE rows count toward the header summary pills (total / expired / expiring / valid / missing).

Panels touched:
- `frontend/src/pages/Workers.jsx::CertificationsPanel` — testids `section-certifications-archived`, `cert-archive-{id}`, `cert-restore-{id}`.
- `frontend/src/components/workers/LicencesPanel.jsx` — testids `section-licences-archived`, `licence-archive-{id}`, `licence-restore-{id}`.
- `frontend/src/components/workers/InductionsPanel.jsx` — testids `section-inductions-archived`, `induction-archive-{id}`, `induction-restore-{id}`.

## Deferred to `.132if` (user pre-approved)

- **HR Documents (Private & Confidential)** — collection is `worker_hr_documents`, no `expiry_date` field, so the auto-archive-on-expiry semantic doesn't apply. Manual archive-only + row action mirrors need a small collection migration.
- **Discovered Documents** — same reason (no expiry field).
- **Compliance folders (Doc Library)**: SDS, Licences & Tickets folder, any other compliance folder where docs have expiries. Needs a new folder-level `archived_docs` view + a batch expiry sweep.

## Version pin
- `RUNNING_VERSION` → `paneltec-v160.3.9.58.13.132ie`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132ie`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132ie`

## Pytest coverage (8 checks)
- `test_backend_worker_certifications_has_auto_archive_sweep` — sweep block present + correct filter.
- `test_backend_archive_and_restore_endpoints_present` — both routes + shared gate + permissions.
- `test_shared_archive_helpers_exported` — all 4 named exports + localStorage key format.
- `test_licences_panel_has_archived_split_and_action_testids` — 3 section testids + 2 row testids.
- `test_inductions_panel_has_archived_split_and_action_testids` — same shape.
- `test_certifications_panel_in_workers_page_has_archived_accordion` — hook wired + testids + active-only filter on main table.
- `test_archive_restore_and_auto_archive_roundtrip` — **behavioural**: seed 4 certs (fresh / expired-unarchived / expired-already-archived / manual-archived) → GET fires auto-archive on the expired-unarchived row only → POST archive on the fresh row → POST restore on the manually-archived row. Verifies all 3 flows against the real router + auth stack (deps overridden for auth + module gate + scope gate + `can()`).
- `test_version_pin_v132ie` — three-string lockstep.

## Live verification
- Version pill on Workers page shows `v160.3.9.58.13.132ie` ✓
- Backend endpoints registered + healthy post-restart (no supervisor errors).

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish`.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Next action items
- **Ship `.132if`** — Archived subfolder for HR Documents / Discovered Documents / Doc Library compliance folders (SDS + Licences & Tickets + any other expiry-bearing folder). Needs backend collection migrations (add `archived_at` field) and folder-level archived view.
- **Mobile parity backlog** (Expo specialist): expose Archive/Restore actions on the mobile cert list; mirror the collapsible bottom drawer.
