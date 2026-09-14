# v58.13.132fc — Shipped, `finish` deferred

**Status**: shipped. `finish` **NOT** invoked (Stephen's standing
directive: `finish` / `e1_tester` are banned for this program;
ship memos live in `/app/memory/` and reply-in-chat).

**Scope in one line**: tile-editor UX clarity pass — visually and
textually separate "your personal credentials" from "who can see
this tile", rework the approvals picker for small-team ergonomics,
and add preflight warnings so admins can't accidentally lock
themselves (or their team) out. **No API contract change.**

## Context — what was NOT a bug

Stephen reported *"Amanda can still access the bank"* and *"I
can't see the approved users list"*. Neither was a code bug:

- **"Amanda can still access the bank"** — the *Approved users
  only* toggle was OFF on the tile, so the tile was still public.
  Stephen had edited the Credential Vault sub-section thinking
  that gated access. Personal credentials only protect the admin's
  password autofill; they don't affect visibility.
- **"I can't see the approved users list"** — same root cause;
  the toggle being OFF hid the picker (which correctly only
  renders when Approved-users-only is ON).

This ship makes both facts impossible to miss in the UI.

## What shipped

### 1 · Credentials clarifier banner
Above the existing "Your credentials for this tile" section header
in `CredentialSubEditor`, a subdued grey banner:

> **This is your personal login for this site** — encrypted just
> for you. Nobody else on the team can see it. It does **NOT**
> control who else can access this tile — see **Approved users
> only** below.

Testid: `credential-sub-editor-clarifier`.

### 2 · Approvals clarifier banner
Directly above the *Approved users only* toggle in `TileEditor`, a
matching subdued banner:

> **Control who in your team can see and open this tile.** This
> has nothing to do with your personal credentials above.

Testid: `org-quick-links-editor-approvals-clarifier`.

### 3 · Save button disambiguation
| Button | Before | After |
| --- | --- | --- |
| Credentials save (inside vault card) | `Save credentials` | **`[Lock] Save my login only`** + tooltip *"Saves only your personal password for this tile — does not save tile settings or approvals."* |
| Main tile save (form footer) | `Save` | **`Save tile`** + tooltip *"Saves the tile settings including approved users."* |

The credentials button stays inside its own visual card, visually
detached from the tile-save button in the form footer.

### 4 · Approvals picker rework
- **Grouped by role**: two headed sections — `Admins` (violet
  chrome) and `Users` (slate chrome). Each group sorted
  alphabetically by name.
- **Bulk-action buttons** above the list:
  - `Select all admins` (violet)
  - `Select all` (neutral)
  - `Clear all` (neutral outline)
  All disabled when there's nothing to act on.
- **Conditional search input** — only rendered when the org has
  more than 20 eligible users (`sorted.length > 20`). Small teams
  don't see the search at all — it's noise.
- **Self marker** — the row for the currently-signed-in user
  carries a small emerald `YOU` tag so the admin can spot
  themselves at a glance.
- Existing testids on user rows / checkboxes preserved.
- Existing chip strip from `.132fa` untouched.

### 5 · Preflight warnings
- **Empty selection with toggle ON** — prominent amber warning
  card between the toggle and the picker: *"Warning — this tile
  will be hidden from everyone (including you). Tick at least
  yourself before saving."* Non-blocking; the admin can still
  save if they intentionally want the tile invisible temporarily.
  Testid: `org-quick-links-editor-empty-warning`.
- **Self missing but others ticked** — milder secondary hint
  under the picker list: *"Note — you haven't ticked yourself.
  This tile will be greyed out for you after saving. Tick
  yourself to see it."* Friendly, not blocking. Testid:
  `org-quick-links-editor-self-missing-hint`.
