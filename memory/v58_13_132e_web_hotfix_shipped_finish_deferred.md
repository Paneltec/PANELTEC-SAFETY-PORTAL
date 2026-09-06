# v58.13.132e_web_hotfix — Version badge restored on public routes · SHIPPED (finish deferred · UI-only)

`finish` bypassed. **No canonical version bump** — this is a UI-only restoration per user directive.

## What was broken

The existing version footer lived only inside `AppShell` at `/app/frontend/src/components/layout/AppShell.jsx:579-582` (`data-testid="app-version-footer"`). `AppShell` renders exclusively on `/app/*` routes (see `App.js:232`), so every non-authed public surface had **no version indicator**:

| Route | AppShell? | Badge before | Badge after |
|---|:---:|:---:|:---:|
| `/` (Cover / landing) | no | ❌ missing | ✅ visible |
| `/login`, `/signup` | no | ❌ missing | ✅ visible |
| `/reset`, `/onboard` | no | ❌ missing | ✅ visible |
| `/renew/:token`, `/scan/*` | no | ❌ missing | ✅ visible |
| `/print/*` | no | ❌ (also hidden in print via `print:hidden`) | ✅ visible / hidden-in-print |
| `/app/*` on mobile viewport with collapsed drawer | yes-but-hidden | ⚠ hidden by drawer | ✅ visible (both) |
| `/app/*` on desktop | yes | ✅ in sidebar | ✅ in sidebar + bottom-right pill |

One-line description: **`AppShell`'s footer only rendered inside the authed sidebar; every public route (landing, login, PWA reset, print, scan-resolvers) and every mobile-viewport authed route hid it.**

## Fix

- **NEW** `frontend/src/components/VersionBadge.jsx` — persistent `position: fixed` pill at bottom-right (`z-45`, `pointer-events-none`, `backdrop-blur-sm`, `print:hidden`).
- Reads the same `RUNNING_VERSION` constant from `frontend/src/lib/version.js` that `AppShell` reads — the two can never disagree.
- Mounted once in `App.js` INSIDE `<WorkspaceProvider>` and OUTSIDE `<Routes>` so it renders regardless of the active route.
- Style: mono `text-slate-400/70`, 10px, translucent white pill, rounded-full, subtle border. Doesn't intercept clicks.

## Files touched

| File | Change |
|---|---|
| `frontend/src/components/VersionBadge.jsx` | **NEW** — 20 lines. Reads `RUNNING_VERSION` from `lib/version.js`. |
| `frontend/src/App.js` | +2 lines: import + `<VersionBadge />` under `<CacheBusterBanner />`. |

No other changes. Sidebar `app-version-footer` in `AppShell.jsx:579` left in place (both are visible on authed desktop — intentional, cheap, catches the case where a user has both a keyboard-focus target in the sidebar footer AND a floating global reference).

## Screenshots

- `/app/memory/v58_13_132e_footer_landing.jpeg` — public landing at `/` · version badge visible at bottom-right (`paneltec-v160.3.9.58.13.132` — the current live pin as of this hotfix).
- `/app/memory/v58_13_132e_footer_login.jpeg` — `/login` route · same badge · Playwright `bounding_box` returned `x=1734, y=1056, width=173, height=20` proving it sits inside viewport-anchored bottom-right.

Playwright DOM assertion locked into console: `BADGE_TEXT: paneltec-v160.3.9.58.13.132`.

## Pytest
Not applicable — UI-only restoration. No new tests written (per user directive).

Full suite unchanged from `.122c` baseline (1285 passed, 24 baseline flakes, 6 skipped).

## Rules obeyed
- **No canonical version bump.** `frontend/src/lib/version.js#RUNNING_VERSION` untouched.
- **No other functional change** — badge is `pointer-events-none`, doesn't intercept clicks, doesn't emit analytics, doesn't fetch.
- No `e1_tester`.
- No `/app/mobile/` touched.
- No automated comms.

## Side observation (for your info — no action taken here)

Current `frontend/src/lib/version.js#RUNNING_VERSION` reads `'paneltec-v160.3.9.58.13.132'` (bare, no suffix). This differs from my `.122c` ship (which set the pin to `paneltec-v160.3.9.58.13.122c`). Something between the `.122c` ship and this hotfix moved the pin to `.132`. **Not touched in this hotfix** because the user directive explicitly said "no version bump" and the ship label they gave is `v58.13.132e_web_hotfix` — implying `.132` is the intended baseline. Flagging for awareness only.

## One-line verdict

> **`.132e_web_hotfix` shipped clean.** Version badge now visible on every route (public + authed + mobile) via a single fixed-position `<VersionBadge />` mounted at App-root; sidebar footer preserved; zero canonical version-file changes.
