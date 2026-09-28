# .132p3i — iOS Credentials Wired

## Ship Label
`.132p3i` — infra only

## Credentials Stored (MASKED)
| Item | Location | Value |
|------|----------|-------|
| ASC API Key (.p8) | `/app/mobile/credentials/AuthKey_9UP969M2KF.p8` | *****(gitignored) |
| Apple Team ID | `/app/backend/.env` `EXPO_APPLE_TEAM_ID` | `Y7DP56U4HS` |
| ASC API Key ID | `/app/backend/.env` `ASC_API_KEY_ID` | `9UP969M2KF` |
| ASC API Issuer ID | `/app/backend/.env` `ASC_API_ISSUER_ID` | `5f5e11d2-****` |

## Gitignore Verification
- `mobile/credentials/` → gitignored via `/app/.gitignore` ✓
- `backend/.env` → gitignored ✓
- Neither file tracked by git ✓

## app.json Update
- Added `ITSAppUsesNonExemptEncryption: false` to `expo.ios.infoPlist`

## EAS Credential Commands — Interactive Only
- `eas credentials --platform ios` — requires stdin (interactive prompt for profile selection)
- `eas device:create` — requires stdin (interactive prompt for account confirmation)
- `eas device:list` — returns "No Apple teams found" (team not yet linked server-side)

## How Credentials Will Flow on First Build
When triggering `eas build -p ios`, pass ASC API key via env vars:
```bash
cd /app/mobile
EXPO_TOKEN=<token> \
EXPO_APPLE_TEAM_ID=Y7DP56U4HS \
EXPO_ASC_API_KEY_PATH=/app/mobile/credentials/AuthKey_9UP969M2KF.p8 \
EXPO_ASC_API_KEY_ID=9UP969M2KF \
EXPO_ASC_API_ISSUER_ID=5f5e11d2-1c69-465a-94b6-6ebf334315ff \
  eas build -p ios --profile preview-ios --non-interactive
```
EAS will auto-provision: distribution cert + ad-hoc provisioning profile.

## Device Registration
For `internal` (ad-hoc) distribution, test devices must register their UDID first.
**User must run interactively on their local machine:**
```bash
eas device:create
```
Or visit: `https://expo.dev/accounts/stephenguy/settings/devices`

Alternative: switch to `distribution: "store"` for a TestFlight build (no device registration needed).

## Next Step
1. User registers their iPhone UDID via `eas device:create` (local) or Expo dashboard
2. Then trigger iOS build with ASC env vars above
3. OR skip device registration and change profile to `distribution: "store"` for TestFlight
