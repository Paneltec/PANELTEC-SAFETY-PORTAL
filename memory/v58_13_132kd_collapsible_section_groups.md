# v58.13.132kd — Collapsible section groups on Service Check Sheet

## User feedback on `.132kb`
> On a given service, only some sections apply (a light vehicle service doesn't touch Hitches). Collapse until needed — every checklist section should collapse by default and expand on tap. Add letter badges, live status pills, `✓ ALL`, `+ ADD`, and section colour tints.

## Approach — renderer-level grouping (no template shape change)

Extended `buildFieldRenderPlan(fields)` in `frontend/src/pages/Forms.jsx` with a second pass that folds each `text` field carrying `config.section_header: true` plus its subsequent content block into a `section_group` node — **but only when the block contains at least one `checklist_row` OR at least one field with `heavy_truck_only`**. Non-checklist section headers (Vehicle Details, Attachments & Sign-Off, etc.) still render as regular styled fields.

Detection rules:
- Letter badge auto-derived from `label` prefix `/^([A-K])\.\s/` OR `config.sub_section`
- `Tread Depths` (regex `/tread/i`) → gauge icon instead of letter
- Non-lettered checklist container (e.g. "Light Vehicle Service Checklist") → clipboard icon
- Section key priority: `config.sub_section` > `sub-{letter}` > `hdr-{id-prefix}`

## Components added

### `<CollapsibleSectionGroup>`
- Header row: chevron (▸/▾) + letter/gauge/clipboard badge + label + status pill + `+ ADD` + `✓ ALL`
- Click anywhere on header → toggle expand/collapse
- Faint section-tint background when collapsed; white body when expanded (`bg`/`border-l` from `SCS_SECTION_PALETTE` per letter)
- Body renders `InlineChecklistRow` for checklist rows (from `.132kb`) + `FieldRunner` for regular fields (tread numbers) + `CustomChecklistRow` for `+ ADD` rows

### `<CustomChecklistRow>`
- Same grid layout as `InlineChecklistRow`, with editable label (click-to-edit, blur/Enter to commit)
- Trinary pills X · ✓ · NA with same colour behaviour
- Hover → `×` delete button appears
- Row-tint follows selection state

### `computeSectionStatus(entries, values)`
- Returns `{ATTENTION | NOT STARTED | IN PROGRESS | COMPLETE}` with palette
- **ATTENTION** (rose) — any `checklist_row` has `X`
- **NOT STARTED** (slate) — zero countable fields answered
- **IN PROGRESS** (amber) — some answered, not all
- **COMPLETE** (emerald) — all answered, no `X`
- Custom rows included in computation

### `useSectionExpansion(templateId)` hook
- Section open state persisted to `sessionStorage` under `scs-expansion-{templateId}`
- Fresh session → all collapsed
- Returns `{ openKeys, toggle, setAll }`
- Master `Expand all` / `Collapse all` toggle wired at top of scroll body when ≥1 group exists

## Palette per letter (matches `.132jz` backend)

| Letter | Badge | Tint |
|---|---|---|
| A, K | amber `#F59E0B` | `#FFFBEB` |
| B | sky `#0EA5E9` | `#F0F9FF` |
| C | cyan `#06B6D4` | `#ECFEFF` |
| D | violet `#8B5CF6` | `#F5F3FF` |
| E | emerald `#10B981` | `#ECFDF5` |
| F | rose `#F43F5E` | `#FFF1F2` |
| G | indigo `#6366F1` | `#EEF2FF` |
| H | blue `#3B82F6` | `#EFF6FF` |
| I | teal `#14B8A6` | `#F0FDFA` |
| J | slate `#64748B` | `#F8FAFC` |

## Custom rows persistence

- New state `customChecklistRows: {[sectionKey]: [{id, label, value, notes}]}` on FormRunner
- Mirrored into `values.__custom_checklist_rows__` via useEffect so it rides along with draft autosave + submission serialisation
- On mount, rehydrated from `values.__custom_checklist_rows__` if present
- Handlers: `addCustomRow(sectionKey)`, `updateCustomRow(sectionKey, rowId, patch)`, `deleteCustomRow(sectionKey, rowId)`

## `✓ ALL` behaviour

- Only fills EMPTY trinary radios — never overrides existing `X` / `✓` / `NA`
- Also fills empty custom rows in the section
- Toast: `"N item(s) marked ✓"`
- Verified: clicking `✓ ALL` on Steering (8 rows) → toast reads `"8 items marked ✓"`, pill turns emerald `COMPLETE`

## Non-regressions

- Non-section-header fields render via existing `renderRegularField` helper (extracted for reuse)
- Non-checklist forms (Prestart, SWMS, Hazard, Incident) → no section headers with `config.section_header: true`, plan pass 2 is a no-op, they render identically to `.132kb`
- Non-trinary radios (Pass/Fail/N-A, Yes/No) → still detected by `.132kb` `isTrinaryChecklistRadio` returning false → render as classic `ColouredRadioGroup`
- `missingFields` / `missingIds` / submission serialisation unchanged — inline row and section group are presentation-only
- `PreviewModal` also handles section groups (read-only, always-expanded)

## Verification screenshots

Captured at `https://whs-compliance.preview.emergentagent.com/app/forms` logged in as `stephen@paneltec.com.au` on the Service Check Sheet template.

**1. Fresh load — all collapsed** (`/tmp/scs_kd_1_all_collapsed.png`)
- Vehicle Details section renders as regular field (no chevron)
- Service Level select renders normally
- Light Vehicle Service Checklist collapsed with clipboard icon, `NOT STARTED`, `+ ADD`, `✓ ALL`
- A. Engine (amber), B. Steering (sky), C. Tires and Wheels (cyan) all collapsed with their letter badges

**2. Lower sections — all collapsed** (`/tmp/scs_kd_2_lower_sections.png`)
- D. Clutch (violet), E. Safety (emerald), F. Brakes (rose), G. Driveline (indigo), H. Electrical (blue), I. Auxiliary (teal), J. Frame (slate), K. Hitches (amber)
- Tread Depths section with gauge icon (teal)
- Consumables & Follow-Up section with chevron + pill (contains heavy_truck_only fields)
- Attachments & Sign-Off renders as regular field

**3. Engine expanded + ATTENTION state** (`/tmp/scs_kd_3_engine_expanded_attention.png`)
- Chevron rotated (▾) on Engine header
- Status pill flipped to **`ATTENTION` rose** because `X` selected on Oil changed
- Oil changed row: rose row tint + bright rose `X` pill
- Oil filter changed row: emerald row tint + bright emerald `✓` pill
- 15+ other rows visible inline

**4. Steering COMPLETE + Brakes custom row** (`/tmp/scs_kd_4_add_and_check_all.png`)
- Toast top-right: **`8 items marked ✓`** (from `✓ ALL`)
- B. Steering collapsed with **`COMPLETE` emerald pill** (all 8 rows auto-filled)
- F. Brakes expanded with rose F badge
- Custom row visible at bottom of Brakes: **`Emergency brake test`** with 3 trinary pills + Notes input, matching the regular row layout

All 14 acceptance criteria met. Master `Expand all` toggle visible at top of scroll body in every screenshot.

## Files touched

- `frontend/src/pages/Forms.jsx` — extended `buildFieldRenderPlan` with pass-2 folding, added `SCS_SECTION_PALETTE` + `paletteForSection` + `computeSectionStatus` + `useSectionExpansion` + `<CollapsibleSectionGroup>` + `<CustomChecklistRow>`. Extracted `renderRegularField` helper. Wired section groups into both `FormRunner` and `PreviewModal` render loops. Added lucide imports for `ChevronRight`, `Gauge`, `ClipboardList`, `CheckCheck`. Added custom-rows state + handlers.
- `frontend/src/lib/version.js` — `.132kb` → `.132kd` on RUNNING_VERSION + EXPECTED_CACHE_VERSION.
- `frontend/public/service-worker.js` — `.132kb` → `.132kd` on CACHE_VERSION.

## NOT changed
- `/app/mobile/` — untouched (mobile parity is a follow-up ship via `e1_expo_frontend_dev`).
- Backend — no template re-import, no schema changes, no data migration.
- Other form templates — non-regression via type-guarded plan folding.
- No pytests written per Fast-Ship rule.
- No `testing_agent` invoked.
- Not pushed to remote.

## Known minor cosmetic
- `Consumables & Follow-Up` header renders as a collapsible group (it has `heavy_truck_only` sub-fields), which is technically correct but the user's reference screenshot didn't show a chevron there. If unwanted, tighten the collapsibility rule to require `hasChecklist` only, dropping the `hasHeavyMeasure` clause. Left as-is for now since the section colour + status semantics still add value.
