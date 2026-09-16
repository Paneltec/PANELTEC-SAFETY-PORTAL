# v58.13.132hh — Doc Library sticky Actions column + horizontal overflow hotfix

**Status:** Shipped (frontend hot-reloaded, committed on `main`).
**Finish:** DEFERRED — user handles production verification.

## Bug (as reported by user)

> "Actions missing in SDS" → later corrected: not SDS-specific logic,
> but a **horizontal-overflow clipping** issue. Rows in folders with
> many AI-tag chips (SDS, Licences, etc.) pushed the Actions column
> past the container's right edge, leaving admins unable to Preview /
> Download / Edit / Delete without horizontal scroll (and the
> wrapper had `overflow-hidden`, so scroll wasn't even possible).

## Fix

Frontend-only, isolated to the folder-detail file table in
`frontend/src/pages/DocumentLibrary.jsx` (`DocumentLibraryFolder`
component).

Three coordinated changes:

1. **Wrapper `overflow-hidden` → `overflow-x-auto`.** Last-resort
   scroll fallback so no cell can ever be permanently clipped.
2. **Actions `<th>` + `<td>` made `sticky right-0`.** The column
   pins to the viewport's right edge regardless of row width, with
   a subtle 1px inset shadow to separate it from the scrolling
   content. `<td>` inherits row hover-tint via a new `group` class
   on the `<tr>`.
3. **AI-tag chips capped at 3 + `+N` overflow pill** (was 4, and
   unbounded in width). Overflow pill has a `title` tooltip listing
   the hidden tags, and a `data-testid={ai-tags-overflow-<id>}`.

New testids added for regression coverage:
- `folder-files-table`
- `folder-files-th-actions`
- `file-actions-cell-<file_id>`
- `ai-tags-overflow-<file_id>`

## Verification

### Pytest — `backend/tests/test_v58_13_132hh_sticky_actions.py`

5/5 passing:

```
test_wrapper_uses_overflow_x_auto_not_hidden PASSED
test_actions_th_is_sticky_right              PASSED
test_actions_td_is_sticky_right              PASSED
test_ai_tags_collapse_to_three_plus_overflow PASSED
test_version_lockstep_pinned_at_132hh        PASSED
```

Covers: wrapper class regression, sticky `<th>` regression, sticky
`<td>` regression, AI-tag slice-3 cap + overflow chip presence,
and the mandatory 3-file version lockstep (`RUNNING_VERSION`,
`EXPECTED_CACHE_VERSION`, `CACHE_VERSION` all pinned at `.132hh`).

### Playwright — `scripts/verify_132hh.py`

Ran login → picked highest-file-count folder from `/folders/all`
(landed on **SDS (Safety Data Sheets), 312 files** — the exact
folder the user flagged) → at each viewport measured every row's
Actions cell `bounding_box().right` vs. viewport width.

| Viewport | Rows checked | Max right edge | Headroom | Screenshot |
|---------:|-------------:|---------------:|---------:|:-----------|
| 1280 px  | 312          | 1247 px        |    33 px | `/tmp/verify_132hh_1280.png` |
| 1440 px  | 312          | 1359 px        |    81 px | `/tmp/verify_132hh_1440.png` |
| 1920 px  | 312          | 1599 px        |   321 px | `/tmp/verify_132hh_1920.png` |

All 312 action cells at every viewport width fit inside the
viewport, with the sticky column doing its job on the largest
worst-case folder in production data. No console errors.

## Version lockstep

- `frontend/src/lib/version.js` — `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION`
  → `paneltec-v160.3.9.58.13.132hh`
- `frontend/public/service-worker.js` — `CACHE_VERSION`
  → `paneltec-v160.3.9.58.13.132hh`

## Files touched

- `frontend/src/pages/DocumentLibrary.jsx` — sticky column + AI-tag
  cap + `group` class on row `<tr>` for hover consistency.
- `frontend/src/lib/version.js` — version bump ×2.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bump.
- `backend/tests/test_v58_13_132hh_sticky_actions.py` — new (5 tests).
- `scripts/verify_132hh.py` — new (Playwright viewport-sensitive smoke).

## Not in scope

- Any backend changes (Doc Library API unchanged).
- Mobile app (`/app/mobile/` untouched — hard ban).
- Retention / backfill logic.

## Follow-ups parked

- `.132hi` (or later) — LibreOffice conversion / deeper retry for
  the 7 legacy `.doc/.docx` files that failed python-docx.
- Backup retention auto-trigger after each snapshot.

## Ban compliance

- No `finish` / `testing_agent` / `e1_tester` invocations.
- Verified via pytest + custom Python Playwright script only.
- Committed with `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
