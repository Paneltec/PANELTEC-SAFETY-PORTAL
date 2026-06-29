## Iteration 13 — Phase 4.5 (Paste SWMS + Bulk Delete) + Phase 4.6 (Scan Upload + Signed Copy)

### What was implemented
1. **SWMS List Header Actions** (`app/swms/index.tsx`):
   - Added "Paste" button (orange border, clipboard icon) → opens PasteSwmsModal
   - Added "Scan" button (orange border, scan icon) → opens ScanSwmsModal
   - Moved "Create" button to same action row with `marginLeft: 'auto'`

2. **Bulk Delete Multi-Select** (`app/swms/index.tsx`):
   - Long-press (`onLongPress` with 400ms delay) on any SWMS row activates selection mode
   - Checkboxes appear on left side of each row, selected rows get orange border + amber background
   - Bottom action bar (dark slate, absolute positioned): shows `{N} selected` + Clear + Delete buttons
   - Delete triggers `Alert.alert` confirmation → `POST /api/swms/bulk-delete` with `{ ids }`
   - Handles partial delete (refused_ids) with warning message
   - Spacer added at bottom when in select mode so last items aren't hidden

3. **Success Toast with "Open in editor"**:
   - `handleCreated(doc, kind)` callback used by both PasteSwmsModal and ScanSwmsModal
   - Shows Alert with "Stay here" and "Open in editor" buttons
   - "Open in editor" navigates to `/swms/{id}`

4. **View Signed Copy** (`app/swms/[id].tsx`):
   - Detects `doc.attachments` array for `kind: "signed_evidence"`
   - Shows blue-themed card with document-attach icon, filename, OCR char count
   - Opens file URL via `Linking.openURL()` (builds full URL from EXPO_PUBLIC_BACKEND_URL + file_url)

### Web-to-mobile mapping
| Web Feature | Mobile Implementation |
|---|---|
| Paste SWMS dialog (Shadcn Dialog) | Bottom sheet Modal (PasteSwmsModal.tsx) |
| Scan SWMS dialog (drag+drop) | Three-option picker: Camera, Library, PDF |
| Checkbox column in table | Long-press → checkbox mode on card rows |
| Sticky bulk action toolbar | Absolute-positioned bottom bar |
| `toast.success()` with action | `Alert.alert()` with "Open in editor" button |
| `source_file?.url` download | `Linking.openURL()` for signed copy |

### API endpoints used
- `GET /api/swms` — list
- `POST /api/swms/from-paste` — create from pasted text
- `POST /api/swms/from-scan` — create from file upload (multipart)
- `POST /api/swms/bulk-delete` — soft-delete multiple SWMS

### Known issues
- None found — all features compile and render correctly

### Dependencies installed
- None (expo-image-picker and expo-document-picker were already installed)

### Files modified
- `/app/mobile/app/swms/index.tsx` (overwritten — added modals, multi-select, bulk delete)
- `/app/mobile/app/swms/[id].tsx` (overwritten — added signed copy view)

### Files verified (created by previous agent)
- `/app/mobile/src/components/swms/PasteSwmsModal.tsx` ✅
- `/app/mobile/src/components/swms/ScanSwmsModal.tsx` ✅
