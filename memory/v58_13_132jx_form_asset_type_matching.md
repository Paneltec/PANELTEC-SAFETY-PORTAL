# v58.13.132jx — Auto-seed `form_templates.applies_to.asset_types` + admin override UI

## User pain (verbatim)
> "Trailers don't need Viatec Traffic Ute incident report"

Mobile ASSET DETAIL screen surfaced forms that don't apply to the scanned asset type. The `/api/scan/{token}/forms` endpoint respects the `applies_to` filter on each `form_templates` document, but 12 of the 38 templates on the Paneltec Pty Ltd org had `applies_to.kinds = ["any"]` (universal), so every asset — trailer, ute, plant, vac — surfaced them all.

## Architecture note (corrects prior investigation)
The .132jv handoff memo referred to a `form_asset_type_assignments` Mongo collection. That collection does NOT exist. The actual data model is **embedded on each `form_templates` doc** as `applies_to = { kinds, asset_types, worker_ids, roles, companies }`, plus a top-level `assigned_positions`. The resolver `resolve_forms_for_worker` in `form_assignment_notifier.py` unions:

1. `applies_to.kinds` contains "any" → universal
2. asset.kind ∈ `applies_to.kinds` → kind rule
3. asset.asset_type ∈ `applies_to.asset_types` → asset-type rule
4. worker.id ∈ `applies_to.worker_ids` → direct
5. worker.role ∈ `applies_to.roles` → role
6. worker.simpro_company_id ∈ `applies_to.companies` → company

## Asset types on the fleet (Paneltec Pty Ltd)

| asset_type       | kind    | count |
|------------------|---------|------:|
| ute              | vehicle | 46    |
| trailer          | trailer | 21    |
| vacuum_truck     | vehicle | 12    |
| tipper           | vehicle | 14    |
| other            | mixed   | 8     |
| excavator        | plant   | 6     |
| service_truck    | vehicle | 6     |
| commercial       | vehicle | 4     |
| compactor        | plant   | 3     |
| crane_truck      | vehicle | 2     |
| directional_drill| plant   | 1     |
| loader           | plant   | 1     |

Note: raw values arrive in mixed case (`Ute`, `Trailer`, `Tipper`). The resolver lowercases both sides before matching, so seeded rules use lowercase.

## Heuristic rules (first-match-wins on `template.name`, case-insensitive)

Specific rules:

| Pattern                                   | applies_to |
|-------------------------------------------|------------|
| `\b(vac\|vacuum\|combination.*vacuum)\b`  | asset_types = ["vacuum_truck"] |
| `\b(viatec\|traffic\|tma)\b`              | asset_types = ["traffic_dept"] |
| `\b(tipper\|dumper\|tip.?truck\|dump.?truck)\b` | asset_types = ["tipper"] |
| `\btrailer\b`                             | asset_types = ["trailer"] |
| `\bplumber\b`                             | asset_types = ["plumber_vehicle"] |
| `\b(excavator\|digger\|cat.?3[23])\b`     | kinds=["plant"], asset_types=["excavator"] |
| `(civil.*utility\|utility.*vehicle\|\bcvt\b)` | asset_types = ["commercial", "plumber_vehicle"] |
| `(plant.*machinery\|heavy.*equipment\|heavy.*machinery\|\bmachinery\b)` | kinds = ["plant"] |
| `\bheavy.?vehicle\b`                      | kinds = ["vehicle"] |
| `\bvehicle\s+(pre.?use\|pre.?start\|inspection)\b` | kinds = ["vehicle"] |

Broad rules (only if no specific rule matched):
- category ∈ {risk_assessment, incident, near_miss, site_diary, swms, toolbox, admin} → `kinds=["any"]`
- name matches `(site diary|toolbox|swms|general risk|risk assessment|jsea|working at heights|hot work|permit|sign.?in|sign.?on|visitor|induction|drug|alcohol|hazard|near miss|incident report|asbestos|byda|confined space|end of day|daily site inspection|site inspection|\bssra\b)` → `kinds=["any"]`

Anything else → **unmatched**, left for admin to fill manually.

### Non-destructive guarantee
If a template already carries a narrower assignment (any `asset_types` populated, or any `kinds` other than empty/`["any"]`), auto-seed **preserves** the existing values. It only stamps `applies_to_meta.preserved_existing = True` and `auto_seeded_at`. This protects prior admin edits and existing template seeds.

### Manual-override protection
`PUT /form-templates/{id}/applies-to` and `POST /form-templates/assignments/bulk` now stamp `applies_to_meta.manual = true` on every save. Auto-seed unconditionally skips rows where `manual == true`.

## Endpoints added

```
POST /api/admin/forms/auto-seed-asset-types
     body: { dry_run?: bool = false, all_orgs?: bool = false }
     auth: admin role only

GET  /api/admin/forms/auto-seed-preview?all_orgs=<bool>
     (dry-run alias)
```

`GET /api/form-templates/assignments` now includes `applies_to_meta` on each row so the FE can render provenance badges.

## Live seed run (dry_run=false, all_orgs=true)

```
ALL ORGS TOTALS: scanned=117 seeded=67 preserved=29 manual=0 unmatched=17

  Paneltec Pty Ltd          scanned=38 seeded=25 preserved=9  unmatched=4
  Paneltec Civil Pty Ltd    scanned=7  seeded=6  preserved=0  unmatched=1
  Test Organisation (×5)    scanned=14 seeded=7  preserved=4  unmatched=3
  Test Org                  scanned=2  seeded=1  preserved=0  unmatched=1
```

### Paneltec Pty Ltd changes (25 rows)

