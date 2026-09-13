# v58.13.132ee — Archive Feature Phase 3 (FE wiring + count polish)

**Ship status**: shipped. `finish` tool deferred per standing directive.

## Scope delivered

Phase 3 completes the FE archive surface across all **7 CAPTURE modules**,
plus two follow-on polish items surfaced by Stephen's first live use of
bulk archive (1000 Daily Pre-Starts):

| Module | Header "Archive…" btn | Bulk `ArchiveDialog` | `TotalCountChip` | `ShowArchivedToggle` | Per-row Archive / Restore |
|---|---|---|---|---|---|
| Incident Reports    | ✓ | ✓ | ✓ | ✓ (count) | ✓ (via CaptureCard) |
| Hazard Reports      | ✓ | ✓ | ✓ | ✓ (count) | ✓ (via CaptureCard) |
| Inspection Reports  | ✓ | ✓ | ✓ | ✓ (count) | ✓ (via CaptureCard) |
| Risk Assessments (SSRA) | ✓ | ✓ | ✓ | ✓ (count) | ✓ (via CaptureCard) |
| Daily Pre-Starts    | ✓ | ✓ | ✓ | ✓ (count) | ✓ (via CaptureCard) |
| Site Diary          | ✓ | ✓ | ✓ | ✓ (count) | ✓ (via CaptureCard, form_submission rows) |
| Site Visitors (AdminVisitors) | ✓ | ✓ | ✓ | ✓ (count) | ✓ (custom-table per-row buttons + greyed rows + `Archived` chip) |

Row-level archive actions on the six CaptureCard modules render via
the existing `onArchive` / `onUnarchive` props that CaptureCard already
carries since `.132ec`. AdminVisitors renders explicit `Archive` /
`Restore` buttons in the row Actions column because it's a bespoke
`<table>` layout, not CaptureCard.

## Bug fixes bundled into the same version

### Bug 1 — Total count didn't decrement after archive
- **Symptom**: Stephen archived 1000 Daily Pre-Starts. Total count chip
  stayed at 5000 instead of dropping to 4000.
- **Root cause**: `useArchiveActions` only mutated the local `items`
  array optimistically. Neither the total-count chip nor the
  archived-count chip re-hydrated because the FE didn't refetch after
  a successful archive (single or bulk).
- **Fix**: `useArchiveActions` now calls `refetch()` on BOTH archive
  AND unarchive success paths (previously fired only inside the catch
  block). Every list page now defines a shared `load()` callback and
  passes it as the 3rd arg to `useArchiveActions(apiPath, setItems,
  refetch)` and as `onArchived` on the bulk `ArchiveDialog`. The
  loader reads `X-Total-Count` + `X-Archived-Count` on every fetch,
  so both chips update in real time.

### Bug 2 — Show archived toggle needed a count
- **Ask**: Display `Show archived (1356)` inline on the toggle.
- **Backend**: new `X-Archived-Count` response header emitted from
  every list endpoint alongside the pre-existing `X-Total-Count`
  (crud.py + visitor_signins.py). Count runs a cheap
  `count_documents({..., archived_at: {$ne: null}})` reusing the same
  scope resolution the main list already applied. Header is added to
  `Access-Control-Expose-Headers` so CORS-safe fetches can read it.
- **Frontend**: `ShowArchivedToggle` now accepts a `count` prop and
  renders `Show archived (N)` / `Showing archived (N)`. Every page
  parses `X-Archived-Count` on fetch and threads it into the toggle.
- **Live verification** (curl trace via localhost):
  ```
  incidents         → x-archived-count: 0
  hazards           → x-archived-count: 0
  inspections       → x-archived-count: 0
  risk-assessments  → x-archived-count: 0
  pre-starts        → x-archived-count: 1356  ← Stephen's batch
  site-diary        → x-archived-count: 0
  admin/visitors    → x-archived-count: 0
  ```

## Files touched

### Backend
- `backend/crud.py` — `_list_impl` now returns `(docs, arch_count)`;
  `list_items` emits `X-Total-Count` + `X-Archived-Count` headers
  and adds both to `Access-Control-Expose-Headers`.
- `backend/visitor_signins.py` — new `POST /api/admin/visitors/archive`
  bulk-archive endpoint (dry-run + commit + audit log); list endpoint
  emits both count headers.

### Frontend
- `frontend/src/components/ShowArchivedToggle.jsx` — accepts `count`
  prop, renders `Show archived (N)` / `Showing archived (N)`.
- `frontend/src/lib/useArchiveActions.js` — refetch now fires on
  success paths for both archive and unarchive, not only on failure.
- `frontend/src/pages/Incidents.jsx` — shared `load()` callback,
  `archivedCount` state, wire to toggle.
- `frontend/src/pages/Hazards.jsx` — same pattern (was already fully
  wired since `.132ee` first pass; refactored to `load()`).
- `frontend/src/pages/Inspections.jsx` — full wiring + `ArchiveDialog`.
- `frontend/src/pages/RiskAssessments.jsx` — full wiring +
  `ArchiveDialog` (Submissions tab only).
- `frontend/src/pages/PreStarts.jsx` — full wiring; new `serverTotal`
  state (avoids the pre-existing local `totalCount = decorated.length`
  identifier clash from the mid-flight hotfix).
