# v58.13.132hn — Import PDF filename matchers + template seed

**Status:** Shipped on `main`. Additive; seed is idempotent.
**Finish:** DEFERRED — user validates in production.

Four filename patterns Stephen surfaced as "Unmatched template" in
the Capture → Import PDFs modal now match a template. Where the
target template didn't exist, `.132hn` seeds it on startup by
cloning a sibling.

Root of the ban: `_match_template` in `backend/imports.py` only
looked at the FIRST-LINE title of the PDF via `_pdf_title()`. If
the PDF header text is generic ("Site Specific Risk Assessment")
or absent, the token-overlap score bottoms out and workers hit the
422 "Could not match this PDF to a known template." error.

## Shipped

### 1. Filename-first matcher pass

`backend/imports.py` — new `_FILENAME_MATCHERS` list + helper
`_match_by_filename`. Runs BEFORE the token-overlap logic:

```python
_FILENAME_MATCHERS: list[tuple[str, str]] = [
    (r"drain[\s_-]*cleaning[\s_-]*ssra",         "Drain Cleaning SSRA"),
    (r"trailer[\s_-]*pre[\s_-]*start",           "Trailer Pre-start"),
    (r"excavator[\s_-]*pre[\s_-]*start",         "Excavator Pre-start"),
    (r"excavation[\s_-]*(?:[/_-]*\s*trench[\s_-]*)?permit",
                                                  "Excavation / Trench Permit"),
]
```

Tolerant to hyphens / underscores / spaces / camelCase / no-separator
("Trailer_Prestart"). Regex matched against the OS filename stem
(directory + extension stripped). First hit wins. If the mapped
template name doesn't exist in the org, the matcher logs a warning
and falls through to the existing token-overlap logic (safe no-op).

Function signature extended:

```python
def _match_template(pdf_title_norm, templates, filename=None) -> dict | None
```

Call site in `import_pdf` now passes `filename=filename` through.

### 2. Template seed — 3 missing rows

`seed_import_matcher_templates_on_startup` — idempotent async
helper. Walks every org that has any `form_template` row. For
each `_SEED_TARGETS` entry it:

1. Skips if a template with the target name already exists.
2. Looks up the clone-from sibling by name (case-insensitive
   exact match).
3. If sibling missing, logs and skips (fresh tenants might not
   have Viatec SSRA / Tip Truck / Plant Pre-Start yet).
4. Otherwise clones every field, stamps a new UUID, sets
   `source: "seed_v58_13_132hn"`, and inserts.

Seed targets:

| Target                | Clone from                                | Category   |
|-----------------------|-------------------------------------------|------------|
| Drain Cleaning SSRA   | Viatec Traffic Solutions SSRA             | hazard     |
| Trailer Pre-start     | Tip Truck Daily Pre-Start                 | pre_start  |
| Excavator Pre-start   | Plant Pre-Start Checklist (Heavy Equipment)| pre_start  |

("Excavation / Trench Permit" already existed in Stephen's org —
only needed the filename matcher, no seed.)

### 3. Startup wiring

`backend/server.py::on_startup` runs the seed inside a `try/except`
after the existing `seed_cert_kinds_on_startup` block. A failing
seed logs a warning and never blocks the pod from starting.

## Verification — pytest 18/18 green

`tests/test_v58_13_132hn_import_matchers.py`:

```
test_filename_matcher_list_pinned                      PASSED
test_seed_hook_registered_in_startup                   PASSED
test_filename_regex_maps_correctly [11 params]         PASSED
test_all_four_target_templates_present_live            PASSED
test_seeded_templates_carry_source_marker              PASSED
test_seed_is_idempotent_live                           PASSED
test_import_pdf_matches_by_filename_live               PASSED
test_version_bumped_to_132hn                           PASSED
```

Live tenant now shows all 4 targets present:

```
✓ Drain Cleaning SSRA     id=0aaf828d  cat=hazard    fields=53   source=seed_v58_13_132hn
✓ Trailer Pre-start       id=781c5b7b  cat=pre_start fields=21   source=seed_v58_13_132hn
✓ Excavator Pre-start     id=e766e108  cat=pre_start fields=23   source=seed_v58_13_132hn
✓ Excavation / Trench Permit  id=799ed9b5  cat=general  fields=23  source=imported
```

End-to-end live proof: uploaded a synthetic PDF named
`Excavator Pre-start smoke-<tag>.pdf` → HTTP 200 → response body
carries `template_name: "Excavator Pre-start"`. Filename win over
generic title confirmed.

## Version lockstep

- `frontend/src/lib/version.js` → `paneltec-v160.3.9.58.13.132hn`
- `frontend/public/service-worker.js` → `paneltec-v160.3.9.58.13.132hn`

## Files touched (5)

- `backend/imports.py` — `_FILENAME_MATCHERS`, `_match_by_filename`,
  `_match_template` signature, seed helper (+130 lines)
- `backend/server.py` — startup wiring (+7 lines)
- `backend/tests/test_v58_13_132hn_import_matchers.py` — 18 tests
- `frontend/src/lib/version.js` — version bump
- `frontend/public/service-worker.js` — cache-version bump

## Housekeeping (shipped in this commit)

- Deleted orphan `frontend/public/downloads/paneltec_civil_code_v160.0.1.zip`
  per user's approval (38MB reclaimed).

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invoked.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.

## Not in scope

- Extending `_FILENAME_MATCHERS` to cover the full existing template
  set — pre-starts and SSRAs already match via title tokens; only
  the four Stephen surfaced needed the belt.
- Reverse-mapping (template → suggested filename on export) — that's
  a `_pdf_title` concern, not an import matcher one.
- `.132hq` (worker company as editable list) — separate ship, spec
  extended per Q6.
- `.132hs` (auto-provision workers→users) — separate ship.
