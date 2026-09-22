# .132kk — Public Visitor Route Bypasses Auth for Site QR Deep-Links

## Commit
`9b30d154` — 2026-09-22

## Version
`1.0.40` / versionCode `162` / buildNumber `"162"` / bundle `.132kk`

## EAS Build
`a86fc0fa-3120-4e90-8ab5-da3d005382bf` (preview-apk, Android)

## Pattern Chosen: **B** (in-app public route handling)

---

## Problem
Scanning a site QR (`https://.../scan/site/{token}`) on a phone with the Paneltec app installed → OS opens the app → app's per-screen auth checks redirect to login. Web's incognito flow works fine (visitor form, no auth).

## Fix
Created public expo-router screens that match `/scan/site/{token}` and `/scan/site/{token}/visitor`. These screens use `fetch()` directly (no `authGet`, no JWT) against public backend endpoints.

### New files

1. **`app/scan/site/[token]/index.tsx`** — Site Scan Resolver
   - Fetches `GET /api/scan/site/{token}` (public, no auth header)
   - Validates token → redirects to `/scan/site/[token]/visitor`
   - On 404: shows "Invalid QR Code" error card
   - Auth check via `hasValidSession()` (future: worker vs visitor branching)

2. **`app/scan/site/[token]/visitor.tsx`** — Visitor Sign-In Form
   - Fully public — never redirects to login
   - Header: `VISITOR SIGN-IN` + site name + address
   - Fields: Full Name *, Company, Phone, Purpose (5 pills), Who Are You Visiting, Vehicle Rego
   - Dynamic sign-on questions (if `signon_questions` in payload)
   - SWMS acknowledgement checkboxes (if `active_swms` in payload)
   - Safety induction acknowledgement checkbox
   - Submit → `POST /api/scan/site/{token}/sign-on-visitor` (public, no auth)
   - Success screen: green checkmark + timestamp + SWMS summary chips + GPS warning if applicable

### Router registration
- Added `<Stack.Screen name="scan" />` and `<Stack.Screen name="swms" />` to root `_layout.tsx`

---

## Universal Link Config Status
**No `associatedDomains` or `intentFilters` in app.json.** Currently the OS won't intercept `https://whs-compliance.preview.emergentagent.com/scan/site/*` URLs. Users must use:
- `paneltec-mobile://scan/site/{token}` scheme URL, OR
- Paste the link while the app is open

Adding `associatedDomains` + `intentFilters` is a separate deploy concern requiring `apple-app-site-association` file hosting and EAS config — flagged for `.132kl` follow-up.

```json
// Current app.json (relevant):
{
  "scheme": "paneltec-mobile"
  // No associatedDomains
  // No intentFilters
}
```

---

## Verified Flows
1. ✅ Deep-link to `/scan/site/uw5w7qQhdaUD` → VISITOR SIGN-IN form renders (no login)
2. ✅ Fill form (name, company, phone, purpose, safety ack) → Submit → "You're signed on" success screen with timestamp
3. ✅ SWMS acknowledgement section renders with 2 active SWMS

## Files touched
| File | Change |
|------|--------|
| `app/scan/site/[token]/index.tsx` | **NEW** — public site scan resolver |
| `app/scan/site/[token]/visitor.tsx` | **NEW** — public visitor sign-in form |
| `app/_layout.tsx` | Added `scan` and `swms` Stack.Screen entries |
| `app.json` | v1.0.40, build 162 |
| `src/lib/version.ts` | Bundle `.132kk` |
