# v58.13.132ea — Post-`.132dz` visibility fix

Stephen's report: "Incident Reports shows only 20 records; Risk Assessments shows
only 100." Investigation found **two independent bugs**, both hiding data that
the `.132dz` migration correctly moved. Both fixed at their respective layers.

---

## Diagnostic phase

### DB counts (all orgs, live production)

```
incidents total:                     267    (13 pre-migration + 254 migrated)
incidents deleted_at=None:           215    (net-live view)
incidents migrated_from=cs_incidents:254
  · with deleted_at=None:            195    (59 CS incidents were soft-deleted at source)

risk_assessments total:               22    (all copied from native `hazards`)
risk_assessments deleted_at=None:      6    (native hazards had 16 soft-deleted at source)
risk_assessments migrated_from=hazards:22

form_submissions cat=risk_assessment: 3562  (1 pre-ship + 3 561 migrated)
                 cat=risk_assessment deleted_at=None: 3561
form_submissions cat=hazard:            0   (all 3 556 rewritten to risk_assessment)
form_submissions cat=near_miss:         0   (all 5 rewritten to risk_assessment)
```

### API responses BEFORE this ship

```
GET /api/incidents           → 20 rows          (Stephen's org, capped at default limit but really only 20 visible)
GET /api/incidents?limit=500 → 20 rows          (confirming: 20 IS the live count for Stephen's org)
GET /api/risk-assessments    → 100 rows         (capped at default limit)
GET /api/risk-assessments?limit=5000 → 3 561 rows  (true live count for Stephen's org)
```

### Per-org breakdown

```
Stephen's org_id: 3116f250-a4eb-43f3-98a5-2a3656d6cb63 (Paneltec Pty Ltd)

incidents in Stephen's org:                          9    (pre-migration native)
  · deleted_at=None:                                 0
  · with migrated_from=cs_incidents:                 0  (!)
form_submissions cat=incident (Stephen, live):      20

risk_assessments in Stephen's org:                  16    (from hazards migration)
  · deleted_at=None:                                 0    (Stephen's hazards were all soft-deleted at source)
form_submissions cat=risk_assessment (Stephen, live): 3 561

cs_incident_issues (all rows) by org_id:  {None: 254}   ← smoking gun
```

### Which layer is hiding data?

**Two distinct problems**:

1. **`cs_incident_issues` was org-agnostic by design.** All 254 rows had
   `org_id=None`. The collection was originally implemented (v160.3.9.16) as a
   shared reference library across all orgs — CS Incident's list endpoint
   deliberately did NOT filter by `org_id`. The `.132dz` migration
   preserved this `None` value verbatim (correct — never rewrite source
   fields), but `incidents` IS org-scoped: `/api/incidents` filters by
   `org_id == user["org_id"]`. Result: all 254 CS-migrated docs became
   invisible to every real user, including their operational owner Stephen
   (whose Paneltec Civil team was the primary author of the data).

2. **Default pagination cap at 100.** `crud.py::build_router::list_items`
   defaulted `limit: int = Query(100, ge=1, le=5000)`. FE list pages consume
   the response as a bare array (`setItems(r.data)` in `pages/Incidents.jsx:47`
   and `pages/RiskAssessments.jsx:44-45`) with **no pager UI** and **no
   "N of M" total-count display**. So a hidden truncation reads as "the
   migration is broken" — even a diligent user has no signal that more rows
   exist.

**Layer summary**:

| Symptom (per Stephen)             | Real cause                    | Layer   |
|-----------------------------------|-------------------------------|---------|
| Incident Reports shows 20         | 254 CS docs have `org_id=None`| Data    |
| Risk Assessments shows 100        | Hard pagination cap at 100    | API     |
| No "N of M shown" hint anywhere   | FE reads response as raw array| UX      |

---

## Fix phase

### Fix A — org_id backfill on migrated CS incidents

New idempotent script `backend/scripts/backfill_cs_incident_org_v58_13_132ea.py`
stamps every `incidents` row with `migrated_from=cs_incidents` AND
`org_id in [null, "", missing]` with `3116f250-a4eb-43f3-98a5-2a3656d6cb63`
(Paneltec Pty Ltd). Audit stamp `_org_backfilled_at_v58_13_132ea` +
`org_backfill_reason` field on every touched row. `--dry-run` is the default;
`--commit` performs the writes.

