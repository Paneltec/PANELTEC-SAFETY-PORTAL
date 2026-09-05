# v58.13.130a — Quick Log Service: searchable Technician picker (matches Service Check Sheet) — SHIPPED (finish deferred)

`finish` bypassed by the 20 pre-existing `ephemeral-upload-storage` warnings (still parked for v58.14.x per standing directive).

## Rules obeyed
- No `testing_agent`.
- No `/app/mobile/` code — version-only bump.
- No comms.
- 20 deferred warnings still parked.

## Ship one-liner
The Quick Log Service popup's Technician field now uses the exact same searchable-autocomplete + freetext-fallback UX as the Service Check Sheet, sourced from the narrowed `/fleet/technicians` endpoint (mechanic / technician / fitter / service tech only). Extracted the picker into a shared component (`TechnicianPicker.jsx`) and rewired both consumers.

## User's verbatim pain
> "in the Quick Log service popup could you do the same with the Technician position as you did with the service check list"

## Files touched (8)

| File | Change |
|---|---|
| `frontend/src/components/TechnicianPicker.jsx` | NEW · 140-line shared component. Datalist autocomplete + freetext-fallback + internal picker↔freetext toggle |
| `frontend/src/components/AssetServiceTabs.jsx` | RecordEditor: fetch switched from `/workers/directory` → `/fleet/technicians`; `<select>` block replaced with `<TechnicianPicker>`; `techMode` / `onPickTech` / `backToPicker` retired |
| `frontend/src/components/ServiceCheckSheetModal.jsx` | Inline datalist block replaced with `<TechnicianPicker>`; `technicianMode` state retired; `buildPayload` simplified to a single id-then-name find |
| `frontend/src/components/__tests__/AssetServiceTabs.techposition.test.jsx` | REWROTE for the new contract · 6 tests, all pass |
| `frontend/src/lib/version.js` | RUNNING_VERSION → `.130a` + `.130a` block header |
| `frontend/public/service-worker.js` | CACHE_VERSION → `.130a` |
| `mobile/src/lib/version.ts` | MOBILE_BUNDLE_VERSION → `.130a` |
| `tests/backend_unit/test_v58_13_130a_bundle.py` | NEW · 13 tests · all passing |
| `tests/backend_unit/test_service_check_sheet_v58_13_121.py` | `sheet-technician-select` literal pin swapped for a `testidPrefix="sheet-technician"` pin (template-generated now) |

## Shared component — `TechnicianPicker.jsx`
```
<TechnicianPicker
  technicians={list}                     // parent-filtered
  value={{id, name}}
  onChange={({id, name}) => …}
  testidPrefix="rec-tech"                 // or "sheet-technician"
  placeholder="Search technicians (name)"
  freetextPlaceholder="Contractor or unlisted technician"
  disabled={false}
/>
```

Emits testids:
- `<prefix>-select`         — autocomplete input
- `<prefix>-freetext`       — freetext input
- `<prefix>-freetext-toggle` — "Type new" button
- `<prefix>-back-to-picker`  — "Pick from list" link
- `<prefix>-opt-<id>`        — each datalist option

Internal picker↔freetext auto-flip:
- Empty list → freetext
- Legacy value that doesn't match any row → freetext (so an edited legacy record's `technician_name` isn't wiped)

## Consumer 1 — RecordEditor (Quick Log Service)
- Fetch switched to `/fleet/technicians` (narrowed to tech-only roles).
- Response shape adapted from `[…]` → `{technicians: […]}`.
- Picker fed `effectiveTechs` (position-filtered) so the Position-Primary redesign (.12.12) is preserved:
  - Picking a position filters the picker's datalist to matching technicians only.
  - Zero-match position → hint renders + full-fallback list.
  - Position + off-roster tech both persist to the submit payload.
- `techMode` / `onPickTech` / `backToPicker` retired.

## Consumer 2 — ServiceCheckSheetModal
- Inline datalist block replaced with `<TechnicianPicker testidPrefix="sheet-technician" …>`.
- `technicianMode` state retired.
- `buildPayload()` single-find contract: `technicians.find(t => (id && t.id===id) || (name && t.name.toLowerCase()===name.toLowerCase()))`. Preserves `.123a` semantics — id-first, then case-insensitive name; freetext falls through via `|| technicianName`.

## Backend
No changes. Reuses:
- `/fleet/technicians` endpoint (`.121` shape, `.123a` narrowing to `mechanic / technician / fitter / service tech`).
- `POST /assets/{id}/records` — already accepts `technician_id` + `technician_name` from `.121`.

## Playwright screenshots (verified live)
- `/app/memory/v58_13_130a_quick_log_before_search.png` — Quick Log Service popup, Technician field visible as `<input>` (not `<select>`) with placeholder "Search technicians (name)" + "Type new" toggle. Console: `tech input tag=INPUT`.
- `/app/memory/v58_13_130a_quick_log_search_mech.png` — typed "mech", autocomplete indicator visible. Console: `datalist option count: 2` (narrowed via `/fleet/technicians` in the live org).
- `/app/memory/v58_13_130a_quick_log_freetext.png` — clicked "Type new" → freetext mode, typed "Contractor Bob's Mobile Mech", "Pick from list" link surfaces to go back.

## Pytest tally
- `tests/backend_unit/test_v58_13_130a_bundle.py`: **13 / 13 pass** — shared component exists, expected testids emitted, auto-flip effects, RecordEditor imports + fetches `/fleet/technicians` + renders picker with `effectiveTechs` + writes both id/name on change, position hint preserved, old select block gone, ServiceCheckSheetModal delegates to shared picker, `technicianMode` state retired, buildPayload single-find contract, version pin ≥ .130a.
- `frontend/__tests__/AssetServiceTabs.techposition.test.jsx`: **6 / 6 pass** — picker renders as INPUT with datalist testids; position filter narrows list; zero-match hint fallback; picking tech doesn't overwrite position; position + off-roster tech both persist to payload; typing exact matching name resolves `technician_id` on save.
- Full backend unit suite: **1166 passed / 6 skipped / 2 pre-existing flakes** (`test_fleet_search_null_org_v58_13_120c2::test_search_finds_pm_rows_across_null_and_scoped_orgs` + `test_safe_mode_toggle_perm_v58_13_90::test_ensure_stephen_can_toggle_upserts_override` — both fail on clean `main` too, zero new regressions).

## Version bump
```
frontend/src/lib/version.js   RUNNING_VERSION       = 'paneltec-v160.3.9.58.13.130a'
frontend/public/service-worker.js   CACHE_VERSION   = 'paneltec-v160.3.9.58.13.130a'
mobile/src/lib/version.ts   MOBILE_BUNDLE_VERSION   = 'paneltec-v160.3.9.58.13.130a'
```

## NOT changed
- `/fleet/technicians` endpoint (`.121`/`.123a`) — reused verbatim.
- Backend service-log endpoint (`POST /assets/{id}/records`) — unchanged.
- Position field (`Technician position`) + its select/freetext toggle + zero-match hint — untouched.
- `TechnicianPicker` is a small, single-purpose component; no future-facing abstractions.
- Any signature / attachment / heavy-service / checklist path.
- Any comms / scheduler / ephemeral-upload path.
- `/app/mobile/` code (only MOBILE_BUNDLE_VERSION bumped).
- The 20 pre-existing `ephemeral-upload-storage` warnings (still parked for v58.14.x).
