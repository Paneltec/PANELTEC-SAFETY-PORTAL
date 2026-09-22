# v58.13.132kd1 — Hotfix: section-group folding for regular-field sections

## User report
> "C. Tires and Wheels should collapse the questions after the header, same with others of this type"

## Hypothesis verified & disproven
Field-order audit of the master SCS template (`4bb6447b-...`) confirmed that C. Tires and Wheels contains 6 radio+text pairs — all of which fold into `checklist_row` entries in Pass 1 of `buildFieldRenderPlan`. DOM inspection also confirmed `section-body-C` did contain all 6 rows in `.132kd`. So the specific complaint about C was NOT reproducible against the master template.

However, the underlying fold predicate in `.132kd` was fragile: it required `hasChecklist || hasHeavyMeasure` on the block content. Any future section with only regular fields (text/number/date/select) would silently fail to fold. Additionally, `Consumables & Follow-Up` was folding (its 2 heavy_truck_only fields tripped `hasHeavyMeasure`) even though it should render flat per acceptance criterion #4.

## Fix applied

### Pass 2 predicate — content-agnostic
```js
const FLAT_ZONE_RE = /(vehicle details|service level|consumables|parts used|attachments|sign.?off|signatures|follow.?up)/i;
```

New rule:
- **Fold EVERY** `text` field with `config.section_header: true`
- UNLESS the label matches `FLAT_ZONE_RE` → render as regular styled field
- Block extends to the next section header OR end of `template.fields`
- Empty blocks fall through (still render header as regular field)

### Chip visibility
Added `hasTrinary: block.some(b => b.kind === 'checklist_row')` to each `section_group` node. `<CollapsibleSectionGroup>` now hides both `+ ADD` and `✓ ALL` chips when `!group.hasTrinary` — those affordances only make sense for trinary checklist sections. Tread Depths (14 number fields, no trinary) now shows only the `NOT STARTED / IN PROGRESS / COMPLETE` status pill.

### Status pill for regular-field sections
No changes needed — `computeSectionStatus` already handled `text/textarea/number/select/date` counting fields. `IN PROGRESS` / `COMPLETE` / `NOT STARTED` compute correctly. `ATTENTION` (requires `X`) simply never triggers on non-trinary sections.

## Non-regression matrix

| Section | Type | Before (.132kd) | After (.132kd1) |
|---|---|---|---|
| ▪ Vehicle Details | flat regular fields | flat ✅ | flat ✅ |
| Service Level select | flat | flat ✅ | flat ✅ |
| ▪ Light Vehicle Checklist | 18 checklist rows | grouped, clipboard icon | grouped, clipboard icon |
| ▪ Heavy Vehicle Additional Checks | supergroup label (empty block) | flat ✅ | flat ✅ |
| A. Engine .. K. Hitches | 4–17 checklist rows each | grouped, letter badge | grouped, letter badge |
| ▪ Tread Depths | 14 number fields (heavy_truck_only) | **grouped w/ +ADD ✓ALL** ❌ | **grouped, chips hidden** ✅ |
| ▪ Consumables & Follow-Up | 6 mixed fields (some heavy_truck_only) | **grouped (wrong)** ❌ | flat ✅ |
| ▪ Attachments & Sign-Off | attachment + 2 signatures | flat ✅ | flat ✅ |
| Prestart / SWMS / Hazard / Incident | no `section_header` fields | unchanged | unchanged |

## Verification (screenshots attached above)

**1. Fresh load — all A-K collapsed cleanly** (`/tmp/scs_kd1_1_all_collapsed.png`)
All 11 A-K sections + Tread Depths collapsed. No fields leaking below any header. Each section shows the letter badge + `NOT STARTED` + `+ ADD` + `✓ ALL` chips (trinary sections).

**2. C. Tires and Wheels expanded** (`/tmp/scs_kd1_2_c_expanded.png`)
- DOM check: `{body_exists: True, rows_inside: 6}` ✅
- All 6 rows visible inside the section body: Tire pressure, Wheels inspected for cracks, Wheel seals inspected for leaks, Studs & nuts inspected, Tire wear (record tread depth below), Retorque wheels — each with trinary pills + Notes input
- D. Clutch collapses cleanly directly below C body

**3. C collapsed again + non-trinary Tread Depths** (`/tmp/scs_kd1_3_c_collapsed_again.png`)
- DOM check: `{body_still_present: False}` ✅
- C. Tires and Wheels back to single-row collapsed state, rows hidden
- **Tread Depths (32nds — heavy trucks only)**: chevron + gauge icon + `NOT STARTED` pill, but **NO `+ ADD` and NO `✓ ALL` chips** (0 trinary rows → chips hidden per acceptance criterion 6+7)
- **Consumables & Follow-Up**: renders as flat regular section-styled field (no chevron) per acceptance criterion 4 ✅ (was incorrectly folding in `.132kd`)

DOM audit console output:
```
Post-fix keys: ['section-toggle-hdr-8521b416', 'section-toggle-A', ..., 'section-toggle-K', 'section-toggle-hdr-cf197530']
consumables_folded_as_group: False
```
`hdr-8521b416` = Light Vehicle Service Checklist. `hdr-cf197530` = Tread Depths. A-K = the letter sections. No Consumables or Attachments header appears as a toggle key. ✅

## Files touched

- `frontend/src/pages/Forms.jsx`
  - `buildFieldRenderPlan` Pass 2: content-agnostic fold + `FLAT_ZONE_RE` guard + `hasTrinary` flag on each `section_group`
  - `<CollapsibleSectionGroup>`: `+ ADD` and `✓ ALL` chips gated on `group.hasTrinary`
- `frontend/src/lib/version.js` — `.132kd` → `.132kd1`
- `frontend/public/service-worker.js` — `.132kd` → `.132kd1`

## NOT changed
- `/app/mobile/` — untouched
- Backend / template data — no re-import needed
- No pytests written (Fast-Ship rule)
- No `testing_agent` invoked
- Not pushed to remote
