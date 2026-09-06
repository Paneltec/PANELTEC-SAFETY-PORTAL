# v58.13.132i — Ship Memo: Profile Worker Self-View

## What Shipped

### Backend Extension (additive only)
- **PATCH /api/me/worker-profile** — New self-edit endpoint added to `me_router` in `workers.py`
  - Whitelisted fields: `preferred_name`, `phone`, `mobile`, `email`, `street_address`, `suburb`, `state`, `postal_code`, `country`, `next_of_kin`, `emergency_contact`
  - Non-whitelisted fields silently rejected (returns 400 "No editable fields supplied")
  - Every change writes a `worker_change_log` row: `{worker_id, field, old_value, new_value, changed_by, source: "mobile_self_edit", timestamp}`
  - next_of_kin / emergency_contact validated as objects with {name, phone, relationship} only

### Mobile Screens

1. **Profile Hub** (`app/(tabs)/profile.tsx`) — Restructured as nav hub:
   - Personal Information → `app/profile/personal.tsx`
   - My Certifications (badge: count expiring/expired) → `app/profile/certifications.tsx`
   - My Inductions → `app/profile/inductions.tsx`
   - My ID Card → `app/profile/id-card.tsx`
   - My Fleet, My SWMS (existing), Payroll (STUB), Sign Out

2. **Personal Info** (`app/profile/personal.tsx`) — Inline editable:
   - Read-only: Full Name, DOB, Employee ID, Position
   - Editable: Preferred Name, Phone, Mobile, Email, Address fields, Next of Kin, Emergency Contact
   - Tap pencil → inline edit with orange border → Save button appears at bottom

3. **My Certifications** (`app/profile/certifications.tsx`) — Full list:
   - 14 certs with status pills (Valid/Expired/Missing file)
   - Tap → existing detail screen (`certifications/[id].tsx`)

4. **My Inductions** (`app/profile/inductions.tsx`) — Grouped by category:
   - Reads from `/api/workers/inductions/matrix` (auto-scoped to own worker)
   - Categories: Competencies, Licences, Site Inductions
   - Status pills: Current, Expired, Not Held, Held

5. **My ID Card** (`app/profile/id-card.tsx`) — Digital worker ID:
   - Front: Wallet card with avatar, name, role, company, employee number
   - Back: QR code loaded from `/api/workers/{id}/qr.png`, scan instructions
   - Info: "Physical card printing is done by the office"

### New Files
- `/app/mobile/src/services/profileExtended.ts` — Self-edit + inductions + QR API client
- `/app/mobile/app/profile/personal.tsx`
- `/app/mobile/app/profile/certifications.tsx`
- `/app/mobile/app/profile/inductions.tsx`
- `/app/mobile/app/profile/id-card.tsx`
- `/app/mobile/app/profile/_layout.tsx` (updated)
- `/app/mobile/app/(tabs)/profile.tsx` (rewritten as nav hub)
- `/app/backend/workers.py` (extended: SelfEditBody + self_edit_worker_profile + worker_change_log)

## Endpoints Reused (not new)
- `GET /api/me/worker-profile` — worker + certs (same as M6)
- `GET /api/workers/inductions/matrix` — induction cells
- `GET /api/workers/{id}/qr.png` — QR image
- `PATCH /api/me/worker-profile` — **NEW** (self-edit with whitelisted fields)

## Pytest: 7/7 passing (`test_v58_13_132i_worker_self_view.py`)
- Worker sees own record ✅
- Whitelisted field edit succeeds ✅
- Non-whitelisted field rejected ✅
- Next of kin saved correctly ✅
- Change log written ✅
- Inductions matrix returns data ✅
- QR PNG returns image ✅

## Honest Flags
- **Payroll section**: MOCKED (no backend — planned for v58.13.133)
- **Fleet**: Shows full org register (no worker→asset binding)
- **Inductions**: Reads from matrix which may return empty for workers without induction data
- **ID Card QR**: Fetched as base64 from backend — works on web preview, may need adjustment for native builds
- **Emergency contact**: New fields (`next_of_kin`, `emergency_contact`) added to workers collection — additive, no migration needed
- **Change log**: New `worker_change_log` collection created automatically on first write
