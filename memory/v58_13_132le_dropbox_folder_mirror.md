# v58.13.132le — Dropbox integration Phase 1: folder tree mirror

Shipped: 2026-09-23
Scope: backend (`dropbox_folder_mirror.py` new, `integrations_dropbox.py` extended, CLI script new, `server.py` unchanged — router already mounted from `.132lb`) + version bumps
Author: agent

---

## Brief

Mirror the FULL folder tree of `/Paneltec-General Administration` from Dropbox into the app's `doc_folders` collection. Folder structure only — no file bytes (Phase 2). Idempotent, admin-only default access, safe to re-run.

## What shipped

### Core engine — `backend/dropbox_folder_mirror.py` (new)

- `run_mirror(dry_run, on_progress, org_id)` → summary dict.
- `ensure_indexes()` — creates 3 idempotent Mongo indexes:
  - `doc_folders_dropbox_folder_id` (org_id, dropbox_folder_id) sparse
  - `doc_folders_dropbox_path_lower` (org_id, dropbox_path_lower) sparse
  - `doc_folders_source` (org_id, source) sparse
- Recursive walk via `/2/files/list_folder(recursive=true)` at the account's root namespace path `/Paneltec-General Administration`. Single logical call with cursor pagination.
- **Async-safe**: every blocking Dropbox SDK call is wrapped in `asyncio.to_thread` so the event loop stays responsive when the mirror runs alongside live HTTP traffic. Verified `/api/health` returns in 136 ms while a 210-second walk is in flight.
- **Idempotent upsert** keyed on `dropbox_folder_id`:
  - existing row → UPDATE (name, parent, path, `dropbox_last_seen_at`, `updated_at`, `deleted_at=null` for revive).
  - new row → INSERT with `source=dropbox`, `shared_reference=false`, slug-normalised name.
- **Parent lookup** via in-memory `path_to_id` seeded on the anchor row + fallback to Mongo `dropbox_path_lower` for re-runs where children are seen before parents (belt-and-braces).
- **Depth-sorted walk order** — parents always land before children.
- **Stale drift detector** — counts rows with `dropbox_last_seen_at` older than the run start; non-destructive. Phase 3 webhook logic will act on these.
- **Slug helper** — strips apostrophes (straight + curly), spaces → hyphens, lowercase, collapses runs of separators. Handles Dropbox quirks (`Employee's`, `Stormy's folder`, `Patricks Folder`).

### CLI — `backend/scripts/dropbox_phase1_mirror.py` (new)

```
python backend/scripts/dropbox_phase1_mirror.py --dry-run
python backend/scripts/dropbox_phase1_mirror.py
python backend/scripts/dropbox_phase1_mirror.py --json
```

### Admin endpoints (added to `integrations_dropbox.py`)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/dropbox/mirror-run` | admin | Fire-and-forget async trigger, returns `{job_id, status: started, dry_run}`. Optional body: `{"dry_run": true}`. **409** if a job is already running (single-flight guard via `asyncio.Lock` + status scan of the ring buffer). |
| `GET /api/dropbox/mirror-status/{job_id}` | admin | Poll live progress: `{status, walk, progress, summary, error}`. |
| `GET /api/dropbox/mirror-jobs` | admin | Ring buffer of the last 8 jobs, most-recent last. |

Jobs live in an in-process `Dict[str, Dict]` bounded by a `deque(maxlen=8)`. A supervisor restart loses in-flight jobs — the mirror is idempotent so a re-fire is the recovery. Migrate to Mongo (`dropbox_mirror_jobs`) if we ever go multi-worker.

### Access control

**All mirrored folders default to `shared_reference: false`** — admin-only visibility. Protects `Customers`, `Employee's`, `Truck & Vehicle Finance Documents 2021`, etc. from being auto-shared with 69 workers.

Admin can flip per-folder via the existing `.132km` toggle in the Documents UI (already wired). Phase 4 will handle proper Dropbox → app permission mapping for bulk flips.

## Verification

### Dry-run

```
[walk]   folders_seen=15049
[upsert] progress logged every 50 folders
[done]   created=15048 updated=0 skipped_missing_parent=1 max_depth=16 elapsed=237.9s

SUMMARY (dry_run=True):
  team_folder_id           = 5079287136
  folders_seen             = 15049
  created                  = 15048   (would-create, no writes)
  updated                  = 0
  skipped_missing_parent   = 1
  max_depth                = 16
```

### Real run

```
SUMMARY (dry_run=False):
  team_folder_id           = 5079287136
  folders_seen             = 15049
  created                  = 15048
  updated                  = 0
  skipped_missing_parent   = 1
  max_depth                = 16
  elapsed_s                = 225.7
```

### Idempotence re-run

```
SUMMARY (dry_run=False, second invocation):
  folders_seen             = 15049
  created                  = 0       ← zero new folders
  updated                  = 15048   ← every existing row refreshed
  skipped_missing_parent   = 1
  elapsed_s                = 270.3
```

### Async endpoint via HTTP

```
POST /api/dropbox/mirror-run {"dry_run":true}
  → 200 {"job_id":"mirror-23e3abf1a4c2","status":"started","dry_run":true}

POST /api/dropbox/mirror-run {}   (while first running)
  → 409 {"detail":{"error":"mirror job already running","job_id":"mirror-23e3abf1a4c2",...}}

GET /api/dropbox/mirror-status/mirror-23e3abf1a4c2
  → 200 {status: running → completed}
  Final: created=0 updated=15048 folders_seen=15049 elapsed=210.9s

GET /api/health  (during mirror)
  → 200 in 136 ms  ← event loop unblocked
```

