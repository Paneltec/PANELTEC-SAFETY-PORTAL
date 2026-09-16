# v58.13.132gt — Phase 2: SDS module enhancements · SHIPPED (finish deferred)

## Scope

Phase 2 of the 4-phase office-staff enhancement brief. Four
enhancements on the Document Library file surface (which is where
SDS lives — as the "SDS (Safety Data Sheets)" folder, one of 46
seeded default folders). Because these live at the `doc_files`
schema level, the same UX applies to every file in every folder
(cert PDFs in Licences, calibration proofs, etc.) — not just SDS —
which is what Stephen actually needs.

1. **Delete** — already existed at `.132fj` as a soft-delete with
   30-day archive-audit trail. No change needed.
2. **Rename** — NEW. `PATCH /api/document-library/files/{file_id}`
   accepts `filename`. Extension changes are blocked (defence
   against `.exe` or script uploads slipping through the display).
   Backend validates BOTH the parsed `_safe_ext` result AND the raw
   `Path.suffix` so a disallowed extension (which `_safe_ext`
   returns `""` for) still hits the "Cannot change file extension"
   error path rather than being auto-appended silently.
3. **Expiry Date** — NEW field on `doc_files`. Same PATCH endpoint
   accepts `expiry_date` (ISO 8601 `YYYY-MM-DD`) or
   `clear_expiry: true`. Row-level tint rose ≤0 / amber ≤30d,
   matching the Equipment Register convention (`.132gl-b`).
4. **Sort / filter** — NEW toolbar on the folder-detail view.
   Six sort options (uploaded / name / expiry, each both
   directions) + five expiry filters (All · Expired · Expiring
   ≤30d · Has expiry · No expiry). Client-side over the fetched
   file list — respects the existing group-by-IMS-NN/AI-tag
   layout by feeding sorted-and-filtered rows into
   `groupFilesForDisplay`.

## Files changed

```
backend/document_library.py                                +75 −5
  · _serialise_file now exposes expiry_date + updated_at.
  · New FilePatch model + PATCH /files/{file_id} endpoint.
  · Extension guard consults raw Path.suffix (defence in depth).

backend/tests/test_v58_13_132gt_phase2_sds.py              NEW · 10 checks · all green

frontend/src/pages/DocumentLibrary.jsx                     +200 −20
  · Module-scope helpers: docDaysUntil, docExpiryTint,
    DOC_SORT_OPTIONS, DOC_EXPIRY_FILTERS, applyDocSortFilter.
  · FileEditModal component (rename + expiry + clear).
  · Sort/filter toolbar next to the folder search input.
  · Expiry column with rose/amber chip + row-border override.
  · Pencil (Edit) button per row alongside the existing
    view / download / delete cluster.

frontend/src/lib/version.js                                RUNNING/EXPECTED → .132gt
frontend/public/service-worker.js                          CACHE_VERSION → .132gt
memory/v58_13_132gt_phase2_sds_shipped_finish_deferred.md  NEW (this)
```

## Backend API (delta)

```
PATCH /api/document-library/files/{file_id}
  Body: {
    filename?: string        # extension must match; auto-appends if missing
    expiry_date?: string     # ISO 8601 YYYY-MM-DD
    clear_expiry?: bool      # explicit unset
  }
  → 200 { …updated file …expiry_date …updated_at }
  Errors:
    · 400 "Filename cannot be empty"
    · 400 "Cannot change file extension"
    · 400 "expiry_date must be ISO-8601 (YYYY-MM-DD)"
    · 400 "Nothing to update"
    · 404 "File not found"
```

Gate: `require_permission("documents", "edit")` + role in
`WRITE_ROLES = {"admin", "hseq_lead"}`.

## Pytest

```
$ pytest backend/tests/test_v58_13_132gt_phase2_sds.py -v
10 passed in 19.97s
```

Coverage:

* Backend PATCH endpoint decorator, model shape, error branches
  (extension change / bad ISO / empty patch / missing file).
