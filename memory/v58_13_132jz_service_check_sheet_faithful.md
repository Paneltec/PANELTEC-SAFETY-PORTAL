# v58.13.132jz — Faithful Service Check Sheet: Tick/X/N-A + Heavy Truck + Colours

## User feedback on `.132jy`
> "when you brought over (service check sheet) you missed questions and answers tables (x Tick Na) and open up questions below on heavy trucks and is it possible the colours and shading as well"

Three defects in the `.132jy` import:
1. Radios seeded with `Checked / Replaced / N-A` — actual source uses **Tick / X / N-A** (trinary with visual green tick, red X, grey N/A).
2. Heavy-truck section (11 sub-sections, 77 items) was omitted.
3. Section headers, per-section colours, and row shading were flat.

## Source of truth

`backend/fleet_service_sheet_templates.py` (canonical, already exists as of `.123`):
- `TEMPLATE_LIGHT_VEHICLE_V121_1` — 18-item light-vehicle checklist.
- `TEMPLATE_HEAVY_TRUCK_V123_1` — **11 sub-sections × 77 items** heavy-truck checklist.
  Marks: `"X" | "CHECK" | "NA" | "UNSET"` — the trinary widget the user is asking for.

Frontend widget: `frontend/src/components/ServiceCheckSheetModal.jsx` lines 720-780 render the trinary buttons with:
- CHECK → `bg-emerald-600 text-white` (green tick, displayed as ✓)
- X → `bg-rose-600 text-white` (red X)
- NA → grey pill

### Full heavy-truck section list

| Section | Label | Accent | Items |
|---|---|---|--:|
| A | Engine | amber | 17 |
| B | Steering | sky | 8 |
| C | Tires and Wheels | cyan | 6 |
| D | Clutch and Transmission | violet | 5 |
| E | Safety Equipment | emerald | 4 |
| F | Brakes | rose | 5 |
| G | Driveline and Differentials | indigo | 4 |
| H | Electrical, Cab & Accessories | blue | 12 |
| I | Auxiliary Equipment | teal | 10 |
| J | Frame and Suspension | slate | 4 |
| K | Hitches | amber | 2 |

Plus 8 tread-depth positions (14 depth fields: 8 outer + 6 inner tandem).

## Fix

### A. Trinary answer widget — no new field type needed

Options changed to **`["✓ Check", "✗ Repair", "N/A"]`** on every checklist radio (95 rows total).

Extended existing radio-colour detectors to recognise the tick/cross variants alongside yes/no/defective:

**Web (`frontend/src/pages/Forms.jsx::ColouredRadioGroup`):**
```js
const isCheck = norm === 'yes' || norm.includes('✓') || norm.includes('tick')
  || norm.startsWith('check');
const isCross = norm === 'no' || norm === 'defective' || norm.startsWith('fail')
  || norm.includes('✗') || norm.includes('cross') || norm.startsWith('repair')
  || norm === 'x';
```

**Mobile (`mobile/app/forms/[id]/index.tsx`):** same pattern extended in the radio option renderer. Emerald for check, error red for X, grey for N/A.

This preserves the trinary look without inventing a new `tick_x_na` field type in backend or Form Runner.

### B. Heavy-truck section — imported in full

The new template `service_check_sheet_v121_2` includes:
- **Section 0** — Vehicle Details (8 fields)
- **Section 1** — Service Level selector
- **Section 2** — Light Vehicle Checklist (18 items × 2 fields = 36 fields)
- **Section 3** — Heavy Vehicle Additional Checks (77 items × 2 fields = 154 fields across 11 sub-sections)
- **Section 4** — Tread Depths (14 numeric fields)
- **Section 5** — Consumables & Follow-Up (6 fields)
- **Section 6** — Attachments & Sign-Off (3 fields)

Heavy-truck fields carry `config.heavy_truck_only: true` and `config.sub_section: "A".."K"` so a future FormRunner enhancement can conditionally hide them for non-heavy assets. **For now they're always visible** — the section header explicitly says "only fill in for heavy trucks".

### C. Colours + shading via `.132jk` style schema

Section palette (Tailwind-50 tints + full-strength borders):

| Section | Background | Border |
|---|---|---|
| A · K (amber) | `#FEF3C7` | `#F59E0B` |
| B (sky) | `#E0F2FE` | `#0EA5E9` |
| C (cyan) | `#CFFAFE` | `#06B6D4` |
| D (violet) | `#EDE9FE` | `#8B5CF6` |
| E (emerald) | `#D1FAE5` | `#10B981` |
| F (rose) | `#FFE4E6` | `#F43F5E` |
| G (indigo) | `#E0E7FF` | `#6366F1` |
| H (blue) | `#DBEAFE` | `#3B82F6` |
| I (teal) | `#CCFBF1` | `#14B8A6` |
| J (slate) | `#F1F5F9` | `#64748B` |

