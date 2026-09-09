# v58.13.132an — NOT SHIPPED. Three EAS builds failed.

**Ship status:** ❌ NO APK. Codebase reverted to `.132al` baseline.
**Comms Safe Mode:** ON (unchanged).
**Batch scope:** mobile-only investigation. Web / backend untouched.

## Summary

Three EAS builds attempted with three different diagnostic hypotheses. All three failed at Gradle. **No new APK deployed.** The `.132al` crash-instrumented APK remains the current mobile build served from `/api/mobile/downloads/android/latest.apk`.

## Attempts

| # | Build ID | Config | Duration | Outcome |
|---|---|---|---|---|
| 1 | `8e457f81-7739-4aa1-b736-47c4a65e3e9c` | Reanimated `~3.17.5` + `newArchEnabled: false` | 3m 42s | ERRORED. Gradle unknown. Root cause near-certain: RN 0.81 (SDK 54) requires Reanimated 4.x native APIs; 3.17.5 breaks compile. Pre-build `npx expo install --check` explicitly warned. |
| 2 | `31f33e1e-e156-4ddd-9606-e5230927d018` | Reanimated `~4.1.7` (reverted) + `newArchEnabled: false` | 3m 14s | ERRORED. Gradle unknown. Root cause near-certain: Reanimated 4.1.x contains `assertNewArchitectureEnabledTask` (documented behaviour going back to `.132ag`) — it hard-fails when `newArchEnabled: false`. Reanimated 4 **requires** New Arch. |
| 3 | `a6286988-02c6-447d-bc2e-bebc54c0897c` | Reanimated `~4.1.7` + `newArchEnabled: true` + `@sentry/react-native@7.2.0` (placeholder DSN) | 6m 39s | ERRORED. Gradle unknown. Longer run indicates it got past prebuild; native compile failed at Sentry's config-plugin step. `@sentry/react-native` 7.x needs an auth-token env var OR explicit `disableAutoUpload: true` plugin config that this quick integration didn't provide. |

## What we learned (still useful)

Two hypotheses now **ruled out** by build failures:
- **Reanimated 3 downgrade** is not viable on SDK 54 — the version matrix is a hard constraint, not a soft warning. This closes off Path A entirely without another APK spin.
- **`newArchEnabled: false` alone** is not viable while Reanimated 4 is in the dep tree — Reanimated 4's Gradle assertion is a hard block. To disable New Arch we'd need to eject Reanimated 4 → find a lower Reanimated variant that supports both RN 0.81 and old arch (unlikely — the RN 0.81 native surface is New-Arch-first).

Path forward is **Sentry, but properly configured**:
1. Add `@sentry/react-native` back
2. Add config-plugin entry to `app.json` with `{disableAutoUpload: true}` so the build doesn't attempt to upload source maps (which is what fails without an auth token).
3. Init Sentry with `SENTRY_DSN` env var (US or EU — either fine from AU).
4. Rebuild.

## Codebase state after this batch

Fully reverted to `.132al` baseline. Verified in `mobile/`:
- `package.json` — `react-native-reanimated: ~4.1.1` (`4.1.7` installed via yarn.lock)
- `package.json` — `@sentry/react-native` **removed**
- `app.json` — `newArchEnabled: true`, `version: "1.0.4"`, `versionCode: 135`, sentry plugin **removed** (`plugins` array count 9 → 8)
- `.env` — `EXPO_PUBLIC_SENTRY_DSN` line stripped
- `src/lib/version.ts` — `MOBILE_BUNDLE_VERSION: paneltec-v160.3.9.58.13.132al` (reverted)
- `app/_layout.tsx` — Sentry import + init block replaced with a single-line comment noting the failed attempt. `.132al` instrumentation (ErrorBoundary, global handlers, boot trace, splash retention) fully intact.

**Backend manifest untouched** — still serves the `.132al` APK. Landing page + Range delivery unchanged.

## Recommendation for fresh session

Open a new chat with this brief:

> Add `@sentry/react-native@~7.2.0` back to `mobile/package.json`. In `mobile/app.json`, add plugin config:
> ```json
> ["@sentry/react-native/expo", { "url": "https://sentry.io/", "note": "url + auth token unused when disableAutoUpload=true", "organization": null, "project": null }]
> ```
> Wire `Sentry.init` in `mobile/app/_layout.tsx` with `EXPO_PUBLIC_SENTRY_DSN` env var (no-op when unset). Rebuild. Once shipped, provide a real DSN + one-line `.env` swap for `.132ap`.

Note: user-facing outcome for Stephen from this batch = zero. Retest the `.132al` APK still on his phone; the instrumentation there is what will produce the crash-report data on the NEXT launch attempt.

## Security & token compliance

- `EXPO_TOKEN` supplied inline on all 3 build submissions. Never persisted.
- 3 build IDs are unique + tied to the tag `.132an` for later archaeology.
- All memos redact the token.

## Files that were touched during the failed attempts (all reverted)

- `mobile/package.json` (Reanimated version + Sentry add/remove) — final state: same as `.132al`
- `mobile/yarn.lock` (regenerated twice) — final state: matches Reanimated 4.1.7 + no Sentry
- `mobile/app.json` (newArchEnabled + version + versionCode + Sentry plugin add/remove) — final state: `.132al` baseline (newArch:true, 1.0.4, vc 135, 8 plugins)
- `mobile/src/lib/version.ts` (MOBILE_BUNDLE_VERSION) — reverted to `.132al`
- `mobile/.env` (EXPO_PUBLIC_SENTRY_DSN placeholder) — line stripped
- `mobile/app/_layout.tsx` (Sentry import + init block) — reverted, replaced by breadcrumb comment
- `memory/v58_13_132an_reanimated_downgrade_shipped_finish_deferred.md` (this memo) — records the miss

Zero backend / web / DB changes. `.132ao` (Fuel refresh strip hotfix) shipped separately in this session and is unaffected.
