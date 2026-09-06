# v58.13.132g — M6 Profile Tab: Endpoint Discovery

## Endpoints Used (NO new endpoints created)

### 1. GET /api/me/worker-profile
- **File**: `workers.py` → `me_router`
- **Auth**: `get_current_user` (JWT bearer)
- **Returns**: `{ worker: {...}, certifications: [...], clients: [...] }`
- Worker fields: id, first_name, last_name, email, phone, mobile, position, active, company_label, photo_url, birth_date, availability, etc.
- Certifications: serialised with `.status` block `{key, label, days}` (valid/expired/expiring_soon/no_expiry/missing_file)
- Clients: Simpro customer name resolution

### 2. GET /api/swms (CRUD router)
- **File**: `crud.py` → `build_router("swms", ...)`
- **Auth**: Permission-gated `swms.view`
- **Returns**: Array of SWMS docs with `applies_to.worker_ids`
- Mobile filters client-side: show only SWMS where `applies_to.worker_ids` includes the logged-in worker's id

### 3. GET /api/fleet/register
- **File**: `fleet.py`
- **Auth**: `require_permission("assets", "view")` + `require_fleet_register_enabled`
- **Returns**: `{ items: [...], total, page, limit }`
- Asset fields: id, kind, asset_type, rego_serial, name, make, model, status, odo_km, hours_meter, navixy_device_id, last_known_lat/lng

### 4. GET /api/fleet/assets/{asset_id}
- **File**: `fleet.py`
- **Auth**: Same as above
- **Returns**: `{ asset: {...}, history: [...], counters: {total_records, total_spend, last_service_date, open_hazards, open_incidents} }`

## Sections in Profile Tab
1. **Header**: Avatar initials, name, position, company_label chip
2. **My Certifications**: List from worker-profile endpoint, tap → detail screen
3. **My SWMS**: Filtered from /api/swms, tap → SWMS detail screen
4. **My Fleet**: From /api/fleet/register, tap → asset detail screen with counters
5. **Payroll stub**: MOCKED (no backend payroll endpoint exists). Shows placeholder "Latest payslip", "Leave balance", "Book time off"

## Notes
- No new endpoints, forms, or collections created per M6 requirements
- Payroll section is explicitly MOCKED
- SWMS worker filtering is client-side (applies_to.worker_ids array)
- Fleet has no direct worker→asset binding; show full register
