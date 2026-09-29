# .132p3x — Remove Sign On UI entries from mobile

## Removal 1 — "Sign On" quick action tile on Home
- Removed the pale-blue "Sign On" tile from the 2-column quick actions grid
- Grid now has 5 tiles (Scan Vehicle QR, New Pre-Start, Incident Report, My Leave, SSRA) — asymmetric is fine

## Removal 2 — "Sign On at Site" button on Job Detail card
- Removed the Sign On at Site button from the accepted-job action row
- Navigate button remains and auto-expands to full width (already had flex:1)
- Comment updated from "Navigate + Sign On" → "Navigate"

## Dead code left behind (cleanup later)
- `signOnTime` state, `handleSignOn` handler, `signOnBtn`/`signOnBtnText`/`signOnPrompt` styles — only used by removed UI. Safe dead code, no runtime impact.
- Backend `POST /api/sites/{site_id}/signon-v127` endpoint preserved for future use.

## isAccepted declaration order preserved
- Verified: isAccepted (339) → isDeclined (340) → isIssued (341) — no regression from .132p3w

## Files touched
- `mobile/app/(tabs)/home.tsx` — both removals
- `mobile/app.json` — v1.0.65, versionCode 187
- `mobile/src/lib/version.ts` — .132p3x
- `frontend/src/lib/version.js` — .132p3x
- `frontend/public/service-worker.js` — .132p3x