### Mongo state (post-mirror)

```
org_id = 3116f250-a4eb-43f3-98a5-2a3656d6cb63

total doc_folders:          15,117
  source=dropbox:           15,049
  other/pre-existing:           68

shared_reference on dropbox folders:
  True  = 0   ← default enforced
  False = 15,049

Pre-existing folders (non-regression):
  SDS (Safety Data Sheets)   shared=True   (unchanged)
  Uncategorised              is_system=True (unchanged)
  Administration             is_system=False (unchanged)
  Compliance & Safety        is_system=False (unchanged)
  Work / Training / IMS / Archives / Equipment & Assets  — all present

Indexes created:
  doc_folders_dropbox_folder_id
  doc_folders_dropbox_path_lower
  doc_folders_source
```

### 10 sample mirrored folders

```
/Paneltec-General Administration                              slug=paneltec-general-administration
/Paneltec-General Administration/Amandas Folder               slug=amandas-folder
/Paneltec-General Administration/Amandas Folder/30 REMOUNT ROAD DOCUMENTS   slug=30-remount-road-documents
/Paneltec-General Administration/Amandas Folder/30 REMOUNT ROAD DOCUMENTS/Invoices   slug=invoices
/Paneltec-General Administration/Amandas Folder/30 REMOUNT ROAD DOCUMENTS/Peltzer    slug=peltzer
/Paneltec-General Administration/Amandas Folder/30 REMOUNT ROAD DOCUMENTS/Soil Report  slug=soil-report
/Paneltec-General Administration/Amandas Folder/Amanda        slug=amanda
/Paneltec-General Administration/Amandas Folder/Building & Construction Award - Pay Rates 2023   slug=building-construction-award-pay-rates-2023
/Paneltec-General Administration/Amandas Folder/DESKTOP       slug=desktop
/Paneltec-General Administration/Amandas Folder/DESKTOP/68 Victoria St   slug=68-victoria-st
```

All rows have `shared_reference=false`, `source="dropbox"`, unique-per-Dropbox-folder-id UUID `id`.

### Documents UI screenshot

`/app/document-library` header counter now reads **`15117 folders`** (was 68 pre-mirror). Filtering the tree by `Paneltec-General` shows the anchor folder card as expected.

## Surprise vs the `.132lb` projection

The Phase 0 audit projected **~1,447 folders** based on top-2-level counts plus a 3-random-subtree recursive sample. The full recursive walk revealed **15,049 folders** — 10× the projection.

**Root cause:** Three subtrees contain full Windows filesystem dumps nested up to 15 levels deep:

- `/Paneltec-General Administration/CCTV/Jago Crt/Temby Civil - Jago Court Legana …/DISK1/System/ProgramFiles/CDLAB/Assemblies/libvlc/win-x86/locale/<41 locale dirs>/LC_MESSAGES`
- `/Paneltec-General Administration/General Administration/Viatec Traffic Solutions/Bevs PC Backup June 2020/Viatec Old files - 15 06 2020/WINDOWS/Users/<Beverley|Norm>/AppData/{Local,Roaming}/Microsoft/…`
- `/Paneltec-General Administration/Customers/CCTV/Taswater - … CCTV Investigation …/DISK1/System/{ProgramData,ProgramFiles}/CDLAB/…`

The `.132lb` random sample (seed=42) landed on three shallow (< 1 MB) Risk & Compliance / Customers subtrees, so it couldn't have caught this. **No corrective action needed for Phase 1** — the mirror faithfully replicates what's in Dropbox as briefed. Recommendations for Phase 2 documented below.

## Recommendations for Phase 2

Before bytes-mirroring lands, consider excluding or handling these three CCTV/backup dumps specially:

1. **`Bevs PC Backup June 2020`** — a full Windows user profile from 2020. Almost certainly zero business value in mirroring 8k+ AppData cache subfolders + files into GridFS/NAS. Recommend archiving / soft-hiding the whole subtree.
2. **CCTV `/DISK1/System/…` dumps** — vendor CCTV export software (`CDLAB`) dumps its own installer files + libvlc translations alongside the actual footage. The footage itself is what we want mirrored, not the accompanying `Program Files` dump.
3. **Depth cap** — an optional `--max-depth` argument for the mirror script would let us clip these outlier subtrees while still mirroring everything else. Deferred for user's call.

Suggested next step: user reviews the mirrored tree in `/app/document-library`, flags any subtrees to prune, then Phase 2 (file bytes) proceeds with a NAS-first approach and an explicit include/exclude list.

## Files touched

```
backend/dropbox_folder_mirror.py                          (new)
backend/integrations_dropbox.py                           (mirror endpoints)
backend/scripts/dropbox_phase1_mirror.py                  (new — CLI)
frontend/src/lib/version.js                               (.132ld → .132le + ship header)
frontend/public/service-worker.js                         (.132ld → .132le)
memory/v58_13_132le_dropbox_folder_mirror.md              (this memo)
```

## NOT touched

- `doc_files` — zero writes (Phase 2 only).
- No file bytes downloaded from Dropbox.
- No `shared_reference=true` auto-set on any mirrored folder.
- Pre-existing folders (SDS, IMS, Uncategorised, Administration, Compliance & Safety, Work, Training, Archives, Equipment & Assets) — untouched.
- `.132lc` doc-tool swap — untouched.
- `.132ld` OAuth flow — untouched.
- `/app/mobile/` — untouched (ban).
- `MOBILE_BUNDLE_VERSION` — unchanged.
