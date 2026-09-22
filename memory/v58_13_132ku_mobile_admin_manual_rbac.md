# .132ku — Admin-Only Visibility for App/Admin Manual in Settings

## Commit
- **Hash**: `6593fec1`
- **Version**: v1.0.42 / build 164
- **Date**: 2026-09-22

## Changes

### settings.tsx
- Broadened `isAdmin` check from `role_id === 'admin'` to a comprehensive `ADMIN_QUALIFYING_ROLES` list:
  - `admin`, `hseq_lead`, `hseq_manager`, `hseq_manager_2`, `responsible_manager`, `report_emailing_admin`, `supervisor`, `manager`
- Wrapped "App / Admin Manual" `SettingsRow` in `{isAdmin && (...)}` conditional
- "User Manual (Phone)" remains visible to ALL users (unchanged)
- HELP & SUPPORT section renders cleanly for both admin and non-admin views (no orphan spacing)
- This same `isAdmin` broadening also affects the ADMIN TOOLS / Role Simulator section (intentional — aligns with admin gate)

### Version bump
- `app.json`: v1.0.42 / buildNumber 164 / versionCode 164
- `version.ts`: `paneltec-v164.3.9.58.13.132ku`

## Files Modified
- `/app/mobile/app/(tabs)/settings.tsx`
- `/app/mobile/src/lib/version.ts`
- `/app/mobile/app.json`

## Verification
- Screenshot 1: Admin user (Stephen) — both "User Manual (Phone)" and "App / Admin Manual" visible
- Screenshot 2: Non-admin (worker) view — only "User Manual (Phone)" visible, "App / Admin Manual" hidden
- Lint: clean
- No crashes in Metro logs
