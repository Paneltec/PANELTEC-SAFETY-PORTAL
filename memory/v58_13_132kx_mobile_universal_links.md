# .132kx — Universal Link Config for Site QR + Manual Deep-Links

## Commit
- **Hash**: `ac630cc2`
- **Version**: v1.0.43 / build 165
- **Date**: 2026-09-22

## Changes

### `app.json` — iOS associatedDomains
```json
"associatedDomains": [
  "applinks:whs-compliance.preview.emergentagent.com",
  "applinks:paneltec.com.au",
  "applinks:app.paneltec.com.au"
]
```

### `app.json` — Android intentFilters
```json
"intentFilters": [
  {
    "action": "VIEW",
    "autoVerify": true,
    "data": [
      { "scheme": "https", "host": "whs-compliance.preview.emergentagent.com", "pathPrefix": "/scan" },
      { "scheme": "https", "host": "whs-compliance.preview.emergentagent.com", "pathPrefix": "/onboard" },
      { "scheme": "https", "host": "whs-compliance.preview.emergentagent.com", "pathPrefix": "/manuals" },
      { "scheme": "https", "host": "paneltec.com.au", "pathPrefix": "/scan" },
      { "scheme": "https", "host": "paneltec.com.au", "pathPrefix": "/onboard" },
      { "scheme": "https", "host": "app.paneltec.com.au", "pathPrefix": "/scan" },
      { "scheme": "https", "host": "app.paneltec.com.au", "pathPrefix": "/onboard" }
    ],
    "category": ["BROWSABLE", "DEFAULT"]
  }
]
```

### Path dispatch (already handled by expo-router)
| URL path | Mobile route | Shipped in |
|----------|-------------|------------|
| `/scan/site/{token}` | `app/scan/site/[token]/index.tsx` | `.132kk` |
| `/scan/site/{token}/visitor` | `app/scan/site/[token]/visitor.tsx` | `.132kk` |
| `/scan/{token}` | `app/(screens)/qr-scan.tsx` → asset flow | `.132jv` |
| `/manuals/user` | `Linking.openURL` in Settings | `.132kr` |
| `/manuals/admin` | `Linking.openURL` in Settings | `.132kr` |

### Production hosts
- `paneltec.com.au` and `app.paneltec.com.au` included speculatively.
- If these are NOT production hosts, they can be removed from `app.json` in a follow-up.
- No evidence in the codebase confirming them — they're placeholder production domains.

---

## Backend follow-up: `.132ki2` — AASA + assetlinks.json

The backend must serve these two files for Universal Links to work end-to-end. Without them, the OS falls back to the browser.

### 1. `/.well-known/apple-app-site-association`

Serve at: `https://<host>/.well-known/apple-app-site-association`
Content-Type: `application/json` (NO `.json` extension in the URL)

```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<TEAM_ID>.com.emergent.whscompliance.fv5aib",
        "paths": [
          "/scan/*",
          "/onboard/*",
          "/manuals/*"
        ]
      }
    ]
  }
}
```

**Action**: Replace `<TEAM_ID>` with the Apple Developer Team ID from the EAS or Apple Developer portal (10-char alphanumeric, e.g. `A1B2C3D4E5`).

To find TEAM_ID:
```bash
eas credentials -p ios
# or check Apple Developer portal → Membership → Team ID
```

### 2. `/.well-known/assetlinks.json`

Serve at: `https://<host>/.well-known/assetlinks.json`
Content-Type: `application/json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.emergent.whscompliance.fv5aib",
      "sha256_cert_fingerprints": [
        "<SHA256_FINGERPRINT>"
      ]
    }
  }
]
```

**Action**: Replace `<SHA256_FINGERPRINT>` with the SHA-256 fingerprint of the Android signing certificate.

To find the fingerprint:
```bash
# For EAS-managed signing:
eas credentials -p android
# Look for "SHA-256 Fingerprint" under the keystore info

# Or from Google Play Console:
# Setup → App signing → App signing key certificate → SHA-256 certificate fingerprint
```

Format: `XX:XX:XX:...:XX` (32 colon-separated hex pairs)

### Hosting notes for `e1_dev`
- Both files must be served from the **root domain** (not a subdomain path)
- Must be accessible without authentication
- Must have correct `Content-Type: application/json`
- AASA file must NOT have a `.json` extension in the URL path
- Both must be served over HTTPS
- For multiple hosts (`whs-compliance.preview.emergentagent.com`, `paneltec.com.au`, `app.paneltec.com.au`), each host needs its own copy

---

## Files Modified
- `/app/mobile/app.json` — associatedDomains + intentFilters + version bump
- `/app/mobile/src/lib/version.ts` — `paneltec-v165.3.9.58.13.132kx`

## Notes
- This is a native config change — requires a new EAS build for the intent filters to take effect on-device
- JS-only OTA updates will NOT apply the `associatedDomains` / `intentFilters` changes
- Until the AASA + assetlinks files are served by the backend (`.132ki2`), Universal Links will only work via the `paneltec-mobile://` custom scheme (already configured)
