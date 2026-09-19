# Iteration 21 — Extrapolate Modern Light Theme to Remaining Screens

## What was implemented
- **Sites headers** (create.tsx, index.tsx): Converted from hardcoded dark navy `#1E3A8A` background with white text to Modern Light pattern: `Colors.surface` bg, `Colors.ink` text, `Colors.border` bottom separator, `Colors.blue` back arrow icon, `Colors.textTertiary` overline
- **QR scanner camera icon**: Fixed invisible bg on light theme (`rgba(255,255,255,0.05)` → `Colors.surfaceLight`)
- **Users.tsx crash fix**: Added missing `import { useRouter } from 'expo-router'` and `const router = useRouter()` — component referenced `router.canGoBack()` and `router.back()` but never imported or initialized the hook
- **Dashboard duplicate keys**: Removed 4 duplicate StyleSheet keys that would cause the later definition to silently override the earlier one
- **shadow* deprecation cleanup**: Migrated all deprecated `shadowColor/shadowOffset/shadowOpacity/shadowRadius` props to `boxShadow` CSS string format across 11 files (13 occurrences total)

## Web-to-mobile mapping decisions
- N/A — this was a mobile-only styling propagation task, no new web-to-mobile mapping

## Known issues / deferred items
- Pre-existing lint warnings in users.tsx (unused imports TextInput, Switch, STATUSES) — not introduced by this iteration
- Pre-existing lint warnings in dashboard.tsx (unused vars canEdit, visibleCapture, openTile, score, bandColor, require() import) — not introduced
- Scan result components (SiteScanResult, SupplierScanResult) use `rgba(255,255,255,...)` text — these are intentionally on dark accent card backgrounds (Colors.imInk, Colors.paneltecViolet), so white text is correct

## Dependencies installed
- None

## Assessment
All screens now visually consistent with Modern Light palette. Token cascade works correctly — screens using `Colors.*` tokens automatically get the Modern Light values. The only remaining inconsistency was hardcoded dark values in Sites headers and the QR scanner, which are now fixed.
