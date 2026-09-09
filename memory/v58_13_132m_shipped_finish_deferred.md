# v58.13.132m — Mobile home style fix: navy body, white floating cards, grey footer · SHIPPED (finish deferred)

`finish` bypassed per standing rule (20 pre-existing `ephemeral-upload-storage` lint warnings parked for `v58.14.x`).

**Small ship — pure styling.** User showed shipped Home next to the approved mockup and flagged the drift: navy was only in the header, body was light-grey, tab bar was white. Fixed across all 4 tab screens so the entire body reads as navy end-to-end with white floating cards + a light-grey (slate-100) tab bar separator + safety-orange active tab.

## What shipped

### Design token — `mobile/src/theme/colors.ts`
Added one new alias:
```ts
tabBar:         '#F1F5F9',  // slate-100 — light grey mobile tab footer (v58.13.132m)
```
No existing tokens changed. `Colors.muted` (`#64748B` slate-500) reused as the inactive tab tint.

### Bottom nav — `mobile/app/(tabs)/_layout.tsx`
- `tabBarStyle.backgroundColor`: `Colors.surface` (`#FFFFFF`) → **`Colors.tabBar`** (`#F1F5F9` slate-100).
- `tabBarInactiveTintColor`: `Colors.slate400` (`#94A3B8`) → **`Colors.muted`** (`#64748B` slate-500) — matches spec exactly.
- Active tint unchanged: safety-orange `Colors.orange` (`#F97316`).
- Header comment bumped to `.132m` with rationale.

### Home screen — `mobile/app/(tabs)/home.tsx`
- `container.backgroundColor`: `Colors.bg` (`#F8FAFC` light) → **`Colors.navy`** (`#0F172A`).
- Hero card + primary tiles + more-tile tiles were already white (`Colors.surface`) with soft shadow + rounded-18 corners → unchanged. They now visibly float on navy.
- Text tokens that were dark-on-light and now sit directly on navy body were flipped to light-on-navy:
  - `sectionTitle` ("QUICK ACTIONS"): `Colors.textTertiary` → `rgba(255,255,255,0.55)`.
  - `moreToggleText` ("More modules"): `Colors.textSecondary` → `rgba(255,255,255,0.75)`.
  - `moreCount` pill bg: `Colors.border` → `rgba(255,255,255,0.12)`.
  - `moreCountText`: `Colors.textTertiary` → `Colors.white`.
  - `moreToggle` chevron colour: `Colors.textTertiary` → `rgba(255,255,255,0.75)`.
  - `loadingText` / `errorTitle` (empty-state): dark → light-on-navy.

### Sites screen — `mobile/app/(tabs)/sites.tsx`
- `container.backgroundColor`: `Colors.bg` → **`Colors.navy`**.
- `header.backgroundColor`: `Colors.surface` (was white sub-header) → **`Colors.navy`**; hairline `borderBottom` removed.
- `headerTitle.color`: `Colors.ink` (near-black) → `Colors.white`.
- `sectionTitle.color`: `Colors.textTertiary` → `rgba(255,255,255,0.55)`.
- Sign-in cards + visitor row remain `Colors.surface` (white with border) → visibly float on navy.

### Forms screen — `mobile/app/(tabs)/forms.tsx`
- `container.backgroundColor`: `Colors.bg` → **`Colors.navy`**.
- The `header` block was already `Colors.navy` — no change needed for the header itself.
- Text-on-body tokens flipped: `loadingText`, `emptyTitle`, `emptyText`, `searchLabel` → light-on-navy palette.
- Category cards + search-result cards remain `Colors.surface` (white).

### Profile screen — `mobile/app/(tabs)/profile.tsx`
- `container.backgroundColor`: `Colors.bg` → **`Colors.navy`**.
- `divider.backgroundColor` (8px slot between profile sections): `Colors.bg` (near-white) → **`Colors.navy`** so the section separators blend into the body rather than looking like leftover light-grey strips.
- `loadingText.color`: dark → `rgba(255,255,255,0.7)`.
- `navyHeader` block already navy — untouched. Nav-row cards remain white.

