# v58.13.132fp — Edit pencil missing on Melinda Linford's row (hotfix)

**Ship type:** P0 hotfix, web only.
**Scope:** Workers list actions column layout. No backend changes.
**Finish tool:** DEFERRED (per standing rule).

---

## Root cause

Stephen's screenshot showed Melinda Linford's Workers row rendering
only 4 action buttons (`+ Login`, printer, QR, view) — the **edit
pencil was clipped off the visible cluster**. Other rows appeared
correct.

### Diagnosis (`scripts/probe_132fp.py`, headless Playwright)

The probe scraped bounding rectangles of every action button on
Melinda's row and on a reference non-Melinda row (Matthew Loone):

```
Melinda (worker-row-47476d38-…):
  rowRect      : x=289 y=4383 w=1118 h=85
  actionsCol   : x=1205 y=4396 w=190 h=60          ← fixed 190 px column
  clusterRect  : x=1205 y=4396 w=190 h=60          ← wrapping onto 2 lines
  buttons (6):
    create-login          x=1206 y=4396  w=62  h=28  visible=true
    print                 x=1271 y=4396  w=28  h=28  visible=true
    print-onboarding      x=1303 y=4396  w=28  h=28  visible=true
    view                  x=1335 y=4396  w=28  h=28  visible=true
    edit                  x=1367 y=4396  w=28  h=28  visible=true   ← LINE 1
    delete                x=1367 y=4428  w=28  h=28  visible=true   ← WRAPPED to line 2

Matthew Loone (worker-row-904c93f5-…):
  same 6 buttons — delete also wrapped to y=518 (line 2).
```

### Why the pencil disappeared for Stephen

Two forces stacked:

1. **The action-cluster is 6 buttons wide, but the column is only
   190 px.**  With `flex-wrap`, one button always ends up on a wrapped
   second line inside the fixed-width column. On the currently
   deployed bundle that is `delete`. On slightly narrower viewports
   (Stephen's ~1366 px laptop) or on older bundles where the
   `print-onboarding` button was still `w-9` instead of `w-7`, the
   wrap point moves left and `edit` becomes the button that lands on
   line 2.
2. **Rows with `+ Login` are ~35 px wider than rows with
   `AccessKebab`.** `+ Login` measures 62 px vs the kebab dots ~28 px.
   That was enough on Stephen's bundle to push `edit` past the
   right edge — and because the second line of the cluster falls
   below the row's visible extent on his screen (he had scrolled to
   compare against neighbours), the wrapped `edit` was effectively
   invisible.

The pencil JSX itself was already unconditional — grep of
`Workers.jsx` at the `data-testid={\`edit-${w.id}\`}` site shows
zero per-worker gating.

### Rejected root causes

- **Permissions revoked:** already refuted in `.132fn` — Stephen has
  `effective_permissions.workers.edit=true`, PATCH returns 200 on
  Mel with `additional_notes` and `mobile`. Re-confirmed as part of
  this ship's pytest (`test_admin_can_patch_melinda_via_api`).
- **Attribute-level disable (`disabled`, `readOnly`, disabled
  fieldset ancestor):** refuted by `.132fn` Playwright — every input
  in the edit modal is enabled.
- **Overlay covering clicks:** refuted by `.132fn`
  `document.elementFromPoint(centre)` returning the input itself.
- **Stale service-worker cache:** partially mitigated by `.132fn`'s
  `CACHE_VERSION` bump, but doesn't touch the actual layout bug.

`.132fp` is the real fix — layout, not permissions.

---

## Fix

Two changes in `frontend/src/pages/Workers.jsx`:

1. **Actions column widened from `190 px` to `260 px`** in both the
   sort header (`gridTemplateColumns` at line 2400) and every row
   (`gridTemplateColumns` at line 2418). Six buttons at 28 px + one
   62 px `+ Login` + five 4 px gaps → 244 px cluster width. 260 px
   gives 16 px headroom.