- Current user's id resolved via a one-shot
  `GET /api/auth/me` on editor mount (non-blocking; the hint
  simply won't render if the call fails).

## Files touched

| File | Change |
| --- | --- |
| `frontend/src/components/QuickLinksSection.jsx` | `CredentialSubEditor` gains the personal-credentials clarifier; save button renamed + `Lock` icon + tooltip. `TileEditor` gains the approvals clarifier above the toggle, rebuilt picker with role groups + bulk buttons + conditional search + preflight warnings + `YOU` self marker. Main save button renamed to `Save tile` with tooltip. New `currentUserId` state fetched from `/auth/me`. |
| `frontend/src/lib/version.js` | `RUNNING_VERSION` + `EXPECTED_CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fc`. |
| `frontend/public/service-worker.js` | `CACHE_VERSION` → `paneltec-v160.3.9.58.13.132fc`. |
| `backend/tests/test_v58_13_132fc_tile_editor_clarity.py` | New, 10 tests. |

**Backend** — untouched. `GET /api/org/url-tiles/eligible-users`
returns the same shape as `.132fa`; the picker rework is entirely
client-side.

## Pytest results

### `.132fc` new suite — **10 / 10 passing**
`backend/tests/test_v58_13_132fc_tile_editor_clarity.py`

- `test_credentials_clarifier_banner_present` — copy + testid.
- `test_approvals_clarifier_banner_present` — copy + testid.
- `test_save_buttons_disambiguated` — new labels + tooltips
  present; old `'Save credentials'` and bare `'Save'` gone.
- `test_picker_has_bulk_buttons` — three labels + testids.
- `test_picker_groups_users_by_role` — group testids + split
  predicates.
- `test_picker_search_hidden_below_twenty_users` — `showSearch`
  constant + conditional gate wired.
- `test_empty_selection_warning_present` — amber warning copy +
  testid.
- `test_self_missing_hint_present` — hint copy + testid + wiring
  to `/auth/me` + `currentUserId` state.
- `test_eligible_users_endpoint_shape_unchanged` — live-API
  sanity: `{id,name,email,is_admin}` on every row.
- `test_version_pinned_to_132fc_or_higher`.

### Combined `.132e* + .132f*` smoke — **309 passed, 82 skipped, 1 pre-existing failure**
`pytest -k "132e or 132f" --tb=line`
- Pre-existing failure: `test_v58_13_132ek_zebra_and_login_polish.py::test_incidents_opts_in_to_zebra`
  — same `\bzebra\b` word-boundary bug carried forward. Not
  touched by this ship.

## Version bumps
- `RUNNING_VERSION` **v58.13.132fb → v58.13.132fc** ✓
- `EXPECTED_CACHE_VERSION` **v58.13.132fb → v58.13.132fc** ✓
- Service Worker `CACHE_VERSION` **v58.13.132fb → v58.13.132fc** ✓
- Mobile bundle NOT bumped (web-only ship;
  `MOBILE_VERSION_SYNC_OPTIONAL=true --no-verify`).

## Acceptance criteria
1. Open Manage Tiles → editor shows two clearly-labelled banners
   (credentials vs approvals). ✓
2. Credentials save button reads *"Save my login only"* with lock
   icon; main form button reads *"Save tile"*. ✓
3. Approved-users-only ON + no users ticked → amber "hidden from
   everyone" warning shown. ✓
4. Approved-users-only ON + others ticked, not self → milder
   "not ticked yourself" hint. ✓
5. Picker groups by Admins / Users; three quick buttons wired;
   search hidden below 20 users. ✓
6. No behaviour changes to tile save / approvals API / greying /
   chip strip. ✓ (backend contract test verifies eligible-users
   shape unchanged).
7. New `.132fc` pytests pass; combined smoke shows no new
   regressions beyond the pre-existing `.132ek` zebra. ✓
8. Version bumped in all 3 web files; commit succeeds. ✓
9. Ship memo written; reply-in-chat (no `finish`). ✓

## Design decisions

- **Clarifier banners are subdued (slate-100 not amber)** — the
  Approved-users copy uses amber for warnings and yellow for the
  self-missing case. Making the clarifiers stand out visually
  from those actionable states keeps the "warning" colour language
  meaningful. If both were amber the eye habituates and the actual
  warnings lose weight.
- **Preflight warnings are non-blocking.** An admin creating a
  brand-new tile might intentionally save with an empty ACL to
  hide it while the team is being configured. The warning is
  prominent enough to be impossible to miss but doesn't block save.
- **`YOU` marker on the self-row** cost nothing to add and pairs
  with the self-missing hint to make "am I approved for this
  tile" a one-glance answer.
- **Conditional search at 20 users** — Paneltec Civil's real orgs
  are small crews. The search-input was noise there. Kept the
  threshold conservative in case an org grows.
- **`/auth/me` fetch is non-blocking.** If the call fails (offline,
  token stale), the self-missing hint simply doesn't render — the
  editor still works, just without the "you" ergonomics.

## Deferred / follow-ups
- **Pre-existing `.132ek` zebra source-pin failure** — standalone
  follow-up (unchanged from `.132fb`).
- **Mobile parity** — Expo delegate to mirror the new banner + copy
  wording if the mobile app grows a tile editor.

## Known outstanding (unchanged from `.132fb`)
- Phase B of Workspaces/Sites merge (`.132cb-b`).
- Medium/large PIN provisioning admin surface.
- `.132cv` / `.132dc` Expo tasks — mobile specialist.

## Rules honoured this ship
- **NO** `finish`.
- **NO** `e1_tester`.
- **NO** edits under `/app/mobile/`.
- **NO** rewrite of `/app/frontend/` to Vite — CRA production shell
  preserved.
- Commit uses `MOBILE_VERSION_SYNC_OPTIONAL=true git commit
  --no-verify`.
- English-only chat replies.
- No backend schema / API contract change.
