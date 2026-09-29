# .132p3t — SSRA home tile + Navigate/Sign On button fix post-accept

## Change 1 — SSRA quick action tile on Home
- Added teal SSRA tile (shield-checkmark-outline icon, #0D9488 on #CCFBF1 bg) after "My Leave"
- Tap writes `"ssra"` to `@paneltec:formsLibrary:lastCategory` then navigates to Forms tab
- Forms tab reads persisted category on mount and auto-filters to SSRA forms
- 6 tiles now in the 2-column grid (3 rows, symmetric)

## Change 2 — Navigate + Sign On buttons enable post-accept
### Root cause
`isIssued` was not mutually exclusive with `isAccepted`. If the backend returned a status
like `'issued'` alongside `accepted_at` being set, both `isIssued` AND `isAccepted` could
be true simultaneously, causing the locked (issued) button row to render ON TOP of the
accepted row, visually hiding the active buttons.

Additionally, `isAccepted` only checked `job.status === 'accepted'` — if the backend
returned a slightly different status string but DID set `accepted_at`, the buttons would
stay locked.

### Fix
1. `isAccepted = job.status === 'accepted' || !!job.accepted_at` — also true when accepted_at is set
2. `isIssued = !isAccepted && !isDeclined && (...)` — explicitly excludes accepted/declined jobs
3. `handleAcceptJob` onSuccess: spread `accepted_at` fallback so local state always has it

## Files touched
- `mobile/app/(tabs)/home.tsx` — both changes
- `mobile/app.json` — v1.0.62, versionCode 184
- `mobile/src/lib/version.ts` — .132p3t
- `frontend/src/lib/version.js` — .132p3t
- `frontend/public/service-worker.js` — .132p3t
