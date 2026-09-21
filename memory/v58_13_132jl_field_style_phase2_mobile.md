# .132jl — Mobile Form Runner Consumes Per-Field `style` Schema (Phase 2)

## Schema Properties Honoured

| Schema Property | RN Style Applied | Notes |
|---|---|---|
| `backgroundColor` | `View.backgroundColor` | Hex validated before applying |
| `borderColor` | `View.borderColor` | Hex validated |
| `borderWidth` | `View.borderWidth` | Integer, default 0 if absent |
| `borderStyle` | `View.borderStyle` | `solid\|dashed\|dotted`; `none` → borderWidth: 0 |
| `borderRadius` | `View.borderRadius` | Integer |
| `paddingX` | `View.paddingHorizontal` | Integer or null |
| `paddingY` | `View.paddingVertical` | Integer or null |
| `labelColor` | `Text.color` on label | Hex validated |
| `labelBold` | `Text.fontWeight: '700'` | Boolean |
| `labelSize` | `Text.fontSize` mapped: sm→13, md→15, lg→18 | String enum |
| `helpTextColor` | `Text.color` on type/help line | Hex validated |
| `icon` | Prepended before label | See icon rendering below |
| `hoverBackgroundColor` | **IGNORED** | Web-only; no hover on mobile |

## Icon Rendering on Mobile

- `emoji:⚠️` → `<Text style={{ fontSize: 16, marginRight: 5 }}>⚠️</Text>` before label
- `ion:warning` → `<Ionicons name="warning" size={16} style={{ marginRight: 5 }} />` before label
- `null` / missing → nothing rendered
- Label row wrapped in `flexDirection: 'row', alignItems: 'center'` for horizontal layout

## RN-Specific Edge Cases

### Dashed/Dotted borders on Android
Android has a known issue with `borderStyle: 'dashed'` or `'dotted'` combined with `borderRadius` and `overflow: 'hidden'`. Fix: when `borderStyle` is `dashed` or `dotted` on Android, we set `overflow: 'visible'` on the wrapper to prevent clipping.

### Hex validation
All color values are validated with regex `/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/` before applying. Invalid hex values are silently skipped (property not applied, other properties still work).

### Missing `style` or `style: {}`
Returns empty style object `{}` — no properties applied, zero visual regression from current rendering. This is the current state since no templates have styled fields yet.

## Fallback / Safety
- Missing `style` key on field → default rendering (current behavior preserved)
- `style: {}` → default rendering
- `style: { borderStyle: 'none' }` → borderWidth forced to 0, other border props skipped
- Invalid hex → logged to warn, skipped, other properties still applied
- Error validation boundary still rendered on top of custom styles

## Implementation

### New type: `FieldStyle` (forms.ts)
Interface added to `FormField` as optional `style?: FieldStyle`.

### Helper functions (index.tsx)
- `isValidHex(v)` — regex check for valid hex color
- `buildFieldWrapperStyle(st)` — converts FieldStyle → RN ViewStyle object
- `renderFieldIcon(icon)` — parses `emoji:X` and `ion:name` prefixes

### FieldRenderer changes
- Wrapper `<View>` now receives `[s.fieldBlock, errorBorder, wrapperStyle]` 
- Label `<Text>` receives `[s.fieldLabel, labelStyle]`
- Help text receives `[s.fieldType, helpStyle]`
- Label row wrapped in `<View style={{ flexDirection: 'row', alignItems: 'center' }}>` for icon support

## Current Backend State
- No templates currently have `style` on fields (key absent from response)
- Phase 1 (.132jk) shipped the schema in backend + web builder
- Mobile is now forward-compatible: when fields are styled in the web builder, they render automatically

## Files Modified
- `/app/mobile/src/services/forms.ts` — added `FieldStyle` interface, `style?` on `FormField`
- `/app/mobile/app/forms/[id]/index.tsx` — added style helpers + wired into FieldRenderer
- `/app/mobile/src/lib/version.ts` — bumped to .132jl
- `/app/mobile/app.json` — version 1.0.26, versionCode 148

## EAS Build
- **Build ID**: `cf57dddf-2360-4599-9fa8-0d53d79c183a`
- **Profile**: `preview-apk`
- **Commit**: `535385ce`
