# v58.13.132hb — Doc Library search separator normalisation — SHIPPED

`finish` tool deliberately deferred per Stephen's standing directive.

## What shipped

The `/api/document-library/search` endpoint now treats space, underscore,
and hyphen as interchangeable in the query. Direct response to
Stephen's report that AI search for `SF_22` returned 0 results even
though `2025_SF-22_Bomb_Threat_Report V10.0.docx` clearly exists in
`IMS > 5. System Forms V10.0 - 2025`.

Not a `.132gy` regression — the recursive tree walk had always
worked. Root cause was pure separator-punctuation mismatch: filename
uses `-`, Stephen typed `_`.

## User-facing behaviour

| Query | Before `.132hb` | After `.132hb` |
|---|---|---|
| `SF_22` | 0 results | **1 result** ✓ |
| `SF-22` | 1 result | 1 result ✓ |
| `SF 22` | 0 results | **1 result** ✓ |
| `SF22`  | 0 results | **1 result** ✓ |
| `sf_22` | 0 results | **1 result** ✓ |
| `SF__22` | 0 results | **1 result** ✓ |
| `SF-99` | 0 results | 0 results (correct — no such file) |
| `unlikelyword` | 0 results | 0 results (correct) |

All verified live against Stephen's org through curl smoke.

## Files touched

- `backend/document_library.py` — new `_normalised_pattern(needle)`
  helper inside `search()`. Strips separators from the query, keeps
  the "core" meaningful chars, interleaves `[ _-]*` between them.
  So `SF22` becomes `S[ _-]*F[ _-]*2[ _-]*2`, which matches every
  punctuation variant in filename / ai_tags / uploaded_by_name.
- `backend/document_library.py` — `_match_field(doc)` gains a
  mirror `_strip_seps(s)` helper so the UI's "matched by
  filename/tags/uploader" label stays honest for the exact same
  query.
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js`
  — version bump `.132ha` → `.132hb` in lockstep.

## NOT in this ship (deferred by user direction)

- **OCR / extracted_text indexing** — out of scope. Documented
  as a bigger follow-up. Search still walks filename + ai_tags +
  uploaded_by_name only.
- Fuzzy typo tolerance (Levenshtein / trigram) — deferred until
  demand.

## Verification

- `backend/tests/test_v58_13_132hb_search_separator.py` — 13 checks,
  all green:
  · 6 positive cases (all requested variants + double-underscore + lowercase)
  · 4 negative controls (SF-99 must NOT match SF-22; unlikelyword)
  · pattern-stability check (all 4 requested variants produce the
    identical regex string — no drift)
  · source-pin test guaranteeing the reference `_normalised_pattern`
    in the test file stays byte-for-byte with the real helper
  · `_match_field` normalisation coverage (must strip separators
    from needle + all 3 haystack fields — 5 total `_strip_seps` calls)
  · endpoint scoping check (org_id + deleted_at=None guardrails
    still in place — normalisation did NOT widen cross-org search)
  · version lockstep pin
- Live curl smoke against Stephen's org confirmed all 6 SF-22
  variants now return exactly one hit: the correct file.

## Regressions considered

- Cross-org leak: negative. Query still gates on `org_id` +
  `deleted_at: None` (pytest pin).
- Broader accidental matches: `SF-99` correctly returns 0. The
  normalisation only collapses SEPARATORS — it never widens the
  meaningful character set.
- Recursive tree search (`.132gy`): unaffected. `Bomb` still
  returns the nested SF-22 file with its full folder path.
