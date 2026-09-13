# v58.13.132dz — Sidebar category merge + auto-routing rule

## Scope shipped

Three-part cleanup on the Capture sidebar per Stephen's brief:

1. **CS Incidents merged INTO Incident Reports.** Every `cs_incident_issues` row
   (254 docs, incl. 59 soft-deleted) copied into `incidents` under
   `migrated_from: "cs_incidents"`. CS Incidents sidebar entry retired.
   `/api/cs-incident/*` returns 410 Gone with a pointer to `/api/incidents`.
2. **Hazard Reports items moved INTO Risk Assessments.** 3 561 `form_submissions`
   rows re-categorised from `hazard`/`near_miss` → `risk_assessment`, and the
   22 rows in the native `hazards` collection copied into a new
   `risk_assessments` collection. Hazard Reports sidebar entry PRESERVED
   per user directive — future non-SSRA hazard submissions still land there.
3. **Auto-routing rule table.** New `form_routing_rules` collection with the
   Construction & Excavation SSRA template seeded to route to
   `risk_assessment`. Consulted at every `template_category_snapshot` write
   choke-point (forms.py, imports.py, bulk_import_prestarts.py).

---

## Phase 1 — Investigation findings

### CS Incidents surface

| Layer      | Location                                                          |
|------------|-------------------------------------------------------------------|
| Backend    | `backend/cs_incident.py` — router prefix `/cs-incident`           |
| Collection | `cs_incident_issues` — 254 total, 195 live, alien schema          |
| FE sidebar | `AppShell.jsx:105` — `nav-submissions-cs-incidents`               |
| FE route   | `App.js:47, 273-274` — `/app/submissions/cs-incidents`            |
| FE page    | `pages/CsIncidentsList.jsx`                                       |
| Permission | Reused `reference_library` gate — no dedicated key to remove      |
| Server     | `server.py:442-446` (mount) + `server.py:725` (`ensure_indexes`)  |

Schema is completely different from `incidents` (`issue_number`,
`business_unit`, `injury_severity`, `hazard_description`,
`near_miss_description`, etc. vs. `incidents.category`, `.description`,
`.immediate_actions`, `.follow_up_actions`). Per Stephen's directive the
docs are still moved verbatim — original fields preserved. FE for
`/app/incidents` may not render CS-specific fields cleanly; UI harmonisation
is a future ship. Audit tag `migrated_from: "cs_incidents"` on every moved
doc so the two schemas remain distinguishable at query time.

### Hazard Reports vs Risk Assessments

| Layer                      | Hazard Reports                    | Risk Assessments               |
|----------------------------|-----------------------------------|--------------------------------|
| Backend router             | `crud.py::hazards_router`         | `crud.py::risk_assessments_router` |
| Native collection          | `hazards` (22 total, 6 live)      | (missing pre-ship, created here) |
| `mirror_categories`        | `["hazard", "near_miss"]`         | `["risk_assessment"]`          |
| form_submissions rows      | 3 555 (`hazard`) + 5 (`near_miss`) = **3 561** | 1 (pre-migration) |
| FE sidebar                 | `AppShell.jsx:88` — `nav-hazards` | `AppShell.jsx:99` — `nav-risk-assessments` |
| FE routes / pages          | `App.js` — `/app/hazards`         | `App.js` — `/app/risk-assessments` |
| Permission resource        | `hazards`                         | `risk_assessments`             |

### How categorisation works today

Confirmed by grepping `template_category_snapshot`:

- Every submission row (`db.form_submissions`) is stamped with
  `template_category_snapshot` at write time from `template.category`.
- `build_router()` in `crud.py:96` runs a UNION of the native collection
  (`hazards`, `incidents`, ...) and matching `form_submissions` rows filtered
  by `template_category_snapshot IN mirror_categories`.
- **Single choke-point per write path**: `forms.py:1059`, `imports.py:161`,
  `bulk_import_prestarts.py:2519-2522`. All three now call
  `resolve_template_category(template)` which consults the routing rule
  table first.

### Construction & Excavation SSRA template

Live API dump against the tenant:

```
· id=dc28f66a-a385-4a64-b5f0-d92bfd7b1798  name='Construction & Excavation SSRA'  category='hazard'
· id=799ed9b5-fb52-4482-847d-b4df63d0aa74  name='Excavation / Trench Permit'      category='general'
· id=c69f9483-c845-4bfe-9524-26cc220d1806  name='Viatec Traffic Solutions SSRA'   category='hazard'
```

- Target template ID: **`dc28f66a-a385-4a64-b5f0-d92bfd7b1798`**.
- Actual template name is `Construction & Excavation SSRA` — no dash before
  "SSRA" (brief said "Construction & Excavation - SSRA"). Rule keyed on
  template ID for stability; `template_name_hint` field on the rule row
  carries the exact name for audit readability.
