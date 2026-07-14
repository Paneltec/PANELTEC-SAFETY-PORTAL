# Iteration 17 — v160.3.8.0 Crane Lift Grouped-Crew Pattern

## What was implemented

### New component: `src/components/CrewGroupCard.tsx`
- Detects consecutive `worker_picker` fields with `config.group === "crew"` 
- Renders a single bordered card (bronze `Colors.imBronze` border) with:
  - Header: crew people icon + uppercase group label ("RIGGING CREW")
  - Shared company toggle pill (orange background, swap icon) — Paneltec Civil / Viatec
  - Stacked worker pickers inside, each getting the shared `companyFilter`
- When company toggle is flipped, all worker values in the group are cleared to prevent cross-company ghost selections
- Each worker picker still writes to its own `values[field.id]` key for backend compatibility

### Updated: `app/forms/fill/[id].tsx`
- Added `useMemo` to pre-compute `crewGroupedIds` (Set) and `crewGroups` (array of grouped field objects) from `tpl.fields`
- Changed field rendering from `.map()` to `.reduce()`:
  - If field is in `crewGroupedIds`, skip normal rendering
  - On first field of a crew group, render `CrewGroupCard` for the entire group
  - Non-crew fields render exactly as before (no visual change)

### Database: Crane Lift template updated
- Fields f14 (Dogger/Rigger), f15 (Crane Operator), f16 (Lift Supervisor) each got:
  - `config.group: "crew"`
  - `config.group_label: "Rigging Crew"`
- These were already `worker_picker` type with `inline_company_toggle: true`

### Version bump
- `mobile/src/lib/version.ts` → `paneltec-v160.3.8.0`
- `frontend/src/lib/version.js` → `paneltec-v160.3.8.0`
- `frontend/public/service-worker.js` → `paneltec-v160.3.8.0`

## Verification
- Crane Lift form: crew group card renders with 1 company toggle, 3 workers ✅
- Company toggle flips from "Paneltec Civil" (37 workers) to "Viatec" (30 workers) ✅
- All three pickers update filter simultaneously ✅
- Heavy Equipment Pre-Op form: no crew-group-card present, individual toggles work ✅

## Data model
Standard per-field serialization preserved (each field still has `values[f.id]`). The backend receives the same payload format as before — grouping is purely visual.

## Commit
- `76788cd` — v160.3.8.0: Crane Lift grouped-crew pattern
