# .132jt — QR Scanner In-Cabin Workflow: Scan Sticker → Asset Detail Multi-Action

## Commit
`8d92788b` — 2026-09-21

## EAS Build
`ec7e62ee-eec3-48c0-82af-b7db5980dc2a` (preview-apk, Android)

## Version
`1.0.32` / versionCode `154` / buildNumber `"154"`

---

## QR Format Specification

### Preferred format (readable rego on sticker)
```
paneltec-mobile://asset/XT96AZ
```

### Also supported
| Format | Example |
|--------|---------|
| UUID scheme | `paneltec-mobile://asset/{uuid}` |
| Full URL | `https://whs-compliance.preview.emergentagent.com/asset/XT96AZ` |
| Plain rego | `XT96AZ` |
| Plain UUID | `507f1f77bcf86cd799439011` |

### Parser logic
1. Try `paneltec-mobile://asset/{id}` regex
2. Try `new URL()` → last path segment
3. Try UUID / MongoDB ObjectId regex
4. Try plain alphanumeric (2-20 chars)
5. If none match → "Unrecognised QR format" toast

### Fleet lookup
1. Fetch `/api/fleet/register?limit=500&page=1`
2. Match `rego` or `rego_serial` (case-insensitive)
3. If no rego match → try `id` match
4. If no match → "Unknown Vehicle" modal with Retry + Go Back

---

## Deep Link Scheme
- Registered `paneltec-mobile` in `app.json` → `expo.scheme`
- Replaces previous `paneltec` scheme
- Enables native camera app → Paneltec app handoff on Android/iOS

---

## Scanner Entry Points

| Entry Point | Location | Test ID |
|-------------|----------|---------|
| QR icon in header | Home tab top bar (orange, 22pt) | `home-qr-scan-btn` |
| "Scan Vehicle QR" tile | Home tab Quick Actions (1st tile) | `home-action-scan-qr` |
| Manual fallback | Inside scanner → "Manual" button top-right | `qr-scan-manual-btn` |

---

## Scanner UX

- Full-screen camera (`expo-camera` CameraView, back-facing, QR-only)
- Dimmed overlay (55% opacity) with transparent rectangular reticle (~68% screen width)
- Orange corner brackets on reticle
- Close (X) button: top-left, 44×44pt
- Manual entry: top-right pill button → modal with rego input
- Bottom hint: "Point at the QR sticker inside the vehicle door"
- On scan success: haptic notification + navigate to Fleet tab → auto-open Asset Detail
- On no match: modal with warning icon + "Scan Again" / "Go Back"
- Camera permission denied: full-screen card with "Open Settings" button + "Go back" link

---

## Files Touched

| File | Change |
|------|--------|
| `app/(screens)/qr-scan.tsx` | **Full rewrite** — real camera scanner with fleet lookup, replaces placeholder |
| `app/(tabs)/home.tsx` | Added QR icon in header + "Scan Vehicle QR" tile replacing "Hazard" no-op |
| `app/(tabs)/fleet.tsx` | Added `useLocalSearchParams` for `openAssetId` + auto-open asset detail effect |
| `app.json` | scheme → `paneltec-mobile`, version 1.0.32, build 154 |
| `src/lib/version.ts` | Bundle version updated to `.132jt` |

---

## Includes from Previous Ships
- `.132js` — Forms/Docs error-state UI + focus refetch (commit `516fd7e0`) — confirmed in Metro tree

---

## Home Quick Actions Change
- Removed: "Hazard" tile (was a no-op `onPress={() => {}}`)
- Added: "Scan Vehicle QR" tile (1st position, orange accent)
- "New Pre-Start" now routes to `/forms/picker?category=pre_start` instead of the old qr-scan screen
- "Sign On" unchanged