**Ownership justification**: `cs_incident_issues.business_unit` values are
`{None, "Civil", "Paneltec Civil", "Viatec Traffic Solutions"}`. All are
sub-teams of the Paneltec Pty Ltd tenant Stephen runs. The alternative —
splitting Viatec into the `9a6e2c3d…` org — was rejected because (a) the
`.132dz` brief didn't call for a business-unit split, (b) the operational
owner of the CS Incident library is Stephen, and (c) any future split can
be done org-to-org from Stephen's org without a re-migration.

### Fix B — default pagination cap 100 → 5000

`backend/crud.py::build_router::list_items` default limit raised from `100` to
`5000` (the `le=5000` cap that was already in place). Rationale documented
inline with a reference to `.132ea` so a future edit doesn't accidentally
revert.

### Fix C — `X-Total-Count` response header

`X-Total-Count: <n>` header emitted on every list response, plus
`Access-Control-Expose-Headers: X-Total-Count` so browser JS can read it.
The header value is `len(docs)` after the pagination slice — combined with
the 5 000 default (which is the cap), this is the true visible total for
every practical dataset. FE pager UX can consume this header without a
BC-breaking response-shape change; the existing bare-array consumers see
no difference.

### Not fixed here (flagged as follow-up)

- **FE pager UI** — Neither `Incidents.jsx` nor `RiskAssessments.jsx` has
  a "load more" affordance or a total-count chip. With the `X-Total-Count`
  header now available, a small chip ("Showing 3 561 records") is a 15-line
  FE change. Deferred as follow-up UX polish, tracked in the future work
  list below.
- **`form_submissions` response-shape upgrade** — Migrating list endpoints
  from bare-array to `{items, total, limit, offset}` (matching
  `/api/fleet/fuel/transactions`) is the cleaner long-term shape but touches
  every FE list page. Deferred as `v58.14.x` scope.

---

## Files touched

### New
- `backend/scripts/backfill_cs_incident_org_v58_13_132ea.py` (~110 lines)
- `backend/tests/test_v58_13_132ea_migration_visibility_fix.py` (~230 lines)

### Backend edits
- `backend/crud.py`:
    * `from fastapi import ... Response` (line 13).
    * `list_items(response: Response, ..., limit=Query(5000, ge=1, le=5000))`
      (line 116, 128).
    * X-Total-Count + Access-Control-Expose-Headers on every list response
      (line 320-325).

### Frontend edits
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped to `paneltec-v160.3.9.58.13.132ea`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped to
  `paneltec-v160.3.9.58.13.132ea`.

### Not touched
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` stays at `.132di`.
- `.132dz` migration script — no re-run per user directive.
- No FE list-page changes — deferred as UX follow-up per above.

---

## Backfill audit (live commit against production DB)

### Dry-run

```
v58.13.132ea org_id backfill — mode=DRY-RUN
  incidents.migrated_from=cs_incidents total: 254
  · orphaned (org_id missing/null/empty):    254
  · already backfilled (stamp present):      0
  sample orphan ids:
    ['5ca734ae-05cd-491c-81ee-efc849a0a200',
     '5b3d3f9a-9858-4288-a7cf-c581eb322cd1',
     '484f0899-603f-4262-ac76-757cf522fa0e',
     '07bc4491-197f-49eb-9170-0830b83b9482',
     '691ae253-5c11-420f-96c9-5bf039e0c079']
  DRY-RUN — would stamp 254 rows with org_id=3116f250-a4eb-43f3-98a5-2a3656d6cb63
```

### Commit

```
matched=254, modified=254
```

### Idempotent re-run

```
v58.13.132ea org_id backfill — mode=COMMIT
  · orphaned (org_id missing/null/empty):    0
  · already backfilled (stamp present):      254
  Nothing to do.
