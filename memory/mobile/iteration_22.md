## Iteration 10 — v58.13.132dp: Mobile Picker Parity (7 field types)
- **Commit**: 19472158f (pre-commit, same environment)
- **Date**: 2026-09-18
- **Changes**:
  - Replaced gray "fill on web app" stubs for 7 picker field types with real React Native implementations
  - Created `/app/mobile/src/components/pickers/PickerModal.tsx` — shared full-screen modal (search + FlatList + selection)
  - Created `/app/mobile/src/components/pickers/PickerFields.tsx` — all 7 picker components:
    1. `worker_picker` — supports `multi: true` (chip cluster with × remove) and `inline_company_toggle` (company filter chips above search)
    2. `vehicle_navixy` — modal vehicle list from `/api/forms/fleet/vehicles`, manual rego fallback, Navixy disconnect banner
    3. `customer_picker` — modal search from `/api/forms/pickers/customers`, company label display
    4. `site_picker` — modal search with GPS "use current location" pinned row via expo-location, `dependsOn` filtering
    5. `job_picker` — modal search with `dependsOn` filtering (customer/site), blocked state when dependency unmet
    6. `asset_scan` — modal manual pick from `/api/forms/assets/picker` (QR camera scan deferred — desktop web preview only)
    7. `contact_picker` — text input fallback (no backend endpoint exists)
  - Created `/app/mobile/src/services/pickerApi.ts` — typed API fetch helpers for all picker endpoints
  - Updated `app/forms/[id]/index.tsx`:
    - Added picker imports
    - FieldRenderer now receives `allValues` + `allFields` props for dependsOn logic
    - Replaced unsupported-type catch-all with 7 picker conditionals
    - Enhanced ReviewField with display logic for all 7 picker value shapes
  - All linting passes clean (0 errors, 0 warnings on all new/changed files)
  - Metro bundles cleanly, no crashes
- **Files modified**:
  - NEW: `src/components/pickers/PickerModal.tsx`
  - NEW: `src/components/pickers/PickerFields.tsx`
  - NEW: `src/services/pickerApi.ts`
  - MODIFIED: `app/forms/[id]/index.tsx`
- **Web files referenced**:
  - `/app/frontend/src/components/forms/PickerFields.jsx` (main reference)
  - `/app/frontend/src/components/forms/AssetScanField.jsx` (asset_scan reference)
  - `/app/frontend/src/pages/Forms.jsx` (integration pattern reference)
- **API endpoints used**:
  - `GET /api/forms/pickers/workers` (with ?q=, ?company_id=)
  - `GET /api/forms/fleet/vehicles`
  - `GET /api/forms/pickers/customers` (with ?q=)
  - `GET /api/forms/pickers/sites` (with ?q=, ?customer_id=, ?lat=, ?lng=)
  - `GET /api/forms/pickers/jobs` (with ?q=, ?status=, ?customer_id=, ?site_id=)
  - `GET /api/forms/assets/picker` (with ?q=)
- **Screenshot evidence**: Customer picker modal (list of customers), Vehicle picker modal (list of vehicles), selected customer chip (green emerald), form with all pickers rendered (HVDC + Daily Site Inspection)
- **Known limitations**:
  - `asset_scan` QR camera mode not functional on web preview (desktop browser lacks mobile camera); manual pick works
  - `contact_picker` is a text input fallback (no backend endpoint)
  - Web `Modal` in Expo may not render identically on native devices (untested on physical device)
