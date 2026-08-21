# Paneltec Civil — BUILD_STATE

## Backend hot-reload — CRITICAL

**Backend is NOT hot-reload** (as of v58.13.0-a). Supervisor command:
```
[program:backend]
command=/root/.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001 --workers 1
```
NO `--reload` flag. Any backend file edit sits stale in the process until:
- `sudo supervisorctl restart backend`, OR
- Container recycles organically (unpredictable timing).

**Discipline going forward** (mandatory on every backend ship):
1. Make backend code edits.
2. `sudo supervisorctl restart backend`  ← always, no exceptions.
3. Post-restart curl verification of each modified endpoint via external
   `REACT_APP_BACKEND_URL` (not just localhost — validates ingress + response
   shape end-to-end). Include the curl output in the ship report.
4. If tests only ran against localhost pre-restart, they don't count as
   proof of the running endpoint until step 3 fires.

**v58.13.5 will add `--reload`** to the supervisor config. Until then,
this discipline is the only guard against the "stale backend, endpoint
returns old response shape" class of bug that broke v58.12.10 delivery.

## Bulk import auto-resume grace window

`AUTO_RESUME_GRACE_SECONDS=90` (env default). If a backend restart happens
while a bulk import job is actively progressing (last_progress_at within
90s of the restart), the startup-time `auto_resume_orphaned_jobs` will
NOT re-fire the job. The 60s `bulk_import_watchdog` picks it up once
`last_progress_at` becomes >90s stale.

Consequence: don't expect v58.12.11's Path A′-a resume line immediately
after a restart. Wait 1-2 minutes for the watchdog tick.

## Standing hard-limit set (never touch without explicit permission)

- `stephen@paneltec.com.au` user record
- Bulk import job `0da9f903-d4f5-4a37-a8b0-3a8786e45e10`
- `/api/workers/directory` shape (v58.12.10 widened form is the ceiling)
- Seed BYDA template `d64bcc26-3464-407d-b99b-bed7b8eb712a`
- `TemplateBuilder.jsx`, `PreStarts.jsx`, `Hazards.jsx`
- `folderColors.js`, `preStartsPalette.js`, `CaptureCard.jsx`
- Every doc in `mobile/` beyond the version bump in `version.ts`
- Every existing `form_templates` / `workers` / `pre_starts` /
  `form_submissions` / `asset_service_records` doc (no migration writes)

## Version discipline

- Every ship bumps all 3 canonical version files:
  - `/app/frontend/src/lib/version.js` (const RUNNING_VERSION)
  - `/app/frontend/public/service-worker.js` (const CACHE_VERSION)
  - `/app/mobile/src/lib/version.ts` (const MOBILE_BUNDLE_VERSION)
- Guardrail: `python /app/backend/scripts/check_version_files_v58_8_1.py`
  must exit 0.
- Version stamps are **monotonic forever**. Work-item labels
  (e.g. "v58.12.8") are decoupled from version stamps
  (e.g. "v160.3.9.58.12.10"). Stamp = max+1.

## LOC ceilings — fork-memory calibrations

- `AssetServiceTabs.jsx` frontend edits: add **+15 lines** upfront to
  ceiling estimates (recurrent overrun observed across v58.12.6 / .7 / .10).
- Structural UI rewrites: gross-adds ceiling should be
  `2 × old-block-LOC + net-target`, not `net-target × 1.6`.
- Backend `bulk_import_prestarts.py` edits: 20-line ceiling includes
  code-only lines; comments do not count against the code budget.

## Recent shipped versions (chronological)

- v160.3.9.58.12.9  — Tile-format parity (Inspections + Incidents → CaptureCard)
- v160.3.9.58.12.10 — Technician-position hybrid picker (v58.12.8 work-item)
- v160.3.9.58.12.11 — Bulk-import counter fix (Path A′-a)
- v160.3.9.58.12.12 — Service Log Position-Primary redesign
- v160.3.9.58.12.13 — Position-based form assignment (P-2)
- v160.3.9.58.13.0  — Periodic Task Templates schema + UI (v58.13.0-a)

## Next in queue

- v58.13.5 — supervisor `--reload` config (defensive; removes the class
  of stale-backend bugs this file was created to document)
- v58.13.0-b — remaining Periodic Task Template fields
- v58.13.1 — periodic task autogen cron
- v58.13.2 — generated-task inbox tab
- v58.13.3 — description rich-text + view checklist
- v58.13.4 — CS Incident list → Submissions in GroupedTilesView format
- v58.12.14 (parked) — TemplateBuilder mirror of assigned_positions
- v58.12.5 (parked) — TemplateBuilder editors for reference_matrix / attachment / actions + attachment DELETE
