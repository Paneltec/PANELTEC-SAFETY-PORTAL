# .132jg — Fix Update-Check Version Comparison + Verbose Display

## Bug Found

### Root Cause: Stale React closure in setTimeout (CRITICAL)

**File**: `/app/mobile/app/(tabs)/settings.tsx` lines 176-217

**Broken code**:
```tsx
onPress={() => {
  update.manualCheck();          // 1. Fires async check
  if (update.checking) return;   // 2. Checks STALE state — always false
  setTimeout(() => {
    if (update.available) { ... } // 3. STALE — still false from old closure
    else { Alert.alert('Up to Date') } // 4. ← ALWAYS HITS THIS
  }, 2000);
}
```

**Explanation**: The `update` object captured by the `onPress` closure is a **snapshot** from the render when the button was pressed. When `manualCheck()` internally calls `setState()`, the new values only become available in the **next** render. The `setTimeout` callback still reads the **old** `update.available = false` from the stale closure, so it **always** falls through to "Up to Date" regardless of the API response.

### Secondary Issue: check() returns void

The hook's `check()` function only sets state — it does not return a result. There was no way for the Settings screen to `await` the actual check outcome.

### Tertiary Issue: Version display used hardcoded app.json

The version sub-text used `require('../../app.json').expo.version` which is evaluated at **build time**. While technically correct for that specific build, it should use `Application.nativeApplicationVersion` for the runtime-accurate value on native.

### User on v1.0.16 Note

Users on v1.0.16 (build 138) do NOT have the update banner code at all — it was first shipped in `.132ja` (v1.0.18). Their "Check for Updates" screen simply doesn't exist. They must manually download the latest APK. This fix ensures v1.0.24+ builds will always have correct update-check logic going forward.

## Fix Applied

1. **`useUpdateCheck.ts`**: `check()` now returns a `CheckResult` object directly so callers can `await` the actual result instead of reading stale closure state.

2. **`settings.tsx`**: Check for Updates button is now `async onPress` — awaits `manualCheck()` and shows the alert based on the **returned result**, not closure state.

3. **Verbose alert messages**: Both "Up to Date" and "Update Available" alerts now show:
   - Installed version + build code
   - Server version + build code
   - Clear status message

4. **Console logging**: Every check (manual or background) now emits `console.warn('[update-check]', { ... })` with full comparison details for debugging.

5. **Debug gesture**: Triple-tap on the version footer in Settings clears the AsyncStorage "dismissed" flag and retriggers a check with full debug output in an Alert.

6. **`clearDismissedAndRecheck()`**: New exported function to clear dismissed flag and recheck, used by the debug gesture.

7. **Runtime version display**: Version sub-text now uses `Application.nativeApplicationVersion` / `Application.nativeBuildVersion` at runtime, falling back to app.json values.

## Test Cases Table

| Installed | Server | installedBuildCode | serverBuildCode | Expected Result |
|-----------|--------|--------------------|-----------------|-----------------|
| 1.0.16 | 1.0.22 | 138 | 144 | ✅ Update available (144 > 138) |
| 1.0.19 | 1.0.22 | 141 | 144 | ✅ Update available (144 > 141) |
| 1.0.22 | 1.0.22 | 144 | 144 | ❌ Up to date (144 == 144) |
| 1.0.22 | 1.0.24 | 144 | 146 | ✅ Update available (146 > 144) |
| 1.0.24 | 1.0.24 | 146 | 146 | ❌ Up to date (146 == 146) |
| 1.0.24 | 1.0.22 | 146 | 144 | ❌ Up to date (144 < 146) |
| 1.0.9 | 1.0.10 | 109 | 110 | ✅ Update available (110 > 109) |
| web | any | 0 | any>0 | ✅ Update available (any > 0) |

**Key**: Comparison uses integer `versionCode` (build number), NOT string `version`. This avoids the lexicographic trap where `"1.0.16" > "1.0.22"` would be TRUE with string comparison (`"6" > "2"`).

## Files Modified
- `/app/mobile/src/features/updates/useUpdateCheck.ts` — rewrote check() to return CheckResult, added logging, added clearDismissedAndRecheck()
- `/app/mobile/app/(tabs)/settings.tsx` — fixed stale closure, added async await, verbose alerts, debug triple-tap, Application.* runtime versions
- `/app/mobile/src/lib/version.ts` — bumped to .132jg
- `/app/mobile/app.json` — version 1.0.24, versionCode/buildNumber 146

## EAS Build
- **Build ID**: `500ad6d0-f642-45ad-9682-8122e858b13d`
- **Profile**: `preview-apk`
- **Logs**: https://expo.dev/accounts/stephenguy/projects/paneltec-civil-field/builds/500ad6d0-f642-45ad-9682-8122e858b13d
- **Commit**: `4234448d`
