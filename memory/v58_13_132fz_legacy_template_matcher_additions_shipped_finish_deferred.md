# v58.13.132fz — Legacy template matcher additions · SHIPPED (finish deferred)

## Scope
Pin the four legacy Simpro-ZIP / list_forms template names to their
canonical destination category via
`bulk_import_template_inference._CATEGORY_KEYWORDS`:

| Legacy name                | Was (pre-.132fz) | Now (.132fz)       |
|----------------------------|-----------------|---------------------|
| Excavator Pre-Start        | `pre_start`     | `plant_pre_start`   |
| Trailer Pre-Start          | `pre_start`     | `plant_pre_start`   |
| Drain Cleaning SSRA        | `hazard`        | `risk_assessment`   |
| Excavation Permit          | `permit`        | `permit` (pinned)   |

## Rationale
`resolve_target_category(template_doc, name)` prefers a
`form_templates.category` field when the template has a real DB row,
but for legacy freetext names that come in via the Simpro ZIP importer
and the `list_forms` roster (no `category` column) it falls back to
name-based keyword matching. Order matters — earlier tuple entries
win — and the four legacy names above were previously being caught
by more generic rules further down (`pre-start`, `ssra`, `permit`).
The new rules sit at the top of the tuple so they route accurately.

The .132eb SSRA form_routing_rules seeder (`db.form_routing_rules`)
already handles known SSRA template IDs at the write path. This ship
handles the parallel legacy path where no template ID exists — the
re-extraction/misclassification scripts consume the keyword matcher
directly.

## Files touched
- `backend/bulk_import_template_inference.py`
  - `_CATEGORY_KEYWORDS` gains a 6-entry legacy block at the top of
    the tuple (Excavator/Trailer × pre-start + pre start, plus
    Drain Cleaning SSRA, plus Excavation Permit).
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fz`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` →
  `paneltec-v160.3.9.58.13.132fz`.

## Pytest (`tests/test_v58_13_132fz_legacy_matcher_additions.py`)
8 checks — all green:
```
tests/test_v58_13_132fz_legacy_matcher_additions.py::test_new_rules_sit_at_top_of_tuple                     PASSED
tests/test_v58_13_132fz_legacy_matcher_additions.py::test_excavator_pre_start_routes_to_plant_pre_start     PASSED
tests/test_v58_13_132fz_legacy_matcher_additions.py::test_trailer_pre_start_routes_to_plant_pre_start       PASSED
tests/test_v58_13_132fz_legacy_matcher_additions.py::test_drain_cleaning_ssra_routes_to_risk_assessment     PASSED
tests/test_v58_13_132fz_legacy_matcher_additions.py::test_excavation_permit_routes_to_permit                PASSED
tests/test_v58_13_132fz_legacy_matcher_additions.py::test_existing_rules_unchanged                          PASSED
tests/test_v58_13_132fz_legacy_matcher_additions.py::test_resolve_target_category_prefers_template_doc      PASSED
tests/test_v58_13_132fz_legacy_matcher_additions.py::test_version_bumped_to_132fz                           PASSED

============================== 8 passed in 0.04s ===============================
```

## Direct probe (verified)
```
'Excavator Pre-Start'                   →  'plant_pre_start'
'Trailer Pre-Start'                     →  'plant_pre_start'
'Drain Cleaning SSRA'                   →  'risk_assessment'
'Excavation Permit'                     →  'permit'
'SSRA Site Walk'                        →  'hazard'     ← unchanged
'Toolbox Talk'                          →  'toolbox'    ← unchanged
'Vehicle Pre-Start'                     →  'pre_start'  ← unchanged
```

## NOT changed
- No frontend surface change (backend keyword table only) — no
  Playwright script needed. Pytest is authoritative.
- Existing `form_routing_rules` seeds (`.132dz` + `.132eb`) —
  untouched. Those handle DB-known template IDs; this ship handles
  legacy freetext names lacking a `form_templates` row.
- `ALLOWED_CATEGORIES` (`forms.py:81`) — no new categories introduced;
  `plant_pre_start` was already valid (line 254 + 301 of the
  inference module).
- `/app/mobile/` — untouched. `MOBILE_BUNDLE_VERSION` unchanged.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — still
  parked for `v58.14.x`.
- `finish` / `testing_agent` / `e1_tester` — none used, per standing
  directive.

## Next
Rolling into **v58.13.132g0** — Duplicate detection tightening
(upgrade from filename-only to sha256 + file size + first 512 bytes).
