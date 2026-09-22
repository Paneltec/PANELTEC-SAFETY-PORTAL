# v58.13.132km — Shared reference folders visible to workers

## Symptom (from .132km diagnostic)
Stephen previewed the mobile app as "Generic preview user (role only)"
on Paneltec Civil, drilled into `Root > SDS (Safety Data Sheets)`, and
saw **"Empty folder · No documents in this location"** despite the
folder physically containing 238 active SDS PDFs.

## Root cause
`v159.0` hardening set `worker` → `documents: _grant()` (all flags
False) in `permissions.py`. The remaining visibility surface was
`scope_filter(user, "documents")` in `permissions_scope.py`, which
narrows non-privileged reads to:

```python
{"$or": [{"created_by": uid}, {"assignee_id": uid}]}
```

Every SDS file in Paneltec Civil was uploaded by admin Stephen
(`created_by = 808cb7de-...`). A worker's `uid` never equals that
value, and `assignee_id` is unset on shared reference material. Net
result: `list_files` returned `[]` for any non-privileged user on
any admin-populated folder.

This is a **WHS legal-risk regression**. Under **AU WHS Regulation
344** an employer MUST make Safety Data Sheets available to any
worker handling the chemicals covered by the SDS. Hiding them behind
role-narrowing is non-compliant. The regression also affected
Australian Standards, Company Policies, Toolbox Talks, and the
WHS/Environment/Quality/Management procedure sets — every folder in
the org's shared reference library.

## Fix — `shared_reference` flag on `doc_folders`

### 1. Schema
Added optional `shared_reference: bool` field on `doc_folders`
(default `false`). No migration needed for existing rows — the
truthy check treats a missing field as `False`.

### 2. `list_files` short-circuit
`backend/document_library.py::list_files` (line ~1114):

```python
folder = await _resolve_folder(folder_id, user["org_id"])
if folder.get("shared_reference"):
    _scope: dict = {}      # bypass user-level narrowing
else:
    _scope = scope_filter(user, "documents")
    if _scope.get("__scope_no_match__"):
        return []
```

Org-boundary (`org_id`) filter is preserved. Per-record
`category_visible(user, category_id, subject_worker_id)` post-filter
is preserved, so category-level access controls still work on top
of shared folders. `deleted_at:None` filter is preserved.

### 3. Auto-seed migration
New `backend/shared_reference_seed.py` runs on every startup
(idempotent). For every non-deleted `doc_folders` row across all
orgs:

1. Test folder name against `_ALLOW_RE`:
   `sds`, `msds`, `safety data sheet`, `chemical register`,
   `chemicals`, `australian standard`, `standards`, `toolbox talk`,
   `procedure`, `sop`, `standard operating procedure`,
   `emergency procedure`, `code of practice`, `signs`, `signage`,
   `posters`, `warning signs`, `policies`, `whs polic`.
2. Test folder name against `_BLOCK_RE`:
   `induction`, `contract`, `personal`, `payroll`, `medical`,
   `disciplin`, `warning letter`, `performance`, `hr`,
   `human resource`, `confidential`, `signed swms`, `private`.
