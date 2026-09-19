# Iteration 6 — Workers Feature

## What was implemented

### Workers List Screen (`/app/mobile/app/workers.tsx`)
- Sky pastel header banner (SETTINGS / Workers)
- Search input with real-time filtering (name, email, phone, state)
- "Sync" button → bottom sheet with 3 options: Paneltec / Viatec / Both
- "+ Add" button (admin/hseq_lead only)
- Worker card rows showing:
  - Avatar with initials (green=active, slate=inactive)
  - Name (bold) + position subtitle
  - Email + phone meta rows
  - Active/Inactive badge (mint/slate)
  - Company chip (Paneltec=sky, Viatec=purple, Manual=slate)
  - Chevron for navigation
- Tap row → opens edit modal
- Long-press row (admin) → delete confirmation
- Pull-to-refresh
- Empty state with icon + CTA

### Worker Edit Modal (`/app/mobile/src/components/WorkerEditModal.tsx`)
Full-screen modal sheet with 4 collapsible sections:

1. **Identity & contact** (always open):
   - First/Last name, Email, Phone, Mobile, Position
   - Active toggle (Switch)
   - Simpro source banner if applicable

2. **Personal** (collapsible):
   - Birth date (text input YYYY-MM-DD)
   - Country picker (Australia/Other)
   - State picker (NSW/VIC/QLD/WA/SA/TAS/ACT/NT) — visible when Australia
   - Street address, Suburb, Postal code (4 digit numeric)
   - Additional notes (multiline)

3. **Availability** (collapsible):
   - 7 day rows (Mon-Sun) with toggle Switch
   - When enabled: sky tint, two TimeInput fields (Start, End)
   - When disabled: slate grey
   - Inline validation: end must be after start
   - Default times: 07:00 → 17:00
   - Day count badge in section header

4. **Clients** (collapsible):
   - 3 pastel source pills: Paneltec/Viatec/Both
   - Tap → opens ClientPickerModal
   - After apply: chips showing customer name + company badge + remove X

- Save footer: Cancel + Create/Update buttons
- Availability validation blocks save if invalid

### Client Picker Modal (`/app/mobile/src/components/ClientPickerModal.tsx`)
- Header with company label
- Search input
- "N of M" selected counter
- "Select filtered" / "Clear all" action buttons
- Checkbox list of customers from `/api/integrations/simpro/customers`
- Company chips per row
- Footer: Cancel + "Apply N selections" CTA

### Sync from Simpro flow
- Bottom sheet with 3 options
- Calls `POST /api/workers/sync-from-simpro` with `{company: ...}`
- Shows loading spinner during sync
- Success alert with created/updated/skipped counts
- Auto-refresh list

### Navigation Wiring
- Root `_layout.tsx`: Added `workers` Stack.Screen
- Settings/Profile: Workers as first SETTINGS item with router.push
- Dashboard: Workers tile in MANAGE & COMPLY section

## API Endpoints Used
- `GET /api/workers` — list all workers
- `POST /api/workers` — create manual worker
- `PATCH /api/workers/{id}` — edit worker
- `DELETE /api/workers/{id}` — soft delete
- `POST /api/workers/sync-from-simpro` — multi-company Simpro sync
- `GET /api/integrations/simpro/customers?company=...` — client list for picker

## Web-to-Mobile Mapping
| Web Component | Mobile Component |
|--------------|-----------------|
| Workers.jsx (list) | workers.tsx |
| EditModal (form) | WorkerEditModal.tsx |
| ClientPicker (modal) | ClientPickerModal.tsx |
| Section (collapsible) | Section (RN collapsible) |
| StatusBadge | Inline View+Text badge |
| CompanyChip | Inline View+Text chip |
| dayRow (availability) | dayRow with Switch + TimeInput |

## Theming
- Sky pastel banner: `#e6eff9` bg, `#1e4a8c` text
- Active badge: `#d8ecdd` bg, `#1f7a3f` text (mint)
- Inactive badge: `#F1F5F9` bg, `#475569` text (slate)
- Paneltec chip: sky
- Viatec chip: purple (`#ece6f4` / `#4f3a8c`)
- Manual chip: slate

## Known Issues
- Demo account has no workers or Simpro customers (shows empty states — expected)
- CDN/tunnel DNS cache issue persists (screenshots must use localhost:3001)

## Dependencies
- No new dependencies needed
