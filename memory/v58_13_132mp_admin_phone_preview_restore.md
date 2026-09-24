# v58.13.132mp — Restore admin Live Preview iframe with graceful fallback

**Ship class:** Reversal + enhancement of `.132mn` (user scope correction)
**Type:** Frontend component + supervisor conf
**Status:** SHIPPED
**Baseline:** `.132mn`

## User correction

`.132mn` swapped the phone-bezel iframe for a static "offline" placeholder
because the Expo dev server was down. User clarified they want the
**actual mobile app rendering inside the bezel**, not a placeholder.

## Fix — three operational changes

### 1. Start Expo dev server
```
$ sudo supervisorctl start mobile
```
Metro Bundler binds `0.0.0.0:3001`. `EXPO_PACKAGER_PROXY_URL` env var
(from supervisor conf) tells Metro to advertise itself under
`https://whs-compliance.expo.preview.emergentagent.com`. **External
subdomain now returns HTTP/2 200** with 59.8 KB of real Expo web app
HTML (previously HTTP/2 502 from CF's origin-unreachable fallback).

Non-fatal warnings observed at boot:
- Sentry: "Missing config for organization, project" — Sentry telemetry
  falls back to env vars; not blocking.
- Deprecated shadow* style props from RN components — cosmetic.
- Route-registration warnings for `visitor`, `scan`, `swms` at top
  level — expected, those routes live under `(screens)/`.
- Electron DevTools tried to launch as root, fatal-errored, Metro
  continued regardless (DevTools is optional).

None of these affect the iframe render.

### 2. Persist Expo across pod restarts

`/etc/supervisor/conf.d/supervisord.conf` — flipped
`[program:mobile]` from `autostart=false` to `autostart=true`.
Applied via `supervisorctl reread + update`. Expo will now boot
on every pod restart.

Note: this file lives OUTSIDE `/app` and is NOT tracked by git.
Ops trail is captured in this memo.

### 3. Component-level graceful fallback

`frontend/src/components/settings/MobileModulesSection.jsx`
(`PhonePreview`, ~L562) — restored the `<iframe src={src}>` as the
primary render. Kept the `.132mn` placeholder as a fallback inside
the same bezel.

**Fallback trigger conditions:**
- iframe fires `onError` (rare — mostly network stack failures)
- 10-second watchdog trips without a matching `onLoad`
- User clicks "Reload" in the fallback → resets both states, iframe
  remounts and retries

## New behaviour matrix

| Condition | Rendered |
|---|---|
| iframe loads OK (typical) | `mobile-preview-iframe` |
| iframe `onError` fires | `mobile-preview-placeholder` + Reload button |
| No `onLoad` within 10s | `mobile-preview-placeholder` + Reload button |
| `src` changes (role/worker picker) | State resets, watchdog restarts |
| User clicks "Reload" | Both states reset, iframe remounts |

## Test IDs

Preserved:
- `mobile-preview-bezel` (bezel container)
- `mobile-preview-iframe` (primary — was hidden in `.132mn`)
- `mobile-preview-placeholder` (fallback container)
- `mobile-preview-url` (URL echo)
- `mobile-preview-copy-url` (clipboard button)

**New:**
- `mobile-preview-retry` (inline reload button in the fallback)

## Files touched

| File | Change |
|---|---|
| `frontend/src/components/settings/MobileModulesSection.jsx` | +130/-90. Iframe restored, fallback conditional, 10s watchdog `useEffect`. |
| `frontend/src/lib/version.js` | +75/-1. Running version + changelog. |
| `frontend/public/service-worker.js` | +1/-1. Cache version bump. |
| `memory/v58_13_132mp_admin_phone_preview_restore.md` | NEW. |

Outside git (infra):
- `/etc/supervisor/conf.d/supervisord.conf` — `autostart=true` for `[program:mobile]`.

## Verification

1. `sudo supervisorctl status mobile` → `RUNNING`.
2. `curl -sSI https://whs-compliance.expo.preview.emergentagent.com/` → `HTTP/2 200`, `cf-cache-status: DYNAMIC`, `access-control-allow-origin: *`.
3. Body sample: `<!DOCTYPE html><html lang="en"><head><title>...</title><style id="expo-reset">...`.
4. Frontend recompiles cleanly (see ship report).
5. Migration + watchdog: `state=running, watchdog_enabled=true` (unaffected).

## Ban discipline

- No `/app/mobile/*` code touch — only started the supervisor program.
- No backend restart.
- No `testing_agent`, no `finish` tool.
- Defensive `git reset` pattern applied — parallel-actor stowaway
  files unstaged before commit. Same 12 stowaways as `.132mn` —
  root cause of the auto-staging still unresolved.

## Rollback

If the iframe misbehaves (Metro crashes, Expo hot-reload breaks the
render, etc.), revert with:

```bash
sudo supervisorctl stop mobile           # kill the Expo dev server
git revert <this-ship-sha>               # revert the component swap
sudo supervisorctl restart frontend      # pick up the placeholder
```

Then re-enter `.132mn` behavior (offline placeholder always shown).

## Follow-ups (next session)

- Root-cause the parallel-actor auto-staging daemon (this is the third
  ship where the defensive reset caught it — needs a permanent fix)
- Verify iframe render inside real admin session with a real role
  (not verified inline — would need Playwright or admin-cookie curl)
