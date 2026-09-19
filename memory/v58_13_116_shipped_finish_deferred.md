# v58.13.116 — In-context test-data purge modal (finish deferred)

**Status:** SHIPPED. `finish` tool blocked by the same 20 pre-existing `ephemeral-upload-storage` warnings (deferred to v58.14.x per user directive).

## Investigation → Case A confirmed
All 230 flagged rows are pure seed artefacts:
- 100% `kind=plant`, 100% `source=""`, 100% `rego=""`, 100% same admin, all created within a 30-second window.
- Name shape `TEST-v58.13.14-<10-digit ms>` — script-generated fingerprint.
- Zero dependencies in `plant_maintenance` / `incidents` / `hazards` / `pre_starts`.
- 230 auto-cascaded `asset_service_schedules` — already handled by the existing `.81` purge endpoint.

## Files touched
| Path | Change |
|---|---|
| **NEW** `frontend/src/components/vehicles/PurgeTestDataModal.jsx` | ~180-line confirm modal with live re-query on open, audit summary, type-to-confirm `PURGE` gate, cascade note, rose destructive button. |
| `frontend/src/pages/PlantVehicles.jsx` | Imported the modal; swapped banner CTA from `<Link to="/app/settings/system#purge-test-data">` to `<button onClick={() => setPurgeModalOpen(true)}>`; mounted `<PurgeTestDataModal>` with `onPurged={() => { setTestDataCount(0); load(); }}`. |
| Version constants ×3 + full changelog block in `version.js`. |
| **NEW** `tests/backend_unit/test_purge_test_data_v58_13_116.py` — 13 checks. |
| `tests/backend_unit/test_purge_ux_v58_13_101.py` — flipped `test_test_data_banner_cta_deeplinks_to_purge_card` to `test_test_data_banner_cta_opens_modal_v58_13_116` (locks the new contract, asserts the old `/app/settings/system#purge-test-data` path is gone). |

## Backend
**Reused as-is.** `POST /api/admin/purge-test-data` already:
- Gates on admin role (403 for non-admin).
- Excludes `source == "simpro"` server-side.
- Cascades `asset_service_schedules` for every deleted asset.
- Writes audit log to `/app/memory/purge_v58_13_81_log.txt`.

No new endpoint, no schema change, no comms.

## "matched / unmatched" misread — confirmed for the audit trail
The user's phrase *"keep it under its proper heading — not matched or unmatched"* was based on a misread of the tab labels, not anything the banner said. Confirming back:
- Plant & Vehicles has 5 tabs: **All Maintenance** / **Unmatched** / **Vehicles from Navixy** / **Dashboard** / **Service Inbox**.
- The **Unmatched** tab shows `plant_maintenance` rows that couldn't be joined to an asset by rego — a legitimate import-audit affordance for the `plant_maintenance` table (NOT the asset list).
- The asset list itself lives on **Vehicles from Navixy** and is already categorised by `kind` (vehicle / plant / tool / container) via 4 chips.
- Nothing to restructure — the "proper heading" the user asked for is already in place. Please pass this back to the user.

## Pytest tally
- `test_purge_test_data_v58_13_116.py` — **13 checks**: admin gate + 403 path; behavioural round-trip (5 seed assets + 5 cascade rows → dry_run=1 returns match count without deletion → dry_run=0 wipes both parent + cascade); Simpro rows always excluded (one `source=simpro` + one `source=""` both matching `TEST-*` — only the empty-source row purged); modal source-pins (REQUIRED_PHRASE, dry-run useEffect on `[open]`, canConfirm gate, commit endpoint call, all 6 testids); Plant page source-pins (button-not-Link, old Link path gone, modal mounted with correct reset); version pin ≥ .116.
- `test_purge_ux_v58_13_101.py` — updated 2 checks to lock the .116 contract.
- **Full suite: 907 assertion passes, 0 failures.** (4 pre-existing rate-limit errors on `test_schedule_delete_cascade_v58_13_16.py::_token` — flakiness from login-throttle when the whole suite runs; verified to pass in isolation after cool-down.)

## Live Playwright verification
- `/app/memory/v58_13_116_purge_modal_before_type.png` — modal open, empty confirm input, greyed-out "Purge 6 records" button.
- `/app/memory/v58_13_116_purge_modal_after_type.png` — after typing `PURGE`, button becomes solid rose (enabled).
- **Case-sensitivity confirmed live**: `disabled=True` before typing, `disabled=False` after `PURGE`, `disabled=True` again after switching to lower-case `purge`.
- Version footer live: `paneltec-v160.3.9.58.13.116`.

## Version bump confirmed
All 3 canonical strings → `paneltec-v160.3.9.58.13.116`:
- `frontend/src/lib/version.js#RUNNING_VERSION` ✓
- `frontend/public/service-worker.js#CACHE_VERSION` ✓
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` ✓

## NOT changed
- Backend `admin_purge_test_data.py` — reused.
- The 5-tab structure of Plant & Vehicles / the kind-chip filter / the Unmatched tab data source.
- Any comms / scheduler / ephemeral-upload path.
- `/app/mobile/` code (only `MOBILE_BUNDLE_VERSION` bumped).
- 20 pre-existing `ephemeral-upload-storage` warnings — parked for `v58.14.x`.
- The `asset_seed_v58_13_14` defensive cron (deferred per your directive).

## Numbers you asked about
- Preview register at investigation time: **230** flagged test rows (all in `assets`).
- Preview register at screenshot time: **6** flagged rows (natural shrinkage as admins run the settings-page purge — the modal shows whatever the LIVE dry-run returns, not a stale banner number).
- Modal correctly re-queried on open → title/summary/button label all read "6" not "230".
