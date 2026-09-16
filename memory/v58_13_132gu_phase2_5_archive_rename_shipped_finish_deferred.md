# v58.13.132gu — Phase 2.5: Workers "Inactive" → "Archive" rename · SHIPPED (finish deferred)

## Scope

Pure UI-string / icon / tooltip rename for the Workers list.
Underlying DB schema, action codes, and audit-log rows are
**unchanged** so historical rows stay queryable and downstream
analytics don't break. Approved defaults from the user:

* Workers list only — no other module touched.
* "Restore" label kept (reads better in a table action cluster).
* No empty-state copy change (existing empty-state doesn't
  mention "inactive").
* DB action codes preserved; frontend-only display translation
  lives in a new `workerActionLabels.js` helper.

Extra polish from the user's follow-up:

* Row-action tooltip **"Delete" → "Archive"**.
* Icon **trash-can (`Trash2`) → archive-box (`ArchiveIcon` /
  fluentui `Archive20Regular`)**.
* Row-action palette **rose (destructive) → amber (archive)** —
  matches the new "non-destructive lifecycle" semantic + aligns
  with the amber tint convention used by the Expiry chip in
  `.132gt`.
* Inline confirm text **"Delete?" → "Archive?"**.

## Files changed

```
frontend/src/pages/Workers.jsx                                +47 −8
  · Import: Archive20Regular as ArchiveIcon.
  · StatusBadge inactive branch: "Inactive" → "Archived".
  · remove() toast: "removed" → "archived".
  · Inactive-row status pill tooltip: "Soft-deleted"/"Deactivated"
    → "Archived".
  · Show-inactive toggle: label "Show inactive" → "Show archived",
    tooltip "Include soft-deleted…" → "Include archived workers".
  · Row-action button: title "Delete" → "Archive", icon Trash2 →
    ArchiveIcon, palette rose → amber.
  · Inline confirm chip: "Delete?" → "Archive?", palette rose →
    amber.

frontend/src/lib/workerActionLabels.js                        NEW · 60 lines
  · WORKER_ACTION_LABELS map: 8 DB codes → user-visible labels.
  · humaniseWorkerAction() helper for future audit UIs.

backend/tests/test_v58_13_132gu_phase2_5_archive_rename.py    NEW · 12 checks · all green

frontend/src/lib/version.js                                   RUNNING/EXPECTED → .132gu
frontend/public/service-worker.js                             CACHE_VERSION → .132gu
memory/v58_13_132gu_phase2_5_archive_rename_shipped_finish_deferred.md   NEW (this)
```

## Testid stability

All existing testids retained so scripts / Playwright verify
runs / mobile-app selectors don't have to change:

* `worker-inactive` (badge) → still the same testid, only the
  text flipped.
* `show-inactive-toggle` + `show-inactive-checkbox` — retained.
* `delete-<workerId>` (row action button) — retained.
* `delete-confirm-<workerId>` (inline Yes confirm) — retained.

Anyone writing a **new** test after this ship can still use these
identifiers, but they're free to alias them as `archive-*` in
their own scripts.

## Backend NOT touched

Explicit non-goal, pinned by `test_backend_action_codes_not_renamed`:

* `archive_audit.action` codes stay as `soft_deleted` /
  `deactivated` / `restored` / `deleted` — historical audit rows
  remain grep-able.
* No new `"archived"` DB action code introduced (the test
  actively guards against this).
* Frontend renders the new label via `humaniseWorkerAction()`
  only where user-visible.

## Pytest

```
$ pytest backend/tests/test_v58_13_132gu_phase2_5_archive_rename.py -v
12 passed in 0.04s
```

Coverage:

* Row-action button: `title="Archive"` + `<ArchiveIcon/>` + amber
  palette (three checks).
* Inline confirm: "Archive?" wording + amber palette.
* Toggle: "Show archived" label + updated tooltip + no leftover
  "Show inactive" label.
* Status pill tooltip: "Archived" wording, no leftover
  "Soft-deleted" strings.
* Badge: `worker-inactive` testid stable, display text
  "Archived", no leftover "Inactive" display text.
* Toast wording: "archived", not "removed".
* Icon import: fluentui `Archive20Regular` present.
* Translation helper: `humaniseWorkerAction` + `WORKER_ACTION_LABELS`
  export present, all 6 workers-module DB codes covered.
* Backend guard: legacy DB action codes intact, no new
  `"archived"` DB code introduced.
* Version pins on all three canonical files.

## Behavioural / visual verification

Live Playwright hit — login page renders cleanly (no compile
error), footer version pill reads
`paneltec-v160.3.9.58.13.132gu`. Workers page compiles without
Babel/Webpack errors after the edit sequence.

**Ops note:** `/app` volume hit 100 % mid-ship (webpack cache +
automation output). The first attempt at the trash-can → archive
edit truncated `Workers.jsx` at line 2828 (`{o` at end of file)
because the atomic write ran out of disk space. Recovery: `git
checkout` on the file + `rm -rf` on the cache directories, then
re-applied all 5 edits with per-edit `wc -l` sanity checks. The
final file is at 2838 lines with a clean closing `}`. This is
the same regression pattern flagged in `.132gr` / `.132gs` /
`.132gt` ship memos and reinforces the need for the backup
pre-flight disk guard on the follow-up backlog.

## Standing rules honoured

* No `finish`, `testing_agent`, `e1_tester` invoked.
* `/app/mobile/` untouched.
* CRA — no Vite migration.
* Version bumped in `version.js` (RUNNING + EXPECTED) and
  `service-worker.js` (CACHE_VERSION).
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Deferred / follow-ups

* **Phase 3 (Inductions dropdown admin CRUD)** — next up.
* **Phase 4 (bug fixes)** — Pre-start Select-Vehicle dropdown
  empty, SSRAs incorrectly in Risk Assessments tab.
* Retention auto-trigger after each snapshot (`.132gr` backlog).
* **Pre-flight disk-usage guard on backup POST** (`.132gr`) —
  now urgent: this is the third ship in a row where a
  100%-full disk mid-edit truncated a working file. Worth
  pulling forward.

## Message for Stephen

Hard-refresh once `.132gu` is live. On the Workers list:

* The old red **trash-can** on each worker row is now an amber
  **archive-box** icon. Tooltip reads **"Archive"**. Clicking it
  flips to an **"Archive?"** confirm chip; same action —
  soft-deactivates the worker but keeps their full history and
  audit trail intact. Nothing is ever hard-deleted.
* The toolbar checkbox at the top says **"Show archived"**
  (was "Show inactive"). Ticking it re-fetches with
  `?include_inactive=true` and archived rows re-appear with a
  **Restore** button (label kept — reads better than
  "Unarchive").
* The chip on an archived row now reads **"ARCHIVED"** (was
  "INACTIVE").
* Audit exports and historical rows continue to display the
  original DB codes when downloaded, so if you cross-reference
  a Simpro export or an older audit CSV the wording will still
  say "soft_deleted" / "deactivated" — that's intentional so
  historical continuity isn't broken.