* `_serialise_file` exposes `expiry_date` + `updated_at`.
* Frontend module-scope helpers (`docDaysUntil`, `docExpiryTint`,
  `DOC_SORT_OPTIONS`, `DOC_EXPIRY_FILTERS`, `applyDocSortFilter`,
  `FileEditModal`).
* Static testids: sort/filter toolbar + FileEditModal controls.
* Dynamic testids: `file-edit-${id}`, `file-expiry-cell-${id}`,
  `file-expiry-chip-${id}`.
* Sort/filter is wired into the actual list-render call site
  (`applyDocSortFilter(files, { sortKey, expiryFilter })`).
* Row border consults the expiry-aware `borderColor` variable,
  not the group palette directly, so expired rows override the
  IMS/AI-tag group stripe.
* Frontend calls `PATCH /document-library/files/${file.id}`.
* Behavioural round-trip against live backend: rename same-ext
  (200), set expiry (200), clear_expiry (200 + null), bad ISO
  (400), extension-change (400), empty patch (400), missing file
  (404).
* Anonymous PATCH → 401/403.
* Version pinned in all three canonical files.

## Behavioural / visual verification

Live Playwright hit against
`https://whs-compliance.preview.emergentagent.com/app/document-library/<sds-folder>`:

* Sort/filter toolbar renders (testids `folder-sort-select`,
  `folder-expiry-filter-select`).
* Expiry column rendered in the file table alongside Uploaded By /
  Uploaded / AI Tags.
* Sidebar version pill reads **v160.3.9.58.13.132gt**.
* Existing files show `—` under Expiry (no expiry set yet); new
  chip tinting kicks in as soon as an admin uses the pencil to
  set a date.

## Ops notes

* `/app` volume hit 100 % again mid-ship (webpack cache + Playwright
  automation output). Cleared `/app/frontend/node_modules/.cache`
  and `/root/.emergent/automation_output/*` → dropped to 82 %.
  Follow-up backlog item from `.132gr` (retention auto-trigger
  after each backup snapshot + pre-flight disk guard on backup POST)
  is still open — worth prioritising after Phase 4.

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester` invoked.
* `/app/mobile/` untouched.
* CRA — no Vite migration.
* Version bumped in `version.js` (RUNNING + EXPECTED) and
  `service-worker.js` (CACHE_VERSION).
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Deferred / follow-ups

* **Phase 2.5 (Workers wording rename "Inactive" → "Archive")** —
  queued for `.132gu`. Pure UI-string rename, no schema change:
  "Mark inactive" → "Archive", "Show inactive" → "Show archived",
  "Restore" stays. Underlying `active: false` + `deleted_at` /
  `deactivated_at` fields kept intact so existing audit-log rows
  and backend logic remain valid.
* **Phase 3 (Inductions dropdown admin CRUD)** — after 2.5.
* **Phase 4 (bug fixes)** — Pre-start Select-Vehicle dropdown
  empty, SSRAs incorrectly in Risk Assessments tab.
* Retention auto-trigger after each snapshot (from `.132gr`).
* Pre-flight disk-usage guard on backup POST (from `.132gr`).

## Message for Stephen

Hard-refresh once `.132gt` is live. Inside any Document Library
folder (SDS or otherwise):

1. New toolbar at the top: **Sort** dropdown (by upload date /
   name / expiry) + **Show** dropdown (all / expired / expiring
   ≤30 days / has expiry / no expiry).
2. New **Expiry** column between Uploaded and AI Tags. When a file
   has an expiry, the row shows a coloured chip (amber ≤30 days,
   rose overdue) and the row's left border matches. Files without
   an expiry render `—`.
3. New **pencil** icon on each row → opens a small modal to rename
   the file (extension is locked to prevent .exe / script drift)
   and set/clear an expiry date. Same trash icon still soft-deletes
   with the 30-day archive recovery window.