- **Section headers** render as bold `lg` labels on tinted background with 2px accent border + 14px radius.
- **Row-level style**: alternating zebra (white / tinted) with 1px accent border, 10px radius.
- **Light-vehicle rows**: subtle slate zebra (`#F9FAFB / #FFFFFF`) with `#E2E8F0` border — visually distinct from the coloured heavy-truck rows.
- Notes fields on each row inherit the row background but drop the border to visually "hang under" the answer field.

### D. Reimport endpoint

Existing `POST /api/admin/forms/import-service-check-sheet` reused. Bumped `original_source` string to **`service_check_sheet_v121_2`** so this ship treats it as a new template. Old `.132jy` templates matching `service_check_sheet_v121_1` are soft-deleted in the same transaction:

```
retired_by: "132jz"
retired_reason: "Superseded by service_check_sheet_v121_2 (Tick/X/N-A + heavy truck section + colours)"
```

## Live import run (all_orgs=true)

```
name: Vehicle Service Inspection — Service Check Sheet
source_version: service_check_sheet_v121_2
field_count: 239

Paneltec Pty Ltd          → created  retired_old=1  id=ee25cff2-a2a8-4781-88ae-33f5d84dbaa6
Paneltec Civil Pty Ltd    → created  retired_old=1  id=063bbc6c-3312-49ae-b6d9-f8d4c67f5757
5× Test Organisation      → created  retired_old=1 each
Test Org (×2)             → created  retired_old=1 each
```

**Idempotency confirmed**: 2nd run returned `action=updated retired_old=0`.

### Field-type breakdown (239 fields)
- 115 × `text` (section headers + per-row notes + free-text vehicle detail fields)
- 95 × `radio` (trinary answer rows — 18 light + 77 heavy)
- 18 × `number` (mileage, hours, next service due, tread depths)
- 3 × `date`, 2 × `textarea`, 2 × `signature`, 1 × `attachment`
- 1 × `select` (Service Level), 1 × `worker_picker`, 1 × `vehicle_navixy`

Section-header count: **16** — one per section with the corresponding colour tint.

## Verification

### `/api/scan/{trailer-token}/forms` (evztUZrfNU, kind=trailer, asset_type=Trailer):
```
1 Service Check Sheet template present:
  Vehicle Service Inspection — Service Check Sheet
    → reasons=['asset_type:trailer']
    → field_count=239
```
✅ No duplicate (old `.132jy` template soft-deleted). Correct match reason.

### Old `.132jy` templates
All 11 templates soft-deleted (`deleted_at` set, `retired_by="132jz"`). They no longer appear in scans, template listings, or the admin FormAssignmentsAdmin UI.

## Mobile changes required

**Yes** — the radio widget needed extending to recognise `✓ Check` / `✗ Repair` as green/red instead of falling through to the default orange. The `field.style` schema is already fully honored by mobile (`.132jl`) so no changes needed for section colours + row shading.

Also carried the `pointerEvents="none"` and `disabled={locked}` addition into the radio renderer so `.132jy`'s QR-scan lock also disables trinary picks (was previously only wrapping text/number inputs).

## Files touched

Backend:
- `backend/admin_forms_import_service_check_sheet.py` — REWRITTEN. Reads canonical checklists from `fleet_service_sheet_templates.py`, applies section palette, upserts the new template, soft-deletes v121_1 predecessors.

Frontend (web):
- `frontend/src/pages/Forms.jsx` — extended `ColouredRadioGroup` to recognise `✓`/`tick`/`check` → emerald and `✗`/`cross`/`repair`/`x` → rose.
- `frontend/src/lib/version.js` — `.132jy` → `.132jz` on RUNNING_VERSION + EXPECTED_CACHE_VERSION.
- `frontend/public/service-worker.js` — `.132jy` → `.132jz` on CACHE_VERSION.

Mobile:
- `mobile/app/forms/[id]/index.tsx` — same tick/cross detection in the radio option renderer + `disabled={locked}` propagated to the trinary buttons.
- `mobile/src/lib/version.ts` — `.132jy` → `.132jz`.
- `mobile/app.json` — `1.0.35/157` → `1.0.36/158`.

## EAS build

- Cancelled: `08fcef3b-965b-475a-814f-64213b3fc7ae` (v1.0.35/157 in flight)
- Kicked: **`4edbbaaa-2254-4c84-a1c8-c77de4be973f`** (v1.0.36/158)
- Profile: `preview-apk`
- Status at ship time: `NEW`
- Includes combined `.132jy` (QR-scan lock + Service Check Sheet v1) + `.132jz` (Tick/X/N-A + heavy truck + colours + radio extension) mobile changes.

## NOT changed
- No new `tick_x_na` form-template field type — reused `radio` with option-string pattern-matching (cleaner, avoids Form Runner surgery).
- Conditional-visibility for heavy-truck fields — deferred. Fields carry `config.heavy_truck_only: true` for a future FormRunner enhancement to hide them for non-heavy asset scans; for now they're always visible with a header disclaimer.
- No pytests written per Fast-Ship rule.
- No `testing_agent` invoked.