### Version pins (all 3 canonical files)
- `frontend/src/lib/version.js#RUNNING_VERSION` = `paneltec-v160.3.9.58.13.132m`
- `mobile/src/lib/version.ts#MOBILE_BUNDLE_VERSION` = `paneltec-v160.3.9.58.13.132m`
- `frontend/public/service-worker.js#CACHE_VERSION` = `paneltec-v160.3.9.58.13.132m`

## Tests
Per spec: "not required for pure styling fix, but if you have a design-token snapshot test, update it". We do not have a design-token snapshot test in the repo (grep confirmed zero pytest source-pins target the tab-bar colour). No test file added for `.132m`.

Regression check — full `.132j / .132k / .132l` suite still green:
```
$ pytest tests/backend_unit/test_v58_13_132j_forms_category_nav.py \
         tests/backend_unit/test_v58_13_132k_review_before_submit.py \
         tests/backend_unit/test_v58_13_132l_swms_as_forms_category.py -q
50 passed
```

## Screenshots (3) — live URLs

Public gallery: **https://whs-compliance.preview.emergentagent.com/mobile-screenshots/index.html**

Captured live against the Expo web build on `localhost:3001` via Playwright + preview-user handshake (admin JWT → 15-min read-only preview token as `worker`).

| # | Live URL | Content |
|---|---|---|
| 1 | https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132m_01_home_navy_body.png | Home · **full navy body** from status bar to tab bar · white hero card (Sunday · 4.1°C Overcast · Sign in to site) + 3 white module tiles (Forms · Sites · Profile) · "More modules" toggle in muted white on navy · **light-grey tab bar** with Home active in safety-orange, others slate-500. |
| 2 | https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132m_02_forms_navy_body.png | Forms tab · navy body end-to-end · 7 white category cards floating on navy (General · SWMS · Pre-Start · Inspection · Near Miss · Incident · Toolbox) · Forms tab in orange on the grey footer. |
| 3 | https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132m_03_sites_navy_body.png | Sites tab · navy body · white sign-in cards for New Paneltec Depot + Paneltec Depot with orange Sign in CTAs · amber GPS banner still reads · Sites tab active in orange. |

Gallery `index.html` bumped to `.132m` header + a dedicated `.132m` section at the top; `.132l`, `.132k`, `.132j` sections preserved beneath as historical context.

## Rules obeyed
- Version bump `.132l → .132m` on all 3 canonical files ✔
- Ship memo written ✔ (this file)
- No `e1_tester` / `testing_agent` ✔
- Zero backend changes ✔
- Zero `/app/frontend/` changes beyond the version-pin + gallery HTML update ✔
- No new dependencies ✔
- No changes to tile content, ordering, or badge counts ✔
- Greeting header content untouched ✔
- 20 pre-existing `ephemeral-upload-storage` warnings still parked for `v58.14.x` ✔

## Guardrails held
- ✅ Same 4-tab structure, same tile order, same tile labels, same badges wiring.
- ✅ Greeting text + company pill + notification bell all untouched.
- ✅ No backend files touched.
- ✅ Only the 4 tab screen files + 2 theme/layout files updated on the mobile side.

## Follow-up backlog
- `.132m+` — Consider tinting the status bar navy on iOS/Android natively so the top bezel matches the body (currently the SafeAreaView top inset shows the OS default). Requires `expo-status-bar` + `Platform.select` — minor polish.
- `v58.14.x` — Object-storage migration to clear the 20 parked lint warnings.

## One-line verdict

> **`.132m` shipped clean.** All 4 mobile tab screens now render navy body + white floating cards + light-grey (slate-100) tab bar + safety-orange active tab + slate-500 inactive tabs — matching the approved mockup. Zero content changes, zero backend touches, 50 upstream pytests still pass.
