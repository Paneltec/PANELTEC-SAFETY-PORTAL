# Iteration 12 — Back-button fix + Preview-mode wiring

## Part A — Bug Fix: Missing back navigation
Audited all leaf screens in the app. Three had no back affordance:
- `document-library.tsx` — Added "← Back" button at top (testID: doclib-back-btn)
- `users.tsx` — Added "← Back" button at top (testID: users-back-btn)  
- `suppliers.tsx` — Added "← Back" button in both connected and not-connected states (testIDs: suppliers-back-btn, suppliers-back-nc)

All use: `router.canGoBack() ? router.back() : router.replace('/(tabs)/settings')`

Other leaf screens already had back buttons: workers.tsx ✅, certifications.tsx ✅. Sub-stack routes (hazards/*, incidents/*, etc.) use Stack headers ✅.

## Part B — Preview-mode wiring (Phase 4.4)
Architecture:
```
URL: ?preview_token=JWT&preview_role=contractor
  ↓
preview.ts → exports previewToken, previewRole, isPreviewMode (web only)
  ↓
api.ts → interceptor uses previewToken for Authorization header
  ↓
AuthContext boot → auto-sets isAuth=true, calls refreshModules()
  ↓
modules.ts → fetchModules() appends ?as_role=contractor → API returns contractor modules
  ↓
(tabs)/_layout.tsx → renders slate ribbon "Preview mode · contractor", gates tabs
```

Preview mode rules:
- Token not persisted to AsyncStorage
- Module map not cached
- Force-logout disabled
- Native builds unaffected (preview.ts returns null on non-web)
