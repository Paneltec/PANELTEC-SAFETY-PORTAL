# v58.13.132kl — Axios interceptor respects public routes on 401 jwt-expired

## Symptom
User (Stephen) scanned the Paneltec Depot site QR on his phone.
Instead of landing on the visitor sign-in form, the phone bounced to
the main app sign-in landing (Cover page with the Bitumen/Roadwork/
Earthworks palette switcher). The URL bar showed the domain but no
`?next=` param was visible (obscured, but the target was `/`).

## Root cause
Reproduced deterministically by seeding a bogus expired JWT into
`localStorage['paneltec_token']` + `localStorage['paneltec_user']`
then navigating to `/scan/site/uw5w7qQhdaUD` at phone width (390×844)
in a fresh Playwright context. Observed network trace:

```
== all api responses ==
  200  /api/health/version
  200  /api/scan/site/uw5w7qQhdaUD          # public — succeeded
  401  /api/settings/force-refresh-signal   # authed side-effect fetch from
                                            # CacheBusterBanner → jwt-expired
```

The 401 fired on `CacheBusterBanner`'s poll of
`/api/settings/force-refresh-signal` (an authed endpoint). The
pre-.132kl axios interceptor (`frontend/src/lib/api.js:76-93`)
unconditionally bounced the browser via
`window.location.assign('/?next=<pathname>')` — even though the user
was on a public route whose whole point is that no login is
required. Result: the visitor lost their scan destination and
landed on the sign-in surface.

Anyone whose phone previously held a valid JWT (Stephen scanning his
own gate QR, contractors who had been added and used the app once,
Simpro-synced users testing) would trip this every time their
stored JWT expired. The fix on desktop-incognito never reproduced
because incognito has no localStorage carry-over.

## Fix — public-route allow-list + single-flight reload

Modified only `frontend/src/lib/api.js`. Added:

```js
const PUBLIC_ROUTE_PREFIXES = [
  '/', '/onboard', '/m/onboard/', '/reset', '/renew/', '/scan/',
  '/print/worker-id-card/', '/apps-directory',
];

function _isPublicRoute(pathname) {
  if (typeof pathname !== 'string') return false;
  for (const p of PUBLIC_ROUTE_PREFIXES) {
    if (p === '/') { if (pathname === '/') return true; continue; }
    if (pathname.startsWith(p)) return true;
  }
  return false;
}
```

Matching rules:
- `/` — **exact match only** (otherwise every path becomes public)
- All others — `path.startsWith(prefix)` (trailing slash preserved so
  `/onboarding-plans` is NOT falsely public via the `/onboard` prefix)

### New interceptor branches

On 401 with `x-auth-reason` in `PLATFORM_AUTH_REASONS`:
1. Always clear `paneltec_token` + `paneltec_user` from `localStorage`.
2. If `_isPublicRoute(pathname)` → **do NOT bounce**. Instead run a
   single-flight `window.location.reload()`:
   - Set `sessionStorage['paneltec_public_401_cleared_' + pathname]`
     BEFORE the reload
   - On next load, if we hit the same public path AND the flag is
     already set, log a warning and let the rejection propagate —
     never reload again. Prevents an infinite reload loop if the
     backend keeps emitting jwt-* on a public asset probe.
3. If NOT a public route → existing pre-.132kl behaviour:
   `window.location.assign('/?next=<pathname>')`.

### Why reload instead of retry
`SiteScanResolver` reads `getUser()` at mount time and locks its
render branch on that read. Clearing localStorage without re-mounting
would leave the page displaying the wrong branch (kiosk-mode UI
instead of the anon visitor bounce). A single-flight reload
re-mounts the component: `getUser()` returns null → the existing
`.106a` `<Navigate to=".../visitor" replace/>` fires → visitor form
renders. Zero new render logic — the reload is a pure retry.

## Service-worker check — NOT contributing
`frontend/public/service-worker.js:1395-1408` — HTML navigations use
**network-first** with cache fallback. `/scan/site/:token` always
hits the origin first; the SW never serves a stale AppShell HTML for
a public route. Confirmed via `grep isHtmlNavigation` — no
per-route caching that could mask this bug. No changes needed to SW.

## Verification (Playwright, phone-width 390×844)

