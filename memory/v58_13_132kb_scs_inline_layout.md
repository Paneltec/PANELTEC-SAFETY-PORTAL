# v58.13.132kb — Strict inline SCS row layout

## User feedback on `.132ka`
> The default `ColouredRadioGroup` stacks pills below the label; user wants the exact source `ServiceCheckSheetModal.jsx` visual — label · pills · notes on a single horizontal row per checklist item.

## Fix — renderer-level inline row (no template shape change, Path A)

Added detection + inline renderer in `frontend/src/pages/Forms.jsx`:

### Detection helpers
```js
isTrinaryChecklistRadio(f)   // radio + exactly 3 options that classify as check/cross/na
findPairedNotesField(radio, allFields, idx)  // next field is text with label "{radio.label} — notes"
classifyTrinaryOption(opt)   // → 'check' | 'cross' | 'na' | null
buildFieldRenderPlan(fields) // returns [{kind: 'checklist_row', radio, notes} | {kind: 'field', field}]
```

Suffix matcher accepts em-dash / en-dash / hyphen (`— notes`, `– notes`, `- notes`) since the `.132ka` import uses em-dash.

### `InlineChecklistRow` component

CSS-grid `grid-cols-12` on `md:` breakpoint, stacked on mobile:
- **Label** — `md:col-span-5` (~40%)
- **Pills row** — `md:col-span-3` (~24%): X · ✓ · NA
- **Notes input** — `md:col-span-4` (~36%)

Pill styling (h-9, min-w-42, rounded-md):
- Idle: `bg-white border-slate-200 text-slate-700`
- X selected: `bg-rose-500 text-white shadow-sm`
- ✓ selected: `bg-emerald-500 text-white shadow-sm`
- NA selected: `bg-slate-600 text-white shadow-sm`

Row-level state tint (overrides `.132jz` zebra when a value is selected):
- X → `bg-#FFF1F2` + `border-#F43F5E`
- ✓ → `bg-#ECFDF5` + `border-#10B981`
- NA → `bg-#F1F5F9` + `border-#64748B`
- unset → falls back to `field.style` zebra (`.132jz` `#F9FAFB / #FFFFFF`)

Testids:
- `checklist-row-{radio.id}` (wrapper, with `data-checklist-state={check|cross|na|unset}`)
- `checklist-pills-{radio.id}` (pill container)
- `checklist-cross-{radio.id}` / `checklist-check-{radio.id}` / `checklist-na-{radio.id}` (each pill)
- `checklist-notes-{notes.id}` (notes input)

### Integration

Both render loops in `Forms.jsx` now call `buildFieldRenderPlan(template.fields || [])` and dispatch each entry:
- `kind === 'checklist_row'` → `<InlineChecklistRow>`, notes field consumed (skipped)
- `kind === 'field'` → existing stacked renderer (unchanged for pre-starts, toolbox, incidents, etc.)

Loops updated:
1. **Main FormRunner** (`.132kb` line ~1006) — values wired via `setField(r.id, ...)` and `setField(n.id, ...)`.
2. **PreviewModal** (`.132kb` line ~1168) — read-only render with null values.

### No regressions
- Non-trinary radios (Pass/Fail/N-A, Yes/No, custom options) continue to render as before via `ColouredRadioGroup`.
- Trinary radios NOT paired with a `" — notes"` sibling render normally.
- `missingFields` / `missingIds` / submission serialisation all still operate on the flat `template.fields[]` array — the inline layout is presentation-only.
- Progress counter (`COMPLETE: VEHICLE, TECHNICIAN +17` → `+20` after 3 pills selected) increments correctly.
- Section headers from `.132jz` (`▪ Light Vehicle Service Checklist...` with emerald tint) unchanged.

## Verification screenshots

Captured at `/tmp/scs_inline_1_default.png` and `/tmp/scs_inline_2_states.png` against `https://whs-compliance.preview.emergentagent.com/app/forms` after logging in as `stephen@paneltec.com.au` and clicking "Fill" on the SCS template.

**Default state (all rows unset):**
```
Engine Oil *      [ ✗ ] [ ✓ ] [ NA ]   [ Notes____________ ]
Oil Filter *      [ ✗ ] [ ✓ ] [ NA ]   [ Notes____________ ]
Air Filter *      [ ✗ ] [ ✓ ] [ NA ]   [ Notes____________ ]
Cabin Filter *    [ ✗ ] [ ✓ ] [ NA ]   [ Notes____________ ]
Fuel Filter *     [ ✗ ] [ ✓ ] [ NA ]   [ Notes____________ ]
```

**All 3 states shown:**
- Row 1 (Engine Oil): X selected → **rose-50 row tint** + bright **rose-500 X pill** + notes "Topped up 2L"
- Row 2 (Oil Filter): ✓ selected → **emerald-50 row tint** + bright **emerald-500 ✓ pill**
- Row 3 (Air Filter): NA selected → **slate-100 row tint** + **slate-600 NA pill**

Preserved:
- Service Level `<select>` still renders stacked (non-checklist)
- Vehicle Details section (Service Date, Vehicle, Technician, Company, Mileage, Hours, Make/Model, VIN) still stacked

Matches the user's reference screenshot from `ServiceCheckSheetModal.jsx` — single horizontal row per item, coloured pills, tinted rows on selection, notes on the right.

## Files touched

- `frontend/src/pages/Forms.jsx` — added detection helpers + `InlineChecklistRow` component, rewired both `template.fields.map(...)` loops (main runner + preview modal) to consume `buildFieldRenderPlan()`.
- `frontend/src/lib/version.js` — `.132ka` → `.132kb` on RUNNING_VERSION + EXPECTED_CACHE_VERSION.
- `frontend/public/service-worker.js` — `.132ka` → `.132kb` on CACHE_VERSION.

## NOT changed
- Backend — no template re-import, no new field types, no data migration.
- Mobile — `mobile/app/forms/[id]/index.tsx` unchanged. Mobile keeps the stacked `ColouredRadioGroup`-style layout for touch ergonomics. Any mobile inline layout would go through `e1_expo_frontend_dev` as a separate ship.
- EAS build `4edbbaaa` (v1.0.36/158) NOT cancelled — will finish and render the fixed `.132ka` data correctly with the mobile stacked layout.
- No pytests written per Fast-Ship rule.
- No `testing_agent` invoked.
