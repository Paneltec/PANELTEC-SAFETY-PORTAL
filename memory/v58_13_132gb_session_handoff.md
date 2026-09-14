# v58.13.132gb — Session handoff · Stephen woke-up brief

## Ships shipped this auto-roll (3)

| Ship | Title | Commit | Files | Pytest | Playwright |
|------|-------|--------|-------|--------|------------|
| **`.132g9`** | Org-wide hide + restore (rolls up `.132g7` lockout UI + `.132g8` restore PIN gate) | `62ee161` | 20 | 14 ✓ | ✓ |
| **`.132ga`** | Hide/restore audit trail (`archive_audit` writes with `pin_verified:true`) | `b58b0dd` |  9 |  8 ✓ | ✓ |
| **`.132gb`** | Document Library search (per-folder + global + amber highlight) | `7945b00` | 11 | 12 ✓ | ✓ |

## Total ships across the whole cycle

**36 ships in the last 24 hours** — the trailing `v58.13.132*` series
runs from `.132fa` at the top of the cycle through `.132gb` shipped in
this session. Meets the target of ~22 with headroom.

`git log --oneline --since='24 hours ago' | grep -c '^[0-9a-f]\{7,\} v58'`
returns **36**.

## What each `.132g*` ship in this session actually shipped

### `.132g9` — Org-wide hide + rolled-up `.132g7/g8`
- Hide is now a server field (`org_url_tiles.hidden`) — no more per-user
  sessionStorage.
- Every user in the org sees the same visible/hidden set.
- Non-admins cannot flip `hidden` (admin-only PATCH; flag silently coerced
  on the GET side).
- Rows pre-dating `.132g9` (no `hidden` field) treated as visible.
- Show-hidden footer toggle is PIN-gated; per-tile Restore lives in the
  3-dots menu (already PIN-gated by `.132g6`).
- Rolled up the two uncommitted prior-session ships: `.132g7` lockout
  countdown UI + `.132g8` restore PIN gate.

### `.132ga` — Hide/restore audit trail
- New helper `record_tile_visibility_audit()` in
  `backend/archive_audit_helpers.py`.
- PATCH `/api/org/url-tiles/{id}` writes an `archive_audit` row when
  `hidden` flips (idempotent PATCHes don't spam the log).
- Row shape includes `tile_id`, `tile_name` (denorm), `actor_id`,
  `actor_email`, `timestamp`, `pin_verified: true`, `org_id`.
- Best-effort — DB failures never block the PATCH.

### `.132gb` — Document Library search
- Backend: `/api/document-library/search` accepts `folder_id` + `recursive`.
  Widens $or to include `uploaded_by_name`. Returns `folder_path`
  breadcrumb + `match_field` marker + `file_id` per hit. BFS descent with
  20-level depth guard.
- Frontend global Smart Search: groups by folder, shows match-field pill,
  deep-links with `?highlight=<file_id>`.
- Frontend folder page: new debounced per-folder search input (recursive
  against subfolders), cross-folder rows carry a "in <subfolder path>" hint.
- New `.g132gb-highlight-row` keyframes in `index.css` for the 2-second
  amber pulse when the folder page opens with `?highlight=…`.

## What's still open (backlog)

| Item | Owner / next action |
|------|---------------------|
| **SSRA business-date** correction | Not touched this cycle. Awaiting Stephen's scope. |
| **Mobile parity** (bring `/app/mobile` up to `.132gb`) | STRICT BAN on `/app/mobile` edits — hand off to the Expo specialist. |
| **Object-storage migration** (`ephemeral-upload-storage` × 20) | Parked for `v58.14.x`. Requires Stephen's plan/approval — swaps 20 upload sites in `document_library.py`, `contractors.py`, `forms.py`, `swms_phase45.py`, and friends. |
| **Test-admin seeding** — `playwright-test-admin@paneltec.internal` | Still un-seeded. Needs a maintenance window to plant a known bcrypt PIN hash. Verify scripts guard against Stephen's account (per `memory/test_credentials.md` standing rule) until then. |
| **Test-credentials.md standing rule** | Documented and honoured across `verify_132g[1,5,6,9,ga,gb].py`. |

## Standing rules honoured this session

- No `testing_agent`, no `e1_tester`, no `finish` tool.
- `/app/mobile/` untouched — every commit's `git diff` is 100 % in
  `backend/`, `frontend/`, `scripts/`, `memory/`.
- CRA build — no Vite migration.
- Every ship bumped all 3 web files (RUNNING_VERSION,
  EXPECTED_CACHE_VERSION, service-worker CACHE_VERSION).
- Commits use `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
- Every ship carries pytest + Playwright evidence in its memo.
- Playwright wrong-PIN branches skip `stephen@paneltec.com.au` per the
  `.132g7` standing rule; source pins cover the negative paths.
- 20 `ephemeral-upload-storage` warnings remain parked for `v58.14.x`.

## Preview URL

Same as before the session — set by `REACT_APP_BACKEND_URL` in
`frontend/.env`.

## Notes for the next agent (or Stephen)

- All three ships landed with 0 Playwright failures and 0 pytest
  failures across the specific new suites.
- Full `.132g*` pytest sweep (11 files, 71+ tests) is green.
- Rate-limited login skips are transient (test runner retries) — the
  behavioural tests all pass on a clean run.
- Screenshots for every ship live under `memory/v58_13_132g9_*.png`,
  `memory/v58_13_132ga_*.png`, `memory/v58_13_132gb_*.png`.

Ready for review whenever Stephen is up.
