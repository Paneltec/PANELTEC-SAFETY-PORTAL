# Ship `.132p3f` — Public privacy policy page for Play Store

## Privacy policy
- **Source**: `frontend/public/legal/privacy-policy.html` (static HTML, 184 lines)
- **Mobile reference**: `mobile/app/(tabs)/settings.tsx` line 200 — links to `/legal/privacy-policy.html`
- **Public URLs**:
  - `/legal/privacy-policy.html` — canonical static HTML (pre-existing)
  - `/privacy` — SPA redirect → static HTML (new)
  - `/legal/privacy` — SPA redirect → static HTML (new)
  - `/terms` — SPA redirect → `/legal/terms-of-service.html` (new, bonus)
  - `/legal/terms` — SPA redirect → `/legal/terms-of-service.html` (new, bonus)
- Redirects use `window.location.replace()` so Google Play bots get plain HTML, no JS framework dependency

## Files touched
| File | Change |
|------|--------|
| `frontend/src/App.js` | Added `PrivacyRedirect` + `TermsRedirect` components + 4 public routes |
| `frontend/src/lib/version.js` | Bumped to v58.13.132p3f |
| `frontend/public/service-worker.js` | Bumped CACHE_VERSION |

## Google Play Store URL to submit
`https://whs-compliance.preview.emergentagent.com/privacy`
