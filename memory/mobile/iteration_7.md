# Iteration 7 — Worker Certifications, Global Certifications, Cover Screen Updates

## What was implemented
- **Worker Certifications tab (5th section)**: Added collapsible "Certifications" accordion inside Worker Edit Modal, gated with `{!isNew}` (only shows for existing workers). Includes `WorkerCertsSection.tsx` component with upload (via expo-document-picker), manual add, edit, delete, send-reminder, and status badges.
- **Global Certifications page**: Created `certifications.tsx` — butter pastel header, search bar, filter chips (All/Expired/Expiring Soon/Missing File/Valid/No Expiry), CSV export, cert cards with status badges, empty state.
- **Cover/landing page rewrite**: Updated `login.tsx` with 3-stack headline ("Build Safer. Build Smarter. Build Together."), gold accent on "Build Together.", 4 value-prop chips (Real-time Compliance, AI-Powered Insights, Cert Tracking, Live Analytics).
- **Worker Edit modal subtitle**: Added subtitle text under worker name in Edit mode with `headerSubtitle` style.

## Fixes applied
- Fixed first value-prop chip "Real-time Compliance" visibility — was using `color: '#fff'` (white on white); changed to `color: '#F4C430'` (gold).
- Added missing `headerSubtitle` style to WorkerEditModal's StyleSheet.

## Web-to-mobile mapping
| Web Feature | Mobile Implementation |
|---|---|
| Workers.jsx → Certifications tab in Edit modal | `WorkerCertsSection.tsx` inside `WorkerEditModal.tsx` Section wrapper |
| Certifications.jsx → Global certs page | `certifications.tsx` (standalone route) |
| Login.jsx → Cover hero text + chips | `login.tsx` (3-stack heading + 4 value-prop chips) |
| Workers.jsx → Edit modal subtitle | `WorkerEditModal.tsx` headerSubtitle conditional |

## Dependencies
- `expo-document-picker` (installed in prior iteration)

## Known issues
- Pre-existing TS warnings: SupplierDrawer missing `filterChip`/`filterText` styles, outbox `alert-triangle` icon type, PdfActions `documentDirectory` — none are runtime breaking.
- Certifications 5th section only appears for existing workers (by design — new workers have no ID for cert API calls).
- Global Certifications page shows empty state when no worker certs exist in DB.

## Files modified
- `/app/mobile/app/certifications.tsx` (NEW)
- `/app/mobile/src/components/WorkerCertsSection.tsx` (NEW)
- `/app/mobile/src/components/WorkerEditModal.tsx` (added subtitle + 5th section + headerSubtitle style)
- `/app/mobile/app/(auth)/login.tsx` (cover text rewrite + chip color fix)
- `/app/mobile/app/_layout.tsx` (added certifications Stack.Screen)
- `/app/mobile/app/(tabs)/settings.tsx` (added Certifications link)
- `/app/mobile/src/lib/colors.ts` (added paneltecGold)
