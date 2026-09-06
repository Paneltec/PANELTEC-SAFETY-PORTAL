# v58.13.132h — Forms Library Discovery

## Collection: `form_templates`
- **Category field**: `category` (string)
- **Normaliser**: `_norm_category()` in `forms.py` — lowercases, underscores, defaults to "general"
- **Backend constant**: `ALLOWED_CATEGORIES = {"incident", "inspection", "toolbox", "near_miss", "general", "pre_start", "admin", "hazard", "site_diary", "risk_assessment"}`

## Canonical Category Order (from org_settings.py + RoleFormsSection.jsx)
```python
_FORM_CATEGORIES = ["general", "pre_start", "inspection", "near_miss", "incident", "toolbox", "admin"]
```
Matching: `CATEGORY_ORDER = ['general', 'pre_start', 'inspection', 'near_miss', 'incident', 'toolbox', 'admin']`

### User's requested categories mapping:
| User says | Backend `category` value |
|-----------|--------------------------|
| General | `general` |
| Pre-start | `pre_start` |
| Inspection | `inspection` |
| Incident | `incident` |
| Inspection admin-only | `admin` |

The user's "Inspection admin-only" maps to the backend's `admin` category.
`near_miss` and `toolbox` also exist but weren't mentioned — we include them.

## Permission Gating — Admin-Only Category

The `admin` category is gated at **two levels**:

1. **Backend — `list_templates()`** (forms.py:422): 
   - Non-admin/owner callers get filtered by `org.role_form_allowlist[role]`
   - The migration script (`migrate_v160_2_6cat_categorize.py`) auto-excludes admin-category templates from the Worker allowlist
   - Workers literally never receive admin-category templates in the API response

2. **Frontend — `CATEGORIES` constant** (Forms.jsx:36):
   - The `admin` pill is rendered for admin users only
   - Workers who don't see it in the API response simply never encounter admin forms

**Mobile implementation**: Call `GET /api/forms/templates` with the user's JWT. The backend already filters. We check `user.role === "admin"` to decide whether to show the "Admin only" section heading. No additional permission check needed — the backend enforces it.

## List Endpoint (REUSE — no new endpoint)
```
GET /api/forms/templates
  ?category={category}   — optional filter
  ?for_worker=me         — optional: only forms assigned to this worker
  ?show_all=true         — admin: bypass role filter
```
Returns: `[{id, name, category, description, fields, submission_count, ...}]`

## Single Template
```
GET /api/forms/templates/{template_id}
```
Returns: `{id, name, category, description, fields: [{id, label, type, required, options, placeholder, config}], ...}`

## Submit Flow
```
POST /api/forms/templates/{template_id}/submissions
Body: { fields: [{id, label, type, value}], launched_via?, source_scan_token?, source_asset_id? }
```
Returns: `{id, template_id, fields, submitted_by, submitted_at, ...}`

Then upload photos per field:
```
POST /api/forms/submissions/{submission_id}/photos
Body: FormData { field_id, files[] }
```

## Field Types (for the form runner)
text, textarea, date, number, select, radio, photo, signature, gps, vehicle_navixy, asset_scan, worker_picker, job_picker, site_picker, customer_picker, company_selector, auto_date, time, reference_matrix, attachment, actions

## Draft Support
Client-side only. Web app uses `localStorage` with key `paneltec_draft_{template_id}` to auto-save values. Mobile should use AsyncStorage.

## Status Calculation
`_submission_status()` — "complete" if all required non-binary fields have non-empty values, "draft" otherwise.

## Access Check (cert gating)
```
GET /api/forms/templates/{template_id}/access-check
```
Returns `{ok: bool, mode: "no_gate"|"admin_bypass"|"gated", required: [{slug, label, status}]}`
