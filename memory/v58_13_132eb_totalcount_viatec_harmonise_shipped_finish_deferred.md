# v58.13.132eb — Total-count chip + Viatec SSRA routing + CS-field harmonisation

Three items shipped together as a coherent post-`.132ea` polish pass:

1. FE total-count chip on 4 CAPTURE list pages so the true DB total is
   always in sight (Stephen no longer has to trust that his 3 561 rows
   are really there — he can see it in the header).
2. Viatec Traffic Solutions SSRA routing rule (and every other SSRA
   template variant — 12 rules total covering both brand names, all 6
   re-import copies each).
3. CS-migrated Incident Reports harmonised to the native `IncidentIn`
   schema so the 254 rows now render cleanly through the same list +
   detail UI as every other incident. Original CS fields preserved as
   `_cs_*` audit copies for rollback safety.

---

## Files touched

### New
- `frontend/src/components/TotalCountChip.jsx` — reusable pill component.
- `backend/scripts/seed_ssra_routing_rules_v58_13_132eb.py` (~140 lines).
- `backend/scripts/harmonise_cs_incident_fields_v58_13_132eb.py` (~230 lines).
- `backend/tests/test_v58_13_132eb_totalcount_viatec_harmonise.py` (~340 lines).

### Backend edits
- None on shipped modules — all three items are new-file additions +
  data-only migrations. `crud.py` remains at its `.132ea` state
  (5 000 default limit + `X-Total-Count` header).

### Frontend edits
- `pages/Incidents.jsx` — imports `TotalCountChip`, reads
  `response.headers['x-total-count']`, renders the chip above the
  Tabs bar (`testid="incidents-total-count-chip"`).
- `pages/Hazards.jsx` — same wiring
  (`testid="hazards-total-count-chip"`).
- `pages/RiskAssessments.jsx` — same wiring, gated on `tab==='submissions'`
  (`testid="risk-assessments-total-count-chip"`).
- `pages/Inspections.jsx` — same wiring
  (`testid="inspections-total-count-chip"`).
- `components/CaptureCard.jsx` — new `CS-migrated` badge on rows with
  `r.migrated_from === 'cs_incidents'` (`testid="capture-cs-migrated-<id>"`).
- `lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` bumped
  to `paneltec-v160.3.9.58.13.132eb`.
- `public/service-worker.js` — `CACHE_VERSION` bumped to
  `paneltec-v160.3.9.58.13.132eb`.

### Not touched
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` stays at `.132di`.
- Site Diary + Site Visitors list pages — out of scope for this ship
  (their pagination models differ from `build_router`; addressed as
  follow-up when a proper `{items, total}` shape lands).
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still
  parked for `v58.14.x`.

---

## Item 1 — Total-count chip

### Component (`TotalCountChip.jsx`)

Renders a subtle pill with three states:

| State                 | Copy                           | Palette |
|-----------------------|--------------------------------|---------|
| `total == null`       | `N shown`                      | emerald |
| `showing === total`   | `M total`                      | emerald |
| `showing < total`     | `N showing · M total`          | amber   |

Amber state adds a `title=` tooltip: *"Server holds M records; N
rendered here. Refine filters to narrow down."* — telegraphs to
Stephen (and to a future pager UX) that a filter has narrowed the
view. Uses `tabular-nums` so counts don't jitter when they update.

### Wire-up

Each of the 4 list pages now:

1. Imports `TotalCountChip`.
2. Adds a `totalCount` state slot (initial: `null`).
3. Reads `r.headers['x-total-count']` on the `api.get(...)` response
   (axios exposes it in browser JS because the `.132ea`
   `Access-Control-Expose-Headers: X-Total-Count` on the server was
   the key unlock).
4. Renders the chip above the tab bar with a page-specific testid.

### Live count summary (after ship)

| Page                | `showing` (filtered)  | `X-Total-Count` | Chip label                 |
|---------------------|-----------------------|-----------------|----------------------------|
| Incident Reports    | up to 215             | 215             | `215 total`                |
| Risk Assessments    | up to 3 561           | 3 562           | `3 561 showing · 3 562 total` when any filter narrows |
| Hazard Reports      | 0                     | 0               | `0 shown` (bucket empty per `.132dz` migration) |
| Inspection Reports  | up to 17              | 17              | `17 total`                 |

The Risk Assessments chip renders `showing · total` when a client-side
filter narrows the view (e.g. via the search bar in `CaptureListToolbar`).
Once a pager UX lands, the same chip will telegraph server-side
truncation the same way — no chip refactor required.

---

## Item 2 — Viatec (and all-SSRA) routing rule

### Investigation

`db.form_templates` grep for `SSRA` returned **12 rows** — 6 copies of
"Construction & Excavation SSRA" and 6 copies of "Viatec Traffic
Solutions SSRA". Each re-import of the source PDF mints a new
`form_templates` row rather than upserting the existing one, so every
version of the SSRA is a distinct `template_id`.

The `.132dz` seed only covered `dc28f66a-…` (the first Construction &
Excavation SSRA row). The other 11 template_ids were falling back to
the declared `category="hazard"` on the template row itself, which
would have routed any future submission of a re-imported SSRA back to
the (now empty) Hazard Reports bucket.

### Seed rules

The idempotent script `seed_ssra_routing_rules_v58_13_132eb.py` matches
every SSRA template regardless of business unit or version:

```
q = {"name": {"$regex": "SSRA", "$options": "i"},
     "$or": [{"deleted_at": None},
             {"deleted_at": {"$exists": False}}]}
