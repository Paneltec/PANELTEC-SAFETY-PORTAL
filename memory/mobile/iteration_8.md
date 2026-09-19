# Iteration 8 — Forms Library Navigation Wiring

## What Was Done
The previous agent had already fully implemented all Forms route files with complete UI and API integration. The only missing pieces were:
1. Route registration in root `_layout.tsx`
2. Navigation links from the main app (Dashboard, Capture, Compliance)
3. expo-location version compatibility fix

## Changes Made
1. **Root Layout** (`app/_layout.tsx`): Added `<Stack.Screen name="forms" />` to register the forms route
2. **Capture Tab** (`app/(tabs)/capture.tsx`): Added "Forms Library" tool with `forms` resource + permission bypass (forms accessible to all roles)
3. **Compliance Hub** (`app/(tabs)/compliance.tsx`): Added "Forms Library" as the first item
4. **Dashboard** (`app/(tabs)/dashboard.tsx`): Added "Forms Library" as first item in MANAGE_TOOLS
5. **expo-location fix**: Downgraded from v56 to v18 (compatible with Expo SDK 54)

## Screens Verified
- Forms List: 3 templates showing, category counts correct (ALL 3, INCIDENT 1, INSPECTION 1, TOOLBOX 1)
- Template Detail: Fields listing with types, description, "Fill out" + "View submissions" CTAs
- Fill-Out Screen: All field types rendering (text, textarea, select, photo/camera/library, signature/tap-to-sign, GPS)
- Dashboard: Loads correctly
- No compilation errors

## Web-to-Mobile Mapping (Forms Feature)
| Web Page | Mobile Screen | Route |
|----------|---------------|-------|
| Forms.jsx (templates list) | forms/index.tsx | /forms |
| Forms.jsx (detail drawer) | forms/[id].tsx | /forms/{id} |
| Forms.jsx (fill-out modal) | forms/fill/[id].tsx | /forms/fill/{id} |
| FormSubmissions.jsx | forms/submissions/[templateId].tsx | /forms/submissions/{templateId} |
| Forms.jsx (SubmissionViewModal) | forms/submission/[id].tsx | /forms/submission/{id} |

## API Endpoints Used
- `GET /api/forms/templates` — list templates
- `GET /api/forms/templates/{id}` — template detail
- `POST /api/forms/templates/{id}/submissions` — submit form
- `POST /api/forms/submissions/{id}/photos` — upload photos (multipart)
- `GET /api/forms/templates/{id}/submissions` — list submissions
- `GET /api/forms/submissions/{id}` — view submission
- `POST /api/forms/submissions/pdf-token` — get PDF download token

## Known Issues
- expo-location shadow deprecation warnings (non-breaking)
- ESLint engine errors in CI environment (not code issues)

## Dependencies Changed
- `expo-location`: v56 → v18 (SDK 54 compatibility)
