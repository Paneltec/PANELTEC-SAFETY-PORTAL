# .132p3e — iOS Build Prep

## Ship Label
`.132p3e` — prep only, no iOS build triggered

## Changes
1. **`app.json`** — `expo.ios.buildNumber` synced `"170"` → `"180"` (matches Android versionCode)
2. **`eas.json`** — added `preview-ios` build profile:
   ```json
   "preview-ios": {
     "distribution": "internal",
     "channel": "preview",
     "ios": { "simulator": false, "resourceClass": "m-medium" }
   }
   ```

## Command to Run When Apple Developer Account Is Ready
```bash
cd /app/mobile
EXPO_TOKEN=<token> eas build -p ios --profile preview-ios --non-interactive
```

## What EAS Will Prompt on First iOS Build
1. **Apple ID login** — EAS will ask for Apple Developer account email + app-specific password (or prompt for ASC API key)
2. **Distribution certificate** — if none exists, EAS auto-generates one (requires Apple Developer Program membership)
3. **Provisioning profile** — EAS auto-generates an ad-hoc profile for `com.emergent.whscompliance.fv5aib`
4. **Device registration** — for `internal` distribution, test devices must be registered in Apple Developer portal (EAS can register them via QR code link)

## Current iOS Config Summary
| Setting | Value |
|---------|-------|
| Bundle ID | `com.emergent.whscompliance.fv5aib` |
| Build number | `180` |
| Version | `1.0.58` |
| Workflow | Managed (no `ios/` dir) |
| Permissions | Camera, Photo Library, Location |
| Push | Not configured yet (deferred) |
| Associated domains | 3 applinks configured |

## Deferred
- Push notification entitlements (`aps-environment`)
- Bundle ID rename to `com.paneltec.civilfield`
- TestFlight / App Store distribution profile
