# v58.13.132jy — QR-context locked field mode + Service Check Sheet as Form Template

## Part 1 — QR → Form Runner context lock

### Prefill investigation findings

Existing `.132jr` prefill logic in `mobile/app/forms/[id]/index.tsx` (lines 154-199):

```ts
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
for (const f of template.fields) {
  if (next[f.id] && next[f.id] !== '' && next[f.id] !== null) continue;
  const combined = norm(f.id) + ' ' + norm(f.label);
  // vehicle_navixy → asset object
  // /rego|registration|plate|vehiclereg/ → assetRego
  // /vehiclename|assetname|equipment|machine|plantid|assetid|plantname/ → assetName
  // /\btag\b/ → assetTag
}
```

Verdict: **prefill logic is correct**. Normalisation strips lowercase + whitespace/underscore/hyphen. Regex covers all the cases in the spec (`vehicle_rego`, `rego`, `Vehicle Rego`, `plateNumber`, `plate_number`, `vehicle_name`, `asset_name`, `equipment_name`, `plant_name`, `asset_id`, `vehicle_id`, `plant_id`).

**Gap**: prefilled fields were still user-editable. Nothing prevented a worker from accidentally overtyping the rego/name after scanning.

### Fix — Locked mode (this ship)

Added an authoritative "locked from QR scan" render mode. When Form Runner is opened from asset context (query params `assetId` + friends):

1. **Sticky orange header** (`#F17222` bg, white text) below the main header:
   ```
   🔒 FILLING FOR
      {assetName} · {assetRego}
   ```
   testid `asset-context-header`.

2. **Prefilled fields are locked**:
   - Amber tint (`bg #FFF7ED`, border `#FED7AA`) on the input wrapper.
   - Small orange "🔒 LOCKED" pill next to the field label (testid `field-locked-badge-{fieldId}`).
   - `editable={false}` on `TextInput`s.
   - Pickers wrapped in `<View pointerEvents="none">` so taps are absorbed.
   - `onChange` swapped to a no-op inside FieldRenderer.
   - Field-type hint replaced with `"Locked from QR scan"`.

3. **Unlocked fields (everything not asset-context)** render normally — worker still fills odometer, defects, signature, etc.

Implementation details:
- New state `lockedFieldIds: Set<string>`, populated by the prefill effect for every field it touches.
- `FieldRenderer` accepts new `locked?: boolean` prop.
- Locked-mode style constants added to `s.assetContextHeader`, `s.lockedInput`, `s.lockedBadge`, `s.lockedBadgeText`.

## Part 2 — Service Check Sheet imported as Form Template

### Source
`frontend/src/components/ServiceCheckSheetModal.jsx` (v58.13.121) — the 18-item vehicle service checklist ("Log service (Check Sheet)" button in the Fleet & Service Register drawer).

### Field list (52 total)

**Vehicle Details (8 fields)**
| Field | Type | Required |
|---|---|---|
| Service Date | date (default_today) | ✓ |
| Vehicle | vehicle_navixy | ✓ |
| Technician | worker_picker (inline_company_toggle) | ✓ |
| Company (if external) | text | — |
| Mileage at Service (km) | number | — |
| Hours at Service | number | — |
| Make / Model | text | — |
| VIN | text | — |

**Service Level (1 field)** — select with 5 options: Custom, Minor, Intermediate, Major, Heavy Overhaul.

**18-item Checklist (36 fields — 2 per item)**
For each of `Engine Oil, Oil Filter, Air Filter, Cabin Filter, Fuel Filter, Coolant, Brake Fluid, Power Steering Fluid, Windscreen Washer Fluid, Auxiliary Belt, Battery Condition, Tyres, Brakes, Suspension, Steering, Exhaust, Lights, Wipers`:
- `<Item> — status` → radio [Checked / Replaced / Not applicable] (required)
- `<Item> — notes` → text (optional)

**Advisory / Comments (1 field)** — textarea.