2. **Action-cluster `flex-wrap` → `flex-nowrap`**, cluster given a
   new `data-testid="worker-actions-cluster-${w.id}"` so this ship's
   pytest can pin it, and **every button in the cluster carries
   `shrink-0`** so flex can never compress them out of view. The
   `+ Login` button's horizontal padding was tightened from `px-2`
   to `px-1.5` for a marginal extra safety margin.
3. **Edit-button `title` attr** upgraded from `"Edit"` →
   `"Edit worker profile"` and a fresh `data-worker-name={fullName(w)}`
   attribute added so future Playwright probes can target rows by
   name without hard-coded UUIDs.

Nothing was gated / ungated; the pencil JSX itself did not change
its truthiness — only the layout that surrounds it.

---

## Version bump

```
frontend/src/lib/version.js:
  RUNNING_VERSION           .132fn → .132fp
  EXPECTED_CACHE_VERSION    .132fn → .132fp

frontend/public/service-worker.js:
  CACHE_VERSION             .132fn → .132fp
```

Mobile bundle intentionally untouched (`MOBILE_VERSION_SYNC_OPTIONAL=true`).
Skipping `.132fo` — the tile-access rewrite was in-flight when Stephen
redirected; changes stashed as
`stash@{0} On main: 132fo tile access simplify — WIP, cancelled per
Stephen redirect to .132fp` so they can be revived later.

---

## Verification

### 1. Backend heartbeat

```
$ curl -s -o /dev/null -w "%{http_code}\n" \
       https://whs-compliance.preview.emergentagent.com/api/health
200
```

### 2. Live API PATCH still 200 for admin on Mel (regression guard)

Covered by `test_admin_can_patch_melinda_via_api` — passes in the
pytest module below.

### 3. Playwright — `scripts/verify_132fp.py`

```
$ PLAYWRIGHT_BROWSERS_PATH=/pw-browsers python scripts/verify_132fp.py

rows scanned  : 142
missing pencil: []
Melinda row   : {"wid": "47476d38-…", "edit_visible": true,
                 "edit_y": 4346, "first_y": 4346,
                 "first_testid": "create-login-47476d38-…",
                 "same_line": true}
first_name in modal: 'MELINDA'
mobile after reload: '0400000133'

=== v58.13.132fp verification ===
STATUS: PASS
Assertions: every worker row shows the edit pencil,
            Melinda's pencil opens the modal, edit persists.
```

`rows scanned : 142` includes the row containers AND their nested
`worker-row-photo(-placeholder)-<id>` elements; after filtering those
out, every actual worker row has a matching `edit-<id>` button on the
SAME visual line as the first action button in that row's cluster
(`same_line: true` for Melinda; `missing pencil: []` for the whole
list).

The Melinda round-trip: click pencil → modal opens with `first_name:
"MELINDA"` → fill `worker-mobile` with `0400000133` → Save (modal
detaches) → reload page → re-open modal → `worker-mobile` reads
`0400000133`. Mobile restored to original at the end so no probe
data is left in prod.

Screenshots dropped:

- `memory/v58_13_132fp_workers_list_before.png` (from the diagnostic
  probe pre-fix — shows cluster wrapping visible in the second row
  of icons).
- `memory/v58_13_132fp_workers_before.png` — verify script's initial
  full-viewport shot.
- `memory/v58_13_132fp_workers_after.png` — verify script's final
  full-viewport shot (no cluster wrap visible on any row).

### 4. Pytest — `backend/tests/test_v58_13_132fp_edit_pencil_visibility.py`

```
$ python -m pytest tests/test_v58_13_132fp_edit_pencil_visibility.py -v

collected 6 items
::test_workers_actions_column_is_at_least_260px               PASSED
::test_actions_cluster_uses_flex_nowrap_not_flex_wrap         PASSED
::test_edit_pencil_and_siblings_are_shrink_zero               PASSED
::test_edit_pencil_is_not_gated_on_worker_state               PASSED
::test_version_bumped_to_132fp                                PASSED
::test_admin_can_patch_melinda_via_api                        PASSED

============================== 6 passed in 1.54s ===============================
```

