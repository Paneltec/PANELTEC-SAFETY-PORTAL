# CACHE_VERSION operational notes

Reference doc — captures a recurring transient-404 symptom whenever
`CACHE_VERSION` (in `frontend/public/service-worker.js`) bumps.

## Pattern

When we bump `CACHE_VERSION` in a shipped batch (e.g. `.132aj`,
`.132ak`, `.132am`), the sequence a live user sees is:

1. User is already on a page (say `/app/fleet/fuel`) with the OLD
   service-worker + OLD `index.html` cached.
2. New backend is deployed with new hashed JS/CSS bundles.
3. User navigates (React Router in-app nav) → the OLD `index.html`
   references bundle URLs that no longer exist on the server.
4. Browser fetches those old bundle URLs → **transient 404** on the
   route the user is trying to view.
5. Service worker's `activate` handler detects the version mismatch,
   sheds the old cache, next hard refresh (or ~30 s later auto SW
   update) serves the fresh `index.html` + new bundles.
6. User sees the page working again.

## Confirmed instances

| Date (UTC) | Batch | Reporter | Symptom | Resolution |
|---|---|---|---|---|
| 2026-09-08 02:26 | `.132am` | Stephen | "getting a 404 request when i connect to fuel reports" | Self-resolved after ~1 min; `fuel is ok now` |

## Duration

- Typical: 30 s – 1 min if the user waits, OR 1 hard-refresh.
- Worst case: user hard-refreshes and the update installs on the
  next navigation (2 refreshes total).

## Not a code bug

The backend endpoints (`/api/fleet/fuel/reports`, `/export`,
`/transactions`, `/smartfill-status`) all continued to return 200
throughout the `.132am` incident (verified live via curl). The 404
was purely an old cached asset URL.

## Mitigation options (parked — not blocking)

1. **`CacheBusterBanner` toast** — small yellow banner that appears
   when the SW `updatefound` event fires, offering "New version
   available · [Refresh]". Cheap ~40-line change; wire into the
   existing SW registration in `frontend/src/lib/swVersionGuard.js`.
2. **Auto-reload on version mismatch** — riskier UX (interrupts the
   user mid-form), but eliminates the confusion window. Only trigger
   after 60 s of visible mismatch to avoid interrupting active input.
3. **Skip-waiting SW strategy** — configure the SW to call
   `self.skipWaiting()` on install, so new versions activate
   immediately rather than waiting for all tabs to close. Trade-off:
   in-flight fetches may briefly mismatch bundle+HTML on the very
   first request after activation.

## Standing action

- On any future "404 on a page that was working before" report,
  before opening code:
  1. Confirm CACHE_VERSION bumped in the most recent batch.
  2. Ask the reporter to hard-refresh.
  3. Curl the backend endpoints from the pod — if 200, it's the
     SW pattern above and self-resolves.
  4. Only investigate code if curl also returns non-200 or the
     symptom persists past 2 hard-refreshes.
- If this pattern happens 3+ times in a month, promote mitigation
  option 1 (`CacheBusterBanner`) into a shipped batch.
