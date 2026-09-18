# v58.13.132hy — Import Legacy PDF matcher for incident reports · SHIPPED (finish deferred)

**Ship phase:** `.132hy`
**Scope:** P1 — add filename-first regex matchers for legacy Simpro incident-report PDFs.
**Testing:** Pytest (`backend/tests/test_v58_13_132hy_incident_pdf_matcher.py`) — 17/17 green.

## Discovery (grep-first)
Ran a `pymongo` grep over `doc_files` + `form_submissions` + `form_folders` to surface the actual filename shapes of incident-related PDFs in the live DB:

- `doc_files` — 18 filenames matching `incident|near.?miss|injury|first.?aid`:
  - `2025_SF-34 Incident Hazard Report V10.0.doc`
  - `2025_SF-34.1 Incident Hazard Investigation Report V10.0.doc`
  - `2025_SF-34B _Incident_Hazard_ Investigation_ICAM_Report V10.0.docx`
  - `2025_SF-25_Register_of_Injury_Form V10.0.docx`
  - `First_Aid_Cert.pdf`, `first_aid_photo.png`, etc.
- `form_templates` (live Paneltec org): `Incident Report`, `Near Miss Report`, `Test Hot Work Permit`.
- `form_submissions` — no imported incident-family PDFs yet (backfill target).

Simpro's canonical export naming (from other categories already in the DB) follows: `<Template Name> (####) - <ts>.pdf`. Applied the same posture to the new incident matchers.

## What shipped

### `backend/imports.py::_FILENAME_MATCHERS` — 6 new patterns
Ordered from most-specific to least-specific so Near-Miss never mis-routes to Incident Report on the `incident` substring:

```
(r"near[\s_-]*miss(?:[\s_-]*report)?",         "Near Miss Report"),
(r"icam(?:[\s_-]*report)?",                    "Incident Report"),
(r"incident[\s_-]*(?:hazard[\s_-]*)?investigation", "Incident Report"),
(r"incident[\s_-]*(?:hazard[\s_-]*)?report",   "Incident Report"),
(r"injury[\s_-]*(?:report|register)",          "Incident Report"),
(r"register[\s_-]*of[\s_-]*injury",            "Incident Report"),
(r"first[\s_-]*aid[\s_-]*(?:injury|report)",   "Incident Report"),
```

Covers the Simpro/SF-34 family AND the reverse-order phrase "Register of Injury".

### `backend/imports.py::_SEED_TARGETS` — 2 new targets
- **Incident Report** — cloned from `Incident Report Form` (or, via new category fallback, any `category=incident` template already in the org).
- **Near Miss Report** — cloned from `Incident Report Form`, category override `near_miss`.

### `_seed_fallback_by_category` — new helper
When the exact `clone_from` name is missing in an org, look for any template whose `category` matches the seed's category override. Returns the shortest-named match (name-alphabetical tiebreaker to keep the choice deterministic). Missing → None (row skipped, no exception — same posture as before).

## Live verification
- Seed fired successfully in `test_database` org `9a6e2c3d…`: both `Incident Report` and `Near Miss Report` now carry `source: seed_v58_13_132hn` (existing seed marker reused). Live Paneltec org `3116f250…` already had all three templates so seed was a no-op there.
- Backend hot-reloaded without errors.

## Version pin
- `RUNNING_VERSION`  → `paneltec-v160.3.9.58.13.132hy`
- `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132hy`
- `CACHE_VERSION` (service-worker.js) → `paneltec-v160.3.9.58.13.132hy`
- MOBILE_BUNDLE_VERSION unchanged.

## Pytest coverage (17 checks)
- `test_incident_filename_matchers_present` — all 6 new patterns present.
- `test_near_miss_matcher_ordered_before_incident` — index-order guard.
- `test_seed_targets_include_incident_family` — seed targets + fallback resolver + wire-up all pinned.
- `test_version_pin_v132hy` — three-string lockstep.
- `test_match_by_filename_routes_correctly` (12 param cases) — every new pattern PLUS pre-existing patterns (Trailer Pre-start) verified end-to-end; non-matching filenames return None.
- `test_seed_fallback_picks_shortest_incident_category_template` — behavioural test: seeds 2 incident templates in a scratch org, `_seed_fallback_by_category` picks the shortest-named (name-alphabetical tiebreaker), original state restored on teardown.

## Superseded prior contracts
- `test_v58_13_132hn_import_matchers.py::test_version_bumped_to_132hn` → renamed to `test_version_bumped_to_132hn_or_later` with forward-safe regex.

## Not in this ship
- Bulk backfill of existing pre-.132hy legacy incident PDFs from `doc_files`. The matchers only fire on inbound uploads; a separate `.132hy-b` migration would enumerate `doc_files` matching the new patterns and drive them through the `_match_by_filename` → `import_pdf` path. Left for a future ship on user request.
- No frontend changes (routing/UI unchanged — incident PDFs still land on `/app/incidents` via `CATEGORY_ROUTE`).
- Field-level extraction for incident templates uses whatever `fields` the cloned source template carries; template-editor tuning left for `.132ia` (Incidents overhaul).

## Ban compliance
- No `testing_agent` / `e1_tester` / `finish` invocations.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Disk pre-check: 91% steady.

## Next action items
- Ship `.132hz` — New SSRA section under Capture (P1).
- Ship `.132ia` — Incidents module overhaul + Hazard Reports merge (P0).
- Optional follow-up `.132hy-b`: bulk migration of pre-.132hy legacy incident PDFs in `doc_files`.