3. **Blocklist wins** when both match (e.g. hypothetical "SDS
   Inductions" would be blocked, not flagged). Ambiguous cases
   logged as `[migrate-shared-ref] ambiguous_cases=N ...`.
4. Expand each matched folder's descendants via BFS on
   `parent_folder_id` and set `shared_reference:True` on every id
   in the subtree — but **only** on folders that don't already
   carry the flag (never downgrade an admin's explicit toggle).

Startup log emitted per org:
```
[migrate-shared-ref] org=<uuid> seeded=<n> already=<m> subtree=<k> roots=[<names>]
```

### 4. Admin toggle (web UI)
`frontend/src/pages/DocumentLibrary.jsx`:
- **SHARED emerald pill** rendered on card-grid folder tiles that
  carry the flag (visible to everyone — workers can see which
  folders they'll be able to open on mobile Docs).
- **Globe toggle** button in the admin hover-action strip. Emerald
  when ON, greyed when OFF. Click flips the flag via
  `PATCH /api/document-library/folders/{id}` with
  `{shared_reference: bool}`.
- **Confirmation dialog** when toggling OFF a folder with ≥50 files
  — dialog copy calls out the WHS compliance risk for SDS/Chemical
  buckets specifically.
- Optimistic UI with rollback on error.

`frontend/src/pages/DocumentLibraryTree.jsx`:
- SHARED pill added to the default TreeView rows so admins see
  the state at a glance without switching to card mode.

### 5. API endpoint
`PATCH /api/document-library/folders/{id}` accepts
`shared_reference: bool` in body. Gate:
`require_permission("documents", "edit")` + `_require(user,
WRITE_ROLES)` — same admin-tier as the existing rename / recolour /
reparent operations. Returns the updated folder record with
`shared_reference` exposed.

## Verification

### Migration report (boot log)
```
[migrate-shared-ref] org=3116f250-a4eb-43f3-98a5-2a3656d6cb63 seeded=10 already=0 subtree=10 roots=[
  '1. Management & Quality Procedures V10.0 2026',
  '2. Management Policies V11.0 - 2026',
  '3. WHS Procedures V10.0 - 2026',
  '4. Environment Procedures V10.0 - 2026',
  'Australian Standards',
  'Chemical Storage & Handling',
  'Company Policies',
  'Manuals & Procedures',
  'SDS (Safety Data Sheets)',
  'Toolbox Talks'
]
[migrate-shared-ref] org=9a6e2c3d-b887-40c8-bb88-16900b366e1f seeded=6 already=0 subtree=6 roots=[
  'Australian Standards', 'Chemical Storage & Handling', 'Company Policies',
  'Manuals & Procedures', 'SDS (Safety Data Sheets)', 'Toolbox Talks'
]
[migrate-shared-ref] summary: orgs_scanned=2 total_seeded=16
```
On the next boot: `total_seeded=0, already_flagged=10/6` — idempotence confirmed.

### Curl verification (worker preview JWT vs admin)
Preview JWT payload: `{sub:"132km-test-worker", org_id:"3116f250-...",
role:"worker", type:"preview", preview:true, preview_scope:"worker",
exp:+15min}`.

| Case | Folder | Role | Files returned |
|---|---|---|---|
| A | SDS `a386e4a4...` (shared) | worker | **238** ✅ (was 0 pre-.132km) |
| B | Asbestos `bcfc4f84...` (private) | worker | **0** ✅ (worker-scope preserved) |
| C | SDS (non-regression) | admin | **238** ✅ (unchanged) |
| D | `/folders` top-level projection | admin | `shared_reference:true` on 1 top-level (SDS is the only shared TOP-level; others are nested) |
| D2 | `/folders/all` (67 total) | admin | 10 folders with `shared_reference:true` — matches migration report |

### Screenshots (all under `/app/memory/`)
1. `v58_13_132km_worker_sds_populated.jpeg` — synthetic worker JWT +
   phone viewport (390×844) on `/app/document-library/a386e4a4-...`
   → all 238 SDS files rendered. **Fixes the bug reported by Stephen.**
2. `v58_13_132km_web_tree_shared_pills.jpeg` — admin DocumentLibrary
   default TreeView showing the emerald `SHARED` pill next to
   `SDS (Safety Data Sheets)` (238 files).
3. `v58_13_132km_web_card_grid_toggle.jpeg` — filter="sds" activates
   the card-grid render mode → SDS card shows the SHARED pill and
   the admin hover strip surfaces the Globe toggle (emerald when ON).

## Files touched
- `backend/document_library.py` — `list_files` shared-reference
  short-circuit, `_serialise_folder` exposes flag, `list_all_folders`
  projection includes flag, `FolderPatch` accepts flag, PATCH
  endpoint persists it.
- `backend/shared_reference_seed.py` — new file. Idempotent auto-seed
  migration with allow-list, blocklist, blocklist-wins ambiguity
  resolution, recursive descendant expansion, structured log line.
- `backend/server.py` — startup hook calls
  `seed_shared_reference_flags_on_startup()` (best-effort, non-fatal).
- `frontend/src/pages/DocumentLibrary.jsx` — SHARED pill on card
  grid, admin Globe toggle in hover strip, ≥50-file confirm dialog,
  optimistic PATCH handler.
- `frontend/src/pages/DocumentLibraryTree.jsx` — SHARED pill on
  default TreeView rows (visible without switching to card mode).
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132kl → .132km`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped
  `.132kl → .132km`.

## NOT changed
- `/app/mobile/` — untouched. Mobile Docs tab already calls the
  same `GET /api/document-library/folders/{id}/files` endpoint; the
  backend fix picks up automatically with no client changes.
- `permissions.py:256` `"documents": _grant()` for `worker` role —
  **preserved as-is** per user directive. We open the folder-scope
  side (`scope_filter`) not the flag side. The role's declared
  permissions remain locked; the shared-reference flag operates as
  a per-folder override.
- `scope_filter` in `permissions_scope.py` — not touched. Only
  `document_library.py::list_files` reads it, and that callsite now
  branches BEFORE the scope filter runs when the folder is flagged.
  Other consumers (contractors, email_outbox, workers) unaffected.
- Non-privileged branches for `resource in ("workers",
  "hr_employees", "certifications", "contractors", "notifications")`
  — untouched.

## Legal note — AU WHS Regulation 344
> "A person conducting a business or undertaking must ensure that
> the safety data sheet for a hazardous chemical is readily
> accessible to workers involved in using, handling or storing the
> chemical, and to emergency service workers."
> — Model Work Health & Safety Regulations, Reg 344 (Access to safety
> data sheets).

Failing to surface SDS on the mobile Docs tab was a compliance gap.
This ship closes it.

## Follow-up candidates (not in this ship)
1. **Per-role visibility matrix** — some orgs may want to expose
   `Australian Standards` to supervisors only, `SDS` to everyone.
   Would add a `visible_to_roles: list[str]` beside `shared_reference`.
   Not requested today; can be layered on later.
2. **Tree-view toggle in admin actions** — currently the Globe
   toggle lives only in the card-grid render mode. Adding a
   right-click / gear menu affordance on tree rows would let admins
   flip the flag without switching modes.
3. **Preview-mode indicator** — the Live Preview panel could show a
   "N shared folders" chip so admins see the reference-library scope
   before previewing.
4. **Audit trail** — every `shared_reference` toggle should write
   an entry to `doc_files_audit` (or a new `folder_permissions_audit`)
   with `{who, when, folder_id, from, to}` for compliance evidence
   packs.
5. **Auto-seed drift alerts** — if a new folder name is added that
   matches an allow pattern but wasn't yet seeded (created after boot),
   the seeder currently only re-runs at next startup. Consider a
   post-create hook that runs the same allow/block classification on
   folder-creation and folder-rename events.

## Diagnostic recipe (for the next recurrence)
Any admin reporting "worker sees empty folder":

```python
# In a Python shell against the backend DB:
await db.doc_folders.find({
    "org_id": "<org>",
    "name": {"$regex": "sds|standard|policy|procedure", "$options":"i"},
    "$or": [{"shared_reference": False}, {"shared_reference": {"$exists": False}}]
}, {"_id":0, "id":1, "name":1}).to_list(50)
```

If any expected folder is returned, either:
1. Its name didn't match `_ALLOW_RE` (add the pattern), OR
2. Its name matched `_BLOCK_RE` and was correctly excluded (verify
   this is the intended behaviour — some names may legitimately need
   the flag manually toggled), OR
3. An admin explicitly toggled it OFF (check via `updated_at` +
   audit trail).

Fix: PATCH `/api/document-library/folders/{id}` with
`{shared_reference: true}` from any admin session.
