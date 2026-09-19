# v58.13.101 — Shipped (finish tool deferred) + prod purge log

**Status**: SHIPPED. `finish` tool still deferred under the standing
Option A directive (platform lint gate blocks on the 20 pre-existing
`ephemeral-upload-storage` warnings — parked for v58.14.x).
**Date**: 2026-09-04.
**Environments touched**:
- **PROD** — one-shot purge executed via `POST /api/admin/purge-test-data?dry_run=0` (no code change, existing .81 endpoint).
- **PREVIEW** — .101 UX code + version bumps shipped. Prod-side .101 arrives on the user's next Re-publish.

---

## Item A — Prod one-shot: Purge Test Data (no version bump)

### Auth
- Login to prod as `stephen@paneltec.com.au` · role `admin` → 200, token minted.

### Dry-run (pre-commit)
```
POST https://whs-compliance.emergent.host/api/admin/purge-test-data?dry_run=1
→ HTTP 200
→ {
    "ok": true,
    "dry_run": true,
    "matches": [
      { "collection": "assets", "count": 958, "samples": [
          "TEST-v58.13.14-1787309338164",
          "TEST-v58.13.14-1787309377425",
          "TEST-v58.13.14-1787309392201",
          "TEST-v58.13.14-1787310418812",
          "TEST-v58.13.16-1787312700945" ]},
      { "collection": "doc_files", "count": 1, "samples": ["sample-ppe.txt"] },
      { "collection": "cs_incident_issues", "count": 1,
        "samples": ["Test- Training\\nMonday 16/3/24 @ 12.25 pm a pedestrian tripped …"] }
    ],
    "grand_total": 960
  }
```

### Commit
```
POST https://whs-compliance.emergent.host/api/admin/purge-test-data?dry_run=0
→ HTTP 200
→ {
    "ok": true,
    "dry_run": false,
    "deleted": {
      "asset_service_schedules_cascade": 958,
      "assets": 958,
      "doc_files": 1,
      "cs_incident_issues": 1
    },
    "grand_total": 960,
    "audit_log": "/app/memory/purge_v58_13_81_log.txt"
  }
```

**Total rows removed**: 960 root + 958 cascade schedule rows = **1,918**.

### Post-commit verification
```
POST https://whs-compliance.emergent.host/api/admin/purge-test-data?dry_run=1
→ { "ok": true, "dry_run": true, "matches": [], "grand_total": 0 }
```
Clean sweep confirmed. No orphan cascade rows.

