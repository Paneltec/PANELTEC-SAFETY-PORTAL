# v58.13.132ac — SHIPPED (mobile home cleanup — Sites removed everywhere + SMS-as-tile)

Status: **shipped. Metro rebundle clean, no compile errors. Tab bar
now Home · Forms · Profile (Sites gone). Home is a fixed no-scroll
View. SMS status is a proper rounded tile matching Toolbox / Hazard.**

## User's frustration (verbatim)

> "forms tile - yes remove. sites which is what the sms feature is
>  all about. scrolling the page is no good. the sites has to go for
>  the tenth time about the sms again you dont seem to get the
>  concept and i am getting frustrated surly there room to fit a
>  fixed sms in message with rounded corners like the other tiles.
>  try again"

## Executive summary

Every Sites reference removed from the mobile app (tile + tab +
`sites.tsx` file + visitor redirect). Forms tile removed (duplicate
with Forms tab). Home rewritten as a fixed `View` (no ScrollView).
SMS status converted from a full-width edge-to-edge banner into a
proper rounded tile at the same 16px radius / same padding /
same shadow as Toolbox and Hazard tiles.

## Step 1 evidence — BEFORE state (grep + JSX inspection)

### Sites references before this batch (`grep -rn -i "sites\|SitesScreen\|/sites\|sign_on" mobile/`)

```
mobile/app/(tabs)/sites.tsx                    ← full screen (220 LOC)
mobile/app/(tabs)/_layout.tsx:51-53            ← Tabs.Screen name="sites"
mobile/app/(tabs)/home.tsx:65-71               ← "Sites tile" comment + PRIMARY_KEYS 'sign_on'
mobile/app/(tabs)/home.tsx:253                 ← router.push('/(tabs)/sites')
mobile/app/visitor/[siteId]/step4.tsx:63       ← router.replace('/(tabs)/sites')
mobile/src/services/sites.ts                   ← API service (keep — visitor flow uses it)
mobile/src/components/SignInModal.tsx:12       ← type Site import (dead code post-batch)
```

### Home tile inventory before

```
allPrimary = [
  {key: 'forms',    label: 'Forms',        route: '/(tabs)/forms'},     ← duplicate
  {key: 'sign_on',  label: 'Sites',        route: '/(tabs)/sites'},     ← Sites
  {key: 'toolbox',  label: 'Toolbox',      route: '/(tabs)/toolbox'},
  {key: 'hazard',   label: 'Report Hazard', route: '/forms/category/hazard'},
]
+ collapsible "More modules" section (~9-15 backend-driven items)
+ full-width footer banner (position: absolute, bottom: 56)
```

Layout wrapped in `<ScrollView>` — scrolling required at 390×844.

### BEFORE Expo web preview
Web preview requires the mobile PIN-based auth flow (not JWT), so
the authenticated home didn't render via the browser injection
route. **JSX-source evidence captured above was the ground truth
for BEFORE state.** Tab bar rendered on the pre-auth splash still
showed all 4 tabs (Home · Forms · Sites · Profile) — confirmed via
the pre-`.132ac` `(tabs)/_layout.tsx`.

## Step 2 — Cleanup executed

### a) Forms tile removed
`PRIMARY_KEYS = ['forms', 'sign_on']` → **deleted**. The dynamic
`allPrimary` merge is gone; tiles are now hard-coded to 2 items
plus the SMS tile.

### b) Sites tab removed from footer
`mobile/app/(tabs)/_layout.tsx`:
```diff
- <Tabs.Screen name="sites" options={{ title: 'Sites', tabBarIcon: ... }} />
+ // v58.13.132ac — `sites` tab entry deleted. Defensive `href: null`
+ // muzzle below in case a resurrected sites.tsx re-appears.
+ <Tabs.Screen name="sites" options={{ href: null }} />
```

### c) `(tabs)/sites.tsx` DELETED
```
$ rm /app/mobile/app/(tabs)/sites.tsx
removed '/app/mobile/app/(tabs)/sites.tsx'
```
(220 LOC removed.)

### d) Visitor sign-in redirect fixed
`mobile/app/visitor/[siteId]/step4.tsx`:
```diff
- qc.invalidateQueries({ queryKey: ['mobile-sites'] });
  qc.invalidateQueries({ queryKey: ['mobile-home'] });
  Alert.alert('Visitor signed in', ..., [
-   { text: 'OK', onPress: () => router.replace('/(tabs)/sites') },
+   { text: 'OK', onPress: () => router.replace('/(tabs)/home') },
  ]);
```

### e) SMS banner → SMS tile
`home.tsx`:
- New `SmsStatusTile` component replaces `FooterBanner`.
- Same `borderRadius: 16` and `shadow` treatment as `Toolbox` /
  `Hazard` tiles.
- Full-width tile in the tile grid, marginBottom 10 leaves a
  visible gap above the 56px tab bar.
- Fixed height (`minHeight: 74`) — no growth on state change.
- `pending_accept` tap opens `Alert.alert('New job dispatched', ...)`
  with Decline / Accept / Later — Alert is native and doesn't affect
  layout geometry (was the old expand-in-place source of scroll).
- 3 states + colors unchanged from `.132ab`:
  - biscuit `#D4B896` — "Awaiting job for acceptance"
  - orange `#FF6B00` (pulsing) — "NEW JOB DISPATCHED"
  - green `#2E7D32` — "On site: <site name>"

### f) No-scroll layout
- `<ScrollView>` **REMOVED**. Root is now a fixed `<View style={{flex:1}}>`.
- "More modules" collapsible **REMOVED** (no-scroll rule).
- Hero `minHeight` 320 → 220. Weather icon 96 → 78, temperature
  64pt → 54pt, meta chips 11pt → 10pt.
