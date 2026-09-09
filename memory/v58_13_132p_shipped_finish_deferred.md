# v58.13.132p — 3-scope preview + Home mockup-style restyle (dynamic tile set) · SHIPPED (corrected in-place)

`finish` bypassed per standing rule. This memo replaces the earlier `.132p` draft — the tile grid was rebuilt against a **misread** of the mockup (I substituted Hazards/Vehicles/Fuel/Pre-Start/Tools/My Profile for the existing Forms/Sites/Profile set). User clarified the mockup was a STYLE reference, not a tile-set spec. In-place correction applied — version stays at `.132p`, no re-bump.

## New version-bump policy (from this ship on)
- `RUNNING_VERSION` → bump per-ship.
- `MOBILE_BUNDLE_VERSION` → bump per-ship.
- `CACHE_VERSION` → **NOT** bumped per-ship; held at `.132o`. Full rule at `/app/memory/version_bump_policy.md`.

## What actually shipped

### Part A · Preview scopes (unchanged from earlier attempt)
- `backend/mobile_preview.py`: new `SCOPE_KEYS = {"paneltec_civil", "viatec_traffic", "admin"}` + `_resolve_scope_modules(org_id, scope)` that walks the role matrix and OR-merges module allowlists for the scope's `matches` substrings (admin = every module).
- `GET /api/mobile/preview-user` accepts `?scope=…` (new, takes precedence) or `?role_id=…` (legacy, kept). JWT carries `preview_scope` + `preview_modules` claims.
- `backend/auth.py` preview shim passes `preview_scope` + `preview_modules` through to the synthetic user dict; `mobile_home.py` prefers `user.preview_modules` over the matrix lookup when present.
- `MobileModulesSection.jsx` dropdown leads with a "Company scope (recommended)" optgroup (Paneltec Civil / Viatec Traffic Solutions / Admin). 27 underlying roles still reachable via "Show unassigned roles".
- Mobile splash forwards `preview_scope` to `/preview-user?scope=`.
- Guarded the preview endpoint against FastAPI `Query(None, ...)` sentinel bleed when called directly from pytest.

### Part B · Home restyle (CORRECTED — dynamic tile set, mockup style)
- **Tile SET stays DYNAMIC** — driven by `d.modules` from `/api/mobile/home`, role-filtered by the permissions matrix. Restored the original Forms/Sites/Profile as primary + "More modules" collapsible section for anything else the role unlocks (SWMS/Certifications sit here, still marked SOON until they get live routes).
- **Style FROM the mockup** — kept the visual polish from the first attempt:
  - White iOS-17 rounded cards (~18pt corner radius) floating on navy.
  - Navy filled icon circle (~64pt), white icon fill.
  - Bold navy label centred below.
  - **Orange top-right badge pill** (`Colors.orange`, white text, min-width 24pt) — only visible when `count > 0`, hidden at 0.
- **`getTileBadge(moduleKey, module_badges)`** helper maps module keys to badge buckets:
  - `forms` → `module_badges.forms`
  - `sign_on` → `module_badges.sites`
  - `profile` → `module_badges.profile`
  - `swms` → `module_badges.swms`
  - `certifications` → `module_badges.certifications`
- **Big-map hero** kept — accepted state renders full-width 140pt map card + full-width "Sign in to site" CTA. `no_job` and `pending_accept` keep compact hero.

### Part C · module_badges (CORRECTED — module-key semantics)
`backend/mobile_home.py::_get_module_badges` rebuilt around module keys:
- `forms` → server-side pending drafts (`db.form_submissions.status = draft`).
- `sites` → active sites (`db.sites` non-archived).
- `swms` → non-superseded SWMS in org.
- `certifications` → certs expiring within 30 days.
- `profile` → sum of `certifications` + `swms` (mirrors what Profile tab surfaces).

Every count catches on missing collections and returns `null` — safe on fresh dev DBs. Exposed at `/api/mobile/home` as `"module_badges": {...}` at the top level.

## Version pins
- `RUNNING_VERSION` = `paneltec-v160.3.9.58.13.132p` ✔
- `MOBILE_BUNDLE_VERSION` = `paneltec-v160.3.9.58.13.132p` ✔
- `CACHE_VERSION` = **`paneltec-v160.3.9.58.13.132o`** (unchanged per policy) ✔

## Tests · `tests/backend_unit/test_v58_13_132p_scope_and_badges.py` — 8 / 8 pass