- Currently 79 form_submissions exist under this template ID. All 79 got
  swept into the `risk_assessment` category by the migration's Part 2a pass
  (they lived under `template_category_snapshot="hazard"` pre-ship). Going
  forward, all new submissions of this template also route to
  `risk_assessment` via the routing rule (independent of the migration).
- Note: `Viatec Traffic Solutions SSRA` was NOT called out in the brief,
  so no rule seeded for it. Its existing submissions were still swept up by
  Part 2a because they carried `category=hazard`, but future submissions
  of the Viatec template will route back to `hazard` unless an admin adds
  a rule row. Flagged as a follow-up decision below.

---

## Phase 2 — Files touched

### New files
- **`backend/form_routing.py`** (~150 lines) — the `resolve_template_category`
  helper, `ensure_form_routing_rules` startup hook, `SEED_RULES` table, and
  a 60s process-local cache to keep the write path fast.
- **`backend/scripts/migrate_sidebar_merge_v58_13_132dz.py`** (~270 lines) —
  three-part idempotent migration with argparse `--commit` / `--dry-run`
  (default: dry-run).
- **`backend/tests/test_v58_13_132dz_sidebar_merge_and_routing.py`** (~280
  lines) — 20 pytest checks locking every FE + backend + DB contract.

### Backend edits
- **`backend/cs_incident.py`** — Router now carries a shared
  `dependencies=[Depends(_deprecated_gate)]` that raises `HTTPException(410)`
  before any endpoint body runs. Route bodies preserved verbatim so a
  future rollback can lift the deprecation without a rewrite.
- **`backend/forms.py`** — Import `resolve_template_category`.
  `template_category_snapshot` on submission write now goes through the
  helper.
- **`backend/imports.py`** — Same hook on the PDF-import submission write.
- **`backend/bulk_import_prestarts.py`** — Same hook on the bulk-import
  wizard's submission write.
- **`backend/server.py`** — Startup calls `ensure_form_routing_rules()`
  (creates indexes + seeds the SSRA rule). CS Incident `ensure_indexes`
  still runs (source collection preserved read-only per user rules).

### Frontend edits
- **`frontend/src/components/layout/AppShell.jsx`** — CS Incidents sidebar
  entry deleted (line 105 gone). Reasoned deletion comment cites `.132dz`.
  Hazard Reports + Risk Assessments entries retained verbatim.
- **`frontend/src/App.js`** — `import CsIncidentsList` commented out with
  rationale. Both `/app/submissions` and `/app/submissions/cs-incidents`
  now redirect to `/app/incidents` for one release cycle so old bookmarks
  land somewhere sane.
- **`frontend/src/lib/version.js`** — `RUNNING_VERSION` and
  `EXPECTED_CACHE_VERSION` bumped to `paneltec-v160.3.9.58.13.132dz`.
- **`frontend/public/service-worker.js`** — `CACHE_VERSION` bumped to
  `paneltec-v160.3.9.58.13.132dz`.

### Not touched (per rules)
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` still `.132di`.
- `pages/CsIncidentsList.jsx` — retained on disk (not imported). Enables a
  clean rollback if needed; will be deleted in a future ship once the
  release cycle confirms no regression.
- Native `cs_incident_issues` + `hazards` collections — NOT hard-deleted.
  Left read-only with `_migrated_at_v58_13_132dz` audit stamp per user
  directive ("Do NOT hard-delete original collections until the migration
  is verified end-to-end").
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still parked
  for the `v58.14.x` pass.

---

## Migration audit (live run against production DB)

### Dry-run (default)

```
v58.13.132dz sidebar-merge migration — mode=DRY-RUN
============================================================
Item 1: CS Incidents → Incident Reports
  [cs_incidents] WOULD migrate 254 docs; skipped 0; already_migrated=0
  sample ids: ['2bea7981-376a-4e1d-a12d-6151d4e2d31d',
               'cfd1550b-6a43-4d8c-b784-f276d99da534',
               '8b77b71f-9a48-4147-925d-c5c80c2835ff',
               '24612a83-34f8-4645-a684-2dfd56efa062',
               '8d7830e9-0a0b-4cb1-8762-80f0e9ec5dc7']

Item 2a: form_submissions category rewrite (hazard/near_miss → risk_assessment)
  [hazard→risk_assessment (form_submissions)] WOULD migrate 3561 rows; already_migrated=0
  sample ids: ['9b6b29ef-d7b6-49ab-ab54-c1ad93a513e8',
               '191c45f1-ed0c-499b-9cb2-15d2c5122bb9',
               '46ec1419-613c-4156-97bf-f33df95a2371',
               '66d7bfef-c5b8-490e-bed5-bca76b038984',
               '9659d167-0c20-4f8b-8aa1-228c89fe1d8c']