- `frontend/src/pages/SiteDiary.jsx` — full wiring + per-row archive.
- `frontend/src/pages/AdminVisitors.jsx` — full custom-table wiring:
  header archive button, dialog, per-row Archive / Restore buttons,
  `Archived` chip on greyed rows.
- `frontend/src/lib/version.js` + `frontend/public/service-worker.js`
  — already pinned to `.132ee` from prior mid-flight commits.

### Tests
- `backend/tests/test_v58_13_132ee_archive_phase3.py` — 70 checks:
  - Duplicate `getUser` import regression guard (7 pages).
  - Duplicate `totalCount` identifier regression guard (PreStarts).
  - Header archive button + `ArchiveDialog` mount + full import bundle
    across all 7 modules.
  - AdminVisitors per-row Archive + Restore + Archived chip.
  - `ShowArchivedToggle` accepts `count` prop AND every page passes
    `count={archivedCount}` AND reads `x-archived-count` header.
  - `useArchiveActions` called with a 3rd `refetch` arg on every page
    AND fires `refetch?.()` on both archive AND unarchive success.
  - Behavioural: every list endpoint returns `X-Total-Count` +
    `X-Archived-Count` + CORS-expose entry.
  - Behavioural: every module's `POST {apiPath}/archive` bulk-archive
    dry-run reachable.
- `backend/tests/test_v58_13_132ec_archive_feature.py` — updated
  source-pin to accept `include_archived: includeArchived` form
  produced by the new shared `load()` callback (alongside the two
  pre-existing forms).

## Live curl trace
```
$ curl -D- /api/pre-starts?limit=1
x-total-count: 1
x-archived-count: 1356
access-control-expose-headers: X-Total-Count, X-Archived-Count
```

## Not changed
- `useArchiveActions` optimistic-update path — kept for perceived
  responsiveness; the refetch just re-hydrates from server-side truth
  a few ms later.
- Existing `.132eb` `TotalCountChip` component — receives `total={...}`
  from the new `archivedCount` / `totalCount` states; component
  itself unchanged.
- `/app/mobile/` code — untouched (per standing brief).
- `finish` / `testing_agent` / `e1_tester` tools — untouched.
- 20 pre-existing `ephemeral-upload-storage` lint warnings — parked
  for v58.14.x per Stephen directive.

## Wires Crossed — Third Occurrence

**Third documented occurrence of the platform-side template injection
bug** in this project's lifetime. Recurrence log:

| # | Ship where it happened | Injected brief | Real brief |
|---|---|---|---|
| 1 | `.132dr` | (as documented in .132dr memo) | (as documented in .132dr memo) |
| 2 | `.132dy` | (as documented in .132dy memo) | Fuel pricing immutability FE close-out |
| 3 | `.132ee` (this ship) | "Paneltec Civil" Phase 1 scaffold — marketing landing + auth + dashboard, frontend-only, mocked data | Archive Phase 3 FE wiring across the remaining 6 CAPTURE modules |

**Symptom**: fork agent's problem-statement contained a completely
different application spec ("Paneltec Civil" scaffolded from scratch
in `/app/frontend/` with mocked data) despite the workspace containing
a mature production Paneltec WHS platform with 16k+ pre-starts, 1356
bulk-archived records mid-flight, and the .132ed handoff memo openly
describing this exact recurrence pattern.

**Detection path**: the fork's own handoff analysis section flagged the
recurrence explicitly ("Issue 2: Wires-crossed template bug — System
auto-injected a fake 'Phase 1 scaffold' brief overriding the user's
real `.132dy` scope … Status: RESOLVED (Ignored by agent, flagged in
memo)"). The agent asked the user to confirm which brief to execute
(`ask_human`) rather than blindly following either path. The user
responded: "Option A — no ambiguity, third recurrence of the
wires-crossed brief. Ignore the Phase 1 scaffold brief entirely."

**Impact if not caught**: had the agent executed the Phase 1 brief
literally, it would have deleted or overwritten the entire live
production frontend (`/app/frontend/src/pages/*.jsx`, ~200+ pages,
tens of thousands of lines of shipped code).

**Escalation ask** (to platform team, third time):
- Root-cause the template-injection path in the fork orchestrator.
- Add a workspace-fingerprint gate: if `/app/backend/server.py`
  exists AND has been modified in the last 90 days, block any
  problem-statement that reads like a bootstrap scaffold ("build
  from scratch", "existing scaffold", "no real backend yet",
  "mock all data") without an explicit user override.
- Consider ranking `analysis` (the handoff summary) higher than
  `problem_statement` when the two conflict, since the handoff is
  ground-truth for the workspace state.

**Standing operator directive** (unchanged from `.132dr`, `.132dy`):
Every fork agent MUST call `ask_human` before deleting or scaffolding
`/app/frontend/` if a live production surface is detected. The
`ask_human` template in this memo can be reused verbatim.

## Version state
- `frontend/src/lib/version.js` : `paneltec-v160.3.9.58.13.132ee`
- `frontend/public/service-worker.js` : `paneltec-v160.3.9.58.13.132ee`
- Mobile bundle : `.132di` (unchanged, mobile untouched)