```
$ pytest tests/backend_unit/test_v58_13_132p_scope_and_badges.py -q
8 passed in 0.37s
```

Coverage (corrected):
- Backend behavioural — 3 scopes mint successfully; JWT carries `preview_scope` + non-empty `preview_modules` (19 for admin); unknown scope 400; missing both 400; `_get_module_badges` returns `forms/sites/profile/swms/certifications` keys.
- Frontend — 3 scope testids present; `computeExpoUrl` scope branch works.
- Mobile — **dynamic tile grid**: uses `primaryModules.map`, no `TILE_SPEC`, `home-more-toggle` restored, `getTileBadge` helper present; `bigMap` + `signInCtaFullWidth` styles kept; `HomeData.module_badges` typed with the corrected keys.
- Version pins — `RUNNING_VERSION` + `MOBILE_BUNDLE_VERSION` at `.132p`; `CACHE_VERSION` policy-checked at `.132o`.

Full isolation run across the whole cycle:
```
test_v58_13_132j_forms.py:                       7 passed
test_v58_13_132j_forms_category_nav.py:         17 passed
test_v58_13_132k_review_before_submit.py:       17 passed
test_v58_13_132l_swms_as_forms_category.py:     17 passed
test_v58_13_132n_onboarding_and_today_job.py:   11 passed
test_v58_13_132o_preview_worker_picker.py:      11 passed
test_v58_13_132p_scope_and_badges.py:            8 passed
                                             Σ  88 passed (isolation)
```

## Live smoke
```
$ curl /api/mobile/home  (admin JWT)
→ module_badges = { forms:null, sites:null, swms:8,
                    certifications:null, profile:8 }
```

## Screenshots (4) — live URLs
- https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132p_01_admin_3scope_dropdown.png — 3 scope options at top of role dropdown
- https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132p_02_home_accepted_big_map.png — big map hero + **dynamic 3-tile row** (Forms/Sites/Profile) with orange badges + "More modules 2"
- https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132p_03_home_no_job_tiles_visible.png — compact hero + same 3-tile row visible
- https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132p_04_forms_tile_tap.png — Forms tile → Forms tab (7 categories, 43 templates)

Gallery: https://whs-compliance.preview.emergentagent.com/mobile-screenshots/index.html — bumped to `.132p` with the corrected screenshot captions.

## Correction summary (what changed vs the first `.132p` attempt)
| Concern            | First attempt (WRONG)                            | Corrected                                          |
|--------------------|--------------------------------------------------|----------------------------------------------------|
| Tile set           | Hardcoded 6 tiles (Hazards/Vehicles/…)           | **Dynamic** from `d.modules` (Forms/Sites/Profile) |
| More modules       | Deleted                                          | **Restored** (SWMS/Certs SOON)                     |
| module_badges keys | hazards/vehicles/fuel/prestart/tools/profile     | **forms/sites/profile/swms/certifications**        |
| Tile style         | Correct (kept)                                   | Kept                                               |
| Big-map hero       | Correct (kept)                                   | Kept                                               |
| Preview scopes     | Correct (kept)                                   | Kept                                               |

## Rules obeyed
- Version bump policy honoured — 2 files bumped, `CACHE_VERSION` unchanged ✔
- Underlying 18/27 roles NOT deleted ✔
- Preview session still bypasses PIN (`.132o` intact) ✔
- Grey footer + orange active tab (`.132m`) preserved ✔
- `.132n` onboarding flow untouched ✔
- Zero regressions — 88/88 tests pass in isolation ✔
- No `e1_tester` / `testing_agent` ✔

## Follow-up backlog
- Wire real `expo-maps` MapView with a marker (drop-in for the orange placeholder).
- Runtime role consolidation — user asked for the 18→3 collapse to apply to real logins too. Needs its own role-migration ship.
- Bring SWMS + Certifications out of "SOON" (SWMS already has a viewer at `/profile/swms/[id]` — just need to flip `KNOWN_ROUTES` and add the SWMS home-tile route).
- Web admin drainer for `pending_sms_dispatches` (still open from `.132n`).

## One-line verdict

> **`.132p` shipped clean (corrected).** Preview dropdown collapsed to 3 company-scope options with real permission unions; Home restyled with the approved mockup's visual language (white cards, navy filled icon circles, orange top-right badges, big-map hero) while keeping the **original dynamic tile set** (Forms/Sites/Profile primary + More modules collapsible); `module_badges` on `/api/mobile/home` uses module-level keys; 8 pytests lock the spec; version-bump policy tightened.
