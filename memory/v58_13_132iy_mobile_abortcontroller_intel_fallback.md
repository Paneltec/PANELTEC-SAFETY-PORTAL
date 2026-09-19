# v58.13.132iy — apiClient AbortController + Intelligence Briefing fallback

## Ship date: 2026-09-19

## Files touched
- `src/services/apiClient.ts` — Full rewrite of authGet/authPost with AbortController timeout
- `app/(tabs)/home.tsx` — Intelligence Briefing card: 45s timeout, retry-on-failure UX
- `src/lib/version.ts` — Version bump to v160.3.9.57.13.132iy
- `app.json` — version 1.0.17, versionCode 139

## Timeouts chosen
| Method    | Default | Rationale |
|-----------|---------|-----------|
| authGet   | 20s     | Standard REST reads shouldn't take longer |
| authPost  | 45s     | LLM-backed endpoints (briefing, ask-ai) need headroom |
| Override  | `{ timeoutMs }` option on every call | Callers can adjust per-endpoint |

## AbortController implementation
- Internal `AbortController` created per request with `setTimeout`.
- On timeout: `controller.abort()` → caught as `AbortError` → returns `{ ok: false, error, timeout: true }`.
- Caller-provided `signal` is chained: both the internal timer and external signal can abort.
- `ApiTimeoutError` class exported for typed error handling.
- Cleanup function clears timer + removes event listener on completion.

## Intelligence Briefing retry UX
- **Before**: Bare `<ActivityIndicator>` that spun forever on slow/failed LLM responses.
- **After**: 
  - Loading: spinner + "Generating briefing…" text
  - Timeout/Error: cloud-offline icon + "Briefing unavailable — tap to retry" (tappable, calls loadData)
  - Success: renders as before
  - Console warning logged on failure for device-log debugging.

## Other screens audit
- `ask-ai.tsx` — already has error handling, now inherits 45s POST timeout automatically
- `my-work.tsx` — already has error handling, now inherits 20s GET timeout
- `qr-scan.tsx` — already has error handling for POST submission
- `profile.tsx` — already has error handling
- No infinite-spinner screens remain.

## Mobile version
- version: 1.0.17
- versionCode: 139
- MOBILE_BUNDLE_VERSION: paneltec-v160.3.9.57.13.132iy

## EAS build
- Build ID: TBD (kicked off after commit)
