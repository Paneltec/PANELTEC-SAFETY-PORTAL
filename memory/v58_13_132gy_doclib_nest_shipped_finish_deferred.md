# v58.13.132gy — Doc Library restructure (backend nest) · SHIPPED (finish deferred)

## Scope

Backend half of the Compliance/Document Library nested-tree
restructure approved in the survey/plan reply. Data-only migration
(no schema change — `parent_folder_id` already existed). Creates
the 12 seed parents and nests the existing 51 flat folders
underneath. Idempotent; auto-runs on every `GET /folders` for
fresh orgs so new tenants get the tree without any admin action.

FE tree UI (`.132gz`) is the follow-up. This ship gives admins a
minimal parent-picker on the folder-create form so new folders
can be nested straight away.

## Files changed

```
backend/document_library.py                          +330 −25
  · DEFAULT_FOLDER_TREE structure (7 top-level + 6 sub-parents).
  · IMS_LEAF_PATTERNS regex for `0.IMS Index` / numbered / SWMS-CURRENT.
  · TREE_PARENT_NAMES set + LEAF_TO_PARENT flat map.
  · _compute_reorganise_diff / _apply_reorganise / _ensure_tree_structure.
  · POST /reorganise (dry_run=true|false, admin-only).
  · GET /folders/all (flat list for FE picker, roots+subs+leaves).
  · FolderIn / FolderPatch now accept parent_folder_id.
  · create_folder persists parent_folder_id (validated).
  · rename_folder accepts parent_folder_id with cycle check +
    "-" sentinel meaning "detach to root".
  · list_folders auto-applies the tree on first call per org.

frontend/src/pages/DocumentLibrary.jsx               +55 −5
  · Admin-only parent picker on the folder-create form.
  · Lazy-loads /folders/all on first open.
  · Renders path breadcrumbs ("Compliance & Safety › Risk & Hazard").

backend/tests/test_v58_13_132gy_doclib_nest.py       NEW · 12 checks · all green

frontend/src/lib/version.js                          RUNNING/EXPECTED → .132gy
frontend/public/service-worker.js                    CACHE_VERSION → .132gy
memory/v58_13_132gy_doclib_nest_shipped_finish_deferred.md   NEW (this)
```

## Migration outcome on Stephen's org

Before: **51 flat root folders** (43 seed + 8 user-added IMS).
After: **9 root folders**.

```
Root folders (post-migration):
  · Administration                          (5 subs)
  · Archives                                (0)
  · Compliance & Safety                     (6 subs — WHS Framework,
                                             Risk & Hazard, Site Ops,
                                             Environmental, Incidents,
                                             Audits & Inspections)
  · Equipment & Assets                      (1 sub — Calibration Certs)
  · IMS (Integrated Management System)      (8 subs — 0.IMS Index,
                                             1..6 numbered, SWMS-CURRENT)
  · SDS (Safety Data Sheets)                (312 files — kept flat)
  · Training & Competency                   (7 subs)
  · Uncategorised                           (system, kept)
  · Work                                    (empty — user seeds)
```

Zero file moves. All 700 files still live in their original folder
UUIDs, so every existing PDF permalink / backup-snapshot reference
resolves unchanged. Just `parent_folder_id` mutated on the folder
rows themselves.

## Backend API

```
POST /api/document-library/reorganise?dry_run=true
  → 200 { parents_to_create: [names…],
          reparents: [{id, name, current_parent, target_parent_name}],
          skipped: [names…],
          counts: {parents_to_create, reparents, skipped} }

POST /api/document-library/reorganise?dry_run=false
  → 200 { parents_created, reparented, skipped }
  Admin-only. Idempotent — re-run is a no-op.

GET /api/document-library/folders/all
  → 200 [{ id, name, parent_folder_id, is_system } …]
  Any authenticated user. Powers the FE parent picker.

POST /api/document-library/folders
  Body now accepts optional parent_folder_id.
  · "" or "-" or missing → root.
  · Any other → validated same-org, non-deleted parent.

PATCH /api/document-library/folders/{id}
  Body now accepts optional parent_folder_id.
  · "-" → detach to root.
  · Any other → cycle-checked reparent.
  · Self-parent explicitly blocked (400).
  · Cycle attempt blocked (400) — target-parent-is-descendant.
```

## Live verification (this pod)

```
$ POST /reorganise?dry_run=true         → 13 parents, 48 reparents pending
$ POST /reorganise?dry_run=false        → 13 parents_created, 48 reparented, 4 skipped
$ POST /reorganise?dry_run=true         → 0 pending (idempotent ✓)
$ GET  /folders                         → 9 root folders (was 51)
$ GET  /folders/all                     → 65 folders total (flat)
```

## Pytest

```
$ pytest backend/tests/test_v58_13_132gy_doclib_nest.py -v
12 passed in 3.63s
```

Coverage: source pins for all new helpers + endpoints + Pydantic
fields; cycle-check pin; FE parent-picker testid + admin gate;
behavioural dry-run/apply/idempotency; tree-parents-at-root;
historic-leaves-not-at-root regression pin; `/folders/all` shape;
create-with-parent; PATCH reparent + cycle-block + self-parent
block + "-" sentinel detach; auth gate on `/reorganise`; version
pins.

## Standing rules honoured

* No `finish` / `testing_agent` / `e1_tester` invoked.
* `/app/mobile/` untouched.
* CRA — no Vite migration.
* Version bumped in all three canonical files.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Ops

Disk housekeeping done pre-ship: `/app` went from **97 %** used
(343 MB free) → **91 %** (969 MB free) via webpack-cache purge +
old-snapshot sweep. Backup pre-flight guard from `.132gw` remains
active as a safety net.

## Deferred / follow-ups

* **`.132gz` — FE tree UI**: collapsible tree view (chevron per
  parent), breadcrumb navigation, drag-and-drop reparenting for
  admins, per-parent file counts rolled up. Bigger UX ship —
  handing back before starting per user's ask.
* Existing latent bugs still parked (SWMS emergency-procedure
  leak, unmatched-template import, empty pre-starts view) —
  awaiting user data.

## Message for Stephen

Hard-refresh once `.132gy` is live. The Document Library will show
**9 top-level folders** instead of 51. Every previous folder still
exists — they're just nested underneath the appropriate parent
(WHS Framework, Risk & Hazard, Training & Competency, etc.).

**SDS (Safety Data Sheets)** and the IMS-numbered folders stay
one click deep at the top level so your daily-use surface doesn't
suffer.

Every file link, upload path, backup snapshot, and search filter
still works — nothing moved, only the folder metadata was
reparented.

To create a new folder under a specific parent (e.g. a new
`Traffic Management` sub-topic), click **New folder**, type the
name, then pick the parent from the new **"Nest under:"**
dropdown. Admin-only.

If the current groupings don't feel right (e.g. you want `Plant
& Equipment` under `Equipment & Assets` instead of `Site
Operations`), let me know — one line change in the `LEAF_TO_PARENT`
map + a re-run of `/reorganise` and it moves. The 12 seed groupings
are opinionated defaults, not locked-in schema.

The **tree UI** (collapsible chevrons, breadcrumb nav,
drag-and-drop) lands in `.132gz` — today's ship gives you the
data shape and the parent picker; the visual tree lands next.