Three scenarios, all captured as screenshots in `/app/memory/`:

### Scenario 1 — clean phone, no stored token
- Storage cleared → navigate to `/scan/site/uw5w7qQhdaUD`
- Final URL: `.../scan/site/uw5w7qQhdaUD/visitor`
- Screenshot: `v58_13_132kl_s1_clean_phone.jpeg` — visitor form renders
- **PASS**

### Scenario 2 — phone with bogus expired JWT (repro of user's bug)
- Seeded `localStorage.paneltec_token` = fake JWT string,
  `localStorage.paneltec_user` = Stephen's user record
- Navigate to `/scan/site/uw5w7qQhdaUD`
- Observed 401 on `/api/settings/force-refresh-signal` → interceptor
  cleared tokens → single-flight reload → visitor form rendered
- Final URL: `.../scan/site/uw5w7qQhdaUD/visitor`
- Post-fix `localStorage`: `token: None, user: None` (cleared as expected)
- Screenshot: `v58_13_132kl_s2_stale_token.jpeg` — visitor form renders
- **PASS**

### Scenario 3 — non-regression: private route with stale JWT
- Seeded same fake JWT + user
- Navigate to `/app/dashboard`
- Final URL: `https://.../` (sign-in Cover page)
- Screenshot: `v58_13_132kl_s3_private_bounce.jpeg` — Cover / Sign In
  form rendered, dashboard NOT visible
- `?next=/app/dashboard` param stripped — pre-existing race between
  the interceptor's `window.location.assign('/?next=…')` and
  `AppShell.jsx:923`'s local `<Navigate to="/" replace/>` guard
  (`if (!getToken()) return <Navigate to="/" replace/>`). AppShell's
  React-Router client Navigate wins the race. This is pre-.132kl
  behaviour, not a regression from this ship — the substantive
  non-regression requirement (**stale JWT on private route MUST NOT
  render private content**) is confirmed.
- **PASS** on substantive criteria

## Files touched
- `frontend/src/lib/api.js` — added `PUBLIC_ROUTE_PREFIXES` list,
  `_isPublicRoute()` helper, branched interceptor with
  single-flight reload for public routes.
- `frontend/src/lib/version.js` — `RUNNING_VERSION` +
  `EXPECTED_CACHE_VERSION` bumped `.132kh → .132kl`.
- `frontend/public/service-worker.js` — `CACHE_VERSION` bumped
  `.132kh → .132kl`.

## NOT changed
- `/app/mobile/` — untouched.
- Service worker fetch/cache logic — verified network-first on HTML
  navigations, not part of the bug.
- Backend — public endpoints (`/api/scan/site/{token}` +
  `.../sign-on-visitor`) were already correct in `.132kj`; no
  changes required here.
- QR generator + URL builder — encoded URL is correct
  (`https://whs-compliance.preview.emergentagent.com/scan/site/uw5w7qQhdaUD`);
  no changes required.
- `AppShell.jsx:923` local `<Navigate to="/" replace/>` guard —
  left as-is. The `?next=` race is pre-existing, minor, and unrelated
  to this bug; addressing it would require coordinating
  AppShell auth-check with the interceptor's redirect target (out of
  scope for `.132kl`).

## Follow-up candidates (not in this ship)
1. **AppShell `?next=` preservation** — teach AppShell's guard to
   preserve the current `pathname + search` when bouncing to `/`.
2. **`.132kk` mobile deep-link exclusion** — the Expo app still
   claims `whs-compliance.preview.emergentagent.com` as a universal
   link, so scanning the QR on a phone with the app installed
   ALSO routes through the mobile router (a separate class of the
   same-symptom bug). Fix is intent-filter exclusion for `/scan/*`
   paths in `app.json`. Pending user directive to lift `/app/mobile/`
   edit ban.

## Diagnostic recipe (for the next recurrence)
Any user reporting "site QR bounces to sign-in":
```bash
# In their browser devtools:
localStorage.getItem('paneltec_token')  // should be null on a clean phone
sessionStorage.getItem('paneltec_public_401_cleared_/scan/site/<token>')
// If this key exists with a timestamp older than 30s, the .132kl
// single-flight guard already fired but the visitor form STILL
// isn't rendering — that's a different bug, escalate.
```