### Guardrails held
- `role == 'admin'` guard: enforced (Stephen's token authorised).
- `source != 'simpro'` guard: enforced by the .81 handler.
- Real workers, sites, roles, documents, and Simpro-sourced assets: untouched.
- Audit log on prod pod: `/app/memory/purge_v58_13_81_log.txt` — per the .81
  handler, one line per collection with full id list of every deleted row.

---

## Item B — v58.13.101 UX tail (shipped to preview, pending Re-publish for prod)

### Fix 1 — `SystemSettings.jsx` PurgeTestDataCard
- Card wrapper now carries `id="purge-test-data"` + `scroll-mt-24` so
  `/app/settings/system#purge-test-data` deep-links scroll the card
  into view (fixed top-bar no longer occludes it).
- New inline **"← Tick the checkbox above to enable delete"** hint
  renders in rose-700 semibold LEFT of the button row, gated on
  `!ack && dry.grand_total > 0 && !busy`. Disappears the moment the
  ack checkbox is ticked, the busy state fires, or grand_total===0.
- Delete button's `disabled={!ack || busy || dry.grand_total === 0}`
  gate PRESERVED — this ship fixes DISCOVERABILITY of the requirement,
  it does NOT weaken the safety gate.
- testid `purge-ack-required-hint` added for pytest source-scan.

### Fix 2 — `PlantVehicles.jsx` admin-only "test data detected" banner
- NEW state slot `testDataCount`, populated on mount from the existing
  `.81` endpoint `POST /admin/purge-test-data?dry_run=1`. Fetch gated on
  `pmUser?.role === 'admin'` — non-admins never fire the call (server
  would 403 anyway, but skip the round-trip).
- Banner renders BETWEEN `<HowThisWorks/>` and the `<Tabs>` bar (so
  it's visible regardless of which sub-tab is active). Only shows when
  `pmUser?.role === 'admin' && testDataCount > 0`.
- Content:
  > ⚠ **N test records detected across your register**
  >
  > Rows matching test-data patterns (`TEST-*`, `demo-*`, `sample-*`).
  > Simpro-imported data is always excluded. Use the admin purge tool
  > to clean them up.
  >
  > **[Purge test data →]** (deep-links to `/app/settings/system#purge-test-data`)
- testids: `vehicles-test-data-banner`, `vehicles-test-data-banner-count`,
  `vehicles-test-data-banner-cta`.
- `AlertTriangle` icon added to the top-of-file `lucide-react` import.
- On prod post-Re-publish, banner will read **0 test records → NOT rendered**
  because Item A already cleaned prod. It'll only surface if future test runs
  re-populate the DB — which is exactly the "self-signalling" behaviour we want.

### Version bumps (all 3 canonical strings)
- `frontend/src/lib/version.js#RUNNING_VERSION` → `paneltec-v160.3.9.58.13.101` (+ changelog block prepended)
- `frontend/public/service-worker.js#CACHE_VERSION` → `paneltec-v160.3.9.58.13.101`
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` → `paneltec-v160.3.9.58.13.101`

### Tests
NEW `tests/backend_unit/test_purge_ux_v58_13_101.py` — 13 source-pin
tests covering:
- Card anchor id + scroll-mt-24 (deep-link target).
- Ack-required hint gate + copy references the checkbox action.
- Delete-button ack safety-gate NOT weakened.
- Banner admin-role fetch gate.
- Banner render gate on `pmUser?.role === 'admin' && testDataCount > 0`.
- Banner CTA deep-links to `#purge-test-data`.
- Banner placement between `<HowThisWorks/>` and `<Tabs>`.
- All required testids present.
- Version-sync forward-safe pin ≥ 101.

**Full pytest suite: 639 passed, 1 skipped, 0 regressions**
(was 626 at .100 baseline. Delta +13 matches new tests exactly.)
Webpack: compiled with 110 pre-existing warnings, none from touched files.

### NOT changed
- `backend/admin_purge_test_data.py` handler — untouched. Same test
  patterns, same target collections, same role + Simpro guards.
- Any real business data on prod or preview.
- `/app/mobile/` code (only MOBILE_BUNDLE_VERSION bumped).
- The 20 pre-existing `ephemeral-upload-storage` lint warnings.
- Rate-limiting or auth logic.

---

## Rollout plan
- **PROD (Item A)**: purge already committed, verified. No further action.
- **PROD (Item B)**: user Re-publishes .101 when convenient. Banner will
  read "0 test records detected → not rendered" because the prod DB is
  already clean.
- **PREVIEW**: JSX changes live via hot-reload. SW cache version rolled
  to `.101` — next full page load serves the fresh bundle.

## Roadmap still queued (unchanged from .100 close-out)
- **P1**: Wire `comms_safe_mode.edit` grant/revoke into the Users &
  Permissions matrix UI checkbox.
- **P1**: Decide whether to create the ~104 missing asset records for
  the 346 orphan maintenance rows.
- **P2**: `TEST_MODE_BYPASS_RATE_LIMIT` env toggle for pytest.
- **P2**: `frontend/scripts/check-routes.js` compile-time guard.
- **P2**: Relabel/behaviour change on "Clear Blocked Outbox" (F4).
- **P3**: Rename `plant_maintenance.registration_matched` (F1).
- **Future**: v58.14.x object-storage migration — unblocks `finish` tool.
