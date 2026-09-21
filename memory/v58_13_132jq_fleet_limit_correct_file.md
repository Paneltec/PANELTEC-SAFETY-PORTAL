# .132jq — Fix Fleet Limit in Correct File + Bake In Privacy Links

## Root Cause of `.132jo` Mis-Fix

`.132jo` (commit `c255ce7a`) changed `limit: 50 → 200` in `profile.ts::fetchFleetRegister()`. But the Fleet TAB calls a completely different function: `fleet.tsx::fetchFleet()`, which uses `authGet('/api/fleet/register')` with **no limit param**. The backend defaults to `limit=50`.

| Function | File | Has limit? | Called by Fleet tab? |
|---|---|---|---|
| `fetchFleetRegister()` | `src/services/profile.ts:152` | ✅ `limit: 200` (`.132jo`) | ❌ No — Profile/Home only |
| `fetchFleet()` | `app/(tabs)/fleet.tsx:70` | ❌ No param | ✅ Yes — Fleet tab useQuery |

## Fix Applied

**`fleet.tsx:70`**: Changed `'/api/fleet/register'` → `'/api/fleet/register?limit=200&page=1'`

### All `/api/fleet/register` call sites (post-fix):
1. `src/services/profile.ts:152` — `axios.get(..., { params: { limit: 200, page: 1 } })` ✅
2. `app/(tabs)/fleet.tsx:70` — `authGet('/api/fleet/register?limit=200&page=1')` ✅

### Curl verification:
- `GET /api/fleet/register` (no params) → 50 items
- `GET /api/fleet/register?limit=200&page=1` → 115 items ✅

## `.132jp` Legal Links Confirmation

Privacy Policy + Terms of Service links from `.132jp` (commit `3d3074f2`) are confirmed compiled into settings.tsx:
- Line 178: LEGAL section header
- Line 182: Privacy Policy → `/legal/privacy-policy.html`
- Line 188: Terms of Service → `/legal/terms-of-service.html`

## Files Modified
- `app/(tabs)/fleet.tsx` — added `?limit=200&page=1` to fetchFleet URL
- `app.json` — v1.0.30, versionCode/buildNumber 152
- `src/lib/version.ts` — bumped to .132jq

## EAS Build
- **Build ID**: `5213347d-d9cc-42f6-a610-1fdbe9fca4a4`
- **Profile**: `preview-apk`
- **Commit**: `d80ef9cd`
