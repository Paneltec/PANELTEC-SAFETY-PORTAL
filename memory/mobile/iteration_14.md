# Iteration 14 — Phase 4.7 + 4.8 + 4.9 Combined Wiring

## What was implemented
### Phase 4.7 — Auth/Password Flows
- **Deep linking**: `app.json` scheme set to `paneltec://`, deep link handler in `_layout.tsx` maps `paneltec://reset?token=...` → `/(auth)/onboard?flavour=reset`
- **Forgot password**: ForgotPasswordModal wired via "Forgot password?" link on login screen
- **Have a PIN?**: Link on login navigates to `/(auth)/pin-redeem` screen
- **Biometric**: Login shows biometric button if hardware available + token stored; opt-in Alert after password login; toggle in Settings SECURITY section
- **Forced password change**: `mustChangePassword` state in AuthContext, checked after login; locked ChangePasswordModal in `_layout.tsx`
- **Self-service change password**: "Change password" row in Profile/Settings SECURITY section opens ChangePasswordModal

### Phase 4.8 — Live Counters Card
- LiveCountersCard integrated into VehicleMapModal below map + coordinates strip
- Shows Total/This Week/Last Month tabs with Engine Hours and Odometer
- Fetches from `/assets/{id}/meter-trends` — returns 404 for Navixy tracker IDs (expected, graceful fallback)

### Phase 4.9 — Trip Summary Card
- TripSummaryCard integrated below LiveCountersCard
- Shows Today/This Week/Last Month tabs with Distance, Drive time, Idle time, Max speed
- Fetches from `/assets/{id}/trip-summary` — same 404 behavior with graceful error message

## Web-to-mobile mapping decisions
- ForgotPasswordModal uses bottom-sheet style (Modal with slide animation)
- ChangePasswordModal uses same pattern with current/new/confirm fields + password strength bar
- Biometric: `expo-local-authentication` + `expo-secure-store` for token storage; on web preview, hardware check returns false so biometric UI is hidden
- VehicleMapModal layout: map fixed at 280px height, cards in ScrollView below

## Known issues / deferred items
- **API ID mismatch**: Live Counters and Trip Summary API endpoints expect internal asset IDs, but VehicleMapModal passes Navixy tracker IDs. This causes 404 responses. The cards handle this gracefully (placeholder/error states). To fix: backend needs an endpoint to resolve Navixy tracker → internal asset, or the cards need to use a different lookup.
- **Biometric not testable on web**: expo-local-authentication returns unavailable on web. Biometric toggle and login button only appear on native devices.
- **Deep links not testable on web**: `paneltec://` scheme requires native app. Expo Router handles onboard route directly on web.

## Dependencies
- `expo-local-authentication`, `expo-secure-store`, `react-native-svg` (installed by previous agent)
- No new dependencies added in this iteration

## Files modified
- `app.json`, `AuthContext.tsx`, `_layout.tsx`, `login.tsx`, `settings.tsx`, `VehicleMapModal.tsx`