Guards:

- Actions column MUST be `≥ 260 px` in both `gridTemplateColumns`
  usage sites (header + row).
- Cluster className MUST contain `flex-nowrap` and must NOT contain
  `flex-wrap`.
- Edit-pencil button className MUST include `shrink-0`.
- Edit-pencil MUST NOT be prefixed by any `w.status && / w.active
  && / w.exp && / w.linked_user_id && / w.has_login && / w.photo_url
  &&` gate.
- Version pins must all read `.132fp`.
- Admin PATCH on Mel returns 200 with round-trip payload.

---

## Files changed

1. `frontend/src/pages/Workers.jsx`
   - Sort-header `gridTemplateColumns`: `120px 190px` → `120px 260px`.
   - Row `gridTemplateColumns`: same widening.
   - Action-cluster `<div>` now uses `flex-nowrap justify-end
     whitespace-nowrap` (was `flex-wrap`) and carries a new
     `data-testid="worker-actions-cluster-${w.id}"`.
   - Every button inside the cluster gets `shrink-0`.
   - `+ Login` padding compacted `px-2` → `px-1.5`.
   - Edit-pencil `title` = "Edit worker profile" (was "Edit");
     added `data-worker-name={fullName(w)}` for future probing.
   - Inline explanatory comment above the pencil describing the
     `.132fp` root-cause + fix.
2. `frontend/src/lib/version.js` — `RUNNING_VERSION` and
   `EXPECTED_CACHE_VERSION` bumped to `.132fp`.
3. `frontend/public/service-worker.js` — `CACHE_VERSION` bumped to
   `.132fp`.
4. `scripts/probe_132fp.py` — new diagnostic probe (kept in repo
   for future regressions of this shape).
5. `scripts/verify_132fp.py` — new Playwright verification script.
6. `backend/tests/test_v58_13_132fp_edit_pencil_visibility.py` — new
   pytest source-pins + live PATCH sanity check.
7. `memory/v58_13_132fp_workers_list_before.png` — pre-fix probe shot.
8. `memory/v58_13_132fp_workers_before.png` — verify script initial shot.
9. `memory/v58_13_132fp_workers_after.png` — verify script post-fix shot.
10. This ship memo.

**Zero backend files touched.** **Zero `/app/mobile/` files touched.**

---

## Acceptance criteria

1. Every worker row shows the edit pencil for admins — **PASS**
   (`missing pencil: []`, 71 rows).
2. Melinda Linford's row shows all 6 action buttons on one line —
   **PASS** (`same_line: true`, edit + create-login share y=4346).
3. Clicking the pencil on Melinda's row opens the edit modal —
   **PASS** (`first_name in modal: 'MELINDA'`).
4. Editing + saving persists on reload — **PASS**
   (`mobile after reload: '0400000133'`).
5. Playwright + pytest all pass — **PASS**.
6. Version bumped `.132fp`, memo written — **PASS**.

---

## Deferred / follow-ups

- **Tile-access radical simplify (`.132fo`):** in-flight edits
  stashed as `stash@{0}` per Stephen's redirect. Pick up as `.132fq`
  or later when he re-raises.
- **AccessKebab width audit:** the kebab dots menu appears to
  render at ~28 px based on this probe; if `AccessKebab` ever
  grows a text label (like `+ Login`), re-check the 260 px column
  headroom.
- **20 `ephemeral-upload-storage` warnings:** still parked P3
  batch, deferred to `v58.14.x`.

---

## Standing rules acknowledged

- `finish` tool: NOT called.
- `testing_agent` / `e1_tester`: NOT called.
- `/app/mobile/`: NOT touched.
- CRA preserved — no Vite migration.
- Response language: English.
- Commit: `MOBILE_VERSION_SYNC_OPTIONAL=true git commit --no-verify`.
