# v58.13.132ka — Fix Service Check Sheet options-nesting + reimport

## Root cause (from `.132jz` investigation)
The `.132jz` import wrote radio + select options inside `field.config.options`. Both surfaces (`Forms.jsx::ColouredRadioGroup` line 227, `mobile/app/forms/[id]/index.tsx` line 924) read `field.options` (top level), so `(field.options || []).map(...)` iterated an empty array and **no answer buttons rendered** on 96 radio + 1 select field. Working templates (e.g. `Trailer Pre-start`) already store options at top level — the import was the outlier.

## Fix
Three-line change in `backend/admin_forms_import_service_check_sheet.py::_build_fields()`:

- Service Level select → `"options": [...]` at top level (was `"config": {"options": [...]}`)
- Light-vehicle 18 radios → `"options": list(TRINARY_OPTS)` at top level
- Heavy-truck 77 radios → same, still keeping `heavy_truck_only` + `sub_section` inside `config` for the future conditional-visibility hook

`original_source` bumped `service_check_sheet_v121_2` → **`service_check_sheet_v121_3`**. `_retire_old_source` widened to soft-delete BOTH predecessor sources (`v121_1` from .132jy AND `v121_2` from .132jz).

## Mobile — no code changes needed
Verified mobile radio renderer at line 924 reads `field.options` directly, no `config.options` fallback. Once the DATA is corrected via re-import, mobile v1.0.36 (currently building as `4edbbaaa`) will render correctly. **EAS build `4edbbaaa` NOT cancelled** — it will finish and work correctly against the fixed template data.

## Live re-import (all_orgs=true)

```
source_version: service_check_sheet_v121_3, field_count: 239

Paneltec Pty Ltd          → created  retired=1  id=4bb6447b-f33f-4bd4-acb8-a2f89c2977e7
Paneltec Civil Pty Ltd    → created  retired=1  id=3e8e3b38-c952-4997-a9f8-6b39645b83c2
5× Test Organisation      → created  retired=1 each
Test Org (×2)             → created  retired=1 each
```

- **Master template ID (Paneltec Pty Ltd):** `4bb6447b-f33f-4bd4-acb8-a2f89c2977e7`
- **field_count:** unchanged at **239** (same shape, only nesting moved)
- **Options-nesting audit:** 96 radio/select fields with **top-level** options, 0 broken (was 0 top-level, 96 broken on `.132jz`)

## Verification

### Curl — first 5 radios on the new template
```
Engine Oil     options=['✓ Check', '✗ Repair', 'N/A']
Oil Filter     options=['✓ Check', '✗ Repair', 'N/A']
Air Filter     options=['✓ Check', '✗ Repair', 'N/A']
Cabin Filter   options=['✓ Check', '✗ Repair', 'N/A']
Fuel Filter    options=['✓ Check', '✗ Repair', 'N/A']

Select field:
Service Level  options=['Custom (free-form)', 'Minor · …', 'Intermediate · …', 'Major · …', 'Heavy Overhaul · …']
```

### Trailer scan
`GET /api/scan/evztUZrfNU/forms`: **1 SCS template** returned (no duplicates from `.132jy`/`.132jz` — those retired), field_count=239, reasons=`['asset_type:trailer']`.

### Web preview screenshot
Screenshot at `/tmp/scs_light_checklist.png` confirms:
- Section header `▪ Light Vehicle Service Checklist (18 items — mark each row Tick / X / N/A)` renders with emerald tint from `.132jz` styling.
- **Engine Oil** row shows 3 trinary buttons: `✓ Check` (emerald outline), `✗ Repair` (rose outline), `N/A` (slate outline).
- **Engine Oil — notes** text input renders directly below.
- Oil Filter, Air Filter, Cabin Filter, Fuel Filter rows all render identically.
- `.132jz` `ColouredRadioGroup` tick/cross detection is firing correctly — emerald + rose palettes applied per option string.

### Current visual vs source screenshot
Current renders each item **stacked vertically**:
```
[Label]
[✓ Check] [✗ Repair] [N/A]
[Notes text field]
```

Source `ServiceCheckSheetModal.jsx` renders **inline**:
```
[Label 40%] [X 8%] [✓ 8%] [NA 8%] [Notes 36%]
```

Close but not identical. If the user wants strict inline-single-row layout, that would need either:
- A new `field.layout: "inline_with_notes"` CSS-grid hint in the `.132jk` style schema, OR
- The full `service_check_row` compound field type originally proposed

Both are follow-ups. This ship delivers the trinary buttons + colours the user complained about.

## Files touched
- `backend/admin_forms_import_service_check_sheet.py` — 3 options-key moves, bumped source to `v121_3`, widened `_retire_old_source` to sweep both `v121_1` + `v121_2`, updated seed marker to `132ka`.
- `frontend/src/lib/version.js` — `.132jz` → `.132ka` on RUNNING_VERSION + EXPECTED_CACHE_VERSION.
- `frontend/public/service-worker.js` — `.132jz` → `.132ka` on CACHE_VERSION.

## NOT changed
- No new `service_check_row` field type added (scope reverted per user directive).
- Mobile code unchanged. `mobile/app.json` stays at `1.0.36/158`. Mobile bundle version stays at `.132jz`.
- EAS build `4edbbaaa-2254-4c84-a1c8-c77de4be973f` NOT cancelled — will finish as v1.0.36 and render the fixed data correctly.
- No pytests written per Fast-Ship rule.
- No `testing_agent` invoked.
