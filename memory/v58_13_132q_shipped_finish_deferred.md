# v58.13.132q — SHIPPED (with .132q1 blink hotfix co-cycle)

**Status**: SHIPPED · verified via 3 screenshots + 30-second stability probe.
**Version pins**: `RUNNING_VERSION` = `MOBILE_BUNDLE_VERSION` = `paneltec-v160.3.9.58.13.132q1`. `CACHE_VERSION` stays `.132o` (batching policy).

## Scope shipped

### `.132q` main
1. **SOON tile cleanup** — the legacy "More modules" collapsible on
   the mobile Home screen (which surfaced SWMS + Certifications as
   dead-end "SOON" tiles) is now filtered out client-side by the
   `HIDDEN_FROM_MORE` guard in `mobile/app/(tabs)/home.tsx`. The
   backend still ships those module rows for now; the UI silently
   drops them until they have live routes.
2. **Real OSM map + pin** — the accepted-job hero previously drew an
   orange placeholder. `.132q` initially swapped to
   `staticmap.openstreetmap.de` but that service was decommissioned
   (DNS NXDOMAIN as of 2024) and rendered as a blank peach block.
   Final impl swaps to a direct tile pull from
   `https://tile.openstreetmap.org/{z}/{x}/{y}.png` at zoom 15 with
   an Ionicons "location" pin overlaid at the exact fractional tile
   pixel matching the site coords. This is the same tile set
   `expo-maps` / Leaflet stream; a straight `expo-maps.MapView` drop-in
   is queued for a future ship.
3. **Live Preview dropdown lock (.132q1 micro-fix)** — the
   "Preview as role" `<select>` now contains exactly three options
   (Paneltec Civil · Viatec Traffic Solutions · Admin). The 27 legacy
   role rows + the "Show unassigned roles" checkbox are removed.
   Selection persists in `localStorage.paneltec_preview_scope`.

### `.132q1` blink hotfix (co-cycle)
User reported the app "blinking every second" mid-flight on `.132q`.
Root cause: `CacheBusterBanner` was firing its "Update available"
toast on every mount because it compared bundle `RUNNING_VERSION`
(`.132q1`) against SW `cache_version` (`.132o`). Under the new
`CACHE_VERSION` batching policy those two are deliberately out of
sync, so the mismatch fired every mount and the toast applied
`animate-[pulseRing_1.2s_ease-in-out_infinite]` for 5 seconds —
read as "blinking every second".

**Fix**:
- New `EXPECTED_CACHE_VERSION` const in `/app/frontend/src/lib/version.js`
  mirroring whatever `CACHE_VERSION` in `service-worker.js` currently
  reads (`.132o`).
- `CacheBusterBanner.mismatched` compare flipped from `RUNNING_VERSION`
  to `EXPECTED_CACHE_VERSION`. Both currently equal → no toast → no
  pulse → no blink.
- **Standing rule**: any commit that bumps `CACHE_VERSION` MUST bump
  `EXPECTED_CACHE_VERSION` in the same commit.
- Full diagnosis at `/app/memory/v58_13_132q_blink_diagnosis.md`.

## Files touched (5)

| File | Change |
| --- | --- |
| `/app/mobile/app/(tabs)/home.tsx` | Swap `staticmap.openstreetmap.de` → `tile.openstreetmap.org` tile-math + overlaid Ionicon pin. |
| `/app/frontend/src/lib/version.js` | Bump `RUNNING_VERSION` → `.132q1`; add `EXPECTED_CACHE_VERSION = .132o` + batching-policy note. |
| `/app/mobile/src/lib/version.ts` | Bump `MOBILE_BUNDLE_VERSION` → `.132q1`. |
| `/app/frontend/src/components/CacheBusterBanner.jsx` | `mismatched` compare uses `EXPECTED_CACHE_VERSION`. |
| `/app/frontend/public/mobile-screenshots/index.html` | New `.132q` gallery section + title/badge bump. |

## Ship evidence

### Screenshots (all 3 in `/app/frontend/public/mobile-screenshots/`)

1. **v132q_01_home_accepted_realmap.png**
   Home accepted state with a live tile.openstreetmap.org tile of
   Anzac Parade, Kingsford + orange location pin on the assigned
   coords + full-width safety-orange "Sign in to site" CTA.
   Live URL: <https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132q_01_home_accepted_realmap.png>

2. **v132q_02_home_no_job_no_more_modules.png**
   Home no_job with the "No job assigned yet today" banner + 3
   primary tiles (Forms · Sites · Profile badge 4). "More modules"
   section GONE even though the mock feed included SWMS +
   Certifications rows — proves the client-side filter.
   Live URL: <https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132q_02_home_no_job_no_more_modules.png>

3. **v132q_03_dropdown_3_options.png**
   Live Preview panel with the "Preview as role" dropdown open
   showing exactly 3 options (Paneltec Civil highlighted, Viatec
   Traffic Solutions, Admin). No 27-role list, no
   "Show unassigned roles" checkbox. Version badge bottom-left =
   `paneltec-v160.3.9.58.13.132q1`.
   Live URL: <https://whs-compliance.preview.emergentagent.com/mobile-screenshots/v132q_03_dropdown_3_options.png>

### Gallery
<https://whs-compliance.preview.emergentagent.com/mobile-screenshots/index.html>

### Stability probe (blink hotfix proof)
- `/tmp/prove_stable.py` — 30-second sample every 5s on
  `/app/settings/permission-presets` (the Live Preview iframe page):
  ```
  [t=5s]  mutations=0, iframe_reloads=0
  [t=10s] mutations=0, iframe_reloads=0
  [t=15s] mutations=0, iframe_reloads=0
  [t=20s] mutations=0, iframe_reloads=0
  [t=25s] mutations=0, iframe_reloads=0
  [t=30s] mutations=0, iframe_reloads=0
  ```

## What did NOT change

- `CACHE_VERSION` in `service-worker.js` — still `.132o` per new
  batching policy.
- Backend endpoints — no touches this ship.
- Existing production pages (Cover / Login / Dashboard / Integrations
  / Stub / AppShell / MobileModulesSection top-level) — no touches.
- CSV / integrations wiring — no touches.

## Known regressions

None.

## What's queued next

- `v58.13.131m` — SmartFill auto-sync backend rewrite using the
  correct JSON-RPC methods (`Transactions:Read`, `Tank:Read`,
  `Tank:Level`, `Asset:Read`, `Driver:Read` against
  `www.fmtdata.com`). Auto-sync OFF by default; manual trigger via
  new `POST /api/fleet/fuel/sync-smartfill`. Discovery memo to
  precede impl.
- `expo-maps.MapView` drop-in replacing the raster-tile hero.
- Real deep link for `paneltec://accept-job?assignment_id=xyz`.
- TextMagic wire-up + delivery-receipt webhook + STOP handling.