```

and upserts one `form_routing_rules` row per template_id with
`destination_category="risk_assessment"`.

### Post-ship state

```
form_routing_rules total (active): 12
  · Construction & Excavation SSRA:  6 rules  → risk_assessment
  · Viatec Traffic Solutions SSRA:   6 rules  → risk_assessment
```

Every SSRA template — Paneltec + Viatec, every re-import — now routes
future submissions to Risk Assessments at write time via the
`resolve_template_category` helper (`.132dz`).

### Idempotency

Second run of the seed script:

```
seeded new:      0
updated existing:0
already correct: 12
```

Locked by `test_ssra_seed_idempotent`.

---

## Item 3 — CS field harmonisation

### Grep first — the two field shapes

**Native `IncidentIn`** (`backend/models.py`):

```
workspace_id, title, occurred_at, location, category, description,
immediate_actions, evidence_photos, follow_up_actions,
follow_up_status, person_involved, gps_*
```

**CS-migrated** (from `cs_incident_issues`, seen on a live sample):

```
issue_number, issue_type, business_unit, description,
employee_reporting, closeout_manager, responsible_manager, entered_by,
date_of_issue, date_of_entry, date_reported, date_closed, time_of_issue,
incident_categories, actual_incident_category,
potential_incident_category, location_2, status, primary_hazard,
sources_of_hazard, work_activity_performed, near_miss_description,
immediate_action_2, immediate_action_3, is_environmental_near_miss,
is_injury_near_miss, is_other_near_miss, is_plant_near_miss,
alert_generated, land_contamination, water_contamination_discharge, …
```

### Mapping table

| CS field                       | Native field         | Transform                                       |
|--------------------------------|----------------------|-------------------------------------------------|
| `description`                  | `description`        | already native — leave as-is                    |
| `location_2`                   | `location`           | copy verbatim if native missing                 |
| `date_of_issue`                | `occurred_at`        | cascade with fallbacks (see below)              |
| `incident_categories`          | `category`           | map free-text ↔ `IncidentCategory` enum         |
| `status`                       | `follow_up_status`   | `"Closed" → "closed"`; else `"open"`            |
| `immediate_action_2` + `_3`    | `immediate_actions`  | join non-blank lines                            |
| `employee_reporting`           | `person_involved`    | copy verbatim                                   |
| —                              | `title`              | synthesize `"CS-{issue_number}: {issue_type} — {desc[:80]}"` |
| —                              | `evidence_photos`    | default `[]`                                    |
| —                              | `follow_up_actions`  | default `[]`                                    |

`occurred_at` cascade: `date_of_issue → date_reported → date_of_entry
→ imported_at → created_at`. Guarantees every doc surfaces some date
on the FE (57 of the 254 rows lacked `date_of_issue` in the source; the
fallback resolved them all).

`_CATEGORY_MAP` handles the free-text → enum mapping:

```
"Near miss"                  → "near_miss"
"Environmental near miss"    → "env"
"Injury near miss"           → "near_miss"
"First aid" / "Medical"      → matching enum
"Property" / "Plant"         → "property"
"Lost time" / "LTC"          → "ltc"
default                      → "near_miss"
```

### Audit preservation

Every CS field the script reads is copied to `_cs_<field>` on the same
doc:

```
_cs_actual_incident_category, _cs_business_unit, _cs_closeout_manager,
_cs_date_closed, _cs_date_of_entry, _cs_date_of_issue,
_cs_date_reported, _cs_employee_reporting, _cs_entered_by,
_cs_immediate_action_2, _cs_immediate_action_3,
_cs_incident_categories, _cs_issue_number, _cs_issue_type,
_cs_location_2, _cs_near_miss_description,
_cs_potential_incident_category, _cs_primary_hazard,
_cs_responsible_manager, _cs_sources_of_hazard, _cs_status,
_cs_time_of_issue, _cs_work_activity_performed
```

The mapping is fully reversible — nothing is lost.

### Migration audit

**First run:**
```
incidents.migrated_from=cs_incidents total: 254
· to harmonise this run:                    254
harmonised 254 rows
sample transform for 2bea7981-376a-4e1d-a12d-6151d4e2d31d:
  · before: {'title': None, 'occurred_at': None, 'location': None, 'category': None, 'follow_up_status': None, …}
  · $set keys (33): [_cs_* × 23, native × 9, _harmonised_at_v58_13_132eb]