Item 2b: native `hazards` collection → `risk_assessments`
  [hazards→risk_assessments (native)] WOULD migrate 22 docs; skipped 0; already_migrated=0
  sample ids: ['fbe4b531-ba40-4048-ae92-07121533eec5',
               'fe0ab0a2-3e76-4bfb-aaa2-a5dcea135580',
               'b574c46d-8e33-41fa-9cbc-8e8c6949d33c',
               '3e9d89d0-c26f-42d6-bdea-7357e547fbaf',
               '9fad6e70-f5f9-4f9d-bd04-628ef46be9f3']
```

### Commit

Same numbers, no exceptions. Migration ran in ~2 s total for 3 837
documents.

### Idempotent re-run

Same command a second time:

```
Summary
  cs_incidents:     migrated=     0  already=254
  form_submissions: migrated=     0  already=0   (pre_total=0 — all moved)
  hazards:          migrated=     0  already=22
```

Verified via `test_migration_idempotent_second_run` in the pytest suite as
well.

### Post-migration DB state

```
cs_incident_issues total:                254
cs_incident_issues migrated (stamped):   254
incidents.migrated_from=cs_incidents:    254
hazards total:                            22
hazards migrated (stamped):               22
risk_assessments (new collection):        22
  with migrated_from=hazards:             22
form_submissions category=hazard:          0
form_submissions category=near_miss:       0
form_submissions category=risk_assessment: 3562  (was 1 pre-ship)
form_submissions migrated_from=hazard_reports: 3561
form_routing_rules total:                  1
  · template_id=dc28f66a-a385-4a64-b5f0-d92bfd7b1798
    destination_category=risk_assessment
    template_name_hint='Construction & Excavation SSRA'
