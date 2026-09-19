# Paneltec Civil — Active Maintenance Project

**PHASE 4.17 COMPLETE. Latest shipped: paneltec-v141 (Phase 4.18.2 clickable integration rows in API-pill popover; deep-links to per-provider config pages under `/app/settings/integrations/<provider>`).**
Pre-existing schematic serving bug also fixed in v136 (missing `@router.get("/schematics/{filename}")` decorator in help_routes.py).

THIS IS A LIVE, IN-PRODUCTION APP. DO NOT REBUILD.

- Current version: paneltec-v126 (bump per feature as instructed)
- Stack: FARM (FastAPI + React CRA + MongoDB), Yarn, Tailwind, shadcn, Fluent UI icons, react-router
- Brand: orange #F97316 + slate #1E293B (do NOT use blue / do NOT change)
- COMMS_SAFE_MODE=on (env-locked, do not change — blocks outbound email/SMS)
- Demo credentials: `/app/memory/test_credentials.md` (do not change)

## Major features already live
SWMS, Hazards, Incidents, Inspections, Pre-starts, Workers,
Permissions Matrix, Mobile Module Allocator, Plant & Vehicles
(+ Live Counters + Trip Card), User Manual at /app/help,
Comms Safe Mode, Audit Exports.

## Hard NO list (re-read after auto-compaction)
- ❌ Do NOT rebuild the frontend
- ❌ Do NOT migrate to Vite
- ❌ Do NOT migrate to TypeScript
- ❌ Do NOT add Unsplash hero images
- ❌ Do NOT touch fonts
- ❌ Do NOT build "Phase 1" stub pages
- ❌ Do NOT replace any existing component

## If you read this after auto-compaction
If you feel tempted to ask "should I build Phase 1 fresh?" — the answer is NO.
Read the most recent orchestrator message and resume from there.

## Queued work (as of resume)
~~1. Phase 4.12 — Sites + QR sign-on (paneltec-v127)~~ ✅ DONE 2026-06-30
~~2. Phase 4.12.1 — Mobile resolver fix (paneltec-v128)~~ ✅ DONE 2026-06-30

Latest version: **paneltec-v128**

### v127 (Phase 4.12) ships
- Backend: GET /sites returns v127 fields + `active_signons_count`;
  POST /sites (manual sites); PATCH /sites/{id} (questions + gps_override
  + manual_*); bulk-delete; recycle-bin + restore; signon-log + PDF/CSV
  export; per-site sign-off; `/me/signoff-active` for mobile.
- Public: GET /scan/site/{token} returns `signon_questions` and
  `visitor_signon_url`; POST /scan/site/{token}/sign-on now carries GPS
  + answers + distance check (warn-only @ >250m); new POST
  /scan/site/{token}/sign-on-visitor (no auth) for contractor/visitor flow.
- Web Admin (`/app/sites`): Add-site modal, Edit drawer (questions + GPS
  override), bulk-select delete, Recycle bin modal with restore.
- Public QR page: dynamic question renderer (yesno / text / choice),
  browser GPS capture, visitor name/company/phone form when unauthed.

### v128 (Phase 4.12.1) ships
- GET /api/assets/{id}/meter-trends and /trip-summary fall back to
  `assets.navixy_device_id` lookup when the URL param is a numeric
  Navixy tracker_id. Logged as `assets.id_resolver via tracker_id=X → asset_id=Y`.
