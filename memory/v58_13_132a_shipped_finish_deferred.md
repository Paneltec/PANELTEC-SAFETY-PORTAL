# v58.13.132a — Paneltec Civil Field · M1 (Shell + Auth) — SHIP MEMO

**Date**: 2026-09-06
**Version**: paneltec-v160.3.9.58.13.132a
**Status**: finish deferred — all acceptance criteria met

---

## Files Touched

### Backend (4 files)
| File | Action |
|------|--------|
| `backend/mobile_auth.py` | NEW — 5 endpoints: issue-token, redeem, pin-set, pin-verify, push-register |
| `backend/server.py` | MODIFIED — added `mobile_auth_router` import + include |
| `tests/backend_unit/test_v58_13_132a_mobile_auth.py` | NEW — 9 test cases |

### Mobile (24 new files, existing archived)
| File | Purpose |
|------|---------|
| `_archived_v58_pre_rebuild/` | Full archive of previous 44-screen app |
| `app/_layout.tsx` | Root layout with StatusBar |
| `app/index.tsx` | Splash → onboarding/login router |
| `app/(auth)/_layout.tsx` | Auth stack |
| `app/(auth)/onboarding.tsx` | 3-step wizard (code → identity → PIN) |
| `app/(auth)/login.tsx` | Daily PIN login with biometric option |
| `app/(tabs)/_layout.tsx` | 5-tab bottom nav |
| `app/(tabs)/home.tsx` | Placeholder — M2 |
| `app/(tabs)/sites.tsx` | Placeholder — M3 |
| `app/(tabs)/report.tsx` | Placeholder — M4 |
| `app/(tabs)/prestart.tsx` | Placeholder — M5 |
| `app/(tabs)/profile.tsx` | Placeholder — M6, sign-out |
| `src/theme/colors.ts` | Navy #0F172A + orange #F97316 palette |
| `src/theme/typography.ts` | System font scale |
| `src/theme/spacing.ts` | 4/8/12/16/24/32 scale |
| `src/theme/index.ts` | Token export + `token()` helper |
| `src/components/Wordmark.tsx` | Orange chevron + PANELTEC CIVIL brand |
| `src/components/PinPad.tsx` | 3×4 keypad, 76pt tap targets |
| `src/components/PrimaryButton.tsx` | Orange/navy/outline variants |
| `src/components/Card.tsx` | White card with shadow |
| `src/components/CompanyPill.tsx` | Paneltec/Viatec toggle (visual only M1) |
| `src/services/auth.ts` | PIN+JWT flow, web-safe SecureStore wrapper |
| `src/services/push.ts` | Baseline scaffold, web-safe |
| `src/services/offline-queue.ts` | AsyncStorage queue scaffold |
| `src/lib/version.ts` | Bumped to `.132a` |
| `assets/icons/icon.png` | App icon (orange chevron on navy) |
| `assets/icons/adaptive-icon.png` | Android adaptive icon |
| `assets/icons/splash-icon.png` | Splash screen branding |
| `app.json` | Updated name/slug/scheme/splash/icon paths |

---

## Pytest Tally

```
9 passed in 3.26s
```

Tests cover:
1. `test_issue_onboarding_token` — admin can issue token, returns install URL
2. `test_redeem_and_single_use` — redeem works, second redeem = 400
3. `test_full_onboard_and_pin_verify` — full flow issue→redeem→pin-set→pin-verify
4. `test_pin_lockout_after_5` — 5 wrong PINs → 429 lockout
5. `test_push_register` — device token stored
6. `test_pin_set_requires_auth` — no temp session = 401
7. `test_issue_token_requires_admin` — no auth = 401
8. `test_redeem_invalid_token` — bogus token = 400
9. `test_pin_verify_no_device` — missing device_id = 400/422

---

## Curl Transcript (5 endpoints, all 200)

```
EP1: POST /api/mobile/onboarding/issue-token → 200 {token, expires_at, install_url}
EP2: POST /api/mobile/onboarding/redeem → 200 {user: {name, simpro_employee_id, company_name}, temp_session}
EP3: POST /api/mobile/auth/pin-set → 200 {token (JWT 90d), user}
EP4: POST /api/mobile/auth/pin-verify → 200 {token, user}
EP5: POST /api/mobile/push/register → 200 {ok: true}
Single-use: second redeem → 400 "Invalid or already-used onboarding token"
```

---

## Screenshots (8)

1. **Splash** — Navy bg, PANELTEC CIVIL FIELD wordmark, orange spinner
2. **Onboarding Step 1** — Welcome, setup code input, progress dots, orange Continue
3. **Onboarding Step 2** — "Confirm your identity" card: RICK ANTRIM, #810, Paneltec Group
4. **Onboarding Step 3** — "Create your PIN", navy bg, 3×4 keypad, 4 hollow dots
5. **PIN Confirm** — "Confirm your PIN", same keypad, dots empty for re-entry
6. **Daily Login** — After sign-out: wordmark, "Enter your PIN", keypad, version at bottom
7. **Home Shell** — 5-tab nav (Home active), CompanyPill (Paneltec/Viatec), "Coming in Phase M-2"
8. **Sites Tab** — Placeholder: "Coming in Phase M-3", Sites tab active orange

---

## Tech Debt / M2 Blockers

1. **`company_id` missing on workers** — Simpro sync does not populate `company_id` on worker records. The `POST /api/mobile/onboarding/issue-token` endpoint can accept `company_id` manually, but auto-detect from Simpro Company 2/3 is not wired yet. **M2 blocker if company-scoped features ship.**

2. **Deep link testing** — `paneltec://onboard?token=xyz` is registered in app.json but untestable in web preview. Requires a native build or Expo Go to verify end-to-end.

3. **Biometric enrollment** — The login screen conditionally shows biometric button but enrollment after first successful PIN is not yet wired (requires native `expo-local-authentication`; web preview falls back gracefully).

4. **expo-notifications version** — Corrected from `57.0.17` to `~0.32.17` to match Expo SDK 54 expectations.

5. **Web preview limitations** — `expo-secure-store` and `expo-local-authentication` are native-only. Auth service uses localStorage fallback on web; biometric uses dynamic `require()` with Platform gate.