Highlights:
- **Viatec Traffic Utillity Daily Pre-Start**: `kinds=["any"]` → `asset_types=["traffic_dept"]`
- **Viatec Traffic Solutions SSRA**: `kinds=["any"]` → `asset_types=["traffic_dept"]`
- **Tip Truck Daily Pre-Start**: `kinds=["any"]` → `asset_types=["tipper"]`
- **Vacuum Truck (VT) Daily Pre-Start**: `kinds=["any"]` → `asset_types=["vacuum_truck"]`
- **Trailer Pre-start**: `kinds=["any"]` → `asset_types=["trailer"]`
- **CVT Daily Pre-Start**: `kinds=["any"]` → `asset_types=["commercial", "plumber_vehicle"]`
- **Civil Utility Weekly Pre-Start**: `kinds=["any"]` → `asset_types=["commercial", "plumber_vehicle"]`
- **Vehicle Inspection Report**: `kinds=["any"]` → `kinds=["vehicle"]`
- **Toolbox Talk / Drug & Alcohol / JSEA / SWMS Sign-On / permits / induction / incident / hazard**: seeded to `kinds=["any"]` (universal)

Preserved rows (9): Heavy Vehicle Daily Check (already narrowed to 4 types), Vehicle Pre-Use Inspection (ute), Plant Pre-Start Checklist (excavator/generator/compactor), Excavator Pre-start (excavator/generator/compactor), plus 5 previously-narrowed templates.

Unmatched rows (4, admin to fill in): Equipment Pre-Use Checklist, 27 Point Visual Inspection, 2× synthetic v58.13.132ii sweep test rows.

## Verification — trailer scan resolves to 25 forms (was 14 universals ⇒ admin narrows problem-solving forms)

`GET /api/scan/evztUZrfNU/forms` (asset: `Gas Truck - Isuzu - XT44CB`, kind=trailer, asset_type=Trailer):

**✅ Viatec / Traffic forms are NOT in the response**:
- Viatec Traffic Utillity Daily Pre-Start — GONE
- Viatec Traffic Solutions SSRA — GONE

**✅ Wrong-vehicle pre-starts are NOT in the response**:
- Tip Truck Daily Pre-Start — GONE
- Vacuum Truck (VT) Daily Pre-Start — GONE
- CVT Daily Pre-Start — GONE
- Civil Utility Weekly Pre-Start — GONE
- Vehicle Inspection Report — GONE (trailer.kind == "trailer", not "vehicle")

**✅ Trailer-specific form IS in the response**:
- Trailer Pre-start (`match_reasons=['asset_type:trailer']`)

**✅ Universal safety docs remain (permits, JSEA, sign-in, SWMS, toolbox, incident, hazard, drug & alcohol, site inspections, etc.)** — appropriate, they apply to every asset.

## Verification — vacuum truck scan (control test)

`GET /api/scan/yTtV1KWWmE/forms` (asset: `Industrial - XT02AX`, kind=vehicle, asset_type=vacuum_truck):

- ✅ **Vacuum Truck (VT) Daily Pre-Start** IS present (`asset_type:vacuum_truck`)
- ✅ **Heavy Vehicle Daily Check** IS present (`kind:vehicle` + `asset_type:vacuum_truck` — preserved narrow list)
- ✅ **Vehicle Pre-Use Inspection** IS present (`kind:vehicle`)
- ✅ **Trailer Pre-start** is NOT present
- ✅ **No Viatec forms**

## Frontend changes

Admin UI already existed at `/app/settings/form-assignments` (route pre-dates this ship). Added:

1. **Auto-seed button** in the sticky toolbar (violet, `data-testid="auto-seed-btn"`). Runs the org-scoped auto-seed with a confirm dialog, then reloads the page and shows a toast summary.
2. **Provenance badges** on each rail row:
   - `Auto-seeded` (violet pill) — when `applies_to_meta.auto_seeded_at` set and `manual != true`.
   - `Manual` (amber pill) — when admin edited via PUT/bulk. Auto-seed skips these.
   - Neither badge for untouched templates.

Testids:
- `auto-seed-btn`
- `meta-badge-autoseed-{template_id}`
- `meta-badge-manual-{template_id}`

## Files touched

- `backend/admin_forms_autoseed.py` — NEW. Heuristic classifier + admin endpoints.
- `backend/asset_service.py` — `list_assignments` returns `applies_to_meta`; `update_applies_to` and `bulk_save_assignments` stamp `applies_to_meta.manual = true`.
- `backend/server.py` — Mount `admin_forms_autoseed_router`.
- `frontend/src/pages/FormAssignmentsAdmin.jsx` — Auto-seed button + provenance badges.
- `frontend/src/lib/version.js` — `.132jp` → `.132jx` on RUNNING_VERSION + EXPECTED_CACHE_VERSION.
- `frontend/public/service-worker.js` — `.132jp` → `.132jx` on CACHE_VERSION.

## NOT changed
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` unchanged (1.0.33 / .132jv still). Mobile automatically picks up the new `applies_to` values via the existing `/api/scan/{token}/forms` endpoint.
- No pytests written per Fast-Ship rule (not touching auth/deletions/PII).
- No `testing_agent` invoked.

## Admin follow-up (unmatched templates)

Paneltec Pty Ltd — admin needs to open `/app/settings/form-assignments` and manually assign these 4:
1. Equipment Pre-Use Checklist (pre_start) — probably ALL vehicles
2. 27 Point Visual Inspection (inspection) — probably ALL vehicles
3. v58.13.132ii — Synthetic Compliance Widget Sweep (×2) — test rows, safe to leave

Paneltec Civil Pty Ltd — 1 unmatched (Site Induction Checklist).