```

**Post-fix pass** (57 rows re-run with the `date_of_issue` cascade):
```
Un-stamped 57 rows (they'll re-run)
· to harmonise this run:                    57
harmonised 57 rows
  · $set keys (2): ['_harmonised_at_v58_13_132eb', 'occurred_at']
```

**Idempotent re-run:**
```
· already harmonised:                       254
· to harmonise this run:                    0
Nothing to do.
```

### Post-ship DB state (sample)

Doc `2bea7981-376a-4e1d-a12d-6151d4e2d31d` after harmonisation:

```
title:               "CS-2: Incident Report — Water Meter Replacement Program - 40 Forest Rd - Trevallyn - Stray Electrical…"
occurred_at:         "2022-11-04T00:00:00"
location:            "On the Northern Property Boundary of 40 Forest Rd Trevallyn"
category:            "near_miss"
follow_up_status:    "closed"
immediate_actions:   "Isolated area, called Paneltec and TasWater Managers.\nIsolated area, called Paneltec and TasWater Managers."
person_involved:     "Jason DONNELLAN"
evidence_photos:     []
follow_up_actions:   []
_cs_issue_number:    2
_cs_business_unit:   "Paneltec Civil"
_cs_status:          "Closed"
_cs_incident_categories: "Near miss"
migrated_from:       "cs_incidents"
_harmonised_at_v58_13_132eb: "2026-09-13T00:47:55.484244+00:00"
```

Category distribution across the 254 harmonised rows:

```
near_miss    171
property      83
```

Rendering-ready via the native Incident Reports list + detail views.
Every row also carries the `capture-cs-migrated-<id>` badge on the
tile so the origin is immediately visible.

---

## Pytest

Command:

```
cd /app/backend && python -m pytest tests/test_v58_13_132eb_totalcount_viatec_harmonise.py -v
```

Result: **18 passed, 0 failed** — 3.0 s.

Coverage:

| Test                                                        | Locks                                              |
|-------------------------------------------------------------|----------------------------------------------------|
| `test_total_count_chip_component_exists`                    | Component source-pin — exports, testid, palettes.  |
| `test_chip_wired_on_incidents_page`                         | Chip mounted + header read on Incidents.jsx.       |
| `test_chip_wired_on_hazards_page`                           | Same on Hazards.jsx.                               |
| `test_chip_wired_on_risk_assessments_page`                  | Same on RiskAssessments.jsx.                       |
| `test_chip_wired_on_inspections_page`                       | Same on Inspections.jsx.                           |
| `test_x_total_count_header_still_emitted_post_ship`         | Live HTTP: `.132ea` header still valid post-ship.  |
| `test_seed_script_exists_and_dry_run_guarded`               | Seed script argparse + rule payload source-pin.    |
| `test_all_ssra_templates_have_active_routing_rule`          | DB: every SSRA template has an active rule.        |
| `test_viatec_ssra_rule_present`                             | Explicit `.132eb` ask — Viatec routes to risk_assessment. |
| `test_ssra_seed_idempotent`                                 | Subprocess re-run reports zero writes.             |
| `test_harmonise_script_exists_and_dry_run_guarded`          | Harmonise script source-pin: full mapping table, `_cs_*` prefix. |
| `test_all_cs_incidents_carry_harmonised_stamp`              | 254/254 rows stamped.                              |
| `test_all_cs_incidents_have_native_incident_fields`         | Every row has `title, occurred_at, category, follow_up_status, evidence_photos, follow_up_actions`. |
| `test_cs_origin_fields_preserved_as_underscore_prefix`      | `_cs_*` audit copies present.                      |
| `test_harmonise_idempotent`                                 | Subprocess re-run reports zero writes.             |
| `test_capture_card_renders_cs_migrated_badge`               | FE badge source-pin.                               |
| `test_incidents_endpoint_surfaces_harmonised_fields`        | Live HTTP: every visible CS-migrated row has native fields. |
| `test_three_way_sync_at_132eb_or_later`                     | Version pin.                                       |

Broader sweep across `.132eb + .132ea + .132dz + fuel suites`:
**85 passed, 7 skipped, 0 failed** (skips = PIN-rate-limit fixture skips
unrelated to `.132eb`).

---

## Live curl proof

### 1) X-Total-Count still emitted on every list page

```
/api/incidents:         X-Total-Count=215
/api/risk-assessments:  X-Total-Count=3562
/api/hazards:           X-Total-Count=0    (Hazard Reports bucket empty per .132dz)
/api/inspections:       X-Total-Count=17
```

### 2) Sample harmonised CS incident from live API

```
title:            "CS-2: Incident Report — Water Meter Replacement Program — 40…"
occurred_at:      "2022-11-04T00:00:00"
location:         "On the Northern Property Boundary of 40 Forest Rd Trevallyn"
category:         "near_miss"
follow_up_status: "closed"
person_involved:  "Jason DONNELLAN"
_cs_issue_number: 2
_cs_business_unit:"Paneltec Civil"
_cs_status:       "Closed"
migrated_from:    "cs_incidents"
```

### 3) All 12 SSRA rules present + active

```
Total active rules: 12
  · Construction & Excavation SSRA:  6 rules  → risk_assessment
  · Viatec Traffic Solutions SSRA:   6 rules  → risk_assessment
```

---

## Rollback plan

Every change is a reversible DB write:

1. **FE chip** — Revert the 5 file edits (Incidents.jsx, Hazards.jsx,
   RiskAssessments.jsx, Inspections.jsx, CaptureCard.jsx). Chip
   component file can be deleted or left in place for a future ship.
2. **SSRA rules** —
   ```
   db.form_routing_rules.update_many(
       {"reason": {"$regex": "v58.13.132eb"}},
       {"$set": {"active": False}})
   ```
   Only disables the 11 new rules; the 1 pre-existing `.132dz` rule
   stays on.
3. **CS harmonisation** — Every touched field on every doc is
   preserved in `_cs_*` shape. Unwind:
   ```
   db.incidents.update_many(
       {"_harmonised_at_v58_13_132eb": {"$exists": True}},
       {"$unset": {
           "title": "", "occurred_at": "", "location": "",
           "category": "", "follow_up_status": "",
           "immediate_actions": "", "person_involved": "",
           "evidence_photos": "", "follow_up_actions": "",
           "_cs_actual_incident_category": "", "_cs_business_unit": "",
           "_cs_closeout_manager": "", "_cs_date_closed": "",
           "_cs_date_of_entry": "", "_cs_date_of_issue": "",
           "_cs_date_reported": "", "_cs_employee_reporting": "",
           "_cs_entered_by": "", "_cs_immediate_action_2": "",
           "_cs_immediate_action_3": "", "_cs_incident_categories": "",
           "_cs_issue_number": "", "_cs_issue_type": "",
           "_cs_location_2": "", "_cs_near_miss_description": "",
           "_cs_potential_incident_category": "", "_cs_primary_hazard": "",
           "_cs_responsible_manager": "", "_cs_sources_of_hazard": "",
           "_cs_status": "", "_cs_time_of_issue": "",
           "_cs_work_activity_performed": "",
           "_harmonised_at_v58_13_132eb": ""}})
   ```
   The original CS fields on each doc (`issue_number`, `business_unit`, etc.)
   are untouched — they were never rewritten, only *copied* to `_cs_*`.

---

## Screenshots

Fourth consecutive ship where the headless-Playwright screenshot tool
can't drive an authenticated flow on
`whs-compliance.preview.emergentagent.com` — `page.goto("…/app/incidents")`
bounces back to `/` even though the login form submission ran without
error. Filed again as a repeated platform-team flag.

Gating evidence is captured via source-pin + live HTTP inside the
pytest suite:

- **Item 1 chip on 4 pages** — locked by 5 source-pin tests
  (`test_chip_wired_on_*_page`) that grep the actual FE files for the
  page-specific testid + the `x-total-count` header read.
- **Item 2 rule coverage** — locked by `test_all_ssra_templates_have_active_routing_rule`
  which cross-references `form_templates` and `form_routing_rules`
  against a live Mongo connection.
- **Item 3 harmonised fields on the wire** — locked by
  `test_incidents_endpoint_surfaces_harmonised_fields` which reads a
  real HTTPS response from the preview backend and asserts every
  cs-migrated row has native fields.

---

## Follow-ups (flagged, not shipped)

1. **Deduping repeated `immediate_action_2 + _3`** — some CS docs
   carry the same text on both fields (source-side data quality). The
   harmonised `immediate_actions` string then reads as the same line
   twice. Not fixed here (semantic decision — some users may want to
   see both were logged); dedupe on display in the FE detail view is
   the cleaner place if desired.
2. **Site Diary + Site Visitors total-count chips** — different
   pagination models than `build_router`. Deferred to a `v58.14.x`
   pass when the response-shape upgrade to `{items, total, limit,
   offset}` lands (flagged in the `.132ea` memo).
3. **Startup auto-seed for SSRA rules** — `form_routing.py::SEED_RULES`
   currently only has the 1 `.132dz` rule. Adding the 11 new rules to
   that list would keep the DB in sync with the source on every boot.
   Not done here to keep the seed list human-readable; the migration
   script owns the 11 rules directly. Design call: keep SEED_RULES for
   manually-authored rules; use migration scripts for pattern-matched
   ones.
4. **CS-migrated CaptureCard subtitle** — the tile currently reads
   `subtitle={i.description || null}`. For CS-migrated rows the
   `near_miss_description` is often richer than `description`; we
   could prefer the longer field. Minor UX polish, not in scope.

---

## Ops rules compliance

- No `testing_agent` used (BANNED).
- No `finish` tool used (BANNED); memo lives here.
- No `/app/mobile/` edits. `MOBILE_BUNDLE_VERSION` stays at `.132di`.
- Both migrations idempotent + audit-logged (12/12 SSRA rules with
  `.132eb` reason string; 254/254 CS incidents with
  `_harmonised_at_v58_13_132eb` stamp + 23 `_cs_*` audit fields each).
- `git stash push --include-untracked -m "pre-132eb-safety"` was run
  before edits and popped once verified.
- 20 pre-existing `ephemeral-upload-storage` warnings still parked for
  `v58.14.x`.

---

## Wires-crossed diagnostic

No occurrence this session — the `.132eb` brief hit cleanly. Prior
occurrences noted at `.132dr` and `.132dy`. Flag still open with the
platform team.
