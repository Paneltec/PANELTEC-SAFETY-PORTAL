# .132kc — Mobile Inline SCS Row Layout + Supervisor FATAL Fix

## Commit
`9f5025dd` — 2026-09-21

## Version
`1.0.37` / versionCode `159` / buildNumber `"159"` / bundle `.132kc`

---

## Task 1 — Supervisor FATAL Fix

**Status**: NOT NEEDED. Supervisor was already `RUNNING` (not FATAL). Disk at 64%. Expo binary symlink intact. Metro bundling 1576+ modules cleanly.

**Before**: `mobile RUNNING pid 159, uptime 0:36:16`
**After**: Same — no intervention required.

---

## Task 2 — Inline SCS Row Layout

Ported from web `.132kb` `InlineChecklistRow` implementation.

### Detection logic (new file: `src/lib/checklistDetect.ts`)
- `isTrinaryChecklistRadio(f)`: 3-option radio with ✓/✗/NA classified labels
- `findPairedNotesField(radio, fields, idx)`: adjacent text field with `{label} — notes` suffix (em-dash, en-dash, hyphen tolerant)
- `buildFieldRenderPlan(fields)`: returns `RenderEntry[]` — either `{kind:'field'}` or `{kind:'checklist_row', radio, notes}`, skipping absorbed notes fields
- `classifyTrinaryOption`, `findTrinaryOption`: utility functions for pill state

### InlineChecklistRow component (`src/components/forms/InlineChecklistRow.tsx`)
- Uses `useWindowDimensions()` to detect screen width
- **Phone portrait (<600dp)**: stacked layout — label → pills row → notes input below
- **Tablet / landscape (≥600dp)**: inline one-row — `[Label 5fr] [✗][✓][NA 3fr] [Notes 4fr]`

### Pill visual spec
| State | Pill bg | Text | Row tint |
|---|---|---|---|
| unset | `#FFFFFF` border `#E2E8F0` | `#334155` | white |
| ✗ selected | `#F43F5E` (rose-500) | white | `#FFF1F2` (rose-50) |
| ✓ selected | `#10B981` (emerald-500) | white | `#ECFDF5` (emerald-50) |
| NA selected | `#475569` (slate-600) | white | `#F1F5F9` (slate-100) |

### Form runner integration (`app/forms/[id]/index.tsx`)
- Fill mode: `buildFieldRenderPlan()` replaces direct `fields.map(FieldRenderer)`
- Review mode: same render plan for consistency
- Paired notes fields absorbed into checklist rows — NOT duplicated as separate fields
- Non-trinary radios (2, 4+ options) untouched — still use `FieldRenderer`

### Non-regression
- Standard select/radio fields (Service Level, etc.) render unchanged
- Pre-start, SWMS, hazard, inspection forms unaffected
- Draft persistence, progress counter, submission serialisation unchanged
- Locked field overlay from `.132jy` preserved

### EAS build status
- Build `4edbbaaa` (v1.0.36/158): already **finished** — not cancelled
- This ship mints v1.0.37/159 — no EAS build kicked per instructions (JS-only, user will decide)

### Files touched
| File | Change |
|------|--------|
| `src/lib/checklistDetect.ts` | **NEW** — detection + classification helpers |
| `src/components/forms/InlineChecklistRow.tsx` | **NEW** — responsive inline/stacked row |
| `app/forms/[id]/index.tsx` | Fill + review modes use `buildFieldRenderPlan()` |
| `app.json` | v1.0.37, build 159 |
| `src/lib/version.ts` | Bundle `.132kc` |

### Screenshots verified
- **Tablet (800dp)**: inline one-row layout — Engine Oil through Brake Fluid visible, notes inline at right
- **Phone (390dp)**: stacked layout — pills below label, notes below pills, large tap targets
