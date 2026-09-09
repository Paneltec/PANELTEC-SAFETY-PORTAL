# v58.13.132q_blink_hotfix — Blink-every-second diagnosis

**Status**: FIXED · verified by 30-second stability probe (0 DOM mutations, 0 iframe reloads).

## User pain (verbatim)
> "the app is blinking every second annoying"

## Root cause

`CacheBusterBanner.jsx` was firing the "Update available" toast on
**every page load** because it was comparing:

- **client bundle** `RUNNING_VERSION` (`paneltec-v160.3.9.58.13.132q1`)
- against the **SW's** `cache_version` returned by `/api/health/version`
  (`paneltec-v160.3.9.58.13.132o`)

Under the **new CACHE_VERSION batching policy** (established in
`.132p_hotfix`), the SW's `CACHE_VERSION` is intentionally NOT bumped on
every ship — only on batched ships that actually warrant a full-page
reload. `RUNNING_VERSION` bumps every ship. So the two are **expected**
to disagree between batched-ship boundaries.

That mismatch made `mismatched === true` on every mount for every user.
The toast rendered with:

```jsx
className={`... ${pulsing ? 'animate-[pulseRing_1.2s_ease-in-out_infinite]' : ''}`}
```

`pulseRing` is a **1.2-second infinite pulsing halo animation**, active
for the first 5 seconds after appear. From the user's seat: a bright
pulsing bell in the corner of the screen for 5 seconds on every mount,
plus the toast body itself popping in/out — read as "blinking every
second".

## Fix

Introduced a bundle-side constant `EXPECTED_CACHE_VERSION` in
`/app/frontend/src/lib/version.js` that mirrors whatever
`CACHE_VERSION` currently reads in `/app/frontend/public/service-worker.js`.
The banner now compares:

```js
serverVersion !== EXPECTED_CACHE_VERSION
```

Both currently `paneltec-v160.3.9.58.13.132o` → no mismatch → no toast
→ no pulseRing → no blink.

When a future batched ship deliberately bumps `CACHE_VERSION`, we bump
`EXPECTED_CACHE_VERSION` in the same commit, and the toast fires
exactly once per user — the correct behaviour.

## Files touched (2)

1. **`/app/frontend/src/lib/version.js`** — added
   `EXPECTED_CACHE_VERSION = 'paneltec-v160.3.9.58.13.132o'` with the
   full policy note. `RUNNING_VERSION` stays at `.132q1`.
2. **`/app/frontend/src/components/CacheBusterBanner.jsx`** —
   `mismatched` compare flipped from `RUNNING_VERSION` to
   `EXPECTED_CACHE_VERSION`. Import updated.

## What was ruled out during the hunt

- ✗ `setInterval(..., 1000)` — only match is `useSessionTimeout.js` line
  63, which never calls `setState` inside the tick unless idle-warn
  fires. Not the cause.
- ✗ React Query `refetchInterval` — zero occurrences across web +
  mobile bundles.
- ✗ `SessionWarningModal` per-second countdown — only mounts during
  idle-warn window; not visible on steady state.
- ✗ WebSocket reconnect loop — no WS in `serviceWorkerRegistration.js`
  or elsewhere in the app.
- ✗ `swVersionGuard` — polls every 60s, gated by `sessionStorage` so
  fires at most once per session.
- ✗ `.132p_hotfix` SW guard — still intact
  (`AUTO_RELOAD_GUARD_KEY` sticky per-session, no regression).
- ✗ Live Preview iframe URL — includes `_t=Date.now()` but the value
  is captured once on mount inside `computeExpoUrl`, not on every
  render.
- ✗ Expo web bundler HMR — the `Web Bundled 30ms` traffic in
  `mobile.out.log` ceased at ~00:29 UTC and hasn't resumed. Not
  currently a cause.
- ✗ DOM mutations — 0 across 30 seconds on `/`, `/app/dashboard`, and
  `/app/settings/permission-presets` after fix (all three tested).

## Ship metadata

- **No version bump** (per user directive — this is a bug fix on top of
  `.132q1` already in flight).
- `RUNNING_VERSION` stays `paneltec-v160.3.9.58.13.132q1`.
- `MOBILE_BUNDLE_VERSION` stays `paneltec-v160.3.9.58.13.132q1`.
- `CACHE_VERSION` stays `paneltec-v160.3.9.58.13.132o` (batching policy
  respected).
- **New** `EXPECTED_CACHE_VERSION` = `paneltec-v160.3.9.58.13.132o` —
  must be bumped in the same commit as any future `CACHE_VERSION` bump.

## Live proof

- **URL**: <https://whs-compliance.preview.emergentagent.com/app/settings/permission-presets>
- **Screenshot**: `/app/frontend/public/mobile-screenshots/v132q_blink_stable_render_proof.png`
- **Probe** (`/tmp/prove_stable.py`): 30-second window sampling every
  5s → 0 DOM mutations, 0 iframe reloads.
- **Before fix**: `mutations=2..3` over 30s (the mount/unmount of the
  toast + pulseRing) + toast visible in `v132q_blink_stable_render_proof.png`
  (pre-hotfix capture).
- **After fix**: `mutations=0` for all 6 samples + no toast in
  `v132q_blink_stable_render_proof.png` (post-hotfix capture, same
  file overwritten by the second run).

## Standing rule (recorded here so the policy survives)

**Any commit that bumps `CACHE_VERSION` in
`/app/frontend/public/service-worker.js` MUST also bump
`EXPECTED_CACHE_VERSION` in `/app/frontend/src/lib/version.js` in the
same commit.** Not doing so re-introduces this bug (either a
false-positive toast, or a missing toast when we actually want one).