**Next Service Due (3 fields)**
| Field | Type |
|---|---|
| Next Service Due (km) | number |
| Next Service Due (hours) | number |
| Next Service Due Date | date |

**Attachments (1 field)** — attachment (multiple).

**Signatures (2 fields)**
- Technician Signature — signature (required)
- Customer Signature — signature (optional)

### New endpoint
```
POST /api/admin/forms/import-service-check-sheet
  body: { all_orgs?: bool = false }
  auth: admin role only
```

Idempotent — matches on `(org_id, original_source="service_check_sheet_v121_1")` and upserts. Second run reports `action=updated`, first run reports `action=created`.

### Template metadata
| Field | Value |
|---|---|
| name | Vehicle Service Inspection — Service Check Sheet |
| category | inspection |
| original_source | service_check_sheet_v121_1 |
| applies_to.asset_types | ute, trailer, tipper, vacuum_truck, excavator, service_truck, commercial, compactor, crane_truck, directional_drill, loader |
| applies_to_meta | { manual: false, auto_seeded_at, seeded_by: "132jy" } |
| field_count | 52 |

### Live import run

**All-orgs idempotent upsert** (11 orgs, all created except Paneltec Pty Ltd which was created in the first solo run then updated):
```
Paneltec Pty Ltd          → template_id=508c978a-4795-4ac3-90b5-b0fa3082607a  (action=updated)
Paneltec Civil Pty Ltd    → template_id=78ba1c4c-cdba-47e6-9505-5e893ffbd5a8  (action=created)
5× Test Organisation      → separate ids per org
Test Org (×2)             → separate ids per org
```

**Paneltec Pty Ltd master template**: `508c978a-4795-4ac3-90b5-b0fa3082607a`.

### Verification via `/api/scan/{token}/forms`

- ✅ **Trailer** (`evztUZrfNU`, kind=trailer, asset_type=Trailer):
  `Vehicle Service Inspection — Service Check Sheet` → reasons=`['asset_type:trailer']`
- ✅ **Vacuum truck** (`yTtV1KWWmE`, kind=vehicle, asset_type=vacuum_truck):
  `Vehicle Service Inspection — Service Check Sheet` → reasons=`['asset_type:vacuum_truck']`

## Files touched

Backend:
- `backend/admin_forms_import_service_check_sheet.py` — NEW. `/admin/forms/import-service-check-sheet` endpoint + 52-field builder.
- `backend/server.py` — mounted the new router.

Frontend (web):
- `frontend/src/lib/version.js` — `.132jx` → `.132jy` (RUNNING_VERSION + EXPECTED_CACHE_VERSION).
- `frontend/public/service-worker.js` — `.132jx` → `.132jy` (CACHE_VERSION).

Mobile:
- `mobile/app/forms/[id]/index.tsx` — added `lockedFieldIds` state, extended prefill effect to record locks, added sticky asset-context header, extended `FieldRenderer` to render locked mode (read-only inputs, orange badge, pointerEvents="none" on pickers), added styles.
- `mobile/src/lib/version.ts` — `.132jw` → `.132jy`.
- `mobile/app.json` — `1.0.34/156` → `1.0.35/157` (buildNumber + versionCode).

## EAS build kicked

Build ID: `08fcef3b-965b-475a-814f-64213b3fc7ae`
Profile: `preview-apk`
Version: `1.0.35 / 157`
Status at ship time: `IN_PROGRESS`

Prior `da85a6aa` (`1.0.34/156`) was FINISHED, not still queued — no cancellation needed.

## NOT changed
- Auto-seed heuristic module from `.132jx` — untouched. The new template's `applies_to` is manually set at import time (bypasses auto-seed rules).
- Backend `applies_to_meta.manual` stamping in `asset_service.py` — the import writes `manual: false` explicitly so a future auto-seed still respects the row (but auto-seed's non-destructive rule will preserve it anyway because the 11 asset_types populated make it "already narrowed").
- No pytests written per Fast-Ship rule (not touching auth/deletions/PII).
- No `testing_agent` invoked.