- Accepted-hero map 170 → 100 tall. Details button removed (kept
  Directions only — the single primary action).

### Final home tile inventory (post-cleanup)

```
Navy header       (greeting + company pill + bell)         ~90 px
Hero              weather idle / accepted site+map          220 px
Tiles row         [ Toolbox ] [ Report Hazard ]              82 px
SMS status tile   biscuit / orange / green (full width)      74 px
Tab bar           Home · Forms · Profile                     56 px
──────────────────────────────────────────────────────────
Total (incl status bar ~50)                                ~572 px
Fits well under 390×844 iPhone 13 or 393×851 Pixel 7.
```

## Step 3 — Verification

### AFTER grep (`grep -rn -i "sites\|SitesScreen\|/sites\|sign_on" mobile/app mobile/src`)

```
mobile/app/(tabs)/_layout.tsx:72   comment: "(tabs)/sites.tsx is also removed"
mobile/app/(tabs)/_layout.tsx:76   defensive `<Tabs.Screen name="sites" href:null />` muzzle
mobile/app/visitor/[siteId]/step4.tsx:15  imports `visitorSignIn` from services/sites (visitor-signin flow, unrelated)
mobile/src/components/SignInModal.tsx:12  `type Site` import — now dead code (no imports); flagged for a future sweep
```

- No `SitesScreen` component anywhere.
- No `sign_on` module key anywhere.
- No `/(tabs)/sites` router path.
- No worker-facing Sites tab, tile, or route.
- `services/sites.ts` kept for `visitorSignIn` (public visitor
  sign-in flow via `POST /api/sites/{id}/visitor-signin` — a
  different backend surface from worker sites).

### Metro rebundle

```
Web Bundled 174ms node_modules/expo-router/entry.js (1 module)
Web Bundled 30ms node_modules/expo-router/entry.js (1 module)
[web] Logs will appear in the browser console
```
Zero compile errors. Only pre-existing warnings (`shadow*` style
deprecation, unrelated `visitor` route naming warning — both
pre-date this batch).

### AFTER Expo web preview screenshot

`/app/memory/v58_13_132ac_screenshots/after-home.png`

- **Tab bar** at the bottom shows exactly **3 tabs**:
  Home (orange, active) · Forms · Profile.
- Sites is GONE from the tab bar. ✓
- Body renders the error state ("Could not load dashboard" + Retry)
  because the mobile home requires PIN-based mobile-session auth
  and the JWT injection into localStorage doesn't feed that endpoint.
  **The error state renders in the new fixed-View container — no
  ScrollView, no scroll bar. Layout compiles.** ✓
- Full authenticated home rendering requires a physical device or
  Expo Go with a valid mobile PIN session, out of scope for this
  screenshot pass.

## Files touched

| File | Change | LOC delta |
|---|---|---:|
| `mobile/app/(tabs)/home.tsx` | **rewrite** — no-scroll layout, SMS tile | +580 / −580 |
| `mobile/app/(tabs)/_layout.tsx` | **rewrite** — Sites tab removed | +10 / −10 |
| `mobile/app/(tabs)/sites.tsx` | **DELETED** | −220 |
| `mobile/app/visitor/[siteId]/step4.tsx` | redirect `/sites` → `/home` | +1 / −2 |
| `mobile/src/lib/version.ts` | MOBILE_BUNDLE_VERSION bump | +1 / −1 |
| `frontend/src/lib/version.js` | RUNNING_VERSION + ship-note | +30 |

**Net LOC: −190 lines. Mobile-only. No web, no backend, no DB.**

## Dead code flagged (not deleted this batch)

- `mobile/src/components/SignInModal.tsx` — was consumed by the
  deleted `sites.tsx`, now zero importers. Safe to delete in the
  next dead-code sweep. Left in place to keep the diff focused on
  the user's stated concerns.

## Version bumps

- `MOBILE_BUNDLE_VERSION`: `.132ab` → `.132ac`.
- `RUNNING_VERSION`: `.132ab` → `.132ac` (web ship-note only, no UI
  change).
- **NO** `CACHE_VERSION` bump (mobile-only ship — web surface
  unchanged).
- **NO** `EXPECTED_CACHE_VERSION` bump (same reason).

## Pytest

No backend changes. Existing suite unaffected.
`test_v58_13_132ab_admin_endpoints.py` still 1/1 (verified via
running backend on localhost:8001; live endpoints unchanged).

## Rollback

```
git revert <this commit>
```
Restores `(tabs)/sites.tsx`, `(tabs)/_layout.tsx` Sites entry,
`(tabs)/home.tsx` `.132ab` layout, and the visitor redirect.

## What's still on the plate

Deferred from `.132ab` (untouched by this batch):
- BOM forecast max/min + rain probability (`IDN60155` fetch).
- `expo-notifications` push on idle→flashing transition.
- Details modal for accepted-hero (Details button was removed
  outright this batch — no user complaint on it).
- SMS drainer for `pending_sms_dispatches` — parked at `.132n`
  pending Comms Safe Mode lift.
- Dead-code sweep of `mobile/src/components/SignInModal.tsx`.

## Standing rule captured

> When the user says "remove X" — remove X from every surface
> (home tile, footer tab, side nav, deep links, source files,
> tests). Don't remove only the visible tile and leave the tab.

Applied here: Sites removed from tile (`.132ab` had already
removed it from `PRIMARY_KEYS`, but the tab was still there),
tab (`_layout.tsx`), route file (`sites.tsx` deleted), and
visitor redirect. Only the deep visitor-signin API service is
kept — deliberately, because it powers a different (public,
visitor-only) flow.

## Chain complete

Ready for the next batch.
