# v58.13.132hi — Doc Library: remove AI Tags column + drop sticky divider

**Status:** Shipped on `main`.
**Finish:** DEFERRED — user handles production verification.

## Scope (as requested)

1. Remove the AI Tags column from the folder-detail file table.
   Tags remain in the DB, remain searchable, and still power row
   grouping — they're just not rendered as a column any more.
   Remove the `+N more` chip-cap logic that shipped in `.132hh`
   since it's dead code now.
2. Drop the sticky-column divider (`shadow-[inset_1px_0_0…]`) so
   there's no visible line between EXPIRY and ACTIONS. Keep the
   Actions column `sticky right-0` so `.132hh`'s horizontal-overflow
   gain is preserved.

## Changes — `DocumentLibrary.jsx` (`DocumentLibraryFolder`)

- `<thead>`: removed the `<th>AI tags</th>` cell entirely.
- `<tbody>`: removed the AI-tag `<td>` block (chip rendering,
  `slice(0, 3)`, and the `+N` overflow chip with tooltip / testid).
- Group-header row's `colSpan={7}` → `colSpan={6}`.
- Sticky Actions `<th>`: class
  `text-right px-4 py-3 sticky right-0 bg-slate-50` — no shadow.
- Sticky Actions `<td>`: class
  `px-4 py-3 text-right sticky right-0 bg-white group-hover:bg-slate-50`
  — no shadow.
- Comment header rewritten to note the `.132hi` decisions.

Search box placeholder still reads
`"Search this folder (filename, AI tags, uploader)…"` — locked in
by regression test.

## Backend

Untouched. Backend `/document-library/folders/{folder_id}/search`
still includes `{"ai_tags": {"$regex": pattern, "$options": "i"}}`
in its `$or` clause (locked in by regression test).

## Verification

### Pytest — `backend/tests/test_v58_13_132hi_remove_ai_tags_column.py`

8/8 passing:

```
test_no_ai_tags_header_in_folder_table                PASSED
test_no_ai_tags_cell_render                           PASSED
test_group_header_colspan_updated_to_six              PASSED
test_actions_th_sticky_without_shadow                 PASSED
test_actions_td_sticky_without_shadow                 PASSED
test_search_placeholder_still_advertises_ai_tags      PASSED
test_backend_search_still_queries_ai_tags             PASSED
test_version_lockstep_pinned_at_132hi                 PASSED
```

### Playwright — `scripts/verify_132hi.py`

Landed on **SDS (Safety Data Sheets), 312 files** (same worst-case
folder from `.132hh`):

| Viewport | Cells | Max right edge | `boxShadow` | `borderLeftWidth` | Screenshot |
|---------:|------:|---------------:|:------------|:------------------|:-----------|
| 1280 px  | 312   | 1247 px        | `none`      | `0px`             | `/tmp/verify_132hi_1280.png` |
| 1440 px  | 312   | 1359 px        | `none`      | `0px`             | `/tmp/verify_132hi_1440.png` |
| 1920 px  | 312   | 1599 px        | `none`      | `0px`             | `/tmp/verify_132hi_1920.png` |

Plus one AI-tag search regression: fetched a file with `ai_tags` via
the API, typed one of its tags into the search box at 1440px, and
asserted the target `file-row-<id>` appears in the DOM. **PASS**
(`'test' -> found file-row-6b51d71b-9833-4d07-b1fe-3d3b4e1c8765`).

## Version lockstep

- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`
  → `paneltec-v160.3.9.58.13.132hi`
- `frontend/public/service-worker.js` — `CACHE_VERSION`
  → `paneltec-v160.3.9.58.13.132hi`

## Files touched

- `frontend/src/pages/DocumentLibrary.jsx` — column + chip removal;
  drop sticky shadow; `colSpan={7}` → `colSpan={6}`.
- `frontend/src/lib/version.js` — bump ×2.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bump.
- `backend/tests/test_v58_13_132hi_remove_ai_tags_column.py` — new (8).
- `scripts/verify_132hi.py` — new (viewport + shadow + tag-search).

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invoked.
- No `/app/mobile/` edits.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
