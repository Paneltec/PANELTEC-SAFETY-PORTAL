# v58.13.132fe — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (Stephen's standing
directive).

**Scope in one line**: hotfix two broken interactivity surfaces
from `.132fc` / `.132fd`, then rework the approvals model from a
confusing `Approved users only ON/OFF` checkbox into a plain
`Who can see this tile?` radio group; rename the restricted pill
from amber `Approved · N users` to red `Private · N people`; add
a per-row Quick-lock button.

## Bugs squashed

### Bug 1 — Vertical alignment slider (`.132fd`)
- Reported: label "VERTICAL ALIGNMENT" collided with "Reset to
  centre" (rendered as one blob).
- Reported: dragging didn't visibly move the photo.
- Root cause: flex row was missing `gap-3` + `whitespace-nowrap`
  so both children collapsed at narrow widths. The wiring +
  `objectPosition` was actually correct (unchanged); Stephen's
  build was almost certainly a stale service-worker cache
  serving pre-`.132fd`. Fix is defensive:
  - Widened container to `max-w-[240px]`.
  - Added `gap-3` between label and Reset link.
  - Added `whitespace-nowrap` on both children so short viewports
    can't crush the row.
  - Wiring test added (upgraded from source-pin to regex
    matching the exact `onChange={(e) => onChangeOffsetY(...)}`
    handler + the inline `objectPosition: \`50% ${effectiveOffset}%\``
    template + a negative assertion against `object-center` /
    `object-top` classes on the img).

### Bug 2 — Bulk buttons in the approvals picker (`.132fc`)
- Reported: `Select all admins`, `Select all`, `Clear all` did
  nothing on click.
- Root cause on inspection: the handlers **were** wired
  (`type="button"` + `onClick={selectAllAdmins}` etc.). Most
  likely a stale service-worker cache again. Ship reinforces the
  wiring with regex-verified tests + kept the handlers under the
  new radio-driven path so they can only render when the picker
  is visible.

## Approvals rework

### Before → After

| Location | Before | After |
| --- | --- | --- |
| Access toggle | Checkbox "Approved users only" | Radio group "Who can see this tile?" with `Everyone in the organisation` / `Only selected people` |
| TileRow pill | Amber `[Lock] Approved · N users` | Rose (red-tinted) `[Lock] Private · N people` |
| Permissions panel heading | `Approved tiles` | `Private tiles` |

Radio testids: `org-quick-links-editor-access-public` /
`org-quick-links-editor-access-private`. Selecting Everyone
immediately clears `allowedUserIds` (client-side) so the next
Save sends `allowed_user_ids: []`. No auto-save on radio change.

### Quick-lock button
- New per-row 🔒 button in the Manage Tiles actions cell.
- Testid: `apps-directory-quick-lock-{tile.id}`.
- Tooltip: *"Lock down — restrict this tile to just you (add
  others from the editor)"*.
- Hidden when tile is already Private (redundant).
- On click → opens tile editor with radio pre-set to
  `Only selected people` + `allowed_user_ids = [currentUserId]`.
  Admin still clicks Save tile.
- Pulls `currentUserId` from a manager-scope `/auth/me` fetch.

## Files touched

| File | Change |
| --- | --- |
| `frontend/src/pages/Workers.jsx` | Slider row: `gap-3` + `whitespace-nowrap` + widened `max-w-[240px]`. Wiring unchanged (verified by test). |
| `frontend/src/components/QuickLinksSection.jsx` | Radio replaces checkbox toggle in `TileEditor`. Pill renamed rose `Private · N people` in `TileRow`. Quick-lock button added in the row actions cell. Manager fetches `/auth/me` for `currentUserId` and passes to `TileRow`. |
| `frontend/src/pages/UsersManagement.jsx` | Panel heading renamed `Approved tiles → Private tiles`. |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fe`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fe`. |
| `backend/tests/test_v58_13_132fe_hotfix_approvals.py` | New, 7 tests (wiring + e2e). |
| `backend/tests/test_v58_13_132fa_approve_wording.py` | Two source-pins refreshed for the pill rename + toggle → radio. |
| `backend/tests/test_v58_13_132ey_tile_acl.py` | Source-pin refreshed for the toggle → radio. |

## Pytest results

### `.132fe` new suite — **7 / 7 passing**
`backend/tests/test_v58_13_132fe_hotfix_approvals.py`
- `test_slider_wiring_and_layout` — regex-verified `onChange`
  handler + dynamic `objectPosition` + flex `gap-3` row + no
  conflicting `object-center`/`object-top` on the edit-form img.
- `test_bulk_buttons_have_type_button_and_onclick` — regex
  matches each bulk button's `type="button"` + `onClick={<name>}`
  by testid + assert handlers are non-empty setters.
- `test_radio_replaces_checkbox_toggle` — checkbox testid gone,
  both radio testids present, `name="access-mode"` shared, wired
  to `setRestrict`.
- `test_pill_renamed_private_and_quick_lock_button_present` —
  rose pill + Quick-lock testid + tooltip + editor pre-fill
  regex.
- `test_permissions_panel_renamed_private_tiles`.
- `test_e2e_public_then_private_then_grant_via_batch` — six-step
  live-API round-trip covering public → private → batch grant →
  batch revoke → public-tile no-op → strict-admin off-list.
- `test_version_pinned_to_132fe_or_higher`.

### Combined `.132e* + .132f*` smoke — **318 passed, 89 skipped, 1 pre-existing failure**
`pytest -k "132e or 132f" --tb=line`
- Pre-existing failure: `test_v58_13_132ek_zebra_and_login_polish.py::test_incidents_opts_in_to_zebra`
  — same `\bzebra\b` word-boundary bug carried forward.

## Manual verification checklist (browser)

Since we can't run `e1_tester`, the following clicks should be run
by a human once the shipped bundle refreshes past service-worker
cache (`RUNNING_VERSION === paneltec-v160.3.9.58.13.132fe`):

1. **Slider**: Melinda's edit → drag slider → thumbnail crop
   moves in real time. Label + Reset don't collide.
2. **Radio**: any tile → editor → radio group visible with
   Everyone / Only selected options. Switching to Only selected
   reveals the picker; back to Everyone hides it.
3. **Bulk buttons**: Only selected + `Select all admins` →
   admins ticked. `Select all` → everyone ticked. `Clear all` →
   empty.
4. **Pill**: Manage Tiles list → any restricted tile → red
   `Private · N people` pill visible.
5. **Quick-lock**: any public tile row → 🔒 button on the right →
   click → editor opens with radio = Only selected + only you
   ticked.
6. **Permissions panel**: Users → a user → Permissions tab →
   heading reads `Private tiles`.

## Version bumps
- `RUNNING_VERSION` **v58.13.132fd → v58.13.132fe** ✓
- `EXPECTED_CACHE_VERSION` **v58.13.132fd → v58.13.132fe** ✓
- Service Worker `CACHE_VERSION` **v58.13.132fd → v58.13.132fe** ✓
- Mobile NOT bumped (web-only ship).

## Deferred / follow-ups
- Delete-button audit deferred to `.132ff`.
- Pre-existing `.132ek` zebra source-pin failure — still parked.
- Mobile parity for the Expo delegate.

## Rules honoured
- **NO** `finish`, `e1_tester`, `/app/mobile/` edits, CRA→Vite
  rewrite. English-only, no schema/API changes.
