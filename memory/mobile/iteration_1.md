## Iteration 1 — Phase 4 Mobile MVP

### Commit: (pending)
### Date: 2026-09-28

### Changes:
- Rewrote splash/index.tsx to route to email/password login
- Created email/password login screen at (auth)/login.tsx
- Simplified root _layout.tsx (removed Sentry, ErrorBoundary, etc.)
- Restructured tab layout to 5 tabs: Home, Capture, QR Sign-On, My Work, Profile
- Built Home dashboard with compliance score ring + metric chips + AI briefing card
- Built Capture hub with 5 action tiles (hazard, pre-start, diary, incident, inspection)
- Built QR Sign-On with camera barcode scanner (MOCKED submit)
- Built My Work tab with user-filtered records
- Built Profile tab with user info, workspaces, sign out
- Created 5 capture flow screens
- Created civilApi.ts service for all API calls

### Files modified:
- /app/mobile/app/index.tsx (overwritten)
- /app/mobile/app/_layout.tsx (overwritten)
- /app/mobile/app/(auth)/login.tsx (new)
- /app/mobile/app/(tabs)/_layout.tsx (overwritten)
- /app/mobile/app/(tabs)/home.tsx (overwritten)
- /app/mobile/app/(tabs)/capture.tsx (new)
- /app/mobile/app/(tabs)/qr-scan.tsx (overwritten)
- /app/mobile/app/(tabs)/my-work.tsx (overwritten)
- /app/mobile/app/(tabs)/profile.tsx (overwritten)
- /app/mobile/app/(screens)/hazard-new.tsx (new)
- /app/mobile/app/(screens)/prestart-new.tsx (new)
- /app/mobile/app/(screens)/diary-new.tsx (new)
- /app/mobile/app/(screens)/incident-new.tsx (new)
- /app/mobile/app/(screens)/inspection-new.tsx (new)
- /app/mobile/src/services/civilApi.ts (new)

### Known issues:
- QR Sign-On submit is MOCKED (stored locally, no backend endpoint)

### Dependencies installed: None (existing packages sufficient)