```

### Live curl trace (after ship)

```
GET  /api/cs-incident/          → 410
POST /api/cs-incident/          → 410
GET  /api/hazards?limit=3       → items: []            (Hazard Reports now empty)
GET  /api/risk-assessments?limit=1 → items: [1 row]    (bucket populated)
```

---

## Pytest suite

Command:

```
cd /app/backend && python -m pytest tests/test_v58_13_132dz_sidebar_merge_and_routing.py -v
```

Result: **20 passed, 0 failed** — 0.93 s total.

Broader sweep including `.132dy`, `.132dh`, `.132dj`, `.132do`, `.132dw`:
**64 passed, 0 failed** — 12 s.

Coverage:

- **FE sidebar** — 4 checks source-pinning AppShell.jsx (`nav-hazards`,
  `nav-risk-assessments`, `nav-incidents` PRESENT; `nav-submissions-cs-incidents`
  GONE; `.132dz` deletion comment present).
- **FE routing** — `App.js` has no live `import CsIncidentsList`; both
  `/app/submissions` and `/app/submissions/cs-incidents` route to
  `Navigate to="/app/incidents"`.
- **Backend deprecation gate** — `cs_incident.py` source-pin + live-HTTP
  `GET /api/cs-incident/ → 410`.
- **Routing helper** — `form_routing.py` exists with the two exported
  functions; SSRA template id in `SEED_RULES`; `forms.py`, `imports.py`,
  `bulk_import_prestarts.py` all import + call `resolve_template_category`.
- **Rule table** — `form_routing_rules` collection seeded with the SSRA
  rule (destination `risk_assessment`, active, name hint present).
- **Behavioural resolver** — 3 checks:
    * SSRA template → returns `"risk_assessment"` even when the template
      row declares `category="hazard"` (rule wins).
    * Unknown template with `category="inspection"` → returns
      `"inspection"` (template category is the fallback).
    * Unknown template with no category → returns `"general"` (final
      default preserved).
- **Migration audit** — 4 checks confirming:
    * 254 `cs_incident_issues` rows carry the stamp; 254 `incidents` rows
      carry `migrated_from=cs_incidents`.
    * 0 `form_submissions` rows remain under `hazard`/`near_miss`; every
      re-stamped row carries both `migrated_from=hazard_reports` and
      `_original_category`.
    * 22 native `hazards` docs copied to `risk_assessments` with the
      migration tag; source `hazards` collection preserved with the stamp.
    * Second run of `migrate_sidebar_merge_v58_13_132dz.py --commit`
      reports zero mutations (idempotent).
- **Version sync** — three-way pin (`RUNNING_VERSION`, `EXPECTED_CACHE_VERSION`,
  `CACHE_VERSION`) at `paneltec-v160.3.9.58.13.132dz`.

---

## Screenshots

Screenshot tool would not complete a stable login round-trip against
`whs-compliance.preview.emergentagent.com/app/*`. Same issue as `.132dy`
— the tool's captured JPEG comes back showing the sign-in page even
though the script's `wait_for_url("**/app/**")` succeeded and the DOM
checks that followed executed. The saved-file target
(`/app/memory/v58_13_132dz_sidebar.jpeg`) was never persisted, and the
tool's in-band image return shows the login card. Filed a mental note
for the platform team — this is now the second ship where headless
Playwright can't drive an authenticated flow on this preview URL.

Since every FE contract shipped here is source-pinned by pytest
assertions that grep the actual FE files (4 tests directly assert on
sidebar entry presence/absence, entry testids, and reasoned comments),
the screenshots are documentation-nice-to-have rather than gating
evidence. Contracts verified:

- **CS Incidents sidebar entry GONE** — locked by
  `test_appshell_no_cs_incidents_sidebar_entry`. Greps AppShell.jsx and
  asserts `nav-submissions-cs-incidents` absent + `'CS Incidents'`
  literal absent.
- **Hazard Reports sidebar entry PRESERVED** — locked by
  `test_appshell_hazard_reports_entry_retained`.
- **Risk Assessments sidebar entry PRESERVED** — locked by
  `test_appshell_risk_assessments_entry_retained`.
- **Incident Reports sidebar entry PRESERVED** — verified inline by
  `AppShell.jsx:89` (unchanged from pre-ship).
- **Deletion documented** — `test_appshell_no_cs_incidents_sidebar_entry`
  also requires the `.132dz` version tag on the deletion comment.

---

## Rollback plan

Should something regress on `/app/incidents` or `/app/risk-assessments`:

1. Revert `frontend/src/components/layout/AppShell.jsx` to restore the
   CS Incidents sidebar entry.
2. Revert `frontend/src/App.js` to un-comment `import CsIncidentsList`
   and drop the redirect routes.
3. Revert `backend/cs_incident.py` to remove the `_deprecated_gate`
   dependency (or return early from the gate).
4. `db.incidents.delete_many({"migrated_from": "cs_incidents"})` — the
   originals are still in `cs_incident_issues`.
5. `db.risk_assessments.delete_many({"migrated_from": "hazards"})` — the
   originals are still in `hazards`.
6. `db.form_submissions.update_many({"migrated_from": "hazard_reports"},
    {"$set": {"template_category_snapshot": "$_original_category"},
     "$unset": {"migrated_from": "", "_original_category": "",
                "_migrated_at_v58_13_132dz": ""}})`
   (needs an aggregation pipeline update since `$set` can't reference
   another field — do it in a small script; every row carries the
   pre-migration category on `_original_category`).
7. `db.form_routing_rules.update_one({"template_id":
    "dc28f66a-a385-4a64-b5f0-d92bfd7b1798"}, {"$set": {"active": False}})`
   — soft-disables the SSRA rule without dropping the collection.

Because the source data was preserved and stamped, every step is a
reversible DB write. No file recovery / dumps required.

---

## Follow-ups (flagged, not shipped)

1. **Admin UI for `form_routing_rules`** — currently DB-only. Future ship
   should add a small "Form routing rules" surface under Settings →
   Integrations with a create/edit/toggle table. Estimated 4–6 hours.
2. **Viatec Traffic Solutions SSRA** (template id
   `c69f9483-c845-4bfe-9524-26cc220d1806`) — carries the same
   `category="hazard"` but the brief only called out Construction &
   Excavation. Its existing submissions were caught by the Part 2a sweep,
   but future submissions will route back to Hazard Reports unless a rule
   is added. Confirm with Stephen whether this template should also route
   to Risk Assessments.
3. **UI harmonisation for Incident Reports** — CS-migrated docs carry
   the alien `issue_number` / `business_unit` / `injury_severity` /
   `hazard_description` fields. The Incidents list may render them
   awkwardly. If Stephen wants a cleaner render, that's a Phase-2 UI
   ticket; the data is now in the right home.
4. **Hard-delete `cs_incident_issues` + `hazards`** — after one release
   cycle confirms no regression, both source collections can be dropped
   in a `.132ea` ship.

---

## Ops rules compliance

- No `testing_agent` used (BANNED).
- No `finish` tool used (BANNED); memo lives here.
- No `/app/mobile/` edits. `MOBILE_BUNDLE_VERSION` stays at `.132di`.
- Migration idempotent + audit-logged (`_migrated_at_v58_13_132dz` stamp +
  `migrated_from` audit tag + `migrated_to_id` cross-reference on source
  docs).
- No hard-deletes on source collections — read-only for one release cycle.
- `git stash push --include-untracked -m "pre-132dz-safety"` was run
  before edits and popped once verified.
- 20 pre-existing `ephemeral-upload-storage` warnings still parked for
  `v58.14.x`.

---

## Wires-crossed diagnostic (unchanged from `.132dy`)

No third occurrence this session — the wires-crossed template did NOT
inject into `.132dz`. Prior occurrences noted at `.132dr` and `.132dy`.
Flag still open with the platform team.
