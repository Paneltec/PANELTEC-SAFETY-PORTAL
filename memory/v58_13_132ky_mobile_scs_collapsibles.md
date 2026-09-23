# .132ky — SCS Collapsible Section Group Parity with Web .132kd1

## Commit
- **Hash**: `853fbebe`
- **Version**: v1.0.44 / build 166
- **Date**: 2026-09-22

## What was built

Ported the web's collapsible section-group system from `.132kd` / `.132kd1` to mobile. The Service Check Sheet (SCS) form now renders section headers as collapsible groups identical to the web implementation.

### Features implemented

1. **Collapsible section headers** — Each section header inside the checklist supergroup folds into a collapsible group with:
   - Chevron (▸ collapsed / ▾ expanded)
   - Letter badge with section-specific colour palette (A amber, B sky, C cyan, D violet, E emerald, F rose, G indigo, H blue, I teal, J slate, K amber)
   - Gauge/speedometer icon for Tread Depths (non-letter section)
   - Clipboard icon for other non-letter sections
   - Truncated label (letter prefix stripped — badge shows it)
   - Status pill: `NOT STARTED` (slate) / `IN PROGRESS` (amber) / `COMPLETE` (emerald) / `ATTENTION` (rose, wins on any ✗)

2. **✓ ALL chip** — Fills empty trinary rows with ✓ (never clobbers existing ✗ or NA). Alert toast: "N items marked ✓"

3. **+ ADD chip** — Appends editable custom checklist row:
   - Editable label (tap to edit, auto-focus on new row)
   - Trinary pills (✗ / ✓ / NA)
   - Notes text input
   - Delete button (✕)
   - Purple left border accent
   - Persisted in `values.__custom_checklist_rows__` (rides along with draft autosave + form submission)

4. **Expand all / Collapse all** master toggle — Top of scroll body, toggles all section groups

5. **Section expansion persistence** — AsyncStorage-backed per-template (`scs-expansion-{templateId}`)

6. **Content-agnostic fold** (from `.132kd1` hotfix) — Fold subsequent fields until next `section_header` OR boundary label (`Vehicle Details`, `Service Level`, `Consumables`, `Parts Used`, `Attachments`, `Sign-Off`, `Signatures`, `Follow-Up`)

7. **Hidden chips** — `✓ ALL` and `+ ADD` hidden on sections with zero trinary radios (e.g. Tread Depths)

### Non-regression
- Non-SCS templates (Prestart, SWMS, Hazard, Incident, visitor form) unchanged
- Inline row layout from `.132kc` preserved inside collapsible bodies
- Form submission serialisation unchanged

## New files
- `/app/mobile/src/lib/checklistDetect.ts` — Extended with Pass 2 section-group folding, palette, status computation
- `/app/mobile/src/components/forms/CollapsibleSectionGroup.tsx` — Collapsible section component
- `/app/mobile/src/components/forms/CustomChecklistRow.tsx` — Editable custom checklist row
- `/app/mobile/src/hooks/useSectionExpansion.ts` — AsyncStorage expansion state hook

## Modified files
- `/app/mobile/app/forms/[id]/index.tsx` — Integrated section groups in fill + review modes, custom rows state, expand/collapse all toggle
- `/app/mobile/app.json` — v1.0.44 / build 166
- `/app/mobile/src/lib/version.ts` — `paneltec-v166.3.9.58.13.132ky`

## Section key mapping (from API `sub_section` field)
| Section | Key | Badge | Palette |
|---------|-----|-------|---------|
| A. Engine | `A` | Letter | Amber |
| B. Steering | `B` | Letter | Sky |
| C. Tires and Wheels | `C` | Letter | Cyan |
| D. Clutch and Transmission | `D` | Letter | Violet |
| E. Safety Equipment | `E` | Letter | Emerald |
| F. Brakes | `F` | Letter | Rose |
| G. Driveline and Differentials | `G` | Letter | Indigo |
| H. Electrical, Cab & Accessories | `H` | Letter | Blue |
| I. Auxiliary Equipment | `I` | Letter | Teal |
| J. Frame and Suspension | `J` | Letter | Slate |
| K. Hitches | `K` | Letter | Amber |
| Tread Depths | `hdr-cf197530` | Gauge icon | Neutral |
| Light Vehicle Service Checklist | `hdr-8521b416` | Clipboard | Neutral |

## Verification screenshots
1. ✅ All sections collapsed — A through G visible with letter badges + NOT STARTED pills
2. ✅ Engine/Light Vehicle expanded — inline rows with ✗/✓/NA pills + Notes
3. ✅ Brakes with ✗ selected → ATTENTION pill (red) + custom row with editable label
4. ✅ Steering with ✓ ALL → COMPLETE pill (green), all rows green-tinted
5. ✅ Tread Depths — gauge icon, NO ✓ ALL / + ADD chips
6. ✅ Expand all master toggle visible at top

## Web files referenced
- `frontend/src/pages/Forms.jsx` — `buildFieldRenderPlan`, `CollapsibleSectionGroup`, `computeSectionStatus`, `useSectionExpansion`, `CustomChecklistRow`
- `/app/memory/v58_13_132kd_collapsible_section_groups.md`
- `/app/memory/v58_13_132kd1_section_fold_hotfix.md`
