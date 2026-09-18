# v58.13.132hw — P0 bug fixes (shipped)

Three bundled P0 fixes.

## Fix 1 — Visitor QR sign-in 404

**Symptom:** Visitor scans site QR, sees "This QR code is no longer valid" for every valid QR.

**Root cause:** `VisitorSignIn.jsx` called `GET /public/site/{token}/form` — an endpoint that never existed. Backend has anonymous resolver at `GET /scan/site/{token}` (sites_qr.py::resolve_site_scan, no auth dependency) with the exact same shape (`site.{name,address}`, `signon_questions`, `active_swms`).

**Fix:** Repointed FE `api.get('/public/site/…')` → `api.get('/scan/site/…')`. No backend changes needed.

## Fix 2 — Incidents search input cleared on first keystroke

**Symptom:** Type 1 letter in Incidents search → letter appears briefly → toolbar wipes and cursor loses focus.

**Root cause:** `Incidents.jsx` line 184 used `{loading ? <Loading/> : preFiltered.length === 0 ? <EmptyState/> : (<>toolbar…</>)}`. First keystroke → debounced `onQueryChange` → sets `searchQuery` → `includeArchivedInFetch` flips → `load()` called → `setLoading(true)` → **toolbar unmounts** → local `q` state lost → toolbar remounts fresh when load finishes.

**Fix:** Gate now `loading && items.length === 0` — subsequent search-triggered loads keep the toolbar mounted.

## Fix 3 — SSRA vehicle picker local fleet fallback

**Symptom:** Whenever Navixy hash expired or Navixy was unreachable, the vehicle dropdown went empty and the FE flipped to manual-only entry with an amber "reconnect Navixy" nag.

**Root cause:** `forms.py::navixy_vehicles` returned `{vehicles: [], status: "navixy_disconnected"}` for hash-invalid and `navixy_unavailable` for 5xx/DNS/decode. FE treated both as fatal and stripped the dropdown.

**Fix:** New `_local_fleet_fallback(org_id, reason)` helper inside `navixy_vehicles`. When Navixy is unreachable AND the auto-refresh path fails, it queries `db.assets` for active vehicles and returns the same shape (`id`, `label`, `plate`, `registration`, `vehicle_type`, `tags`) with `status="local_fleet_fallback"`. FE keeps the dropdown mounted, shows a subtle info chip rather than the amber warning, and never flips to manual-only.

Invocation points: (a) hash-refresh soft path when the retry after refresh still fails, (b) hash-refresh unavailable path (missing creds), (c) generic `except Exception` catch-all (5xx / decode / network).

## Files touched

* `backend/forms.py` — `_local_fleet_fallback` helper + 3 invocation sites.
* `frontend/src/pages/VisitorSignIn.jsx` — one-line endpoint repoint.
* `frontend/src/pages/Incidents.jsx` — loading gate refined.
* `frontend/src/pages/Forms.jsx` — treat `local_fleet_fallback` status as info, keep dropdown mode.
* `frontend/src/lib/version.js` + `frontend/public/service-worker.js` — three-way lockstep bump `.132hv` → `.132hw`.

## Tests

`tests/test_v58_13_132hw_p0_bugs.py` — 5 green:

  1. `GET /scan/site/{token}` returns 200 anonymously with the expected shape.
  2. `VisitorSignIn.jsx` no longer references `/public/site/…`.
  3. `Incidents.jsx` loading gate uses `loading && items.length === 0`.
  4. `forms.py` has the `_local_fleet_fallback` helper + invocation points + `local_fleet_fallback` status.
  5. Three-way version lockstep at `.132hw`.

## Ops rules honoured

* No `testing_agent` / `e1_tester` / `finish` — pytest + live source guards only.
* No `/app/mobile/` edits.
* No hard-coded env values.
* Three-way version lockstep bumped.
* Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Housekeeping

Disk hit 100% mid-ship — freed 977 MB by clearing `frontend/node_modules/.cache` + `__pycache__`. Standard `.132hpa` logrotate + `.132hma` cron sweep are working as intended; the webpack cache growth is the tail residual.
