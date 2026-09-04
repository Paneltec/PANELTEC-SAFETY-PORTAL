# v58.13.102 — Shipped (finish tool deferred) + preview purge log

**Status**: SHIPPED. `finish` tool deferred under standing Option A
directive (20 pre-existing `ephemeral-upload-storage` warnings still
parked for v58.14.x).
**Date**: 2026-09-04.
**Environments touched**:
- **PREVIEW** — one-shot purge executed (228 test assets + 228 cascade
  schedules = 456 rows removed) AND .102 modal restructure shipped.
- **PROD** — dry-run only. 0 test records (still clean since .101
  ship-day purge). No prod delete needed. .102 modal ships to prod on
  user's next Re-publish.

---

## Item A — Preview one-shot: Purge Test Data (no version bump)

### Dry-run
```
POST http://localhost:8001/api/admin/purge-test-data?dry_run=1
→ HTTP 200
→ {
    "ok": true,
    "dry_run": true,
    "matches": [
      { "collection": "assets", "count": 228,
        "samples": ["TEST-v58.13.14-1788416333259",
                    "TEST-v58.13.14-1788416333288",
                    "TEST-v58.13.14-1788416333320",
                    "TEST-v58.13.14-1788416333358",
                    "TEST-v58.13.14-1788416333395"] }
    ],
    "grand_total": 228
  }
```
Matched the user's banner count exactly (228). Only assets this cycle
— no orphan doc_files or cs_incident_issues (those were cleaned in
.81 and haven't regenerated).

### Commit
```
POST /api/admin/purge-test-data?dry_run=0
→ {
    "deleted": {
      "asset_service_schedules_cascade": 228,
      "assets": 228
    },
    "grand_total": 228,
    "audit_log": "/app/memory/purge_v58_13_81_log.txt"
  }
```
**Total rows removed on preview**: 228 root + 228 cascade = **456**.

### Verify
```
POST /api/admin/purge-test-data?dry_run=1
→ { "grand_total": 0, "matches": [] }
```
Clean sweep confirmed.

### Prod dry-run (for reference)
```
POST https://whs-compliance.emergent.host/api/admin/purge-test-data?dry_run=1
→ { "grand_total": 0, "matches": [] }
```
**Prod still clean since the .101 ship-day purge.** No prod delete
executed this cycle. User approval not needed.

---

## Item B — v58.13.102 UX repair (root cause fix)

### Root cause (post-mortem)
The .81/.101 modal centered its content via `flex items-center` on
the backdrop with **no `max-h` cap and no scroll behaviour** on either
the outer or inner container. When the count table + ack row + footer
buttons pushed the modal past ~500-600 px, on any viewport shorter
than the modal — laptops with dev tools open, dock-eaten screens,
split-screen setups, tablets held in landscape — **the top AND bottom
of the modal simply bled off-screen.** The user could see the count
table (which had its own internal `max-h-72 overflow-auto`) but the
ack checkbox at the bottom was below the visible viewport, unreachable
via scroll (no scrollable outer container), and without any visual
indication anything was clipped.

Delete button was gated on the unreachable checkbox → user reported
"UI got them stuck again". They weren't overlooking the checkbox; the
checkbox was **literally off-screen**.

### Fix — bounded flex column
`SystemSettings.jsx::PurgeTestDataCard` modal now:

**Backdrop container**
- Added `overflow-y-auto` — last-line-of-defence scroll on truly tiny
  viewports.
- Added `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby="purge-modal-title"` for screen readers.

**Inner container** — becomes a **bounded flex column**:
- `flex flex-col max-h-[calc(100vh-2rem)]` — never bleeds off the
  viewport regardless of table height. Three internal regions:

| Region | Behaviour | Contains |
|---|---|---|
| **Header** (`flex-shrink-0`) | Pinned at top | h3 title (`id="purge-modal-title"`) + grand-total summary |
| **Scroll body** (`flex-1 min-h-0 overflow-y-auto`) | Scrolls internally when table overflows | Count-and-samples table |
| **Sticky footer** (`flex-shrink-0` + `border-t` + `rounded-b-2xl`) | Pinned at bottom of the bounded modal | Ack strip + hint + Cancel + Delete |

New testids: `purge-test-data-modal-inner`, `purge-test-data-modal-scroll`, `purge-test-data-modal-footer`.

### Fix — touch-friendly ack checkbox + auto-focus
- Checkbox size: default browser `~13px` → **`h-5 w-5`** (20px, touch-target).
- Accent colour: default browser → **`accent-rose-600`** — tick is instantly visible in brand rose.
- **`ref={ackRef}` + `useEffect` auto-focus** when
  `open && dry && dry.grand_total > 0 && !ack && ackRef.current`.
  Keyboard users get Space-to-toggle immediately; mouse users get a
  focus ring as "this is next" signal.
- Wrapping `<label>` now switches background conditionally:
  - **Unticked + non-empty** → `bg-rose-50 border-rose-300 text-rose-900` (rose danger strip — "click me to proceed")
  - **Ticked or empty** → `bg-slate-50 border-slate-200 text-slate-700` (calm — "you've done this step")
- Copy upgraded from `text-xs slate` to `text-sm font-medium leading-snug` for readability.

### Fix — ack-required hint moved into sticky footer
The .101 hint (`← Tick the checkbox above to enable delete`) is still
gated on `!ack && dry.grand_total > 0 && !busy`, but now lives inside
the sticky footer alongside the disabled Delete button. On the failure
mode the .101 hint was supposed to fix (unticked ack), the user now
sees the hint AND the disabled button AND the highlighted rose ack
strip **in the same viewport region**. No scrolling gymnastics.

### NOT changed
- **`backend/admin_purge_test_data.py`** — untouched. Same test-data
  pattern set, same target collections, same role + Simpro guards.
- **Purge scope** — untouched. This ship is UX-shape-only.
- **PlantVehicles.jsx admin banner (.101)** — retained; still
  deep-links to `#purge-test-data` (anchor id + `scroll-mt-24` on the
  card wrapper survive from .101).
- **`/app/mobile/` code** — only `MOBILE_BUNDLE_VERSION` bumped.
- **The 20 pre-existing `ephemeral-upload-storage` lint warnings** —
  still parked for v58.14.x.

### Version bumps (all 3 canonical strings → `.102`)
- `frontend/src/lib/version.js#RUNNING_VERSION`
- `frontend/public/service-worker.js#CACHE_VERSION`
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION`

### Tests
NEW `tests/backend_unit/test_purge_modal_viewport_v58_13_102.py` —
**14 source-pin tests**:
- Modal backdrop: `overflow-y-auto` + `role="dialog"` + `aria-modal` + `aria-labelledby`.
- h3 title carries matching `id="purge-modal-title"`.
- Modal inner: `flex flex-col max-h-[calc(100vh-2rem)]`.
- Scroll region: `flex-1 min-h-0 overflow-y-auto`.
- Sticky footer: `flex-shrink-0` + `border-t`.
- Ack checkbox: `h-5 w-5 accent-rose-600` + `ref={ackRef}`.
- Auto-focus useEffect: gated on `open && dry && grand_total > 0 && !ack && ackRef.current`.
- Ack label conditional highlight switches between rose-50 (unticked, non-empty) and slate-50.
- **Regression guard**: Delete button gate `disabled={!ack || busy || dry.grand_total === 0}` preserved.
- **Regression guard**: `.101` ack-required hint still gated + inside the sticky footer.
- Version-sync forward-safe pin ≥ 102.

**Full pytest suite: 653 passed, 1 skipped, 0 regressions** (was 639
at .101 baseline. Delta +14 matches new tests exactly.) Webpack:
compiled with 110 pre-existing warnings, none from touched files.

---

## Rollout plan
- **PREVIEW**: modal restructure live via hot-reload. SW cache
  version rolled to `.102`. Preview also has 0 test records (Item A
  cleaned them), so the banner + modal are dormant unless
  regenerated.
- **PROD**: user Re-publishes `.102` when convenient. Prod already
  has 0 test records; the .102 modal ships as a resilience upgrade
  against future test-data resurgence.

## Roadmap still queued
- **P1**: Wire `comms_safe_mode.edit` grant/revoke into the Users &
  Permissions matrix UI checkbox.
- **P1**: Decide whether to create the ~104 missing asset records
  for the 346 orphan maintenance rows.
- **P2**: `TEST_MODE_BYPASS_RATE_LIMIT` env toggle for pytest.
- **P2**: `frontend/scripts/check-routes.js` compile-time guard.
- **P2**: Relabel/behaviour change on "Clear Blocked Outbox" (F4).
- **P3**: Rename `plant_maintenance.registration_matched` (F1).
- **Future**: v58.14.x object-storage migration — unblocks `finish`.