```

Locked by `test_backfill_idempotent_second_run` in the new pytest suite.

---

## Live API — before / after

### Incident Reports

|                          | BEFORE `.132ea` | AFTER `.132ea` |
|--------------------------|-----------------|----------------|
| `GET /api/incidents`     | 20 rows         | **215 rows**   |
| `X-Total-Count` header   | not emitted     | `215`          |
| At `?limit=500`          | 20 rows         | 215 rows       |

215 = 195 CS-migrated live rows (of 254 migrated, 59 were already
soft-deleted at source pre-`.132dz`) + 20 form_submissions cat=incident
live rows. All accounted for.

### Risk Assessments

|                                   | BEFORE `.132ea` | AFTER `.132ea` |
|-----------------------------------|-----------------|----------------|
| `GET /api/risk-assessments`       | 100 rows        | **3 561 rows** |
| `X-Total-Count` header            | not emitted     | `3561`         |
| At `?limit=5000`                  | 3 561 rows      | 3 561 rows     |

3 561 = 0 native live rows (all 16 Paneltec native hazards were
soft-deleted at source pre-`.132dz`) + 3 561 form_submissions
cat=risk_assessment live rows (1 pre-ship + 3 560 hazard-migrated).

### Sample migrated CS incident visible to Stephen (post-ship)

```
curl -sS "$API/api/incidents" | jq '[.[] | select(.migrated_from=="cs_incidents")] | length'
→ 195

curl -sS "$API/api/incidents" | jq '.[0] | {id, business_unit, status, migrated_from}'
{
  "id": "2bea7981-376a-4e1d-a12d-6151d4e2d31d",
  "business_unit": "Paneltec Civil",
  "status": "Closed",
  "migrated_from": "cs_incidents"
}
```

The `business_unit`, `issue_number`, and status fields carry the alien
CS-Incident schema unchanged — data preserved end-to-end. UI harmonisation
for these fields on `/app/incidents` is the deferred UX follow-up.

---

## SSRA auto-routing — end-to-end verification

Third acceptance criterion from the brief: confirm the `.132dz` SSRA rule
still lands new submissions in Risk Assessments.

Via pytest `test_ssra_submission_stamps_risk_assessment_category` (marked
`live_db_writes`):

1. POST `/api/forms/templates/dc28f66a-a385-4a64-b5f0-d92bfd7b1798/submissions`
   with an empty `fields` array (the template accepts optional fields).
2. Response `201 Created` with a submission id.
3. Reading the row from Mongo:
   `stored["template_category_snapshot"] == "risk_assessment"` ✓
4. Cleanup: hard-delete the synthetic row so counts stay predictable for
   the next test run.

The routing rule cache is process-local (60 s TTL) and re-loaded by
`ensure_form_routing_rules()` at every backend startup. Verified live:

```
form_routing._CACHE = {'dc28f66a-a385-4a64-b5f0-d92bfd7b1798': 'risk_assessment'}
resolve_template_category({'id': 'dc28f66a-…', 'category': 'hazard'})
  → 'risk_assessment'   ← rule wins over template.category
resolve_template_category({'id': 'random-xyz', 'category': 'incident'})
  → 'incident'          ← unknown template falls back to declared category
```

Locked by `test_ssra_routing_rule_still_active_post_ship` +
`test_ssra_submission_stamps_risk_assessment_category`.

---

## Pytest

Command:

```
cd /app/backend && python -m pytest tests/test_v58_13_132ea_migration_visibility_fix.py -v
```

Result: **10 passed, 0 failed** — 4.2 s.

Coverage:

- **`test_crud_default_limit_bumped_to_5000`** — source-pin on the new default.
- **`test_crud_x_total_count_header_wired`** — source-pin on the header wire-up.
- **`test_backfill_script_exists_and_has_dry_run_guard`** — argparse guard +
  stamp field + target org id + `migrated_from` gate.
- **`test_backfill_idempotent_second_run`** — subprocess re-run reports
  `Nothing to do.`
- **`test_all_cs_incidents_have_paneltec_org_id`** — DB state: 0 orphaned,
  254 stamped, 254 tagged.
- **`test_incidents_endpoint_visible_count_reflects_migration`** — live
  HTTP: `X-Total-Count` present + body length ≥ DB expected.
- **`test_risk_assessments_endpoint_visible_count_reflects_migration`** —
  live HTTP: body length > 100 (proving cap lifted) + `X-Total-Count`
  matches body length.
- **`test_ssra_routing_rule_still_active_post_ship`** — DB check on the
  rule row.
- **`test_ssra_submission_stamps_risk_assessment_category`** — end-to-end:
  POST + read stored `template_category_snapshot`.
- **`test_three_way_sync_at_132ea_or_later`** — version pins.

Broader regression sweep across `.132ea + .132dz + .132dy + fuel suites`:
**74 passed, 8 skipped, 0 failed** (8 skips are PIN-login rate-limit
fixture skips unrelated to `.132ea`).

---

## Screenshots

Same headless-Playwright regression as `.132dy` and `.132dz` — every
`page.goto("…/app/incidents")` bounces back to `/` even though the login
form submission ran without error. This is now three consecutive ships
where the tool can't drive an authenticated flow on
`whs-compliance.preview.emergentagent.com`. Filed as a repeated
platform-team flag.

Gating evidence is captured via live HTTP in the pytest suite instead:

```
$ curl -sSD /tmp/hdr.txt "$API/api/incidents" -H "Authorization: Bearer $TOKEN"
  body length: 215
  X-Total-Count: 215

