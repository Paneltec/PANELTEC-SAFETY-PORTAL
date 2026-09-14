# v58.13.132gb — Document Library search (global + per-folder + highlight) · SHIPPED

Extends the existing Document Library search to fully cover Stephen's two-part
brief: per-folder live filter (recursive against subfolders) + global search
with folder-grouped results and click-to-highlight deep linking.

## Motivation

Stephen: *"Two-part search — per-folder live filter, global search grouped
by folder, clicking a result navigates + auto-scrolls + 2 s amber highlight.
Match on filename + AI tags + uploader name. Recursive."*

Pre-`.132gb`: `GET /document-library/search` matched filename + ai_tags only,
returned a flat list with `folder` context. The frontend Smart Search was a
single flat list with basic "Open →" links that dropped the user into the
folder page with no way to spot the file that matched.

Post-`.132gb`:
- Backend endpoint accepts optional `folder_id` + `recursive=true` scope.
- Match set widened to include `uploaded_by_name` (case-insensitive).
- Every result carries a `folder_path` breadcrumb + `match_field` marker.
- Frontend global Smart Search groups results by folder, each row has a
  match-field pill (filename / tags / uploader), and clicking navigates to
  `/document-library/<folder>?highlight=<file_id>`.
- Folder detail page has a new debounced search box (recursive against
  subfolders) that filters the file table live and shows a
  "in <subfolder path>" hint on rows that don't belong to the current folder.
- `?highlight=<file_id>` triggers a `scrollIntoView` + a 2-second amber
  pulse animation (`.g132gb-highlight-row` in `index.css`) on the target
  row.

## Files touched

### Backend
- `backend/document_library.py`
    - `/search` endpoint refactored: new `folder_id` + `recursive` query
      params (default `recursive=True`); adds `uploaded_by_name` to the
      `$or` match; returns `folder_path` (BFS breadcrumb, depth-guarded)
      + `match_field` (`filename` | `tags` | `uploader`) + `file_id` per
      hit; limit bumped 40 → 60.
    - Folder-scope path resolves descendants via BFS with a 20-level
      guard so a pathological cycle can't hang the query.

### Frontend
- `frontend/src/pages/DocumentLibrary.jsx`
    - Global Smart Search: groups results by folder
      (`groupedSearchResults` memo); each row shows a match-field pill
      + folder breadcrumb; deep link `?highlight=<file_id>` appended.
    - Folder detail page: new `folder-search-input` + `folder-search-clear`
      + `folder-search-busy` in the header; debounced (220 ms) search
      effect hits `/search` with `folder_id + recursive:true`.
    - When search is active, the file table renders a single "SEARCH"
      group with rows from any folder in the recursive scope; cross-folder
      rows carry a `file-subfolder-path-*` hint under the filename.
    - Highlight effect: `useSearchParams` reads `highlight`, `scrollIntoView`
      + 2 s `.g132gb-highlight-row` class on the matching `<tr>`.
    - Empty-state split: search-active + zero-hits shows the search
      empty state instead of the "folder is empty" copy.
- `frontend/src/index.css`
    - **NEW** `@keyframes g132gb-highlight-fade-kf` + `tr.g132gb-highlight-row`
      rule — 2-second amber pulse (`#fde68a` → `#fef3c7` → transparent) with
      a matching left inset shadow so it reads as a "found this" pulse
      rather than a hover.

### Version files (3-file bump)
- `frontend/src/lib/version.js#RUNNING_VERSION` →
  `paneltec-v160.3.9.58.13.132gb`
- `frontend/src/lib/version.js#EXPECTED_CACHE_VERSION` → same
- `frontend/public/service-worker.js#CACHE_VERSION` → same

### Tests
- **NEW** `backend/tests/test_v58_13_132gb_document_library_search.py`
  (12 tests):
    - Source pins: backend signature (`folder_id`, `recursive`),
      `uploaded_by_name` in `$or`, `folder_path` + `match_field` in the
      response, BFS descent with depth guard. Frontend per-folder search
      input/clear, global search groups, deep-link query, match-field pill,
      highlight keyframes, highlight effect wiring.
    - Behavioural: case-insensitive filename match; uploader-name match
      (skipped if admin has no `full_name`); folder-scoped recursive vs
      non-recursive descent; non-existent needle returns empty; version
      lockstep.
- **NEW** `scripts/verify_132gb.py` — Playwright headed script:
    - API smoke for recursive vs non-recursive scope.
    - Global Smart Search on `/document-library`: submits query,
      confirms grouped container + match-field pill per row + correct
      hit set.
    - Deep-link click → folder page opens with `?highlight=…`,
      target row scrolls into view, amber pulse observable (screenshot
      captured for evidence).
    - Per-folder search: types the needle, confirms subfolder file
      surfaces with the `file-subfolder-path-*` hint, then clears the
      search and confirms the subfolder row disappears.

## Test evidence

### Pytest

```
$ cd backend && python -m pytest tests/test_v58_13_132gb_document_library_search.py -q
12 passed in 5.44s
```

### Playwright verify

```
$ python scripts/verify_132gb.py
seeded parent=3112f3f5-49c4-43c1-9328-2b216689353e child=485d38c8ebe74c13b45dfc85fd1834a8

=== v58.13.132gb Document Library search verification ===
failures 0
STATUS: PASS
```

Screenshots pushed to `memory/`:
- `v58_13_132gb_01_global_search.png` — grouped search results panel.
- `v58_13_132gb_02_highlight_pulse.png` — target row after deep-link
  scroll (amber pulse frame).
- `v58_13_132gb_03_per_folder_search.png` — per-folder search hits
  including a subfolder file via recursive descent.

### curl smoke

```
$ TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"stephen@paneltec.com.au","password":"…"}' | jq -r .access_token)

$ curl -s "$BASE/api/document-library/search?q=asbestos" \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.results[0] | {file_id, filename, folder_path, match_field}'
{
  "file_id": "…",
  "filename": "asbestos-report-v3.pdf",
  "folder_path": "Asbestos",
  "match_field": "filename"
}

$ curl -s "$BASE/api/document-library/search?q=stephen&folder_id=<parent>&recursive=true" \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.count'
7

$ curl -s "$BASE/api/document-library/search?q=stephen&folder_id=<parent>&recursive=false" \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.count'
3
```

## Standing rules honoured

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- `/app/mobile/` untouched.
- CRA — not Vite.
- 3-web-file version bump.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- No wrong-PIN branches issued for Stephen.
- `ephemeral-upload-storage` — 20 warnings still parked for `v58.14.x`.

## Open items after `.132gb`

- **`ephemeral-upload-storage` migration** — 20 warnings across
  `document_library.py`, `contractors.py`, `forms.py`, `swms_phase45.py`,
  and friends. Parked for `v58.14.x` per Stephen's standing directive.
- **`playwright-test-admin@paneltec.internal`** — still un-seeded.
  Verify scripts skip wrong-PIN branches for Stephen; source pins in
  `.132g6`, `.132g9`, `.132ga` cover the negative paths.
- **SSRA business-date backlog** — untouched this cycle.
- **Mobile parity** — untouched, `/app/mobile/` is out of scope for this
  session.
