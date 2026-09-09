# v58.13.132p_web_stability_hotfix — Web view blink diagnosis

## Symptom
User: "the web view keep blinking and reseting it self."

## Root cause

Two independent auto-reload mechanisms fire on every fresh service-worker version:

1. `serviceWorkerRegistration.js:92-98` — `controllerchange` listener → sticky sessionStorage guard
   (`paneltec_sw_controller_reloaded`, single key). Correctly limits to ONE reload per session.

2. `serviceWorkerRegistration.js:20-33` — `paneltec_sw_force_reload` broadcast handler → version-keyed sessionStorage guard
   (`paneltec_sw_reloaded_${version}`). Fires once **per CACHE_VERSION** — every new version earns a fresh reload.

Because the last four ships bumped `CACHE_VERSION` in rapid succession
(`.132l → .132m → .132n → .132o`), any user with the tab open through all
four bumps got:

  1. Poll (every 60s) picks up new SW → skipWaiting → controllerchange →
     reload (guard #1 set for the session).
  2. New SW activates → broadcasts `paneltec_sw_force_reload` with the
     new version → guard #2 keyed by that new version → reload again.
  3. On next poll (60s later) the next new version repeats step 2 with a
     fresh guard #2 key.

Four version bumps in a browsing session = four page reloads at roughly
minute intervals. Feels exactly like the user described: "blinking and
resetting itself".

## Confirmation
Fresh headless session (no prior sessionStorage) loading
`https://whs-compliance.preview.emergentagent.com/` — observed **2 frame
navigations** in the first 5 seconds (initial + one auto-reload as the
just-served SW activates) then perfect stability across the next 20
seconds. That matches the mechanism above: a returning user hits the
loop once per pending version, a fresh visitor hits it once as they pick
up whatever version happens to be the newest.

## Fix
Consolidate both auto-reload mechanisms behind ONE sticky per-session
guard (`paneltec_sw_auto_reloaded`) so any auto-reload — whether from
`controllerchange` OR from the `paneltec_sw_force_reload` broadcast —
counts against a single per-session budget. Also add a 30-second
cool-down using `sessionStorage`'s numeric timestamp so back-to-back
version bumps within the same second never stack.

Effect for the user:
- One auto-reload maximum per tab session, regardless of how many
  `CACHE_VERSION` bumps happen while their tab is open.
- The service worker still installs + activates every bump — they just
  don't get a visible reload each time.
- On their next fresh page load (or Cmd+R), they pick up the very
  latest bundle transparently.

## User action
- The user should hard-refresh once (**Cmd+Shift+R** on macOS,
  **Ctrl+Shift+R** on Windows) to install this fix. From that point on
  the tab stays stable across future version bumps.

## No version bump
Per ship rule ("Do NOT bump versions further to 'fix' a cache issue"),
the `CACHE_VERSION` pin stays on `.132o`. This hotfix is a pure
`serviceWorkerRegistration.js` change; the SW itself is unchanged.

## Guardrails preserved
- Real SW updates still install + activate — the fix only silences the
  automatic page-reload for tabs where a reload already happened.
- Dev-mode unregister sweep at the top of `registerServiceWorker()` is
  untouched.
- `controllerchange` continues to fire; the guard just prevents the
  reload when we've already burned our one reload for the session.