$ curl -sSD /tmp/hdr.txt "$API/api/risk-assessments" -H "Authorization: Bearer $TOKEN"
  body length: 3561
  X-Total-Count: 3561
```

Both proven by `test_incidents_endpoint_visible_count_reflects_migration`
and `test_risk_assessments_endpoint_visible_count_reflects_migration`,
which read the actual live HTTP responses (not mocks).

---

## Rollback plan

If any regression surfaces on either list page:

1. Revert `crud.py` — restore `limit=Query(100, …)`, drop the `Response`
   parameter + header setter.
2. Revert `frontend/src/lib/version.js` + `service-worker.js`.
3. Unwind the org backfill:
   ```
   db.incidents.update_many(
       {"_org_backfilled_at_v58_13_132ea": {"$exists": True}},
       {"$set": {"org_id": None},
        "$unset": {"_org_backfilled_at_v58_13_132ea": "",
                   "org_backfill_reason": ""}})
   ```
   Every touched row carries the stamp; unwind is exact.

No data destruction anywhere in this ship — every change is a reversible
DB write or a source-code edit.

---

## Follow-ups (flagged, not shipped)

1. **FE total-count chip** — Consume `X-Total-Count` in `Incidents.jsx`
   and `RiskAssessments.jsx` to render "Showing N records" above the table.
   ~15 lines each.
2. **FE pager** — For datasets > 5 000 (unlikely in the current tenant
   but a bear-trap for future org growth), add a proper pager UI. Blocked
   on the response-shape upgrade below.
3. **Response-shape upgrade** — Migrate `crud.py::list_items` to return
   `{items, total, limit, offset}` (matching `/api/fleet/fuel/transactions`).
   BC-breaking — touches every FE list page. Scope for `v58.14.x`.
4. **UI harmonisation for CS-migrated docs** — The 195 visible CS-migrated
   rows on `/app/incidents` carry the alien `issue_number`, `business_unit`,
   `injury_severity`, `hazard_description` fields. The Incidents list may
   render them awkwardly (blank Description column, unfamiliar Status
   values). If Stephen wants a cleaner render, that's a Phase-2 UI ticket
   flagged in the `.132dz` follow-up list.
5. **Viatec Traffic Solutions SSRA** — Same category=`hazard` as
   Construction & Excavation SSRA but no rule seeded (out of `.132dz`
   brief scope). Confirm with Stephen whether this template should also
   route to Risk Assessments.

---

## Ops rules compliance

- No `testing_agent` used (BANNED).
- No `finish` tool used (BANNED); memo lives here.
- No `/app/mobile/` edits. `MOBILE_BUNDLE_VERSION` stays at `.132di`.
- No re-run of the `.132dz` migration — the `.132dz` writes are
  respected. This ship layers on top of them.
- Backfill idempotent + audit-logged (`_org_backfilled_at_v58_13_132ea`
  stamp + `org_backfill_reason` on every touched row + a source-file
  argparse guard defaulting to dry-run).
- `git stash push --include-untracked -m "pre-132ea-safety"` was run
  before edits and popped once verified.
- 20 pre-existing `ephemeral-upload-storage` warnings still parked for
  `v58.14.x`.

---

## Wires-crossed diagnostic

No occurrence this session — the `.132ea` brief hit cleanly. Prior
occurrences noted at `.132dr` and `.132dy`. Flag still open with the
platform team.
