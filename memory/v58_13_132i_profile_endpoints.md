# v58.13.132i — Profile Tab: Worker Self-View Discovery

## 1. Personal Info Fields (from `workers` collection)

Available on worker record:
- `first_name`, `last_name` — READ ONLY (Simpro-sourced)
- `email` — worker email
- `phone` — work phone
- `mobile` — mobile phone
- `position` / `trade` — job title
- `birth_date` — DOB (YYYY-MM-DD)
- `street_address`, `suburb`, `state`, `postal_code`, `country` — home address
- `additional_notes` — free text
- `active` — employment status (read-only)
- `simpro_employee_id` — Simpro ID (read-only)
- `company_label` — derived from `simpro_company_id` (Paneltec/Viatec)

**No existing fields for**: preferred_name, next_of_kin, emergency_contact. These need to be ADDED to the worker record as new optional fields. Not a new collection — just extra fields on the existing `workers` doc.

**Edit endpoint**: `PATCH /api/workers/{id}` is gated by `_require_write()` which requires admin/hseq_lead. Need to extend to allow self-edit of whitelisted fields.

## 2. Certifications

- Source: `worker_certifications` collection
- Already served via `GET /api/me/worker-profile` → `certifications[]`
- Each cert: `{id, name, issuer, issue_date, expiry_date, status{key,label,days}, doc_file_id, doc_seed_folder, notes}`
- **Same source of truth** as admin `settings/workers/{worker}/certification`
- M6 profile already reads from this — no unification needed

## 3. Inductions

- Stored in: `worker_certifications` collection (with `column_key` != null + `source: "induction_xlsx"`)
- Separate from standard certs: identifiable by `column_key` field presence
- Categories: `site_induction`, `competency`, `license`
- Status calc: `_status_for(cert)` → current/expiring/expired/not_held/held_no_expiry/invalid_date/unknown
- Matrix endpoint: `GET /api/workers/inductions/matrix` — auto-scopes to own row for non-admins
- Worker can see their own induction cells via the matrix

## 4. ID Card + QR

- QR PNG: `GET /api/workers/{worker_id}/qr.png` — returns QR image
- ID Card PDF: `GET /api/workers/{worker_id}/id-card.pdf?layout=wallet|lanyard|avery`
- QR encodes: `{PUBLIC_URL}/scan/worker/{scan_token}` 
- `scan_token`: 10-char alphanumeric per worker, backfilled on startup
- Card layout (wallet): 85.6×54mm — name, role, company, QR, token text
- Card layout (lanyard): 100×150mm — larger QR, emergency contact line
- Access: `_require_self_or_manager()` — **worker CAN access their own card**
- Public scan endpoint: `GET /api/scan/worker/{scan_token}` — returns sanitised profile + certs + active site

## Backend Touches Needed

### A. Self-Edit on PATCH /api/workers/{id}
Current: `_require_write(user)` blocks non-admin
Plan: Add `?self=true` flag. When present AND worker_id matches caller's own record, allow whitelisted fields only:
- `phone`, `mobile`, `email` (personal contact)
- `street_address`, `suburb`, `state`, `postal_code`, `country` (address)
- NEW fields: `preferred_name`, `next_of_kin`, `emergency_contact`

### B. New Fields on Workers Collection (additive, no migration)
- `preferred_name: string`
- `next_of_kin: {name, phone, relationship}`
- `emergency_contact: {name, phone, relationship}`

### C. Change Log Collection: `worker_change_log`
- `{id, org_id, worker_id, field, old_value, new_value, changed_by, source: "mobile_self_edit", timestamp}`

### D. Extended /api/me/worker-profile
- Already returns worker + certs. No change needed — just use it.

### E. Inductions for Mobile
- Use `GET /api/workers/inductions/matrix` which auto-scopes to own row
- Or query `worker_certifications` directly filtered by column_key presence
